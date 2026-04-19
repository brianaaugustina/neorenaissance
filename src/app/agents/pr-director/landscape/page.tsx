import Link from 'next/link';
import DOMPurify from 'isomorphic-dompurify';
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

  // New runs store HTML; legacy runs stored markdown. Prefer HTML when present.
  const latestHtml = latest
    ? latest.briefing.html
      ? DOMPurify.sanitize(latest.briefing.html)
      : latest.briefing.markdown
        ? renderLegacyMarkdownToHtml(latest.briefing.markdown)
        : ''
    : '';

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
          <article
            className="briefing-body text-sm"
            dangerouslySetInnerHTML={{ __html: latestHtml }}
          />
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

// Fallback for rows stored before the HTML switch. Converts the four-section
// markdown shape Claude produced previously into minimally-styled HTML.
// Handles: ## headers, - / * bullets, paragraphs.
function renderLegacyMarkdownToHtml(md: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  let inList = false;
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${escapeHtml(para.join(' '))}</p>`);
      para = [];
    }
  };
  const closeList = () => {
    if (inList) {
      out.push('</ul>');
      inList = false;
    }
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flushPara();
      closeList();
      continue;
    }
    if (line.startsWith('## ')) {
      flushPara();
      closeList();
      out.push(`<h2>${escapeHtml(line.slice(3))}</h2>`);
      continue;
    }
    if (line.startsWith('# ')) {
      flushPara();
      closeList();
      out.push(`<h2>${escapeHtml(line.slice(2))}</h2>`);
      continue;
    }
    if (line.startsWith('- ') || line.startsWith('* ')) {
      flushPara();
      if (!inList) {
        out.push('<ul>');
        inList = true;
      }
      out.push(`<li>${escapeHtml(line.slice(2))}</li>`);
      continue;
    }
    closeList();
    para.push(line);
  }
  flushPara();
  closeList();
  return DOMPurify.sanitize(out.join('\n'));
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
