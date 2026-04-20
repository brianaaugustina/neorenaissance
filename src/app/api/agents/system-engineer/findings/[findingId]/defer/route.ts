import { NextResponse } from 'next/server';
import { markFindingDefer } from '@/lib/agents/system-engineer';

export const maxDuration = 30;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ findingId: string }> },
) {
  try {
    const { findingId } = await params;
    const body = await req.json();
    const queueItemId: string | undefined = body?.queueItemId;
    const reason: string | undefined = body?.reason;
    if (!queueItemId || !reason?.trim()) {
      return NextResponse.json(
        { error: 'queueItemId and non-empty reason required' },
        { status: 400 },
      );
    }
    const result = await markFindingDefer({
      queueItemId,
      findingId,
      reason: reason.trim(),
    });
    return NextResponse.json({ ok: true, learningId: result.learningId });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Defer failed' },
      { status: 500 },
    );
  }
}
