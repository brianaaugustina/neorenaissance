import { NextResponse } from 'next/server';
import { runPressResearch } from '@/lib/agents/pr-director';

export const maxDuration = 300;

async function handle() {
  try {
    const result = await runPressResearch('cron');
    return NextResponse.json({
      ok: true,
      runId: result.runId,
      queueId: result.queueId,
      outputId: result.outputId,
      reviewed: result.batch.total_reviewed,
      surfaced: result.batch.surfaced_count,
      landscapeDate: result.batch.landscape_briefing_date,
      tokensUsed: result.tokensUsed,
      costEstimate: result.costEstimate,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Press research failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST() {
  return handle();
}

export async function GET() {
  return handle();
}
