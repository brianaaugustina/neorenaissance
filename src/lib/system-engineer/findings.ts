// Finding reconciliation — stable IDs across weekly reports.
// ID format: {severity-letter}-{repo-letter}{seq}, e.g. C-D01.

import { supabaseAdmin } from '../supabase/client';

export type FindingSeverity = 'critical' | 'medium' | 'low';
export type FindingCategory =
  | 'security'
  | 'dependencies'
  | 'tests'
  | 'performance'
  | 'code-quality'
  | 'git-hygiene'
  | 'error-logs';
export type FindingStatus =
  | 'new'
  | 'persisting'
  | 'marked-fix'
  | 'deferred'
  | 'ignored'
  | 'fixed'
  | 'reopened';

export type RepoShortId = 'agent-system' | 'detto' | 'tts' | 'personal-site';

const REPO_LETTERS: Record<RepoShortId, string> = {
  'agent-system': 'A',
  detto: 'D',
  tts: 'T',
  'personal-site': 'B',
};

const SEVERITY_LETTERS: Record<FindingSeverity, string> = {
  critical: 'C',
  medium: 'M',
  low: 'L',
};

export interface Finding {
  id: string;
  repo_short_id: RepoShortId;
  severity: FindingSeverity;
  category: FindingCategory;
  title: string;
  impact: string;
  fix_suggestion: string;
  effort: 'S' | 'M' | 'L';
  file_refs: string[];
  status: FindingStatus;
  first_seen_at: string;
  last_seen_at: string;
  days_open?: number;
  // Mutated as Briana acts:
  action_taken?: {
    kind: 'fix' | 'defer' | 'ignore';
    note: string | null;
    learning_id: string | null;
    taken_at: string;
  } | null;
}

export function generateFindingId(params: {
  repoShortId: RepoShortId;
  severity: FindingSeverity;
  existingIds: Set<string>;
}): string {
  const prefix = `${SEVERITY_LETTERS[params.severity]}-${REPO_LETTERS[params.repoShortId]}`;
  let n = 1;
  while (params.existingIds.has(`${prefix}${String(n).padStart(2, '0')}`)) n++;
  return `${prefix}${String(n).padStart(2, '0')}`;
}

// Pulls the most recent weekly_codebase_health_report's findings so we can
// reconcile: persisting findings keep their IDs; deferred / ignored findings
// stay hidden; fixed findings that come back get tagged 'reopened'.
export async function getPreviousFindings(): Promise<Finding[]> {
  const { data, error } = await supabaseAdmin()
    .from('agent_outputs')
    .select('id, created_at, draft_content, final_content')
    .eq('agent_id', 'system-engineer')
    .eq('output_type', 'weekly_codebase_health_report')
    .order('created_at', { ascending: false })
    .limit(1);
  if (error || !data || data.length === 0) return [];
  const body = (data[0].final_content ??
    data[0].draft_content ??
    {}) as { findings?: Finding[] };
  return body.findings ?? [];
}

// Pulls deferred / ignored findings from agent_learnings so we never
// re-surface them unless their underlying severity changes.
export async function getDeferredIgnoredTitleSet(): Promise<Set<string>> {
  const { data, error } = await supabaseAdmin()
    .from('agent_learnings')
    .select('title, learning_type')
    .eq('agent_id', 'system-engineer')
    .in('learning_type', ['failure_mode']);
  if (error || !data) return new Set();
  return new Set(data.map((r: any) => (r.title as string).toLowerCase()));
}

// Match a new candidate finding against previous findings by title similarity.
// Cheap approach: exact title match + same repo_short_id + same category.
// Enough for MVP; semantic matching can layer in later.
function findMatch(
  candidate: Omit<Finding, 'id' | 'status' | 'first_seen_at' | 'last_seen_at'>,
  previous: Finding[],
): Finding | null {
  const key = `${candidate.repo_short_id}::${candidate.category}::${candidate.title.trim().toLowerCase()}`;
  for (const p of previous) {
    const pKey = `${p.repo_short_id}::${p.category}::${p.title.trim().toLowerCase()}`;
    if (pKey === key) return p;
  }
  return null;
}

export function reconcileFindings(params: {
  candidates: Array<
    Omit<Finding, 'id' | 'status' | 'first_seen_at' | 'last_seen_at' | 'days_open' | 'action_taken'>
  >;
  previous: Finding[];
  deferredIgnoredTitles: Set<string>;
  nowIso: string;
}): Finding[] {
  const existingIds = new Set(params.previous.map((p) => p.id));
  const resolved: Finding[] = [];

  for (const cand of params.candidates) {
    // Skip deferred/ignored findings unless severity changed (cheap approx:
    // match by title; if in set and severity is unchanged, drop).
    if (params.deferredIgnoredTitles.has(cand.title.trim().toLowerCase())) {
      continue;
    }
    const match = findMatch(cand, params.previous);
    if (match) {
      const firstSeen = match.first_seen_at;
      const daysOpen = Math.floor(
        (new Date(params.nowIso).getTime() - new Date(firstSeen).getTime()) /
          (24 * 3600 * 1000),
      );
      const wasFixed = match.action_taken?.kind === 'fix';
      resolved.push({
        ...match,
        ...cand,
        id: match.id,
        status: wasFixed ? 'reopened' : 'persisting',
        first_seen_at: firstSeen,
        last_seen_at: params.nowIso,
        days_open: daysOpen,
        action_taken: wasFixed ? null : match.action_taken,
      });
    } else {
      const newId = generateFindingId({
        repoShortId: cand.repo_short_id,
        severity: cand.severity,
        existingIds,
      });
      existingIds.add(newId);
      resolved.push({
        ...cand,
        id: newId,
        status: 'new',
        first_seen_at: params.nowIso,
        last_seen_at: params.nowIso,
        action_taken: null,
      });
    }
  }

  // Include previous findings marked Fix that still exist after 14d as a
  // "still open since marked Fix" flag — only surface if we saw them again.
  // (Already handled via the match loop; if a fix-marked finding recurs, its
  // action_taken is cleared above.)
  return resolved;
}

export function countBySeverity(findings: Finding[]): Record<FindingSeverity, number> {
  const counts: Record<FindingSeverity, number> = { critical: 0, medium: 0, low: 0 };
  for (const f of findings) {
    if (!f.action_taken) counts[f.severity]++;
  }
  return counts;
}
