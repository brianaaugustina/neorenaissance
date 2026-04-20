import { NextResponse } from 'next/server';
import { captureRecommendationFeedback } from '@/lib/agents/growth-strategist';

export const maxDuration = 30;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ recId: string }> },
) {
  try {
    const { recId } = await params;
    const body = await req.json();
    const queueItemId: string | undefined = body?.queueItemId;
    const note: string | undefined = body?.note;
    if (!queueItemId || !note?.trim()) {
      return NextResponse.json(
        { error: 'queueItemId and non-empty note required' },
        { status: 400 },
      );
    }
    await captureRecommendationFeedback({
      queueItemId,
      recId,
      note,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Feedback capture failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
