import { NextResponse } from 'next/server';
import {
  runSupervisorReport,
  type SupervisorOutputType,
} from '@/lib/agents/agent-supervisor';

export const maxDuration = 300;

async function handle(req: Request) {
  try {
    let outputType: SupervisorOutputType = 'weekly_supervisor_report';
    let focusAgentId: string | undefined;
    let currentWindowDays: number | undefined;
    let trailingWindowDays: number | undefined;

    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      if (body?.outputType === 'agent_deep_dive') outputType = 'agent_deep_dive';
      if (typeof body?.focusAgentId === 'string') focusAgentId = body.focusAgentId;
      if (typeof body?.currentWindowDays === 'number')
        currentWindowDays = body.currentWindowDays;
      if (typeof body?.trailingWindowDays === 'number')
        trailingWindowDays = body.trailingWindowDays;
    } else {
      const url = new URL(req.url);
      const t = url.searchParams.get('outputType');
      if (t === 'agent_deep_dive') outputType = 'agent_deep_dive';
      const f = url.searchParams.get('focusAgentId');
      if (f) focusAgentId = f;
    }

    if (outputType === 'agent_deep_dive' && !focusAgentId) {
      return NextResponse.json(
        { error: 'agent_deep_dive requires focusAgentId' },
        { status: 400 },
      );
    }

    const result = await runSupervisorReport({
      trigger: 'manual',
      outputType,
      focusAgentId,
      currentWindowDays,
      trailingWindowDays,
    });

    return NextResponse.json({
      ok: true,
      runId: result.runId,
      queueId: result.queueId,
      outputId: result.outputId,
      outputType,
      perAgentObservationsCount: result.report.per_agent_observations.length,
      diffProposalsCount: result.report.diff_proposals.length,
      preferencePromotionsCount: result.report.preference_promotions.length,
      retrospectiveCheckinsCount: result.report.retrospective_checkins.length,
      underSampledAgents: result.report.under_sampled_agents,
      tokensUsed: result.tokensUsed,
      costEstimate: result.costEstimate,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Supervisor run failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  return handle(req);
}
export async function GET(req: Request) {
  return handle(req);
}
