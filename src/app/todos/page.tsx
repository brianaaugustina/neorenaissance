import { AgentDashNav } from '@/components/AgentDashNav';
import { TodosPageClient } from '@/components/TodosPageClient';
import {
  getCompletedTasksSince,
  getInitiatives,
  getOverdueTasks,
  getTodaysTasks,
  getWeekTasks,
  type Initiative,
  type Task,
} from '@/lib/notion/client';
import { addDaysIso, todayIsoPT } from '@/lib/time';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

export default async function TodosPage() {
  const todayIso = todayIsoPT();
  // Upcoming window: today through 60 days out — wide enough to cover planning
  // horizons but bounded so the page loads fast.
  const horizonEnd = addDaysIso(todayIso, 60);
  const doneSince = addDaysIso(todayIso, -7) + 'T00:00:00Z';

  const [todaysTasks, overdueTasks, upcomingTasks, completedRecent, initiatives] =
    await Promise.all([
      safe(() => getTodaysTasks(todayIso), [] as Task[]),
      safe(() => getOverdueTasks(todayIso), [] as Task[]),
      safe(() => getWeekTasks(todayIso, horizonEnd), [] as Task[]),
      safe(() => getCompletedTasksSince(doneSince), [] as Task[]),
      safe(() => getInitiatives(), [] as Initiative[]),
    ]);

  // Dedup across buckets — a task due today may appear in both todaysTasks
  // and upcomingTasks since their windows overlap.
  const seen = new Set<string>();
  const openTasks: Task[] = [];
  for (const t of [...overdueTasks, ...todaysTasks, ...upcomingTasks]) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    openTasks.push(t);
  }

  return (
    <>
      <AgentDashNav />
      <TodosPageClient
        todayIso={todayIso}
        openTasks={openTasks}
        completedRecent={completedRecent}
        initiatives={initiatives}
      />
    </>
  );
}
