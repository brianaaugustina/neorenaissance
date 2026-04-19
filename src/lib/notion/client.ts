import { Client } from '@notionhq/client';
import { env } from '../env';
import { addDaysIso, todayIsoPT } from '../time';

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
  const today = todayIso ?? todayIsoPT();
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
  const start = startIso ?? todayIsoPT();
  const end = endIso ?? addDaysIso(start, 7);
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

// Recently-completed tasks — Status = Done AND last edited within the window.
// Used by Ops Chief briefing to ground cross-agent recommendations in what
// actually got finished (e.g., if Showrunner's caption task was just marked
// Done, the next delegation doesn't need to flag that clip again).
export async function getCompletedTasksSince(sinceIso: string): Promise<Task[]> {
  const res: any = await queryDs(env.notion.tasksDbId, {
    filter: {
      and: [
        { property: 'Status', status: { equals: 'Done' } },
        { timestamp: 'last_edited_time', last_edited_time: { on_or_after: sinceIso } },
      ],
    },
    sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }],
    page_size: 30,
  });
  return res.results.map(mapTask);
}

// Overdue: open tasks whose To-Do Date is strictly before today. Deliberately
// uncapped per product decision — nothing should silently disappear.
export async function getOverdueTasks(todayIso?: string): Promise<Task[]> {
  const today = todayIso ?? todayIsoPT();
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
  const today = todayIso ?? todayIsoPT();
  const horizon = addDaysIso(today, windowDays);
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
// Sponsorship Director — Outreach DB writes
// ---------------------------------------------------------------------------
// Schema fields used (confirmed via introspect-outreach.ts):
//   Name (title), Organization (rich_text), Contact Name (rich_text),
//   Contact Email (email), Contact LinkedIn (url), Fit Score (number),
//   Why They Fit (rich_text), Draft Message (rich_text), Date Sent (date),
//   Outreach Type (select), Venture (select), Status (select),
//   Source (select), Season (rich_text), Approved (checkbox).
//
// Status values agent writes: 'Draft Ready', 'Pending Approval', 'Approved',
// 'Sent', 'Pass'. Briana-only values ('Identified', 'Vetted', 'Responded')
// stay available for manual triage.

export type OutreachStatus =
  | 'Identified'
  | 'Vetted'
  | 'Draft Ready'
  | 'Pending Approval'
  | 'Approved'
  | 'Sent'
  | 'Responded'
  | 'Pass';

export type OutreachType = 'Sponsorship' | 'Press' | 'Partnership' | 'Artisan Sourcing';
export type OutreachVenture = 'The Trades Show' | 'The Corral' | 'Artisanship';
export type OutreachSource = 'Claude' | 'Manual';

export interface CreateOutreachRowParams {
  name: string;
  outreachType: OutreachType;
  venture: OutreachVenture;
  status: OutreachStatus;
  source?: OutreachSource;
  season?: string;
  organization?: string;
  contactName?: string;
  contactEmail?: string;
  contactLinkedin?: string;
  website?: string;
  instagramHandle?: string;
  fitScore?: number;
  whyFit?: string;
  draftMessage?: string;
  dateSent?: string; // YYYY-MM-DD
  approved?: boolean;
  contactId?: string; // Notion page id of an existing Contacts row (sub-step 2)
}

function richText(v?: string) {
  return v ? { rich_text: [{ type: 'text' as const, text: { content: v } }] } : undefined;
}

function buildOutreachProperties(
  params: Partial<CreateOutreachRowParams>,
): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  if (params.name !== undefined) {
    p['Name'] = { title: [{ type: 'text', text: { content: params.name } }] };
  }
  if (params.outreachType) p['Outreach Type'] = { select: { name: params.outreachType } };
  if (params.venture) p['Venture'] = { select: { name: params.venture } };
  if (params.status) p['Status'] = { select: { name: params.status } };
  if (params.source) p['Source'] = { select: { name: params.source } };
  if (params.season !== undefined) {
    const rt = richText(params.season);
    if (rt) p['Season'] = rt;
  }
  if (params.organization !== undefined) {
    const rt = richText(params.organization);
    if (rt) p['Organization'] = rt;
  }
  if (params.contactName !== undefined) {
    const rt = richText(params.contactName);
    if (rt) p['Contact Name'] = rt;
  }
  if (params.contactEmail) p['Contact Email'] = { email: params.contactEmail };
  if (params.contactLinkedin) p['Contact LinkedIn'] = { url: params.contactLinkedin };
  if (params.website) p['Website'] = { url: params.website };
  if (params.instagramHandle !== undefined) {
    const rt = richText(params.instagramHandle);
    if (rt) p['Instagram Handle'] = rt;
  }
  if (params.fitScore !== undefined) p['Fit Score'] = { number: params.fitScore };
  if (params.whyFit !== undefined) {
    const rt = richText(params.whyFit);
    if (rt) p['Why They Fit'] = rt;
  }
  if (params.draftMessage !== undefined) {
    const rt = richText(params.draftMessage);
    if (rt) p['Draft Message'] = rt;
  }
  if (params.dateSent) p['Date Sent'] = { date: { start: params.dateSent } };
  if (params.approved !== undefined) p['Approved'] = { checkbox: params.approved };
  if (params.contactId) p['Contact'] = { relation: [{ id: params.contactId }] };
  return p;
}

