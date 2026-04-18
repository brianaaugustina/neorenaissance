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
export type QueueStatus = 'pending' | 'approved' | 'rejected' | 'deferred' | 'executed';

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
export async function getRecentFeedback(
  agentName: string,
  hoursAgo: number,
): Promise<RecentFeedbackItem[]> {
  const cutoff = new Date(Date.now() - hoursAgo * 3600 * 1000).toISOString();
  const { data, error } = await supabaseAdmin()
    .from('approval_queue')
    .select('id, type, title, summary, status, feedback, created_at, reviewed_at')
    .eq('agent_name', agentName)
    .in('status', ['rejected', 'deferred', 'approved'])
    .or(`reviewed_at.gte.${cutoff},created_at.gte.${cutoff}`)
    .order('reviewed_at', { ascending: false, nullsFirst: false })
    .limit(25);
  if (error) throw error;
  // Only keep items with feedback text OR a non-approved status — approved
  // items without feedback teach nothing.
  return (data ?? []).filter(
    (r: any) => r.feedback || r.status !== 'approved',
  ) as RecentFeedbackItem[];
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
