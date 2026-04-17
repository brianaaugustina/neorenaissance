import Anthropic from '@anthropic-ai/sdk';
import { env } from '../env';
import {
  createTask,
  deleteTask,
  getInitiatives,
  getOverdueTasks,
  getTodaysTasks,
  searchCompanies,
  searchContacts,
  searchContent,
  searchNotes,
  searchOpenTasks,
  searchOutreach,
  updateTask,
  type Initiative,
  type NotionRecord,
  type Task,
} from '../notion/client';
import {
  getAgentMemory,
  getChatHistory,
  logRunComplete,
  logRunStart,
  saveChatMessage,
} from '../supabase/client';
import { loadContextFile } from './base';
import { renderMemoryBlock } from './ops-chief';

const MODEL = process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-5';
const anthropic = new Anthropic({ apiKey: env.anthropic.apiKey });

const PRICE_IN_PER_MTOK = 3;
const PRICE_OUT_PER_MTOK = 15;

const AGENT_NAME = 'ops_chief';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function buildDateTable(todayIso: string): string {
  const today = new Date(todayIso + 'T12:00:00Z');
  const lines: string[] = [];
  for (let offset = -1; offset <= 13; offset++) {
    const d = new Date(today);
    d.setUTCDate(today.getUTCDate() + offset);
    const iso = d.toISOString().slice(0, 10);
    const dayName = DAY_NAMES[d.getUTCDay()];
    const label =
      offset === -1 ? ' (yesterday)' :
      offset === 0 ? ' (today)' :
      offset === 1 ? ' (tomorrow)' :
      offset <= 6 ? ' (this week)' :
      ' (next week)';
    lines.push(`${dayName} = ${iso}${label}`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Tools — names and schemas Claude sees
// ---------------------------------------------------------------------------
const TASK_TYPES = [
  'Creation',
  'Projects',
  'Major Tasks',
  'Tasks',
  'Micro Task',
  'Bugs',
  'Business Admin',
  'Life Admin',
  'Home',
  'Errand',
  'Delegate',
];
const TASK_STATUSES = [
  'Not started',
  'Queue',
  'Planned',
  'In progress',
  'Waiting',
  'Hold',
  'Done',
];

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'search_tasks',
    description:
      'Search open tasks in the To-Do database by title substring. Use this first whenever the user references a task by name so you can get its id before updating or rescheduling it. Returns up to 10 matches with id, title, type, status, to-do date, and venture.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Substring to match against task titles' },
      },
      required: ['query'],
    },
  },
  {
    name: 'create_task',
    description:
      'Create a new task in the To-Do database. Use for explicit task-creation requests like "add a task: review Corral analytics by Friday." For general idea capture with no urgency, use capture_idea instead.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string' },
        type: {
          type: 'string',
          enum: TASK_TYPES,
          description: 'Task type. Default to "Tasks" if unsure.',
        },
        to_do_date: {
          type: 'string',
          description: 'Planned work date in YYYY-MM-DD. Omit if the user did not specify.',
        },
        initiative_name: {
          type: 'string',
          description:
            'Venture/initiative name as it appears in Notion (e.g. "The Trades Show", "The Corral"). The server resolves this to an id.',
        },
        status: {
          type: 'string',
          enum: TASK_STATUSES,
          description: 'Defaults to "Not started".',
        },
      },
      required: ['title'],
    },
  },
  {
    name: 'update_task_status',
    description: 'Change the Status of an existing task.',
    input_schema: {
      type: 'object' as const,
      properties: {
        task_id: { type: 'string' },
        status: { type: 'string', enum: TASK_STATUSES },
      },
      required: ['task_id', 'status'],
    },
  },
  {
    name: 'reschedule_task',
    description: 'Change the To-Do Date of an existing task.',
    input_schema: {
      type: 'object' as const,
      properties: {
        task_id: { type: 'string' },
        to_do_date: {
          type: 'string',
          description: 'New planned date in YYYY-MM-DD.',
        },
      },
      required: ['task_id', 'to_do_date'],
    },
  },
  {
    name: 'capture_idea',
    description:
      'Capture a brain-dump idea as a Creation-type task. Use when the user says things like "capture idea:", "save this:", or when the input is clearly exploratory rather than a concrete to-do.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: 'Short title for the idea' },
        initiative_name: {
          type: 'string',
          description:
            'Optional venture/initiative name if the idea clearly belongs to one.',
        },
      },
      required: ['title'],
    },
  },
  {
    name: 'update_task_dates',
    description:
      'Set or clear the Dates (deadline) field on a task. For single-date deadlines, set start only. For date ranges, set both start and end.',
    input_schema: {
      type: 'object' as const,
      properties: {
        task_id: { type: 'string' },
        dates_start: {
          type: 'string',
          description: 'Start date YYYY-MM-DD. Omit to clear the Dates field.',
        },
        dates_end: {
          type: 'string',
          description: 'End date YYYY-MM-DD. Defaults to dates_start if omitted.',
        },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'update_task_relations',
    description:
      'Set the Project (parent) or Tasks (subtasks) relations on a task. Pass arrays of Notion page IDs. Use search_tasks first to find the IDs.',
    input_schema: {
      type: 'object' as const,
      properties: {
        task_id: { type: 'string' },
        project_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Parent project page IDs. Replaces existing relations.',
        },
        task_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Subtask page IDs. Replaces existing relations.',
        },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'delete_task',
    description:
      'Archive (soft-delete) a task from Notion. IMPORTANT: Before calling this tool, you MUST ask the user for explicit confirmation in chat — e.g. "Are you sure you want to delete \'[task title]\'?" — and wait for their yes/confirm in the next message. Never call this without prior confirmation.',
    input_schema: {
      type: 'object' as const,
      properties: {
        task_id: { type: 'string' },
        task_title: {
          type: 'string',
          description: 'Title of the task being deleted, for logging.',
        },
      },
      required: ['task_id', 'task_title'],
    },
  },
  {
    name: 'search_notes',
    description: 'Search the Notes database by title. Read-only context lookup.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Substring to match against note titles.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_content',
    description: 'Search the Content database by title. Read-only context lookup.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Substring to match against content titles.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_companies',
    description: 'Search the Companies database by title. Read-only context lookup for relational management.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Substring to match against company names.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_contacts',
    description: 'Search the Contacts database by title. Read-only context lookup for relational management.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Substring to match against contact names.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_outreach',
    description: 'Search the Outreach database by title. Read-only context lookup for relational management.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Substring to match against outreach entries.' },
      },
      required: ['query'],
    },
  },
];

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------
export interface ChatAction {
  tool: string;
  input: Record<string, unknown>;
  result?: unknown;
  error?: string;
}

