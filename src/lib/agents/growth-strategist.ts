// Growth Strategist agent — reads Analytics & Reporting's latest report,
// Notion KRs, past experiments; produces a briefing of 3–7 strategic
// recommendations each tagged with a routing decision (task / agent work /
// new agent). Each recommendation is actionable independently via the four
// buttons on the queue card.
//
// Read-only briefing — the queue card surfaces the recommendations with
// action buttons; Briana's decisions live in approval_queue.full_output and
// mirror into agent_outputs.draft_content as they happen.

import {
  getApprovedOutputsByType,
  logOutput,
  setApprovalQueueId,
  type ApprovedOutputExample,
} from '../agent-outputs';
import {
  getLatestAnalyticsReport,
  type AnalyticsReport,
} from './analytics-reporting';
import {
  getActiveIntentions,
  getActiveOutcomes,
  type Intention,
  type Outcome,
} from '../notion/client';
import {
  depositToQueue,
  getPermanentPreferences,
  getRecentFeedback,
  logRunComplete,
  logRunStart,
  supabaseAdmin,
  type RecentFeedbackItem,
} from '../supabase/client';
import { todayIsoPT } from '../time';
import { loadContextFile, think } from './base';

const AGENT_NAME = 'growth-strategist';
const MODEL = process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-5';

// ============================================================================
// Output types
// ============================================================================

export type GrowthOutputType =
  | 'monthly_pulse_check'
  | 'quarterly_growth_review'
  | 'channel_recommendation'
  | 'audience_analysis'
  | 'cross_venture_synergy'
  | 'experiment_proposal'
  | 'experiment_results';

export type RecommendationVenture =
  | 'trades-show'
  | 'corral'
  | 'detto'
  | 'aura'
  | 'artisanship-community'
  | 'cross';

export type RecommendationRouting =
  | {
      type: 'task';
      task_title: string;
      task_description: string;
      suggested_agent?: undefined;
      agent_brief?: undefined;
    }
  | {
      type: 'agent-work';
      suggested_agent:
        | 'showrunner'
        | 'sponsorship-director'
        | 'pr-director'
        | 'talent-scout'
        | 'funding-scout'
        | 'analytics-reporting';
      agent_brief: string;
      task_title?: undefined;
      task_description?: undefined;
    }
  | {
      type: 'new-agent';
      proposed_agent_name: string;
      proposed_agent_purpose: string;
      task_title?: undefined;
      task_description?: undefined;
      suggested_agent?: undefined;
      agent_brief?: undefined;
    };

export interface Recommendation {
  id: string;
  title: string;
  rationale: string;
  confidence: 'high' | 'medium' | 'low';
  venture: RecommendationVenture;
  brand_or_traction: 'brand-building' | 'traction';
  effort: 'low' | 'medium' | 'high';
  expected_impact: string;
  routing: RecommendationRouting;
  kr_reference: string | null;
  // Mutated as Briana acts:
  // - action_taken = terminal routing (task / agent-work / new-agent). Once
  //   set, the recommendation is considered closed for routing purposes.
  // - feedback = non-terminal context Briana adds ("I already know what caused
  //   this"). Lives independently from action_taken — she can provide both or
  //   either. Next Growth Strategist run reads this as signal to refine /
  //   drop / reframe the recommendation.
  action_taken?: {
    kind: 'task' | 'agent-work' | 'new-agent';
    ref_id: string | null;
    note: string | null;
    taken_at: string;
  } | null;
  feedback?: {
    note: string;
    given_at: string;
  } | null;
}

export interface GrowthBriefing {
  output_type: GrowthOutputType;
  period: { start: string; end: string } | null;
  generated_at: string;
  overall_assessment: string;
  recommendations: Recommendation[];
  // Metadata about what the agent read
  source_refs: {
    analytics_output_id: string | null;
    analytics_period: { start: string; end: string } | null;
    krs_count: number;
    past_experiments_count: number;
  };
}

