'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { formatPtLongDate } from '@/lib/time';

interface TaskLike {
  id: string;
  title: string;
  status: string | null;
  type: string | null;
  toDoDate: string | null;
  datesEnd?: string | null;
  initiativeIds: string[];
}

interface InitiativeLike {
  id: string;
  name: string;
  status: string | null;
}

interface Props {
  todayIso: string;
  todaysTasks: TaskLike[];
  overdueTasks: TaskLike[];
  weekTasks: TaskLike[];
  initiatives: InitiativeLike[];
}

type ViewMode = 'all' | 'by-day' | 'by-initiative';

/**
 * Left column — padding matches the right column (28px horizontal, 24px
 * vertical). 12-hour clock + today's date in the header. Section ordering
 * per Briana's refinement:
 *   1. clock + date
 *   2. "To-Dos" label → meta line (X open · Y overdue) → card list
 *   3. View-options toggle at the bottom (All / By Day / By Initiative + link)
 *
 * Each to-do renders as a card with title + initiative + task type + date.
 */
export function DashboardLeft({
  todayIso,
  todaysTasks,
  overdueTasks,
  weekTasks,
  initiatives,
}: Props) {
  const [now, setNow] = useState<Date | null>(null);
  const [view, setView] = useState<ViewMode>('all');

  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);

  const initiativesById = useMemo(() => {
    const m = new Map<string, string>();
    for (const i of initiatives) m.set(i.id, i.name);
    return m;
  }, [initiatives]);

  const allTasks = useMemo(() => {
    // Overdue first, then today, then upcoming week (dedup by id).
    const seen = new Set<string>();
    const out: TaskLike[] = [];
    for (const t of [...overdueTasks, ...todaysTasks, ...weekTasks]) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      out.push(t);
    }
    return out;
  }, [overdueTasks, todaysTasks, weekTasks]);

  const openCount = todaysTasks.length + overdueTasks.length;
  const [timeStr, ampm] = formatTime12h(now);

  const groupedByInitiative = useMemo(() => {
    const groups = new Map<string, TaskLike[]>();
    for (const t of allTasks) {
      const key =
        t.initiativeIds && t.initiativeIds[0]
          ? initiativesById.get(t.initiativeIds[0]) ?? 'Unassigned'
          : 'Unassigned';
      const list = groups.get(key) ?? [];
      list.push(t);
      groups.set(key, list);
    }
    return [...groups.entries()];
  }, [allTasks, initiativesById]);

  const groupedByDay = useMemo(() => {
    const groups = new Map<string, TaskLike[]>();
    for (const t of allTasks) {
      const key = t.toDoDate
        ? t.toDoDate < todayIso
          ? 'Overdue'
          : t.toDoDate === todayIso
            ? 'Today'
            : t.toDoDate
        : 'Unscheduled';
      const list = groups.get(key) ?? [];
      list.push(t);
      groups.set(key, list);
    }
    return [...groups.entries()];
  }, [allTasks, todayIso]);

  return (
    <div>
      {/* Clock + date */}
      <div style={{ padding: '24px 28px 20px' }}>
        <div
          className="section-head"
          style={{ border: 'none', paddingBottom: 0, marginBottom: 8 }}
        >
          <span>Today</span>
          <span className="tag">{formatPtLongDate(new Date())}</span>
        </div>
        <div
          style={{
            fontSize: 52,
            fontWeight: 600,
            letterSpacing: '-0.04em',
            lineHeight: 0.95,
          }}
        >
          {timeStr}
          <span
            className="mono"
            style={{
              fontSize: 14,
              marginLeft: 10,
              color: 'var(--ink-3)',
              fontWeight: 500,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              verticalAlign: 'middle',
            }}
          >
            {ampm} PT
          </span>
        </div>
      </div>

      {/* To-Dos label + meta line + list */}
      <div
        style={{
          padding: '20px 28px 24px',
          borderTop: '1px solid var(--rule-strong)',
        }}
      >
        <div
          className="section-head"
          style={{ border: 'none', paddingBottom: 0, marginBottom: 10 }}
        >
          <span>To-Dos</span>
          <span className="tag">{allTasks.length}</span>
        </div>
        <p
          className="mono"
          style={{
            fontSize: 11,
            color: 'var(--ink-3)',
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            margin: '0 0 16px',
          }}
        >
          {openCount} open · {overdueTasks.length} overdue
        </p>

        {allTasks.length === 0 ? (
          <p
            className="mono"
            style={{ fontSize: 11, color: 'var(--ink-3)', margin: 0 }}
          >
            Nothing scheduled.
          </p>
        ) : view === 'by-initiative' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {groupedByInitiative.map(([initiative, tasks]) => (
              <div key={initiative}>
                <div
                  className="mono"
                  style={{
                    fontSize: 10,
                    letterSpacing: '0.16em',
                    textTransform: 'uppercase',
                    color: 'var(--ink-2)',
                    marginBottom: 6,
                    fontWeight: 500,
                  }}
                >
                  {initiative} · {tasks.length}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {tasks.slice(0, 5).map((t) => (
                    <TodoCard
                      key={t.id}
                      task={t}
                      initiativesById={initiativesById}
                      todayIso={todayIso}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : view === 'by-day' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {groupedByDay.map(([day, tasks]) => (
              <div key={day}>
                <div
                  className="mono"
                  style={{
                    fontSize: 10,
                    letterSpacing: '0.16em',
                    textTransform: 'uppercase',
                    color: day === 'Overdue' ? 'var(--ink)' : 'var(--ink-2)',
                    marginBottom: 6,
                    fontWeight: 500,
                  }}
                >
                  {day} · {tasks.length}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {tasks.slice(0, 5).map((t) => (
                    <TodoCard
                      key={t.id}
                      task={t}
                      initiativesById={initiativesById}
                      todayIso={todayIso}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {allTasks.slice(0, 10).map((t) => (
              <TodoCard
                key={t.id}
                task={t}
                initiativesById={initiativesById}
                todayIso={todayIso}
              />
            ))}
          </div>
        )}
      </div>

      {/* View options */}
      <div
        style={{
          padding: '20px 28px 28px',
          borderTop: '1px solid var(--rule-strong)',
        }}
      >
        <div
          className="section-head"
          style={{ border: 'none', paddingBottom: 0, marginBottom: 10 }}
        >
          <span>View</span>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <ViewTab label="All" active={view === 'all'} onClick={() => setView('all')} />
          <ViewTab
            label="By Day"
            active={view === 'by-day'}
            onClick={() => setView('by-day')}
          />
          <ViewTab
            label="By Initiative"
            active={view === 'by-initiative'}
            onClick={() => setView('by-initiative')}
          />
        </div>
        <Link
          href="/todos"
          className="btn"
          style={{
            display: 'block',
            textAlign: 'center',
            width: '100%',
            marginTop: 12,
          }}
        >
          Open to-do page →
        </Link>
      </div>
    </div>
  );
}

// ============================================================================

function TodoCard({
  task,
  initiativesById,
  todayIso,
}: {
  task: TaskLike;
  initiativesById: Map<string, string>;
  todayIso: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  // Optimistic local state — flips immediately on click so the strike-through
  // shows without waiting on the Notion round trip. Seeded from the task's
  // stored status so a re-render after router.refresh() preserves the mark.
  const [localDone, setLocalDone] = useState(task.status === 'Done');
  const [error, setError] = useState<string | null>(null);

  const initiative =
    task.initiativeIds && task.initiativeIds[0]
      ? initiativesById.get(task.initiativeIds[0]) ?? null
      : null;
  const done = localDone;
  const overdue = !!task.toDoDate && task.toDoDate < todayIso && !done;
  const due = task.toDoDate
    ? task.toDoDate === todayIso
      ? 'TODAY'
      : task.toDoDate < todayIso
        ? 'OVERDUE'
        : task.toDoDate.slice(5)
    : null;

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isPending || done) return;
    setError(null);
    setLocalDone(true);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/tasks/${task.id}/done`, { method: 'POST' });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || 'Failed');
        }
        // Pull fresh data from Notion so the open/overdue counts update too.
        router.refresh();
      } catch (e) {
        setLocalDone(false);
        setError(e instanceof Error ? e.message : 'Failed');
      }
    });
  };

  return (
    <div
      className="dash-card"
      style={{
        border: `1px solid ${overdue ? 'var(--ink)' : 'var(--rule)'}`,
        padding: '10px 12px',
        display: 'grid',
        gridTemplateColumns: '14px 1fr',
        gap: 10,
        alignItems: 'start',
        opacity: done ? 0.55 : 1,
        transition: 'opacity 160ms ease',
      }}
    >
      <button
        onClick={toggle}
        disabled={isPending || done}
        aria-label={done ? 'Task done' : 'Mark task done'}
        aria-pressed={done}
        style={{
          width: 12,
          height: 12,
          border: '1px solid var(--ink)',
          background: done ? 'var(--ink)' : 'transparent',
          marginTop: 3,
          padding: 0,
          cursor: isPending || done ? 'default' : 'pointer',
          borderRadius: 0,
        }}
      />
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 500,
            lineHeight: 1.3,
            textDecoration: done ? 'line-through' : 'none',
            color: done ? 'var(--ink-3)' : 'var(--ink)',
          }}
        >
          {task.title}
        </div>
        <div
          className="mono"
          style={{
            fontSize: 10,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--ink-3)',
            marginTop: 4,
            display: 'flex',
            flexWrap: 'wrap',
            gap: 6,
          }}
        >
          {initiative && <span style={{ color: 'var(--ink-2)' }}>{initiative}</span>}
          {initiative && task.type && <span style={{ color: 'var(--ink-4)' }}>·</span>}
          {task.type && <span>{task.type}</span>}
          {due && (
            <>
              <span style={{ color: 'var(--ink-4)' }}>·</span>
              <span
                style={{
                  color: overdue ? 'var(--ink)' : 'var(--ink-3)',
                  fontWeight: overdue ? 600 : 500,
                }}
              >
                {due}
              </span>
            </>
          )}
        </div>
        {error && (
          <div
            className="mono"
            style={{
              fontSize: 10,
              color: 'var(--danger)',
              marginTop: 4,
              letterSpacing: '0.04em',
            }}
          >
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

function ViewTab({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="fbtn"
      style={active ? { background: 'var(--ink)', color: 'var(--bg)', borderColor: 'var(--ink)' } : {}}
    >
      {label}
    </button>
  );
}

function formatTime12h(now: Date | null): [string, string] {
  if (!now) return ['--:--', 'AM'];
  let h = now.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  const m = String(now.getMinutes()).padStart(2, '0');
  return [`${h}:${m}`, ampm];
}
