import Link from 'next/link';
import { notFound } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase/client';
import { LandscapeBody } from '@/components/LandscapeBody';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Minimal per-item Review page — dedicated read-only view of a queue item.
// Pass B will evolve this into the full Outputs listing with filters; for
// now it's a deep-link landing for the Review button.
export default async function ReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const db = supabaseAdmin();
  const { data: item, error } = await db
    .from('approval_queue')
    .select('*')
    .eq('id', id)
    .single();
  if (error || !item) notFound();

  const created = new Date(item.created_at).toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  const fullOutput = (item.full_output ?? {}) as Record<string, unknown>;
  const briefingHtml = fullOutput.briefing_html as string | undefined;
  const briefingMarkdown = fullOutput.briefing_markdown as string | undefined;

  return (
    <main className="min-h-screen px-4 py-6 md:px-10 md:py-10 max-w-[880px] mx-auto">
      <header className="mb-6">
        <Link href="/" className="text-xs gold hover:underline">
          ← Back to dashboard
        </Link>
        <div className="mt-3 text-xs muted uppercase tracking-wider">
          {item.agent_name} · {item.type} · {item.status} · {created}
        </div>
        <h1 className="serif text-2xl md:text-3xl mt-1">{item.title}</h1>
        {item.summary && <p className="muted text-sm mt-1">{item.summary}</p>}
      </header>

      <section className="card p-5 md:p-6 space-y-4 text-sm">
        {briefingHtml || briefingMarkdown ? (
          <LandscapeBody html={briefingHtml} markdown={briefingMarkdown} />
        ) : (
          <FullOutputDump payload={fullOutput} />
        )}
      </section>

      <p className="text-xs muted mt-4">
        Review is read-only. To act on this item, return to the dashboard.
      </p>
    </main>
  );
}

function FullOutputDump({ payload }: { payload: Record<string, unknown> }) {
  // Render each top-level field as a section so Briana can scan. Arrays /
  // objects pretty-print; strings render as-is with preserved whitespace.
  const entries = Object.entries(payload).filter(([k]) => {
    // Skip internal bookkeeping and raw dumps.
    return !['raw_output', 'inputs', 'superseded_by_queue_id', 'notion_entries_created', 'notion_entry_ids'].includes(
      k,
    );
  });
  if (!entries.length) {
    return <p className="muted text-xs">(no output body)</p>;
  }
  return (
    <div className="space-y-4">
      {entries.map(([key, value]) => (
        <div key={key}>
          <div className="text-xs muted uppercase tracking-wider mb-1">
            {key.replace(/_/g, ' ')}
          </div>
          <FieldValue value={value} />
        </div>
      ))}
    </div>
  );
}

function FieldValue({ value }: { value: unknown }) {
  if (value == null || value === '') {
    return <p className="muted text-xs">(empty)</p>;
  }
  if (typeof value === 'string') {
    return <pre className="whitespace-pre-wrap text-sm">{value}</pre>;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return <p>{String(value)}</p>;
  }
  return (
    <pre className="whitespace-pre-wrap text-xs muted">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}
