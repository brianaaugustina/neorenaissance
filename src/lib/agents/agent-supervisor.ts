// Agent Supervisor — weekly meta-observer.
//
// Reads agent_outputs / approval_queue / agent_runs / agent_learnings /
// agent_memory across the system (self-excluding itself + System Engineer),
// surfaces approval-rate shifts, recurring rejections, feedback themes, and
// proposes specific context-file diffs for Briana to apply manually.

import {
  logLearning,
  logOutput,
  setApprovalQueueId,
} from '../agent-outputs';
import {
  DEFAULT_EXCLUDE_AGENTS,
  getAgentOutputsForWindow,
  getAgentRunFailures,
  getApprovalStatsByAgent,
  getFirstPassRejectionPatterns,
  getPastSupervisorLearnings,
  getPendingRetrospectives,
  getRecurringFeedbackThemes,
  type ApprovalStatsRow,
  type FirstPassRejectionCluster,
  type PastSupervisorLearning,
  type RecurringFeedbackTheme,
  type SupervisorAgentOutputRow,
} from '../supervisor/retrieval';
import {
  depositToQueue,
  getPermanentPreferences,
  logRunComplete,
  logRunStart,
  setPermanentPreferences,
  supabaseAdmin,
} from '../supabase/client';
import { todayIsoPT } from '../time';
import { loadContextFile, think } from './base';

const AGENT_NAME = 'agent-supervisor';
const MODEL = process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-5';

// ============================================================================
// Output types
// ============================================================================

export type SupervisorOutputType =
  | 'weekly_supervisor_report'
  | 'agent_deep_dive';

export interface DiffProposal {
  id: string;
  agent: string;
  file_path: string;
  section: string;
  current_text: string;
  proposed_text: string;
  hypothesis: string;
  confidence: 'high' | 'medium' | 'low';
  evidence_output_ids: string[];
  reversibility: 'simple' | 'complex';
  action_taken?: {
    kind: 'approved' | 'rejected';
    note: string | null;
    learning_id: string | null;
    taken_at: string;
  } | null;
}

export interface PreferencePromotion {
  id: string;
  agent: string;
  rule_text: string;
  rationale: string;
  occurrence_count: number;
  evidence_output_ids: string[];
  action_taken?: {
    kind: 'approved' | 'rejected';
    note: string | null;
    taken_at: string;
  } | null;
}

export interface PerAgentObservation {
  agent: string;
  approval_rate_this_window: number | null;
  approval_rate_trailing_4w: number | null;
  output_volume: number;
  output_type_mix: Record<string, number>;
  pattern: string | null;
  evidence: string[];
  sample_size: 'high' | 'medium' | 'low' | 'under-sampled';
}

export interface FeedbackImplementationItem {
  feedback_text: string;
  agents: string[];
  absorbed: 'yes' | 'partial' | 'no';
  evidence: string[];
}

export interface RetrospectiveCheckin {
  learning_id: string;
  title: string;
  applied_at: string | null;
  expected_effect: string;
  observed_effect: string;
  verdict: 'worked' | 'partially_worked' | 'did_not_work' | 'too_early';
}

export interface SupervisorReport {
  output_type: SupervisorOutputType;
  period: { start: string; end: string };
  generated_at: string;
  overall_assessment: string;
  per_agent_observations: PerAgentObservation[];
  feedback_implementation_tracking: FeedbackImplementationItem[];
  diff_proposals: DiffProposal[];
  preference_promotions: PreferencePromotion[];
  retrospective_checkins: RetrospectiveCheckin[];
  under_sampled_agents: string[];
  summary: string;
  source_refs: {
    excluded_agents: string[];
    outputs_analyzed: number;
    feedback_items_analyzed: number;
    past_learnings_referenced: number;
  };
}

// ============================================================================
// Context assembly
// ============================================================================

function loadSupervisorContextFiles(): string {
  return [
    loadContextFile('system.md'),
    loadContextFile('agents/agent-supervisor/system-prompt.md'),
    loadContextFile('agents/agent-supervisor/playbook.md'),
  ]
    .filter(Boolean)
    .join('\n\n---\n\n');
}

