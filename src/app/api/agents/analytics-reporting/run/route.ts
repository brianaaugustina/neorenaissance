import { NextResponse } from 'next/server';
import { runAnalyticsMonthlyReport } from '@/lib/agents/analytics-reporting';

export const maxDuration = 300;

async function handle(req: Request) {
  try {
    let periodEndDate: string | undefined;
    let periodType: 'daily' | 'weekly' | 'monthly' | undefined;
    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      if (typeof body?.periodEndDate === 'string') periodEndDate = body.periodEndDate;
      if (
        body?.periodType === 'daily' ||
        body?.periodType === 'weekly' ||
        body?.periodType === 'monthly'
      ) {
        periodType = body.periodType;
      }
    } else {
      const url = new URL(req.url);
      const p = url.searchParams.get('periodEndDate');
      if (p) periodEndDate = p;
      const t = url.searchParams.get('periodType');
      if (t === 'daily' || t === 'weekly' || t === 'monthly') periodType = t;
    }

    const result = await runAnalyticsMonthlyReport({
      trigger: 'manual',
      periodEndDate,
      periodType,
    });
    return NextResponse.json({
      ok: true,
      runId: result.runId,
      queueId: result.queueId,
      outputId: result.outputId,
      period: result.report.period,
      platforms_configured: Object.keys(result.report.platforms),
      platforms_not_configured: result.report.not_configured,
      errored: result.report.errored,
      tokensUsed: result.tokensUsed,
      costEstimate: result.costEstimate,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Analytics report failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  return handle(req);
}
export async function GET(req: Request) {
  return handle(req);
}
