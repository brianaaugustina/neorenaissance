import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { env } from '../env';
import { todayIsoPT } from '../time';

// Service-role client: server/CLI only. Never ship to the browser.
let _admin: SupabaseClient | null = null;
export function supabaseAdmin(): SupabaseClient {
  if (_admin) return _admin;
  _admin = createClient(env.supabase.url, env.supabase.serviceRoleKey, {
    auth: { persistSession: false },
  });
  return _admin;
}

// ============================================================
// Approval queue
// ============================================================
export type QueueType = 'draft' | 'task_creation' | 'recommendation' | 'report' | 'analytics' | 'briefing';
export type QueueStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'deferred'
  | 'executed'
  /** Replaced by a newer run triggered from the Update button. Old draft
   *  stays in agent_outputs for audit; the queue card shows a 'superseded
   *  → see new draft' badge instead of approval controls. */
  | 'superseded';

export interface DepositParams {
  agent_name: string;
  type: QueueType;
  title: string;
  summary?: string;
  full_output: unknown;
  initiative?: string;
  run_id?: string;
  agent_output_id?: string;
}

export async function depositToQueue(p: DepositParams) {
  const { data, error } = await supabaseAdmin()
    .from('approval_queue')
    .insert({
      agent_name: p.agent_name,
      type: p.type,
      title: p.title,
      summary: p.summary,
      full_output: p.full_output,
      initiative: p.initiative,
      run_id: p.run_id,
      agent_output_id: p.agent_output_id,
      status: 'pending',
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id as string;
}

export async function getQueueItems(status: QueueStatus | 'all' = 'pending', limit = 50) {
  const q = supabaseAdmin()
    .from('approval_queue')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (status !== 'all') q.eq('status', status);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function updateQueueStatus(id: string, status: QueueStatus, feedback?: string) {
  const patch: Record<string, unknown> = { status, reviewed_at: new Date().toISOString() };
  if (feedback) patch.feedback = feedback;
  if (status === 'executed') patch.executed_at = new Date().toISOString();
  const { error } = await supabaseAdmin().from('approval_queue').update(patch).eq('id', id);
  if (error) throw error;
}

// ============================================================
// Agent memory
// ============================================================
export async function getAgentMemory(agent: string, key?: string) {
  const q = supabaseAdmin().from('agent_memory').select('key, value').eq('agent_name', agent);
  if (key) q.eq('key', key);
  const { data, error } = await q;
  if (error) throw error;
  if (key) return data?.[0]?.value ?? null;
  return Object.fromEntries((data ?? []).map((r) => [r.key, r.value]));
}

export async function setAgentMemory(agent: string, key: string, value: unknown) {
  const { error } = await supabaseAdmin()
    .from('agent_memory')
    .upsert(
      { agent_name: agent, key, value, updated_at: new Date().toISOString() },
      { onConflict: 'agent_name,key' },
    );
  if (error) throw error;
}

// ============================================================
// Recent feedback — non-approved queue items for the feedback loop
// ============================================================
export interface RecentFeedbackItem {
  id: string;
  type: string;
  title: string;
  summary: string | null;
  status: QueueStatus;
  feedback: string | null;
  created_at: string;
  reviewed_at: string | null;
}

// Pulls items Briana rejected, deferred, or edited (i.e. left feedback on)
// within the window. Drives the short-term feedback loop so every agent run
// sees what Briana corrected recently and can avoid repeating the same choice.
//
// queueTypes: optional filter. Ops Chief calls this with the specific types
// relevant to the current run (e.g. ['briefing'] for daily, ['recommendation']
// for weekly) so it only learns from matching feedback. Omitted = all types.
export async function getRecentFeedback(
  agentName: string,
  hoursAgo: number,
  queueTypes?: QueueType[],
): Promise<RecentFeedbackItem[]> {
  const cutoff = new Date(Date.now() - hoursAgo * 3600 * 1000).toISOString();
  const q = supabaseAdmin()
    .from('approval_queue')
    .select('id, type, title, summary, status, feedback, created_at, reviewed_at')
    .eq('agent_name', agentName)
    .in('status', ['rejected', 'deferred', 'approved'])
    .or(`reviewed_at.gte.${cutoff},created_at.gte.${cutoff}`)
    .order('reviewed_at', { ascending: false, nullsFirst: false })
    .limit(50);
  if (queueTypes && queueTypes.length) q.in('type', queueTypes);
  const { data, error } = await q;
  if (error) throw error;
  // Only keep items with feedback text OR a non-approved status — approved
  // items without feedback teach nothing.
  return (data ?? []).filter(
    (r: any) => r.feedback || r.status !== 'approved',
  ) as RecentFeedbackItem[];
}

// ============================================================
// Outputs page — persistent history across every agent output
// ============================================================
export interface OutputsFilter {
  agentId?: string;
  outputType?: string;
  approvalStatus?: string;
  sinceIso?: string; // YYYY-MM-DD lower bound on created_at
  untilIso?: string; // YYYY-MM-DD upper bound (inclusive)
  limit?: number;
  offset?: number;
}

export interface OutputsListRow {
  id: string;
  agent_id: string;
  venture: string;
  output_type: string;
  approval_status: string;
  approval_queue_id: string | null;
  run_id: string | null;
  parent_output_id: string | null;
  tags: string[];
  created_at: string;
  approved_at: string | null;
  rejection_reason: string | null;
  summary_preview: string;
}

export async function listOutputs(
  filter: OutputsFilter = {},
): Promise<OutputsListRow[]> {
  const q = supabaseAdmin()
    .from('agent_outputs')
    .select(
      'id, agent_id, venture, output_type, approval_status, approval_queue_id, run_id, parent_output_id, tags, created_at, approved_at, rejection_reason, draft_content, final_content',
    )
    .order('created_at', { ascending: false })
    .limit(filter.limit ?? 50)
    .range(filter.offset ?? 0, (filter.offset ?? 0) + (filter.limit ?? 50) - 1);
  if (filter.agentId) q.eq('agent_id', filter.agentId);
  if (filter.outputType) q.eq('output_type', filter.outputType);
  if (filter.approvalStatus) q.eq('approval_status', filter.approvalStatus);
  if (filter.sinceIso) q.gte('created_at', `${filter.sinceIso}T00:00:00Z`);
  if (filter.untilIso) q.lte('created_at', `${filter.untilIso}T23:59:59Z`);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((r: any) => {
    const content = r.final_content ?? r.draft_content ?? {};
    return {
      id: r.id,
      agent_id: r.agent_id,
      venture: r.venture,
      output_type: r.output_type,
      approval_status: r.approval_status,
      approval_queue_id: r.approval_queue_id,
      run_id: r.run_id,
      parent_output_id: r.parent_output_id,
      tags: r.tags ?? [],
      created_at: r.created_at,
      approved_at: r.approved_at,
      rejection_reason: r.rejection_reason,
      summary_preview: summarizeOutputContent(r.output_type, content),
    };
  });
}

function summarizeOutputContent(type: string, c: Record<string, unknown>): string {
  const pick = (key: string): string =>
    typeof c[key] === 'string' ? (c[key] as string).slice(0, 160) : '';
  switch (type) {
    case 'daily_briefing':
      return pick('briefing_html') || pick('briefing_markdown') || '';
    case 'weekly_plan':
      return pick('weekly_summary') || pick('plan_markdown').slice(0, 160);
    case 'substack_post':
      return pick('substack_title') || pick('episode_title') || '';
    case 'episode_metadata':
      return pick('youtube_title') || pick('spotify_title') || '';
    case 'social_caption':
      return pick('caption');
    case 'calendar_entry':
      return pick('episode_title') || pick('kind');
    case 'pipeline_check':
      return `items=${Array.isArray(c.items) ? (c.items as unknown[]).length : 0}`;
    case 'pitch_email':
    case 'press_pitch_founder_first':
    case 'press_pitch_show_first':
    case 'press_pitch_hybrid':
      return pick('subject');
    case 'research_batch':
    case 'press_research':
      return `reviewed=${(c as { total_reviewed?: number }).total_reviewed ?? 0}, surfaced=${(c as { surfaced_count?: number }).surfaced_count ?? 0}`;
    case 'editorial_landscape_briefing':
      return pick('month_label');
    default:
      return '';
  }
}

export async function listOutputsFacets(): Promise<{
  agentIds: string[];
  outputTypes: string[];
}> {
  // Pull distinct agent_id / output_type values for the filter dropdowns.
  // Tiny table today; a DISTINCT query is cheap.
  const { data } = await supabaseAdmin()
    .from('agent_outputs')
    .select('agent_id, output_type')
    .order('created_at', { ascending: false })
    .limit(500);
  const agents = new Set<string>();
  const types = new Set<string>();
  for (const r of data ?? []) {
    const row = r as { agent_id: string; output_type: string };
    agents.add(row.agent_id);
    types.add(row.output_type);
  }
  return {
    agentIds: [...agents].sort(),
    outputTypes: [...types].sort(),
  };
}

// ============================================================
// Permanent preferences — long-term behavioral rules
// Stored as agent_memory with key='permanent_preferences' (array of strings).
// Back-compat reads from legacy key 'feedback_rules' and merges.
// ============================================================
export async function getPermanentPreferences(
  agentName: string,
): Promise<string[]> {
  const [permanent, legacy] = await Promise.all([
    getAgentMemory(agentName, 'permanent_preferences') as Promise<string[] | null>,
    getAgentMemory(agentName, 'feedback_rules') as Promise<string[] | null>,
  ]);
  const out: string[] = [];
  if (Array.isArray(permanent)) out.push(...permanent);
  if (Array.isArray(legacy)) {
    // Dedupe against bracket-tagged rules already migrated.
    const existingBodies = new Set(
      out.map((r) => r.replace(/^\[[^\]]+\]\s*/, '').trim()),
    );
    for (const r of legacy) {
      const body = r.replace(/^\[[^\]]+\]\s*/, '').trim();
      if (!existingBodies.has(body)) out.push(r);
    }
  }
  return out;
}

export async function setPermanentPreferences(
  agentName: string,
  rules: string[],
): Promise<void> {
  await setAgentMemory(agentName, 'permanent_preferences', rules);
}

// ============================================================
// Daily chat summaries — one row per date under key 'daily_chat_summary:YYYY-MM-DD'.
// Each value holds the structured distillation for that day.
// ============================================================
export interface DailyChatSummary {
  date: string; // YYYY-MM-DD
  value: Record<string, unknown>;
}

export async function saveDailyChatSummary(
  agentName: string,
  date: string,
  value: Record<string, unknown>,
): Promise<void> {
  await setAgentMemory(
    agentName,
    `daily_chat_summary:${date}`,
    { ...value, date },
  );
}

export async function getDailyChatSummaries(
  agentName: string,
  lastNDays: number,
): Promise<DailyChatSummary[]> {
  const { data, error } = await supabaseAdmin()
    .from('agent_memory')
    .select('key, value')
    .eq('agent_name', agentName)
    .like('key', 'daily_chat_summary:%')
    .order('key', { ascending: false })
    .limit(lastNDays);
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    date: String(r.key).replace('daily_chat_summary:', ''),
    value: (r.value ?? {}) as Record<string, unknown>,
  }));
}

