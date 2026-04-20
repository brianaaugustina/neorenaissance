import { NextResponse } from 'next/server';
import { runFundingOpportunityScan } from '@/lib/agents/funding-scout';

export const maxDuration = 300;

async function handle(req: Request) {
  try {
    let requestedCount: number | undefined;
    let focusArea: string | undefined;
    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      if (typeof body?.count === 'number') requestedCount = body.count;
      if (typeof body?.focusArea === 'string') focusArea = body.focusArea;
    } else {
      const url = new URL(req.url);
      const n = Number(url.searchParams.get('count'));
      if (Number.isFinite(n) && n > 0) requestedCount = Math.floor(n);
      const f = url.searchParams.get('focusArea');
      if (f) focusArea = f;
    }
    const result = await runFundingOpportunityScan({
      requestedCount,
      focusArea,
      trigger: 'manual',
    });
    return NextResponse.json({
      ok: true,
      runId: result.runId,
      queueId: result.queueId,
      outputId: result.outputId,
      reviewed: result.scan.total_reviewed,
      surfaced: result.scan.surfaced_count,
      webSearches: result.webSearches,
      tokensUsed: result.tokensUsed,
      costEstimate: result.costEstimate,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Funding scan failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  return handle(req);
}
export async function GET(req: Request) {
  return handle(req);
}
