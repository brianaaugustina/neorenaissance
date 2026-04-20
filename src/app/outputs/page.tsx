import Link from 'next/link';
import { AgentDashNav } from '@/components/AgentDashNav';
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
  gate?: string; // 'requires' | 'clean'
  since?: string;
  until?: string;
}

const STATUS_OPTIONS = ['pending', 'approved', 'edited', 'rejected', 'expired', 'ignored'];

export default async function OutputsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;

  // Gate shortcut: requires gateway = status=pending, clean = approved/edited.
  const effectiveStatus =
    sp.gate === 'requires'
      ? 'pending'
      : sp.gate === 'clean'
        ? undefined
        : sp.status;

  const [rows, facets] = await Promise.all([
    listOutputs({
      agentId: sp.agent || undefined,
      outputType: sp.type || undefined,
      approvalStatus: effectiveStatus || undefined,
      sinceIso: sp.since || undefined,
      untilIso: sp.until || undefined,
      limit: 100,
    }),
    listOutputsFacets(),
  ]);

  const visible =
    sp.gate === 'clean'
      ? rows.filter((r) => r.approval_status === 'approved' || r.approval_status === 'edited')
      : rows;

  // Stats for the right rail
  const now = Date.now();
  const last24h = visible.filter(
    (r) => now - new Date(r.created_at).getTime() <= 24 * 3600 * 1000,
  ).length;
  const pendingCount = visible.filter((r) => r.approval_status === 'pending').length;
  const perAgent = new Map<string, number>();
  for (const r of visible) {
    perAgent.set(r.agent_id, (perAgent.get(r.agent_id) ?? 0) + 1);
  }
  const perAgentSorted = [...perAgent.entries()].sort((a, b) => b[1] - a[1]);


  return (
    <>
      <AgentDashNav pendingCount={pendingCount} />

      <main style={{ padding: '32px 40px 80px', maxWidth: 1600, margin: '0 auto' }}>
        {/* Hero */}
        <div style={{ marginBottom: 24 }}>
          <p className="eyebrow">Live Feed · All Agent Outputs</p>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr auto',
              alignItems: 'end',
              gap: 40,
            }}
          >
            <div>
              <h1 className="title" style={{ fontSize: 72 }}>
                All Outputs
                <span className="count">({visible.length})</span>
              </h1>
              <p className="sub">
                Chronological stream of every output produced by every agent.
                Outputs still awaiting operator action appear with a gateway
                pill — click any row for full detail + per-agent actions.
              </p>
            </div>
            <div
              className="mono"
              style={{
                textAlign: 'right',
                fontSize: 11,
                color: 'var(--ink-2)',
                lineHeight: 1.7,
                letterSpacing: '0.05em',
              }}
            >
              <span className="chip dot">LIVE</span>
              <br />
              LAST 24H: {last24h}
              <br />
              PENDING: {pendingCount}
            </div>
          </div>
        </div>

        {/* Filter chips (as anchor links so state persists via URL) */}
        <form
          method="GET"
          className="filters"
          style={{ marginBottom: 20, alignItems: 'end' }}
        >
          <FilterChip label="All" name="gate" value="" active={!sp.gate} />
          <FilterChip
            label="Requires gateway"
            name="gate"
            value="requires"
            active={sp.gate === 'requires'}
          />
          <FilterChip
            label="Approved"
            name="gate"
            value="clean"
            active={sp.gate === 'clean'}
          />
          <span style={{ flex: 1 }} />
          <Select
            name="agent"
            label="Agent"
            value={sp.agent}
            options={facets.agentIds}
          />
          <Select
            name="type"
            label="Type"
            value={sp.type}
            options={facets.outputTypes}
          />
          <Select
            name="status"
            label="Status"
            value={sp.status}
            options={STATUS_OPTIONS}
          />
          <DateInput label="Since" name="since" value={sp.since} />
          <DateInput label="Until" name="until" value={sp.until} />
          <button type="submit" className="fbtn on" style={{ alignSelf: 'end' }}>
            Apply
          </button>
          {(sp.agent || sp.type || sp.status || sp.gate || sp.since || sp.until) && (
            <Link
              href="/outputs"
              className="mono"
              style={{
                fontSize: 11,
                color: 'var(--ink-3)',
                alignSelf: 'center',
                textDecoration: 'none',
                padding: '0 8px',
              }}
            >
              Clear →
            </Link>
          )}
        </form>

        {/* Split: feed + right rail */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 300px',
            gap: 40,
            marginTop: 16,
          }}
        >
          <div style={{ borderTop: '1px solid var(--rule-strong)' }}>
            {visible.length === 0 ? (
              <p
                className="mono"
                style={{
                  padding: '60px 0',
                  textAlign: 'center',
                  color: 'var(--ink-3)',
                  fontSize: 12,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                }}
              >
                No outputs match these filters
              </p>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {visible.map((r) => (
                  <FeedItem key={r.id} row={r} />
                ))}
              </ul>
            )}
          </div>

          {/* Right rail */}
          <aside>
            <div style={{ borderBottom: '1px solid var(--rule)', paddingBottom: 20, marginBottom: 20 }}>
              <div
                className="mono"
                style={{
                  fontSize: 10,
                  letterSpacing: '0.18em',
                  textTransform: 'uppercase',
                  color: 'var(--ink-2)',
                  marginBottom: 12,
                  fontWeight: 500,
                }}
              >
                By agent
              </div>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {perAgentSorted.slice(0, 10).map(([agent, count]) => {
                  const isActive = sp.agent === agent;
                  return (
                    <li
                      key={agent}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr auto',
                        fontSize: 12,
                        padding: '6px 0',
                        borderBottom: '1px solid var(--rule)',
                      }}
                    >
                      <Link
                        href={isActive ? '/outputs' : `/outputs?agent=${encodeURIComponent(agent)}`}
                        className="mono"
                        style={{
                          fontSize: 11,
                          color: isActive ? 'var(--ink)' : 'var(--ink-2)',
                          fontWeight: isActive ? 600 : 500,
                          textDecoration: 'none',
                          letterSpacing: '0.04em',
                        }}
                      >
                        {agent}
                      </Link>
                      <span
                        className="mono"
                        style={{ fontSize: 11, fontWeight: 600 }}
                      >
                        {count}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div>
              <div
                className="mono"
                style={{
                  fontSize: 10,
                  letterSpacing: '0.18em',
                  textTransform: 'uppercase',
                  color: 'var(--ink-2)',
                  marginBottom: 12,
                  fontWeight: 500,
                }}
              >
                Legend
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
                <LegendRow label="Pending" color="var(--ink-3)" />
                <LegendRow label="Approved" color="var(--ok)" />
                <LegendRow label="Edited" color="var(--ink)" />
                <LegendRow label="Rejected" color="var(--danger)" />
                <LegendRow label="Ignored" color="var(--ink-3)" dashed />
              </div>
            </div>
          </aside>
        </div>
      </main>
    </>
  );
}

