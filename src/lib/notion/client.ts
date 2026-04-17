import { Client } from '@notionhq/client';
import { env } from '../env';

export const notion = new Client({ auth: env.notion.apiKey });

// ---------------------------------------------------------------------------
// Data source resolution
// ---------------------------------------------------------------------------
// Notion's current API splits "databases" and "data_sources". A database holds
// one or more data sources; queries target a data_source_id, not a database_id.
// We cache the first data source for each database we use.
const dataSourceCache = new Map<string, string>();

export async function resolveDataSourceId(databaseId: string): Promise<string> {
  const cached = dataSourceCache.get(databaseId);
  if (cached) return cached;
  const db: any = await notion.databases.retrieve({ database_id: databaseId });
  const dsId: string | undefined = db.data_sources?.[0]?.id;
  if (!dsId) {
    throw new Error(`Notion database ${databaseId} has no data_sources`);
  }
  dataSourceCache.set(databaseId, dsId);
  return dsId;
}

async function queryDs(databaseId: string, body: Record<string, unknown> = {}) {
  const dsId = await resolveDataSourceId(databaseId);
  return notion.dataSources.query({ data_source_id: dsId, ...body } as any);
}

// ---------------------------------------------------------------------------
// Property helpers — shield callers from Notion's verbose shape
// ---------------------------------------------------------------------------
export function getTitle(page: any): string {
  for (const prop of Object.values<any>(page.properties ?? {})) {
    if (prop.type === 'title') {
      return (prop.title ?? []).map((t: any) => t.plain_text).join('').trim();
    }
  }
  return '(untitled)';
}

export function getSelect(page: any, name: string): string | null {
  const p = page.properties?.[name];
  if (!p) return null;
  if (p.type === 'select') return p.select?.name ?? null;
  if (p.type === 'status') return p.status?.name ?? null;
  return null;
}

export function getMultiSelect(page: any, name: string): string[] {
  const p = page.properties?.[name];
  if (p?.type !== 'multi_select') return [];
  return (p.multi_select ?? []).map((x: any) => x.name);
}

export function getDate(page: any, name: string): string | null {
  const p = page.properties?.[name];
  if (p?.type !== 'date') return null;
  return p.date?.start ?? null;
}

export function getRelationIds(page: any, name: string): string[] {
  const p = page.properties?.[name];
  if (p?.type !== 'relation') return [];
  return (p.relation ?? []).map((r: any) => r.id);
}

export function getRichText(page: any, name: string): string {
  const p = page.properties?.[name];
  if (p?.type !== 'rich_text') return '';
  return (p.rich_text ?? []).map((t: any) => t.plain_text).join('');
}

// ---------------------------------------------------------------------------
// Queries — Initiatives, Intentions, Outcomes
// (Tasks queries below; finalized once Tasks DB is shared with integration.)
// ---------------------------------------------------------------------------
export interface Initiative {
  id: string;
  name: string;
  status: string | null;
}

export async function getInitiatives(): Promise<Initiative[]> {
  const res: any = await queryDs(env.notion.initiativesDbId, { page_size: 100 });
  return res.results.map((p: any) => ({
    id: p.id,
    name: getTitle(p),
    status: getSelect(p, 'Status'),
  }));
}

export interface Intention {
  id: string;
  name: string;
  status: string | null;
  deadline: string | null;
  initiativeIds: string[];
  outcomeIds: string[];
}

export async function getActiveIntentions(): Promise<Intention[]> {
  // Active = Status is On Track, At Risk, or Not Started (i.e. not Completed).
  const res: any = await queryDs(env.notion.intentionsDbId, {
    filter: {
      and: [
        { property: 'Status', status: { does_not_equal: 'Completed' } },
      ],
    },
    page_size: 100,
  });
  return res.results.map((p: any) => ({
    id: p.id,
    name: getTitle(p),
    status: getSelect(p, 'Status'),
    deadline: getDate(p, 'Deadline'),
    initiativeIds: getRelationIds(p, 'Initiative'),
    outcomeIds: getRelationIds(p, 'Key Results'),
  }));
}

export interface Outcome {
  id: string;
  name: string;
  status: string | null;
  season: string | null;
  current: number | null;
  target: number | null;
  initiativeIds: string[];
  intentionIds: string[];
}

function getNumber(page: any, name: string): number | null {
  const p = page.properties?.[name];
  if (p?.type !== 'number') return null;
  return p.number ?? null;
}

