import { NextResponse } from 'next/server';
import { rejectDiffProposal } from '@/lib/agents/agent-supervisor';

export const maxDuration = 30;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ proposalId: string }> },
) {
  try {
    const { proposalId } = await params;
    const body = await req.json();
    const queueItemId: string | undefined = body?.queueItemId;
    const reason: string | undefined = body?.reason;
    if (!queueItemId) {
      return NextResponse.json({ error: 'queueItemId required' }, { status: 400 });
    }
    const result = await rejectDiffProposal({
      queueItemId,
      proposalId,
      reason: reason?.trim() || undefined,
    });
    return NextResponse.json({ ok: true, learningId: result.learningId });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Reject failed' },
      { status: 500 },
    );
  }
}