export async function createOutreachRow(
  params: CreateOutreachRowParams,
): Promise<string> {
  const outreachDbId = env.notion.outreachDbId;
  if (!outreachDbId) throw new Error('NOTION_OUTREACH_DB not set');
  const dsId = await resolveDataSourceId(outreachDbId);
  const properties = buildOutreachProperties(params);
  const res: any = await notion.pages.create({
    parent: { type: 'data_source_id', data_source_id: dsId } as any,
    properties: properties as any,
  });
  return res.id as string;
}

export async function updateOutreachRow(
  pageId: string,
  params: Partial<CreateOutreachRowParams>,
): Promise<void> {
  const properties = buildOutreachProperties(params);
  await notion.pages.update({ page_id: pageId, properties: properties as any });
}

// ---------------------------------------------------------------------------
// Talent Scout — Contacts DB append-only writes for artisan candidates.
// Per the spec, Contacts DB rows are frozen at creation: we write once at
// research time and never update. Status lives on the Outreach DB instead.
// ---------------------------------------------------------------------------

export type ContactType =
  | 'Podcast Guest'
  | 'Partner'
  | 'Customer'
  | 'Network';

export type ContactConnectionStatus =
  | 'Need to Reach Out'
  | 'Cold'
  | 'Warm'
  | 'Waiting'
  | 'In Contact'
  | 'Discovery Call'
  | 'Follow-up'
  | 'Connected'
  | 'Need to Schedule'
  | 'Active Client/Guest'
  | 'Past Client/Guest'
  | 'Hold/Passed';

export interface CreateContactRowParams {
  name: string;
  type?: ContactType[];
  connectionStatus?: ContactConnectionStatus;
  email?: string;
  social?: string; // URL — typically IG profile
  phone?: string;
  address?: string;
  city?:
    | 'San Francisco'
    | 'New York'
    | 'PNW'
    | 'Austin'
    | 'Sheffield UK'
    | 'UK'
    | 'Oakland'
    | 'Hudson NY'
    | 'Portland';
  industry?: string[]; // multi-select values from the Industry options
  role?: string[]; // multi-select values from the Role options
  notes?: string;
}

export async function createContactRow(
  params: CreateContactRowParams,
): Promise<string> {
  const contactsDbId = env.notion.contactsDbId;
  if (!contactsDbId) throw new Error('NOTION_CONTACTS_DB_ID not set');
  const dsId = await resolveDataSourceId(contactsDbId);

  const properties: Record<string, unknown> = {
    Name: { title: [{ type: 'text', text: { content: params.name } }] },
  };
  if (params.type?.length) {
    properties['Type'] = {
      multi_select: params.type.map((name) => ({ name })),
    };
  }
  if (params.connectionStatus) {
    properties['Connection Status'] = {
      status: { name: params.connectionStatus },
    };
  }
  if (params.email) properties['Email'] = { email: params.email };
  if (params.social) properties['Social'] = { url: params.social };
  if (params.phone) properties['Phone'] = { phone_number: params.phone };
  if (params.address) {
    properties['Address'] = {
      rich_text: [{ type: 'text', text: { content: params.address } }],
    };
  }
  if (params.city) properties['City'] = { select: { name: params.city } };
  if (params.industry?.length) {
    properties['Industry'] = {
      multi_select: params.industry.map((name) => ({ name })),
    };
  }
  if (params.role?.length) {
    properties['Role'] = {
      multi_select: params.role.map((name) => ({ name })),
    };
  }
  if (params.notes) {
    properties['Notes'] = {
      rich_text: [{ type: 'text', text: { content: params.notes } }],
    };
  }

  const res: any = await notion.pages.create({
    parent: { type: 'data_source_id', data_source_id: dsId } as any,
    properties: properties as any,
  });
  return res.id as string;
}

// Fetches currently-active Outreach rows for a given venture + outreach type.
// Used during research batch generation to dedupe: don't re-surface a brand
// already in the pipeline.
export interface OutreachPipelineRow {
  id: string;
  name: string;
  organization: string | null;
  contactEmail: string | null;
  status: string | null;
  fitScore: number | null;
  season: string | null;
}