export async function getActiveOutcomes(): Promise<Outcome[]> {
  const res: any = await queryDs(env.notion.outcomesDbId, {
    filter: {
      and: [
        { property: 'Status', status: { does_not_equal: 'Done' } },
        { property: 'Status', status: { does_not_equal: 'Hold' } },
      ],
    },
    page_size: 100,
  });
  return res.results.map((p: any) => ({
    id: p.id,
    name: getTitle(p),
    status: getSelect(p, 'Status'),
    season: getSelect(p, 'Season'),
    current: getNumber(p, 'Current'),
    target: getNumber(p, 'Target'),
    initiativeIds: getRelationIds(p, 'Initiative'),
    intentionIds: getRelationIds(p, 'Objectives'),
  }));
}

// ---------------------------------------------------------------------------
// Tasks (To-Do database)
// Schema (from introspect, 2026-04-15):
//   Task (title), Type (select), Status (status), To-Do Date (date),
//   Initiative (relation → Initiatives), Outcome (relation → Outcomes),
//   Intention (rollup), Monthly Priority (checkbox), Source (select).
// ---------------------------------------------------------------------------
export interface Task {
  id: string;
  title: string;
  type: string | null;
  status: string | null;
  toDoDate: string | null;
  // `Dates` is the Project hard-deadline field. Non-projects rarely set it.
  // For ranges, `datesEnd` is the ship/launch date; for single dates, start == end.
  datesStart: string | null;
  datesEnd: string | null;
  initiativeIds: string[];
  outcomeIds: string[];
  // Self-relations on the To-Do DB. `projectIds` = parent projects this task
  // rolls up to; `subtaskIds` = child tasks underneath this project/task.
  projectIds: string[];
  subtaskIds: string[];
  source: string | null;
  raw: any;
}

function getDateRange(page: any, name: string): { start: string | null; end: string | null } {
  const p = page.properties?.[name];
  if (p?.type !== 'date' || !p.date) return { start: null, end: null };
  return { start: p.date.start ?? null, end: p.date.end ?? p.date.start ?? null };
}

function mapTask(page: any): Task {
  const dates = getDateRange(page, 'Dates');
  return {
    id: page.id,
    title: getTitle(page),
    type: getSelect(page, 'Type'),
    status: getSelect(page, 'Status'),
    toDoDate: getDate(page, 'To-Do Date'),
    datesStart: dates.start,
    datesEnd: dates.end,
    initiativeIds: getRelationIds(page, 'Initiative'),
    outcomeIds: getRelationIds(page, 'Outcome'),
    projectIds: getRelationIds(page, 'Project'),
    subtaskIds: getRelationIds(page, 'Tasks'),
    source: getSelect(page, 'Source'),
    raw: page,
  };
}

const OPEN_STATUS_FILTER = {
  and: [
    { property: 'Status', status: { does_not_equal: 'Done' } },
    { property: 'Status', status: { does_not_equal: 'Hold' } },
  ],
};

export async function getTodaysTasks(todayIso?: string): Promise<Task[]> {
  const today = todayIso ?? new Date().toISOString().slice(0, 10);
  const res: any = await queryDs(env.notion.tasksDbId, {
    filter: {
      and: [
        { property: 'To-Do Date', date: { equals: today } },
        ...OPEN_STATUS_FILTER.and,
      ],
    },
    page_size: 100,
  });
  return res.results.map(mapTask);
}

export async function getWeekTasks(startIso?: string, endIso?: string): Promise<Task[]> {
  const start = startIso ?? new Date().toISOString().slice(0, 10);
  const end = endIso ?? new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  const res: any = await queryDs(env.notion.tasksDbId, {
    filter: {
      and: [
        { property: 'To-Do Date', date: { on_or_after: start } },
        { property: 'To-Do Date', date: { on_or_before: end } },
        ...OPEN_STATUS_FILTER.and,
      ],
    },
    page_size: 100,
  });
  return res.results.map(mapTask);
}

// Overdue: open tasks whose To-Do Date is strictly before today. Deliberately
// uncapped per product decision — nothing should silently disappear.
export async function getOverdueTasks(todayIso?: string): Promise<Task[]> {
  const today = todayIso ?? new Date().toISOString().slice(0, 10);
  const res: any = await queryDs(env.notion.tasksDbId, {
    filter: {
      and: [
        { property: 'To-Do Date', date: { before: today } },
        ...OPEN_STATUS_FILTER.and,
      ],
    },
    page_size: 100,
  });
  return res.results.map(mapTask);
}

