import Link from 'next/link';
import { AgentDashNav } from '@/components/AgentDashNav';
import { AGENT_REGISTRY, type AgentRegistryEntry } from '@/lib/agents/registry';
import { getRecentAgentRuns, supabaseAdmin } from '@/lib/supabase/client';
import { formatPtRelative } from '@/lib/time';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface AgentMetrics {
  runs: number;
  success: number; // 0–100
  lastRunIso: string | null;
  lastRunStatus: string | null;
  pendingOutputs: number;
  status: 'running' | 'idle' | 'stale' | 'blocked';
}

function computeStatus(
  lastRunIso: string | null,
  lastRunStatus: string | null,
  pendingOutputs: number,
): AgentMetrics['status'] {
  if (lastRunStatus === 'error') return 'blocked';
  if (!lastRunIso) return 'idle';
  const ageMs = Date.now() - new Date(lastRunIso).getTime();
  if (ageMs < 10 * 60 * 1000) return 'running';
  if (ageMs < 24 * 3600 * 1000) return 'idle';
  void pendingOutputs;
  return 'stale';
}

export default async function AllAgentsPage() {
  const outputsSafe = async () => {
    try {
      const res = await supabaseAdmin()
        .from('agent_outputs')
        .select('agent_id, approval_status')
        .in('approval_status', ['pending']);
      return (res.data ?? []) as Array<{ agent_id: string; approval_status: string }>;
    } catch {
      return [] as Array<{ agent_id: string; approval_status: string }>;
    }
  };
  const [runsRaw, outputsRaw] = await Promise.all([
    getRecentAgentRuns(200).catch(() => [] as Array<Record<string, unknown>>),
    outputsSafe(),
  ]);

  // Aggregate per-agent metrics. Keyed by normalised agent id so
  // ops_chief vs ops-chief share a row.
  const runs = runsRaw as Array<{
    agent_name: string;
    status: string;
    started_at: string;
  }>;
  const metrics = new Map<string, AgentMetrics>();
  const bump = (id: string): AgentMetrics => {
    const existing = metrics.get(id);
    if (existing) return existing;
    const fresh: AgentMetrics = {
      runs: 0,
      success: 0,
      lastRunIso: null,
      lastRunStatus: null,
      pendingOutputs: 0,
      status: 'idle',
    };
    metrics.set(id, fresh);
    return fresh;
  };

  const successCounts = new Map<string, { success: number; total: number }>();
  for (const r of runs) {
    const id = normalizeId(r.agent_name);
    const m = bump(id);
    m.runs++;
    if (m.lastRunIso == null || new Date(r.started_at) > new Date(m.lastRunIso)) {
      m.lastRunIso = r.started_at;
      m.lastRunStatus = r.status;
    }
    const sc = successCounts.get(id) ?? { success: 0, total: 0 };
    sc.total++;
    if (r.status === 'success') sc.success++;
    successCounts.set(id, sc);
  }
  for (const [id, sc] of successCounts) {
    const m = metrics.get(id)!;
    m.success = sc.total > 0 ? Math.round((sc.success / sc.total) * 100) : 100;
  }
  for (const o of outputsRaw) {
    const id = normalizeId(o.agent_id);
    const m = bump(id);
    m.pendingOutputs++;
  }
  for (const [id, m] of metrics) {
    m.status = computeStatus(m.lastRunIso, m.lastRunStatus, m.pendingOutputs);
    void id;
  }

  const rows = AGENT_REGISTRY.map((a) => {
    const ids = [a.id, ...(a.aliases ?? [])].map(normalizeId);
    // Merge metrics from all aliases
    let merged: AgentMetrics | null = null;
    for (const id of ids) {
      const m = metrics.get(id);
      if (!m) continue;
      if (!merged) {
        merged = { ...m };
      } else {
        merged.runs += m.runs;
        merged.pendingOutputs += m.pendingOutputs;
        if (!merged.lastRunIso || (m.lastRunIso && new Date(m.lastRunIso) > new Date(merged.lastRunIso))) {
          merged.lastRunIso = m.lastRunIso;
          merged.lastRunStatus = m.lastRunStatus;
        }
        // Success rate — weighted mean would be better, skipping for now
      }
    }
    if (!merged) {
      merged = {
        runs: 0,
        success: 100,
        lastRunIso: null,
        lastRunStatus: null,
        pendingOutputs: 0,
        status: 'idle',
      };
    }
    merged.status = computeStatus(merged.lastRunIso, merged.lastRunStatus, merged.pendingOutputs);
    return { agent: a, metrics: merged };
  });

  const runningCount = rows.filter((r) => r.metrics.status === 'running').length;
  const idleCount = rows.filter((r) => r.metrics.status === 'idle').length;
  const staleCount = rows.filter((r) => r.metrics.status === 'stale').length;
  const blockedCount = rows.filter((r) => r.metrics.status === 'blocked').length;
  const totalPendingOutputs = rows.reduce((acc, r) => acc + r.metrics.pendingOutputs, 0);

  return (
    <>
      <AgentDashNav pendingCount={totalPendingOutputs} agentCount={AGENT_REGISTRY.length} />

      <main style={{ padding: '32px 40px 80px', maxWidth: 1600, margin: '0 auto' }}>
        {/* Hero */}
        <div style={{ marginBottom: 32 }}>
          <p className="eyebrow">Registry · Active Fleet</p>
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
                All Agents
                <span className="count">({AGENT_REGISTRY.length})</span>
              </h1>
              <p className="sub">
                Every agent registered to this operator. Each card links to the
                agent&rsquo;s detail page — outputs, connections, capabilities.
                Click the trigger button for a manual off-cycle run.
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
              <span className="chip dot">{runningCount} RUNNING</span>
              <br />
              {idleCount} IDLE · {staleCount} STALE
              <br />
              {blockedCount} BLOCKED · {totalPendingOutputs} PENDING
            </div>
          </div>
        </div>

        {/* Agent cards — grouped by venture / layer. Cross-venture on top,
            per-venture in the middle, meta layer at the bottom. */}
        {(() => {
          const groups: Array<{ key: string; label: string; blurb: string; rows: typeof rows }> = [];
          const byVenture = new Map<string, typeof rows>();
          for (const r of rows) {
            const key = r.agent.venture;
            const list = byVenture.get(key) ?? [];
            list.push(r);
            byVenture.set(key, list);
          }
          // Stable ordering: Cross-venture first, then specific ventures
          // (alphabetical), then Meta layer last.
          const ventureOrder = [
            'Cross-venture',
            ...[...byVenture.keys()]
              .filter((v) => v !== 'Cross-venture' && v !== 'Meta layer')
              .sort(),
            'Meta layer',
          ];
          const blurbByVenture: Record<string, string> = {
            'Cross-venture':
              'Agents that serve the whole portfolio — your daily briefing, funding pipeline, monthly analytics + strategy.',
            'The Trades Show':
              'Podcast-specific agents — episode packaging, press, sponsorship, guest research.',
            'Meta layer':
              "The system watching itself — weekly observations of the fleet and the codebase.",
          };
          for (const key of ventureOrder) {
            const list = byVenture.get(key);
            if (!list || list.length === 0) continue;
            // Ops Chief is the operator's daily surface — pin it first in
            // Cross-venture. Otherwise: strategy/meta layer before execution,
            // then alphabetical.
            const layerRank: Record<string, number> = { meta: 0, strategy: 1, execution: 2 };
            const pinRank = (id: string): number => (id === 'ops_chief' ? 0 : 1);
            const sorted = [...list].sort(
              (a, b) =>
                pinRank(a.agent.id) - pinRank(b.agent.id) ||
                (layerRank[a.agent.layer] ?? 99) - (layerRank[b.agent.layer] ?? 99) ||
                a.agent.name.localeCompare(b.agent.name),
            );
            groups.push({
              key,
              label: key,
              blurb: blurbByVenture[key] ?? '',
              rows: sorted,
            });
          }

          return groups.map((g) => (
            <section key={g.key} style={{ marginTop: 40 }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  paddingBottom: 10,
                  borderBottom: '1px solid var(--rule-strong)',
                  marginBottom: 0,
                }}
              >
                <h2
                  style={{
                    fontSize: 22,
                    fontWeight: 600,
                    letterSpacing: '-0.02em',
                    margin: 0,
                  }}
                >
                  {g.label}
                  <span
                    className="mono"
                    style={{
                      fontSize: 14,
                      color: 'var(--ink-3)',
                      fontWeight: 400,
                      marginLeft: 8,
                    }}
                  >
                    {g.rows.length}
                  </span>
                </h2>
                {g.blurb && (
                  <span
                    className="mono"
                    style={{
                      fontSize: 11,
                      color: 'var(--ink-3)',
                      letterSpacing: '0.04em',
                      textAlign: 'right',
                      maxWidth: 520,
                    }}
                  >
                    {g.blurb}
                  </span>
                )}
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))',
                  gap: 0,
                  borderLeft: '1px solid var(--rule)',
                }}
              >
                {g.rows.map(({ agent, metrics }) => (
                  <Card key={agent.id} agent={agent} metrics={metrics} />
                ))}
              </div>
            </section>
          ));
        })()}
      </main>
    </>
  );
}

