import {
  getRecentAgentOutputs,
  type RecentAgentOutput,
} from '../agent-outputs';
import {
  getActiveIntentions,
  getActiveOutcomes,
  getCompletedTasksSince,
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

export interface DelegationHint {
  task_id: string;
  task_title: string;
  candidate_agent: 'showrunner';
  related_outputs: RecentAgentOutput[];
  matched_keywords: string[];
  episode_hint?: string;
}

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
  completedRecentTasks: Task[];
  delegationHints: DelegationHint[];
  errors: Record<string, string>;
}

// Pure UTC-anchored weekday lookup for a bare YYYY-MM-DD string. Safe because
// Notion date-only fields have no timezone, and we want the nominal weekday
// regardless of the caller's local tz.
const SHORT_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const LONG_WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];
function weekdayOfIso(iso: string, long = false): string {
  const d = new Date(`${iso}T12:00:00Z`);
  const idx = d.getUTCDay();
  return (long ? LONG_WEEKDAYS : SHORT_WEEKDAYS)[idx];
}
function formatDateWithWeekday(iso: string): string {
  return `${iso} (${weekdayOfIso(iso)})`;
}

// 14-day reference table. Claude uses this verbatim — no weekday inference.
function buildDateTable(todayIso: string): string {
  const lines: string[] = [];
  for (let offset = -1; offset <= 13; offset++) {
    const iso = addDaysIso(todayIso, offset);
    const wd = weekdayOfIso(iso, true);
    const label =
      offset === -1 ? 'yesterday'
      : offset === 0 ? 'TODAY'
      : offset === 1 ? 'tomorrow'
      : offset <= 6 ? 'this week'
      : 'next week';
    lines.push(`${wd} ${iso} — ${label}`);
  }
  return lines.join('\n');
}

// Lightweight heuristic to identify tasks that Showrunner could handle. The
// briefing prompt uses these hints alongside recent Showrunner outputs to
// decide readiness. We don't decide ready/blocked in code — that's Claude's
// job with the full context.
const SHOWRUNNER_KEYWORDS: Array<[string, string[]]> = [
  ['social_caption', ['social', 'caption', 'reel', 'promo', 'tiktok', 'instagram']],
  ['episode_metadata', ['episode title', 'youtube desc', 'spotify desc', 'youtube description', 'spotify description']],
  ['substack_post', ['substack', 'newsletter', 'post draft', 'episode post']],
  ['calendar_entry', ['schedule', 'content calendar']],
];
const EP_RE = /\b(?:ep(?:isode)?\.?\s*(\d{1,3}))\b/i;

