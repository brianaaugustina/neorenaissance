import Link from 'next/link';
import { RunOpsChiefButton } from '@/components/RunOpsChiefButton';
import { RunPrResearchButton } from '@/components/RunPrResearchButton';
import { RunSponsorshipResearchButton } from '@/components/RunSponsorshipResearchButton';
import { RunTalentResearchButton } from '@/components/RunTalentResearchButton';
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

        {/* Sponsorship Director */}
        <section className="card p-5 md:p-6">
          <div className="flex items-baseline justify-between gap-4 mb-3">
            <h2 className="serif text-xl">Sponsorship Director</h2>
            <span className="muted text-xs uppercase tracking-widest">
              The Trades Show · Live
            </span>
          </div>
          <p className="muted text-sm mb-4">
            Weekly sponsor research and pitch drafting. The Mon 8am PT cron
            surfaces 10 leads scored against the 5-point fit test. Approve a
            lead in the queue and a Touch 1 pitch drafts automatically, with a
            matching Outreach row in Notion. Trigger off-cycle below when you
            want fresh leads now. Gmail send is not yet wired — Gate 3 is
            manual until OAuth lands.
          </p>
          <RunSponsorshipResearchButton />
        </section>

        {/* Talent Scout */}
        <section className="card p-5 md:p-6">
          <div className="flex items-baseline justify-between gap-4 mb-3">
            <h2 className="serif text-xl">Talent Scout</h2>
            <span className="muted text-xs uppercase tracking-widest">
              The Trades Show · Live
            </span>
          </div>
          <p className="muted text-sm mb-4">
            Manual-trigger research for Season 2 / Season 3 artisan candidates.
            Each surfaced lead is written to the Notion Contacts DB immediately
            (append-only) and carries a suggested channel — email, IG DM, or
            through-team. Approving a lead generates the right draft for its
            channel. Gate 3 is &ldquo;Mark as sent&rdquo; for all channels
            until Gmail OAuth lands; once it does, email Sends fire via Gmail
            and IG/team stay manual. No weekly cron — research runs when you
            say so.
          </p>
          <RunTalentResearchButton />
        </section>

        {/* PR Director */}
        <section className="card p-5 md:p-6">
          <div className="flex items-baseline justify-between gap-4 mb-3">
            <h2 className="serif text-xl">PR Director</h2>
            <span className="muted text-xs uppercase tracking-widest">
              The Trades Show · Live
            </span>
          </div>
          <p className="muted text-sm mb-4">
            Monthly editorial landscape scan, weekly press research, and
            per-lead Touch 1 drafts. Monthly cron: 1st of month 7am PT.
            Weekly cron: Mon 7am PT. Approve a lead and a press pitch drafts
            in your chosen voice mode (founder-first / show-first / hybrid),
            with a matching Outreach row in Notion. Gate 3 Send is manual
            until Gmail OAuth lands.
          </p>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <Link
              href="/agents/pr-director/landscape"
              className="text-sm gold hover:underline"
            >
              View landscape briefing ↗
            </Link>
            <RunPrResearchButton />
          </div>
        </section>
      </div>
    </main>
  );
}
