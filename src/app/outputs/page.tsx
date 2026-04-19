import Link from 'next/link';
import {
  listOutputs,
  listOutputsFacets,
  type OutputsListRow,
} from '@/lib/supabase/client';
import { formatPtTime } from '@/lib/time';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface SearchParams {
  agent?: string;
  type?: string;
  status?: string;
  since?: string;
  until?: string;
}

export default async function OutputsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const [rows, facets] = await Promise.all([
    listOutputs({
      agentId: sp.agent || undefined,
      outputType: sp.type || undefined,
      approvalStatus: sp.status || undefined,
      sinceIso: sp.since || undefined,
      untilIso: sp.until || undefined,
      limit: 100,
    }),
    listOutputsFacets(),
  ]);

  // Group by day for scannability.
  const byDay = new Map<string, OutputsListRow[]>();
  for (const r of rows) {
    const day = r.created_at.slice(0, 10);
    const arr = byDay.get(day) ?? [];
    arr.push(r);
    byDay.set(day, arr);
  }

  return (
    <main className="min-h-screen px-4 py-6 md:px-10 md:py-10 max-w-[1100px] mx-auto">
      <header className="mb-6">
        <Link href="/" className="text-xs gold hover:underline">
          ← Back to dashboard
        </Link>
        <h1 className="serif text-3xl md:text-4xl gold mt-3">Outputs</h1>
        <p className="muted text-sm mt-1">
          Every output produced by every agent — pending, approved, edited, rejected, scheduled. The queue on the dashboard shows only work in flight; resolved items live here.
        </p>
      </header>

      <form
        method="GET"
        className="flex flex-wrap items-end gap-3 mb-6 text-xs"
      >
        <Filter label="Agent" name="agent" value={sp.agent} options={facets.agentIds} />
        <Filter label="Type" name="type" value={sp.type} options={facets.outputTypes} />
        <Filter
          label="Status"
          name="status"
          value={sp.status}
          options={['pending', 'approved', 'edited', 'rejected', 'expired', 'ignored']}
        />
        <DateInput label="Since" name="since" value={sp.since} />
        <DateInput label="Until" name="until" value={sp.until} />
        <button
          type="submit"
          className="px-3 py-1.5 rounded-md border"
          style={{ borderColor: 'var(--gold)', color: 'var(--gold)' }}
        >
          Apply
        </button>
        {(sp.agent || sp.type || sp.status || sp.since || sp.until) && (
          <a href="/outputs" className="muted hover:underline">Clear</a>
        )}
      </form>

      {rows.length === 0 && (
        <p className="muted text-sm">No outputs match these filters.</p>
      )}

      {[...byDay.entries()].map(([day, items]) => (
        <section key={day} className="mb-6">
          <h2 className="serif text-sm muted uppercase tracking-wider mb-2">
            {new Date(day + 'T12:00:00Z').toLocaleDateString('en-US', {
              timeZone: 'America/Los_Angeles',
              weekday: 'short',
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}
          </h2>
          <ul className="space-y-2">
            {items.map((r) => (
              <li
                key={r.id}
                className="card p-3 md:p-4 flex items-start justify-between gap-4 text-sm"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-xs muted flex flex-wrap items-center gap-2 mb-1">
                    <span className="uppercase tracking-wider">
                      {r.agent_id}
                    </span>
                    <span>·</span>
                    <span>{r.output_type.replace(/_/g, ' ')}</span>
                    <span>·</span>
                    <StatusBadge status={r.approval_status} />
                    <span>·</span>
                    <span>{formatPtTime(r.created_at)} PT</span>
                  </div>
                  {r.summary_preview && (
                    <p className="serif truncate">{r.summary_preview}</p>
                  )}
                  {r.rejection_reason && (
                    <p
                      className="text-xs mt-1 italic"
                      style={{ color: 'var(--danger)' }}
                    >
                      Rejected: {r.rejection_reason}
                    </p>
                  )}
                </div>
                <Link
                  href={`/outputs/${r.agent_id}/${r.id}`}
                  className="shrink-0 text-xs gold hover:underline"
                >
                  View ↗
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}

function Filter({
  label,
  name,
  value,
  options,
}: {
  label: string;
  name: string;
  value?: string;
  options: string[];
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="muted">{label}</span>
      <select
        name={name}
        defaultValue={value ?? ''}
        className="bg-transparent border rounded-md px-2 py-1"
        style={{ borderColor: 'var(--border)' }}
      >
        <option value="">(all)</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

function DateInput({
  label,
  name,
  value,
}: {
  label: string;
  name: string;
  value?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="muted">{label}</span>
      <input
        type="date"
        name={name}
        defaultValue={value ?? ''}
        className="bg-transparent border rounded-md px-2 py-1"
        style={{ borderColor: 'var(--border)' }}
      />
    </label>
  );
}

function StatusBadge({ status }: { status: string }) {
  const color =
    status === 'approved'
      ? 'var(--ok)'
      : status === 'edited'
        ? 'var(--gold)'
        : status === 'rejected'
          ? 'var(--danger)'
          : status === 'pending'
            ? 'var(--muted)'
            : 'var(--muted)';
  return <span style={{ color }}>{status}</span>;
}
