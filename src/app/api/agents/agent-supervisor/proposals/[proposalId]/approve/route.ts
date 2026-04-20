import { NextResponse } from 'next/server';
import { approveDiffProposal } from '@/lib/agents/agent-supervisor';

export const maxDuration = 30;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ proposalId: string }> },
) {
  try {
    const { proposalId } = await params;
    const body = await req.json();
    const queueItemId: string | undefined = body?.queueItemId;
    if (!queueItemId) {
      return NextResponse.json({ error: 'queueItemId required' }, { status: 400 });
    }
    const result = await approveDiffProposal({ queueItemId, proposalId });
    return NextResponse.json({
      ok: true,
      learningId: result.learningId,
      diffText: result.diffText,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Approve failed' },
      { status: 500 },
    );
  }
}
