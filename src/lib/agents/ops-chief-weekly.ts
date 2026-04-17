import {
  getActiveIntentions,
  getActiveOutcomes,
  getInitiatives,
  getMonthlyPriorities,
  getOverdueTasks,
  getWeekTasks,
  type Initiative,
  type Intention,
  type Outcome,
  type Task,
} from '../notion/client';
import { getAgentMemory } from '../supabase/client';
import { loadContextFile, runAgent, type RunAgentResult } from './base';

const AGENT_NAME = 'ops_chief';

const VENTURE_DAYS: Record<number, string> = {
  0: 'Sunday — rest',
  1: 'Monday — The Trades Show',
  2: 'Tuesday — Fractal / Aura',
  3: 'Wednesday — The Corral + Detto',
  4: 'Thursday — catch-up and deep work',
  5: 'Friday — filming and content production',
  6: 'Saturday — rest',
};

export interface WeeklyPlannerContext {
  weekStartIso: string;
  weekEndIso: string;
  weekTasks: Task[];
  overdueTasks: Task[];
  monthlyPriorities: Task[];
  activeIntentions: Intention[];
  activeOutcomes: Outcome[];
  initiatives: Initiative[];
  errors: Record<string, string>;
}

export interface ParsedWeeklyPlan {
  planMarkdown: string;
  weeklySummary: string;
  reschedules: { taskId: string; taskTitle: string; newDate: string; reason: string }[];
  newTasks: { title: string; type: string; toDoDate: string; initiativeName: string; reason: string }[];
}

export interface WeeklyPlannerResult extends RunAgentResult<WeeklyPlannerContext> {
  parsed: ParsedWeeklyPlan;
}

// ---------------------------------------------------------------------------
// Output parsing
// ---------------------------------------------------------------------------
function parseSection(text: string, header: string): string {
  const pattern = new RegExp(`### ${header}\\s*\\n([\\s\\S]*?)(?=\\n### |$)`);
  const match = text.match(pattern);
  return match?.[1]?.trim() ?? '';
}

function parseReschedules(
  text: string,
): ParsedWeeklyPlan['reschedules'] {
  const section = parseSection(text, 'RESCHEDULE');
  if (!section || section === '(none)') return [];
  return section
    .split('\n')
    .filter((line) => line.includes('→'))
    .map((line) => {
      // Format: {task_id}: {task title} → {YYYY-MM-DD} — {reason}
      const idMatch = line.match(/^([a-f0-9-]+):\s*/);
      const dateMatch = line.match(/→\s*(\d{4}-\d{2}-\d{2})/);
      const reasonMatch = line.match(/—\s*(.+)$/);
      const titleMatch = line.match(/:\s*(.+?)\s*→/);
      return {
        taskId: idMatch?.[1] ?? '',
        taskTitle: titleMatch?.[1]?.trim() ?? '',
        newDate: dateMatch?.[1] ?? '',
        reason: reasonMatch?.[1]?.trim() ?? '',
      };
    })
    .filter((r) => r.taskId && r.newDate);
}

function parseNewTasks(
  text: string,
): ParsedWeeklyPlan['newTasks'] {
  const section = parseSection(text, 'NEW TASKS');
  if (!section || section === '(none)') return [];
  return section
    .split('\n')
    .filter((line) => line.includes('type='))
    .map((line) => {
      // Format: {title} | type={type} | date={YYYY-MM-DD} | initiative={name} — {reason}
      const parts = line.split('|').map((s) => s.trim());
      const title = parts[0] ?? '';
      const type = parts.find((p) => p.startsWith('type='))?.replace('type=', '') ?? 'Tasks';
      const date = parts.find((p) => p.startsWith('date='))?.replace('date=', '') ?? '';
      const initPart = parts.find((p) => p.startsWith('initiative=')) ?? '';
      const initAndReason = initPart.replace('initiative=', '');
      const [initiativeName, ...reasonParts] = initAndReason.split('—');
      return {
        title,
        type,
        toDoDate: date,
        initiativeName: initiativeName?.trim() ?? '',
        reason: reasonParts.join('—').trim(),
      };
    })
    .filter((t) => t.title && t.toDoDate);
}

