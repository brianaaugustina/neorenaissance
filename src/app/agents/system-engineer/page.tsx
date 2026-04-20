import Link from 'next/link';
import { RunSystemEngineerButton } from '@/components/RunSystemEngineerButton';
import { getTrackedRepos, isGithubConfigured } from '@/lib/system-engineer/github';
import { isVercelConfigured } from '@/lib/system-engineer/vercel';
import { supabaseAdmin } from '@/lib/supabase/client';
import { formatPtTime } from '@/lib/time';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface RecentReportRow {
  id: string;
  created_at: string;
  output_type: string;
  draft_content: {
    period?: { start: string; end: string };
    severity_counts?: { critical: number; medium: number; low: number };
    findings?: Array<{ action_taken: unknown }>;
  } | null;
}

export default async function SystemEngineerPage() {
  const [reports, learnings] = await Promise.all([
    supabaseAdmin()
      .from('agent_outputs')
      .select('id, created_at, output_type, draft_content')
      .eq('agent_id', 'system-engineer')
      .eq('output_type', 'weekly_codebase_health_report')
      .order('created_at', { ascending: false })
      .limit(10),
    supabaseAdmin()
      .from('agent_learnings')
      .select('id, title, content, created_at')
      .eq('agent_id', 'system-engineer')
      .order('created_at', { ascending: false })
      .limit(10),
  ]);
  const rows: RecentReportRow[] = (reports.data as RecentReportRow[]) ?? [];
  const learningRows =
    (learnings.data as Array<{
      id: string;
      title: string;
      content: string;
      created_at: string;
    }>) ?? [];
  const tracked = getTrackedRepos();
  const ghConfigured = isGithubConfigured();
  const vcConfigured = isVercelConfigured();

  return (
    <main className="min-h-screen px-4 py-6 md:px-10 md:py-10 max-w-[960px] mx-auto">
      <header className="mb-6 md:mb-8">
        <Link href="/agents" className="text-xs gold hover:underline">
          ← Back to agents
        </Link>
        <h1 className="serif text-3xl md:text-4xl gold mt-3">System Engineer</h1>
        <p className="muted text-sm mt-1 max-w-[720px]">
          Read-only weekly code review across your tracked repos. Dry,
          specific, ranked. Runs Saturday 8pm PT; triage in 5 minutes Sunday.
          Per-finding Fix / Defer / Ignore actions. Delegate-to-agent routing
          lands in Phase 5 once Detto PM / Corral Engineer agents exist.
        </p>
      </header>

      <section className="card p-5 md:p-6 mb-6">
        <div className="flex items-baseline justify-between gap-4 mb-3">
          <h2 className="serif text-xl">Run a scan</h2>
          <span className="muted text-xs uppercase tracking-widest">
            Weekly cron · Sat 8pm PT
          </span>
        </div>
        <p className="muted text-sm mb-4">
          Leave &ldquo;All tracked repos&rdquo; for the normal weekly pass. Pick a
          single repo to do a focused scan (same scan engine, scoped).
        </p>
        <RunSystemEngineerButton />
      </section>

      <section className="card p-5 md:p-6 mb-6">
        <div className="flex items-baseline justify-between gap-4 mb-3">
          <h2 className="serif text-xl">Data sources</h2>
          <span className="muted text-xs uppercase tracking-widest">Read-only</span>
        </div>
        <ul className="space-y-2 text-sm">
          <li>
            <span className="serif">GitHub </span>
            <span className="text-xs muted">
              ·{' '}
              {ghConfigured ? (
                <span style={{ color: 'var(--ok)' }}>✓ PAT configured</span>
              ) : (
                <span style={{ color: 'var(--danger)' }}>GITHUB_PAT missing</span>
              )}
            </span>
            <ul className="mt-1.5 space-y-0.5 text-xs">
              {tracked.map((r) => (
                <li key={r.shortId} className="muted">
                  <span className="serif">{r.label}</span> ·{' '}
                  {r.slug ? (
                    <span>{r.slug}</span>
                  ) : (
                    <span style={{ color: 'var(--danger)' }}>env var missing</span>
                  )}{' '}
                  · priority {r.priority}
                </li>
              ))}
            </ul>
          </li>
          <li className="mt-3">
            <span className="serif">Vercel </span>
            <span className="text-xs muted">
              ·{' '}
              {vcConfigured ? (
                <span style={{ color: 'var(--ok)' }}>✓ token configured</span>
              ) : (
                <span style={{ color: 'var(--danger)' }}>VERCEL_TOKEN missing</span>
              )}
            </span>
          </li>
          <li className="mt-1">
            <span className="serif muted">Supabase logs </span>
            <span className="text-xs muted">· deferred to later pass</span>
          </li>
        </ul>
      </section>

      <section className="card p-5 md:p-6 mb-6">
        <div className="flex items-baseline justify-between gap-4 mb-3">
          <h2 className="serif text-xl">Recent reports</h2>
          <span className="muted text-xs uppercase tracking-widest">Last 10</span>
        </div>
        {rows.length === 0 ? (
          <p className="muted text-sm">
            No reports yet. Run one above. First run will seed the finding IDs;
            subsequent scans reconcile and reuse them.
          </p>
        ) : (
          <ul className="space-y-3 text-sm">
            {rows.map((r) => {
              const counts = r.draft_content?.severity_counts;
              const findings = r.draft_content?.findings ?? [];
              const actedCount = findings.filter((f) => f.action_taken).length;
              const period = r.draft_content?.period;
              return (
                <li
                  key={r.id}
                  className="border rounded-md p-3"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <div className="flex items-baseline justify-between gap-4 flex-wrap">
                    <div className="min-w-0">
                      <div className="serif">Weekly codebase health report</div>
                      <div className="text-xs muted">
                        {formatPtTime(r.created_at)} PT
                        {period ? ` · ${period.start} → ${period.end}` : ''}
                        {counts
                          ? ` · ${counts.critical}C / ${counts.medium}M / ${counts.low}L`
                          : ''}
                        {findings.length > 0
                          ? ` · ${findings.length} findings${actedCount > 0 ? ` (${actedCount} acted)` : ''}`
                          : ''}
                      </div>
                    </div>
                    <Link
                      href={`/outputs/system-engineer/${r.id}`}
                      className="text-xs gold hover:underline"
                    >
                      Open ↗
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="card p-5 md:p-6">
        <div className="flex items-baseline justify-between gap-4 mb-3">
          <h2 className="serif text-xl">Deferred + ignored findings</h2>
          <span className="muted text-xs uppercase tracking-widest">
            Won&apos;t re-surface
          </span>
        </div>
        {learningRows.length === 0 ? (
          <p className="muted text-sm">No deferred or ignored findings yet.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {learningRows.map((l) => (
              <li key={l.id} className="flex items-baseline justify-between gap-2">
                <span className="serif truncate">{l.title}</span>
                <span className="text-xs muted">{formatPtTime(l.created_at)} PT</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
