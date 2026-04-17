import { NextResponse } from 'next/server';
import { runShowrunnerDailyCheck } from '@/lib/agents/showrunner-daily';

export const maxDuration = 60;

export async function POST() {
  try {
    const result = await runShowrunnerDailyCheck('manual');
    return NextResponse.json({
      ok: true,
      runId: result.runId,
      queueId: result.queueId,
      itemCount: result.itemCount,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Failed' }, { status: 500 });
  }
}