function renderApprovalStats(
  current: ApprovalStatsRow[],
  trailing: ApprovalStatsRow[],
): string {
  if (current.length === 0) return '(no agent outputs in current window)';
  const trailingMap = new Map(
    trailing.map((t) => [`${t.agent_id}::${t.output_type}`, t]),
  );
  return current
    .map((c) => {
      const key = `${c.agent_id}::${c.output_type}`;
      const t = trailingMap.get(key);
      const currentRate = (c.approval_rate * 100).toFixed(0);
      const trailingRate = t ? (t.approval_rate * 100).toFixed(0) : null;
      const delta =
        t && c.approval_rate !== 0
          ? ` (Δ ${((c.approval_rate - t.approval_rate) * 100).toFixed(0)}pp vs trailing 4w)`
          : '';
      return `- ${c.agent_id} / ${c.output_type}: ${currentRate}% approval [${c.approved}a/${c.edited}e/${c.rejected}r/${c.ignored}i/${c.pending}p, n=${c.total}]${
        trailingRate ? ` · trailing 4w: ${trailingRate}%` : ''
      }${delta}`;
    })
    .join('\n');
}

function renderRejectionClusters(clusters: FirstPassRejectionCluster[]): string {
  if (clusters.length === 0) return '(no rejection clusters meeting threshold)';
  return clusters
    .map((c) => {
      const reasons = c.rejections
        .map((r) =>
          r.rejection_reason ? `"${r.rejection_reason.slice(0, 200)}"` : '(no reason)',
        )
        .join(' · ');
      return `- ${c.agent_id} / ${c.output_type}: ${c.rejections.length} rejections out of ${c.total_runs} runs. Reasons: ${reasons}`;
    })
    .join('\n');
}

function renderFeedbackThemes(themes: RecurringFeedbackTheme[]): string {
  if (themes.length === 0) return '(no recurring feedback themes across agents this window)';
  return themes
    .map(
      (t) =>
        `- "${t.feedback_text.slice(0, 200)}" · appears in ${t.agents.join(', ')} (${t.occurrences}×)`,
    )
    .join('\n');
}

function renderRunFailures(
  failures: Array<{ agent_name: string; failures: number; total: number }>,
): string {
  const flagged = failures.filter((f) => f.failures >= 2);
  if (flagged.length === 0) return '(no agent failed 2+ times in the window)';
  return flagged
    .map(
      (f) => `- ${f.agent_name}: ${f.failures} failures out of ${f.total} runs`,
    )
    .join('\n');
}

function renderPastLearnings(learnings: PastSupervisorLearning[]): string {
  if (learnings.length === 0) return '(no prior diff proposals or retrospectives on record)';
  return learnings
    .map((l) => {
      const applied = l.applied ? ` [APPLIED ${l.applied_at?.slice(0, 10)}]` : '';
      const path = l.context_doc_path ? ` (${l.context_doc_path})` : '';
      return `- [${l.learning_type}] "${l.title}"${applied}${path}: ${l.content.slice(0, 300)}`;
    })
    .join('\n');
}

function renderPendingRetros(retros: PastSupervisorLearning[]): string {
  if (retros.length === 0) return '(no applied diffs have hit their 30-day retrospective date)';
  return retros
    .map(
      (r) =>
        `- [${r.id}] "${r.title}" — applied ${r.applied_at?.slice(0, 10)} (path: ${r.context_doc_path ?? 'unknown'})`,
    )
    .join('\n');
}

function renderOutputsSample(rows: SupervisorAgentOutputRow[], limit = 30): string {
  if (rows.length === 0) return '(no outputs in window)';
  return rows
    .slice(0, limit)
    .map(
      (r) =>
        `- [${r.id}] ${r.agent_id}/${r.output_type} · ${r.approval_status}${
          r.rejection_reason ? ` — "${r.rejection_reason.slice(0, 160)}"` : ''
        }${r.edit_diff ? ' · EDITED' : ''} · ${r.created_at.slice(0, 10)}`,
    )
    .join('\n');
}