export async function getActiveOutreachRows(
  outreachType: OutreachType,
  venture: OutreachVenture,
): Promise<OutreachPipelineRow[]> {
  const outreachDbId = env.notion.outreachDbId;
  if (!outreachDbId) return [];
  const res: any = await queryDs(outreachDbId, {
    filter: {
      and: [
        { property: 'Outreach Type', select: { equals: outreachType } },
        { property: 'Venture', select: { equals: venture } },
        // Treat everything except 'Pass' as active; Briana can prune manually.
        { property: 'Status', select: { does_not_equal: 'Pass' } },
      ],
    },
    page_size: 100,
  });
  return (res.results ?? []).map((page: any) => {
    const props = page.properties ?? {};
    const orgProp = props['Organization']?.rich_text ?? [];
    const seasonProp = props['Season']?.rich_text ?? [];
    return {
      id: page.id,
      name: getTitle(page),
      organization: orgProp.map((t: any) => t.plain_text).join('').trim() || null,
      contactEmail: props['Contact Email']?.email ?? null,
      status: props['Status']?.select?.name ?? null,
      fitScore: props['Fit Score']?.number ?? null,
      season: seasonProp.map((t: any) => t.plain_text).join('').trim() || null,
    };
  });
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
// Notion file uploads — two-step flow: create upload, then send file bytes.
// Returns the file_upload_id to reference in a page's Files property.
// ---------------------------------------------------------------------------
export async function uploadFileToNotion(
  data: Buffer,
  filename: string,
  contentType: string,
): Promise<string> {
  const upload: any = await (notion as any).fileUploads.create({
    mode: 'single_part',
    filename,
    content_type: contentType,
  });
  const fileUploadId: string = upload.id;

  // SDK accepts Blob; construct one from the buffer so Node runtime works too.
  // Copy into a fresh Uint8Array to satisfy Blob's BlobPart typing.
  const bytes = new Uint8Array(data.byteLength);
  bytes.set(data);
  const blob = new Blob([bytes], { type: contentType });
  await (notion as any).fileUploads.send({
    file_upload_id: fileUploadId,
    file: { filename, data: blob },
  });
  return fileUploadId;
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
  /** YYYY-MM-DD for date-only, or ISO datetime if you want to include time inline. */
  publishDate?: string;
  /** HH:mm (24-hour). If provided with a YYYY-MM-DD publishDate, combined into
   *  a timezone-aware ISO datetime before sending to Notion. Ignored when
   *  publishDate already carries a time component. */
  publishTime?: string;
  /** IANA tz name for the publishTime. Defaults to America/Los_Angeles. */
  publishTimezone?: string;
  ventureIds?: string[];
  // file_upload ids from uploadFileToNotion, attached to the Files property.
  fileUploadIds?: string[];
  filesPropertyName?: string; // Defaults to 'Files'; override if DB names it differently.
}

// Combine a YYYY-MM-DD publishDate with an optional HH:mm publishTime into an
// ISO datetime string with the appropriate timezone offset. Notion's date
// property accepts either a bare YYYY-MM-DD (date-only) or a full ISO datetime
// with timezone; when time is supplied we send the latter.
function combinePublishDateTime(
  date: string,
  time: string | undefined,
  tz: string,
): string {
  if (!time) return date;
  // If caller already passed a datetime, trust it.
  if (date.length > 10) return date;
  // Compute the offset for the given date in the given tz. The TZ component
  // changes with DST so we can't hardcode -07:00 / -08:00.
  const iso = `${date}T${time.length === 5 ? time + ':00' : time}`;
  const offset = computeTimezoneOffset(new Date(iso + 'Z'), tz);
  return `${iso}${offset}`;
}

function computeTimezoneOffset(d: Date, tz: string): string {
  // Format the date in the target timezone as YYYY-MM-DDTHH:mm:ss, then parse
  // back as UTC and diff with the original to derive the offset. Standard trick.
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = fmt.formatToParts(d).reduce<Record<string, string>>((acc, p) => {
    if (p.type !== 'literal') acc[p.type] = p.value;
    return acc;
  }, {});
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour === '24' ? '00' : parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  const offsetMinutes = (asUtc - d.getTime()) / 60000;
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${sign}${hh}:${mm}`;
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
    const start = combinePublishDateTime(
      params.publishDate,
      params.publishTime,
      params.publishTimezone ?? 'America/Los_Angeles',
    );
    properties.Time = {
      date: {
        start,
        time_zone: params.publishTime ? (params.publishTimezone ?? 'America/Los_Angeles') : null,
      },
    };
  }
  if (params.ventureIds?.length) {
    properties.Ventures = { relation: params.ventureIds.map((id) => ({ id })) };
  }
  if (params.fileUploadIds?.length) {
    const propName = params.filesPropertyName ?? 'Files';
    properties[propName] = {
      files: params.fileUploadIds.map((id, i) => ({
        type: 'file_upload',
        file_upload: { id },
        name: `clip-${i + 1}`,
      })),
    };
  }

  const res: any = await notion.pages.create({
    parent: { type: 'data_source_id', data_source_id: dsId } as any,
    properties: properties as any,
  });
  return res.id as string;
}
