// All "today" computations in the Artisanship agents anchor to Pacific
// Time. Notion task dates are bare YYYY-MM-DD strings scheduled in PT, and
// Briana operates in PT — but Vercel's serverless runtime is UTC, so
// `new Date().toISOString()` and `Date#getDay()` silently roll the date
// forward after 4-5pm PT. These helpers fix that.

export const APP_TIMEZONE = 'America/Los_Angeles';

// YYYY-MM-DD in PT. Uses en-CA because that locale formats as ISO.
export function todayIsoPT(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

// Human-readable label in PT, e.g. "Friday, April 17, 2026".
export function dayLabelPT(now: Date = new Date()): string {
  return now.toLocaleDateString('en-US', {
    timeZone: APP_TIMEZONE,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

// Day of week in PT, 0=Sun..6=Sat.
export function weekdayPT(now: Date = new Date()): number {
  const short = new Intl.DateTimeFormat('en-US', {
    timeZone: APP_TIMEZONE,
    weekday: 'short',
  }).format(now);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(short);
}

// Offset an ISO date by N calendar days. Works on date-only strings so it
// doesn't drift across DST boundaries.
export function addDaysIso(iso: string, days: number): string {
  // Parse as UTC midnight, shift, then format back as YYYY-MM-DD.
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Single source of truth for rendering stored UTC timestamps in Pacific Time.
// Use these helpers everywhere. Never call `toLocaleTimeString` / `toLocaleDateString`
// / `toLocaleString` on a timestamp directly — without an explicit timeZone
// option, SSR falls back to the Vercel server's UTC and client hydration
// falls back to the user's local tz, so the same run renders differently on
// different surfaces. (Brought down a Showrunner run that read Sunday 12:04am
// in Agent Updates and Saturday 5:05pm PT in Queue — same UTC, different
// tz assumptions.)
// ---------------------------------------------------------------------------

type AcceptedDate = string | Date | null | undefined;

function toDate(input: AcceptedDate): Date | null {
  if (!input) return null;
  const d = input instanceof Date ? input : new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

// "3:05 PM" in PT
export function formatPtTime(input: AcceptedDate): string {
  const d = toDate(input);
  if (!d) return '';
  return d.toLocaleTimeString('en-US', {
    timeZone: APP_TIMEZONE,
    hour: 'numeric',
    minute: '2-digit',
  });
}

// "Apr 19" in PT
export function formatPtShortDate(input: AcceptedDate): string {
  const d = toDate(input);
  if (!d) return '';
  return d.toLocaleDateString('en-US', {
    timeZone: APP_TIMEZONE,
    month: 'short',
    day: 'numeric',
  });
}

// "Saturday, April 19, 2026" in PT
export function formatPtLongDate(input: AcceptedDate): string {
  const d = toDate(input);
  if (!d) return '';
  return d.toLocaleDateString('en-US', {
    timeZone: APP_TIMEZONE,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

// "Apr 19, 3:05 PM PT" in PT
export function formatPtDateTime(input: AcceptedDate): string {
  const d = toDate(input);
  if (!d) return '';
  return `${formatPtShortDate(d)}, ${formatPtTime(d)} PT`;
}

// Today / Yesterday / Apr 19 — all compared in PT so the rollover is correct.
export function formatPtRelative(input: AcceptedDate): string {
  const d = toDate(input);
  if (!d) return '';
  const time = formatPtTime(d);
  const nowIso = todayIsoPT();
  const dIso = todayIsoPT(d);
  if (dIso === nowIso) return time;
  if (dIso === addDaysIso(nowIso, -1)) return `Yesterday, ${time}`;
  return `${formatPtShortDate(d)}, ${time}`;
}
