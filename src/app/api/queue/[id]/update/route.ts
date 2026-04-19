import { NextResponse } from 'next/server';
import { runOpsChiefDailyBriefing } from '@/lib/agents/ops-chief';
import { runWeeklyPlanner } from '@/lib/agents/ops-chief-weekly';
import {
  extractShowrunnerInputs,
  extractShowrunnerPreserved,
  runShowrunner,
  type ShowrunnerUpdateScope,
} from '@/lib/agents/showrunner';
import { supabaseAdmin, type QueueStatus } from '@/lib/supabase/client';

// Update endpoint — the replacement for Reject & Retry. Triggered by the
// Update button on a queue card. Accepts scoped feedback and re-runs the
// agent so the feedback is honored directly (not via the 14-day window
// fallback), and — for multi-output agents like Showrunner — only the
// affected sub-output is regenerated while the rest pass through
// byte-identical.
//
// Old item is marked status='superseded' with a pointer to the new queue
// id. It stays visible in history but the dashboard hides the approval
// controls on it.
export const maxDuration = 300;

interface UpdateBody {
  feedback?: string;
  /** Optional explicit scope. If omitted, the agent infers from feedback text. */
  scope?: ShowrunnerUpdateScope | 'pitch' | 'research_batch';
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

    // Showrunner draft — full multi-output scoped regen path.
    if (agent === 'showrunner' && type === 'draft') {
      const inputs = extractShowrunnerInputs(item.full_output ?? {});
      if (!inputs) {
        return NextResponse.json(
          {
            error:
              "This Showrunner item predates the Update flow (transcript isn't stored on it). Upload the transcript again in the Run Showrunner box and add your feedback there.",
          },
          { status: 400 },
        );
      }
      const preserved = extractShowrunnerPreserved(item.full_output ?? {});
      const scope = isShowrunnerScope(body.scope) ? body.scope : undefined;
      const result = await runShowrunner({
        ...inputs,
        trigger: 'manual',
        updateContext: { feedback, scope, preserved },
      });
      await markSuperseded(item.id, result.queueId, feedback);
      return NextResponse.json({
        ok: true,
        newQueueId: result.queueId,
        agent: 'showrunner',
        scope: scope ?? 'inferred',
      });
    }

    // Ops Chief daily briefing — full regen with feedback stored on the old
    // queue item; the next run picks it up via getRecentFeedback. Add a
    // direct pass too so it's in the system prompt immediately.
    if (agent === 'ops_chief' && type === 'briefing') {
      // Persist feedback on the old item so the next run's getRecentFeedback
      // sees it. Briefings don't have a natural "preserve these sub-outputs"
      // model — a new briefing is a full regen by nature.
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

    // Sponsorship + PR pitch drafts — single-output; feedback becomes a
    // prompt constraint on a fresh pitch regen against the same lead. The
    // old lead's context (brand_name, contact, fit, etc.) lives in the
    // rejected item's full_output. We dispatch back to the lead-approval
    // path with an 'updateFeedback' rider. Simpler for sub-step 1: drop
    // back to the existing lead-regen — the prompt already accepts
    // getRecentFeedback automatically; mark the old item rejected with
    // feedback so the window query catches it, then trigger the lead
    // approve on a clone of the lead data.
    //
    // For Pass A we return an explicit 'not yet supported' signal for
    // these agents; their Update paths land in the follow-up commit once
    // the lead-regen signature is extended to accept direct scoped
    // feedback. Until then, the existing Approve/Reject flow on
    // sponsorship/pr pitches remains.
    if (
      (agent === 'sponsorship-director' || agent === 'pr-director') &&
      (type === 'draft' || type === 'report')
    ) {
      return NextResponse.json(
        {
          error:
            `Update not yet wired for ${agent} / ${type}. Approve, Edit, or use Replace on the research batch for now.`,
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
  const prevFullOutput =
    (old?.full_output ?? {}) as Record<string, unknown>;
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

function isShowrunnerScope(
  s: unknown,
): s is ShowrunnerUpdateScope {
  return (
    s === 'social_captions' ||
    s === 'episode_metadata' ||
    s === 'substack_post' ||
    s === 'all'
  );
}