function detectDelegationHints(
  tasks: Task[],
  showrunnerOutputs: RecentAgentOutput[],
): DelegationHint[] {
  const hints: DelegationHint[] = [];
  for (const t of tasks) {
    const title = t.title.toLowerCase();
    const matched: string[] = [];
    const matchedTypes = new Set<string>();
    for (const [outputType, keywords] of SHOWRUNNER_KEYWORDS) {
      for (const kw of keywords) {
        if (title.includes(kw)) {
          matched.push(kw);
          matchedTypes.add(outputType);
        }
      }
    }
    if (!matched.length) continue;

    const epMatch = t.title.match(EP_RE);
    const episodeHint = epMatch ? `ep${epMatch[1]}` : undefined;

    const related = showrunnerOutputs.filter((o) => {
      if (o.agent_id !== 'showrunner') return false;
      if (!matchedTypes.has(o.output_type) && !matchedTypes.has('calendar_entry')) {
        return false;
      }
      if (!episodeHint) return true;
      return o.tags.some((tag) => tag.toLowerCase().includes(episodeHint));
    });

    hints.push({
      task_id: t.id,
      task_title: t.title,
      candidate_agent: 'showrunner',
      related_outputs: related,
      matched_keywords: matched,
      episode_hint: episodeHint,
    });
  }
  return hints;
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
  const parts: string[] = [`- id=${t.id.slice(0, 8)} "${t.title}"`];
  parts.push(`[${t.type ?? 'Task'}]`);
  parts.push(`venture=${venture}`);
  if (t.toDoDate) parts.push(`todo=${formatDateWithWeekday(t.toDoDate)}`);
  if (t.datesEnd || t.datesStart) {
    if (t.datesStart && t.datesEnd && t.datesStart !== t.datesEnd) {
      parts.push(
        `deadline=${formatDateWithWeekday(t.datesStart)}→${formatDateWithWeekday(t.datesEnd)}`,
      );
    } else {
      const deadline = (t.datesEnd ?? t.datesStart)!;
      parts.push(`deadline=${formatDateWithWeekday(deadline)}`);
    }
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

  const completedBlock = ctx.completedRecentTasks.length
    ? ctx.completedRecentTasks
        .map((t) => renderTaskLine(t, initiatives, outcomes))
        .join('\n')
    : '(nothing completed in the last 48 hours)';

  const delegationBlock = ctx.delegationHints.length
    ? ctx.delegationHints
        .map((h) => {
          const related = h.related_outputs.length
            ? h.related_outputs
                .map(
                  (o) =>
                    `    ↳ showrunner/${o.output_type} — ${o.approval_status} on ${o.created_at.slice(0, 10)}${o.tags.length ? ` [${o.tags.join(', ')}]` : ''}`,
                )
                .join('\n')
            : '    ↳ (no related Showrunner outputs in the last 24h)';
          return `- task_id=${h.task_id.slice(0, 8)} "${h.task_title}"
    candidate_agent=${h.candidate_agent}  matched=[${h.matched_keywords.join(', ')}]${h.episode_hint ? `  episode_hint=${h.episode_hint}` : ''}
${related}`;
        })
        .join('\n\n')
    : '(no tasks on your list look delegable today)';

  return `Venture day guide: ${ctx.ventureDay}

# DATE REFERENCE (authoritative — never compute weekdays yourself)
Use this table for every weekday/date you mention. All dates are Pacific Time.
${buildDateTable(ctx.todayIso)}

# URGENT PROJECTS (Date field within ${URGENT_WINDOW_DAYS} days — hard deadlines)
${urgentProjectBlock}

# OPEN SUBTASKS UNDER URGENT PROJECTS
${subtaskBlock}

# OVERDUE / CARRY-FORWARD
Open tasks whose To-Do Date has already passed.
${overdueBlock}

# TODAY'S PLANNED TASKS (To-Do Date = ${formatDateWithWeekday(ctx.todayIso)})
${todayBlock}

# COMPLETED IN LAST 48 HOURS (Briana's recently-done tasks — use as context for delegation)
${completedBlock}

# CROSS-AGENT OUTPUTS + PENDING QUEUE (last 24 hours — informs delegation readiness)
${renderAgentActivity(ctx)}

# DELEGATION CANDIDATES (keyword-matched — decide readiness in JSON output)
${delegationBlock}

# ACTIVE OUTCOMES (reference only — inline mention when a task links to one)
${outcomesRef}

# INITIATIVES ON FILE
${initiatives.map((i) => `- ${i.name} [${i.status ?? 'no status'}]`).join('\n') || '(none)'}
${feedbackBlock}
${errorBlock}

Now produce the briefing per the playbook §1 spec. Output exactly:

<Section 1: HTML body — no markdown syntax, use real <h2>, <h3>, <p>, <strong>, <ul>, <li> tags. Structure: generative opening → Top priorities → Also today → Heads up. Bold inline the task names and deadlines so a 5-second skim works. Do NOT restate the date — the card title carries it.>

<!-- DELEGATIONS -->

<Section 2: JSON array of delegation suggestions. Schema and ready/blocked semantics in playbook §1. Empty array [] if nothing is delegable.>`;
}

// ---------------------------------------------------------------------------
// Briefing output parser — splits Claude's response into an HTML body and a
// delegation suggestions JSON array. The prompt tells Claude to separate
// them with a specific HTML comment marker.
// ---------------------------------------------------------------------------
export interface DelegationSuggestion {
  task_title: string;
  agent: string;
  readiness: 'ready' | 'blocked';
  blockers: string[];
  chat_prompt: string;
  task_id?: string;
}

export interface ParsedBriefing {
  briefingHtml: string;
  delegationSuggestions: DelegationSuggestion[];
  rawOutput: string;
}

const DELEGATION_MARKER = '<!-- DELEGATIONS -->';

export function parseBriefingOutput(text: string): ParsedBriefing {
  const idx = text.indexOf(DELEGATION_MARKER);
  let htmlPart = text;
  let jsonPart = '';

  if (idx >= 0) {
    htmlPart = text.slice(0, idx);
    jsonPart = text.slice(idx + DELEGATION_MARKER.length);
  }

  // Strip any leading/trailing code fence the model may have wrapped around
  // the HTML (defensive — our prompt says not to, but Claude sometimes does).
  const briefingHtml = htmlPart
    .replace(/^\s*```(?:html)?\s*/, '')
    .replace(/```\s*$/, '')
    .trim();

  let delegationSuggestions: DelegationSuggestion[] = [];
  if (jsonPart.trim()) {
    try {
      const start = jsonPart.indexOf('[');
      const end = jsonPart.lastIndexOf(']');
      if (start >= 0 && end > start) {
        const arr = JSON.parse(jsonPart.slice(start, end + 1));
        if (Array.isArray(arr)) {
          delegationSuggestions = arr
            .filter((s: unknown): s is Record<string, unknown> => {
              return !!s && typeof s === 'object';
            })
            .map((s) => ({
              task_title: String(s.task_title ?? ''),
              agent: String(s.agent ?? 'showrunner'),
              readiness: (s.readiness === 'ready' ? 'ready' : 'blocked') as 'ready' | 'blocked',
              blockers: Array.isArray(s.blockers)
                ? (s.blockers as unknown[]).filter(
                    (b): b is string => typeof b === 'string' && b.trim().length > 0,
                  )
                : [],
              chat_prompt: String(s.chat_prompt ?? ''),
              task_id: typeof s.task_id === 'string' ? s.task_id : undefined,
            }))
            .filter((s) => s.task_title.length > 0);
        }
      }
    } catch (e) {
      console.error('[ops-chief] delegation JSON parse failed:', e);
    }
  }

  return { briefingHtml, delegationSuggestions, rawOutput: text };
}

// Extract a short plain-text summary from the HTML briefing body — used for
// the queue card's collapsed summary line. Strips tags and pulls the first
// non-header paragraph.
export function extractOpeningSummary(html: string): string {
  const stripped = html
    .replace(/<h\d[^>]*>[\s\S]*?<\/h\d>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped.slice(0, 240);
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
      // 48h lookback for recently-completed Notion tasks.
      const completedCutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
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
        completedRecentTasks,
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
        safe(
          'completedRecentTasks',
          () => getCompletedTasksSince(completedCutoff),
          [] as Task[],
          errors,
        ),
      ]);
      // Filter runs to last 24 hours
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const recentAgentRuns = recentRunsRaw.filter(
        (r: any) => r.started_at >= cutoff,
      );
      // Detect delegation candidates from today's + overdue tasks. Keep it
      // small (max 8) so the prompt stays scannable.
      const delegationHints = detectDelegationHints(
        [...todaysTasks, ...overdueTasks],
        recentAgentOutputs,
      ).slice(0, 8);
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
        completedRecentTasks,
        delegationHints,
        errors,
      };
    },
    summarizeContext: (ctx) =>
      `today=${ctx.todayIso} urgent=${ctx.urgentProjects.length} urgent_subs=${ctx.urgentSubtasks.length} overdue=${ctx.overdueTasks.length} today_tasks=${ctx.todaysTasks.length} completed48h=${ctx.completedRecentTasks.length} delegation_hints=${ctx.delegationHints.length} other_agent_outputs=${ctx.recentAgentOutputs.length} errors=${Object.keys(ctx.errors).length}`,
    maxTokens: 4000,
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
    buildDeposit: (ctx, r) => {
      const parsed = parseBriefingOutput(r.text);
      return {
        type: 'briefing',
        title: `Daily Briefing — ${ctx.dayLabel}`,
        summary: extractOpeningSummary(parsed.briefingHtml),
        full_output: {
          briefing_html: parsed.briefingHtml,
          delegation_suggestions: parsed.delegationSuggestions,
          venture_day: ctx.ventureDay,
          context: {
            today_iso: ctx.todayIso,
            urgent_projects: ctx.urgentProjects.length,
            urgent_subtasks: ctx.urgentSubtasks.length,
            overdue_tasks: ctx.overdueTasks.length,
            today_task_count: ctx.todaysTasks.length,
            completed_48h: ctx.completedRecentTasks.length,
            delegation_hints: ctx.delegationHints.length,
            active_outcomes: ctx.activeOutcomes.length,
            errors: ctx.errors,
          },
        },
      };
    },
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
