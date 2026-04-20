import fs from 'node:fs';
import path from 'node:path';
import { AGENT_REGISTRY } from '../agents/registry';
import { APP_TIMEZONE } from '../time';

export interface CronDef {
  path: string;
  schedule: string;
}

export interface CronOccurrence {
  path: string;
  schedule: string;
  /** UTC instant for this firing. */
  fireAt: Date;
  /** YYYY-MM-DD in PT — the calendar day the fire lands on in Pacific Time. */
  ptDateIso: string;
  /** Agent id inferred from the path (or the raw first path segment). */
  agentId: string;
  /** Human-readable agent name from the registry, or the agent id as fallback. */
  agentName: string;
  /** Short humanised label for the specific endpoint, e.g. "daily", "weekly". */
  endpointLabel: string;
}

// ---------------------------------------------------------------------------
// Read vercel.json. Module-level cache — the file is bundled with the app and
// doesn't change at runtime.
// ---------------------------------------------------------------------------
let cachedCrons: CronDef[] | null = null;
function loadCrons(): CronDef[] {
  if (cachedCrons) return cachedCrons;
  const jsonPath = path.resolve(process.cwd(), 'vercel.json');
  if (!fs.existsSync(jsonPath)) {
    cachedCrons = [];
    return cachedCrons;
  }
  const raw = fs.readFileSync(jsonPath, 'utf8');
  const parsed = JSON.parse(raw) as { crons?: CronDef[] };
  cachedCrons = parsed.crons ?? [];
  return cachedCrons;
}

// ---------------------------------------------------------------------------
// Cron field parsing. Supports the subset vercel.json uses:
//   - literal numbers: `5`
//   - wildcards: `*`
//   - comma lists: `1,4,7,10`
//   - ranges: `1-5`
// Reject anything fancier — step values like `*/5` aren't in use.
// ---------------------------------------------------------------------------
function parseField(expr: string, min: number, max: number): Set<number> | 'any' {
  if (expr === '*') return 'any';
  const set = new Set<number>();
  for (const part of expr.split(',')) {
    const trimmed = part.trim();
    if (trimmed.includes('-')) {
      const [lo, hi] = trimmed.split('-').map((s) => Number(s.trim()));
      if (!Number.isFinite(lo) || !Number.isFinite(hi)) continue;
      for (let n = lo; n <= hi; n++) {
        if (n >= min && n <= max) set.add(n);
      }
    } else {
      const n = Number(trimmed);
      if (Number.isFinite(n) && n >= min && n <= max) set.add(n);
    }
  }
  return set;
}

interface ParsedSchedule {
  minute: Set<number> | 'any';
  hour: Set<number> | 'any';
  dayOfMonth: Set<number> | 'any';
  month: Set<number> | 'any';
  dayOfWeek: Set<number> | 'any';
}

function parseSchedule(schedule: string): ParsedSchedule | null {
  const parts = schedule.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  return {
    minute: parseField(parts[0], 0, 59),
    hour: parseField(parts[1], 0, 23),
    dayOfMonth: parseField(parts[2], 1, 31),
    month: parseField(parts[3], 1, 12),
    dayOfWeek: parseField(parts[4], 0, 6),
  };
}

function matches(set: Set<number> | 'any', n: number): boolean {
  return set === 'any' || set.has(n);
}

// ---------------------------------------------------------------------------
// Expand a cron schedule to concrete UTC instants within a window.
// Vercel cron times are UTC; we also compute the PT calendar date for each
// firing so the UI can bucket them into PT days.
// ---------------------------------------------------------------------------
function minuteIterator(startUtc: Date, endUtc: Date): Generator<Date> {
  // Yield every minute from startUtc up to (but not including) endUtc.
  function* gen() {
    const cur = new Date(startUtc);
    cur.setUTCSeconds(0, 0);
    while (cur < endUtc) {
      yield new Date(cur);
      cur.setUTCMinutes(cur.getUTCMinutes() + 1);
    }
  }
  return gen();
}

function ptDateIso(utc: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(utc);
}

