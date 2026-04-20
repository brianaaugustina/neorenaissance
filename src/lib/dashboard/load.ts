import {
  getInitiatives,
  getOverdueTasks,
  getTodaysTasks,
  getWeekTasks,
  type Initiative,
  type Task,
} from '../notion/client';
import {
  getChatHistory,
  getQueueItems,
  getRecentAgentRuns,
  mapRunIdToParentOutput,
} from '../supabase/client';
import { todayIsoPT } from '../time';

// Queue-scope rule per the dashboard spec: an item belongs in the queue iff
// it needs review or approval, OR it's approved but has downstream actions
// still pending. Once fully resolved, items leave the queue and persist in
// the /outputs page only.
//
// Resolution rules per type:
//   - Showrunner draft: resolved when approved AND every clip has
//     scheduled_at (or no clips exist). While any clip is unscheduled the
//     approved parent stays in the queue so the Schedule buttons are
//     reachable.
//   - Ops Chief briefing: resolved on approve (no downstream).
//   - Weekly plan (type='recommendation'): stays visible after approve
//     because executing the plan is a downstream action — already handled
//     by the existing approvedRecs branch.
//   - Sponsorship / PR pitch draft: resolved on approve (Gate 3 Send is
//     not wired yet; when it lands, "Sent" becomes the terminal state).
//   - Research batch (type='report' with leads[]): resolved on approve of
//     the batch item OR when every lead has approved=true or skipped=true.
export function isApprovedWithDownstream(item: {
  agent_name?: string;
  type?: string;
  full_output?: unknown;
}): boolean {
  if (item.agent_name === 'showrunner' && item.type === 'draft') {
    interface Caption { scheduled_at?: unknown }
    const fo = (item.full_output ?? {}) as { clip_captions?: Caption[] };
    const captions = Array.isArray(fo.clip_captions) ? fo.clip_captions : [];
    if (captions.length === 0) return false;
    return captions.some((c) => !c.scheduled_at);
  }
  // Talent Scout pitch drafts stay in queue until Mark-as-sent records the
  // Notion Outreach touch row. sent_at is the terminal signal.
  if (item.agent_name === 'talent-scout' && item.type === 'draft') {
    const fo = (item.full_output ?? {}) as { sent_at?: unknown };
    return !fo.sent_at;
  }
  return false;
}

export interface ChatMessageView {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

export interface DashboardData {
  todayIso: string;
  weekStartIso: string;
  weekEndIso: string;
  todaysTasks: Task[];
  overdueTasks: Task[];
  weekTasks: Task[];
  initiatives: Initiative[];
  pendingQueue: any[];
  completedToday: any[];
  chatHistory: ChatMessageView[];
  agentRuns: any[];
  /** Map: run_id → { agentId, outputId } for deep-linking agent updates
   *  and recent runs into the dedicated /outputs/[agent]/[id] page. */
  outputHrefByRunId: Record<string, { agentId: string; outputId: string }>;
  errors: Record<string, string>;
}

// Monday-anchored week boundary. Weekend rolls to the following Monday.
export function currentWeekBounds(todayIso: string): { start: string; end: string } {
  const today = new Date(todayIso + 'T00:00:00Z');
  const dow = today.getUTCDay(); // 0=Sun..6=Sat
  // Shift so Monday = 0
  const mondayOffset = (dow + 6) % 7;
  const monday = new Date(today);
  monday.setUTCDate(today.getUTCDate() - mondayOffset);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return {
    start: monday.toISOString().slice(0, 10),
    end: sunday.toISOString().slice(0, 10),
  };
}

async function safe<T>(
  label: string,
  fn: () => Promise<T>,
  fallback: T,
  errors: Record<string, string>,
): Promise<T> {
  try {
    return await fn();
  } catch (e: any) {
    errors[label] = e?.message ?? String(e);
    return fallback;
  }
}

export async function loadDashboardData(): Promise<DashboardData> {
  const todayIso = todayIsoPT();
  const { start: weekStartIso, end: weekEndIso } = currentWeekBounds(todayIso);
  const errors: Record<string, string> = {};

  const [
    todaysTasks,
    overdueTasks,
    weekTasks,
    initiatives,
    pendingQueue,
    executedQueue,
    chatRaw,
    agentRuns,
  ] = await Promise.all([
    safe('todaysTasks', () => getTodaysTasks(todayIso), [] as Task[], errors),
    safe('overdueTasks', () => getOverdueTasks(todayIso), [] as Task[], errors),
    safe('weekTasks', () => getWeekTasks(weekStartIso, weekEndIso), [] as Task[], errors),
    safe('initiatives', () => getInitiatives(), [] as Initiative[], errors),
    safe('pendingQueue', () => getQueueItems('pending', 100), [] as any[], errors),
    safe(
      'completedQueue',
      async () => [
        ...(await getQueueItems('approved', 10)),
        ...(await getQueueItems('executed', 10)),
        ...(await getQueueItems('rejected', 10)),
      ],
      [] as any[],
      errors,
    ),
    safe('chatHistory', () => getChatHistory(todayIso, 50), [] as any[], errors),
    safe('agentRuns', () => getRecentAgentRuns(50), [] as any[], errors),
  ]);

  // Agent Updates feed shows only the past 24 hours. Older runs live on the
  // /agent-updates full-history page.
  const agentActivityCutoff = Date.now() - 24 * 3600 * 1000;
  const recentAgentRuns = agentRuns.filter(
    (r: any) => new Date(r.started_at).getTime() >= agentActivityCutoff,
  );

  const chatHistory: ChatMessageView[] = chatRaw.map((m: any) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    created_at: m.created_at,
  }));

  // Filter "completed today" by reviewed_at date
  const completedToday = executedQueue.filter((item: any) => {
    const when = item.reviewed_at || item.executed_at;
    return when && when.slice(0, 10) === todayIso;
  });

  // Queue inclusion: (a) pending items, (b) approved items that still have
  // downstream work pending (weekly plan awaiting Execute; Showrunner draft
  // awaiting per-clip Schedule). Superseded and fully-resolved items stay
  // out of the queue — they live on /outputs.
  const approvedWithDownstream = await safe(
    'approvedWithDownstream',
    async () => {
      const items = await getQueueItems('approved', 30);
      return items.filter(
        (i: any) =>
          i.type === 'recommendation' || isApprovedWithDownstream(i),
      );
    },
    [] as any[],
    errors,
  );

  // Resolve each displayed run to its parent output for deep-linking.
  const outputByRun = await safe(
    'outputHrefByRunId',
    () => mapRunIdToParentOutput(recentAgentRuns.map((r: any) => r.id)),
    new Map<string, { agentId: string; outputId: string }>(),
    errors,
  );
  const outputHrefByRunId: Record<string, { agentId: string; outputId: string }> = {};
  for (const [runId, val] of outputByRun.entries()) outputHrefByRunId[runId] = val;

  return {
    todayIso,
    weekStartIso,
    weekEndIso,
    todaysTasks,
    overdueTasks,
    weekTasks,
    initiatives,
    pendingQueue: [...pendingQueue, ...approvedWithDownstream],
    completedToday,
    chatHistory,
    agentRuns: recentAgentRuns,
    outputHrefByRunId,
    errors,
  };
}
