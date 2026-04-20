'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { Initiative, Task } from '@/lib/notion/client';
import { addDaysIso } from '@/lib/time';

type Filter = 'all' | 'overdue' | 'today' | 'week' | 'later' | 'unscheduled';
type GroupBy = 'day' | 'initiative' | 'flat';

interface Props {
  todayIso: string;
  openTasks: Task[];
  completedRecent: Task[];
  initiatives: Initiative[];
}

export function TodosPageClient({
  todayIso,
  openTasks,
  completedRecent,
  initiatives,
}: Props) {
  const [filter, setFilter] = useState<Filter>('all');
  const [groupBy, setGroupBy] = useState<GroupBy>('flat');
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [showDone, setShowDone] = useState(false);

  const initiativesById = useMemo(() => {
    const m = new Map<string, string>();
    for (const i of initiatives) m.set(i.id, i.name);
    return m;
  }, [initiatives]);

  const weekEnd = addDaysIso(todayIso, 7);

  const visible = useMemo(() => {
    const byFilter = openTasks.filter((t) => {
      if (hiddenIds.has(t.id)) return false;
      const d = t.toDoDate;
      switch (filter) {
        case 'overdue':
          return !!d && d < todayIso;
        case 'today':
          return d === todayIso;
        case 'week':
          return !!d && d >= todayIso && d <= weekEnd;
        case 'later':
          return !!d && d > weekEnd;
        case 'unscheduled':
          return !d;
        default:
          return true;
      }
    });
    // Stable sort: overdue (by date asc) → today → upcoming (date asc) → unscheduled
    return byFilter.sort((a, b) => {
      const da = a.toDoDate ?? '9999-12-31';
      const db = b.toDoDate ?? '9999-12-31';
      return da.localeCompare(db);
    });
  }, [openTasks, hiddenIds, filter, todayIso, weekEnd]);

  const overdueCount = openTasks.filter(
    (t) => t.toDoDate && t.toDoDate < todayIso,
  ).length;
  const todayCount = openTasks.filter((t) => t.toDoDate === todayIso).length;
  const weekCount = openTasks.filter(
    (t) => t.toDoDate && t.toDoDate >= todayIso && t.toDoDate <= weekEnd,
  ).length;
  const laterCount = openTasks.filter(
    (t) => t.toDoDate && t.toDoDate > weekEnd,
  ).length;
  const unscheduledCount = openTasks.filter((t) => !t.toDoDate).length;

  const grouped = useMemo(() => {
    if (groupBy === 'flat') {
      return [['All', visible] as [string, Task[]]];
    }
    const groups = new Map<string, Task[]>();
    for (const t of visible) {
      let key: string;
      if (groupBy === 'initiative') {
        key =
          t.initiativeIds[0]
            ? initiativesById.get(t.initiativeIds[0]) ?? 'Unassigned'
            : 'Unassigned';
      } else {
        key = !t.toDoDate
          ? 'Unscheduled'
          : t.toDoDate < todayIso
            ? 'Overdue'
            : t.toDoDate === todayIso
              ? 'Today'
              : t.toDoDate;
      }
      const list = groups.get(key) ?? [];
      list.push(t);
      groups.set(key, list);
    }
    // Order: Overdue → Today → dated asc → Unscheduled (or alpha for initiatives)
    const dayOrder = (key: string): number => {
      if (key === 'Overdue') return -2;
      if (key === 'Today') return -1;
      if (key === 'Unscheduled') return 9_999_999_999;
      const d = Date.parse(`${key}T00:00:00Z`);
      return Number.isNaN(d) ? 9_999_999_998 : d;
    };
    const entries = [...groups.entries()];
    if (groupBy === 'day') {
      entries.sort((a, b) => dayOrder(a[0]) - dayOrder(b[0]));
    } else {
      entries.sort((a, b) => a[0].localeCompare(b[0]));
    }
    return entries;
  }, [visible, groupBy, todayIso, initiativesById]);

  const hideTask = (id: string) =>
    setHiddenIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });

  return (
    <main style={{ padding: '32px 40px 80px', maxWidth: 1400, margin: '0 auto' }}>
      {/* Hero */}
      <div style={{ marginBottom: 32 }}>
        <p className="eyebrow">Operator · Open Work</p>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr auto',
            alignItems: 'end',
            gap: 40,
          }}
        >
          <div>
            <h1 className="title" style={{ fontSize: 72 }}>
              To-Dos
              <span className="count">({openTasks.length})</span>
            </h1>
            <p className="sub">
              Every open task across ventures. Overdue, today, planned, and
              unscheduled work in one view. Syncs with the Notion To-Do DB.
            </p>
          </div>
          <div
            className="mono"
            style={{
              textAlign: 'right',
              fontSize: 11,
              color: 'var(--ink-2)',
              lineHeight: 1.7,
              letterSpacing: '0.05em',
            }}
          >
            {overdueCount} OVERDUE
            <br />
            {todayCount} TODAY · {weekCount} THIS WEEK
            <br />
            {laterCount} LATER · {unscheduledCount} UNSCHEDULED
          </div>
        </div>
      </div>

      {/* Filter + group controls */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 16,
          alignItems: 'center',
          paddingBottom: 14,
          marginBottom: 0,
          borderBottom: '1px solid var(--rule-strong)',
        }}
      >
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Chip active={filter === 'all'} onClick={() => setFilter('all')}>
            All · {openTasks.length}
          </Chip>
          <Chip active={filter === 'overdue'} onClick={() => setFilter('overdue')}>
            Overdue · {overdueCount}
          </Chip>
          <Chip active={filter === 'today'} onClick={() => setFilter('today')}>
            Today · {todayCount}
          </Chip>
          <Chip active={filter === 'week'} onClick={() => setFilter('week')}>
            This week · {weekCount}
          </Chip>
          <Chip active={filter === 'later'} onClick={() => setFilter('later')}>
            Later · {laterCount}
          </Chip>
          <Chip
            active={filter === 'unscheduled'}
            onClick={() => setFilter('unscheduled')}
          >
            Unscheduled · {unscheduledCount}
          </Chip>
        </div>

        <div
          style={{
            marginLeft: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <span
            className="mono"
            style={{
              fontSize: 10,
              color: 'var(--ink-3)',
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              marginRight: 4,
            }}
          >
            Group
          </span>
          <Chip active={groupBy === 'day'} onClick={() => setGroupBy('day')}>
            By day
          </Chip>
          <Chip
            active={groupBy === 'initiative'}
            onClick={() => setGroupBy('initiative')}
          >
            By initiative
          </Chip>
          <Chip active={groupBy === 'flat'} onClick={() => setGroupBy('flat')}>
            Flat
          </Chip>
        </div>
      </div>

      {/* Task groups */}
      <div style={{ marginTop: 24 }}>
        {/* Hint when by-initiative groups everything under Unassigned */}
        {groupBy === 'initiative' &&
          grouped.length === 1 &&
          grouped[0][0] === 'Unassigned' &&
          visible.length > 0 && (
            <p
              className="mono"
              style={{
                fontSize: 11,
                color: 'var(--ink-3)',
                letterSpacing: '0.04em',
                marginBottom: 16,
                padding: '10px 12px',
                border: '1px dashed var(--rule-strong)',
              }}
            >
              No tasks have an Initiative relation set in Notion — everything is
              grouped as Unassigned. Add Initiative links in the Notion To-Do DB to
              use this view.
            </p>
          )}

        {grouped.length === 0 || visible.length === 0 ? (
          <p
            className="mono"
            style={{
              fontSize: 12,
              color: 'var(--ink-3)',
              letterSpacing: '0.05em',
              paddingTop: 40,
            }}
          >
            {openTasks.length === 0
              ? 'Nothing open. Inbox zero.'
              : 'Nothing matches this filter.'}
          </p>
        ) : (
          grouped.map(([groupLabel, tasks]) => (
            <section key={groupLabel} style={{ marginBottom: 28 }}>
              {groupBy !== 'flat' && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 10,
                    paddingBottom: 8,
                    marginBottom: 0,
                    borderBottom: '1px solid var(--rule)',
                  }}
                >
                  <h2
                    className="mono"
                    style={{
                      fontSize: 11,
                      letterSpacing: '0.16em',
                      textTransform: 'uppercase',
                      color:
                        groupLabel === 'Overdue'
                          ? 'var(--ink)'
                          : 'var(--ink-2)',
                      fontWeight: 600,
                      margin: 0,
                    }}
                  >
                    {formatGroupLabel(groupLabel, todayIso)}
                  </h2>
                  <span
                    className="mono"
                    style={{
                      fontSize: 11,
                      color: 'var(--ink-3)',
                      letterSpacing: '0.05em',
                    }}
                  >
                    {tasks.length}
                  </span>
                </div>
              )}
              <div>
                {tasks.map((t) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    todayIso={todayIso}
                    initiativesById={initiativesById}
                    onHide={() => hideTask(t.id)}
                  />
                ))}
              </div>
            </section>
          ))
        )}
      </div>

      {/* Recently done */}
      {completedRecent.length > 0 && (
        <section style={{ marginTop: 48 }}>
          <button
            onClick={() => setShowDone((s) => !s)}
            className="eyebrow"
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              color: 'var(--ink-2)',
            }}
          >
            {showDone ? '▾' : '▸'} Done last 7 days ({completedRecent.length})
          </button>
          {showDone && (
            <div style={{ marginTop: 12 }}>
              {completedRecent.map((t) => (
                <div
                  key={t.id}
                  className="dash-card"
                  style={{
                    borderBottom: '1px solid var(--rule)',
                    padding: '12px 14px',
                    display: 'grid',
                    gridTemplateColumns: '14px 1fr auto',
                    gap: 12,
                    alignItems: 'center',
                  }}
                >
                  <span
                    style={{
                      width: 12,
                      height: 12,
                      border: '1px solid var(--ink)',
                      background: 'var(--ink)',
                      display: 'inline-block',
                    }}
                  />
                  <div
                    style={{
                      fontSize: 13,
                      color: 'var(--ink-3)',
                      textDecoration: 'line-through',
                    }}
                  >
                    {t.title}
                  </div>
                  <span
                    className="mono"
                    style={{
                      fontSize: 10,
                      color: 'var(--ink-3)',
                      letterSpacing: '0.05em',
                    }}
                  >
                    {t.toDoDate ?? ''}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------
// Task row
// ---------------------------------------------------------------------------
function TaskRow({
  task,
  todayIso,
  initiativesById,
  onHide,
}: {
  task: Task;
  todayIso: string;
  initiativesById: Map<string, string>;
  onHide: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [newDate, setNewDate] = useState(task.toDoDate ?? todayIso);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const initiative = task.initiativeIds[0]
    ? initiativesById.get(task.initiativeIds[0]) ?? null
    : null;
  const overdue = !!task.toDoDate && task.toDoDate < todayIso;
  const isToday = task.toDoDate === todayIso;
  const dueLabel = task.toDoDate
    ? task.toDoDate < todayIso
      ? `Overdue · ${task.toDoDate.slice(5)}`
      : task.toDoDate === todayIso
        ? 'Today'
        : task.toDoDate.slice(5)
    : 'Unscheduled';

  const markDone = () => {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/tasks/${task.id}/done`, { method: 'POST' });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || 'Failed');
        }
        setDone(true);
        setTimeout(() => {
          onHide();
          router.refresh();
        }, 180);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed');
      }
    });
  };

  const reschedule = () => {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/tasks/${task.id}/reschedule`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ toDoDate: newDate }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || 'Failed');
        }
        setRescheduleOpen(false);
        onHide();
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed');
      }
    });
  };

  return (
    <div
      className="dash-card"
      style={{
        borderLeft: overdue
          ? '2px solid var(--ink)'
          : isToday
            ? '2px solid var(--ink-2)'
            : '2px solid transparent',
        borderBottom: '1px solid var(--rule)',
        padding: '14px 16px',
        display: 'grid',
        gridTemplateColumns: '18px 1fr auto auto',
        gap: 14,
        alignItems: 'center',
        opacity: done ? 0.4 : 1,
        transition: 'opacity 160ms ease',
      }}
    >
      <button
        onClick={markDone}
        disabled={isPending || done}
        aria-label="Mark done"
        style={{
          width: 16,
          height: 16,
          border: '1px solid var(--ink)',
          background: done ? 'var(--ink)' : 'transparent',
          cursor: isPending || done ? 'default' : 'pointer',
          padding: 0,
          borderRadius: 0,
        }}
      />

      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: 14,
            fontWeight: 500,
            lineHeight: 1.35,
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
            alignItems: 'center',
          }}
        >
          {initiative && <span style={{ color: 'var(--ink-2)' }}>{initiative}</span>}
          {initiative && task.type && <span style={{ color: 'var(--ink-4)' }}>·</span>}
          {task.type && <span>{task.type}</span>}
          {task.status && (
            <>
              <span style={{ color: 'var(--ink-4)' }}>·</span>
              <span>{task.status}</span>
            </>
          )}
        </div>
        {rescheduleOpen && (
          <div
            style={{
              marginTop: 10,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexWrap: 'wrap',
            }}
          >
            <input
              type="date"
              value={newDate}
              onChange={(e) => setNewDate(e.target.value)}
              disabled={isPending}
              className="bg-transparent border px-3 py-2 text-xs"
              style={{ borderRadius: 0, borderColor: 'var(--rule)' }}
            />
            <button
              onClick={reschedule}
              disabled={isPending}
              className="btn"
              style={{ padding: '6px 12px', fontSize: 12 }}
            >
              Save
            </button>
            <button
              onClick={() => setRescheduleOpen(false)}
              disabled={isPending}
              className="btn ghost"
              style={{ padding: '6px 12px', fontSize: 12 }}
            >
              Cancel
            </button>
          </div>
        )}
        {error && (
          <p
            className="mono"
            style={{
              fontSize: 10,
              color: 'var(--danger)',
              marginTop: 6,
              letterSpacing: '0.04em',
            }}
          >
            {error}
          </p>
        )}
      </div>

      <span
        className="mono"
        style={{
          fontSize: 11,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: overdue ? 'var(--ink)' : isToday ? 'var(--ink-2)' : 'var(--ink-3)',
          fontWeight: overdue ? 600 : 500,
          whiteSpace: 'nowrap',
        }}
      >
        {dueLabel}
      </span>

      {!rescheduleOpen && !done && (
        <button
          onClick={() => setRescheduleOpen(true)}
          disabled={isPending}
          className="btn ghost"
          style={{ padding: '6px 10px', fontSize: 11 }}
        >
          Reschedule
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function Chip({
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
      className="fbtn"
      style={
        active
          ? {
              background: 'var(--ink)',
              color: 'var(--bg)',
              borderColor: 'var(--ink)',
            }
          : {}
      }
    >
      {children}
    </button>
  );
}

function formatGroupLabel(key: string, todayIso: string): string {
  if (key === 'Overdue' || key === 'Today' || key === 'Unscheduled') return key;
  // If it's a date string, render as "Mon · Apr 22" or "Tomorrow".
  if (/^\d{4}-\d{2}-\d{2}$/.test(key)) {
    const d = new Date(`${key}T12:00:00Z`);
    const diffDays = Math.round(
      (new Date(`${key}T00:00:00Z`).getTime() -
        new Date(`${todayIso}T00:00:00Z`).getTime()) /
        86_400_000,
    );
    if (diffDays === 1) return 'Tomorrow';
    const weekday = d.toLocaleDateString('en-US', { weekday: 'short' });
    const monthDay = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `${weekday} · ${monthDay}`;
  }
  return key;
}