function expandCron(def: CronDef, startUtc: Date, endUtc: Date): CronOccurrence[] {
  const parsed = parseSchedule(def.schedule);
  if (!parsed) return [];
  const out: CronOccurrence[] = [];
  // POSIX cron: if BOTH dayOfMonth and dayOfWeek are restricted, either match
  // fires. If one is '*', the other governs alone. Our vercel.json never sets
  // both at once, but implement the rule properly.
  const domAny = parsed.dayOfMonth === 'any';
  const dowAny = parsed.dayOfWeek === 'any';
  const { agentId, agentName, endpointLabel } = inferAgentFromPath(def.path);
  for (const t of minuteIterator(startUtc, endUtc)) {
    if (!matches(parsed.minute, t.getUTCMinutes())) continue;
    if (!matches(parsed.hour, t.getUTCHours())) continue;
    if (!matches(parsed.month, t.getUTCMonth() + 1)) continue;
    const domMatch = matches(parsed.dayOfMonth, t.getUTCDate());
    const dowMatch = matches(parsed.dayOfWeek, t.getUTCDay());
    const dayOk =
      domAny && dowAny
        ? true
        : domAny
          ? dowMatch
          : dowAny
            ? domMatch
            : domMatch || dowMatch;
    if (!dayOk) continue;
    out.push({
      path: def.path,
      schedule: def.schedule,
      fireAt: new Date(t),
      ptDateIso: ptDateIso(t),
      agentId,
      agentName,
      endpointLabel,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Agent inference from /api/agents/{slug}/{endpoint}
// ---------------------------------------------------------------------------
const ENDPOINT_LABELS: Record<string, string> = {
  daily: 'Daily run',
  weekly: 'Weekly run',
  monthly: 'Monthly run',
  quarterly: 'Quarterly run',
  run: 'Scheduled run',
  research: 'Research scan',
  landscape: 'Landscape scan',
};

function humaniseEndpoint(endpoint: string): string {
  return (
    ENDPOINT_LABELS[endpoint] ??
    endpoint.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

function inferAgentFromPath(pathStr: string): {
  agentId: string;
  agentName: string;
  endpointLabel: string;
} {
  // Expected shape: /api/agents/{slug}/{endpoint}
  const parts = pathStr.split('/').filter(Boolean);
  const idx = parts.indexOf('agents');
  const slug = idx >= 0 && parts[idx + 1] ? parts[idx + 1] : parts[0] ?? 'unknown';
  const endpoint =
    idx >= 0 && parts[idx + 2] ? parts[idx + 2] : parts[parts.length - 1] ?? '';
  const agent = AGENT_REGISTRY.find((a) => {
    const ids = [a.id, ...(a.aliases ?? [])].map((v) => v.replace(/_/g, '-'));
    return ids.includes(slug.replace(/_/g, '-'));
  });
  return {
    agentId: agent?.id ?? slug,
    agentName: agent?.name ?? slug,
    endpointLabel: humaniseEndpoint(endpoint),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export function getCronOccurrencesInWindow(
  startUtc: Date,
  endUtc: Date,
): CronOccurrence[] {
  const defs = loadCrons();
  const all: CronOccurrence[] = [];
  for (const def of defs) {
    all.push(...expandCron(def, startUtc, endUtc));
  }
  all.sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime());
  return all;
}

// Simple humaniser for cron expressions — used on the registry cadence line
// or a tooltip. Handles the schedules actually in vercel.json; unknown shapes
// fall back to the raw expression.
const DOW_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function humaniseSchedule(schedule: string): string {
  const parsed = parseSchedule(schedule);
  if (!parsed) return schedule;
  const hr =
    parsed.hour === 'any' ? '*' : [...parsed.hour].sort((a, b) => a - b).join(',');
  const minute =
    parsed.minute === 'any'
      ? '00'
      : [...parsed.minute]
          .sort((a, b) => a - b)
          .map((n) => String(n).padStart(2, '0'))
          .join(',');

  const timeUtc =
    parsed.hour === 'any'
      ? 'every hour'
      : `${hr.padStart(2, '0')}:${minute} UTC`;

  if (parsed.dayOfWeek !== 'any') {
    const days = [...parsed.dayOfWeek]
      .sort((a, b) => a - b)
      .map((d) => DOW_NAMES[d])
      .join(', ');
    return `${days} at ${timeUtc}`;
  }
  if (parsed.dayOfMonth !== 'any') {
    const days = [...parsed.dayOfMonth].sort((a, b) => a - b).join(', ');
    if (parsed.month !== 'any') {
      return `Day ${days} of months ${[...parsed.month].sort((a, b) => a - b).join(', ')} at ${timeUtc}`;
    }
    return `Day ${days} monthly at ${timeUtc}`;
  }
  return `Daily at ${timeUtc}`;
}
