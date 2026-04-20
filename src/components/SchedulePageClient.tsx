'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import type {
  Initiative,
  ScheduledContentEntry,
  Task,
} from '@/lib/notion/client';
import {
  addDaysIso,
  APP_TIMEZONE,
  formatPtTime,
} from '@/lib/time';

interface CronOccurrenceView {
  path: string;
  schedule: string;
  scheduleHuman: string;
  fireAtIso: string;
  ptDateIso: string;
  agentId: string;
  agentName: string;
  endpointLabel: string;
}

interface AgentView {
  id: string;
  aliases: string[];
  name: string;
  venture: string;
  layer: 'execution' | 'strategy' | 'meta';
}

interface Props {
  todayIso: string;
  weekStart: string;
  weekEnd: string;
  cronOccurrences: CronOccurrenceView[];
  contentEntries: ScheduledContentEntry[];
  tasks: Task[];
  initiatives: Initiative[];
  agents: AgentView[];
}

type View = 'week' | 'initiative';
type ShowKind = 'all' | 'tasks' | 'crons' | 'content';

export function SchedulePageClient({
  todayIso,
  weekStart,
  weekEnd,
  cronOccurrences,
  contentEntries,
  tasks,
  initiatives,
  agents,
}: Props) {
  const [view, setView] = useState<View>('week');
  const [show, setShow] = useState<ShowKind>('all');

  const prevWeek = addDaysIso(weekStart, -7);
  const nextWeek = addDaysIso(weekStart, 7);

  const initiativeNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const i of initiatives) m.set(i.id, i.name);
    return m;
  }, [initiatives]);

  const agentVentureById = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of agents) {
      m.set(a.id, a.venture);
      for (const alias of a.aliases) m.set(alias, a.venture);
    }
    return m;
  }, [agents]);

  const showTasks = show === 'all' || show === 'tasks';
  const showCrons = show === 'all' || show === 'crons';
  const showContent = show === 'all' || show === 'content';

  const totalCrons = cronOccurrences.length;
  const totalContent = contentEntries.length;
  const totalTasks = tasks.length;

  return (
    <main style={{ padding: '32px 40px 80px', maxWidth: 1600, margin: '0 auto' }}>
      {/* Hero */}
      <div style={{ marginBottom: 24 }}>
        <p className="eyebrow">Calendar · Operator + Agents</p>
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
              Schedule
              <span className="count">
                ({totalTasks + totalCrons + totalContent})
              </span>
            </h1>
            <p className="sub">
              One week of work — your to-dos, every cron firing, every content
              publish. Briana + the agents on the same page.
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
            {totalTasks} TASK{totalTasks === 1 ? '' : 'S'}
            <br />
            {totalCrons} CRON · {totalContent} CONTENT
            <br />
            {formatWeekRange(weekStart, weekEnd).toUpperCase()}
          </div>
        </div>
      </div>

      {/* Controls row: view + show filters + week nav */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 16,
          alignItems: 'center',
          paddingBottom: 14,
          borderBottom: '1px solid var(--rule-strong)',
        }}
      >
        <div style={{ display: 'flex', gap: 6 }}>
          <Chip active={view === 'week'} onClick={() => setView('week')}>
            By day
          </Chip>
          <Chip
            active={view === 'initiative'}
            onClick={() => setView('initiative')}
          >
            By initiative
          </Chip>
        </div>

        <div
          style={{
            display: 'flex',
            gap: 6,
            alignItems: 'center',
            paddingLeft: 16,
            borderLeft: '1px solid var(--rule)',
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
            Show
          </span>
          <Chip active={show === 'all'} onClick={() => setShow('all')}>
            All
          </Chip>
          <Chip active={show === 'tasks'} onClick={() => setShow('tasks')}>
            Tasks · {totalTasks}
          </Chip>
          <Chip active={show === 'crons'} onClick={() => setShow('crons')}>
            Crons · {totalCrons}
          </Chip>
          <Chip active={show === 'content'} onClick={() => setShow('content')}>
            Content · {totalContent}
          </Chip>
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <Link
            href={`/schedule?week=${prevWeek}`}
            className="btn ghost"
            style={{ padding: '8px 14px', fontSize: 13 }}
          >
            ← Previous
          </Link>
          {weekStart !== mondayOfWeekFromIso(todayIso) && (
            <Link
              href="/schedule"
              className="btn ghost"
              style={{ padding: '8px 14px', fontSize: 13 }}
            >
              This week
            </Link>
          )}
          <Link
            href={`/schedule?week=${nextWeek}`}
            className="btn ghost"
            style={{ padding: '8px 14px', fontSize: 13 }}
          >
            Next →
          </Link>
        </div>
      </div>

      {/* Views */}
      {view === 'week' ? (
        <WeekView
          todayIso={todayIso}
          weekStart={weekStart}
          cronOccurrences={cronOccurrences}
          contentEntries={contentEntries}
          tasks={tasks}
          initiativeNameById={initiativeNameById}
          showTasks={showTasks}
          showCrons={showCrons}
          showContent={showContent}
        />
      ) : (
        <InitiativeView
          cronOccurrences={cronOccurrences}
          contentEntries={contentEntries}
          tasks={tasks}
          initiatives={initiatives}
          initiativeNameById={initiativeNameById}
          agentVentureById={agentVentureById}
          showTasks={showTasks}
          showCrons={showCrons}
          showContent={showContent}
          todayIso={todayIso}
        />
      )}

      {/* Registered crons cheat-sheet */}
      <section style={{ marginTop: 40 }}>
        <p className="eyebrow">Registered crons</p>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
            gap: 0,
            marginTop: 12,
            borderTop: '1px solid var(--rule)',
            borderLeft: '1px solid var(--rule)',
          }}
        >
          {uniqueCronSummary(cronOccurrences).map((c) => (
            <div
              key={`${c.agentName}-${c.endpointLabel}-${c.schedule}`}
              style={{
                borderRight: '1px solid var(--rule)',
                borderBottom: '1px solid var(--rule)',
                padding: '10px 12px',
                fontSize: 12,
              }}
            >
              <div style={{ fontWeight: 500, color: 'var(--ink)' }}>
                {c.agentName}
              </div>
              <div
                className="mono"
                style={{
                  fontSize: 11,
                  color: 'var(--ink-3)',
                  marginTop: 2,
                  letterSpacing: '0.04em',
                }}
              >
                {c.endpointLabel.toLowerCase()} · {c.scheduleHuman}
              </div>
            </div>
          ))}
          {cronOccurrences.length === 0 && (
            <p
              style={{
                fontSize: 12,
                color: 'var(--ink-3)',
                padding: '10px 12px',
              }}
            >
              No crons fire this week.
            </p>
          )}
        </div>
      </section>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Week view — 7-column grid
