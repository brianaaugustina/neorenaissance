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
import { supabaseAdmin } from '@/lib/supabase/client';

export const maxDuration = 300;

// Retry a rejected queue item by re-running the agent that produced it.
// Feedback is picked up automatically via getRecentFeedback (14-day window).
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

    if (agent === 'showrunner' && type === 'draft') {
      const fullOutput = (item.full_output ?? {}) as Record<string, unknown>;
      const kind = getShowrunnerOutputKind(fullOutput);

      const dispatchSubstack = async () => {
        const inputs = extractSubstackInputs(fullOutput);
        if (!inputs) return null;
        const r = await runShowrunnerSubstackPost({ ...inputs, trigger: 'manual' });
        return { queueId: r.queueId, title: `Showrunner — ${r.parsed.substackTitle || 'Substack post'}` };
      };
      const dispatchMetadata = async () => {
        const inputs = extractMetadataInputs(fullOutput);
        if (!inputs) return null;
        const r = await runShowrunnerEpisodeMetadata({ ...inputs, trigger: 'manual' });
        return { queueId: r.queueId, title: `Showrunner — ${r.parsed.youtubeTitle || 'Episode metadata'}` };
      };
      const dispatchCaptions = async () => {
        const inputs = extractCaptionsInputs(fullOutput);
        if (!inputs) return null;
        const r = await runShowrunnerSocialCaptions({ ...inputs, trigger: 'manual' });
        return { queueId: r.queueId, title: `Showrunner — Social captions (${r.parsed.clipCaptions.length})` };
      };

      let dispatched: { queueId: string; title: string } | null = null;
      if (kind === 'substack_post') dispatched = await dispatchSubstack();
      else if (kind === 'episode_metadata') dispatched = await dispatchMetadata();
      else if (kind === 'social_captions') dispatched = await dispatchCaptions();
      else if (kind === 'legacy') {
        return NextResponse.json(
          {
            error:
              'This item was produced by the old combined Showrunner run. Re-run via the Substack / Titles / Captions tabs directly.',
          },
          { status: 400 },
        );
      }

      if (!dispatched) {
        return NextResponse.json(
          {
            error:
              "This item's inputs weren't stored on it. Re-run via the Showrunner tabs directly with the same inputs.",
          },
          { status: 400 },
        );
      }

      const { data: newItem } = await supabaseAdmin()
        .from('approval_queue')
        .select('full_output')
        .eq('id', dispatched.queueId)
        .single();
      await supabaseAdmin()
        .from('approval_queue')
        .update({
          full_output: { ...(newItem?.full_output ?? {}), retry_of_id: id },
        })
        .eq('id', dispatched.queueId);
      return NextResponse.json({
        ok: true,
        newQueueId: dispatched.queueId,
        title: dispatched.title,
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
