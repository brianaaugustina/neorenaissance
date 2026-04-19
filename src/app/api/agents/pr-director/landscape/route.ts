import { NextResponse } from 'next/server';
import { runEditorialLandscapeBriefing } from '@/lib/agents/pr-director';

export const maxDuration = 300;

async function handle() {
  try {
    const result = await runEditorialLandscapeBriefing('cron');
    return NextResponse.json({
      ok: true,
      runId: result.runId,
      outputId: result.outputId,
      monthLabel: result.briefing.month_label,
      tokensUsed: result.tokensUsed,
      costEstimate: result.costEstimate,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Landscape briefing failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST() {
  return handle();
}

export async function GET() {
  return handle();
}