// Projects with a hard deadline (Dates.end, or Dates.start for single dates)
// landing within the next N days. Open status only.
export async function getUrgentProjects(
  windowDays = 3,
  todayIso?: string,
): Promise<Task[]> {
  const today = todayIso ?? new Date().toISOString().slice(0, 10);
  const horizon = new Date(new Date(today).getTime() + windowDays * 864e5)
    .toISOString()
    .slice(0, 10);
  const res: any = await queryDs(env.notion.tasksDbId, {
    filter: {
      and: [
        { property: 'Type', select: { equals: 'Projects' } },
        { property: 'Dates', date: { is_not_empty: true } },
        { property: 'Dates', date: { on_or_before: horizon } },
        ...OPEN_STATUS_FILTER.and,
      ],
    },
    page_size: 50,
  });
  // Post-filter: Notion's date filter compares the range's start; we want the
  // end date (if present) to be the deadline, and we want deadlines that
  // haven't already passed. So filter `datesEnd >= today` in JS.
  return res.results
    .map(mapTask)
    .filter((t: Task) => {
      const deadline = t.datesEnd ?? t.datesStart;
      return !!deadline && deadline >= today && deadline <= horizon;
    });
}

// Fetch all open tasks whose `Project` relation points to any of the given
// parent task ids. Recurses through sub-projects so deeply-nested subtasks
// under a deadline-driven project surface in priority.
export async function getOpenSubtasksOfProjects(
  parentIds: string[],
  maxDepth = 3,
): Promise<Task[]> {
  if (!parentIds.length) return [];
  const seen = new Set<string>();
  const results: Task[] = [];
  let frontier = [...new Set(parentIds)];

  for (let depth = 0; depth < maxDepth && frontier.length; depth++) {
    const res: any = await queryDs(env.notion.tasksDbId, {
      filter: {
        and: [
          {
            or: frontier.map((id) => ({
              property: 'Project',
              relation: { contains: id },
            })),
          },
          ...OPEN_STATUS_FILTER.and,
        ],
      },
      page_size: 100,
    });
    const next: string[] = [];
    for (const page of res.results) {
      if (seen.has(page.id)) continue;
      seen.add(page.id);
      const task = mapTask(page);
      results.push(task);
      if (task.type === 'Projects') next.push(task.id);
    }
    frontier = next;
  }
  return results;
}

// Monthly priorities: the `Monthly Priority` checkbox is the authoritative
// signal. We also surface any open task aligned to an Outcome whose to-do
// date falls in the current month, so nothing tied to a KR slips through.
// Notion compound filters cap at 2 levels of nesting, so we run two queries
// and merge in memory instead of nesting and/or/and.
export async function getMonthlyPriorities(monthIso?: string): Promise<Task[]> {
  const now = monthIso ? new Date(monthIso) : new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const monthStart = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  const monthEnd = new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);

  const flaggedPromise = queryDs(env.notion.tasksDbId, {
    filter: {
      and: [
        { property: 'Monthly Priority', checkbox: { equals: true } },
        ...OPEN_STATUS_FILTER.and,
      ],
    },
    page_size: 100,
  });

  const outcomeLinkedPromise = queryDs(env.notion.tasksDbId, {
    filter: {
      and: [
        { property: 'Outcome', relation: { is_not_empty: true } },
        { property: 'To-Do Date', date: { on_or_after: monthStart } },
        { property: 'To-Do Date', date: { on_or_before: monthEnd } },
        ...OPEN_STATUS_FILTER.and,
      ],
    },
    page_size: 100,
  });

  const [flagged, outcomeLinked]: any = await Promise.all([flaggedPromise, outcomeLinkedPromise]);
  const seen = new Set<string>();
  const merged: Task[] = [];
  for (const page of [...flagged.results, ...outcomeLinked.results]) {
    if (seen.has(page.id)) continue;
    seen.add(page.id);
    merged.push(mapTask(page));
  }
  return merged;
}

// Title substring search across open tasks. Used by the chat agent to
// resolve natural-language references like "the Substack draft".
export async function searchOpenTasks(query: string, limit = 10): Promise<Task[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const res: any = await queryDs(env.notion.tasksDbId, {
    filter: {
      and: [
        { property: 'Task', title: { contains: trimmed } },
        ...OPEN_STATUS_FILTER.and,
      ],
    },
    page_size: limit,
  });
  return res.results.map(mapTask);
}