function parseWeeklyPlan(text: string): ParsedWeeklyPlan {
  return {
    planMarkdown: text,
    weeklySummary: parseSection(text, 'WEEKLY SUMMARY'),
    reschedules: parseReschedules(text),
    newTasks: parseNewTasks(text),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function getUpcomingWeekBounds(): { start: string; end: string } {
  const now = new Date();
  const dow = now.getDay(); // 0=Sun
  // Find next Monday (or this Monday if today is Sunday)
  const daysUntilMonday = dow === 0 ? 1 : 8 - dow;
  const monday = new Date(now);
  monday.setDate(now.getDate() + daysUntilMonday);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
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

function renderTaskForPlan(t: Task, initiatives: Initiative[]): string {
  const venture =
    t.initiativeIds
      .map((id) => initiatives.find((i) => i.id === id)?.name)
      .filter(Boolean)
      .join(', ') || 'Unassigned';
  const parts = [
    `id=${t.id}`,
    `"${t.title}"`,
    t.type ? `[${t.type}]` : null,
    `venture=${venture}`,
    t.toDoDate ? `todo=${t.toDoDate}` : 'undated',
    t.status ? `status=${t.status}` : null,
  ].filter(Boolean);
  return '- ' + parts.join('  ');
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
export async function runWeeklyPlanner(
  trigger: 'cron' | 'manual' | 'chat' = 'manual',
): Promise<WeeklyPlannerResult> {
  const { start: weekStartIso, end: weekEndIso } = getUpcomingWeekBounds();
  const todayIso = new Date().toISOString().slice(0, 10);
  let parsed: ParsedWeeklyPlan | null = null;

  const result = await runAgent<WeeklyPlannerContext>({
    agentName: AGENT_NAME,
    trigger,
    maxTokens: 4000,

    gatherContext: async () => {
      const errors: Record<string, string> = {};
      const [weekTasks, overdueTasks, monthlyPriorities, activeIntentions, activeOutcomes, initiatives] =
        await Promise.all([
          safe('weekTasks', () => getWeekTasks(weekStartIso, weekEndIso), [] as Task[], errors),
          safe('overdueTasks', () => getOverdueTasks(todayIso), [] as Task[], errors),
          safe('monthlyPriorities', () => getMonthlyPriorities(), [] as Task[], errors),
          safe('activeIntentions', () => getActiveIntentions(), [] as Intention[], errors),
          safe('activeOutcomes', () => getActiveOutcomes(), [] as Outcome[], errors),
          safe('initiatives', () => getInitiatives(), [] as Initiative[], errors),
        ]);
      return {
        weekStartIso,
        weekEndIso,
        weekTasks,
        overdueTasks,
        monthlyPriorities,
        activeIntentions,
        activeOutcomes,
        initiatives,
        errors,
      };
    },

    summarizeContext: (ctx) =>
      `week=${ctx.weekStartIso}→${ctx.weekEndIso} tasks=${ctx.weekTasks.length} overdue=${ctx.overdueTasks.length} priorities=${ctx.monthlyPriorities.length} outcomes=${ctx.activeOutcomes.length}`,

    buildPrompt: async (ctx) => {
      const memory = await getAgentMemory(AGENT_NAME);
      let memoryBlock = '';
      if (Array.isArray(memory.feedback_rules) && memory.feedback_rules.length) {
        memoryBlock =
          '\n\n---\n\n# Persistent Rules (from past feedback)\n' +
          memory.feedback_rules.map((r: string) => `- ${r}`).join('\n');
      }

      const system =
        loadContextFile('system.md') +
        '\n\n---\n\n' +
        loadContextFile('operations/venture-days.md') +
        '\n\n---\n\n' +
        loadContextFile('agents/ops-chief.md') +
        '\n\n---\n\n' +
        loadContextFile('operations/weekly-planner.md') +
        memoryBlock;

      const ventureDayGuide = Object.entries(VENTURE_DAYS)
        .map(([d, label]) => `  ${label}`)
        .join('\n');

      const weekTaskBlock = ctx.weekTasks.length
        ? ctx.weekTasks.map((t) => renderTaskForPlan(t, ctx.initiatives)).join('\n')
        : '(no tasks scheduled for this week yet)';

      const overdueBlock = ctx.overdueTasks.length
        ? ctx.overdueTasks.map((t) => renderTaskForPlan(t, ctx.initiatives)).join('\n')
        : '(none)';

      const priorityBlock = ctx.monthlyPriorities.length
        ? ctx.monthlyPriorities.map((t) => renderTaskForPlan(t, ctx.initiatives)).join('\n')
        : '(none)';

      const outcomesBlock = ctx.activeOutcomes.length
        ? ctx.activeOutcomes
            .map(
              (o) =>
                `- ${o.name} [${o.status ?? 'no status'}${
                  o.current != null && o.target != null ? ` — ${o.current}/${o.target}` : ''
                }]`,
            )
            .join('\n')
        : '(none)';

      const user = `Plan the week of ${ctx.weekStartIso} (Monday) through ${ctx.weekEndIso} (Sunday).
Today is ${todayIso}.

# VENTURE-DAY SCHEDULE
${ventureDayGuide}

# TASKS ALREADY SCHEDULED THIS WEEK
${weekTaskBlock}

# OVERDUE / CARRY-FORWARD (must be rescheduled)
${overdueBlock}

# MONTHLY PRIORITIES (should have dates this week if possible)
${priorityBlock}

# ACTIVE OUTCOMES (Key Results)
${outcomesBlock}

# INITIATIVES
${ctx.initiatives.map((i) => `- ${i.name} [${i.status ?? 'no status'}]`).join('\n') || '(none)'}

Produce the weekly plan following the format in your system prompt. Be concrete about which tasks go on which day and why. Include RESCHEDULE and NEW TASKS sections.`;

      return { system, user };
    },

    buildDeposit: (ctx, r) => {
      parsed = parseWeeklyPlan(r.text);
      return {
        type: 'recommendation' as const,
        title: `Weekly Plan — ${ctx.weekStartIso} to ${ctx.weekEndIso}`,
        summary: parsed.weeklySummary.slice(0, 240) || 'Weekly plan ready for review',
        full_output: {
          plan_markdown: parsed.planMarkdown,
          weekly_summary: parsed.weeklySummary,
          reschedules: parsed.reschedules,
          new_tasks: parsed.newTasks,
          week_start: ctx.weekStartIso,
          week_end: ctx.weekEndIso,
        },
      };
    },
  });

  return {
    ...result,
    parsed: parsed ?? parseWeeklyPlan(result.result.text),
  };
}