// ============================================================================

function FeedItem({ row }: { row: OutputsListRow }) {
  const isGate =
    row.approval_status === 'pending' || row.approval_status === 'edited';
  const statusColor =
    row.approval_status === 'approved'
      ? 'var(--ok)'
      : row.approval_status === 'rejected'
        ? 'var(--danger)'
        : row.approval_status === 'ignored'
          ? 'var(--ink-3)'
          : row.approval_status === 'edited'
            ? 'var(--ink)'
            : 'var(--ink-2)';
  return (
    <li>
      <Link
        href={`/outputs/${row.agent_id}/${row.id}`}
        className="dash-card"
        style={{
          display: 'grid',
          gridTemplateColumns: '90px 1fr auto',
          gap: 20,
          padding: '18px 8px',
          borderBottom: '1px solid var(--rule)',
          textDecoration: 'none',
          color: 'inherit',
        }}
      >
        <div
          className="mono"
          style={{ fontSize: 11, color: 'var(--ink-3)', paddingTop: 4 }}
        >
          {formatPtTime(row.created_at)}
        </div>
        <div style={{ minWidth: 0 }}>
          <div
            className="mono"
            style={{
              display: 'flex',
              gap: 10,
              alignItems: 'center',
              marginBottom: 4,
              fontSize: 10,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              flexWrap: 'wrap',
            }}
          >
            <span style={{ fontWeight: 600, color: 'var(--ink)' }}>{row.agent_id}</span>
            <span style={{ color: 'var(--ink-4)' }}>·</span>
            <span style={{ color: 'var(--ink-3)' }}>
              {row.output_type.replace(/_/g, ' ')}
            </span>
          </div>
          <h3
            style={{
              fontSize: 18,
              fontWeight: 500,
              letterSpacing: '-0.01em',
              margin: '0 0 4px',
              lineHeight: 1.3,
            }}
          >
            {row.summary_preview ?? '(no summary)'}
          </h3>
          {row.rejection_reason && (
            <p
              className="mono"
              style={{
                fontSize: 11,
                color: 'var(--danger)',
                margin: 0,
                lineHeight: 1.5,
              }}
            >
              Rejected: {row.rejection_reason}
            </p>
          )}
        </div>
        <div
          style={{
            textAlign: 'right',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            gap: 8,
            paddingTop: 2,
          }}
        >
          {isGate ? (
            <span
              className="mono"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 10,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                padding: '3px 8px',
                border: `1px solid ${statusColor}`,
                color: statusColor,
                fontWeight: 600,
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  background: statusColor,
                  borderRadius: '50%',
                  animation: row.approval_status === 'pending' ? 'pulse 1.4s infinite' : 'none',
                }}
              />
              {row.approval_status.toUpperCase()}
            </span>
          ) : (
            <span
              className="mono"
              style={{
                fontSize: 10,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: statusColor,
                fontWeight: 600,
              }}
            >
              {row.approval_status.toUpperCase()}
            </span>
          )}
          <span
            className="mono"
            style={{
              fontSize: 10,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: 'var(--ink-3)',
            }}
          >
            Open →
          </span>
        </div>
      </Link>
    </li>
  );
}