// ---------------------------------------------------------------------------
// Writes — Task creation / update in the To-Do database.
// ---------------------------------------------------------------------------
export interface CreateTaskParams {
  title: string;
  type?: string;
  toDoDate?: string;
  datesStart?: string;
  datesEnd?: string;
  initiativeId?: string;
  outcomeId?: string;
  projectIds?: string[];
  taskIds?: string[];
  monthlyPriority?: boolean;
  source?: string;
  status?: string;
}

export async function createTask(params: CreateTaskParams): Promise<string> {
  const dsId = await resolveDataSourceId(env.notion.tasksDbId);
  const properties: Record<string, unknown> = {
    Task: { title: [{ type: 'text', text: { content: params.title } }] },
  };
  if (params.type) properties.Type = { select: { name: params.type } };
  if (params.status) properties.Status = { status: { name: params.status } };
  if (params.toDoDate) properties['To-Do Date'] = { date: { start: params.toDoDate } };
  if (params.initiativeId) properties.Initiative = { relation: [{ id: params.initiativeId }] };
  if (params.outcomeId) properties.Outcome = { relation: [{ id: params.outcomeId }] };
  if (params.monthlyPriority != null) properties['Monthly Priority'] = { checkbox: params.monthlyPriority };
  if (params.source) properties.Source = { select: { name: params.source } };
  if (params.datesStart) {
    properties['Dates'] = {
      date: { start: params.datesStart, end: params.datesEnd ?? null },
    };
  }
  if (params.projectIds?.length) {
    properties['Project'] = { relation: params.projectIds.map((id) => ({ id })) };
  }
  if (params.taskIds?.length) {
    properties['Tasks'] = { relation: params.taskIds.map((id) => ({ id })) };
  }

  const res: any = await notion.pages.create({
    parent: { type: 'data_source_id', data_source_id: dsId } as any,
    properties: properties as any,
  });
  return res.id as string;
}

export async function updateTask(id: string, params: Partial<CreateTaskParams>): Promise<void> {
  const properties: Record<string, unknown> = {};
  if (params.title) properties.Task = { title: [{ type: 'text', text: { content: params.title } }] };
  if (params.type) properties.Type = { select: { name: params.type } };
  if (params.status) properties.Status = { status: { name: params.status } };
  if (params.toDoDate) properties['To-Do Date'] = { date: { start: params.toDoDate } };
  if (params.initiativeId) properties.Initiative = { relation: [{ id: params.initiativeId }] };
  if (params.outcomeId) properties.Outcome = { relation: [{ id: params.outcomeId }] };
  if (params.monthlyPriority != null) properties['Monthly Priority'] = { checkbox: params.monthlyPriority };
  if (params.source) properties.Source = { select: { name: params.source } };
  if (params.datesStart !== undefined) {
    properties['Dates'] = params.datesStart
      ? { date: { start: params.datesStart, end: params.datesEnd ?? null } }
      : { date: null };
  }
  if (params.projectIds !== undefined) {
    properties['Project'] = { relation: (params.projectIds ?? []).map((id) => ({ id })) };
  }
  if (params.taskIds !== undefined) {
    properties['Tasks'] = { relation: (params.taskIds ?? []).map((id) => ({ id })) };
  }

  await notion.pages.update({ page_id: id, properties: properties as any });
}

// ---------------------------------------------------------------------------
// Delete (archive) a task
// ---------------------------------------------------------------------------
export async function deleteTask(id: string): Promise<void> {
  await notion.pages.update({ page_id: id, archived: true });
}

// ---------------------------------------------------------------------------
// Read-only search functions for Notes, Content, and Relational Management DBs
// ---------------------------------------------------------------------------
export interface NotionRecord {
  id: string;
  title: string;
  status: string | null;
  raw: any;
}

function mapGenericRecord(page: any): NotionRecord {
  return {
    id: page.id,
    title: getTitle(page),
    status: getSelect(page, 'Status'),
    raw: page,
  };
}

async function searchDb(
  dbId: string | undefined,
  dbName: string,
  query: string,
  limit: number,
): Promise<NotionRecord[]> {
  if (!dbId) {
    console.warn(`${dbName} DB ID not configured — skipping search`);
    return [];
  }
  const trimmed = query.trim();
  if (!trimmed) return [];
  // Use Notion's full-text search filter; the title property name varies per DB,
  // so we rely on the database's built-in search via the query parameter.
  const dsId = await resolveDataSourceId(dbId);
  const res: any = await (notion.dataSources as any).query({
    data_source_id: dsId,
    filter: { and: [{ property: 'title', rich_text: { contains: trimmed } }] },
    page_size: limit,
  });
  return res.results.map(mapGenericRecord);
}

