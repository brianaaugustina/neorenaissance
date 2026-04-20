import { NextResponse } from 'next/server';
import { approveRecommendationAsTask } from '@/lib/agents/growth-strategist';

export const maxDuration = 60;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ recId: string }> },
) {
  try {
    const { recId } = await params;
    const body = await req.json();
    const queueItemId: string | undefined = body?.queueItemId;
    if (!queueItemId) {
      return NextResponse.json(
        { error: 'queueItemId required' },
        { status: 400 },
      );
    }
    const result = await approveRecommendationAsTask({
      queueItemId,
      recId,
      initiativeId: body?.initiativeId,
      outcomeId: body?.outcomeId,
    });
    return NextResponse.json({ ok: true, taskId: result.taskId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Approve as task failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
