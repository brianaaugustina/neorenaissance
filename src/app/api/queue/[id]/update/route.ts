import { NextResponse } from 'next/server';
import { runOpsChiefDailyBriefing } from '@/lib/agents/ops-chief';
import { runWeeklyPlanner } from '@/lib/agents/ops-chief-weekly';
import {
  extractCaptionsInputs,
  extractMetadataInputs,
  extractSubstackInputs,
  getShowrunnerOutputKind,
  runShowrunnerEpisodeMetadata,
  runShowrunnerSocialCaptions,
  runShowrunnerSubstackPost,
} from '@/lib/agents/showrunner';
import { supabaseAdmin, type QueueStatus } from '@/lib/supabase/client';

export const maxDuration = 300;

interface UpdateBody {
  feedback?: string;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body: UpdateBody = await req.json().catch(() => ({}));
    const feedback = (body.feedback ?? '').trim();
    if (!feedback) {
      return NextResponse.json(
        { error: 'feedback is required for Update' },
        { status: 400 },
      );
    }

    const db = supabaseAdmin();
    const { data: item, error } = await db
      .from('approval_queue')
      .select('*')
      .eq('id', id)
      .single();
    if (error || !item) {
      return NextResponse.json({ error: 'Queue item not found' }, { status: 404 });
    }

    const agent = item.agent_name as string;
    const type = item.type as string;

    if (agent === 'showrunner' && type === 'draft') {
      const fullOutput = (item.full_output ?? {}) as Record<string, unknown>;
      const kind = getShowrunnerOutputKind(fullOutput);

      let dispatched: { queueId: string; kind: string } | null = null;
      if (kind === 'substack_post') {
        const inputs = extractSubstackInputs(fullOutput);
        if (!inputs) return inputsMissingResponse();
        const r = await runShowrunnerSubstackPost({
          ...inputs,
          trigger: 'manual',
          updateFeedback: feedback,
        });
        dispatched = { queueId: r.queueId, kind };
      } else if (kind === 'episode_metadata') {
        const inputs = extractMetadataInputs(fullOutput);
        if (!inputs) return inputsMissingResponse();
        const r = await runShowrunnerEpisodeMetadata({
          ...inputs,
          trigger: 'manual',
          updateFeedback: feedback,
        });
        dispatched = { queueId: r.queueId, kind };
      } else if (kind === 'social_captions') {
        const inputs = extractCaptionsInputs(fullOutput);
        if (!inputs) return inputsMissingResponse();
        const r = await runShowrunnerSocialCaptions({
          ...inputs,
          trigger: 'manual',
          updateFeedback: feedback,
        });
        dispatched = { queueId: r.queueId, kind };
      } else if (kind === 'legacy') {
        return NextResponse.json(
          {
            error:
              'This item was produced by the old combined Showrunner run. Re-run via the Substack / Titles / Captions tabs.',
          },
          { status: 400 },
        );
      }

      if (!dispatched) {
        return NextResponse.json(
          { error: 'Could not resolve Showrunner output kind on this item.' },
          { status: 400 },
        );
      }
      await markSuperseded(item.id, dispatched.queueId, feedback);
      return NextResponse.json({
        ok: true,
        newQueueId: dispatched.queueId,
        agent: 'showrunner',
        kind: dispatched.kind,
      });
    }

    if (agent === 'ops_chief' && type === 'briefing') {
      await db
        .from('approval_queue')
        .update({
          feedback,
          status: 'rejected' satisfies QueueStatus,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', id);
      const result = await runOpsChiefDailyBriefing('manual');
      await markSuperseded(item.id, result.queueId, feedback);
      return NextResponse.json({
        ok: true,
        newQueueId: result.queueId,
        agent: 'ops_chief',
      });
    }

    if (agent === 'ops_chief' && type === 'recommendation') {
      await db
        .from('approval_queue')
        .update({
          feedback,
          status: 'rejected' satisfies QueueStatus,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', id);
      const result = await runWeeklyPlanner('manual');
      await markSuperseded(item.id, result.queueId, feedback);
      return NextResponse.json({
        ok: true,
        newQueueId: result.queueId,
        agent: 'ops_chief',
      });
    }

    if (
      (agent === 'sponsorship-director' || agent === 'pr-director') &&
      (type === 'draft' || type === 'report')
    ) {
      return NextResponse.json(
        {
          error: `Update not yet wired for ${agent} / ${type}. Approve, Edit, or use Replace on the research batch for now.`,
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      { error: `Update not supported for agent=${agent} type=${type}` },
      { status: 400 },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Update failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

function inputsMissingResponse() {
  return NextResponse.json(
    {
      error:
        "This item's inputs weren't stored on it. Re-run via the Showrunner tabs directly with the same inputs plus your feedback.",
    },
    { status: 400 },
  );
}

async function markSuperseded(
  oldQueueItemId: string,
  newQueueItemId: string,
  feedback: string,
): Promise<void> {
  const db = supabaseAdmin();
  const { data: old } = await db
    .from('approval_queue')
    .select('full_output')
    .eq('id', oldQueueItemId)
    .single();
  const prevFullOutput = (old?.full_output ?? {}) as Record<string, unknown>;
  await db
    .from('approval_queue')
    .update({
      status: 'superseded' satisfies QueueStatus,
      reviewed_at: new Date().toISOString(),
      feedback,
      full_output: {
        ...prevFullOutput,
        superseded_by_queue_id: newQueueItemId,
        superseded_feedback: feedback,
      },
    })
    .eq('id', oldQueueItemId);
}
