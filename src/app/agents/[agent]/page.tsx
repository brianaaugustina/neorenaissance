import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AgentDashNav } from '@/components/AgentDashNav';
import { AgentTriggerPanel } from '@/components/AgentTriggerPanel';
import { getAgentById, AGENT_REGISTRY, type AgentRegistryEntry } from '@/lib/agents/registry';
import { supabaseAdmin } from '@/lib/supabase/client';
import { formatPtDateTime, formatPtTime, formatPtRelative } from '@/lib/time';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Dynamic per-agent detail page. Acts as the canonical detail view for every
// agent in the registry. Agents with dedicated bespoke pages (analytics-
// reporting, growth-strategist, agent-supervisor, system-engineer) route to
// those static pages instead — Next.js picks the static page over this
// dynamic one automatically.

interface OutputRow {
  id: string;
  output_type: string;
  approval_status: string;
  created_at: string;
  tags: string[] | null;
  run_id: string | null;
  draft_content: Record<string, unknown> | null;
}

interface RunRow {
  id: string;
  started_at: string;
  completed_at: string | null;
  status: string;
  output_summary: string | null;
  duration_ms: number | null;
  tokens_used: number | null;
  cost_estimate: number | null;
  trigger: string | null;
}

export default async function AgentDetailPage({
  params,
}: {
  params: Promise<{ agent: string }>;
}) {
  const { agent: agentParam } = await params;
  const agent = getAgentById(agentParam);
  if (!agent) notFound();

  const db = supabaseAdmin();
  const aliases = [agent.id, ...(agent.aliases ?? [])];

  const [outputsResult, runsResult] = await Promise.all([
    db
      .from('agent_outputs')
      .select('id, output_type, approval_status, created_at, tags, run_id, draft_content')
      .in('agent_id', aliases)
      .order('created_at', { ascending: false })
      .limit(20),
    db
      .from('agent_runs')
      .select('id, started_at, completed_at, status, output_summary, duration_ms, tokens_used, cost_estimate, trigger')
      .in('agent_name', aliases)
      .order('started_at', { ascending: false })
      .limit(30),
  ]);

  const outputs = (outputsResult.data ?? []) as OutputRow[];
  const runs = (runsResult.data ?? []) as RunRow[];

  const totalRuns = runs.length;
  const successRuns = runs.filter((r) => r.status === 'success').length;
  const successRate =
    totalRuns > 0 ? Math.round((successRuns / totalRuns) * 100) : 100;
  const pendingOutputs = outputs.filter((o) => o.approval_status === 'pending').length;
  const approvedOutputs = outputs.filter(
    (o) => o.approval_status === 'approved' || o.approval_status === 'edited',
  ).length;
  const lastRun = runs[0] ?? null;
  const agentStatus = computeAgentStatus(lastRun);

  // Resolve connection targets to registry entries when possible
  const resolveConnection = (target: string): {
    href: string | null;
    label: string;
  } => {
    const entry = AGENT_REGISTRY.find(
      (a) => a.id === target || (a.aliases ?? []).includes(target),
    );
    if (entry) {
      return { href: `/agents/${entry.id}`, label: entry.name };
    }
    return { href: null, label: target };
  };

  return (
    <>
      <AgentDashNav pendingCount={pendingOutputs} agentCount={AGENT_REGISTRY.length} />

      <main style={{ padding: '32px 40px 80px', maxWidth: 1600, margin: '0 auto' }}>
        {/* Breadcrumb */}
        <nav
          className="mono"
          style={{
            fontSize: 11,
            color: 'var(--ink-3)',
            letterSpacing: '0.08em',
            marginBottom: 14,
          }}
        >
          <Link href="/agents" style={{ color: 'var(--ink-3)', textDecoration: 'none' }}>
            All Agents
          </Link>
          <span style={{ margin: '0 8px', color: 'var(--ink-4)' }}>/</span>
          <span>{agent.id}</span>
        </nav>

        {/* Hero */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr auto',
            gap: 40,
            alignItems: 'end',
            marginBottom: 28,
            paddingBottom: 28,
            borderBottom: '1px solid var(--rule-strong)',
          }}
        >
          <div>
            <p className="eyebrow">
              {agent.layer === 'meta'
                ? 'Meta Layer Agent'
                : agent.layer === 'strategy'
                  ? 'Strategy Agent'
                  : 'Execution Agent'}
              {' · '}
              {agent.venture}
            </p>
            <h1
              style={{
                fontSize: 64,
                fontWeight: 700,
                letterSpacing: '-0.04em',
                lineHeight: 1,
                margin: 0,
                color: 'var(--ink)',
              }}
            >
              {agent.name}
            </h1>
            <p
              className="mono"
              style={{
                fontSize: 12,
                color: 'var(--ink-2)',
                letterSpacing: '0.04em',
                marginTop: 14,
                lineHeight: 1.55,
                maxWidth: 720,
              }}
            >
              {agent.tagline}
            </p>
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-end',
              gap: 8,
            }}
          >
            <AgentStatusChip status={agentStatus} />
            <div
              className="mono"
              style={{
                fontSize: 10,
                color: 'var(--ink-3)',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                textAlign: 'right',
                lineHeight: 1.6,
              }}
            >
              {agent.cadence}
              <br />
              {lastRun
                ? `Last run · ${formatPtRelative(lastRun.started_at)}`
                : 'No runs yet'}
            </div>
          </div>
        </div>

        {/* Two-column body */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 320px',
            gap: 48,
          }}
        >
          <div>
            {/* Purpose */}
            <Block title="Purpose">
              <p
                style={{
                  fontSize: 15,
                  lineHeight: 1.6,
                  color: 'var(--ink)',
                  margin: 0,
                  maxWidth: 720,
                }}
              >
                {agent.purpose}
              </p>
            </Block>

            {/* Trigger controls */}
            <Block title="Trigger">
              <AgentTriggerPanel agentId={agent.id} />
            </Block>

            {/* Capabilities */}
            <Block title={`Capabilities · ${agent.capabilities.length}`}>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {agent.capabilities.map((cap) => (
                  <li
                    key={cap.outputType}
                    style={{
                      padding: '12px 0',
                      borderBottom: '1px solid var(--rule)',
                      display: 'grid',
                      gridTemplateColumns: '1fr auto',
                      gap: 12,
                      alignItems: 'start',
                    }}
                  >
                    <div>
                      <div
                        style={{
                          fontSize: 14,
                          fontWeight: 600,
                          letterSpacing: '-0.005em',
                          color: 'var(--ink)',
                        }}
                      >
                        {cap.label}
                      </div>
                      <div
                        className="mono"
                        style={{
                          fontSize: 10,
                          letterSpacing: '0.08em',
                          textTransform: 'uppercase',
                          color: 'var(--ink-3)',
                          marginTop: 2,
                        }}
                      >
                        {cap.outputType}
                      </div>
                      <p
                        style={{
                          fontSize: 12.5,
                          color: 'var(--ink-2)',
                          lineHeight: 1.55,
                          marginTop: 6,
                          marginBottom: 0,
                        }}
                      >
                        {cap.description}
                      </p>
                    </div>
                    <Link
                      href={`/outputs?agent=${encodeURIComponent(agent.id)}&type=${encodeURIComponent(cap.outputType)}`}
                      className="mono"
                      style={{
                        fontSize: 11,
                        color: 'var(--ink-2)',
                        textDecoration: 'none',
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      View outputs →
                    </Link>
                  </li>
                ))}
              </ul>
            </Block>

            {/* Recent outputs */}
            <Block
              title={`Recent outputs · ${outputs.length}`}
              rightLabel={
                <Link
                  href={`/outputs?agent=${encodeURIComponent(agent.id)}`}
                  className="mono"
                  style={{
                    fontSize: 11,
                    color: 'var(--ink-3)',
                    textDecoration: 'none',
                    letterSpacing: '0.06em',
                    textTransform: 'none',
                  }}
                >
                  View all →
                </Link>
              }
            >
              {outputs.length === 0 ? (
                <p
                  className="mono"
                  style={{ fontSize: 11, color: 'var(--ink-3)' }}
                >
                  No outputs yet — trigger a run above.
                </p>
              ) : (
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {outputs.slice(0, 10).map((o) => (
                    <li key={o.id}>
                      <Link
                        href={`/outputs/${agent.id}/${o.id}`}
                        className="dash-card"
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '100px 1fr auto',
                          gap: 16,
                          padding: '14px 8px',
                          borderBottom: '1px solid var(--rule)',
                          textDecoration: 'none',
                          color: 'inherit',
                          alignItems: 'baseline',
                        }}
                      >
                        <span
                          className="mono"
                          style={{
                            fontSize: 11,
                            color: 'var(--ink-3)',
                            letterSpacing: '0.04em',
                          }}
                        >
                          {formatPtTime(o.created_at)}
                        </span>
                        <span style={{ minWidth: 0 }}>
                          <span
                            className="mono"
                            style={{
                              fontSize: 10,
                              letterSpacing: '0.12em',
                              textTransform: 'uppercase',
                              color: 'var(--ink-3)',
                              marginRight: 8,
                            }}
                          >
                            {o.output_type.replace(/_/g, ' ')}
                          </span>
                          <span style={{ fontSize: 14, fontWeight: 500 }}>
                            {describeOutput(o.output_type, (o.draft_content ?? {}) as Record<string, unknown>)}
                          </span>
                        </span>
                        <span
                          className="mono"
                          style={{
                            fontSize: 10,
                            letterSpacing: '0.12em',
                            textTransform: 'uppercase',
                            fontWeight: 600,
                            color: statusColor(o.approval_status),
                          }}
                        >
                          {o.approval_status}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Block>

            {/* Connections */}
            <Block title="Connections">
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 32,
                }}
              >
                <div>
                  <div
                    className="mono"
                    style={{
                      fontSize: 10,
                      letterSpacing: '0.18em',
                      textTransform: 'uppercase',
                      color: 'var(--ink-2)',
                      marginBottom: 8,
                      fontWeight: 500,
                    }}
                  >
                    ← Reads from
                  </div>
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                    {agent.connections.reads_from.map((c, i) => {
                      const resolved = resolveConnection(c.target);
                      return (
                        <li
                          key={i}
                          style={{
                            padding: '8px 0',
                            borderBottom: '1px solid var(--rule)',
                          }}
                        >
                          {resolved.href ? (
                            <Link
                              href={resolved.href}
                              className="mono"
                              style={{
                                fontSize: 12,
                                fontWeight: 600,
                                color: 'var(--ink)',
                                textDecoration: 'none',
                                letterSpacing: '0.02em',
                              }}
                            >
                              {resolved.label} →
                            </Link>
                          ) : (
                            <span
                              className="mono"
                              style={{
                                fontSize: 12,
                                fontWeight: 600,
                                color: 'var(--ink-2)',
                                letterSpacing: '0.02em',
                              }}
                            >
                              {resolved.label}
                            </span>
                          )}
                          <div
                            className="mono"
                            style={{
                              fontSize: 11,
                              color: 'var(--ink-3)',
                              marginTop: 2,
                              letterSpacing: '0.04em',
                            }}
                          >
                            {c.note}
                          </div>
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
                      marginBottom: 8,
                      fontWeight: 500,
                    }}
                  >
                    Writes to →
                  </div>
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                    {agent.connections.writes_to.map((c, i) => {
                      const resolved = resolveConnection(c.target);
                      return (
                        <li
                          key={i}
                          style={{
                            padding: '8px 0',
                            borderBottom: '1px solid var(--rule)',
                          }}
                        >
                          {resolved.href ? (
                            <Link
                              href={resolved.href}
                              className="mono"
                              style={{
                                fontSize: 12,
                                fontWeight: 600,
                                color: 'var(--ink)',
                                textDecoration: 'none',
                                letterSpacing: '0.02em',
                              }}
                            >
                              {resolved.label} →
                            </Link>
                          ) : (
                            <span
                              className="mono"
                              style={{
                                fontSize: 12,
                                fontWeight: 600,
                                color: 'var(--ink-2)',
                                letterSpacing: '0.02em',
                              }}
                            >
                              {resolved.label}
                            </span>
                          )}
                          <div
                            className="mono"
                            style={{
                              fontSize: 11,
                              color: 'var(--ink-3)',
                              marginTop: 2,
                              letterSpacing: '0.04em',
                            }}
                          >
                            {c.note}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>
            </Block>
          </div>

          {/* Right rail */}
          <aside>
            <RailBlock title="Activity">
              <Kv k="runs (all time)" v={totalRuns.toString()} />
              <Kv k="success rate" v={`${successRate}%`} />
              <Kv k="pending outputs" v={pendingOutputs.toString()} />
              <Kv k="approved" v={approvedOutputs.toString()} />
            </RailBlock>

            {lastRun && (
              <RailBlock title="Last run">
                <Kv
                  k="status"
                  v={lastRun.status}
                  color={statusColor(lastRun.status)}
                />
                <Kv k="trigger" v={lastRun.trigger ?? '—'} />
                <Kv
                  k="duration"
                  v={lastRun.duration_ms ? `${Math.round(lastRun.duration_ms / 1000)}s` : '—'}
                />
                <Kv
                  k="tokens"
                  v={
                    lastRun.tokens_used != null
                      ? lastRun.tokens_used.toLocaleString()
                      : '—'
                  }
                />
                <Kv
                  k="cost"
                  v={
                    lastRun.cost_estimate != null
                      ? `$${lastRun.cost_estimate.toFixed(4)}`
                      : '—'
                  }
                />
                <Kv k="at" v={formatPtDateTime(lastRun.started_at)} />
              </RailBlock>
            )}

            <RailBlock title="Identity">
              <Kv k="agent_id" v={agent.id} />
              {agent.aliases && agent.aliases.length > 0 && (
                <Kv k="aliases" v={agent.aliases.join(', ')} />
              )}
              <Kv k="layer" v={agent.layer} />
              <Kv k="venture" v={agent.venture} />
            </RailBlock>
          </aside>
        </div>
      </main>
    </>
  );
}

// ============================================================================

function Block({
  title,
  rightLabel,
  children,
}: {
  title: string;
  rightLabel?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 40 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          borderBottom: '1px solid var(--rule)',
          paddingBottom: 8,
          marginBottom: 14,
        }}
      >
        <h2
          style={{
            fontSize: 11,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: 'var(--ink-2)',
            margin: 0,
            fontWeight: 500,
          }}
        >
          {title}
        </h2>
        {rightLabel}
      </div>
      {children}
    </div>
  );
}

function RailBlock({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        padding: '0 0 20px',
        marginBottom: 20,
        borderBottom: '1px solid var(--rule)',
      }}
    >
      <h4
        style={{
          fontSize: 10,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          margin: '0 0 12px',
          fontWeight: 500,
          color: 'var(--ink-2)',
        }}
      >
        {title}
      </h4>
      {children}
    </div>
  );
}

function Kv({ k, v, color }: { k: string; v: string; color?: string }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr auto',
        fontSize: 12,
        padding: '6px 0',
      }}
    >
      <span
        className="mono"
        style={{ color: 'var(--ink-2)', fontSize: 11, letterSpacing: '0.04em' }}
      >
        {k}
      </span>
      <span
        className="mono"
        style={{ fontWeight: 600, color: color ?? 'var(--ink)' }}
      >
        {v}
      </span>
    </div>
  );
}

