import {
  getRecentAgentOutputs,
  type RecentAgentOutput,
} from '../agent-outputs';
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
import {
  getChatHistory,
  getDailyChatSummaries,
  getPermanentPreferences,
  getQueueItems,
  getRecentAgentRuns,
  getRecentFeedback,
  saveDailyChatSummary,
  setPermanentPreferences,
  type DailyChatSummary,
  type RecentFeedbackItem,
} from '../supabase/client';
import { addDaysIso, dayLabelPT, todayIsoPT, weekdayPT } from '../time';
import { loadContextFile, runAgent, think, type RunAgentResult } from './base';

const AGENT_NAME = 'ops_chief';
const URGENT_WINDOW_DAYS = 3;
// Playbook §7 / §9: task-specific feedback window is 14 days; daily summary
// window is 7 days. Any change to these should go through the playbook first.
const RECENT_FEEDBACK_DAYS = 14;
const RECENT_SUMMARY_DAYS = 7;

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
  recentAgentRuns: any[];
  recentAgentOutputs: RecentAgentOutput[];
  pendingQueueItems: any[];
  recentFeedback: RecentFeedbackItem[];
  errors: Record<string, string>;
}

export interface DailyBriefingResult extends RunAgentResult<OpsChiefDailyContext> {
  briefing: string;
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

// Rendered memory for injection into any Ops Chief system prompt.
// Split into two tiers per playbook §7:
//   - permanentPreferences: always loaded, never un-learned silently
//   - dailyChatSummaries: last 7 days, context for this week
export interface OpsChiefMemoryView {
  permanentPreferences: string[];
  dailyChatSummaries: DailyChatSummary[];
}

export async function loadOpsChiefMemory(): Promise<OpsChiefMemoryView> {
  const [permanentPreferences, dailyChatSummaries] = await Promise.all([
    getPermanentPreferences(AGENT_NAME),
    getDailyChatSummaries(AGENT_NAME, RECENT_SUMMARY_DAYS),
  ]);
  return { permanentPreferences, dailyChatSummaries };
}

function renderDailySummary(s: DailyChatSummary): string {
  const v = s.value as Record<string, unknown>;
  const parts: string[] = [`### ${s.date}`];
  const asList = (key: string, label: string) => {
    const arr = Array.isArray(v[key]) ? (v[key] as string[]) : [];
    if (arr.length) {
      parts.push(`**${label}:**`);
      for (const item of arr) parts.push(`- ${item}`);
    }
  };
  asList('remember', 'Remember');
  asList('venture_updates', 'Venture updates');
  asList('behavior_corrections', 'Behavior corrections');
  if (typeof v.raw_summary === 'string' && v.raw_summary.trim()) {
    parts.push(`_${String(v.raw_summary).trim()}_`);
  }
  return parts.join('\n');
}

export function renderMemoryBlock(memory: OpsChiefMemoryView): string {
  const parts: string[] = [];

  if (memory.permanentPreferences.length) {
    parts.push(
      '# Permanent Preferences\nStanding rules Briana has set. Apply every run.\n' +
        memory.permanentPreferences.map((r) => `- ${r}`).join('\n'),
    );
  }

  if (memory.dailyChatSummaries.length) {
    parts.push(
      `# Recent Chat Summaries (last ${RECENT_SUMMARY_DAYS} days)\n` +
        memory.dailyChatSummaries
          .map((s) => renderDailySummary(s))
          .join('\n\n'),
    );
  }

  return parts.length ? '\n\n---\n\n' + parts.join('\n\n---\n\n') : '';
}

function renderRecentFeedback(items: RecentFeedbackItem[]): string {
  if (!items.length) return '';
  const lines = items.map((f) => {
    const statusLabel = f.status.toUpperCase();
    const date = (f.reviewed_at ?? f.created_at).slice(0, 10);
    const feedbackText = f.feedback ? ` — "${f.feedback}"` : '';
    return `- [${statusLabel} ${date}] ${f.type}: "${f.title}"${feedbackText}`;
  });
  return lines.join('\n');
}

function renderAgentActivity(ctx: OpsChiefDailyContext): string {
  const lines: string[] = [];
  // One line per output. Group by agent for readability.
  const byAgent: Record<string, RecentAgentOutput[]> = {};
  for (const o of ctx.recentAgentOutputs) {
    (byAgent[o.agent_id] ||= []).push(o);
  }
  for (const [agent, outs] of Object.entries(byAgent)) {
    const typeCounts: Record<string, number> = {};
    for (const o of outs) typeCounts[o.output_type] = (typeCounts[o.output_type] ?? 0) + 1;
    const summary = Object.entries(typeCounts)
      .map(([t, n]) => `${n}× ${t}`)
      .join(', ');
    lines.push(`- ${agent}: ${summary}`);
  }
  // Runs without outputs (e.g. pipeline_check with 0 items) — worth flagging.
  const runsWithoutOutputs = ctx.recentAgentRuns.filter(
    (r: any) =>
      r.status === 'success' &&
      !ctx.recentAgentOutputs.some((o) => o.agent_id.replace('-', '_') === r.agent_name.replace('-', '_')),
  );
  for (const run of runsWithoutOutputs) {
    lines.push(
      `- ${run.agent_name} (${run.trigger}) — ran, no output${run.output_summary ? `: ${run.output_summary}` : ''}`,
    );
  }
  for (const item of ctx.pendingQueueItems) {
    lines.push(`- PENDING REVIEW: ${item.agent_name} — "${item.title}" [${item.type}]`);
  }
  return lines.length ? lines.join('\n') : '(no agent activity in the last 24 hours)';
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

  const recentFeedbackRendered = renderRecentFeedback(ctx.recentFeedback);
  const feedbackBlock = recentFeedbackRendered
    ? `\n\n# RECENT TASK FEEDBACK (last ${RECENT_FEEDBACK_DAYS} days)
Briana's corrections on past briefings. Apply these to this run. Promote
to a permanent preference only if you see the same correction 3+ times —
otherwise treat them as run-specific.
${recentFeedbackRendered}`
    : '';

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

# AGENT ACTIVITY (last 24 hours)
${renderAgentActivity(ctx)}${feedbackBlock}
${errorBlock}

Now produce Briana's daily briefing following the format and prioritization
rules in your system prompt. Lead with priority. Be brief and direct.`;
}

// ---------------------------------------------------------------------------
// Chat distillation — structured extraction from yesterday's chat into four
// typed categories. Preferences and behavior corrections are promoted into
// `permanent_preferences` so they influence every future run. The full
// distillation is stored as one agent_memory row keyed by date.
// ---------------------------------------------------------------------------
export interface ChatDistill {
  remember: string[];           // Explicit "remember that X" commands
  preferences: string[];        // Inferred stated preferences
  venture_updates: string[];    // Venture/initiative context updates
  behavior_corrections: string[]; // Corrections to OC's behavior
  raw_summary: string;          // Short narrative summary for the briefing
}

function parseDistill(text: string): ChatDistill {
  // Claude is instructed to return a JSON object. Defensive parse — fall back
  // to empty categories with raw_summary = full text if JSON parsing fails.
  try {
    const jsonStart = text.indexOf('{');
    const jsonEnd = text.lastIndexOf('}');
    if (jsonStart === -1 || jsonEnd === -1) throw new Error('no json');
    const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
    const arr = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()) : [];
    return {
      remember: arr(parsed.remember),
      preferences: arr(parsed.preferences),
      venture_updates: arr(parsed.venture_updates),
      behavior_corrections: arr(parsed.behavior_corrections),
      raw_summary: typeof parsed.raw_summary === 'string' ? parsed.raw_summary : '',
    };
  } catch {
    return {
      remember: [],
      preferences: [],
      venture_updates: [],
      behavior_corrections: [],
      raw_summary: text.trim(),
    };
  }
}

async function summarizeYesterdaysChat(): Promise<void> {
  // Yesterday in PT so we pick up the correct session_date bucket.
  const yesterday = addDaysIso(todayIsoPT(), -1);
  const history = await getChatHistory(yesterday, 100);

  if (history.length < 2) return; // Nothing meaningful to distill

  const transcript = history
    .map((m: any) => `[${m.role}] ${m.content}`)
    .join('\n\n');

  const result = await think({
    systemPrompt: `You distill yesterday's chat between Ops Chief and Briana into four typed categories plus a short narrative summary. Return ONLY a JSON object with these keys:

{
  "remember": string[]          // Things Briana said "remember that", "save this", or explicitly asked to retain. Include exact statements.
  "preferences": string[]       // Stated preferences about how she works, wants the dashboard, wants tasks scheduled — things that should shape future briefings. Infer even when she didn't say "remember".
  "venture_updates": string[]   // Updates to venture/initiative context — pivots, new collaborators, changes in scope, status shifts that Ops Chief should know.
  "behavior_corrections": string[] // Corrections to Ops Chief's behavior — things Briana told OC to stop or start doing.
  "raw_summary": string         // 2-3 sentence narrative of yesterday's key decisions and action items. No small talk.
}

Be specific and actionable. Omit pleasantries. If a category is empty, return an empty array. Return ONLY the JSON — no preamble, no code fence.`,
    userPrompt: transcript,
    maxTokens: 900,
  });

  const distill = parseDistill(result.text);

  // Store as one row per date: daily_chat_summary:YYYY-MM-DD.
  // Playbook §6: one entry per day, structured summary, never line-by-line.
  await saveDailyChatSummary(AGENT_NAME, yesterday, {
    remember: distill.remember,
    preferences: distill.preferences,
    venture_updates: distill.venture_updates,
    behavior_corrections: distill.behavior_corrections,
    raw_summary: distill.raw_summary,
  });

  // Promote preferences + behavior corrections to permanent_preferences.
  // These change how OC acts on every future run. Dedupe against existing.
  const promotable = [...distill.preferences, ...distill.behavior_corrections];
  if (promotable.length) {
    const existing = await getPermanentPreferences(AGENT_NAME);
    const today = todayIsoPT();
    const newRules = promotable.map((r) => `[CHAT ${today}] ${r}`);
    const existingBodies = new Set(
      existing.map((r) => r.replace(/^\[[^\]]+\]\s*/, '').trim()),
    );
    const toAdd = newRules.filter(
      (r) => !existingBodies.has(r.replace(/^\[[^\]]+\]\s*/, '').trim()),
    );
    if (toAdd.length) {
      await setPermanentPreferences(AGENT_NAME, [...existing, ...toAdd]);
    }
  }
}

export async function runOpsChiefDailyBriefing(
  trigger: 'cron' | 'manual' | 'chat' = 'manual',
): Promise<DailyBriefingResult> {
  const now = new Date();
  const todayIso = todayIsoPT(now);
  const dayLabel = dayLabelPT(now);
  const ventureDay = VENTURE_DAYS[weekdayPT(now)];

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
      const [
        todaysTasks,
        overdueTasks,
        activeIntentions,
        activeOutcomes,
        initiatives,
        recentRunsRaw,
        recentAgentOutputs,
        pendingQueueItems,
        recentFeedback,
      ] = await Promise.all([
        safe('todaysTasks', () => getTodaysTasks(todayIso), [] as Task[], errors),
        safe('overdueTasks', () => getOverdueTasks(todayIso), [] as Task[], errors),
        safe('activeIntentions', () => getActiveIntentions(), [] as Intention[], errors),
        safe('activeOutcomes', () => getActiveOutcomes(), [] as Outcome[], errors),
        safe('initiatives', () => getInitiatives(), [] as Initiative[], errors),
        safe('recentRuns', () => getRecentAgentRuns(15), [] as any[], errors),
        safe(
          'recentAgentOutputs',
          () =>
            getRecentAgentOutputs(24, {
              // Ops Chief shouldn't narrate its own outputs back to itself.
              excludeAgentIds: ['ops_chief', 'ops-chief'],
              limit: 30,
            }),
          [] as RecentAgentOutput[],
          errors,
        ),
        safe('pendingQueue', () => getQueueItems('pending', 10), [] as any[], errors),
        safe(
          'recentFeedback',
          () => getRecentFeedback(AGENT_NAME, 24 * RECENT_FEEDBACK_DAYS, ['briefing']),
          [] as RecentFeedbackItem[],
          errors,
        ),
      ]);
      // Filter runs to last 24 hours
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const recentAgentRuns = recentRunsRaw.filter(
        (r: any) => r.started_at >= cutoff,
      );
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
        recentAgentRuns,
        recentAgentOutputs,
        pendingQueueItems,
        recentFeedback,
        errors,
      };
    },
    summarizeContext: (ctx) =>
      `today=${ctx.todayIso} urgent=${ctx.urgentProjects.length} urgent_subs=${ctx.urgentSubtasks.length} overdue=${ctx.overdueTasks.length} today_tasks=${ctx.todaysTasks.length} outcomes=${ctx.activeOutcomes.length} other_agent_outputs=${ctx.recentAgentOutputs.length} errors=${Object.keys(ctx.errors).length}`,
    buildPrompt: async (ctx) => {
      const memory = await loadOpsChiefMemory();
      const memoryBlock = renderMemoryBlock(memory);
      return {
        system:
          loadContextFile('system.md') +
          '\n\n---\n\n' +
          loadContextFile('operations/venture-days.md') +
          '\n\n---\n\n' +
          loadContextFile('agents/ops-chief/system-prompt.md') +
          '\n\n---\n\n' +
          loadContextFile('agents/ops-chief/playbook.md') +
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
    output: {
      venture: 'cross',
      outputType: 'daily_briefing',
      tags: (ctx) => ['daily', ctx.todayIso],
    },
  });

  // Piggyback: summarize yesterday's chat into memory for future context
  try {
    await summarizeYesterdaysChat();
  } catch (e) {
    console.error('Chat summary failed (non-fatal):', e);
  }

  return { ...result, briefing: result.result.text };
}
