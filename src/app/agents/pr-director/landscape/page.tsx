import Link from 'next/link';
import {
  getLatestLandscapeBriefing,
  listRecentLandscapeBriefings,
} from '@/lib/agents/pr-director';
import { RunLandscapeBriefingButton } from '@/components/RunLandscapeBriefingButton';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function LandscapePage() {
  const [latest, history] = await Promise.all([
    getLatestLandscapeBriefing(),
    listRecentLandscapeBriefings(12),
  ]);

  return (
    <main className="min-h-screen px-4 py-6 md:px-10 md:py-10 max-w-[960px] mx-auto">
      <header className="mb-6 md:mb-8">
        <Link href="/agents" className="text-xs gold hover:underline">
          ← Back to agents
        </Link>
        <h1 className="serif text-3xl md:text-4xl gold mt-3">
          Editorial landscape briefing
        </h1>
        <p className="muted text-sm mt-1">
          Monthly context read by the PR Director research runs. Editorial
          calendars (next 60 days), cultural moments, trending narratives, and
          milestone alignment opportunities.
        </p>
        <div className="mt-4">
          <RunLandscapeBriefingButton />
        </div>
      </header>

      {!latest && (
        <section className="card p-5 md:p-6">
          <p className="muted text-sm">
            No landscape briefing has been generated yet. Hit{' '}
            <span className="gold">Run Landscape</span> above to produce the
            first one — it takes ~60 seconds. Future runs fire automatically on
            the 1st of each month at 7am PT.
          </p>
        </section>
      )}

      {latest && (
        <section className="card p-5 md:p-6">
          <div className="flex items-baseline justify-between gap-4 mb-4">
            <h2 className="serif text-xl">{latest.briefing.month_label}</h2>
            <span className="muted text-xs uppercase tracking-widest">
              Generated {latest.briefing.date}
            </span>
          </div>
          <article className="briefing-body text-sm leading-relaxed">
            {renderSimpleMarkdown(latest.briefing.markdown)}
          </article>
        </section>
      )}

      {history.length > 1 && (
        <section className="mt-8">
          <h2 className="serif text-lg mb-3">History</h2>
          <ul className="space-y-2 text-sm">
            {history.slice(1).map((h) => (
              <li key={h.id} className="flex justify-between gap-4 border-b pb-2"
                  style={{ borderColor: 'var(--border)' }}>
                <span>{h.month_label}</span>
                <span className="muted text-xs">{h.date}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

// Tiny markdown renderer for the briefing body. Claude emits ## headers and
// plain paragraphs; no need to pull in a full parser for this shape.
function renderSimpleMarkdown(md: string): React.ReactNode {
  const lines = md.split('\n');
  const nodes: React.ReactNode[] = [];
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) {
      nodes.push(
        <p key={`p-${nodes.length}`} className="mb-3">
          {para.join(' ')}
        </p>,
      );
      para = [];
    }
  };
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed) {
      flushPara();
      return;
    }
    if (trimmed.startsWith('## ')) {
      flushPara();
      nodes.push(
        <h2 key={`h2-${i}`}>{trimmed.slice(3)}</h2>,
      );
      return;
    }
    if (trimmed.startsWith('# ')) {
      flushPara();
      nodes.push(<h1 key={`h1-${i}`}>{trimmed.slice(2)}</h1>);
      return;
    }
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      flushPara();
      // Group consecutive bullets
      const last = nodes[nodes.length - 1];
      if (last && typeof last === 'object' && 'type' in (last as any) && (last as any).type === 'ul') {
        // Can't actually mutate a React element. Just push a new ul — cheap.
      }
      nodes.push(
        <ul key={`ul-${i}`} className="list-disc pl-5 mb-1">
          <li>{trimmed.slice(2)}</li>
        </ul>,
      );
      return;
    }
    para.push(trimmed);
  });
  flushPara();
  return <>{nodes}</>;
}
