import Link from 'next/link';
import { RunGrowthBriefingButton } from '@/components/RunGrowthBriefingButton';
import { supabaseAdmin } from '@/lib/supabase/client';
import { formatPtTime } from '@/lib/time';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface RecentBriefingRow {
  id: string;
  created_at: string;
  output_type: string;
  draft_content: {
    overall_assessment?: string;
    recommendations?: Array<{ id: string; action_taken: unknown }>;
    period?: { start: string; end: string };
  } | null;
}

export default async function GrowthStrategistPage() {
  const { data, error } = await supabaseAdmin()
    .from('agent_outputs')
    .select('id, created_at, output_type, draft_content')
    .eq('agent_id', 'growth-strategist')
    .order('created_at', { ascending: false })
    .limit(10);
  const rows: RecentBriefingRow[] = error ? [] : ((data as RecentBriefingRow[]) ?? []);

  return (
    <main className="min-h-screen px-4 py-6 md:px-10 md:py-10 max-w-[960px] mx-auto">
      <header className="mb-6 md:mb-8">
        <Link href="/agents" className="text-xs gold hover:underline">
          ← Back to agents
        </Link>
        <h1 className="serif text-3xl md:text-4xl gold mt-3">Growth Strategist</h1>
        <p className="muted text-sm mt-1 max-w-[720px]">
          Reads the latest Analytics & Reporting snapshot, your active Notion
          KRs, and past experiments; produces strategic recommendations with
          per-recommendation action buttons. Runs automatically on the 1st of
          each month at 10am PT (after the Analytics report lands at 9am),
          with a quarterly deeper review on Jan/Apr/Jul/Oct 1st at 8am PT.
        </p>
      </header>

      <section className="card p-5 md:p-6 mb-6">
        <div className="flex items-baseline justify-between gap-4 mb-3">
          <h2 className="serif text-xl">Run a briefing</h2>
          <span className="muted text-xs uppercase tracking-widest">
            Monthly cron · 1st at 10am PT
          </span>
        </div>
        <p className="muted text-sm mb-4">
          Pick an output type. Monthly &amp; quarterly run automatically; the
          three on-demand types (channel / audience / cross-venture synergy)
          let you drill in when you want a specific angle.
        </p>
        <RunGrowthBriefingButton />
      </section>

      <section className="card p-5 md:p-6">
        <div className="flex items-baseline justify-between gap-4 mb-3">
          <h2 className="serif text-xl">Recent briefings</h2>
          <span className="muted text-xs uppercase tracking-widest">
            Last 10
          </span>
        </div>
        {rows.length === 0 ? (
          <p className="muted text-sm">
            No briefings yet. Run one above to seed.
          </p>
        ) : (
          <ul className="space-y-3 text-sm">
            {rows.map((r) => {
              const recs = r.draft_content?.recommendations ?? [];
              const actedCount = recs.filter((x) => x.action_taken).length;
              const period = r.draft_content?.period
                ? `${r.draft_content.period.start} → ${r.draft_content.period.end}`
                : null;
              return (
                <li key={r.id} className="border rounded-md p-3" style={{ borderColor: 'var(--border)' }}>
                  <div className="flex items-baseline justify-between gap-4 flex-wrap">
                    <div className="min-w-0">
                      <div className="serif">{humanizeOutputType(r.output_type)}</div>
                      <div className="text-xs muted">
                        {formatPtTime(r.created_at)} PT{period ? ` · ${period}` : ''} ·{' '}
                        {recs.length} recommendation{recs.length === 1 ? '' : 's'}
                        {actedCount > 0 ? ` · ${actedCount} acted` : ''}
                      </div>
                    </div>
                    <Link
                      href={`/outputs/growth-strategist/${r.id}`}
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
    </main>
  );
}

function humanizeOutputType(t: string): string {
  const map: Record<string, string> = {
    monthly_pulse_check: 'Monthly pulse check',
    quarterly_growth_review: 'Quarterly growth review',
    channel_recommendation: 'Channel recommendation',
    audience_analysis: 'Audience analysis',
    cross_venture_synergy: 'Cross-venture synergy',
    experiment_proposal: 'Experiment proposal',
    experiment_results: 'Experiment results',
  };
  return map[t] ?? t;
}
