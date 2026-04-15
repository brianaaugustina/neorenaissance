'use client';

import { useMemo, useState } from 'react';
import type { Initiative, Task } from '@/lib/notion/client';
import { TaskRow } from './TaskRow';

interface MyViewProps {
  todayIso: string;
  weekStartIso: string;
  weekEndIso: string;
  todaysTasks: Task[];
  overdueTasks: Task[];
  weekTasks: Task[];
  initiatives: Initiative[];
}

type Period = 'today' | 'week';
type WeekGroup = 'day' | 'venture';

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function ventureName(ids: string[], initiatives: Initiative[]): string {
  if (!ids.length) return 'Unassigned';
  const names = ids
    .map((id) => initiatives.find((i) => i.id === id)?.name)
    .filter(Boolean);
  return names.length ? names.join(', ') : 'Unassigned';
}

function groupTasksByVenture(tasks: Task[], initiatives: Initiative[]) {
  const groups = new Map<string, Task[]>();
  for (const t of tasks) {
    const key = ventureName(t.initiativeIds, initiatives);
    const arr = groups.get(key) ?? [];
    arr.push(t);
    groups.set(key, arr);
  }
  return Array.from(groups, ([venture, items]) => ({ venture, tasks: items })).sort(
    (a, b) => a.venture.localeCompare(b.venture),
  );
}

function groupTasksByDay(
  tasks: Task[],
  weekStartIso: string,
): Array<{ dateIso: string; label: string; tasks: Task[] }> {
  const dayMap = new Map<string, Task[]>();
  const start = new Date(weekStartIso + 'T00:00:00Z');
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    dayMap.set(d.toISOString().slice(0, 10), []);
  }
  for (const t of tasks) {
    if (!t.toDoDate) continue;
    const bucket = dayMap.get(t.toDoDate);
    if (bucket) bucket.push(t);
  }
  return Array.from(dayMap, ([dateIso, items], i) => ({
    dateIso,
    label: DAY_LABELS[i],
    tasks: items,
  }));
}

export function MyView({
  todayIso,
  weekStartIso,
  weekEndIso,
  todaysTasks,
  overdueTasks,
  weekTasks,
  initiatives,
}: MyViewProps) {
  const [period, setPeriod] = useState<Period>('today');
  const [weekGroup, setWeekGroup] = useState<WeekGroup>('day');

  const ventureGroups = useMemo(
    () =>
      period === 'today'
        ? groupTasksByVenture(todaysTasks, initiatives)
        : groupTasksByVenture(weekTasks, initiatives),
    [period, todaysTasks, weekTasks, initiatives],
  );

  const dayGroups = useMemo(
    () => groupTasksByDay(weekTasks, weekStartIso),
    [weekTasks, weekStartIso],
  );

  return (
    <section className="card p-5 md:p-6">
      <div className="flex items-baseline justify-between mb-4 gap-3 flex-wrap">
        <h2 className="serif text-2xl">My View</h2>
        <div className="flex items-center gap-1 text-xs">
          <ToggleButton active={period === 'today'} onClick={() => setPeriod('today')}>
            Today
          </ToggleButton>
          <ToggleButton active={period === 'week'} onClick={() => setPeriod('week')}>
            This Week
          </ToggleButton>
        </div>
      </div>

      {period === 'today' ? (
        <TodayView
          todayIso={todayIso}
          todaysTasks={todaysTasks}
          overdueTasks={overdueTasks}
          ventureGroups={ventureGroups}
          initiatives={initiatives}
        />
      ) : (
        <WeekView
          weekStartIso={weekStartIso}
          weekEndIso={weekEndIso}
          weekGroup={weekGroup}
          onGroupChange={setWeekGroup}
          dayGroups={dayGroups}
          ventureGroups={ventureGroups}
          initiatives={initiatives}
          todayIso={todayIso}
        />
      )}
    </section>
  );
}

function ToggleButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="px-3 py-1.5 rounded-md border transition min-h-[32px]"
      style={{
        borderColor: active ? 'var(--gold)' : 'var(--border)',
        color: active ? 'var(--gold)' : 'var(--muted)',
        background: active ? 'color-mix(in srgb, var(--gold) 8%, transparent)' : 'transparent',
      }}
    >
      {children}
    </button>
  );
}

