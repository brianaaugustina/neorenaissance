import { NextResponse } from 'next/server';
import {
  replaceLead,
  type ArtisanResearchBatch,
} from '@/lib/agents/talent-scout';
import { supabaseAdmin } from '@/lib/supabase/client';

export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const queueItemId: string | undefined = body?.queueItemId;
    const leadId: string | undefined = body?.leadId;
    const feedback: string | undefined = body?.feedback;
    if (!queueItemId || !leadId) {
      return NextResponse.json(
        { error: 'queueItemId and leadId required' },
        { status: 400 },
      );
    }
    const db = supabaseAdmin();
    const { data: item, error } = await db
      .from('approval_queue')
      .select('id, full_output, agent_name, agent_output_id')
      .eq('id', queueItemId)
      .single();
    if (error || !item) return NextResponse.json({ error: 'Queue item not found' }, { status: 404 });
    if (item.agent_name !== 'talent-scout') {
      return NextResponse.json({ error: 'Wrong agent' }, { status: 400 });
    }
    if (!item.agent_output_id) {
      return NextResponse.json({ error: 'Missing agent_output_id' }, { status: 400 });
    }
    const batch = (item.full_output ?? {}) as ArtisanResearchBatch;
    const result = await replaceLead({
      batch,
      leadId,
      feedback: feedback?.trim() || undefined,
      parentQueueItemId: item.id,
      parentOutputId: item.agent_output_id,
    });
    return NextResponse.json({
      ok: true,
      lead: result.lead,
      tokensUsed: result.tokensUsed,
      costEstimate: result.costEstimate,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Replace failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