// ---------------------------------------------------------------------------
function WeekView({
  todayIso,
  weekStart,
  cronOccurrences,
  contentEntries,
  tasks,
  initiativeNameById,
  showTasks,
  showCrons,
  showContent,
}: {
  todayIso: string;
  weekStart: string;
  cronOccurrences: CronOccurrenceView[];
  contentEntries: ScheduledContentEntry[];
  tasks: Task[];
  initiativeNameById: Map<string, string>;
  showTasks: boolean;
  showCrons: boolean;
  showContent: boolean;
}) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const iso = addDaysIso(weekStart, i);
    const d = new Date(`${iso}T12:00:00Z`);
    return {
      iso,
      weekdayShort: d.toLocaleDateString('en-US', {
        timeZone: APP_TIMEZONE,
        weekday: 'short',
      }),
      dayNum: d.toLocaleDateString('en-US', {
        timeZone: APP_TIMEZONE,
        day: 'numeric',
      }),
      isToday: iso === todayIso,
    };
  });

  // Bucket tasks: overdue tasks + today's tasks land on the today column.
  // Unscheduled tasks land at the end of today's column too.
  const bucketForTask = (t: Task): string | null => {
    const d = t.toDoDate;
    if (!d) return todayIso >= weekStart ? todayIso : null;
    if (d < todayIso) return todayIso >= weekStart ? todayIso : null;
    if (d >= weekStart && d <= days[6].iso) return d;
    return null;
  };

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(7, 1fr)',
        borderLeft: '1px solid var(--rule)',
      }}
    >
      {days.map((day) => {
        const dayCrons = showCrons
          ? cronOccurrences.filter((c) => c.ptDateIso === day.iso)
          : [];
        const dayContent = showContent
          ? contentEntries.filter(
              (c) => (c.publishDate ?? '').slice(0, 10) === day.iso,
            )
          : [];
        const dayTasks = showTasks
          ? tasks.filter((t) => bucketForTask(t) === day.iso)
          : [];

        const hasAnything =
          dayCrons.length + dayContent.length + dayTasks.length > 0;

        return (
          <div
            key={day.iso}
            style={{
              borderRight: '1px solid var(--rule)',
              borderBottom: '1px solid var(--rule)',
              minHeight: 460,
              padding: '16px 14px',
              background: day.isToday ? 'var(--bg-3)' : 'transparent',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                gap: 4,
                paddingBottom: 8,
                borderBottom: '1px solid var(--rule)',
              }}
            >
              <div
                className="mono"
                style={{
                  fontSize: 10,
                  letterSpacing: '0.1em',
                  color: day.isToday ? 'var(--ink)' : 'var(--ink-3)',
                  textTransform: 'uppercase',
                  fontWeight: day.isToday ? 600 : 400,
                }}
              >
                {day.weekdayShort}
              </div>
              <div
                style={{
                  fontSize: 20,
                  fontWeight: 600,
                  color: day.isToday ? 'var(--ink)' : 'var(--ink-2)',
                  letterSpacing: '-0.02em',
                }}
              >
                {day.dayNum}
              </div>
            </div>

            {!hasAnything && (
              <p
                className="mono"
                style={{
                  fontSize: 10,
                  color: 'var(--ink-3)',
                  letterSpacing: '0.05em',
                  marginTop: 4,
                }}
              >
                —
              </p>
            )}

            {/* Tasks first — they're yours. */}
            {dayTasks.map((t) => (
              <TaskPill
                key={t.id}
                task={t}
                initiativeNameById={initiativeNameById}
                todayIso={todayIso}
              />
            ))}

            {/* Crons */}
            {dayCrons.map((c) => (
              <CronPill key={`${c.path}-${c.fireAtIso}`} occ={c} />
            ))}

            {/* Content */}
            {dayContent
              .filter((c) => c.title)
              .map((c) => <ContentPill key={c.id} entry={c} />)}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Initiative view — rows per venture/initiative with everything that rolls up.
// Crons group by agent.venture; tasks group by their Initiative relation name
// (falling back to "Unassigned"); content entries group as "Content calendar"
// since the Content DB row doesn't carry venture metadata.
// ---------------------------------------------------------------------------
function InitiativeView({
  cronOccurrences,
  contentEntries,
  tasks,
  initiativeNameById,
  agentVentureById,
  showTasks,
  showCrons,
  showContent,
  todayIso,
}: {
  cronOccurrences: CronOccurrenceView[];
  contentEntries: ScheduledContentEntry[];
  tasks: Task[];
  initiatives: Initiative[];
  initiativeNameById: Map<string, string>;
  agentVentureById: Map<string, string>;
  showTasks: boolean;
  showCrons: boolean;
  showContent: boolean;
  todayIso: string;
}) {
  interface Row {
    key: string;
    tasks: Task[];
    crons: CronOccurrenceView[];
    content: ScheduledContentEntry[];
  }
  const rowsByKey = new Map<string, Row>();
  const bump = (key: string): Row => {
    let r = rowsByKey.get(key);
    if (!r) {
      r = { key, tasks: [], crons: [], content: [] };
      rowsByKey.set(key, r);
    }
    return r;
  };

  if (showTasks) {
    for (const t of tasks) {
      const name = t.initiativeIds[0]
        ? initiativeNameById.get(t.initiativeIds[0]) ?? 'Unassigned'
        : 'Unassigned';
      bump(name).tasks.push(t);
    }
  }
  if (showCrons) {
    for (const c of cronOccurrences) {
      const venture = agentVentureById.get(c.agentId) ?? 'Other';
      bump(venture).crons.push(c);
    }
  }
  if (showContent) {
    for (const c of contentEntries) {
      if (!c.title) continue;
      bump('Content calendar').content.push(c);
    }
  }

  const sortedRows = [...rowsByKey.values()].sort((a, b) => {
    // Push Unassigned + Content calendar to the bottom
    const rank = (k: string): number => {
      if (k === 'Unassigned') return 2;
      if (k === 'Content calendar') return 1;
      return 0;
    };
    return rank(a.key) - rank(b.key) || a.key.localeCompare(b.key);
  });

  if (sortedRows.length === 0) {
    return (
      <p
        className="mono"
        style={{
          fontSize: 12,
          color: 'var(--ink-3)',
          letterSpacing: '0.05em',
          paddingTop: 40,
        }}
      >
        Nothing scheduled this week.
      </p>
    );
  }

  return (
    <div style={{ marginTop: 0 }}>
      {sortedRows.map((row) => {
        const total = row.tasks.length + row.crons.length + row.content.length;
        return (
          <section
            key={row.key}
            style={{
              borderBottom: '1px solid var(--rule)',
              padding: '18px 0',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: 10,
                marginBottom: 12,
              }}
            >
              <h2
                style={{
                  fontSize: 18,
                  fontWeight: 600,
                  letterSpacing: '-0.01em',
                  margin: 0,
                }}
              >
                {row.key}
              </h2>
              <span
                className="mono"
                style={{
                  fontSize: 11,
                  color: 'var(--ink-3)',
                  letterSpacing: '0.04em',
                }}
              >
                {total} item{total === 1 ? '' : 's'}
                {row.tasks.length > 0 && ` · ${row.tasks.length} task${row.tasks.length === 1 ? '' : 's'}`}
                {row.crons.length > 0 && ` · ${row.crons.length} cron`}
                {row.content.length > 0 && ` · ${row.content.length} content`}
              </span>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
                gap: 8,
              }}
            >
              {row.tasks.map((t) => (
                <TaskPill
                  key={t.id}
                  task={t}
                  initiativeNameById={initiativeNameById}
                  todayIso={todayIso}
                />
              ))}
              {row.crons.map((c) => (
                <CronPill key={`${c.path}-${c.fireAtIso}`} occ={c} />
              ))}
              {row.content.map((c) => (
                <ContentPill key={c.id} entry={c} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pills
// ---------------------------------------------------------------------------
function TaskPill({
  task,
  initiativeNameById,
  todayIso,
}: {
  task: Task;
  initiativeNameById: Map<string, string>;
  todayIso: string;
}) {
  const initiative = task.initiativeIds[0]
    ? initiativeNameById.get(task.initiativeIds[0])
    : null;
  const overdue = !!task.toDoDate && task.toDoDate < todayIso;
  const dueLabel = !task.toDoDate
    ? 'No date'
    : task.toDoDate < todayIso
      ? `Overdue · ${task.toDoDate.slice(5)}`
      : task.toDoDate === todayIso
        ? 'Today'
        : task.toDoDate.slice(5);

  return (
    <Link
      href="/todos"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        padding: '8px 10px',
        border: `1px dashed ${overdue ? 'var(--ink)' : 'var(--ink-2)'}`,
        background: 'transparent',
        textDecoration: 'none',
        color: 'inherit',
      }}
    >
      <div
        className="mono"
        style={{
          fontSize: 10,
          letterSpacing: '0.06em',
          color: overdue ? 'var(--ink)' : 'var(--ink-3)',
          textTransform: 'uppercase',
          fontWeight: overdue ? 600 : 400,
        }}
      >
        {dueLabel} · task
      </div>
      <div
        style={{
          fontSize: 12,
          fontWeight: 500,
          letterSpacing: '-0.005em',
          color: 'var(--ink)',
          lineHeight: 1.3,
        }}
      >
        {task.title}
      </div>
      {(initiative || task.type) && (
        <div
          className="mono"
          style={{
            fontSize: 10,
            color: 'var(--ink-3)',
            letterSpacing: '0.04em',
          }}
        >
          {initiative ?? ''}
          {initiative && task.type ? ' · ' : ''}
          {task.type ?? ''}
        </div>
      )}
    </Link>
  );
}

function CronPill({ occ }: { occ: CronOccurrenceView }) {
  return (
    <Link
      href={`/agents/${occ.agentId}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        padding: '8px 10px',
        border: '1px solid var(--rule-strong)',
        background: 'transparent',
        textDecoration: 'none',
        color: 'inherit',
      }}
    >
      <div
        className="mono"
        style={{
          fontSize: 10,
          letterSpacing: '0.06em',
          color: 'var(--ink-3)',
          textTransform: 'uppercase',
        }}
      >
        {formatPtTime(occ.fireAtIso)} · cron
      </div>
      <div
        style={{
          fontSize: 12,
          fontWeight: 500,
          letterSpacing: '-0.005em',
          color: 'var(--ink)',
          lineHeight: 1.3,
        }}
      >
        {occ.agentName}
      </div>
      <div
        className="mono"
        style={{
          fontSize: 10,
          color: 'var(--ink-3)',
          letterSpacing: '0.04em',
        }}
      >
        {occ.endpointLabel.toLowerCase()}
      </div>
    </Link>
  );
}

function ContentPill({ entry }: { entry: ScheduledContentEntry }) {
  const time = entry.publishDate ? formatPtTime(entry.publishDate) : '';
  const type = entry.contentType[0] ?? 'Content';
  return (
    <div
      style={{
        padding: '8px 10px',
        background: 'var(--ink)',
        color: 'var(--bg)',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
      }}
    >
      <div
        className="mono"
        style={{
          fontSize: 10,
          letterSpacing: '0.06em',
          opacity: 0.65,
          textTransform: 'uppercase',
        }}
      >
        {time ? `${time} · ` : ''}
        {type}
      </div>
      <div
        style={{
          fontSize: 12,
          fontWeight: 500,
          lineHeight: 1.3,
          letterSpacing: '-0.005em',
        }}
      >
        {entry.title}
      </div>
      {entry.status && (
        <div
          className="mono"
          style={{
            fontSize: 10,
            opacity: 0.65,
            letterSpacing: '0.04em',
          }}
        >
          {entry.status}
        </div>
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

function formatWeekRange(mondayIso: string, sundayIso: string): string {
  const m = new Date(`${mondayIso}T12:00:00Z`);
  const s = new Date(`${sundayIso}T12:00:00Z`);
  const sameMonth = m.getUTCMonth() === s.getUTCMonth();
  const left = m.toLocaleDateString('en-US', {
    timeZone: APP_TIMEZONE,
    month: 'short',
    day: 'numeric',
  });
  const right = s.toLocaleDateString('en-US', {
    timeZone: APP_TIMEZONE,
    month: sameMonth ? undefined : 'short',
    day: 'numeric',
    year: 'numeric',
  });
  return `${left} – ${right}`;
}

function mondayOfWeekFromIso(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  // Match weekdayPT behaviour client-side with UTC day — good enough for the
  // "this week" shortcut comparison.
  const dow = d.getUTCDay();
  const offset = (dow + 6) % 7;
  return addDaysIso(iso, -offset);
}

function uniqueCronSummary(list: CronOccurrenceView[]): CronOccurrenceView[] {
  const seen = new Set<string>();
  const out: CronOccurrenceView[] = [];
  for (const c of list) {
    const key = `${c.agentId}::${c.endpointLabel}::${c.schedule}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  out.sort((a, b) => a.agentName.localeCompare(b.agentName));
  return out;
}
