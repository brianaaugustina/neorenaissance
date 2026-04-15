import {
  getInitiatives,
  getOverdueTasks,
  getTodaysTasks,
  type Initiative,
  type Task,
} from '../notion/client';
import { getChatHistory, getQueueItems } from '../supabase/client';

export interface ChatMessageView {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

export interface DashboardData {
  todayIso: string;
  todaysTasks: Task[];
  overdueTasks: Task[];
  initiatives: Initiative[];
  pendingQueue: any[];
  completedToday: any[];
  chatHistory: ChatMessageView[];
  errors: Record<string, string>;
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
  const errors: Record<string, string> = {};

  const [todaysTasks, overdueTasks, initiatives, pendingQueue, executedQueue, chatRaw] =
    await Promise.all([
      safe('todaysTasks', () => getTodaysTasks(todayIso), [] as Task[], errors),
      safe('overdueTasks', () => getOverdueTasks(todayIso), [] as Task[], errors),
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

  return {
    todayIso,
    todaysTasks,
    overdueTasks,
    initiatives,
    pendingQueue,
    completedToday,
    chatHistory,
    errors,
  };
}