export async function searchNotes(query: string, limit = 10): Promise<NotionRecord[]> {
  return searchDb(env.notion.notesDbId, 'Notes', query, limit);
}

export async function searchContent(query: string, limit = 10): Promise<NotionRecord[]> {
  return searchDb(env.notion.contentDbId, 'Content', query, limit);
}

export async function searchCompanies(query: string, limit = 10): Promise<NotionRecord[]> {
  return searchDb(env.notion.companiesDbId, 'Companies', query, limit);
}

export async function searchContacts(query: string, limit = 10): Promise<NotionRecord[]> {
  return searchDb(env.notion.contactsDbId, 'Contacts', query, limit);
}

export async function searchOutreach(query: string, limit = 10): Promise<NotionRecord[]> {
  return searchDb(env.notion.outreachDbId, 'Outreach', query, limit);
}

// ---------------------------------------------------------------------------
// TTS-specific queries for Showrunner daily check
// ---------------------------------------------------------------------------
export async function getTTSTasksForWeek(
  startIso: string,
  endIso: string,
  initiativeId: string,
): Promise<Task[]> {
  const res: any = await queryDs(env.notion.tasksDbId, {
    filter: {
      and: [
        { property: 'Initiative', relation: { contains: initiativeId } },
        { property: 'To-Do Date', date: { on_or_after: startIso } },
        { property: 'To-Do Date', date: { on_or_before: endIso } },
        ...OPEN_STATUS_FILTER.and,
      ],
    },
    page_size: 50,
  });
  return res.results.map(mapTask);
}

export async function getContentEntriesForWeek(
  startIso: string,
  endIso: string,
): Promise<NotionRecord[]> {
  const contentDbId = env.notion.contentDbId;
  if (!contentDbId) return [];
  const res: any = await queryDs(contentDbId, {
    filter: {
      and: [
        { property: 'Time', date: { on_or_after: startIso } },
        { property: 'Time', date: { on_or_before: endIso } },
        { property: 'Status', select: { does_not_equal: '✅ Published' } },
        { property: 'Status', select: { does_not_equal: '✅ Done' } },
      ],
    },
    page_size: 50,
  });
  return res.results.map((page: any) => ({
    id: page.id,
    title: getTitle(page),
    status: getSelect(page, 'Status'),
    contentType: getMultiSelect(page, 'Content Type'),
    publishDate: getDate(page, 'Time'),
    raw: page,
  }));
}

// ---------------------------------------------------------------------------
// Content DB — writes for Showrunner content calendar
// ---------------------------------------------------------------------------
export interface CreateContentParams {
  name: string;
  status?: string;
  contentType?: string[];
  platforms?: string[];
  caption?: string;
  contentPillar?: string[];
  publishDate?: string;
  ventureIds?: string[];
}

export async function createContentEntry(params: CreateContentParams): Promise<string> {
  const contentDbId = env.notion.contentDbId;
  if (!contentDbId) throw new Error('NOTION_CONTENT_DB_ID not configured');
  const dsId = await resolveDataSourceId(contentDbId);

  const properties: Record<string, unknown> = {
    Name: { title: [{ type: 'text', text: { content: params.name } }] },
  };
  if (params.status) properties.Status = { select: { name: params.status } };
  if (params.contentType?.length) {
    properties['Content Type'] = { multi_select: params.contentType.map((name) => ({ name })) };
  }
  if (params.platforms?.length) {
    properties.Platforms = { multi_select: params.platforms.map((name) => ({ name })) };
  }
  if (params.caption) {
    properties.Caption = { rich_text: [{ type: 'text', text: { content: params.caption } }] };
  }
  if (params.contentPillar?.length) {
    properties['Content Pillar'] = { multi_select: params.contentPillar.map((name) => ({ name })) };
  }
  if (params.publishDate) {
    properties.Time = { date: { start: params.publishDate } };
  }
  if (params.ventureIds?.length) {
    properties.Ventures = { relation: params.ventureIds.map((id) => ({ id })) };
  }

  const res: any = await notion.pages.create({
    parent: { type: 'data_source_id', data_source_id: dsId } as any,
    properties: properties as any,
  });
  return res.id as string;
}
