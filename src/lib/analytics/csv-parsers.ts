// Pure CSV parsers for manual uploads (Spotify for Podcasters + Substack).
// No dependency — hand-rolled parser handles commas, quoted fields, escaped
// quotes, and BOM. Sufficient for the export formats from both platforms.

export interface SubstackSnapshot {
  total_subscribers: number;
  paid_subscribers: number | null;
  free_subscribers: number | null;
  // When the CSV is a post-stats export we can pull these:
  avg_open_rate: number | null;
  avg_click_rate: number | null;
  top_posts: Array<{
    title: string;
    sent_at: string | null;
    open_rate: number | null;
    click_rate: number | null;
  }>;
  // Schema hint so the monthly report knows what kind of CSV this is.
  csv_kind: 'subscriber-list' | 'post-stats' | 'unknown';
  period: { start: string; end: string };
}

export interface SpotifySnapshot {
  total_plays_in_period: number;
  total_listeners: number | null;
  avg_completion_rate: number | null;
  top_episodes: Array<{
    title: string;
    plays: number;
    listeners: number | null;
    completion_rate: number | null;
  }>;
  csv_kind: 'episode-performance' | 'audience' | 'unknown';
  period: { start: string; end: string };
}

// ============================================================================
// Parser core — robust to BOM, CRLF, quoted fields with commas, escaped quotes
// ============================================================================

export function parseCsv(raw: string): string[][] {
  // Strip BOM if present
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ',') {
      row.push(field);
      field = '';
      i++;
      continue;
    }
    if (c === '\r') {
      // Ignore lone CR; \r\n handled on next \n
      i++;
      continue;
    }
    if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i++;
      continue;
    }
    field += c;
    i++;
  }
  // Trailing field / row
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim().length > 0));
}

// Case-insensitive header finder — returns the column index or -1.
function headerIndex(header: string[], ...aliases: string[]): number {
  const h = header.map((x) => x.trim().toLowerCase());
  for (const alias of aliases) {
    const i = h.indexOf(alias.toLowerCase());
    if (i !== -1) return i;
  }
  return -1;
}