interface ToolContext {
  initiatives: Initiative[];
  todaysTasks: Task[];
  overdueTasks: Task[];
}

function resolveInitiative(name: string | undefined, ctx: ToolContext): string | undefined {
  if (!name) return undefined;
  const lower = name.toLowerCase();
  const hit = ctx.initiatives.find(
    (i) => i.name.toLowerCase() === lower || i.name.toLowerCase().includes(lower),
  );
  return hit?.id;
}

function summarizeTask(t: Task, initiatives: Initiative[]): Record<string, unknown> {
  const ventureNames = t.initiativeIds
    .map((id) => initiatives.find((i) => i.id === id)?.name)
    .filter(Boolean);
  return {
    id: t.id,
    title: t.title,
    type: t.type,
    status: t.status,
    to_do_date: t.toDoDate,
    dates_start: t.datesStart,
    dates_end: t.datesEnd,
    project_ids: t.projectIds.length ? t.projectIds : undefined,
    subtask_ids: t.subtaskIds.length ? t.subtaskIds : undefined,
    venture: ventureNames.join(', ') || null,
  };
}

async function handleTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<unknown> {
  switch (name) {
    case 'search_tasks': {
      const q = String(input.query ?? '').trim();
      const tasks = await searchOpenTasks(q, 10);
      return {
        query: q,
        count: tasks.length,
        tasks: tasks.map((t) => summarizeTask(t, ctx.initiatives)),
      };
    }
    case 'create_task': {
      const initiativeId = resolveInitiative(
        input.initiative_name as string | undefined,
        ctx,
      );
      if (input.initiative_name && !initiativeId) {
        return {
          error: `Unknown initiative "${input.initiative_name}". Available: ${ctx.initiatives
            .map((i) => i.name)
            .join(', ')}`,
        };
      }
      const id = await createTask({
        title: String(input.title),
        type: (input.type as string) ?? 'Tasks',
        toDoDate: input.to_do_date as string | undefined,
        initiativeId,
        status: (input.status as string) ?? 'Not started',
        source: 'Claude',
      });
      return { ok: true, task_id: id };
    }
    case 'update_task_status': {
      await updateTask(String(input.task_id), { status: String(input.status) });
      return { ok: true };
    }
    case 'reschedule_task': {
      await updateTask(String(input.task_id), {
        toDoDate: String(input.to_do_date),
      });
      return { ok: true };
    }
    case 'capture_idea': {
      const initiativeId = resolveInitiative(
        input.initiative_name as string | undefined,
        ctx,
      );
      const id = await createTask({
        title: String(input.title),
        type: 'Creation',
        initiativeId,
        status: 'Not started',
        source: 'Claude',
      });
      return { ok: true, task_id: id };
    }
    case 'update_task_dates': {
      const datesStart = (input.dates_start as string) || undefined;
      const datesEnd = (input.dates_end as string) || undefined;
      await updateTask(String(input.task_id), { datesStart, datesEnd });
      return { ok: true };
    }
    case 'update_task_relations': {
      await updateTask(String(input.task_id), {
        projectIds: input.project_ids as string[] | undefined,
        taskIds: input.task_ids as string[] | undefined,
      });
      return { ok: true };
    }
    case 'delete_task': {
      await deleteTask(String(input.task_id));
      return { ok: true, archived: true, title: input.task_title };
    }
    case 'search_notes': {
      const results = await searchNotes(String(input.query ?? ''));
      return { count: results.length, results: results.map((r) => ({ id: r.id, title: r.title, status: r.status })) };
    }
    case 'search_content': {
      const results = await searchContent(String(input.query ?? ''));
      return { count: results.length, results: results.map((r) => ({ id: r.id, title: r.title, status: r.status })) };
    }
    case 'search_companies': {
      const results = await searchCompanies(String(input.query ?? ''));
      return { count: results.length, results: results.map((r) => ({ id: r.id, title: r.title, status: r.status })) };
    }
    case 'search_contacts': {
      const results = await searchContacts(String(input.query ?? ''));
      return { count: results.length, results: results.map((r) => ({ id: r.id, title: r.title, status: r.status })) };
    }
    case 'search_outreach': {
      const results = await searchOutreach(String(input.query ?? ''));
      return { count: results.length, results: results.map((r) => ({ id: r.id, title: r.title, status: r.status })) };
    }
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// ---------------------------------------------------------------------------
// Chat loop
// ---------------------------------------------------------------------------
export interface ChatResult {
  reply: string;
  actions: ChatAction[];
  tokensIn: number;
  tokensOut: number;
  costEstimate: number;
  runId: string;
}

function renderTaskForContext(t: Task, initiatives: Initiative[]): string {
  const venture =
    t.initiativeIds
      .map((id) => initiatives.find((i) => i.id === id)?.name)
      .filter(Boolean)
      .join(', ') || 'Unassigned';
  const deadline = t.datesStart && t.datesEnd && t.datesStart !== t.datesEnd
    ? `${t.datesStart}→${t.datesEnd}`
    : t.datesEnd ?? t.datesStart;
  const bits = [
    `id=${t.id}`,
    `"${t.title}"`,
    t.type ? `[${t.type}]` : null,
    `venture=${venture}`,
    t.toDoDate ? `todo=${t.toDoDate}` : null,
    deadline ? `deadline=${deadline}` : null,
    t.status ? `status=${t.status}` : null,
    t.projectIds.length ? `parent_projects=${t.projectIds.length}` : null,
    t.subtaskIds.length ? `subtasks=${t.subtaskIds.length}` : null,
  ].filter(Boolean);
  return '- ' + bits.join('  ');
}

function buildChatSystemPrompt(ctx: ToolContext, todayIso: string): string {
  const base =
    loadContextFile('system.md') +
    '\n\n---\n\n' +
    loadContextFile('operations/venture-days.md') +
    '\n\n---\n\n' +
    loadContextFile('agents/ops-chief.md');

  const available = ctx.initiatives.map((i) => `- ${i.name}`).join('\n');

  const todayBlock = ctx.todaysTasks.length
    ? ctx.todaysTasks.map((t) => renderTaskForContext(t, ctx.initiatives)).join('\n')
    : '(nothing scheduled for today)';
  const overdueBlock = ctx.overdueTasks.length
    ? ctx.overdueTasks.slice(0, 25).map((t) => renderTaskForContext(t, ctx.initiatives)).join('\n')
    : '(no overdue tasks)';

  return `${base}

---

# Chat Mode

You are in a live chat with Briana. Unlike the daily briefing, responses
should be short, conversational, and one-shot. Two or three sentences is
usually right.

Today is ${todayIso}.

# Date reference — DO NOT calculate dates yourself. Use this table.
${buildDateTable(todayIso)}

Available initiatives (use these exact names when calling create_task or
capture_idea):
${available}

# Context loaded for this chat

Today's planned tasks (To-Do Date = today):
${todayBlock}

Overdue / carry-forward tasks (open, To-Do Date before today, up to 25):
${overdueBlock}

Rules:

- When the user says a day name ("Saturday", "next Monday"), look it up
  in the date reference table above. NEVER calculate dates yourself —
  always use the table.
- If the user asks what's on her plate, what's overdue, or similar questions
  about today's work, answer directly from the context above — do NOT call
  \`search_tasks\` for that.
- If the user references a task that is already in the context above, use
  that task's id directly — do NOT call \`search_tasks\` redundantly.
- Only call \`search_tasks\` when the user references a task that is NOT in
  the context above (e.g. something from earlier in the backlog).
- If \`search_tasks\` returns multiple matches and intent is ambiguous, ask a
  clarifying question instead of guessing.
- If the user is just creating a new task or capturing an idea, don't search
  first — just create it.
- After completing an action, confirm in one sentence. ("Done — pushed to
  Thursday.") Don't re-describe the task back in full.
- Never call a destructive tool (update_task_status to Done, reschedule_task)
  without being reasonably certain you have the right task.
- For delete_task: NEVER call delete_task without first asking the user
  "Are you sure you want to delete '{task title}'?" and waiting for their
  explicit "yes" or "confirm" in the next message. Two-step flow: search
  for the task, ask for confirmation, then delete only after they confirm.
- You have read-only access to Notes, Content, Companies, Contacts, and
  Outreach databases via search tools. Use these when the user asks about
  notes, content, contacts, companies, or outreach.
`;
}

type ClaudeMessage = Anthropic.MessageParam;

export async function runOpsChiefChat(userMessage: string): Promise<ChatResult> {
  const todayIso = new Date().toISOString().slice(0, 10);
  const run = await logRunStart(AGENT_NAME, 'chat');

  try {
    const [initiatives, todaysTasks, overdueTasks] = await Promise.all([
      getInitiatives(),
      getTodaysTasks(todayIso),
      getOverdueTasks(todayIso),
    ]);
    const toolCtx: ToolContext = { initiatives, todaysTasks, overdueTasks };

    // Today's chat history — load before saving the new user message so it
    // isn't duplicated in the conversation we send to Claude.
    const history = await getChatHistory(todayIso, 30);
    const messages: ClaudeMessage[] = history.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content as string,
    }));
    messages.push({ role: 'user', content: userMessage });

    await saveChatMessage({ role: 'user', content: userMessage });

    const memory = await getAgentMemory(AGENT_NAME);
    const systemPrompt = buildChatSystemPrompt(toolCtx, todayIso) + renderMemoryBlock(memory);
    const actions: ChatAction[] = [];
    let tokensIn = 0;
    let tokensOut = 0;

    const MAX_TURNS = 8;
    let finalText = '';

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 1500,
        system: systemPrompt,
        tools: TOOLS,
        messages,
      });
      tokensIn += response.usage.input_tokens;
      tokensOut += response.usage.output_tokens;

      // Push the assistant turn (including tool_use blocks) onto the transcript
      // so the next iteration has it.
      messages.push({ role: 'assistant', content: response.content });

      if (response.stop_reason === 'tool_use') {
        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        for (const block of response.content) {
          if (block.type !== 'tool_use') continue;
          const action: ChatAction = { tool: block.name, input: block.input as any };
          try {
            const result = await handleTool(block.name, block.input as any, toolCtx);
            action.result = result;
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify(result),
            });
          } catch (e: any) {
            action.error = e?.message ?? String(e);
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify({ error: action.error }),
              is_error: true,
            });
          }
          actions.push(action);
        }
        messages.push({ role: 'user', content: toolResults });
        continue;
      }

      // end_turn or max_tokens — extract final text
      finalText = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
      break;
    }

    if (!finalText) {
      finalText = '(Ops Chief did not return a reply — you may want to retry.)';
    }

    await saveChatMessage({
      role: 'assistant',
      content: finalText,
      metadata: actions.length ? { actions } : undefined,
    });

    const costEstimate =
      (tokensIn / 1_000_000) * PRICE_IN_PER_MTOK +
      (tokensOut / 1_000_000) * PRICE_OUT_PER_MTOK;

    await logRunComplete({
      runId: run.id,
      startedAt: run.started_at,
      status: 'success',
      tokensUsed: tokensIn + tokensOut,
      model: MODEL,
      contextSummary: `chat today=${todayIso} history=${history.length} actions=${actions.length}`,
      outputSummary: finalText.slice(0, 240),
      costEstimate: Number(costEstimate.toFixed(4)),
    });

    return {
      reply: finalText,
      actions,
      tokensIn,
      tokensOut,
      costEstimate,
      runId: run.id,
    };
  } catch (e: any) {
    await logRunComplete({
      runId: run.id,
      startedAt: run.started_at,
      status: 'error',
      model: MODEL,
      error: e?.message ?? String(e),
    });
    throw e;
  }
}