// ============================================================================
// Context assembly
// ============================================================================

function loadGrowthContextFiles(): string {
  return [
    loadContextFile('system.md'),
    loadContextFile('agents/growth-strategist/system-prompt.md'),
    loadContextFile('agents/growth-strategist/playbook.md'),
    loadContextFile('ventures/trades-show.md'),
    loadContextFile('shared/conflicts.md'),
  ]
    .filter(Boolean)
    .join('\n\n---\n\n');
}

function renderKRs(outcomes: Outcome[], intentions: Intention[]): string {
  if (outcomes.length === 0 && intentions.length === 0) {
    return '(no active KRs / intentions in Notion)';
  }
  const parts: string[] = [];
  if (outcomes.length > 0) {
    parts.push('## Active Key Results');
    for (const o of outcomes) {
      const progress =
        o.current != null && o.target != null
          ? ` [${o.current}/${o.target}]`
          : '';
      const season = o.season ? ` · ${o.season}` : '';
      parts.push(`- **${o.name}**${progress} — ${o.status ?? 'no status'}${season}`);
    }
  }
  if (intentions.length > 0) {
    parts.push('\n## Active Intentions');
    for (const i of intentions) {
      const deadline = i.deadline ? ` · due ${i.deadline}` : '';
      parts.push(`- **${i.name}** — ${i.status ?? 'no status'}${deadline}`);
    }
  }
  return parts.join('\n');
}

interface PastRecommendationFeedback {
  briefing_output_id: string;
  briefing_created_at: string;
  output_type: string;
  rec_title: string;
  rec_rationale: string;
  feedback_note: string;
  feedback_given_at: string;
}

// Pull recommendation-level feedback from prior briefings. Currently scans the
// last 20 briefings of any type. Returns one row per fed-back recommendation,
// newest first, capped at `limit`.
async function getRecentRecommendationFeedback(params: {
  limit?: number;
}): Promise<PastRecommendationFeedback[]> {
  const limit = params.limit ?? 30;
  const { data, error } = await supabaseAdmin()
    .from('agent_outputs')
    .select('id, created_at, output_type, draft_content')
    .eq('agent_id', 'growth-strategist')
    .in('output_type', [
      'monthly_pulse_check',
      'quarterly_growth_review',
      'channel_recommendation',
      'audience_analysis',
      'cross_venture_synergy',
    ])
    .order('created_at', { ascending: false })
    .limit(20);
  if (error || !data) return [];

  const rows: PastRecommendationFeedback[] = [];
  for (const briefing of data as Array<{
    id: string;
    created_at: string;
    output_type: string;
    draft_content: GrowthBriefing | null;
  }>) {
    const recs = briefing.draft_content?.recommendations ?? [];
    for (const r of recs) {
      if (r.feedback?.note) {
        rows.push({
          briefing_output_id: briefing.id,
          briefing_created_at: briefing.created_at,
          output_type: briefing.output_type,
          rec_title: r.title,
          rec_rationale: r.rationale,
          feedback_note: r.feedback.note,
          feedback_given_at: r.feedback.given_at,
        });
        if (rows.length >= limit) return rows;
      }
    }
  }
  return rows;
}

function renderPastRecFeedback(rows: PastRecommendationFeedback[]): string {
  if (rows.length === 0) {
    return '(no per-recommendation feedback logged yet — first run)';
  }
  return rows
    .map((r) => {
      const when = r.feedback_given_at.slice(0, 10);
      return `- [${when}] "${r.rec_title}" — Briana: "${r.feedback_note}"`;
    })
    .join('\n');
}

function renderPastExperiments(examples: ApprovedOutputExample[]): string {
  if (examples.length === 0) {
    return '(no past experiment results yet)';
  }
  return examples
    .map((ex, i) => {
      const when = ex.approved_at ? ex.approved_at.slice(0, 10) : 'unknown';
      const tags = ex.tags?.length ? ` [${ex.tags.join(', ')}]` : '';
      const body = ex.final_content
        ? JSON.stringify(ex.final_content).slice(0, 600)
        : '(no final_content)';
      return `### Experiment ${i + 1} — ${when}${tags}\n${body}`;
    })
    .join('\n\n');
}

