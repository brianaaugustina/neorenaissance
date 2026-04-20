import { NextResponse } from 'next/server';
import { runSystemEngineerWeekly } from '@/lib/agents/system-engineer';

// Vercel cron: Sun 03:00 UTC = Sat 8pm PT
export const maxDuration = 600;

async function handle() {
  try {
    const result = await runSystemEngineerWeekly({ trigger: 'cron' });
    return NextResponse.json({
      ok: true,
      runId: result.runId,
      outputId: result.outputId,
      findings: result.report.findings.length,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Weekly run failed' },
      { status: 500 },
    );
  }
}

export async function GET() {
  return handle();
}
export async function POST() {
  return handle();
}
