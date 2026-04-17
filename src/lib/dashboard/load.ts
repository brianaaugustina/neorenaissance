import {
  getInitiatives,
  getOverdueTasks,
  getTodaysTasks,
  getWeekTasks,
  type Initiative,
  type Task,
} from '../notion/client';
import { getChatHistory, getQueueItems, getRecentAgentRuns } from '../supabase/client';

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
  const todayIso = new Date().toISOString().slice(0, 10);
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
    safe('pendingQueue', () => getQueueItems('pending', 20), [] as any[], errors),
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
    safe('agentRuns', () => getRecentAgentRuns(20), [] as any[], errors),
  ]);

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

  // Include approved recommendations (e.g., weekly plans awaiting execution)
  const approvedRecs = await safe(
    'approvedRecs',
    async () => {
      const items = await getQueueItems('approved', 10);
      return items.filter((i: any) => i.type === 'recommendation');
    },
    [] as any[],
    errors,
  );

  return {
    todayIso,
    weekStartIso,
    weekEndIso,
    todaysTasks,
    overdueTasks,
    weekTasks,
    initiatives,
    pendingQueue: [...pendingQueue, ...approvedRecs],
    completedToday,
    chatHistory,
    agentRuns,
    errors,
  };
}
