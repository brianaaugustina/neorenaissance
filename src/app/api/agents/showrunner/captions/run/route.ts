import { NextResponse } from 'next/server';
import {
  runShowrunnerSocialCaptions,
  type ClipInput,
  type EpisodeType,
} from '@/lib/agents/showrunner';
import { buildClipStoragePath, uploadClipFile } from '@/lib/storage';
import { supabaseAdmin } from '@/lib/supabase/client';

export const maxDuration = 300;

const DEFAULT_PLATFORMS = [
  'IN@tradesshow',
  'TIKTOK@tradesshow',
  'LI@brianaottoboni',
];

interface ClipInputPayload {
  description: string;
  publishDate?: string;
  platforms?: string[];
  fileFieldName?: string;
}

interface RunPayload {
  clips: ClipInput[];
  episodeType: EpisodeType;
  episodeContextNote: string;
  clipFiles: Array<{
    index: number;
    filename: string;
    contentType: string;
    buffer: Buffer;
  }>;
}

async function readJsonBody(req: Request): Promise<RunPayload> {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const episodeType: EpisodeType =
    body.episodeType === 'interview' ? 'interview' : 'solo';
  const episodeContextNote =
    typeof body.episodeContextNote === 'string'
      ? body.episodeContextNote.trim()
      : '';
  const rawClips = Array.isArray(body.clips) ? (body.clips as unknown[]) : [];
  const clips: ClipInput[] = rawClips
    .map((raw) => {
      const c = (raw ?? {}) as Record<string, unknown>;
      return {
        description:
          typeof c.description === 'string' ? c.description.trim() : '',
        publishDate:
          typeof c.publishDate === 'string' ? c.publishDate : undefined,
        platforms: Array.isArray(c.platforms)
          ? (c.platforms as unknown[]).filter(
              (p): p is string => typeof p === 'string',
            )
          : DEFAULT_PLATFORMS,
      };
    })
    .filter((c) => c.description);
  return { clips, episodeType, episodeContextNote, clipFiles: [] };
}

async function readMultipartBody(req: Request): Promise<RunPayload> {
  const form = await req.formData();
  const episodeType: EpisodeType =
    form.get('episodeType') === 'interview' ? 'interview' : 'solo';
  const episodeContextNote =
    typeof form.get('episodeContextNote') === 'string'
      ? String(form.get('episodeContextNote')).trim()
      : '';
  const clipsJson = form.get('clips');
  const rawClips: ClipInputPayload[] =
    typeof clipsJson === 'string' ? JSON.parse(clipsJson) : [];

  const clipFiles: RunPayload['clipFiles'] = [];
  const clips: ClipInput[] = [];
  for (let i = 0; i < rawClips.length; i++) {
    const c = rawClips[i];
    const clip: ClipInput = {
      description: c.description?.trim() ?? '',
      publishDate: c.publishDate,
      platforms: c.platforms ?? DEFAULT_PLATFORMS,
    };
    if (c.fileFieldName) {
      const file = form.get(c.fileFieldName);
      if (file && file instanceof File && file.size > 0) {
        const buffer = Buffer.from(await file.arrayBuffer());
        clipFiles.push({
          index: i + 1,
          filename: file.name || `clip-${i + 1}`,
          contentType: file.type || 'application/octet-stream',
          buffer,
        });
      }
    }
    if (clip.description) clips.push(clip);
  }
  return { clips, episodeType, episodeContextNote, clipFiles };
}

