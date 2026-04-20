// Supervisor data-pull helpers.
//
// Self-exclusion is enforced HERE — every caller gets agent-supervisor +
// system-engineer filtered out by default. If you need to include them (you
// shouldn't from the Supervisor), pass an empty excludeAgentIds.

import { supabaseAdmin } from '../supabase/client';

export const DEFAULT_EXCLUDE_AGENTS = ['agent-supervisor', 'system-engineer'];

export interface SupervisorAgentOutputRow {
  id: string;
  agent_id: string;
  venture: string;
  output_type: string;
  approval_status: string;
  rejection_reason: string | null;
  tags: string[];
  run_id: string | null;
  approval_queue_id: string | null;
  parent_output_id: string | null;
  created_at: string;
  approved_at: string | null;
  draft_content: Record<string, unknown> | null;
  final_content: Record<string, unknown> | null;
  edit_diff: Record<string, unknown> | null;
}

// Returns agent outputs in the window, self-excluding supervisor + sys-engineer.
// Used by the weekly supervisor run to compute approval rates, spot rejection
// patterns, and surface edit-diff trends.
export async function getAgentOutputsForWindow(params: {
  startIso: string;
  endIso: string;
  excludeAgentIds?: string[];
  limit?: number;
}): Promise<SupervisorAgentOutputRow[]> {
  const exclude = params.excludeAgentIds ?? DEFAULT_EXCLUDE_AGENTS;
  const q = supabaseAdmin()
    .from('agent_outputs')
    .select(
      'id, agent_id, venture, output_type, approval_status, rejection_reason, tags, run_id, approval_queue_id, parent_output_id, created_at, approved_at, draft_content, final_content, edit_diff',
    )
    .gte('created_at', params.startIso)
    .lte('created_at', params.endIso)
    .order('created_at', { ascending: false })
    .limit(params.limit ?? 500);
  if (exclude.length > 0) {
    q.not('agent_id', 'in', `(${exclude.map((a) => `"${a}"`).join(',')})`);
  }
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as SupervisorAgentOutputRow[];
}

export interface ApprovalStatsRow {
  agent_id: string;
  output_type: string;
  approved: number;
  edited: number;
  rejected: number;
  ignored: number;
  pending: number;
  total: number;
  // Computed: approved/(approved+edited+rejected+ignored). Excludes pending.
  approval_rate: number;
}

// Roll up approval counts per (agent_id, output_type) over the last N days.
// Used to compute approval-rate deltas week-over-week and the 70% threshold
// from the playbook.
export async function getApprovalStatsByAgent(params: {
  startIso: string;
  endIso: string;
  excludeAgentIds?: string[];
}): Promise<ApprovalStatsRow[]> {
  const rows = await getAgentOutputsForWindow({
    startIso: params.startIso,
    endIso: params.endIso,
    excludeAgentIds: params.excludeAgentIds,
    limit: 2000,
  });

  const stats = new Map<string, ApprovalStatsRow>();
  for (const r of rows) {
    const key = `${r.agent_id}::${r.output_type}`;
    const existing =
      stats.get(key) ??
      ({
        agent_id: r.agent_id,
        output_type: r.output_type,
        approved: 0,
        edited: 0,
        rejected: 0,
        ignored: 0,
        pending: 0,
        total: 0,
        approval_rate: 0,
      } satisfies ApprovalStatsRow);
    switch (r.approval_status) {
      case 'approved':
        existing.approved++;
        break;
      case 'edited':
        existing.edited++;
        break;
      case 'rejected':
        existing.rejected++;
        break;
      case 'ignored':
        existing.ignored++;
        break;
      case 'pending':
      default:
        existing.pending++;
        break;
    }
    existing.total++;
    stats.set(key, existing);
  }
  for (const s of stats.values()) {
    const decided = s.approved + s.edited + s.rejected + s.ignored;
    s.approval_rate = decided === 0 ? 0 : s.approved / decided;
  }
  return [...stats.values()].sort((a, b) =>
    a.agent_id === b.agent_id
      ? a.output_type.localeCompare(b.output_type)
      : a.agent_id.localeCompare(b.agent_id),
  );
}

export interface FirstPassRejectionCluster {
  agent_id: string;
  output_type: string;
  total_runs: number;
  rejections: Array<{
    output_id: string;
    rejection_reason: string | null;
    created_at: string;
  }>;
}

// Returns (agent, output_type) clusters with 3+ rejections in the window,
// provided the total runs of that combo is at least `minRunsPerTaskType`.
export async function getFirstPassRejectionPatterns(params: {
  startIso: string;
  endIso: string;
  minRunsPerTaskType?: number;
  excludeAgentIds?: string[];
}): Promise<FirstPassRejectionCluster[]> {
  const minRuns = params.minRunsPerTaskType ?? 5;
  const rows = await getAgentOutputsForWindow({
    startIso: params.startIso,
    endIso: params.endIso,
    excludeAgentIds: params.excludeAgentIds,
    limit: 2000,
  });
  const clusters = new Map<string, FirstPassRejectionCluster>();
  for (const r of rows) {
    const key = `${r.agent_id}::${r.output_type}`;
    const c =
      clusters.get(key) ??
      ({
        agent_id: r.agent_id,
        output_type: r.output_type,
        total_runs: 0,
        rejections: [],
      } satisfies FirstPassRejectionCluster);
    c.total_runs++;
    if (r.approval_status === 'rejected') {
      c.rejections.push({
        output_id: r.id,
        rejection_reason: r.rejection_reason,
        created_at: r.created_at,
      });
    }
    clusters.set(key, c);
  }
  return [...clusters.values()].filter(
    (c) => c.rejections.length >= 3 && c.total_runs >= minRuns,
  );
}

