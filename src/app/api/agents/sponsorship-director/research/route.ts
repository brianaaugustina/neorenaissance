import { NextResponse } from 'next/server';
import { runSponsorshipResearch } from '@/lib/agents/sponsorship-director';

// Allow up to 5 minutes — research batch involves one long Claude call with
// 15-30 candidates reasoned through. Default 10s would truncate.
export const maxDuration = 300;

// Both cron and manual go through POST. Vercel cron fires GET by default, so
// support both methods.
async function handle() {
  try {
    const result = await runSponsorshipResearch(
      // Cron invocations go through POST → we tag as 'cron' when there's no body
      'cron',
    );
    return NextResponse.json({
      ok: true,
      runId: result.runId,
      queueId: result.queueId,
      outputId: result.outputId,
      reviewed: result.batch.total_reviewed,
      surfaced: result.batch.surfaced_count,
      tokensUsed: result.tokensUsed,
      costEstimate: result.costEstimate,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Sponsorship research failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST() {
  return handle();
}

export async function GET() {
  return handle();
}