// ============================================================
// Agent runs (observability)
// ============================================================
export async function logRunStart(agent: string, trigger: 'cron' | 'manual' | 'chat') {
  const { data, error } = await supabaseAdmin()
    .from('agent_runs')
    .insert({ agent_name: agent, trigger, status: 'running' })
    .select('id, started_at')
    .single();
  if (error) throw error;
  return data as { id: string; started_at: string };
}

export interface RunCompleteParams {
  runId: string;
  startedAt: string;
  status: 'success' | 'error';
  tokensUsed?: number;
  model?: string;
  contextSummary?: string;
  outputSummary?: string;
  error?: string;
  approvalQueueId?: string;
  costEstimate?: number;
}

export async function logRunComplete(p: RunCompleteParams) {
  const duration = Date.now() - new Date(p.startedAt).getTime();
  const { error } = await supabaseAdmin()
    .from('agent_runs')
    .update({
      completed_at: new Date().toISOString(),
      status: p.status,
      duration_ms: duration,
      tokens_used: p.tokensUsed,
      model: p.model,
      context_summary: p.contextSummary,
      output_summary: p.outputSummary,
      error: p.error,
      approval_queue_id: p.approvalQueueId,
      cost_estimate: p.costEstimate,
    })
    .eq('id', p.runId);
  if (error) throw error;
}

