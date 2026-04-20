import { NextResponse } from 'next/server';
import { replaceOpportunity } from '@/lib/agents/funding-scout';
import { supabaseAdmin } from '@/lib/supabase/client';

export const maxDuration = 300;

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
      .select('id, agent_name, agent_output_id')
      .eq('id', queueItemId)
      .single();
    if (error || !item) {
      return NextResponse.json({ error: 'Queue item not found' }, { status: 404 });
    }
    if (item.agent_name !== 'funding-scout') {
      return NextResponse.json({ error: 'Wrong agent' }, { status: 400 });
    }
    if (!item.agent_output_id) {
      return NextResponse.json({ error: 'Missing agent_output_id' }, { status: 400 });
    }

    const result = await replaceOpportunity({
      scanQueueItemId: queueItemId,
      opportunityId,
      feedback: feedback?.trim() || undefined,
    });
    return NextResponse.json({
      ok: true,
      opportunity: result.opportunity,
      tokensUsed: result.tokensUsed,
      costEstimate: result.costEstimate,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Replace failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
