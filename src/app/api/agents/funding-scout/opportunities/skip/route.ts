import { NextResponse } from 'next/server';
import { skipOpportunity } from '@/lib/agents/funding-scout';
import { supabaseAdmin } from '@/lib/supabase/client';

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const queueItemId: string | undefined = body?.queueItemId;
    const opportunityId: string | undefined = body?.opportunityId;
    const feedback: string | undefined = body?.feedback;

    if (!queueItemId || !opportunityId) {
      return NextResponse.json(
        { error: 'queueItemId and opportunityId required' },
        { status: 400 },
      );
    }

    const db = supabaseAdmin();
    const { data: item, error } = await db
      .from('approval_queue')
      .select('id, agent_name')
      .eq('id', queueItemId)
      .single();
    if (error || !item) {
      return NextResponse.json({ error: 'Queue item not found' }, { status: 404 });
    }
    if (item.agent_name !== 'funding-scout') {
      return NextResponse.json({ error: 'Wrong agent' }, { status: 400 });
    }

    await skipOpportunity({
      scanQueueItemId: queueItemId,
      opportunityId,
      feedback: feedback?.trim() || undefined,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Skip failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
