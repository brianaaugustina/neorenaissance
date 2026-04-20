import { NextResponse } from 'next/server';
import { runGrowthBriefing } from '@/lib/agents/growth-strategist';

export const maxDuration = 300;

// Vercel Cron fires 15:00 UTC on the 1st of Jan / Apr / Jul / Oct (8am PT).
async function handle() {
  try {
    const result = await runGrowthBriefing({
      outputType: 'quarterly_growth_review',
      trigger: 'cron',
    });
    return NextResponse.json({
      ok: true,
      runId: result.runId,
      outputId: result.outputId,
      recommendationsCount: result.briefing.recommendations.length,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Quarterly review failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET() {
  return handle();
}
export async function POST() {
  return handle();
}