export async function POST(req: Request) {
  try {
    const contentType = req.headers.get('content-type') ?? '';
    const payload = contentType.includes('multipart/form-data')
      ? await readMultipartBody(req)
      : await readJsonBody(req);
    const { clips, episodeType, episodeContextNote, clipFiles } = payload;

    if (!clips.length) {
      return NextResponse.json(
        { error: 'at least one clip (with description) is required' },
        { status: 400 },
      );
    }

    const result = await runShowrunnerSocialCaptions({
      clips,
      episodeType,
      episodeContextNote,
      trigger: 'manual',
    });

    // Upload clip files to Supabase Storage (same pattern the old one-shot used)
    // and patch child social_caption rows + parent full_output with storage_path.
    const uploadedPaths: Array<{
      index: number;
      storagePath: string;
      filename: string;
      contentType: string;
    }> = [];
    for (const file of clipFiles) {
      try {
        const storagePath = buildClipStoragePath({
          runId: result.runId,
          clipIndex: file.index,
          filename: file.filename,
        });
        await uploadClipFile({
          storagePath,
          buffer: file.buffer,
          contentType: file.contentType,
        });
        uploadedPaths.push({
          index: file.index,
          storagePath,
          filename: file.filename,
          contentType: file.contentType,
        });
      } catch (e) {
        console.error(
          `[showrunner/captions/run] clip ${file.index} upload failed:`,
          e,
        );
      }
    }

    if (uploadedPaths.length) {
      const db = supabaseAdmin();
      type ClipDraft = { clip_index?: number };

      const { data: children } = await db
        .from('agent_outputs')
        .select('id, draft_content')
        .eq('run_id', result.runId)
        .eq('output_type', 'social_caption');
      const childByIndex = new Map<number, string>();
      for (const row of children ?? []) {
        const idx = (row.draft_content as ClipDraft | null)?.clip_index;
        if (typeof idx === 'number') childByIndex.set(idx, row.id);
      }

      for (const u of uploadedPaths) {
        const childId = childByIndex.get(u.index);
        if (!childId) continue;
        const childRow = (children ?? []).find((r) => r.id === childId);
        const prev = (childRow?.draft_content ?? {}) as Record<string, unknown>;
        await db
          .from('agent_outputs')
          .update({
            draft_content: {
              ...prev,
              storage_path: u.storagePath,
              filename: u.filename,
              file_content_type: u.contentType,
            },
          })
          .eq('id', childId);
      }

      interface QueueFullOutput {
        clip_captions?: Array<Record<string, unknown> & { index?: number }>;
      }
      const { data: queueItem } = await db
        .from('approval_queue')
        .select('id, full_output')
        .eq('run_id', result.runId)
        .eq('agent_name', 'showrunner')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      if (queueItem) {
        const fullOutput = (queueItem.full_output ?? {}) as QueueFullOutput;
        const updatedCaptions = (fullOutput.clip_captions ?? []).map((cap) => {
          const upload = uploadedPaths.find((u) => u.index === cap.index);
          const outputId =
            typeof cap.index === 'number' ? childByIndex.get(cap.index) : undefined;
          return {
            ...cap,
            ...(upload
              ? {
                  storage_path: upload.storagePath,
                  filename: upload.filename,
                  file_content_type: upload.contentType,
                }
              : {}),
            ...(outputId ? { output_id: outputId } : {}),
          };
        });
        await db
          .from('approval_queue')
          .update({
            full_output: { ...fullOutput, clip_captions: updatedCaptions },
          })
          .eq('id', queueItem.id);
        if (queueItem.id) {
          const { data: parent } = await db
            .from('agent_outputs')
            .select('id, draft_content')
            .eq('approval_queue_id', queueItem.id)
            .is('parent_output_id', null)
            .single();
          if (parent) {
            const prev = (parent.draft_content ?? {}) as QueueFullOutput;
            await db
              .from('agent_outputs')
              .update({
                draft_content: { ...prev, clip_captions: updatedCaptions },
              })
              .eq('id', parent.id);
          }
        }
      }
    }

    return NextResponse.json({
      ok: true,
      runId: result.runId,
      queueId: result.queueId,
      captionCount: result.parsed.clipCaptions.length,
      clipsUploaded: uploadedPaths.length,
      tokensIn: result.result.inputTokens,
      tokensOut: result.result.outputTokens,
      costEstimate: result.result.costEstimate,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Captions run failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
