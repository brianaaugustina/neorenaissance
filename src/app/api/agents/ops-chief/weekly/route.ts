import { NextResponse } from 'next/server';
import { runWeeklyPlanner } from '@/lib/agents/ops-chief-weekly';

export const maxDuration = 120;

export async function POST() {
  try {
    const result = await runWeeklyPlanner('manual');
    return NextResponse.json({
      ok: true,
      runId: result.runId,
      queueId: result.queueId,
      rescheduleCount: result.parsed.reschedules.length,
      newTaskCount: result.parsed.newTasks.length,
      tokensIn: result.result.inputTokens,
      tokensOut: result.result.outputTokens,
      costEstimate: result.result.costEstimate,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Failed' }, { status: 500 });
  }
}
