import Link from 'next/link';
import { Suspense } from 'react';
import { AgentDashNav } from '@/components/AgentDashNav';
import { AnalyticsCsvUpload } from '@/components/AnalyticsCsvUpload';
import { GoogleConnectPanel } from '@/components/GoogleConnectPanel';
import { RunAnalyticsReportButton } from '@/components/RunAnalyticsReportButton';
import {
  isGoogleConnected,
  isGoogleOAuthConfigured,
} from '@/lib/analytics/google-oauth';
import { getOAuthToken } from '@/lib/analytics/oauth-tokens';
import {
  listRecentCsvUploads,
  listRecentSnapshots,
} from '@/lib/analytics/snapshots';
import { formatPtTime } from '@/lib/time';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function AnalyticsReportingPage() {
  const [snapshots, uploads, googleConnected, googleToken] = await Promise.all([
    listRecentSnapshots(30).catch(() => []),
    listRecentCsvUploads(10).catch(() => []),
    isGoogleOAuthConfigured() ? isGoogleConnected().catch(() => false) : Promise.resolve(false),
    isGoogleOAuthConfigured() ? getOAuthToken('google').catch(() => null) : Promise.resolve(null),
  ]);
  const channelTitle =
    (googleToken?.raw as { channel_title?: string } | null)?.channel_title ?? null;

  const byPlatform = new Map<string, typeof snapshots>();
  for (const s of snapshots) {
    const list = byPlatform.get(s.platform) ?? [];
    list.push(s);
    byPlatform.set(s.platform, list);
  }

  return (
    <>
    <AgentDashNav />
    <main className="min-h-screen px-4 py-6 md:px-10 md:py-10 max-w-[1100px] mx-auto">
      <header className="mb-6 md:mb-8">
        <Link href="/agents" className="text-xs gold hover:underline">
          ← Back to agents
        </Link>
        <h1 className="serif text-3xl md:text-4xl gold mt-3">Analytics & Reporting</h1>
        <p className="muted text-sm mt-1 max-w-[720px]">
          Pulls data from each connected platform and publishes a monthly
          cross-platform report that Growth Strategist reads at 10am PT on the
          1st. Runs automatically on the 1st of the month at 9am PT — trigger
          off-cycle below when you need a fresh pull.
        </p>
      </header>

      <section className="card p-5 md:p-6 mb-6">
        <div className="flex items-baseline justify-between gap-4 mb-3">
          <h2 className="serif text-xl">Run a report</h2>
          <span className="muted text-xs uppercase tracking-widest">
            Monthly cron · 1st at 9am PT
          </span>
        </div>
        <p className="muted text-sm mb-4">
          Leave &ldquo;period end&rdquo; blank to run the previous calendar month
          (what the cron does). Set it to re-run a specific past month, e.g.
          2026-03-31 for March.
        </p>
        <RunAnalyticsReportButton />
      </section>

      <section className="card p-5 md:p-6 mb-6">
        <div className="flex items-baseline justify-between gap-4 mb-3">
          <h2 className="serif text-xl">Platform connections</h2>
          <span className="muted text-xs uppercase tracking-widest">
            OAuth platforms
          </span>
        </div>
        <p className="muted text-sm mb-4">
          Connect YouTube once — the refresh token stays in Supabase and every
          monthly run mints a fresh access token automatically. Meta/Instagram
          and TikTok come in the next OAuth passes.
        </p>
        <div className="text-xs muted uppercase tracking-wider mb-1.5">YouTube</div>
        {isGoogleOAuthConfigured() ? (
          <Suspense fallback={<div className="text-xs muted">Loading…</div>}>
            <GoogleConnectPanel
              connected={googleConnected}
              channelTitle={channelTitle}
            />
          </Suspense>
        ) : (
          <p className="text-xs" style={{ color: 'var(--danger)' }}>
            GOOGLE_OAUTH_CLIENT_ID / CLIENT_SECRET / REDIRECT_URI not set in
            .env.local.
          </p>
        )}
      </section>

      <section className="card p-5 md:p-6 mb-6">
        <div className="flex items-baseline justify-between gap-4 mb-3">
          <h2 className="serif text-xl">Upload CSV</h2>
          <span className="muted text-xs uppercase tracking-widest">
            Substack · Spotify for Podcasters
          </span>
        </div>
        <p className="muted text-sm mb-4">
          Neither platform has a usable analytics API. Export a CSV from the
          platform dashboard for the period, upload it here, and the parser
          writes a snapshot the monthly report will pick up automatically.
        </p>
        <AnalyticsCsvUpload />
        {uploads.length > 0 && (
          <div className="mt-5 text-xs">
            <div className="muted uppercase tracking-wider mb-2">Recent uploads</div>
            <ul className="space-y-1">
              {uploads.map((u) => (
                <li key={u.id} className="flex items-baseline gap-2 flex-wrap">
                  <span className="serif">{u.platform}</span>
                  <span className="muted">
                    {u.period_start_date} → {u.period_end_date}
                  </span>
                  <span className="muted">· {u.filename}</span>
                  <span className="muted">· {formatPtTime(u.uploaded_at)} PT</span>
                  {u.parse_error ? (
                    <span style={{ color: 'var(--danger)' }}>
                      · parse error: {u.parse_error}
                    </span>
                  ) : u.parsed_into_snapshot_id ? (
                    <span style={{ color: 'var(--ok)' }}>· parsed ✓</span>
                  ) : (
                    <span className="muted">· pending</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="card p-5 md:p-6">
        <div className="flex items-baseline justify-between gap-4 mb-3">
          <h2 className="serif text-xl">Platform snapshots</h2>
          <span className="muted text-xs uppercase tracking-widest">
            Latest per platform
          </span>
        </div>
        {byPlatform.size === 0 ? (
          <p className="muted text-sm">
            No snapshots yet. Run the monthly report or upload a CSV above to
            seed data.
          </p>
        ) : (
          <div className="space-y-4">
            {Array.from(byPlatform.entries()).map(([platform, rows]) => (
              <div key={platform}>
                <div className="text-xs muted uppercase tracking-wider mb-1.5">
                  {platform}
                </div>
                <ul className="text-sm space-y-1">
                  {rows.slice(0, 3).map((r) => (
                    <li key={r.id} className="flex items-baseline gap-2">
                      <span className="serif">{r.period_end_date}</span>
                      <span className="muted">· {r.period_type}</span>
                      <span className="muted truncate">
                        · {summarizeMetrics(r.metrics as Record<string, unknown>)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
    </>
  );
}

function summarizeMetrics(m: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof m.total_views === 'number') parts.push(`${m.total_views} views`);
  if (typeof m.unique_visitors === 'number') parts.push(`${m.unique_visitors} visitors`);
  if (typeof m.subscribers === 'number') parts.push(`${m.subscribers} subs`);
  if (typeof m.new_subscribers === 'number') parts.push(`+${m.new_subscribers} new`);
  if (typeof m.total_plays === 'number') parts.push(`${m.total_plays} plays`);
  if (typeof m.avg_open_rate === 'number')
    parts.push(`${(m.avg_open_rate * 100).toFixed(1)}% opens`);
  if (parts.length === 0) return '(no normalized metrics — see raw)';
  return parts.join(' · ');
}