function FilterChip({
  label,
  name,
  value,
  active,
}: {
  label: string;
  name: string;
  value: string;
  active: boolean;
}) {
  return (
    <button
      type="submit"
      name={name}
      value={value}
      className={`fbtn ${active ? 'on' : ''}`}
    >
      {label}
    </button>
  );
}

function Select({
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
    <label
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
        fontSize: 11,
      }}
    >
      <span
        className="mono"
        style={{
          fontSize: 10,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'var(--ink-3)',
        }}
      >
        {label}
      </span>
      <select
        name={name}
        defaultValue={value ?? ''}
        style={{
          background: 'transparent',
          border: '1px solid var(--rule)',
          padding: '5px 8px',
          fontSize: 11,
          fontFamily: 'var(--font-mono)',
          color: 'var(--ink)',
        }}
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
    <label
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
        fontSize: 11,
      }}
    >
      <span
        className="mono"
        style={{
          fontSize: 10,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'var(--ink-3)',
        }}
      >
        {label}
      </span>
      <input
        type="date"
        name={name}
        defaultValue={value ?? ''}
        style={{
          background: 'transparent',
          border: '1px solid var(--rule)',
          padding: '5px 8px',
          fontSize: 11,
          fontFamily: 'var(--font-mono)',
          color: 'var(--ink)',
        }}
      />
    </label>
  );
}

function LegendRow({
  label,
  color,
  dashed,
}: {
  label: string;
  color: string;
  dashed?: boolean;
}) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <span
        style={{
          width: 10,
          height: 10,
          border: `1px ${dashed ? 'dashed' : 'solid'} ${color}`,
          background: dashed ? 'transparent' : color,
        }}
      />
      <span
        className="mono"
        style={{
          fontSize: 11,
          letterSpacing: '0.06em',
          color: 'var(--ink-2)',
          textTransform: 'uppercase',
        }}
      >
        {label}
      </span>
    </div>
  );
}
