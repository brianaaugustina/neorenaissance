import {
  getActiveIntentions,
  getActiveOutcomes,
  getInitiatives,
  getOpenSubtasksOfProjects,
  getOverdueTasks,
  getTodaysTasks,
  getUrgentProjects,
  type Initiative,
  type Intention,
  type Outcome,
  type Task,
} from '../notion/client';
import { getAgentMemory, getChatHistory, setAgentMemory } from '../supabase/client';
import { loadContextFile, runAgent, think, type RunAgentResult } from './base';

const AGENT_NAME = 'ops_chief';
const URGENT_WINDOW_DAYS = 3;

const VENTURE_DAYS: Record<number, string> = {
  0: 'Weekend — rest and reflection',
  1: 'Monday — The Trades Show',
  2: 'Tuesday — Fractal / Aura',
  3: 'Wednesday — The Corral + Detto',
  4: 'Thursday — catch-up and deep work',
  5: 'Friday — filming and content production',
  6: 'Weekend — rest and reflection',
};

export interface OpsChiefDailyContext {
  todayIso: string;
  dayLabel: string;
  ventureDay: string;
  todaysTasks: Task[];
  overdueTasks: Task[];
  urgentProjects: Task[];
  urgentSubtasks: Task[];
  activeIntentions: Intention[];
  activeOutcomes: Outcome[];
  initiatives: Initiative[];
  errors: Record<string, string>;
}

export interface DailyBriefingResult extends RunAgentResult<OpsChiefDailyContext> {
  briefing: string;
}

function formatDayLabel(d: Date): string {
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
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

function initiativeName(ids: string[], initiatives: Initiative[]): string {
  if (!ids.length) return 'Unassigned';
  const names = ids
    .map((id) => initiatives.find((i) => i.id === id)?.name)
    .filter(Boolean);
  return names.length ? names.join(', ') : 'Unassigned';
}

function outcomeNames(ids: string[], outcomes: Outcome[]): string[] {
  return ids
    .map((id) => outcomes.find((o) => o.id === id)?.name)
    .filter((x): x is string => !!x);
}

function renderTaskLine(t: Task, initiatives: Initiative[], outcomes: Outcome[]): string {
  const linkedOutcomes = outcomeNames(t.outcomeIds, outcomes);
  const venture = initiativeName(t.initiativeIds, initiatives);
  const parts: string[] = [`- ${t.title}`];
  parts.push(`[${t.type ?? 'Task'}]`);
  parts.push(`venture=${venture}`);
  if (t.toDoDate) parts.push(`todo=${t.toDoDate}`);
  if (t.datesEnd || t.datesStart) {
    const deadline = t.datesEnd ?? t.datesStart;
    const span = t.datesStart && t.datesEnd && t.datesStart !== t.datesEnd
      ? `${t.datesStart}→${t.datesEnd}`
      : deadline!;
    parts.push(`deadline=${span}`);
  }
  if (t.status) parts.push(`status=${t.status}`);
  if (linkedOutcomes.length) parts.push(`outcomes=[${linkedOutcomes.join(' | ')}]`);
  if (t.projectIds.length) parts.push(`parent_project_ids=${t.projectIds.length}`);
  return parts.join('  ');
}

function groupByVenture(
  tasks: Task[],
  initiatives: Initiative[],
): Record<string, Task[]> {
  const groups: Record<string, Task[]> = {};
  for (const t of tasks) {
    const name = initiativeName(t.initiativeIds, initiatives);
    (groups[name] ||= []).push(t);
  }
  return groups;
}

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round(
    (new Date(toIso).getTime() - new Date(fromIso).getTime()) / 864e5,
  );
}

function renderOverdueLine(
  t: Task,
  todayIso: string,
  initiatives: Initiative[],
  outcomes: Outcome[],
): string {
  const base = renderTaskLine(t, initiatives, outcomes);
  if (!t.toDoDate) return base;
  const days = daysBetween(t.toDoDate, todayIso);
  return `${base}  overdue_by=${days}d`;
}

function renderUrgentProject(
  p: Task,
  todayIso: string,
  initiatives: Initiative[],
  outcomes: Outcome[],
): string {
  const base = renderTaskLine(p, initiatives, outcomes);
  const deadline = p.datesEnd ?? p.datesStart;
  if (!deadline) return base;
  const days = daysBetween(todayIso, deadline);
  const label = days <= 0 ? 'ships today' : days === 1 ? 'ships tomorrow' : `ships in ${days}d`;
  return `${base}  ${label}`;
}

