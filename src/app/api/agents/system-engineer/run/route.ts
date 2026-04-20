import { NextResponse } from 'next/server';
import { runSystemEngineerWeekly } from '@/lib/agents/system-engineer';

export const maxDuration = 600;

async function handle(req: Request) {
  try {
    let focusRepoShortId: 'agent-system' | 'detto' | 'tts' | 'personal-site' | undefined;
    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      const candidate = body?.focusRepoShortId;
      if (
        candidate === 'agent-system' ||
        candidate === 'detto' ||
        candidate === 'tts' ||
        candidate === 'personal-site'
      ) {
        focusRepoShortId = candidate;
      }
    } else {
      const url = new URL(req.url);
      const f = url.searchParams.get('focusRepoShortId');
      if (
        f === 'agent-system' ||
        f === 'detto' ||
        f === 'tts' ||
        f === 'personal-site'
      ) {
        focusRepoShortId = f;
      }
    }

    const result = await runSystemEngineerWeekly({
      trigger: 'manual',
      focusRepoShortId,
    });
    return NextResponse.json({
      ok: true,
      runId: result.runId,
      queueId: result.queueId,
      outputId: result.outputId,
      severity_counts: result.report.severity_counts,
      findings_count: result.report.findings.length,
      configured_repos: result.report.source_refs.configured_repos,
      commits_observed: result.report.source_refs.commits_observed,
      failed_deployments: result.report.source_refs.failed_deployments,
      tokensUsed: result.tokensUsed,
      costEstimate: result.costEstimate,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'System Engineer run failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  return handle(req);
}
export async function GET(req: Request) {
  return handle(req);
}
