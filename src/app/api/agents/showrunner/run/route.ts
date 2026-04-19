import { NextResponse } from 'next/server';
import { runShowrunner, type ClipInput, type EpisodeType } from '@/lib/agents/showrunner';
import { buildClipStoragePath, uploadClipFile } from '@/lib/storage';
import { supabaseAdmin } from '@/lib/supabase/client';

export const maxDuration = 300;

interface ClipInputPayload {
  description: string;
  publishDate?: string;
  platforms?: string[];
  fileFieldName?: string; // name of the multipart field holding the clip file
}

interface RunPayload {
  transcript: string;
  episodeType: EpisodeType;
  clips: ClipInput[];
  guestName: string;
  guestLinks: string;
  timestampedOutline: string;
  clipFiles: Array<{
    index: number;
    filename: string;
    contentType: string;
    buffer: Buffer;
  }>;
}

async function readJsonBody(req: Request): Promise<RunPayload> {
  const body: unknown = await req.json();
  const b = (body ?? {}) as Record<string, unknown>;
  const transcript = typeof b.transcript === 'string' ? b.transcript.trim() : '';
  const episodeType: EpisodeType = b.episodeType === 'interview' ? 'interview' : 'solo';
  const guestName = typeof b.guestName === 'string' ? b.guestName.trim() : '';
  const guestLinks = typeof b.guestLinks === 'string' ? b.guestLinks.trim() : '';
  const timestampedOutline =
    typeof b.timestampedOutline === 'string' ? b.timestampedOutline.trim() : '';
  const rawClips: unknown[] = Array.isArray(b.clips) ? b.clips : [];
  const clips: ClipInput[] = rawClips
    .map((raw) => {
      const c = (raw ?? {}) as Record<string, unknown>;
      return {
        description: typeof c.description === 'string' ? c.description.trim() : '',
        publishDate: typeof c.publishDate === 'string' ? c.publishDate : undefined,
        platforms: Array.isArray(c.platforms)
          ? (c.platforms as unknown[]).filter((p): p is string => typeof p === 'string')
          : undefined,
      };
    })
    .filter((c) => c.description);
  return {
    transcript,
    episodeType,
    clips,
    guestName,
    guestLinks,
    timestampedOutline,
    clipFiles: [],
  };
}

async function readMultipartBody(req: Request): Promise<RunPayload> {
  const form = await req.formData();
  const transcript =
    typeof form.get('transcript') === 'string' ? String(form.get('transcript')).trim() : '';
  const episodeType: EpisodeType =
    form.get('episodeType') === 'interview' ? 'interview' : 'solo';
  const guestName = typeof form.get('guestName') === 'string' ? String(form.get('guestName')).trim() : '';
  const guestLinks = typeof form.get('guestLinks') === 'string' ? String(form.get('guestLinks')).trim() : '';
  const timestampedOutline =
    typeof form.get('timestampedOutline') === 'string'
      ? String(form.get('timestampedOutline')).trim()
      : '';
  const clipsJson = form.get('clips');
  const rawClips: ClipInputPayload[] =
    typeof clipsJson === 'string' ? JSON.parse(clipsJson) : [];

  // v2: files are NOT uploaded to Notion here. They're buffered and uploaded
  // to Supabase Storage after the run completes (once we know the run_id).
  const clipFiles: RunPayload['clipFiles'] = [];
  const clips: ClipInput[] = [];
  for (let i = 0; i < rawClips.length; i++) {
    const c = rawClips[i];
    const clip: ClipInput = {
      description: c.description?.trim() ?? '',
      publishDate: c.publishDate,
      platforms: c.platforms,
    };
    if (c.fileFieldName) {
      const file = form.get(c.fileFieldName);
      if (file && file instanceof File && file.size > 0) {
        const buffer = Buffer.from(await file.arrayBuffer());
        clipFiles.push({
          index: i + 1, // 1-based to match clip numbering
          filename: file.name || `clip-${i + 1}`,
          contentType: file.type || 'application/octet-stream',
          buffer,
        });
      }
    }
    if (clip.description) clips.push(clip);
  }
  return {
    transcript,
    episodeType,
    clips,
    guestName,
    guestLinks,
    timestampedOutline,
    clipFiles,
  };
}

