import Link from 'next/link';
import { RunSupervisorButton } from '@/components/RunSupervisorButton';
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
    diff_proposals?: Array<{ id: string; action_taken: unknown }>;
    preference_promotions?: Array<{ id: string; action_taken: unknown }>;
    per_agent_observations?: Array<{ agent: string }>;
  } | null;
}

export default async function AgentSupervisorPage() {
  const [reports, learnings] = await Promise.all([
    supabaseAdmin()
      .from('agent_outputs')
      .select('id, created_at, output_type, draft_content')
      .eq('agent_id', 'agent-supervisor')
      .order('created_at', { ascending: false })
      .limit(10),
    supabaseAdmin()
      .from('agent_learnings')
      .select('id, learning_type, title, applied, applied_at, created_at')
      .eq('agent_id', 'agent-supervisor')
      .order('created_at', { ascending: false })
      .limit(10),
  ]);

  const rows: RecentReportRow[] = (reports.data as RecentReportRow[]) ?? [];
  const learningRows =
    (learnings.data as Array<{
      id: string;
      learning_type: string;
      title: string;
      applied: boolean;
      applied_at: string | null;
      created_at: string;
    }>) ?? [];

  return (
    <main className="min-h-screen px-4 py-6 md:px-10 md:py-10 max-w-[960px] mx-auto">
      <header className="mb-6 md:mb-8">
        <Link href="/agents" className="text-xs gold hover:underline">
          ← Back to agents
        </Link>
        <h1 className="serif text-3xl md:text-4xl gold mt-3">Agent Supervisor</h1>
        <p className="muted text-sm mt-1 max-w-[720px]">
          The quiet observer. Reads every agent's outputs + approvals + feedback,
          spots patterns, and proposes specific context-file diffs for Briana
          to apply manually via Claude Code. Self-exclusion is enforced (never
          observes itself or System Engineer). Weekly Sunday 6am PT; no real
          signal until a few weeks of data accumulate.
        </p>
      </header>

      <section className="card p-5 md:p-6 mb-6">
        <div className="flex items-baseline justify-between gap-4 mb-3">
          <h2 className="serif text-xl">Run a report</h2>
          <span className="muted text-xs uppercase tracking-widest">
            Weekly cron · Sun 6am PT
          </span>
        </div>
        <p className="muted text-sm mb-4">
          Weekly = all agents, 7-day window, trailing 28-day comparison. Deep
          dive = one agent, longer window (default 30 days), more specific
          pattern analysis.
        </p>
        <RunSupervisorButton />
      </section>

      <section className="card p-5 md:p-6 mb-6">
        <div className="flex items-baseline justify-between gap-4 mb-3">
          <h2 className="serif text-xl">Recent reports</h2>
          <span className="muted text-xs uppercase tracking-widest">Last 10</span>
        </div>
        {rows.length === 0 ? (
          <p className="muted text-sm">
            No reports yet. Run one above. Expect the first few to be thin —
            the agent needs weeks of data to pattern-match meaningfully.
          </p>
        ) : (
          <ul className="space-y-3 text-sm">
            {rows.map((r) => {
              const diffs = r.draft_content?.diff_proposals ?? [];
              const promos = r.draft_content?.preference_promotions ?? [];
              const agents = r.draft_content?.per_agent_observations?.length ?? 0;
              const period = r.draft_content?.period;
              return (
                <li
                  key={r.id}
                  className="border rounded-md p-3"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <div className="flex items-baseline justify-between gap-4 flex-wrap">
                    <div className="min-w-0">
                      <div className="serif">
                        {humanizeOutputType(r.output_type)}
                      </div>
                      <div className="text-xs muted">
                        {formatPtTime(r.created_at)} PT
                        {period ? ` · ${period.start} → ${period.end}` : ''} ·{' '}
                        {agents} agent{agents === 1 ? '' : 's'} observed ·{' '}
                        {diffs.length} diff{diffs.length === 1 ? '' : 's'} ·{' '}
                        {promos.length} preference
                        {promos.length === 1 ? '' : 's'}
                      </div>
                    </div>
                    <Link
                      href={`/outputs/agent-supervisor/${r.id}`}
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
          <h2 className="serif text-xl">Learning log</h2>
          <span className="muted text-xs uppercase tracking-widest">
            Approved diffs + rejections
          </span>
        </div>
        {learningRows.length === 0 ? (
          <p className="muted text-sm">
            No approved diffs yet. When you approve a proposal from a weekly
            report, it logs here with status pending-apply. Fill in the git
            commit after you apply via Claude Code to start the 30-day
            retrospective clock.
          </p>
        ) : (
          <ul className="space-y-2 text-sm">
            {learningRows.map((l) => (
              <li key={l.id} className="flex items-baseline justify-between gap-2">
                <span className="serif truncate">{l.title}</span>
                <span className="text-xs muted">
                  {l.learning_type}
                  {l.applied
                    ? ` · applied ${l.applied_at?.slice(0, 10) ?? ''}`
                    : ' · pending apply'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function humanizeOutputType(t: string): string {
  const map: Record<string, string> = {
    weekly_supervisor_report: 'Weekly supervisor report',
    agent_deep_dive: 'Agent deep dive',
  };
  return map[t] ?? t;
}
