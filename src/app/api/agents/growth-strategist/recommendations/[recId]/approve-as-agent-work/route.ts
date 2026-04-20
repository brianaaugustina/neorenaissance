import { NextResponse } from 'next/server';
import { approveRecommendationAsAgentWork } from '@/lib/agents/growth-strategist';

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
    const result = await approveRecommendationAsAgentWork({
      queueItemId,
      recId,
      overrideAgent: body?.overrideAgent,
      overrideBrief: body?.overrideBrief,
    });
    return NextResponse.json({
      ok: true,
      targetAgent: result.targetAgent,
      targetQueueId: result.targetQueueId,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Approve as agent work failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
