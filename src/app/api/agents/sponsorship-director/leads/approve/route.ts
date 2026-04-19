import { NextResponse } from 'next/server';
import {
  generateLeadPitch,
  type ResearchBatch,
  type ResearchLead,
} from '@/lib/agents/sponsorship-director';
import { supabaseAdmin } from '@/lib/supabase/client';

// Gate 1 approval: Briana clicks a per-lead Approve button on a research_batch
// queue item. We look up the lead inside the batch, fire the pitch generator,
// and return the new queue item id (or an error so the dashboard can surface it).
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
    if (item.agent_name !== 'sponsorship-director') {
      return NextResponse.json(
        { error: 'This endpoint is for sponsorship-director research batches only' },
        { status: 400 },
      );
    }
    if (!item.agent_output_id) {
      return NextResponse.json(
        { error: 'Queue item is missing agent_output_id — batch cannot be linked' },
        { status: 400 },
      );
    }

    const batch = (item.full_output ?? {}) as ResearchBatch;
    const leads: ResearchLead[] = Array.isArray(batch.leads) ? batch.leads : [];
    const lead = leads.find((l) => l.lead_id === leadId);
    if (!lead) {
      return NextResponse.json(
        { error: `Lead ${leadId} not found in batch` },
        { status: 404 },
      );
    }
    if (lead.approved) {
      return NextResponse.json(
        { error: 'Lead already approved — draft exists', draftOutputId: lead.draft_output_id },
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
      tokensUsed: result.tokensUsed,
      costEstimate: result.costEstimate,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Gate 1 approval failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
