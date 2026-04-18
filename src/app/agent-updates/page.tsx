import Link from 'next/link';
import { AgentUpdates } from '@/components/AgentUpdates';
import { getRecentAgentRuns } from '@/lib/supabase/client';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Group a flat list of runs by calendar day (PT). Returns ordered entries so
// we render newest day first, and within each day the newest run first (the
// data arrives already sorted by started_at desc).
function groupByDay(runs: Awaited<ReturnType<typeof getRecentAgentRuns>>) {
  const groups = new Map<string, typeof runs>();
  for (const run of runs) {
    const day = new Date(run.started_at).toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
    const bucket = groups.get(day) ?? [];
    bucket.push(run);
    groups.set(day, bucket);
  }
  return Array.from(groups.entries());
}

export default async function AgentUpdatesPage() {
  const runs = await getRecentAgentRuns(200);
  const grouped = groupByDay(runs);

  return (
    <main className="min-h-screen px-4 py-6 md:px-10 md:py-10 max-w-[960px] mx-auto">
      <header className="mb-6 md:mb-8">
        <Link href="/" className="text-xs gold hover:underline">
          ← Back to dashboard
        </Link>
        <h1 className="serif text-3xl md:text-4xl gold mt-3">Agent Updates</h1>
        <p className="muted text-sm mt-1">
          Full history of scheduled and manual agent runs. Ops Chief chat
          turns are excluded.
        </p>
      </header>

      {grouped.length === 0 ? (
        <p className="muted text-sm">No agent runs on record yet.</p>
      ) : (
        <div className="space-y-8">
          {grouped.map(([day, dayRuns]) => (
            <section key={day} className="card p-5 md:p-6">
              <h2 className="serif text-sm uppercase tracking-widest muted mb-4">
                {day}
                <span className="muted ml-3" style={{ opacity: 0.6 }}>
                  · {dayRuns.length} run{dayRuns.length === 1 ? '' : 's'}
                </span>
              </h2>
              <AgentUpdates runs={dayRuns} />
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