function renderAnalyticsReport(report: AnalyticsReport | null): string {
  if (!report) {
    return '(no analytics report available — Analytics & Reporting has not run yet, or is not configured)';
  }
  const platformLines: string[] = [];
  for (const [name, data] of Object.entries(report.platforms)) {
    const compact = JSON.stringify(data).slice(0, 1500);
    platformLines.push(`### ${name}\n${compact}`);
  }
  return `## Period: ${report.period.start} → ${report.period.end}

## Cross-platform summary
${report.cross_platform_summary ?? '(no summary)'}

## Notable spikes
${(report.notable_spikes ?? []).length === 0 ? '(none flagged)' : JSON.stringify(report.notable_spikes, null, 2)}

## Platforms pulled
${platformLines.join('\n\n')}

## Not configured
${report.not_configured?.join(', ') ?? '(none)'}

## Errored
${(report.errored ?? []).length === 0 ? '(none)' : JSON.stringify(report.errored)}`;
}

function renderRecentFeedback(items: RecentFeedbackItem[]): string {
  if (!items.length) return '';
  const body = items
    .map((f) => {
      const date = (f.reviewed_at ?? f.created_at).slice(0, 10);
      const fb = f.feedback ? ` — "${f.feedback}"` : '';
      return `- [${f.status.toUpperCase()} ${date}] ${f.type}: "${f.title}"${fb}`;
    })
    .join('\n');
  return `\n\n# RECENT FEEDBACK (last 14 days)\n${body}`;
}

// ============================================================================
// Prompt builders for each output type
// ============================================================================

function outputTypeInstructions(outputType: GrowthOutputType, focus?: string): string {
  switch (outputType) {
    case 'monthly_pulse_check':
      return `# Monthly Pulse Check

Produce a monthly read-only briefing that assembles the most important growth signals of the last month and surfaces 3–7 strategic recommendations.

- Lead with the overall assessment (what is the movement telling us this month?)
- Tie each recommendation to a specific KR when possible
- Distinguish brand-building from traction explicitly on each recommendation
- Flag confidence honestly ("low" when data is thin — don't manufacture certainty)`;

    case 'quarterly_growth_review':
      return `# Quarterly Growth Review

Deeper cross-venture pattern analysis covering the last 3 months. 5–10 recommendations acceptable for this cadence. Priorities:

- What has compounded? (quarterly is the right cadence to see brand-building start paying off)
- What has NOT worked despite multiple attempts? (kill or pivot recommendations)
- Cross-venture synergies — where does one venture's audience feed another?
- Any KRs that need reframing for next quarter`;

    case 'channel_recommendation':
      return `# Channel Recommendation

Per-venture channel-mix analysis. Focus: ${focus ?? '(no specific focus — do an overall sweep)'}

Provide effort-vs-impact framing for each recommendation. Identify:
- Channels worth investing more in (with specific tactics)
- Channels to deprioritize (with honest assessment of why)
- Any channel with enough signal to justify an experiment`;

    case 'audience_analysis':
      return `# Audience Analysis

Demographic and behavioral analysis across platforms. Focus: ${focus ?? '(no specific focus)'}

Where does the platform data show distinct audiences vs. overlapping audiences? What's the right positioning per venture given who's actually engaging?`;

    case 'cross_venture_synergy':
      return `# Cross-Venture Synergy

Identify opportunities to route audience between ventures. Focus: ${focus ?? '(no specific focus)'}

- Where does one venture's audience signal strong fit for another?
- What's a low-lift way to test the synergy (not a full integration)?
- What would it take for Briana to become visibly "multi-project" vs. three silos?`;

    case 'experiment_proposal':
      return `# Experiment Proposal

Design ONE experiment. Output must have exactly one "recommendation" item whose structure represents the experiment:
- title = experiment name
- rationale = hypothesis statement
- expected_impact = success metric
- confidence = expected confidence after the run
- effort = setup effort
- routing = how the experiment will be executed (task / agent-work / new-agent)
- overall_assessment = the method + timeline (≥30 days)

Focus: ${focus ?? '(no specific focus)'}`;

    case 'experiment_results':
      return `# Experiment Results

Retrospective on an experiment that ran. Focus: ${focus ?? ''}
- What happened (actual numbers vs. hypothesis)
- What we learned
- What comes next (kill, continue, scale, or pivot)`;
  }
}

