import { NextResponse } from 'next/server';
import {
  runGrowthBriefing,
  type GrowthOutputType,
} from '@/lib/agents/growth-strategist';

export const maxDuration = 300;

const VALID_TYPES: GrowthOutputType[] = [
  'monthly_pulse_check',
  'quarterly_growth_review',
  'channel_recommendation',
  'audience_analysis',
  'cross_venture_synergy',
];

async function handle(req: Request) {
  try {
    let outputType: GrowthOutputType = 'monthly_pulse_check';
    let focus: string | undefined;
    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      if (typeof body?.outputType === 'string' && VALID_TYPES.includes(body.outputType)) {
        outputType = body.outputType;
      }
      if (typeof body?.focus === 'string') focus = body.focus;
    } else {
      const url = new URL(req.url);
      const t = url.searchParams.get('outputType');
      if (t && VALID_TYPES.includes(t as GrowthOutputType)) {
        outputType = t as GrowthOutputType;
      }
      const f = url.searchParams.get('focus');
      if (f) focus = f;
    }

    const result = await runGrowthBriefing({
      outputType,
      focus,
      trigger: 'manual',
    });
    return NextResponse.json({
      ok: true,
      runId: result.runId,
      queueId: result.queueId,
      outputId: result.outputId,
      outputType,
      recommendationsCount: result.briefing.recommendations.length,
      krsRead: result.briefing.source_refs.krs_count,
      hadAnalytics: result.briefing.source_refs.analytics_output_id != null,
      tokensUsed: result.tokensUsed,
      costEstimate: result.costEstimate,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Growth briefing failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  return handle(req);
}
export async function GET(req: Request) {
  return handle(req);
}