export interface RecurringFeedbackTheme {
  feedback_text: string;
  agents: string[];
  occurrences: number;
  sample_output_ids: string[];
}

// Shallow pass over recent approval_queue feedback text — groups identical
// (case-folded) feedback strings that appear across multiple agents in the
// window. The LLM runs the actual theme-naming; this is the data input.
export async function getRecurringFeedbackThemes(params: {
  startIso: string;
  endIso: string;
  minAgents?: number;
  excludeAgentIds?: string[];
}): Promise<RecurringFeedbackTheme[]> {
  const minAgents = params.minAgents ?? 2;
  const exclude = params.excludeAgentIds ?? DEFAULT_EXCLUDE_AGENTS;
  const q = supabaseAdmin()
    .from('approval_queue')
    .select('id, agent_name, feedback, agent_output_id, reviewed_at')
    .gte('reviewed_at', params.startIso)
    .lte('reviewed_at', params.endIso)
    .not('feedback', 'is', null)
    .order('reviewed_at', { ascending: false })
    .limit(500);
  const { data, error } = await q;
  if (error) throw error;

  const filtered = (data ?? []).filter(
    (r: any) => !exclude.includes(r.agent_name),
  );

  // Group by lowercased-trimmed feedback text
  const groups = new Map<
    string,
    {
      text: string;
      agents: Set<string>;
      occurrences: number;
      outputIds: string[];
    }
  >();
  for (const r of filtered) {
    const text = (r.feedback as string).trim();
    if (!text) continue;
    const key = text.toLowerCase();
    const g =
      groups.get(key) ??
      { text, agents: new Set<string>(), occurrences: 0, outputIds: [] };
    g.agents.add(r.agent_name as string);
    g.occurrences++;
    if (r.agent_output_id) g.outputIds.push(r.agent_output_id as string);
    groups.set(key, g);
  }
  return [...groups.values()]
    .filter((g) => g.agents.size >= minAgents)
    .map((g) => ({
      feedback_text: g.text,
      agents: [...g.agents],
      occurrences: g.occurrences,
      sample_output_ids: g.outputIds.slice(0, 4),
    }));
}

export interface PastSupervisorLearning {
  id: string;
  learning_type: string;
  title: string;
  content: string;
  source_output_ids: string[];
  applied: boolean;
  applied_at: string | null;
  context_doc_path: string | null;
  git_commit_sha: string | null;
  created_at: string;
}

// Previous diff proposals + rejections so Supervisor doesn't re-surface a diff
// Briana already rejected.
export async function getPastSupervisorLearnings(
  limit = 30,
): Promise<PastSupervisorLearning[]> {
  const { data, error } = await supabaseAdmin()
    .from('agent_learnings')
    .select(
      'id, learning_type, title, content, source_output_ids, applied, applied_at, context_doc_path, git_commit_sha, created_at',
    )
    .eq('agent_id', 'agent-supervisor')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as PastSupervisorLearning[];
}

// Applied diffs that have hit their 30-day retrospective date and don't yet
// have a retrospective logged against them. (A retrospective is logged when a
// separate agent_learnings row of type 'retrospective' references the same
// diff via the title or content — lightweight linkage until we add a
// parent_learning_id column in a future migration.)
export async function getPendingRetrospectives(): Promise<PastSupervisorLearning[]> {
  const cutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const { data: applied, error } = await supabaseAdmin()
    .from('agent_learnings')
    .select(
      'id, learning_type, title, content, source_output_ids, applied, applied_at, context_doc_path, git_commit_sha, created_at',
    )
    .eq('agent_id', 'agent-supervisor')
    .eq('applied', true)
    .not('applied_at', 'is', null)
    .lte('applied_at', cutoff)
    .order('applied_at', { ascending: false })
    .limit(20);
  if (error) throw error;

  const retros = await supabaseAdmin()
    .from('agent_learnings')
    .select('title')
    .eq('agent_id', 'agent-supervisor')
    .eq('learning_type', 'retrospective');
  const retroTitles = new Set((retros.data ?? []).map((r: any) => r.title));

  return ((applied ?? []) as PastSupervisorLearning[]).filter(
    (r) => !retroTitles.has(`Retro: ${r.title}`),
  );
}

// Agent-run failure counts — per agent, in the window. Used to flag agents
// that failed to run 2+ times (per playbook flag rule).
export async function getAgentRunFailures(params: {
  startIso: string;
  endIso: string;
  excludeAgentIds?: string[];
}): Promise<Array<{ agent_name: string; failures: number; total: number }>> {
  const exclude = params.excludeAgentIds ?? DEFAULT_EXCLUDE_AGENTS;
  const { data, error } = await supabaseAdmin()
    .from('agent_runs')
    .select('agent_name, status, started_at')
    .gte('started_at', params.startIso)
    .lte('started_at', params.endIso)
    .limit(2000);
  if (error) throw error;
  const stats = new Map<string, { failures: number; total: number }>();
  for (const r of (data ?? []) as Array<{ agent_name: string; status: string }>) {
    if (exclude.includes(r.agent_name)) continue;
    const s = stats.get(r.agent_name) ?? { failures: 0, total: 0 };
    s.total++;
    if (r.status === 'error') s.failures++;
    stats.set(r.agent_name, s);
  }
  return [...stats.entries()].map(([agent_name, s]) => ({ agent_name, ...s }));
}