export async function POST(req: Request) {
  try {
    const contentType = req.headers.get('content-type') ?? '';
    const payload = contentType.includes('multipart/form-data')
      ? await readMultipartBody(req)
      : await readJsonBody(req);
    const {
      transcript,
      episodeType,
      clips,
      guestName,
      guestLinks,
      timestampedOutline,
      clipFiles,
    } = payload;

    if (!transcript) {
      return NextResponse.json({ error: 'transcript is required' }, { status: 400 });
    }
    if (transcript.split(/\s+/).filter(Boolean).length < 100) {
      return NextResponse.json(
        { error: 'transcript too short (minimum 100 words)' },
        { status: 400 },
      );
    }

    const result = await runShowrunner({
      transcript,
      episodeType,
      clips,
      guestName,
      guestLinks,
      timestampedOutline,
      trigger: 'manual',
    });

    // v2: upload clip files to Supabase Storage now that runId is known, and
    // patch the newly-created social_caption agent_outputs rows with the
    // storage_path so the scheduler can retrieve them later. Non-fatal if a
    // single file fails — partial uploads still schedule the successful ones.
    const uploadedPaths: Array<{ index: number; storagePath: string; filename: string; contentType: string }> = [];
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
        console.error(`[showrunner/run] clip ${file.index} upload failed:`, e);
      }
    }

    // Patch social_caption children — add storage metadata so the scheduler
    // can find the file at schedule time. Also mirror into the parent's
    // full_output.clip_captions[i] for dashboard rendering.
    if (uploadedPaths.length) {
      const db = supabaseAdmin();
      // Update each child social_caption row. Children were created by
      // runAgent's children callback keyed by clip_index.
      for (const u of uploadedPaths) {
        const { data: rows } = await db
          .from('agent_outputs')
          .select('id, draft_content')
          .eq('run_id', result.runId)
          .eq('output_type', 'social_caption');
        type ClipDraft = { clip_index?: number };
        const match = (rows ?? []).find(
          (r: { id: string; draft_content: unknown }) =>
            (r.draft_content as ClipDraft | null)?.clip_index === u.index,
        );
        if (match) {
          const prev = (match.draft_content ?? {}) as Record<string, unknown>;
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
            .eq('id', match.id);
        }
      }

      // Also mirror into the parent queue item's full_output.clip_captions[i]
      // so the dashboard sees storage_path + output_id without an extra query.
      const { data: children } = await db
        .from('agent_outputs')
        .select('id, draft_content')
        .eq('run_id', result.runId)
        .eq('output_type', 'social_caption');
      type ClipDraft = { clip_index?: number };
      const childByIndex = new Map<number, string>();
      for (const c of children ?? []) {
        const idx = (c.draft_content as ClipDraft | null)?.clip_index;
        if (typeof idx === 'number') childByIndex.set(idx, c.id);
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
          const outputId = typeof cap.index === 'number' ? childByIndex.get(cap.index) : undefined;
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
          .update({ full_output: { ...fullOutput, clip_captions: updatedCaptions } })
          .eq('id', queueItem.id);
        // Same mirror on the parent agent_output row so the audit trail stays consistent.
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
      episodeTitle: result.parsed.substackTitle || result.parsed.youtubeTitle,
      clipCount: result.parsed.clipCaptions.length,
      captionCount: result.parsed.clipCaptions.length,
      clipsUploaded: uploadedPaths.length,
      tokensIn: result.result.inputTokens,
      tokensOut: result.result.outputTokens,
      costEstimate: result.result.costEstimate,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Showrunner failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