// ============================================================
// Agent runs — recent activity for dashboard
// ============================================================
export async function getRecentAgentRuns(limit = 20) {
  const { data, error } = await supabaseAdmin()
    .from('agent_runs')
    .select(
      'id, agent_name, trigger, started_at, completed_at, status, duration_ms, output_summary, cost_estimate',
    )
    .neq('trigger', 'chat')
    .order('started_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

// ============================================================
// Chat messages (Ops Chief)
// ============================================================
export async function getChatHistory(sessionDate?: string, limit = 50) {
  const q = supabaseAdmin()
    .from('chat_messages')
    .select('*')
    .order('created_at', { ascending: true })
    .limit(limit);
  if (sessionDate) q.eq('session_date', sessionDate);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function saveChatMessage(p: {
  agent_name?: string;
  role: 'user' | 'assistant';
  content: string;
  metadata?: Record<string, unknown>;
}) {
  // Set session_date explicitly to PT today instead of relying on the DB's
  // CURRENT_DATE (which is UTC on Supabase). Keeps chat buckets aligned with
  // Briana's actual day.
  const { error } = await supabaseAdmin().from('chat_messages').insert({
    agent_name: p.agent_name ?? 'ops_chief',
    role: p.role,
    content: p.content,
    metadata: p.metadata,
    session_date: todayIsoPT(),
  });
  if (error) throw error;
}