export function buildUserPrompt(ctx: OpsChiefDailyContext): string {
  const { initiatives, activeOutcomes: outcomes, todayIso } = ctx;

  const urgentProjectBlock = ctx.urgentProjects.length
    ? ctx.urgentProjects.map((p) => renderUrgentProject(p, todayIso, initiatives, outcomes)).join('\n')
    : '(none)';

  // Subtasks grouped by their parent project id so Ops Chief can cluster them.
  const subtasksByProject: Record<string, Task[]> = {};
  for (const st of ctx.urgentSubtasks) {
    for (const pid of st.projectIds) {
      (subtasksByProject[pid] ||= []).push(st);
    }
  }
  const subtaskBlock = Object.keys(subtasksByProject).length
    ? Object.entries(subtasksByProject)
        .map(([pid, subs]) => {
          const parent = ctx.urgentProjects.find((p) => p.id === pid);
          const parentLabel = parent ? parent.title : `project ${pid.slice(0, 8)}`;
          return `Under "${parentLabel}":\n` +
            subs.map((s) => '  ' + renderTaskLine(s, initiatives, outcomes)).join('\n');
        })
        .join('\n')
    : '(none)';

  const overdueBlock = ctx.overdueTasks.length
    ? ctx.overdueTasks.map((t) => renderOverdueLine(t, todayIso, initiatives, outcomes)).join('\n')
    : '(none)';

  const todayGroups = groupByVenture(ctx.todaysTasks, initiatives);
  const todayBlock = Object.keys(todayGroups).length
    ? Object.entries(todayGroups)
        .map(
          ([venture, tasks]) =>
            `[${venture}]\n` +
            tasks.map((t) => renderTaskLine(t, initiatives, outcomes)).join('\n'),
        )
        .join('\n\n')
    : '(no tasks with To-Do Date = today)';

  // Outcomes reference table — for inline mentions only. No standalone section.
  const outcomesRef = outcomes.length
    ? outcomes
        .map(
          (o) =>
            `- ${o.name} [${o.status ?? 'no status'}${
              o.current != null && o.target != null ? ` — ${o.current}/${o.target}` : ''
            }${o.season ? ` — ${o.season}` : ''}]`,
        )
        .join('\n')
    : '(none)';

  const errorBlock = Object.keys(ctx.errors).length
    ? '\n\n**Data fetch errors (mention briefly if relevant):**\n' +
      Object.entries(ctx.errors)
        .map(([k, v]) => `- ${k}: ${v}`)
        .join('\n')
    : '';

  return `Today is ${ctx.dayLabel}.
Venture day guide: ${ctx.ventureDay}

# URGENT PROJECTS (deadline within ${URGENT_WINDOW_DAYS} days)
These override everything else. Every open subtask beneath them is priority.
${urgentProjectBlock}

# OPEN SUBTASKS UNDER URGENT PROJECTS
${subtaskBlock}

# OVERDUE / CARRY-FORWARD
Open tasks whose To-Do Date has already passed.
${overdueBlock}

# TODAY'S PLANNED TASKS (To-Do Date = ${ctx.todayIso})
${todayBlock}

# ACTIVE OUTCOMES (reference only — inline mention when a task links to one)
${outcomesRef}

# INITIATIVES ON FILE
${initiatives.map((i) => `- ${i.name} [${i.status ?? 'no status'}]`).join('\n') || '(none)'}
${errorBlock}

Now produce Briana's daily briefing following the format and prioritization
rules in your system prompt. Lead with priority. Be brief and direct.`;
}

// ---------------------------------------------------------------------------
// Chat summary — distill yesterday's chat into a persistent memory entry.
// Called at the end of the daily briefing so it piggybacks on the existing cron.
// ---------------------------------------------------------------------------
async function summarizeYesterdaysChat(): Promise<void> {
  const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  const history = await getChatHistory(yesterday, 100);

  if (history.length < 2) return; // Nothing meaningful to summarize

  const transcript = history
    .map((m: any) => `[${m.role}] ${m.content}`)
    .join('\n\n');

  const result = await think({
    systemPrompt:
      'You are a concise summarizer. Extract key decisions, stated preferences, action items, and behavioral rules from this chat transcript between an AI agent (Ops Chief) and its user (Briana). Output a bullet list. Be specific and actionable. 5-10 bullets max. Omit small talk.',
    userPrompt: transcript,
    maxTokens: 500,
  });

  await setAgentMemory(AGENT_NAME, 'chat_summary', result.text);
}

