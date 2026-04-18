import { NextResponse } from 'next/server';
import { runOpsChiefDailyBriefing } from '@/lib/agents/ops-chief';
import { runWeeklyPlanner } from '@/lib/agents/ops-chief-weekly';
import { extractShowrunnerInputs, runShowrunner } from '@/lib/agents/showrunner';
import { supabaseAdmin } from '@/lib/supabase/client';

export const maxDuration = 300;

// Retry a rejected queue item by re-running the agent that produced it.
// Assumes the caller already marked the original item rejected and wrote the
// feedback into agent_memory.feedback_rules + approval_queue.feedback — the
// next run will pick that up automatically via getRecentFeedback.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const { data: item, error } = await supabaseAdmin()
      .from('approval_queue')
      .select('*')
      .eq('id', id)
      .single();
    if (error || !item) {
      return NextResponse.json({ error: 'Queue item not found' }, { status: 404 });
    }

    const agent = item.agent_name as string;
    const type = item.type as string;

    // Dispatch to the right agent runner based on agent + type
    if (agent === 'showrunner' && type === 'draft') {
      const inputs = extractShowrunnerInputs(item.full_output ?? {});
      if (!inputs) {
        return NextResponse.json(
          {
            error:
              'This item was generated before retry was supported, so the transcript isn\'t stored on it. Your feedback is saved as a permanent rule — re-upload the transcript in the Run Showrunner box and the new run will apply your feedback automatically.',
          },
          { status: 400 },
        );
      }
      const result = await runShowrunner({ ...inputs, trigger: 'manual' });
      // Stamp the new item as a retry_of for traceability without clobbering
      // the full_output buildDeposit already wrote.
      const { data: newItem } = await supabaseAdmin()
        .from('approval_queue')
        .select('full_output')
        .eq('id', result.queueId)
        .single();
      await supabaseAdmin()
        .from('approval_queue')
        .update({
          full_output: { ...(newItem?.full_output ?? {}), retry_of_id: id },
        })
        .eq('id', result.queueId);
      return NextResponse.json({
        ok: true,
        newQueueId: result.queueId,
        title: `Showrunner — ${result.parsed.episodeTitle || 'Episode Content Package'}`,
      });
    }

    if (agent === 'ops_chief' && type === 'briefing') {
      const result = await runOpsChiefDailyBriefing('manual');
      return NextResponse.json({
        ok: true,
        newQueueId: result.queueId,
        title: `Daily Briefing`,
      });
    }

    if (agent === 'ops_chief' && type === 'recommendation') {
      const result = await runWeeklyPlanner('manual');
      return NextResponse.json({
        ok: true,
        newQueueId: result.queueId,
        title: `Weekly Plan`,
      });
    }

    return NextResponse.json(
      { error: `Retry not supported for agent=${agent} type=${type}` },
      { status: 400 },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Retry failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
