import { NextResponse } from 'next/server';
import { createContentEntry, uploadFileToNotion } from '@/lib/notion/client';
import { downloadClipFile } from '@/lib/storage';
import { supabaseAdmin } from '@/lib/supabase/client';

// Per-clip Schedule — fires when Briana picks a date + time on an approved
// social_caption. Pulls the file from Supabase Storage, uploads to Notion,
// creates the Content DB row, and stamps the agent_output row so the
// dashboard knows this clip is scheduled.
export const maxDuration = 300;

const TTS_VENTURE_ID = '194e5c03a7f480c2bbf9ed13f3656511';
const DEFAULT_PLATFORMS = [
  'IN@tradesshow',
  'TIKTOK@tradesshow',
  'LI@brianaottoboni',
];

export async function POST(
  req: Request,
  { params }: { params: Promise<{ outputId: string }> },
) {
  try {
    const { outputId } = await params;
    const body = await req.json();
    const publishDate: string | undefined = body?.publishDate;
    const publishTime: string = body?.publishTime ?? '11:11';
    const publishTimezone: string = body?.publishTimezone ?? 'America/Los_Angeles';

    if (!publishDate || !/^\d{4}-\d{2}-\d{2}$/.test(publishDate)) {
      return NextResponse.json(
        { error: 'publishDate must be YYYY-MM-DD' },
        { status: 400 },
      );
    }
    if (!/^\d{2}:\d{2}(:\d{2})?$/.test(publishTime)) {
      return NextResponse.json(
        { error: 'publishTime must be HH:mm (24-hour)' },
        { status: 400 },
      );
    }

    const db = supabaseAdmin();
    const { data: out, error } = await db
      .from('agent_outputs')
      .select('id, agent_id, output_type, approval_status, draft_content, parent_output_id')
      .eq('id', outputId)
      .single();
    if (error || !out) {
      return NextResponse.json({ error: 'Clip output not found' }, { status: 404 });
    }
    if (out.agent_id !== 'showrunner' || out.output_type !== 'social_caption') {
      return NextResponse.json(
        { error: 'This endpoint only schedules Showrunner social_caption outputs' },
        { status: 400 },
      );
    }
    if (out.approval_status !== 'approved' && out.approval_status !== 'edited') {
      return NextResponse.json(
        { error: 'Clip must be approved before scheduling' },
        { status: 409 },
      );
    }

    interface ClipDraft {
      clip_index?: number;
      caption?: string;
      hashtags?: string[];
      platforms?: string[];
      storage_path?: string;
      filename?: string;
      file_content_type?: string;
      scheduled_at?: string;
      notion_content_id?: string;
    }
    const draft = (out.draft_content ?? {}) as ClipDraft;
    if (draft.notion_content_id) {
      return NextResponse.json(
        {
          error: 'Clip already scheduled',
          notionContentId: draft.notion_content_id,
        },
        { status: 409 },
      );
    }

    // Fetch the parent agent_output to pull episode_title for the Content row name.
    interface ParentDraft {
      substack_title?: string;
      episode_title?: string;
      youtube_title?: string;
      content_pillars?: string[];
    }
    let parentTitle = 'Episode';
    let contentPillars: string[] = [];
    if (out.parent_output_id) {
      const { data: parent } = await db
        .from('agent_outputs')
        .select('draft_content, final_content')
        .eq('id', out.parent_output_id)
        .single();
      if (parent) {
        const p = (parent.final_content ?? parent.draft_content ?? {}) as ParentDraft;
        parentTitle = p.substack_title ?? p.episode_title ?? p.youtube_title ?? parentTitle;
        if (Array.isArray(p.content_pillars)) {
          contentPillars = p.content_pillars;
        }
      }
    }

    const captionBody = [draft.caption, draft.hashtags?.join(' ')]
      .filter(Boolean)
      .join('\n\n');

    // Upload file to Notion if we have one in Supabase Storage.
    let fileUploadId: string | undefined;
    if (draft.storage_path) {
      try {
        const { buffer, contentType } = await downloadClipFile(draft.storage_path);
        const filename = draft.filename ?? `clip-${draft.clip_index ?? ''}`;
        fileUploadId = await uploadFileToNotion(
          buffer,
          filename,
          draft.file_content_type ?? contentType ?? 'application/octet-stream',
        );
      } catch (e) {
        console.error('[schedule] file transfer failed:', e);
        return NextResponse.json(
          {
            error: 'File transfer to Notion failed — ' +
              (e instanceof Error ? e.message : String(e)),
          },
          { status: 500 },
        );
      }
    }

    const notionContentId = await createContentEntry({
      name: `${parentTitle} — Clip ${draft.clip_index ?? ''}`.trim(),
      status: fileUploadId ? '✅ Done' : undefined,
      contentType: ['Reel'],
      platforms: draft.platforms ?? DEFAULT_PLATFORMS,
      caption: captionBody,
      contentPillar: contentPillars,
      publishDate,
      publishTime,
      publishTimezone,
      ventureIds: [TTS_VENTURE_ID],
      fileUploadIds: fileUploadId ? [fileUploadId] : undefined,
    });

    const scheduledAt = new Date().toISOString();
    const updated = {
      ...draft,
      scheduled_at: scheduledAt,
      publish_date: publishDate,
      publish_time: publishTime,
      publish_timezone: publishTimezone,
      notion_content_id: notionContentId,
    };
    await db
      .from('agent_outputs')
      .update({ draft_content: updated })
      .eq('id', outputId);

    // Mirror onto the parent's embedded clip_captions so the dashboard reflects
    // the scheduled state without a child fetch.
    if (out.parent_output_id) {
      const { data: parent } = await db
        .from('agent_outputs')
        .select('draft_content, approval_queue_id')
        .eq('id', out.parent_output_id)
        .single();
      if (parent) {
        interface ParentFullOutput {
          clip_captions?: Array<Record<string, unknown> & { index?: number; output_id?: string }>;
        }
        const prev = (parent.draft_content ?? {}) as ParentFullOutput;
        const updatedCaptions = (prev.clip_captions ?? []).map((c) => {
          if (c.output_id === outputId || c.index === draft.clip_index) {
            return {
              ...c,
              scheduled_at: scheduledAt,
              publish_date: publishDate,
              publish_time: publishTime,
              publish_timezone: publishTimezone,
              notion_content_id: notionContentId,
            };
          }
          return c;
        });
        await db
          .from('agent_outputs')
          .update({ draft_content: { ...prev, clip_captions: updatedCaptions } })
          .eq('id', out.parent_output_id);
        if (parent.approval_queue_id) {
          const { data: queue } = await db
            .from('approval_queue')
            .select('full_output')
            .eq('id', parent.approval_queue_id)
            .single();
          if (queue) {
            const qFull = (queue.full_output ?? {}) as ParentFullOutput;
            await db
              .from('approval_queue')
              .update({
                full_output: { ...qFull, clip_captions: updatedCaptions },
              })
              .eq('id', parent.approval_queue_id);
          }
        }
      }
    }

    return NextResponse.json({
      ok: true,
      outputId,
      notionContentId,
      publishDate,
      publishTime,
      publishTimezone,
      scheduledAt,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Schedule failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