export async function runOpsChiefDailyBriefing(
  trigger: 'cron' | 'manual' | 'chat' = 'manual',
): Promise<DailyBriefingResult> {
  const now = new Date();
  const todayIso = now.toISOString().slice(0, 10);
  const dayLabel = formatDayLabel(now);
  const ventureDay = VENTURE_DAYS[now.getDay()];

  const result = await runAgent<OpsChiefDailyContext>({
    agentName: AGENT_NAME,
    trigger,
    gatherContext: async () => {
      const errors: Record<string, string> = {};
      const urgentProjects = await safe(
        'urgentProjects',
        () => getUrgentProjects(URGENT_WINDOW_DAYS, todayIso),
        [] as Task[],
        errors,
      );
      const urgentSubtasks = urgentProjects.length
        ? await safe(
            'urgentSubtasks',
            () => getOpenSubtasksOfProjects(urgentProjects.map((p) => p.id)),
            [] as Task[],
            errors,
          )
        : [];
      const [todaysTasks, overdueTasks, activeIntentions, activeOutcomes, initiatives] =
        await Promise.all([
          safe('todaysTasks', () => getTodaysTasks(todayIso), [] as Task[], errors),
          safe('overdueTasks', () => getOverdueTasks(todayIso), [] as Task[], errors),
          safe('activeIntentions', () => getActiveIntentions(), [] as Intention[], errors),
          safe('activeOutcomes', () => getActiveOutcomes(), [] as Outcome[], errors),
          safe('initiatives', () => getInitiatives(), [] as Initiative[], errors),
        ]);
      return {
        todayIso,
        dayLabel,
        ventureDay,
        todaysTasks,
        overdueTasks,
        urgentProjects,
        urgentSubtasks,
        activeIntentions,
        activeOutcomes,
        initiatives,
        errors,
      };
    },
    summarizeContext: (ctx) =>
      `today=${ctx.todayIso} urgent=${ctx.urgentProjects.length} urgent_subs=${ctx.urgentSubtasks.length} overdue=${ctx.overdueTasks.length} today_tasks=${ctx.todaysTasks.length} outcomes=${ctx.activeOutcomes.length} errors=${Object.keys(ctx.errors).length}`,
    buildPrompt: async (ctx) => {
      const memory = await getAgentMemory(AGENT_NAME);
      let memoryBlock = '';
      if (Object.keys(memory).length) {
        const parts: string[] = [];
        if (Array.isArray(memory.feedback_rules) && memory.feedback_rules.length) {
          parts.push(
            '# Persistent Rules (from past feedback)\nFollow these rules — they are direct instructions from Briana based on prior briefings.\n' +
              memory.feedback_rules.map((r: string) => `- ${r}`).join('\n'),
          );
        }
        if (memory.chat_summary) {
          parts.push(`# Yesterday's Chat Summary\n${memory.chat_summary}`);
        }
        if (parts.length) memoryBlock = '\n\n---\n\n' + parts.join('\n\n');
      }
      return {
        system:
          loadContextFile('system.md') +
          '\n\n---\n\n' +
          loadContextFile('operations/venture-days.md') +
          '\n\n---\n\n' +
          loadContextFile('agents/ops-chief.md') +
          memoryBlock,
        user: buildUserPrompt(ctx),
      };
    },
    buildDeposit: (ctx, r) => ({
      type: 'briefing',
      title: `Daily Briefing — ${ctx.dayLabel}`,
      summary: r.text
        .split('\n')
        .find((l) => l.trim() && !l.startsWith('#'))
        ?.slice(0, 240),
      full_output: {
        briefing_markdown: r.text,
        venture_day: ctx.ventureDay,
        context: {
          today_iso: ctx.todayIso,
          urgent_projects: ctx.urgentProjects.length,
          urgent_subtasks: ctx.urgentSubtasks.length,
          overdue_tasks: ctx.overdueTasks.length,
          today_task_count: ctx.todaysTasks.length,
          active_outcomes: ctx.activeOutcomes.length,
          errors: ctx.errors,
        },
      },
    }),
  });

  // Piggyback: summarize yesterday's chat into memory for future context
  try {
    await summarizeYesterdaysChat();
  } catch (e) {
    console.error('Chat summary failed (non-fatal):', e);
  }

  return { ...result, briefing: result.result.text };
}