function AgentStatusChip({ status }: { status: 'running' | 'idle' | 'stale' | 'blocked' }) {
  const label =
    status === 'running'
      ? 'RUNNING'
      : status === 'blocked'
        ? 'BLOCKED'
        : status === 'stale'
          ? 'STALE'
          : 'IDLE';
  const borderColor =
    status === 'running'
      ? 'var(--ok)'
      : status === 'blocked'
        ? 'var(--danger)'
        : status === 'stale'
          ? 'var(--ink-3)'
          : 'var(--ink-2)';
  return (
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
        border: `1px solid ${borderColor}`,
        color: borderColor,
        fontWeight: 600,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          background: borderColor,
          borderRadius: '50%',
          animation: status === 'running' ? 'pulse 1.4s infinite' : 'none',
        }}
      />
      {label}
    </span>
  );
}

function computeAgentStatus(
  lastRun: RunRow | null,
): 'running' | 'idle' | 'stale' | 'blocked' {
  if (!lastRun) return 'idle';
  if (lastRun.status === 'error') return 'blocked';
  const ageMs = Date.now() - new Date(lastRun.started_at).getTime();
  if (ageMs < 10 * 60 * 1000) return 'running';
  if (ageMs < 24 * 3600 * 1000) return 'idle';
  return 'stale';
}

