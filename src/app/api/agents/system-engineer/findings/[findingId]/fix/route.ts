import { NextResponse } from 'next/server';
import { markFindingFix } from '@/lib/agents/system-engineer';

export const maxDuration = 30;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ findingId: string }> },
) {
  try {
    const { findingId } = await params;
    const body = await req.json();
    const queueItemId: string | undefined = body?.queueItemId;
    if (!queueItemId) {
      return NextResponse.json({ error: 'queueItemId required' }, { status: 400 });
    }
    await markFindingFix({ queueItemId, findingId });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Mark fix failed' },
      { status: 500 },
    );
  }
}
