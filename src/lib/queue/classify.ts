// Shared helpers for classifying queue items into AGENT.DASH groups and
// resolving their row actions. Used by both the Dashboard queue column and
// the full /queue page so the logic stays in one place.

export type QueueGroup = 'approval' | 'input' | 'verify';

export interface QueueItemLike {
  id: string;
  agent_name: string;
  type: string;
  status: string;
  title: string;
  summary: string | null;
  created_at: string;
  agent_output_id?: string | null;
  full_output?: Record<string, unknown>;
}

/**
 * 'verify' → approved items still needing commit/execute downstream
 * 'input'  → blocked waiting for operator upload / clarification (reserved
 *            for future items flagged 'awaiting_input')
 * 'approval' → default: needs approve/reject/defer decision
 */
export function classifyQueueItem(item: QueueItemLike): QueueGroup {
  if (item.status === 'approved' || item.status === 'executed') return 'verify';
  return 'approval';
}

export function queueGroupLabel(group: QueueGroup): string {
  return group === 'approval'
    ? 'Needs Approval'
    : group === 'input'
      ? 'Requires Your Input'
      : 'Verify & Commit';
}

export function queueGroupHint(group: QueueGroup): string {
  return group === 'approval'
    ? 'Operator must approve or reject before the agent proceeds.'
    : group === 'input'
      ? 'Agent is blocked — upload files, pick option, or clarify.'
      : 'Action approved — review or commit downstream changes.';
}

/**
 * Does this item support a single-click Approve? Only for items whose
 * primary action is "approve the whole thing" — not multi-sub-item research
 * batches or briefings where the user needs per-sub-item decisions.
 */
export function supportsInlineApprove(item: QueueItemLike): boolean {
  if (item.status !== 'pending') return false;
  const fo = (item.full_output ?? {}) as Record<string, unknown>;
  if (Array.isArray(fo.leads)) return false;
  if (Array.isArray(fo.opportunities)) return false;
  if (Array.isArray(fo.recommendations)) return false;
  if (Array.isArray(fo.diff_proposals)) return false;
  if (Array.isArray(fo.findings)) return false;
  return true;
}

export function queueItemDetailHref(item: QueueItemLike): string {
  if (item.agent_output_id) {
    return `/outputs/${item.agent_name}/${item.agent_output_id}`;
  }
  return `/queue/${item.id}/review`;
}

export function queueItemContext(item: QueueItemLike): string {
  if (item.status === 'approved' || item.status === 'executed') return 'needs commit';
  if (item.type === 'draft') return 'draft';
  if (item.type === 'report') return 'report';
  if (item.type === 'recommendation') return 'plan';
  if (item.type === 'briefing') return 'briefing';
  return item.type;
}

export function itemAgeMs(item: QueueItemLike): number {
  return Date.now() - new Date(item.created_at).getTime();
}

export function isUrgent(item: QueueItemLike): boolean {
  return item.status === 'pending' && itemAgeMs(item) > 4 * 60 * 60 * 1000;
}
