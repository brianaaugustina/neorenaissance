// Single source of truth for writing agent outputs to Supabase.
// Every agent in Phase 2+ calls these helpers — never writes to agent_outputs directly.
// Spec: docs/agent-outputs-claude-code-handoff.md

import { supabaseAdmin } from './supabase/client';

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

export type AgentId =
  | 'ops-chief'
  | 'ops_chief' // existing tables use underscore; accept both during transition
  | 'showrunner'
  | 'sponsorship-director'
  | 'pr-director'
  | 'talent-scout'
  | 'funding-scout'
  | 'growth-strategist'
  | 'analytics-reporting'
  | 'agent-supervisor'
  | 'system-engineer'
  | 'corral-engineer'
  | 'corral-sales-director'
  | 'detto-pm'
  | 'aura-analyst';

export type Venture = 'trades-show' | 'corral' | 'detto' | 'aura' | 'cross';

export type ApprovalStatus =
  | 'pending'
  | 'approved'
  | 'edited'
  | 'rejected'
  | 'expired';

export type LearningType =
  | 'retrospective'
  | 'pattern'
  | 'context_update'
  | 'failure_mode'
  | 'success_mode';

export type LearningProposer =
  | 'agent-supervisor'
  | 'system-engineer'
  | 'briana'
  | 'ops-chief';

export type DraftContent = Record<string, unknown> | string;

export interface LogOutputParams {
  agentId: AgentId;
  venture: Venture;
  outputType: string;
  draftContent: DraftContent;
  runId?: string;
  approvalQueueId?: string;
  parentOutputId?: string;
  tags?: string[];
}

export interface UpdateStatusParams {
  outputId: string;
  status: ApprovalStatus;
  finalContent?: DraftContent;
  editDiff?: Record<string, unknown>;
  rejectionReason?: string;
}

export interface LogLearningParams {
  agentId: AgentId | 'cross';
  learningType: LearningType;
  title: string;
  content: string;
  sourceOutputIds?: string[];
  proposedBy: LearningProposer;
}

export interface EditDiff {
  type: 'structured_diff';
  fields: Record<
    string,
    {
      from: unknown;
      to: unknown;
      change_type: 'replaced' | 'added' | 'removed' | 'reordered';
    }
  >;
  summary?: string;
}

function normalizeContent(c: DraftContent): Record<string, unknown> {
  return typeof c === 'string' ? { content: c } : c;
}

// ────────────────────────────────────────────────────────────
// logOutput — insert a pending row for an agent draft
// ────────────────────────────────────────────────────────────

export async function logOutput(params: LogOutputParams): Promise<string> {
  const { data, error } = await supabaseAdmin()
    .from('agent_outputs')
    .insert({
      agent_id: params.agentId,
      venture: params.venture,
      output_type: params.outputType,
      draft_content: normalizeContent(params.draftContent),
      run_id: params.runId ?? null,
      approval_queue_id: params.approvalQueueId ?? null,
      parent_output_id: params.parentOutputId ?? null,
      tags: params.tags ?? [],
      approval_status: 'pending',
    })
    .select('id')
    .single();

  if (error) {
    console.error('[agent-outputs] logOutput failed:', error);
    throw error;
  }

  return data.id as string;
}

// ────────────────────────────────────────────────────────────
// updateOutputStatus — terminal transition from pending → approved/edited/rejected
// ────────────────────────────────────────────────────────────

export async function updateOutputStatus(
  params: UpdateStatusParams,
): Promise<void> {
  const update: Record<string, unknown> = {
    approval_status: params.status,
    approved_at: new Date().toISOString(),
  };

  if (params.finalContent !== undefined) {
    update.final_content = normalizeContent(params.finalContent);
  }
  if (params.editDiff !== undefined) update.edit_diff = params.editDiff;
  if (params.rejectionReason !== undefined)
    update.rejection_reason = params.rejectionReason;

  const { error } = await supabaseAdmin()
    .from('agent_outputs')
    .update(update)
    .eq('id', params.outputId);

  if (error) {
    console.error('[agent-outputs] updateOutputStatus failed:', error);
    throw error;
  }
}

// Bulk-update every output row produced by a run. Used when a Showrunner
// package is approved as a single queue item — all children inherit the
// parent's terminal status until per-item UI lands in Step 7.
export async function bulkUpdateOutputsByRunId(
  runId: string,
  status: ApprovalStatus,
  rejectionReason?: string,
): Promise<void> {
  if (!runId) return;
  const update: Record<string, unknown> = {
    approval_status: status,
    approved_at: new Date().toISOString(),
  };
  if (rejectionReason !== undefined) update.rejection_reason = rejectionReason;

  const { error } = await supabaseAdmin()
    .from('agent_outputs')
    .update(update)
    .eq('run_id', runId)
    .eq('approval_status', 'pending');

  if (error) {
    console.error('[agent-outputs] bulkUpdateOutputsByRunId failed:', error);
    throw error;
  }
}

// ────────────────────────────────────────────────────────────
// setApprovalQueueId — fill in the FK after the queue item exists
// ────────────────────────────────────────────────────────────

export async function setApprovalQueueId(
  outputId: string,
  approvalQueueId: string,
): Promise<void> {
  const { error } = await supabaseAdmin()
    .from('agent_outputs')
    .update({ approval_queue_id: approvalQueueId })
    .eq('id', outputId);
  if (error) {
    console.error('[agent-outputs] setApprovalQueueId failed:', error);
    throw error;
  }
}