function statusColor(status: string | null): string {
  switch (status) {
    case 'approved':
    case 'edited':
    case 'success':
      return 'var(--ok)';
    case 'rejected':
    case 'error':
      return 'var(--danger)';
    case 'pending':
      return 'var(--ink-2)';
    case 'ignored':
    case 'deferred':
      return 'var(--ink-3)';
    default:
      return 'var(--ink-2)';
  }
}

function describeOutput(type: string, c: Record<string, unknown>): string {
  const str = (k: string): string => (typeof c[k] === 'string' ? (c[k] as string) : '');
  switch (type) {
    case 'daily_briefing':
      return 'Daily briefing';
    case 'weekly_plan':
      return `Weekly plan${str('week_start') ? ` — ${str('week_start')}` : ''}`;
    case 'substack_post':
      return str('substack_title') || str('episode_title') || 'Substack post';
    case 'research_batch':
      return 'Sponsorship research batch';
    case 'press_research':
      return 'Press research batch';
    case 'artisan_research':
      return 'Artisan research batch';
    case 'funding_opportunity_scan':
      return 'Funding opportunity scan';
    case 'monthly_pulse_check':
      return 'Monthly pulse check';
    case 'weekly_supervisor_report':
      return 'Weekly supervisor report';
    case 'weekly_codebase_health_report':
      return 'Codebase health report';
    case 'analytics_report':
      return 'Analytics report';
    default:
      return type.replace(/_/g, ' ');
  }
}

export function _typeGuard(a: AgentRegistryEntry) {
  return a.id;
}