function TodayView({
  todayIso,
  overdueTasks,
  ventureGroups,
  initiatives,
}: {
  todayIso: string;
  todaysTasks: Task[];
  overdueTasks: Task[];
  ventureGroups: Array<{ venture: string; tasks: Task[] }>;
  initiatives: Initiative[];
}) {
  return (
    <>
      <div className="muted text-xs uppercase tracking-wider mb-4">{todayIso}</div>
      {overdueTasks.length > 0 && (
        <div className="mb-6">
          <h3
            className="serif text-sm uppercase tracking-widest mb-3"
            style={{ color: 'var(--danger)' }}
          >
            Carry-forward ({overdueTasks.length})
          </h3>
          <ul className="space-y-1">
            {overdueTasks.slice(0, 12).map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                initiatives={initiatives}
                showOverdue
                todayIso={todayIso}
              />
            ))}
          </ul>
          {overdueTasks.length > 12 && (
            <p className="muted text-xs mt-2">+{overdueTasks.length - 12} more overdue</p>
          )}
        </div>
      )}

      {ventureGroups.length === 0 ? (
        <p className="muted text-sm">Nothing scheduled for today.</p>
      ) : (
        <div className="space-y-6">
          {ventureGroups.map(({ venture, tasks }) => (
            <div key={venture}>
              <h3 className="serif text-sm uppercase tracking-widest gold mb-3">{venture}</h3>
              <ul className="space-y-1">
                {tasks.map((t) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    initiatives={initiatives}
                    todayIso={todayIso}
                  />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function WeekView({
  weekStartIso,
  weekEndIso,
  weekGroup,
  onGroupChange,
  dayGroups,
  ventureGroups,
  initiatives,
  todayIso,
}: {
  weekStartIso: string;
  weekEndIso: string;
  weekGroup: WeekGroup;
  onGroupChange: (g: WeekGroup) => void;
  dayGroups: Array<{ dateIso: string; label: string; tasks: Task[] }>;
  ventureGroups: Array<{ venture: string; tasks: Task[] }>;
  initiatives: Initiative[];
  todayIso: string;
}) {
  return (
    <>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="muted text-xs uppercase tracking-wider">
          {weekStartIso} → {weekEndIso}
        </div>
        <div className="flex items-center gap-1 text-[11px]">
          <ToggleButton active={weekGroup === 'day'} onClick={() => onGroupChange('day')}>
            By day
          </ToggleButton>
          <ToggleButton
            active={weekGroup === 'venture'}
            onClick={() => onGroupChange('venture')}
          >
            By venture
          </ToggleButton>
        </div>
      </div>

      {weekGroup === 'day' ? (
        <div className="space-y-5">
          {dayGroups.map(({ dateIso, label, tasks }) => {
            const isToday = dateIso === todayIso;
            return (
              <div key={dateIso}>
                <h3
                  className="serif text-sm uppercase tracking-widest mb-2 flex items-center gap-2"
                  style={{ color: isToday ? 'var(--gold)' : 'var(--muted)' }}
                >
                  {label}
                  <span className="text-[10px] normal-case tracking-normal muted">
                    {dateIso}
                  </span>
                  {isToday && <span className="text-[10px] gold">·today</span>}
                </h3>
                {tasks.length === 0 ? (
                  <p className="muted text-xs italic pl-4">nothing planned</p>
                ) : (
                  <ul className="space-y-1">
                    {tasks.map((t) => (
                      <TaskRow
                        key={t.id}
                        task={t}
                        initiatives={initiatives}
                        todayIso={todayIso}
                      />
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      ) : ventureGroups.length === 0 ? (
        <p className="muted text-sm">No tasks scheduled this week.</p>
      ) : (
        <div className="space-y-6">
          {ventureGroups.map(({ venture, tasks }) => (
            <div key={venture}>
              <h3 className="serif text-sm uppercase tracking-widest gold mb-3">{venture}</h3>
              <ul className="space-y-1">
                {tasks
                  .sort((a, b) => (a.toDoDate ?? '').localeCompare(b.toDoDate ?? ''))
                  .map((t) => (
                    <TaskRow
                      key={t.id}
                      task={t}
                      initiatives={initiatives}
                      todayIso={todayIso}
                      showDate
                    />
                  ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
