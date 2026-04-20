import { NextResponse } from 'next/server';
import {
  approvePreferencePromotion,
  rejectPreferencePromotion,
} from '@/lib/agents/agent-supervisor';

export const maxDuration = 30;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ promotionId: string }> },
) {
  try {
    const { promotionId } = await params;
    const body = await req.json();
    const queueItemId: string | undefined = body?.queueItemId;
    const action: string = body?.action ?? 'approve';
    const reason: string | undefined = body?.reason;
    if (!queueItemId) {
      return NextResponse.json({ error: 'queueItemId required' }, { status: 400 });
    }
    if (action === 'reject') {
      await rejectPreferencePromotion({ queueItemId, promotionId, reason });
      return NextResponse.json({ ok: true });
    }
    const result = await approvePreferencePromotion({ queueItemId, promotionId });
    return NextResponse.json({ ok: true, agentName: result.agentName });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Preference promotion failed' },
      { status: 500 },
    );
  }
}
