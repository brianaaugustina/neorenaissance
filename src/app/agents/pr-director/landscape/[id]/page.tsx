import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  getLandscapeBriefingById,
  listRecentLandscapeBriefings,
} from '@/lib/agents/pr-director';
import { LandscapeBody } from '@/components/LandscapeBody';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function HistoricalLandscapePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [entry, history] = await Promise.all([
    getLandscapeBriefingById(id),
    listRecentLandscapeBriefings(12),
  ]);

  if (!entry) {
    notFound();
  }

  const currentIdx = history.findIndex((h) => h.id === entry.id);
  const prev = currentIdx >= 0 ? history[currentIdx + 1] : null;
  const next = currentIdx > 0 ? history[currentIdx - 1] : null;

  return (
    <main className="min-h-screen px-4 py-6 md:px-10 md:py-10 max-w-[960px] mx-auto">
      <header className="mb-6 md:mb-8">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <Link
            href="/agents/pr-director/landscape"
            className="text-xs gold hover:underline"
          >
            ← Back to latest landscape
          </Link>
          <div className="flex gap-3 text-xs">
            {prev && (
              <Link
                href={`/agents/pr-director/landscape/${prev.id}`}
                className="gold hover:underline"
              >
                ← {prev.month_label}
              </Link>
            )}
            {next && (
              <Link
                href={`/agents/pr-director/landscape/${next.id}`}
                className="gold hover:underline"
              >
                {next.month_label} →
              </Link>
            )}
          </div>
        </div>
        <h1 className="serif text-3xl md:text-4xl gold mt-3">
          {entry.briefing.month_label}
        </h1>
        <p className="muted text-xs uppercase tracking-widest mt-1">
          Generated {entry.briefing.date}
        </p>
      </header>

      <section className="card p-5 md:p-6">
        <LandscapeBody
          html={entry.briefing.html}
          markdown={entry.briefing.markdown}
        />
      </section>

      {history.length > 1 && (
        <section className="mt-8">
          <h2 className="serif text-lg mb-3">All landscapes</h2>
          <ul className="space-y-1 text-sm">
            {history.map((h) => {
              const isCurrent = h.id === entry.id;
              return (
                <li
                  key={h.id}
                  className="flex justify-between gap-4 border-b py-2"
                  style={{ borderColor: 'var(--border)' }}
                >
                  {isCurrent ? (
                    <span className="gold">{h.month_label} (viewing)</span>
                  ) : (
                    <Link
                      href={`/agents/pr-director/landscape/${h.id}`}
                      className="hover:underline"
                    >
                      {h.month_label}
                    </Link>
                  )}
                  <span className="muted text-xs">{h.date}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </main>
  );
}
