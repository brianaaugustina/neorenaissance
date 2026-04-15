import { NextResponse } from 'next/server';
import { runOpsChiefDailyBriefing } from '@/lib/agents/ops-chief';

// Day 0/1 manual trigger. Cron wiring lands Day 3.
export const maxDuration = 120;

export async function POST() {
  try {
    const result = await runOpsChiefDailyBriefing('manual');
    return NextResponse.json({
      ok: true,
      runId: result.runId,
      queueId: result.queueId,
      tokensIn: result.result.inputTokens,
      tokensOut: result.result.outputTokens,
      costEstimate: result.result.costEstimate,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Failed' }, { status: 500 });
  }
}
