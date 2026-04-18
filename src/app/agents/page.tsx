import Link from 'next/link';
import { RunOpsChiefButton } from '@/components/RunOpsChiefButton';
import { ShowrunnerInput } from '@/components/ShowrunnerInput';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default function AgentsPage() {
  return (
    <main className="min-h-screen px-4 py-6 md:px-10 md:py-10 max-w-[960px] mx-auto">
      <header className="mb-6 md:mb-8">
        <Link href="/" className="text-xs gold hover:underline">
          ← Back to dashboard
        </Link>
        <h1 className="serif text-3xl md:text-4xl gold mt-3">Agents</h1>
        <p className="muted text-sm mt-1">
          Manual triggers for your agents. Outputs land in the dashboard queue
          for review.
        </p>
      </header>

      <div className="space-y-6">
        {/* Ops Chief */}
        <section className="card p-5 md:p-6">
          <div className="flex items-baseline justify-between gap-4 mb-3">
            <h2 className="serif text-xl">Ops Chief</h2>
            <span className="muted text-xs uppercase tracking-widest">
              Cross-venture · Live
            </span>
          </div>
          <p className="muted text-sm mb-4">
            Daily briefing and weekly planner. Runs automatically on schedule —
            trigger manually here when you need an off-cycle run.
          </p>
          <RunOpsChiefButton />
        </section>

        {/* Showrunner */}
        <section className="card p-5 md:p-6">
          <div className="flex items-baseline justify-between gap-4 mb-3">
            <h2 className="serif text-xl">Showrunner</h2>
            <span className="muted text-xs uppercase tracking-widest">
              The Trades Show · Live
            </span>
          </div>
          <p className="muted text-sm mb-4">
            Paste an episode transcript and Showrunner writes the Substack
            post, titles and descriptions, and one caption per clip. Interview
            episodes take guest info and a timestamped outline.
          </p>
          <ShowrunnerInput />
        </section>
      </div>
    </main>
  );
}