function Card({ agent, metrics }: { agent: AgentRegistryEntry; metrics: AgentMetrics }) {
  const statusColor =
    metrics.status === 'running'
      ? 'var(--ok)'
      : metrics.status === 'blocked'
        ? 'var(--danger)'
        : metrics.status === 'stale'
          ? 'var(--ink-3)'
          : 'var(--ink-2)';
  const statusLabel =
    metrics.status === 'running'
      ? 'RUNNING'
      : metrics.status === 'blocked'
        ? 'BLOCKED'
        : metrics.status === 'stale'
          ? 'STALE'
          : 'IDLE';
  return (
    <Link
      href={`/agents/${agent.id}`}
      className="dash-card"
      style={{
        borderRight: '1px solid var(--rule)',
        borderBottom: '1px solid var(--rule)',
        padding: '24px 22px',
        textDecoration: 'none',
        color: 'inherit',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        minHeight: 240,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: 8,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <h3
            style={{
              fontSize: 20,
              fontWeight: 600,
              letterSpacing: '-0.015em',
              margin: 0,
              lineHeight: 1.1,
            }}
          >
            {agent.name}
          </h3>
          <div
            className="mono"
            style={{
              fontSize: 10,
              color: 'var(--ink-3)',
              marginTop: 4,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
            }}
          >
            {agent.venture} · {agent.layer}
          </div>
        </div>
        <span
          className="mono"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 10,
            letterSpacing: '0.12em',
            fontWeight: 600,
            color: statusColor,
            textTransform: 'uppercase',
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              background: statusColor,
              borderRadius: '50%',
              animation: metrics.status === 'running' ? 'pulse 1.4s infinite' : 'none',
            }}
          />
          {statusLabel}
        </span>
      </div>

      <p
        style={{
          fontSize: 13,
          color: 'var(--ink-2)',
          lineHeight: 1.5,
          margin: 0,
          flex: 1,
          display: '-webkit-box',
          WebkitLineClamp: 3,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {agent.tagline}
      </p>

      <div
        className="mono"
        style={{
          fontSize: 10,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: 'var(--ink-3)',
          marginTop: 'auto',
        }}
      >
        {agent.cadence}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          gap: 8,
          paddingTop: 12,
          borderTop: '1px solid var(--rule)',
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          color: 'var(--ink-3)',
        }}
      >
        <MetricCell n={metrics.runs} label="runs" />
        <MetricCell n={metrics.pendingOutputs} label="pending" />
        <MetricCell
          n={metrics.success != null ? `${metrics.success}%` : '—'}
          label="success"
        />
      </div>

      <div
        className="mono"
        style={{
          fontSize: 10,
          letterSpacing: '0.06em',
          color: 'var(--ink-3)',
          marginTop: 4,
        }}
      >
        {metrics.lastRunIso
          ? `Last run · ${formatPtRelative(metrics.lastRunIso)}`
          : 'No runs yet'}
      </div>
    </Link>
  );
}

function MetricCell({ n, label }: { n: number | string; label: string }) {
  return (
    <div>
      <div
        style={{
          display: 'block',
          color: 'var(--ink)',
          fontSize: 16,
          fontWeight: 600,
          fontFamily: 'var(--font-sans), "Inter", sans-serif',
          letterSpacing: '-0.01em',
          marginBottom: 2,
        }}
      >
        {n}
      </div>
      <span style={{ textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
    </div>
  );
}

function normalizeId(id: string): string {
  return id.replace(/_/g, '-');
}
