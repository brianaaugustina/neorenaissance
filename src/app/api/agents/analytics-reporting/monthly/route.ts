import { NextResponse } from 'next/server';
import { runAnalyticsMonthlyReport } from '@/lib/agents/analytics-reporting';

// Vercel Cron fires this at 16:00 UTC on the 1st of each month (9am PT).
// Period defaults to previous calendar month inside runAnalyticsMonthlyReport.
export const maxDuration = 300;

async function handle() {
  try {
    const result = await runAnalyticsMonthlyReport({ trigger: 'cron' });
    return NextResponse.json({
      ok: true,
      runId: result.runId,
      outputId: result.outputId,
      period: result.report.period,
      platforms_configured: Object.keys(result.report.platforms),
      platforms_not_configured: result.report.not_configured,
      errored: result.report.errored,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Monthly analytics run failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET() {
  return handle();
}
export async function POST() {
  return handle();
}
