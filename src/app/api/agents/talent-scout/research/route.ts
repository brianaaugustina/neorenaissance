import { NextResponse } from 'next/server';
import { runArtisanResearch } from '@/lib/agents/talent-scout';

export const maxDuration = 300;

async function handle(req: Request) {
  try {
    let requestedCount: number | undefined;
    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      if (typeof body?.count === 'number') requestedCount = body.count;
    } else {
      const url = new URL(req.url);
      const n = Number(url.searchParams.get('count'));
      if (Number.isFinite(n) && n > 0) requestedCount = Math.floor(n);
    }
    const result = await runArtisanResearch({
      requestedCount,
      trigger: 'manual',
    });
    return NextResponse.json({
      ok: true,
      runId: result.runId,
      queueId: result.queueId,
      outputId: result.outputId,
      reviewed: result.batch.total_reviewed,
      surfaced: result.batch.surfaced_count,
      contactsWritten: result.contactsWritten,
      webSearches: result.webSearches,
      tokensUsed: result.tokensUsed,
      costEstimate: result.costEstimate,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Artisan research failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  return handle(req);
}
export async function GET(req: Request) {
  return handle(req);
}
