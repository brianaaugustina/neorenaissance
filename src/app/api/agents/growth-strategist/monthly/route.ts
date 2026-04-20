import { NextResponse } from 'next/server';
import { runGrowthBriefing } from '@/lib/agents/growth-strategist';

export const maxDuration = 300;

// Vercel Cron fires this at 17:00 UTC on the 1st (10am PT), which lands AFTER
// Analytics & Reporting's 9am PT run so Growth Strategist always reads the
// freshest monthly analytics report.
async function handle() {
  try {
    const result = await runGrowthBriefing({
      outputType: 'monthly_pulse_check',
      trigger: 'cron',
    });
    return NextResponse.json({
      ok: true,
      runId: result.runId,
      outputId: result.outputId,
      recommendationsCount: result.briefing.recommendations.length,
      hadAnalytics: result.briefing.source_refs.analytics_output_id != null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Monthly pulse check failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET() {
  return handle();
}
export async function POST() {
  return handle();
}