const BRIEFING_SYSTEM_INSTRUCTIONS = `
You are Growth Strategist — analytical, warm, data-driven but honest about
uncertainty. You do NOT recommend vanity metrics. You recommend movement that
supports the mission.

# Output format (strict JSON, no commentary)

Wrap in these markers:

<!-- BEGIN_BRIEFING -->
{
  "overall_assessment": "2-4 paragraph narrative. Start with the most important signal from the analytics data. Be specific with numbers. Don't editorialize.",
  "recommendations": [
    {
      "id": "rec_0",
      "title": "Short imperative — what to do",
      "rationale": "Why. Tie to data + KRs. 1-3 sentences.",
      "confidence": "high" | "medium" | "low",
      "venture": "trades-show" | "corral" | "detto" | "aura" | "artisanship-community" | "cross",
      "brand_or_traction": "brand-building" | "traction",
      "effort": "low" | "medium" | "high",
      "expected_impact": "What changes if this works. Quantify when possible.",
      "kr_reference": "Name of the KR this supports, or null",
      "routing": {
        "type": "task" | "agent-work" | "new-agent",
        "task_title": "string (if type=task)",
        "task_description": "string (if type=task) — include enough context that Briana can do it without re-reading the briefing",
        "suggested_agent": "showrunner | sponsorship-director | pr-director | talent-scout | funding-scout | analytics-reporting (if type=agent-work)",
        "agent_brief": "Free-form description of work the target agent should do (if type=agent-work) — write it like a spec another human could execute",
        "proposed_agent_name": "string (if type=new-agent)",
        "proposed_agent_purpose": "string (if type=new-agent) — 2-3 sentence description of why a new agent is needed and what it would do"
      }
    }
  ]
}
<!-- END_BRIEFING -->

# Rules
- IDs are sequential: rec_0, rec_1, rec_2, ...
- For each recommendation choose ONE routing type — don't populate fields for others.
- "task" = Briana executes herself, one-shot action. Use for simple, short work.
- "agent-work" = route to an existing agent's queue. Use when the work maps to an agent's function. Include a brief the target agent can execute.
- "new-agent" = propose building a new agent. Use sparingly — only when no existing agent fits AND the work is recurring enough to justify.
- Prefer brand-building over traction when data is thin — brand compounds.
- Don't recommend paid ads unless the data clearly supports it AND organic isn't working.
- Flag low-confidence recommendations explicitly rather than padding with vague certainty.
- Recommendations must be SPECIFIC (channel, tactic, metric, timeline) — never "grow social media."

Return ONLY the wrapped JSON.
`.trim();

// ============================================================================
// Main entrypoint
// ============================================================================

export interface RunGrowthBriefingParams {
  outputType: GrowthOutputType;
  trigger?: 'cron' | 'manual';
  /** Optional focus area for on-demand runs (e.g., "Detto", "YouTube"). */
  focus?: string;
}

export interface RunGrowthBriefingResult {
  runId: string;
  queueId: string;
  outputId: string;
  briefing: GrowthBriefing;
  tokensUsed: number;
  costEstimate: number;
}