// ────────────────────────────────────────────────────────────
// getRecentAgentOutputs — cross-agent visibility for Ops Chief briefings.
// Returns parent outputs (parent_output_id is null) so the briefing surfaces
// one line per coherent agent action rather than a row per caption.
// ────────────────────────────────────────────────────────────

export interface RecentAgentOutput {
  id: string;
  agent_id: string;
  venture: string;
  output_type: string;
  approval_status: ApprovalStatus;
  tags: string[];
  created_at: string;
  draft_title?: string;
}

export async function getRecentAgentOutputs(
  hoursAgo: number,
  opts: { excludeAgentIds?: string[]; limit?: number } = {},
): Promise<RecentAgentOutput[]> {
  const cutoff = new Date(Date.now() - hoursAgo * 3600 * 1000).toISOString();
  const q = supabaseAdmin()
    .from('agent_outputs')
    .select(
      'id, agent_id, venture, output_type, approval_status, tags, created_at, draft_content',
    )
    .gte('created_at', cutoff)
    .is('parent_output_id', null)
    .order('created_at', { ascending: false })
    .limit(opts.limit ?? 25);
  if (opts.excludeAgentIds?.length) {
    q.not('agent_id', 'in', `(${opts.excludeAgentIds.map((a) => `"${a}"`).join(',')})`);
  }
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    id: r.id,
    agent_id: r.agent_id,
    venture: r.venture,
    output_type: r.output_type,
    approval_status: r.approval_status,
    tags: r.tags ?? [],
    created_at: r.created_at,
    draft_title:
      typeof r.draft_content === 'object' && r.draft_content
        ? (r.draft_content.title ??
          r.draft_content.episode_title ??
          r.draft_content.summary)
        : undefined,
  }));
}

// ────────────────────────────────────────────────────────────
// getApprovedOutputsByType — retrieval of "what good looks like" for an agent.
// Used as in-context exemplars before drafting a new output of the same type.
//
// Ordering: approved_at desc. The Showrunner v2 spec proposes ordering by
// metrics_30d->>'saves' once Phase 6 populates metrics; until then, recency
// is the best signal we have.
// ────────────────────────────────────────────────────────────

export interface ApprovedOutputExample {
  id: string;
  output_type: string;
  tags: string[];
  final_content: Record<string, unknown> | null;
  approved_at: string | null;
}

export async function getApprovedOutputsByType(params: {
  agentId: AgentId;
  venture: Venture;
  outputType: string;
  limit?: number;
  requireFinalContent?: boolean;
}): Promise<ApprovedOutputExample[]> {
  const q = supabaseAdmin()
    .from('agent_outputs')
    .select('id, output_type, tags, final_content, approved_at')
    .eq('agent_id', params.agentId)
    .eq('venture', params.venture)
    .eq('output_type', params.outputType)
    .in('approval_status', ['approved', 'edited'])
    .order('approved_at', { ascending: false, nullsFirst: false })
    .limit(params.limit ?? 5);

  const { data, error } = await q;
  if (error) {
    console.error('[agent-outputs] getApprovedOutputsByType failed:', error);
    throw error;
  }

  const rows = (data ?? []) as ApprovedOutputExample[];
  if (params.requireFinalContent) {
    return rows.filter((r) => r.final_content != null);
  }
  return rows;
}

// ────────────────────────────────────────────────────────────
// logLearning — Phase 4 Supervisor/System Engineer retrospectives.
// Exposed now; unused in Step 1.
// ────────────────────────────────────────────────────────────

export async function logLearning(
  params: LogLearningParams,
): Promise<string> {
  const { data, error } = await supabaseAdmin()
    .from('agent_learnings')
    .insert({
      agent_id: params.agentId,
      learning_type: params.learningType,
      title: params.title,
      content: params.content,
      source_output_ids: params.sourceOutputIds ?? [],
      proposed_by: params.proposedBy,
      applied: false,
    })
    .select('id')
    .single();

  if (error) {
    console.error('[agent-outputs] logLearning failed:', error);
    throw error;
  }

  return data.id as string;
}

// ────────────────────────────────────────────────────────────
// computeEditDiff — field-level diff for edit-and-approve flows.
// Naive JSON-stringify comparison is correct for V1; the Supervisor
// will cluster diff text patterns semantically later.
// ────────────────────────────────────────────────────────────

export function computeEditDiff(
  draft: DraftContent,
  final: DraftContent,
): EditDiff | null {
  const draftObj = normalizeContent(draft);
  const finalObj = normalizeContent(final);

  const fields: EditDiff['fields'] = {};
  const allKeys = new Set([
    ...Object.keys(draftObj),
    ...Object.keys(finalObj),
  ]);

  for (const key of allKeys) {
    const from = (draftObj as Record<string, unknown>)[key];
    const to = (finalObj as Record<string, unknown>)[key];
    if (JSON.stringify(from) === JSON.stringify(to)) continue;

    fields[key] = {
      from: from ?? null,
      to: to ?? null,
      change_type:
        from === undefined
          ? 'added'
          : to === undefined
            ? 'removed'
            : 'replaced',
    };
  }

  if (Object.keys(fields).length === 0) return null;
  return { type: 'structured_diff', fields };
}
