import { AgentDashNav } from '@/components/AgentDashNav';
import { SchedulePageClient } from '@/components/SchedulePageClient';
import { AGENT_REGISTRY } from '@/lib/agents/registry';
import {
  getInitiatives,
  getOverdueTasks,
  getScheduledContentInWindow,
  getWeekTasks,
  type Initiative,
  type ScheduledContentEntry,
  type Task,
} from '@/lib/notion/client';
import {
  getCronOccurrencesInWindow,
  humaniseSchedule,
  type CronOccurrence,
} from '@/lib/schedule/crons';
import { addDaysIso, todayIsoPT, weekdayPT } from '@/lib/time';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function mondayOfWeek(dateIso: string): string {
  const d = new Date(`${dateIso}T12:00:00Z`);
  const dow = weekdayPT(d);
  const offset = (dow + 6) % 7;
  return addDaysIso(dateIso, -offset);
}

function parseWeekParam(raw: string | undefined): string {
  const today = todayIsoPT();
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return mondayOfWeek(today);
  return mondayOfWeek(raw);
}

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const params = await searchParams;
  const weekStart = parseWeekParam(params.week);
  const weekEnd = addDaysIso(weekStart, 6);
  const todayIso = todayIsoPT();

  // Cron window — pad by ±1 day so PT bucketing catches edge firings.
  const startUtc = new Date(`${addDaysIso(weekStart, -1)}T00:00:00Z`);
  const endUtc = new Date(`${addDaysIso(weekEnd, 1)}T23:59:59Z`);

  const cronOccurrences: CronOccurrence[] = getCronOccurrencesInWindow(
    startUtc,
    endUtc,
  ).filter((c) => c.ptDateIso >= weekStart && c.ptDateIso <= weekEnd);

  // Overdue tasks surface on today's column so nothing gets buried; this-week
  // tasks slot into their due-date column.
  const [contentEntries, tasksThisWeek, overdueTasks, initiatives] =
    await Promise.all([
      safe(
        () =>
          getScheduledContentInWindow(
            `${weekStart}T00:00:00-08:00`,
            `${weekEnd}T23:59:59-08:00`,
          ),
        [] as ScheduledContentEntry[],
      ),
      safe(() => getWeekTasks(weekStart, weekEnd), [] as Task[]),
      // Only include overdue on the current week view — pulling them into
      // historical weeks would be misleading.
      weekStart <= todayIso && todayIso <= weekEnd
        ? safe(() => getOverdueTasks(todayIso), [] as Task[])
        : Promise.resolve([] as Task[]),
      safe(() => getInitiatives(), [] as Initiative[]),
    ]);

  // Dedup tasks — a task due today may appear in both calls.
  const seenTaskIds = new Set<string>();
  const tasks: Task[] = [];
  for (const t of [...overdueTasks, ...tasksThisWeek]) {
    if (seenTaskIds.has(t.id)) continue;
    seenTaskIds.add(t.id);
    tasks.push(t);
  }

  const cronOccurrencesSerialisable = cronOccurrences.map((c) => ({
    ...c,
    fireAtIso: c.fireAt.toISOString(),
    scheduleHuman: humaniseSchedule(c.schedule),
  }));

  return (
    <>
      <AgentDashNav agentCount={AGENT_REGISTRY.length} />
      <SchedulePageClient
        todayIso={todayIso}
        weekStart={weekStart}
        weekEnd={weekEnd}
        cronOccurrences={cronOccurrencesSerialisable}
        contentEntries={contentEntries}
        tasks={tasks}
        initiatives={initiatives}
        agents={AGENT_REGISTRY.map((a) => ({
          id: a.id,
          aliases: a.aliases ?? [],
          name: a.name,
          venture: a.venture,
          layer: a.layer,
        }))}
      />
    </>
  );
}
