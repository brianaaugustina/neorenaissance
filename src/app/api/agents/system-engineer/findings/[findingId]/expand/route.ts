import { NextResponse } from 'next/server';
import { expandFinding } from '@/lib/agents/system-engineer';

export const maxDuration = 120;

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
    const expansion = await expandFinding({ queueItemId, findingId });
    return NextResponse.json({ ok: true, expansion });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Expand failed' },
      { status: 500 },
    );
  }
}
