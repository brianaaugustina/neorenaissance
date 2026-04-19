import { NextResponse } from 'next/server';
import {
  generateLeadPitch,
  type PressLead,
  type PressResearchBatch,
} from '@/lib/agents/pr-director';
import { supabaseAdmin } from '@/lib/supabase/client';

export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const queueItemId: string | undefined = body?.queueItemId;
    const leadId: string | undefined = body?.leadId;

    if (!queueItemId || !leadId) {
      return NextResponse.json(
        { error: 'queueItemId and leadId are both required' },
        { status: 400 },
      );
    }

    const db = supabaseAdmin();
    const { data: item, error: fetchErr } = await db
      .from('approval_queue')
      .select('id, full_output, agent_name, agent_output_id')
      .eq('id', queueItemId)
      .single();

    if (fetchErr || !item) {
      return NextResponse.json({ error: 'Queue item not found' }, { status: 404 });
    }
    if (item.agent_name !== 'pr-director') {
      return NextResponse.json(
        { error: 'This endpoint is for pr-director research batches only' },
        { status: 400 },
      );
    }
    if (!item.agent_output_id) {
      return NextResponse.json(
        { error: 'Queue item is missing agent_output_id' },
        { status: 400 },
      );
    }

    const batch = (item.full_output ?? {}) as PressResearchBatch;
    const leads: PressLead[] = Array.isArray(batch.leads) ? batch.leads : [];
    const lead = leads.find((l) => l.lead_id === leadId);
    if (!lead) {
      return NextResponse.json({ error: `Lead ${leadId} not found in batch` }, { status: 404 });
    }
    if (lead.approved) {
      return NextResponse.json(
        { error: 'Lead already approved', draftOutputId: lead.draft_output_id },
        { status: 409 },
      );
    }

    const result = await generateLeadPitch({
      lead,
      parentBatchOutputId: item.agent_output_id,
      parentQueueItemId: item.id,
    });

    return NextResponse.json({
      ok: true,
      outputId: result.outputId,
      queueId: result.queueId,
      outreachRowId: result.outreachRowId,
      subject: result.draft.subject,
      voiceMode: result.draft.voice_mode,
      tokensUsed: result.tokensUsed,
      costEstimate: result.costEstimate,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Gate 1 approval failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