function toNum(v: string | undefined): number | null {
  if (v == null) return null;
  const cleaned = v.replace(/[,%$\s]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function toRate(v: string | undefined): number | null {
  if (v == null) return null;
  const raw = v.trim();
  if (!raw) return null;
  const hasPercent = raw.endsWith('%');
  const n = toNum(raw);
  if (n == null) return null;
  return hasPercent ? n / 100 : n > 1 ? n / 100 : n;
}

// ============================================================================
// Substack parser — detects subscriber-list vs post-stats by header row
// ============================================================================

export function parseSubstackCsv(
  raw: string,
  period: { start: string; end: string },
): SubstackSnapshot {
  const rows = parseCsv(raw);
  if (rows.length === 0) {
    return {
      total_subscribers: 0,
      paid_subscribers: null,
      free_subscribers: null,
      avg_open_rate: null,
      avg_click_rate: null,
      top_posts: [],
      csv_kind: 'unknown',
      period,
    };
  }

  const header = rows[0];
  const body = rows.slice(1);

  // Subscriber-list shape: email, name, plan, status, created_at
  // Substack uses slightly different column names per export version; match on
  // any email-ish column OR explicit "subscriber type".
  const hasEmail = headerIndex(header, 'email', 'email address') !== -1;
  const typeIdx = headerIndex(header, 'type', 'subscriber type', 'plan');
  const titleIdx = headerIndex(header, 'title', 'post title', 'subject');

  if (hasEmail && typeIdx !== -1) {
    // Subscriber list
    let paid = 0;
    let free = 0;
    for (const r of body) {
      const t = (r[typeIdx] ?? '').trim().toLowerCase();
      if (t.includes('paid') || t.includes('founding')) paid++;
      else free++;
    }
    const total = paid + free;
    return {
      total_subscribers: total,
      paid_subscribers: paid,
      free_subscribers: free,
      avg_open_rate: null,
      avg_click_rate: null,
      top_posts: [],
      csv_kind: 'subscriber-list',
      period,
    };
  }

  if (titleIdx !== -1) {
    // Post-stats export
    const sentIdx = headerIndex(header, 'sent at', 'sent_at', 'date', 'published at');
    const openIdx = headerIndex(header, 'open rate', 'opens %', 'open_rate');
    const clickIdx = headerIndex(header, 'click rate', 'clicks %', 'click_rate');
    const posts: SubstackSnapshot['top_posts'] = body.map((r) => ({
      title: (r[titleIdx] ?? '').trim(),
      sent_at: sentIdx !== -1 ? ((r[sentIdx] ?? '').trim() || null) : null,
      open_rate: openIdx !== -1 ? toRate(r[openIdx]) : null,
      click_rate: clickIdx !== -1 ? toRate(r[clickIdx]) : null,
    }));
    const openRates = posts.map((p) => p.open_rate).filter((n): n is number => n != null);
    const clickRates = posts.map((p) => p.click_rate).filter((n): n is number => n != null);
    const avgOpen = openRates.length
      ? openRates.reduce((a, b) => a + b, 0) / openRates.length
      : null;
    const avgClick = clickRates.length
      ? clickRates.reduce((a, b) => a + b, 0) / clickRates.length
      : null;
    // Sort top 10 by open rate
    const topSorted = [...posts]
      .sort((a, b) => (b.open_rate ?? 0) - (a.open_rate ?? 0))
      .slice(0, 10);
    return {
      total_subscribers: 0,
      paid_subscribers: null,
      free_subscribers: null,
      avg_open_rate: avgOpen,
      avg_click_rate: avgClick,
      top_posts: topSorted,
      csv_kind: 'post-stats',
      period,
    };
  }

  return {
    total_subscribers: 0,
    paid_subscribers: null,
    free_subscribers: null,
    avg_open_rate: null,
    avg_click_rate: null,
    top_posts: [],
    csv_kind: 'unknown',
    period,
  };
}

// ============================================================================
// Spotify for Podcasters parser — episode-performance export format
// ============================================================================

export function parseSpotifyCsv(
  raw: string,
  period: { start: string; end: string },
): SpotifySnapshot {
  const rows = parseCsv(raw);
  if (rows.length === 0) {
    return {
      total_plays_in_period: 0,
      total_listeners: null,
      avg_completion_rate: null,
      top_episodes: [],
      csv_kind: 'unknown',
      period,
    };
  }

  const header = rows[0];
  const body = rows.slice(1);

  const titleIdx = headerIndex(header, 'episode', 'episode title', 'title', 'name');
  const playsIdx = headerIndex(header, 'plays', 'starts', 'streams');
  const listenersIdx = headerIndex(header, 'listeners', 'unique listeners');
  const completionIdx = headerIndex(header, 'completion rate', 'completion %', 'avg completion');

  if (titleIdx === -1 || playsIdx === -1) {
    return {
      total_plays_in_period: 0,
      total_listeners: null,
      avg_completion_rate: null,
      top_episodes: [],
      csv_kind: 'unknown',
      period,
    };
  }

  const episodes: SpotifySnapshot['top_episodes'] = body.map((r) => ({
    title: (r[titleIdx] ?? '').trim(),
    plays: toNum(r[playsIdx]) ?? 0,
    listeners: listenersIdx !== -1 ? toNum(r[listenersIdx]) : null,
    completion_rate: completionIdx !== -1 ? toRate(r[completionIdx]) : null,
  }));

  const total_plays = episodes.reduce((a, e) => a + (e.plays ?? 0), 0);
  const listeners = episodes
    .map((e) => e.listeners)
    .filter((n): n is number => n != null);
  const total_listeners = listeners.length ? listeners.reduce((a, b) => a + b, 0) : null;
  const completions = episodes
    .map((e) => e.completion_rate)
    .filter((n): n is number => n != null);
  const avg_completion_rate = completions.length
    ? completions.reduce((a, b) => a + b, 0) / completions.length
    : null;

  const top_episodes = [...episodes].sort((a, b) => b.plays - a.plays).slice(0, 10);

  return {
    total_plays_in_period: total_plays,
    total_listeners,
    avg_completion_rate,
    top_episodes,
    csv_kind: 'episode-performance',
    period,
  };
}