// ============================================================================
// Date-window helpers
// ============================================================================

function windowIso(daysBack: number): { startIso: string; endIso: string } {
  const end = new Date();
  const start = new Date(Date.now() - daysBack * 24 * 3600 * 1000);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

// ============================================================================
// Main run — weekly supervisor report
// ============================================================================

const SUPERVISOR_INSTRUCTIONS = `
You are Agent Supervisor. Produce the weekly report per the format in your
playbook §1. Output must be strict JSON wrapped in markers.

# Non-negotiables

- Self-exclusion is ALREADY enforced by the data pipeline. Do NOT include
  yourself (agent-supervisor) or System Engineer in your observations even
  if rows for them somehow leak into context.
- Honest about uncertainty — mark sample sizes as "under-sampled" (<3 outputs)
  or "low" (3-5) or "medium" (5-10) or "high" (10+) per playbook §3.
- Specific, not abstract. Evidence is output IDs + what Briana actually did
  (edited field X, rejected with feedback Y). Not "the tone is off."
- Minimal diff proposals. Edit one sentence, not a whole section. Testable.
  Reversible.
- Never re-propose a diff that appears in the "past supervisor learnings"
  section as previously rejected. If the pattern persists, frame as
  "still observing this — open to a different angle?"

# Output format (strict JSON wrapped in markers)

<!-- BEGIN_REPORT -->
{
  "overall_assessment": "2-4 sentence top-line. Shape of the week.",
  "per_agent_observations": [
    {
      "agent": "string",
      "approval_rate_this_window": number (0-1) or null,
      "approval_rate_trailing_4w": number (0-1) or null,
      "output_volume": number,
      "output_type_mix": { "output_type": count, ... },
      "pattern": "one-sentence pattern you noticed, or null if nothing notable",
      "evidence": ["output IDs or brief quotes, max 4 items"],
      "sample_size": "high" | "medium" | "low" | "under-sampled"
    }
  ],
  "feedback_implementation_tracking": [
    {
      "feedback_text": "Briana's feedback, quoted or paraphrased",
      "agents": ["which agents received it"],
      "absorbed": "yes" | "partial" | "no",
      "evidence": ["output IDs demonstrating absorption or resistance"]
    }
  ],
  "diff_proposals": [
    {
      "id": "prop_0",
      "agent": "which agent's context this modifies",
      "file_path": "context/agents/{agent}/{file}.md",
      "section": "section header name inside the file",
      "current_text": "exact text as it appears in the file (multi-line OK)",
      "proposed_text": "replacement text",
      "hypothesis": "if we make this change, we expect X to improve because Y",
      "confidence": "high" | "medium" | "low",
      "evidence_output_ids": ["output ids used as evidence"],
      "reversibility": "simple" | "complex"
    }
  ],
  "preference_promotions": [
    {
      "id": "promo_0",
      "agent": "target agent",
      "rule_text": "the rule as it will be stored in agent_memory",
      "rationale": "why this recurring feedback should become permanent",
      "occurrence_count": number (>= 3 typically),
      "evidence_output_ids": ["output ids"]
    }
  ],
  "retrospective_checkins": [
    {
      "learning_id": "uuid of the agent_learnings row that just hit 30d",
      "title": "what was applied",
      "applied_at": "ISO date",
      "expected_effect": "what we predicted",
      "observed_effect": "what the 30-day data shows",
      "verdict": "worked" | "partially_worked" | "did_not_work" | "too_early"
    }
  ],
  "under_sampled_agents": ["agents you didn't draw conclusions on because data is thin"],
  "summary": "1-2 sentence close. Single most important thing to approve/apply this week."
}
<!-- END_REPORT -->

Rules:
- IDs are sequential: prop_0, prop_1, ...; promo_0, promo_1, ...
- current_text MUST be exact file content (if you don't have the file open, say so by leaving current_text empty and flagging that the diff needs Briana to locate the section manually).
- diff_proposals and preference_promotions can be empty arrays when there's no signal.
- feedback_implementation_tracking: only include feedback from the last 7 days.

Return ONLY the wrapped JSON.
`.trim();

export interface RunSupervisorParams {
  trigger?: 'cron' | 'manual';
  /** Default 7 days for current window, 30 days for trailing comparison. */
  currentWindowDays?: number;
  trailingWindowDays?: number;
  /** When set, narrows the analysis to a single agent (for agent_deep_dive). */
  focusAgentId?: string;
  /** Switch output type to agent_deep_dive. */
  outputType?: SupervisorOutputType;
}

export interface RunSupervisorResult {
  runId: string;
  queueId: string;
  outputId: string;
  report: SupervisorReport;
  tokensUsed: number;
  costEstimate: number;
}

export async function runSupervisorReport(
  params: RunSupervisorParams = {},
): Promise<RunSupervisorResult> {
  const trigger = params.trigger ?? 'manual';
  const currentWindowDays = params.currentWindowDays ?? 7;
  const trailingWindowDays = params.trailingWindowDays ?? 28;
  const outputType = params.outputType ?? 'weekly_supervisor_report';
  const current = windowIso(currentWindowDays);
  const trailing = windowIso(trailingWindowDays);

  const run = await logRunStart(AGENT_NAME, trigger);
  try {
    const [
      currentOutputs,
      approvalStatsCurrent,
      approvalStatsTrailing,
      rejectionClusters,
      feedbackThemes,
      runFailures,
      pastLearnings,
      pendingRetros,
    ] = await Promise.all([
      getAgentOutputsForWindow({
        startIso: current.startIso,
        endIso: current.endIso,
      }),
      getApprovalStatsByAgent({ startIso: current.startIso, endIso: current.endIso }),
      getApprovalStatsByAgent({
        startIso: trailing.startIso,
        endIso: trailing.endIso,
      }),
      getFirstPassRejectionPatterns({
        startIso: trailing.startIso,
        endIso: trailing.endIso,
        minRunsPerTaskType: 5,
      }),
      getRecurringFeedbackThemes({
        startIso: trailing.startIso,
        endIso: trailing.endIso,
        minAgents: 2,
      }),
      getAgentRunFailures({
        startIso: current.startIso,
        endIso: current.endIso,
      }),
      getPastSupervisorLearnings(30),
      getPendingRetrospectives(),
    ]);

    // Optional agent-focus filter
    const outputsForPrompt = params.focusAgentId
      ? currentOutputs.filter((r) => r.agent_id === params.focusAgentId)
      : currentOutputs;

    const system = loadSupervisorContextFiles() + '\n\n---\n\n' + SUPERVISOR_INSTRUCTIONS;

    const user = `Today is ${todayIsoPT()}.

# CURRENT WINDOW
${current.startIso.slice(0, 10)} → ${current.endIso.slice(0, 10)} (${currentWindowDays} days)
${params.focusAgentId ? `FOCUS AGENT: ${params.focusAgentId}` : ''}

# APPROVAL STATS (current window + trailing ${trailingWindowDays} days for comparison)
${renderApprovalStats(approvalStatsCurrent, approvalStatsTrailing)}

# FIRST-PASS REJECTION CLUSTERS (last ${trailingWindowDays} days, min 5 runs / 3 rejections)
${renderRejectionClusters(rejectionClusters)}

# RECURRING FEEDBACK THEMES ACROSS AGENTS (last ${trailingWindowDays} days, ≥2 agents)
${renderFeedbackThemes(feedbackThemes)}

# AGENT RUN FAILURES (current window, 2+ failures = flag)
${renderRunFailures(runFailures)}

# PAST SUPERVISOR LEARNINGS (so you don't re-propose rejected diffs)
${renderPastLearnings(pastLearnings)}

# APPLIED DIFFS DUE FOR 30-DAY RETROSPECTIVE
${renderPendingRetros(pendingRetros)}

# SAMPLE OF OUTPUTS IN CURRENT WINDOW
${renderOutputsSample(outputsForPrompt, 30)}

# TASK
Produce the ${outputType} JSON wrapped between BEGIN_REPORT / END_REPORT markers.
Self-exclusion is enforced by the pipeline; don't include supervisor or system-engineer entries.`;

    const result = await think({
      systemPrompt: system,
      userPrompt: user,
      maxTokens: 12000,
    });

    const parsed = parseReportJson(result.text);

    const report: SupervisorReport = {
      output_type: outputType,
      period: {
        start: current.startIso.slice(0, 10),
        end: current.endIso.slice(0, 10),
      },
      generated_at: new Date().toISOString(),
      overall_assessment: parsed.overall_assessment ?? '',
      per_agent_observations: (parsed.per_agent_observations ?? []).filter(
        (o) => !DEFAULT_EXCLUDE_AGENTS.includes(o.agent),
      ),
      feedback_implementation_tracking: parsed.feedback_implementation_tracking ?? [],
      diff_proposals: (parsed.diff_proposals ?? []).map((d, i) => ({
        ...d,
        id: d.id || `prop_${i}`,
        action_taken: null,
      })),
      preference_promotions: (parsed.preference_promotions ?? []).map((p, i) => ({
        ...p,
        id: p.id || `promo_${i}`,
        action_taken: null,
      })),
      retrospective_checkins: parsed.retrospective_checkins ?? [],
      under_sampled_agents: parsed.under_sampled_agents ?? [],
      summary: parsed.summary ?? '',
      source_refs: {
        excluded_agents: DEFAULT_EXCLUDE_AGENTS,
        outputs_analyzed: outputsForPrompt.length,
        feedback_items_analyzed: feedbackThemes.reduce(
          (a, t) => a + t.occurrences,
          0,
        ),
        past_learnings_referenced: pastLearnings.length,
      },
    };

    const summaryLine = `${report.per_agent_observations.length} agents observed · ${report.diff_proposals.length} diff${report.diff_proposals.length === 1 ? '' : 's'} proposed · ${report.preference_promotions.length} preference promotion${report.preference_promotions.length === 1 ? '' : 's'}`;

    const outputId = await logOutput({
      agentId: 'agent-supervisor',
      venture: 'cross',
      outputType,
      runId: run.id,
      draftContent: report as unknown as Record<string, unknown>,
      tags: [
        outputType,
        `window-${currentWindowDays}d`,
        ...(params.focusAgentId ? [`focus:${params.focusAgentId}`] : []),
      ],
    });

    const queueId = await depositToQueue({
      agent_name: AGENT_NAME,
      type: 'report',
      title:
        outputType === 'agent_deep_dive'
          ? `Deep dive — ${params.focusAgentId ?? 'unknown'} · ${report.period.start} → ${report.period.end}`
          : `Supervisor weekly report · ${report.period.start} → ${report.period.end}`,
      summary: summaryLine,
      full_output: report as unknown as Record<string, unknown>,
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
      contextSummary: `outputs_analyzed=${outputsForPrompt.length} stats=${approvalStatsCurrent.length} rejection_clusters=${rejectionClusters.length} feedback_themes=${feedbackThemes.length} past_learnings=${pastLearnings.length}`,
      outputSummary: summaryLine,
      approvalQueueId: queueId,
      costEstimate: Number(result.costEstimate.toFixed(4)),
    });

    return {
      runId: run.id,
      queueId,
      outputId,
      report,
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

function parseReportJson(text: string): Partial<SupervisorReport> {
  const start = text.indexOf('<!-- BEGIN_REPORT -->');
  const end = text.indexOf('<!-- END_REPORT -->');
  const body =
    start >= 0 && end >= 0
      ? text.slice(start + '<!-- BEGIN_REPORT -->'.length, end).trim()
      : text;
  try {
    const jsonStart = body.indexOf('{');
    const jsonEnd = body.lastIndexOf('}');
    if (jsonStart < 0 || jsonEnd <= jsonStart) {
      return { overall_assessment: body.trim() };
    }
    return JSON.parse(body.slice(jsonStart, jsonEnd + 1));
  } catch (e) {
    console.error('[agent-supervisor] parse failed:', e);
    return { overall_assessment: body.trim() };
  }
}

// ============================================================================
// Per-proposal and per-promotion actions
// ============================================================================

interface QueueItemWithReport {
  id: string;
  agent_output_id: string | null;
  full_output: SupervisorReport;
}

async function loadReportFromQueue(queueItemId: string): Promise<QueueItemWithReport> {
  const { data, error } = await supabaseAdmin()
    .from('approval_queue')
    .select('id, agent_name, agent_output_id, full_output')
    .eq('id', queueItemId)
    .single();
  if (error || !data) throw new Error('Queue item not found');
  if (data.agent_name !== 'agent-supervisor') {
    throw new Error('Not a supervisor report');
  }
  return {
    id: data.id as string,
    agent_output_id: (data.agent_output_id as string | null) ?? null,
    full_output: (data.full_output ?? {}) as SupervisorReport,
  };
}

async function mutateReport(params: {
  queueItemId: string;
  agentOutputId: string | null;
  mutate: (r: SupervisorReport) => SupervisorReport;
}): Promise<void> {
  const db = supabaseAdmin();
  const { data: item } = await db
    .from('approval_queue')
    .select('full_output')
    .eq('id', params.queueItemId)
    .single();
  if (!item) return;
  const next = params.mutate((item.full_output ?? {}) as SupervisorReport);
  await db
    .from('approval_queue')
    .update({ full_output: next as unknown as Record<string, unknown> })
    .eq('id', params.queueItemId);
  if (params.agentOutputId) {
    await db
      .from('agent_outputs')
      .update({ draft_content: next as unknown as Record<string, unknown> })
      .eq('id', params.agentOutputId);
  }
}

export interface ApproveProposalResult {
  learningId: string;
  diffText: string;
}

export async function approveDiffProposal(params: {
  queueItemId: string;
  proposalId: string;
}): Promise<ApproveProposalResult> {
  const item = await loadReportFromQueue(params.queueItemId);
  const prop = item.full_output.diff_proposals?.find((p) => p.id === params.proposalId);
  if (!prop) throw new Error(`Proposal ${params.proposalId} not found`);
  if (prop.action_taken) throw new Error('Proposal already acted on');

  // Log a pending agent_learnings row. Briana fills in git_commit_sha + applied_at
  // manually after she applies the diff via Claude Code.
  const learningId = await logLearning({
    agentId: 'agent-supervisor',
    learningType: 'context_update',
    title: `Diff: ${prop.agent} — ${prop.file_path} (${prop.section})`,
    content: `Hypothesis: ${prop.hypothesis}\n\nConfidence: ${prop.confidence}\n\nCurrent text:\n${prop.current_text}\n\nProposed text:\n${prop.proposed_text}`,
    sourceOutputIds: prop.evidence_output_ids,
    proposedBy: 'agent-supervisor',
  });

  // Also update context_doc_path so future retrievals can group by doc.
  await supabaseAdmin()
    .from('agent_learnings')
    .update({ context_doc_path: prop.file_path })
    .eq('id', learningId);

  await mutateReport({
    queueItemId: params.queueItemId,
    agentOutputId: item.agent_output_id,
    mutate: (r) => ({
      ...r,
      diff_proposals: r.diff_proposals.map((p) =>
        p.id === params.proposalId
          ? {
              ...p,
              action_taken: {
                kind: 'approved',
                note: null,
                learning_id: learningId,
                taken_at: new Date().toISOString(),
              },
            }
          : p,
      ),
    }),
  });

  // Return the diff text so the UI can render it for manual apply.
  const diffText = `File: ${prop.file_path}\nSection: ${prop.section}\n\n--- CURRENT ---\n${prop.current_text}\n\n--- PROPOSED ---\n${prop.proposed_text}`;

  return { learningId, diffText };
}

export async function rejectDiffProposal(params: {
  queueItemId: string;
  proposalId: string;
  reason?: string;
}): Promise<{ learningId: string }> {
  const item = await loadReportFromQueue(params.queueItemId);
  const prop = item.full_output.diff_proposals?.find((p) => p.id === params.proposalId);
  if (!prop) throw new Error(`Proposal ${params.proposalId} not found`);
  if (prop.action_taken) throw new Error('Proposal already acted on');

  // Log the rejection so the Supervisor knows not to re-propose.
  const learningId = await logLearning({
    agentId: 'agent-supervisor',
    learningType: 'failure_mode',
    title: `Diff rejected: ${prop.agent} — ${prop.file_path} (${prop.section})`,
    content: `Rejection reason: ${params.reason ?? '(no reason given)'}\n\nOriginal hypothesis: ${prop.hypothesis}\n\nCurrent text:\n${prop.current_text}\n\nProposed text:\n${prop.proposed_text}`,
    sourceOutputIds: prop.evidence_output_ids,
    proposedBy: 'agent-supervisor',
  });

  await mutateReport({
    queueItemId: params.queueItemId,
    agentOutputId: item.agent_output_id,
    mutate: (r) => ({
      ...r,
      diff_proposals: r.diff_proposals.map((p) =>
        p.id === params.proposalId
          ? {
              ...p,
              action_taken: {
                kind: 'rejected',
                note: params.reason ?? null,
                learning_id: learningId,
                taken_at: new Date().toISOString(),
              },
            }
          : p,
      ),
    }),
  });

  return { learningId };
}

export async function approvePreferencePromotion(params: {
  queueItemId: string;
  promotionId: string;
}): Promise<{ agentName: string }> {
  const item = await loadReportFromQueue(params.queueItemId);
  const promo = item.full_output.preference_promotions?.find(
    (p) => p.id === params.promotionId,
  );
  if (!promo) throw new Error(`Promotion ${params.promotionId} not found`);
  if (promo.action_taken) throw new Error('Promotion already acted on');

  const existing = await getPermanentPreferences(promo.agent).catch(
    () => [] as string[],
  );
  const ruleBody = promo.rule_text.replace(/^\[[^\]]+\]\s*/, '').trim();
  const already = existing.some(
    (r) => r.replace(/^\[[^\]]+\]\s*/, '').trim() === ruleBody,
  );
  if (!already) {
    const newRule = `[PROMOTED ${todayIsoPT()}] ${promo.rule_text}`;
    await setPermanentPreferences(promo.agent, [...existing, newRule]);
  }

  // Log the promotion for retrospective tracking
  await logLearning({
    agentId: 'agent-supervisor',
    learningType: 'context_update',
    title: `Preference promoted: ${promo.agent}`,
    content: `Rule: ${promo.rule_text}\n\nRationale: ${promo.rationale}\n\nOccurrences: ${promo.occurrence_count}`,
    sourceOutputIds: promo.evidence_output_ids,
    proposedBy: 'agent-supervisor',
  });

  await mutateReport({
    queueItemId: params.queueItemId,
    agentOutputId: item.agent_output_id,
    mutate: (r) => ({
      ...r,
      preference_promotions: r.preference_promotions.map((p) =>
        p.id === params.promotionId
          ? {
              ...p,
              action_taken: {
                kind: 'approved',
                note: null,
                taken_at: new Date().toISOString(),
              },
            }
          : p,
      ),
    }),
  });

  return { agentName: promo.agent };
}

export async function rejectPreferencePromotion(params: {
  queueItemId: string;
  promotionId: string;
  reason?: string;
}): Promise<void> {
  const item = await loadReportFromQueue(params.queueItemId);
  const promo = item.full_output.preference_promotions?.find(
    (p) => p.id === params.promotionId,
  );
  if (!promo) throw new Error(`Promotion ${params.promotionId} not found`);
  if (promo.action_taken) return;
  await mutateReport({
    queueItemId: params.queueItemId,
    agentOutputId: item.agent_output_id,
    mutate: (r) => ({
      ...r,
      preference_promotions: r.preference_promotions.map((p) =>
        p.id === params.promotionId
          ? {
              ...p,
              action_taken: {
                kind: 'rejected',
                note: params.reason ?? null,
                taken_at: new Date().toISOString(),
              },
            }
          : p,
      ),
    }),
  });
}
