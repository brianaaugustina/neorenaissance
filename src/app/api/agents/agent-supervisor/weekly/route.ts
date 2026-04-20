import { NextResponse } from 'next/server';
import { runSupervisorReport } from '@/lib/agents/agent-supervisor';

// Vercel cron: Sun 13:00 UTC = Sun 6am PT
export const maxDuration = 300;

async function handle() {
  try {
    const result = await runSupervisorReport({ trigger: 'cron' });
    return NextResponse.json({
      ok: true,
      runId: result.runId,
      outputId: result.outputId,
      diffs: result.report.diff_proposals.length,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Weekly supervisor run failed' },
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
