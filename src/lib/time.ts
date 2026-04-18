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
