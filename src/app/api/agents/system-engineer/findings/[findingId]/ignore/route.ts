import { NextResponse } from 'next/server';
import { markFindingIgnore } from '@/lib/agents/system-engineer';

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
    const result = await markFindingIgnore({ queueItemId, findingId });
    return NextResponse.json({ ok: true, learningId: result.learningId });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Ignore failed' },
      { status: 500 },
    );
  }
}
