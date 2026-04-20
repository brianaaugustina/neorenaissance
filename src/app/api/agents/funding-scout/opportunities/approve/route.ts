import { NextResponse } from 'next/server';
import {
  approveOpportunityAndDraft,
  type FundingOpportunityScan,
} from '@/lib/agents/funding-scout';
import { supabaseAdmin } from '@/lib/supabase/client';

export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const queueItemId: string | undefined = body?.queueItemId;
    const opportunityId: string | undefined = body?.opportunityId;
    const applicationPrompts:
      | Array<{ label: string; wordCap?: number | null }>
      | undefined = Array.isArray(body?.applicationPrompts)
      ? body.applicationPrompts.filter(
          (p: unknown): p is { label: string; wordCap?: number | null } =>
            !!p && typeof (p as any).label === 'string',
        )
      : undefined;

    if (!queueItemId || !opportunityId) {
      return NextResponse.json(
        { error: 'queueItemId and opportunityId are both required' },
        { status: 400 },
      );
    }

    const db = supabaseAdmin();
    const { data: item, error } = await db
      .from('approval_queue')
      .select('id, full_output, agent_name, agent_output_id')
      .eq('id', queueItemId)
      .single();
    if (error || !item) {
      return NextResponse.json({ error: 'Queue item not found' }, { status: 404 });
    }
    if (item.agent_name !== 'funding-scout') {
      return NextResponse.json(
        { error: 'This endpoint is for funding-scout scans only' },
        { status: 400 },
      );
    }
    if (!item.agent_output_id) {
      return NextResponse.json(
        { error: 'Queue item missing agent_output_id' },
        { status: 400 },
      );
    }

    const scan = (item.full_output ?? {}) as FundingOpportunityScan;
    const opportunity = scan.opportunities?.find((o) => o.opportunity_id === opportunityId);
    if (!opportunity) {
      return NextResponse.json(
        { error: `Opportunity ${opportunityId} not found in scan` },
        { status: 404 },
      );
    }
    if (opportunity.approved) {
      return NextResponse.json(
        { error: 'Opportunity already approved', draftOutputId: opportunity.draft_output_id },
        { status: 409 },
      );
    }
    if (opportunity.skipped) {
      return NextResponse.json(
        { error: 'Opportunity was skipped — cannot approve' },
        { status: 409 },
      );
    }

    const result = await approveOpportunityAndDraft({
      scanQueueItemId: item.id,
      opportunityId,
      applicationPrompts,
    });
    return NextResponse.json({
      ok: true,
      draftOutputId: result.draftOutputId,
      draftQueueId: result.draftQueueId,
      notionRowId: result.notionRowId,
      tokensUsed: result.tokensUsed,
      costEstimate: result.costEstimate,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Gate 1 approval failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