export async function runGrowthBriefing(
  params: RunGrowthBriefingParams,
): Promise<RunGrowthBriefingResult> {
  const trigger = params.trigger ?? 'manual';
  const run = await logRunStart(AGENT_NAME, trigger);

  try {
    const [
      permanentPreferences,
      recentFeedback,
      pastExperiments,
      pastRecFeedback,
      analyticsReport,
      outcomes,
      intentions,
    ] = await Promise.all([
      getPermanentPreferences(AGENT_NAME).catch(() => [] as string[]),
      getRecentFeedback(AGENT_NAME, 24 * 14, ['report']).catch(
        () => [] as RecentFeedbackItem[],
      ),
      getApprovedOutputsByType({
        agentId: 'growth-strategist',
        venture: 'cross',
        outputType: 'experiment_results',
        limit: 10,
        requireFinalContent: true,
      }).catch(() => [] as ApprovedOutputExample[]),
      getRecentRecommendationFeedback({ limit: 30 }).catch(
        () => [] as PastRecommendationFeedback[],
      ),
      getLatestAnalyticsReport().catch(() => null),
      getActiveOutcomes().catch(() => [] as Outcome[]),
      getActiveIntentions().catch(() => [] as Intention[]),
    ]);

    const memoryBlock = permanentPreferences.length
      ? '\n\n# Permanent preferences (apply every run)\n' +
        permanentPreferences.map((r) => `- ${r}`).join('\n')
      : '';

    const system =
      loadGrowthContextFiles() +
      memoryBlock +
      renderRecentFeedback(recentFeedback) +
      '\n\n---\n\n' +
      BRIEFING_SYSTEM_INSTRUCTIONS +
      '\n\n---\n\n' +
      outputTypeInstructions(params.outputType, params.focus);

    const user = `Today is ${todayIsoPT()}.

# ANALYTICS REPORT (most recent from Analytics & Reporting agent)
${renderAnalyticsReport(analyticsReport?.report ?? null)}

# NOTION — ACTIVE KRs / INTENTIONS
${renderKRs(outcomes, intentions)}

# PAST EXPERIMENTS
${renderPastExperiments(pastExperiments)}

# BRIANA'S FEEDBACK ON PAST RECOMMENDATIONS
Use this to refine or drop this round's recommendations. If she already told us
the answer to a question a prior recommendation raised, do NOT re-surface the
same recommendation — either acknowledge her answer and drop it, or advance
the thread with a follow-up grounded in her context.
${renderPastRecFeedback(pastRecFeedback)}

${params.focus ? `\n# FOCUS\n${params.focus}` : ''}

Produce the briefing JSON wrapped between BEGIN_BRIEFING / END_BRIEFING markers.`;

    const result = await think({
      systemPrompt: system,
      userPrompt: user,
      maxTokens: 8000,
    });

    const parsed = parseBriefingJson(result.text);

    const briefing: GrowthBriefing = {
      output_type: params.outputType,
      period: analyticsReport?.report?.period
        ? {
            start: analyticsReport.report.period.start,
            end: analyticsReport.report.period.end,
          }
        : null,
      generated_at: new Date().toISOString(),
      overall_assessment: parsed.overall_assessment,
      recommendations: parsed.recommendations.map((r, i) => ({
        ...r,
        id: r.id || `rec_${i}`,
        action_taken: null,
        feedback: null,
      })),
      source_refs: {
        analytics_output_id: analyticsReport?.outputId ?? null,
        analytics_period: analyticsReport?.report?.period
          ? {
              start: analyticsReport.report.period.start,
              end: analyticsReport.report.period.end,
            }
          : null,
        krs_count: outcomes.length + intentions.length,
        past_experiments_count: pastExperiments.length,
      },
    };

    const summary =
      briefing.recommendations.length > 0
        ? `${briefing.recommendations.length} recommendation${briefing.recommendations.length === 1 ? '' : 's'} · ${briefing.source_refs.krs_count} KRs read${analyticsReport ? ' · fresh analytics' : ' · no analytics data'}`
        : 'No recommendations surfaced — insufficient signal';

    const outputId = await logOutput({
      agentId: 'growth-strategist',
      venture: 'cross',
      outputType: params.outputType,
      runId: run.id,
      draftContent: briefing as unknown as Record<string, unknown>,
      tags: [
        params.outputType,
        todayIsoPT(),
        ...(params.focus ? [`focus:${params.focus.toLowerCase().slice(0, 30)}`] : []),
      ],
    });

    const queueId = await depositToQueue({
      agent_name: AGENT_NAME,
      type: 'report',
      title: titleFor(params.outputType, briefing, params.focus),
      summary,
      full_output: briefing as unknown as Record<string, unknown>,
      initiative: 'Cross-venture',
      run_id: run.id,
      agent_output_id: outputId,
    });
    await setApprovalQueueId(outputId, queueId);

    await logRunComplete({
      runId: run.id,
      startedAt: run.started_at,
      status: 'success',
      tokensUsed: result.inputTokens + result.outputTokens,
      model: MODEL,
      contextSummary: `output_type=${params.outputType} recs=${briefing.recommendations.length} krs=${briefing.source_refs.krs_count} analytics=${!!analyticsReport}`,
      outputSummary: summary,
      approvalQueueId: queueId,
      costEstimate: Number(result.costEstimate.toFixed(4)),
    });

    return {
      runId: run.id,
      queueId,
      outputId,
      briefing,
      tokensUsed: result.inputTokens + result.outputTokens,
      costEstimate: result.costEstimate,
    };
  } catch (e: any) {
    await logRunComplete({
      runId: run.id,
      startedAt: run.started_at,
      status: 'error',
      model: MODEL,
      error: e?.message ?? String(e),
    });
    throw e;
  }
}

function titleFor(
  outputType: GrowthOutputType,
  briefing: GrowthBriefing,
  focus?: string,
): string {
  const base = (() => {
    switch (outputType) {
      case 'monthly_pulse_check':
        return 'Monthly pulse check';
      case 'quarterly_growth_review':
        return 'Quarterly growth review';
      case 'channel_recommendation':
        return 'Channel recommendation';
      case 'audience_analysis':
        return 'Audience analysis';
      case 'cross_venture_synergy':
        return 'Cross-venture synergy';
      case 'experiment_proposal':
        return 'Experiment proposal';
      case 'experiment_results':
        return 'Experiment results';
    }
  })();
  const period =
    briefing.period ? ` · ${briefing.period.start} → ${briefing.period.end}` : '';
  const focusSuffix = focus ? ` · focus: ${focus}` : '';
  return `${base}${period}${focusSuffix}`;
}

function parseBriefingJson(text: string): {
  overall_assessment: string;
  recommendations: Recommendation[];
} {
  const start = text.indexOf('<!-- BEGIN_BRIEFING -->');
  const end = text.indexOf('<!-- END_BRIEFING -->');
  const body =
    start >= 0 && end >= 0
      ? text.slice(start + '<!-- BEGIN_BRIEFING -->'.length, end).trim()
      : text;
  try {
    const jsonStart = body.indexOf('{');
    const jsonEnd = body.lastIndexOf('}');
    if (jsonStart < 0 || jsonEnd <= jsonStart) {
      return { overall_assessment: body.trim(), recommendations: [] };
    }
    const parsed = JSON.parse(body.slice(jsonStart, jsonEnd + 1)) as {
      overall_assessment?: string;
      recommendations?: Recommendation[];
    };
    return {
      overall_assessment: parsed.overall_assessment ?? '',
      recommendations: Array.isArray(parsed.recommendations)
        ? parsed.recommendations
        : [],
    };
  } catch (e) {
    console.error('[growth-strategist] briefing parse failed:', e);
    return { overall_assessment: body.trim(), recommendations: [] };
  }
}

// ============================================================================
// Per-recommendation actions — called from the queue card buttons
// ============================================================================

interface QueueItemWithBriefing {
  id: string;
  agent_output_id: string | null;
  full_output: GrowthBriefing;
}

async function loadBriefingFromQueue(
  queueItemId: string,
): Promise<QueueItemWithBriefing> {
  const { data, error } = await supabaseAdmin()
    .from('approval_queue')
    .select('id, agent_name, agent_output_id, full_output')
    .eq('id', queueItemId)
    .single();
  if (error || !data) throw new Error('Queue item not found');
  if (data.agent_name !== 'growth-strategist') {
    throw new Error('Not a growth-strategist briefing');
  }
  return {
    id: data.id as string,
    agent_output_id: (data.agent_output_id as string | null) ?? null,
    full_output: (data.full_output ?? {}) as GrowthBriefing,
  };
}

async function markRecommendationActed(params: {
  queueItemId: string;
  agentOutputId: string | null;
  recId: string;
  action: Recommendation['action_taken'];
}): Promise<void> {
  const db = supabaseAdmin();
  const { data: item } = await db
    .from('approval_queue')
    .select('full_output')
    .eq('id', params.queueItemId)
    .single();
  if (!item) return;
  const briefing = (item.full_output ?? {}) as GrowthBriefing;
  const recs = Array.isArray(briefing.recommendations) ? briefing.recommendations : [];
  const updated = recs.map((r) =>
    r.id === params.recId ? { ...r, action_taken: params.action } : r,
  );
  const nextBriefing = { ...briefing, recommendations: updated };
  await db
    .from('approval_queue')
    .update({ full_output: nextBriefing as unknown as Record<string, unknown> })
    .eq('id', params.queueItemId);
  if (params.agentOutputId) {
    await db
      .from('agent_outputs')
      .update({ draft_content: nextBriefing as unknown as Record<string, unknown> })
      .eq('id', params.agentOutputId);
  }
}

export interface ApproveAsTaskParams {
  queueItemId: string;
  recId: string;
  initiativeId?: string;
  outcomeId?: string;
}

export async function approveRecommendationAsTask(
  params: ApproveAsTaskParams,
): Promise<{ taskId: string }> {
  const item = await loadBriefingFromQueue(params.queueItemId);
  const rec = item.full_output.recommendations?.find((r) => r.id === params.recId);
  if (!rec) throw new Error(`Recommendation ${params.recId} not found`);
  if (rec.action_taken) {
    throw new Error('Recommendation already acted on');
  }

  const { createTask } = await import('../notion/client');
  const title = rec.routing.type === 'task' ? rec.routing.task_title : rec.title;
  const description =
    rec.routing.type === 'task'
      ? rec.routing.task_description
      : `${rec.rationale}\n\nExpected impact: ${rec.expected_impact}`;

  const taskId = await createTask({
    title: title ?? rec.title,
    type: 'Task',
    source: 'Claude',
    initiativeId: params.initiativeId,
    outcomeId: params.outcomeId,
  });

  // Notion tasks support body content but our current createTask helper only
  // writes properties. Description is attached via a comment in the task body
  // would require an extra API call; for now the title carries the intent and
  // Briana can expand via the queue card's detail view.
  void description;

  await markRecommendationActed({
    queueItemId: params.queueItemId,
    agentOutputId: item.agent_output_id,
    recId: params.recId,
    action: {
      kind: 'task',
      ref_id: taskId,
      note: null,
      taken_at: new Date().toISOString(),
    },
  });

  return { taskId };
}

export interface ApproveAsAgentWorkParams {
  queueItemId: string;
  recId: string;
  overrideAgent?: string;
  overrideBrief?: string;
}

export async function approveRecommendationAsAgentWork(
  params: ApproveAsAgentWorkParams,
): Promise<{ targetAgent: string; targetQueueId: string }> {
  const item = await loadBriefingFromQueue(params.queueItemId);
  const rec = item.full_output.recommendations?.find((r) => r.id === params.recId);
  if (!rec) throw new Error(`Recommendation ${params.recId} not found`);
  if (rec.action_taken) throw new Error('Recommendation already acted on');

  const targetAgent =
    params.overrideAgent ??
    (rec.routing.type === 'agent-work' ? rec.routing.suggested_agent : null);
  if (!targetAgent) {
    throw new Error(
      'Recommendation has no suggested agent. Pass overrideAgent to route manually.',
    );
  }
  const brief =
    params.overrideBrief ??
    (rec.routing.type === 'agent-work' ? rec.routing.agent_brief : rec.rationale);

  // Deposit as a manual task for the target agent. The target agent's queue
  // card renders this as a plain briefing with a "Review" button until that
  // agent has a structured delegation handler (future). For now it's free-form.
  const targetQueueId = await depositToQueue({
    agent_name: targetAgent,
    type: 'recommendation',
    title: `From Growth Strategist — ${rec.title}`,
    summary: rec.expected_impact.slice(0, 160),
    full_output: {
      delegated_from: 'growth-strategist',
      delegated_from_queue_id: params.queueItemId,
      delegated_recommendation_id: params.recId,
      brief,
      rationale: rec.rationale,
      venture: rec.venture,
      expected_impact: rec.expected_impact,
      effort: rec.effort,
      confidence: rec.confidence,
    },
    initiative: 'Cross-venture',
  });

  await markRecommendationActed({
    queueItemId: params.queueItemId,
    agentOutputId: item.agent_output_id,
    recId: params.recId,
    action: {
      kind: 'agent-work',
      ref_id: targetQueueId,
      note: targetAgent,
      taken_at: new Date().toISOString(),
    },
  });

  return { targetAgent, targetQueueId };
}

export interface CaptureFeedbackParams {
  queueItemId: string;
  recId: string;
  note: string;
}

export async function captureRecommendationFeedback(
  params: CaptureFeedbackParams,
): Promise<void> {
  const note = params.note.trim();
  if (!note) throw new Error('feedback note cannot be empty');
  const item = await loadBriefingFromQueue(params.queueItemId);
  const rec = item.full_output.recommendations?.find((r) => r.id === params.recId);
  if (!rec) throw new Error(`Recommendation ${params.recId} not found`);

  const db = supabaseAdmin();
  const briefing = item.full_output;
  const recs = Array.isArray(briefing.recommendations) ? briefing.recommendations : [];
  const updated = recs.map((r) =>
    r.id === params.recId
      ? {
          ...r,
          feedback: { note, given_at: new Date().toISOString() },
        }
      : r,
  );
  const nextBriefing = { ...briefing, recommendations: updated };
  await db
    .from('approval_queue')
    .update({ full_output: nextBriefing as unknown as Record<string, unknown> })
    .eq('id', params.queueItemId);
  if (item.agent_output_id) {
    await db
      .from('agent_outputs')
      .update({ draft_content: nextBriefing as unknown as Record<string, unknown> })
      .eq('id', item.agent_output_id);
  }
}

export interface ApproveAsNewAgentParams {
  queueItemId: string;
  recId: string;
}

export async function approveRecommendationAsNewAgent(
  params: ApproveAsNewAgentParams,
): Promise<{ taskId: string }> {
  const item = await loadBriefingFromQueue(params.queueItemId);
  const rec = item.full_output.recommendations?.find((r) => r.id === params.recId);
  if (!rec) throw new Error(`Recommendation ${params.recId} not found`);
  if (rec.action_taken) throw new Error('Recommendation already acted on');

  const { createTask } = await import('../notion/client');
  const proposedName =
    rec.routing.type === 'new-agent' ? rec.routing.proposed_agent_name : rec.title;
  const taskId = await createTask({
    title: `Design new agent: ${proposedName}`,
    type: 'Task',
    source: 'Claude',
  });

  await markRecommendationActed({
    queueItemId: params.queueItemId,
    agentOutputId: item.agent_output_id,
    recId: params.recId,
    action: {
      kind: 'new-agent',
      ref_id: taskId,
      note: proposedName,
      taken_at: new Date().toISOString(),
    },
  });

  return { taskId };
}
