import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AgentDashNav } from '@/components/AgentDashNav';
import { LandscapeBody } from '@/components/LandscapeBody';
import { OutputDetailActions } from '@/components/OutputDetailActions';
import { supabaseAdmin } from '@/lib/supabase/client';
import { formatPtDateTime, formatPtTime } from '@/lib/time';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface OutputRow {
  id: string;
  agent_id: string;
  venture: string;
  output_type: string;
  approval_status: string;
  approval_queue_id: string | null;
  run_id: string | null;
  parent_output_id: string | null;
  tags: string[] | null;
  created_at: string;
  approved_at: string | null;
  rejection_reason: string | null;
  draft_content: Record<string, unknown> | null;
  final_content: Record<string, unknown> | null;
}

interface AgentRunRow {
  id: string;
  agent_name: string;
  started_at: string;
  completed_at: string | null;
  status: string;
  model: string | null;
  tokens_used: number | null;
  duration_ms: number | null;
  cost_estimate: number | null;
  trigger: string | null;
  output_summary: string | null;
  error: string | null;
}

const RICH_UI_AGENTS = new Set([
  'funding-scout',
  'growth-strategist',
  'agent-supervisor',
  'system-engineer',
]);

const RICH_UI_OUTPUT_TYPES = new Set([
  'funding_opportunity_scan',
  'monthly_pulse_check',
  'quarterly_growth_review',
  'channel_recommendation',
  'audience_analysis',
  'cross_venture_synergy',
  'weekly_supervisor_report',
  'agent_deep_dive',
  'weekly_codebase_health_report',
  'research_batch',
  'press_research',
  'artisan_research',
]);

export default async function OutputDetailPage({
  params,
}: {
  params: Promise<{ agent: string; outputId: string }>;
}) {
  const { agent, outputId } = await params;
  const db = supabaseAdmin();

  const { data: row, error } = await db
    .from('agent_outputs')
    .select('*')
    .eq('id', outputId)
    .single();
  if (error || !row) notFound();
  const output = row as OutputRow;

  if (output.agent_id !== agent) notFound();

  const content = (output.final_content ?? output.draft_content ?? {}) as Record<string, unknown>;

  // Parent queue item (for action buttons + routing)
  let queueItem: {
    id: string;
    status: string | null;
    agent_name: string | null;
    type: string | null;
  } | null = null;
  if (output.approval_queue_id) {
    const { data } = await db
      .from('approval_queue')
      .select('id, status, agent_name, type')
      .eq('id', output.approval_queue_id)
      .single();
    if (data) {
      queueItem = data as {
        id: string;
        status: string | null;
        agent_name: string | null;
        type: string | null;
      };
    }
  }

  // Agent run for the right-rail "Run details" block
  let run: AgentRunRow | null = null;
  if (output.run_id) {
    const { data } = await db
      .from('agent_runs')
      .select('*')
      .eq('id', output.run_id)
      .single();
    if (data) run = data as AgentRunRow;
  }

  // Children (for Showrunner parent → captions/metadata)
  const { data: childrenRaw } = await db
    .from('agent_outputs')
    .select('id, agent_id, output_type, approval_status, created_at, tags')
    .eq('parent_output_id', outputId)
    .order('created_at', { ascending: true });
  const children = (childrenRaw ?? []) as Array<
    Pick<OutputRow, 'id' | 'agent_id' | 'output_type' | 'approval_status' | 'created_at' | 'tags'>
  >;

  // Related outputs — recent outputs from the same agent excluding self
  const { data: relatedRaw } = await db
    .from('agent_outputs')
    .select('id, output_type, created_at')
    .eq('agent_id', output.agent_id)
    .neq('id', outputId)
    .order('created_at', { ascending: false })
    .limit(6);
  const related = (relatedRaw ?? []) as Array<
    Pick<OutputRow, 'id' | 'output_type' | 'created_at'>
  >;

  const title = describeOutput(output.output_type, content);
  const statusMeta = buildStatusMeta(output, queueItem);
  const hasRichUi =
    RICH_UI_AGENTS.has(output.agent_id) || RICH_UI_OUTPUT_TYPES.has(output.output_type);
  const isActionable = queueItem?.status === 'pending' || queueItem?.status === 'approved';

  return (
    <>
      <AgentDashNav />

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
          <Link href="/outputs" style={{ color: 'var(--ink-3)', textDecoration: 'none' }}>
            All Outputs
          </Link>
          <span style={{ margin: '0 8px', color: 'var(--ink-4)' }}>/</span>
          <Link
            href={`/outputs?agent=${encodeURIComponent(output.agent_id)}`}
            style={{ color: 'var(--ink-3)', textDecoration: 'none' }}
          >
            {output.agent_id}
          </Link>
          <span style={{ margin: '0 8px', color: 'var(--ink-4)' }}>/</span>
          <span className="mono">{output.id.slice(0, 8)}</span>
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
            <p className="eyebrow">Single Output · {statusMeta.eyebrow}</p>
            <h1
              style={{
                fontSize: 52,
                fontWeight: 700,
                letterSpacing: '-0.035em',
                lineHeight: 1,
                margin: 0,
                color: 'var(--ink)',
              }}
            >
              {title}
            </h1>
            <div
              className="mono"
              style={{
                fontSize: 11,
                color: 'var(--ink-2)',
                letterSpacing: '0.06em',
                marginTop: 14,
                display: 'flex',
                gap: 20,
                flexWrap: 'wrap',
              }}
            >
              <span>
                AGENT <b style={{ color: 'var(--ink)', fontWeight: 600 }}>{output.agent_id}</b>
              </span>
              <span style={{ color: 'var(--ink-4)' }}>·</span>
              <span>
                OUTPUT <b style={{ color: 'var(--ink)', fontWeight: 600 }}>{output.id.slice(0, 8)}</b>
              </span>
              <span style={{ color: 'var(--ink-4)' }}>·</span>
              <span>
                EMITTED{' '}
                <b style={{ color: 'var(--ink)', fontWeight: 600 }}>
                  {formatPtTime(output.created_at)}
                </b>
              </span>
              {run?.duration_ms != null && (
                <>
                  <span style={{ color: 'var(--ink-4)' }}>·</span>
                  <span>
                    LATENCY{' '}
                    <b style={{ color: 'var(--ink)', fontWeight: 600 }}>
                      {formatDuration(run.duration_ms)}
                    </b>
                  </span>
                </>
              )}
            </div>
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-end',
              gap: 8,
            }}
          >
            <span className={`chip ${statusMeta.pulse ? 'dot' : ''}`} style={statusMeta.chipStyle}>
              {statusMeta.chipLabel}
            </span>
            <div
              className="mono"
              style={{
                fontSize: 10,
                color: 'var(--ink-3)',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
              }}
            >
              {output.venture} · {output.output_type.replace(/_/g, ' ')}
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
            {/* Gateway panel */}
            {queueItem ? (
              <Gateway
                queueItemId={queueItem.id}
                queueStatus={queueItem.status}
                outputAgent={output.agent_id}
                outputType={output.output_type}
                hasRichUi={hasRichUi}
              />
            ) : output.approval_status === 'pending' ? (
              <div
                className="mono"
                style={{
                  border: '1px dashed var(--rule-strong)',
                  padding: '16px 20px',
                  margin: '8px 0 36px',
                  fontSize: 11,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  color: 'var(--ink-3)',
                  textAlign: 'center',
                }}
              >
                No gateway linked · this is a child output
              </div>
            ) : (
              <div
                className="mono"
                style={{
                  border: '1px dashed var(--rule-strong)',
                  padding: '16px 20px',
                  margin: '8px 0 36px',
                  fontSize: 11,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  color: 'var(--ink-3)',
                  textAlign: 'center',
                }}
              >
                No gateway required · {output.approval_status} · archived
              </div>
            )}

            {/* Body */}
            <Block title="Body">
              <OutputContent outputType={output.output_type} content={content} />
            </Block>

            {/* Tags */}
            {output.tags && output.tags.length > 0 && (
              <Block title="Tags">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {output.tags.map((tag) => (
                    <span
                      key={tag}
                      className="mono"
                      style={{
                        fontSize: 10,
                        letterSpacing: '0.08em',
                        padding: '3px 8px',
                        border: '1px solid var(--rule)',
                        color: 'var(--ink-2)',
                      }}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </Block>
            )}

            {/* Children */}
            {children.length > 0 && (
              <Block title={`Child outputs · ${children.length}`}>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {children.map((c) => (
                    <li
                      key={c.id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'baseline',
                        padding: '8px 0',
                        borderBottom: '1px solid var(--rule)',
                      }}
                    >
                      <span
                        className="mono"
                        style={{
                          fontSize: 11,
                          letterSpacing: '0.08em',
                          textTransform: 'uppercase',
                          color: 'var(--ink-2)',
                        }}
                      >
                        {c.output_type.replace(/_/g, ' ')}
                        <span style={{ marginLeft: 8, color: statusColor(c.approval_status) }}>
                          {c.approval_status}
                        </span>
                      </span>
                      <Link
                        href={`/outputs/${c.agent_id}/${c.id}`}
                        style={{
                          fontSize: 11,
                          color: 'var(--ink-2)',
                          textDecoration: 'none',
                          letterSpacing: '0.08em',
                        }}
                      >
                        View →
                      </Link>
                    </li>
                  ))}
                </ul>
              </Block>
            )}

            {/* Raw JSON */}
            <Block title="Raw output">
              <pre
                className="mono"
                style={{
                  fontSize: 11,
                  color: 'var(--ink)',
                  lineHeight: 1.7,
                  background: 'var(--bg-2)',
                  padding: '18px 20px',
                  borderLeft: '2px solid var(--ink)',
                  whiteSpace: 'pre-wrap',
                  maxHeight: 420,
                  overflow: 'auto',
                }}
              >
                {JSON.stringify(content, null, 2)}
              </pre>
            </Block>
          </div>

          {/* Right rail */}
          <aside>
            <RailBlock title="Output status">
              <Kv k="status" v={output.approval_status} color={statusColor(output.approval_status)} />
              <Kv k="created" v={formatPtDateTime(output.created_at)} />
              {output.approved_at && <Kv k="approved" v={formatPtDateTime(output.approved_at)} />}
              {queueItem?.status && <Kv k="queue" v={queueItem.status} />}
            </RailBlock>

            {run && (
              <RailBlock title="Run details">
                <Kv k="trigger" v={run.trigger ?? '—'} />
                <Kv k="model" v={run.model ?? '—'} />
                <Kv
                  k="tokens"
                  v={run.tokens_used != null ? run.tokens_used.toLocaleString() : '—'}
                />
                <Kv
                  k="cost"
                  v={run.cost_estimate != null ? `$${run.cost_estimate.toFixed(4)}` : '—'}
                />
                <Kv k="duration" v={formatDuration(run.duration_ms)} />
                <Kv k="run status" v={run.status} color={statusColor(run.status)} />
                {run.error && (
                  <div
                    className="mono"
                    style={{
                      fontSize: 10,
                      color: 'var(--danger)',
                      marginTop: 8,
                      lineHeight: 1.5,
                    }}
                  >
                    {run.error.slice(0, 200)}
                  </div>
                )}
              </RailBlock>
            )}

            <RailBlock title="Chain">
              <Kv
                k="parent"
                v={
                  output.parent_output_id ? (
                    <Link
                      href={`/outputs/${output.agent_id}/${output.parent_output_id}`}
                      style={{ color: 'var(--ink)', textDecoration: 'none' }}
                    >
                      {output.parent_output_id.slice(0, 8)}
                    </Link>
                  ) : (
                    '—'
                  )
                }
              />
              <Kv k="children" v={children.length.toString()} />
              <Kv k="run" v={output.run_id ? output.run_id.slice(0, 8) : '—'} />
            </RailBlock>

            {related.length > 0 && (
              <RailBlock title="Related">
                {related.map((r) => (
                  <Link
                    key={r.id}
                    href={`/outputs/${output.agent_id}/${r.id}`}
                    className="mono"
                    style={{
                      display: 'block',
                      fontSize: 10,
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      color: 'var(--ink-2)',
                      textDecoration: 'none',
                      padding: '4px 0',
                    }}
                  >
                    {r.id.slice(0, 8)} · {r.output_type.replace(/_/g, ' ')} ·{' '}
                    {formatPtTime(r.created_at)}
                  </Link>
                ))}
              </RailBlock>
            )}
          </aside>
        </div>

        {/* Footnote */}
        {isActionable && hasRichUi && (
          <p
            className="mono"
            style={{
              marginTop: 40,
              padding: '12px 16px',
              border: '1px solid var(--rule)',
              background: 'var(--bg-2)',
              fontSize: 11,
              color: 'var(--ink-2)',
              letterSpacing: '0.04em',
              lineHeight: 1.6,
            }}
          >
            This {output.output_type.replace(/_/g, ' ')} has per-sub-item actions
            (approve individual opportunities, route recommendations, promote
            preferences, act on findings). The{' '}
            <Link href={`/queue/${queueItem?.id}/review`} style={{ color: 'var(--ink)' }}>
              queue review surface
            </Link>{' '}
            renders the rich per-child UI; this page is the read view + chain
            context.
          </p>
        )}
      </main>
    </>
  );
}

// ============================================================================

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 36 }}>
      <h2
        style={{
          fontSize: 11,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: 'var(--ink-2)',
          margin: '0 0 14px',
          fontWeight: 500,
          paddingBottom: 8,
          borderBottom: '1px solid var(--rule)',
        }}
      >
        {title}
      </h2>
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

function Kv({ k, v, color }: { k: string; v: React.ReactNode; color?: string }) {
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
        style={{
          color: 'var(--ink-2)',
          fontSize: 11,
          letterSpacing: '0.04em',
        }}
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

function Gateway({
  queueItemId,
  queueStatus,
  outputAgent,
  outputType,
  hasRichUi,
}: {
  queueItemId: string;
  queueStatus: string | null;
  outputAgent: string;
  outputType: string;
  hasRichUi: boolean;
}) {
  void outputAgent;
  void outputType;
  if (queueStatus === 'superseded' || queueStatus === 'rejected' || queueStatus === 'ignored' || queueStatus === 'deferred') {
    return (
      <div
        className="mono"
        style={{
          border: '1px dashed var(--rule-strong)',
          padding: '16px 20px',
          margin: '8px 0 36px',
          fontSize: 11,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: 'var(--ink-3)',
          textAlign: 'center',
        }}
      >
        Gateway closed · {queueStatus}
      </div>
    );
  }

  const pending = queueStatus === 'pending';
  const approved = queueStatus === 'approved' || queueStatus === 'executed';

  return (
    <div
      style={{
        border: '1px solid var(--ink)',
        padding: '24px 28px',
        margin: '8px 0 36px',
        position: 'relative',
        background: 'var(--bg)',
      }}
    >
      <span
        className="mono"
        style={{
          position: 'absolute',
          top: -8,
          left: 20,
          background: 'var(--bg)',
          padding: '0 8px',
          fontSize: 10,
          letterSpacing: '0.2em',
          fontWeight: 700,
        }}
      >
        HUMAN GATEWAY
      </span>
      <h3
        style={{
          fontSize: 22,
          fontWeight: 600,
          letterSpacing: '-0.02em',
          margin: '4px 0 8px',
        }}
      >
        {pending
          ? 'Operator action required'
          : approved
            ? 'Approved — commit or execute downstream'
            : `Gateway status: ${queueStatus ?? 'unknown'}`}
      </h3>
      <p
        className="mono"
        style={{
          fontSize: 12,
          color: 'var(--ink-2)',
          lineHeight: 1.55,
          margin: '0 0 16px',
        }}
      >
        {pending
          ? hasRichUi
            ? 'This is a multi-sub-item briefing. Approve / Reject / Dismiss / Update acts on the whole package; per-child decisions (per-opportunity, per-recommendation, per-finding) live on the queue review surface.'
            : 'Approve to release downstream. Reject or Dismiss to remove from the queue. Update to re-run with feedback.'
          : approved
            ? 'Already approved. Downstream actions (execute plan, schedule clips, apply diffs) happen on the queue or agent page.'
            : 'This item is in a non-actionable state.'}
      </p>
      <OutputDetailActions queueItemId={queueItemId} queueStatus={queueStatus} />
    </div>
  );
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
    case 'episode_metadata':
      return str('youtube_title') || str('spotify_title') || 'Episode metadata';
    case 'social_caption':
      return `Clip caption${c.clip_index ? ` ${c.clip_index}` : ''}`;
    case 'calendar_entry':
      return `Calendar entry${c.kind ? ` (${String(c.kind)})` : ''}`;
    case 'pipeline_check':
      return 'Pipeline check';
    case 'pitch_email':
      return `Sponsorship pitch — ${str('brand_name') || 'brand'}`;
    case 'press_pitch_founder_first':
    case 'press_pitch_show_first':
    case 'press_pitch_hybrid':
      return `Press pitch — ${str('outlet') || 'outlet'}`;
    case 'research_batch':
      return 'Sponsorship research batch';
    case 'press_research':
      return 'Press research batch';
    case 'editorial_landscape_briefing':
      return `Landscape briefing — ${str('month_label') || 'month'}`;
    case 'funding_opportunity_scan':
      return 'Funding opportunity scan';
    case 'monthly_pulse_check':
      return 'Monthly pulse check';
    case 'weekly_supervisor_report':
      return 'Weekly supervisor report';
    case 'weekly_codebase_health_report':
      return 'Codebase health report';
    case 'analytics_report':
      return 'Monthly analytics report';
    default:
      return type.replace(/_/g, ' ');
  }
}

function buildStatusMeta(
  output: OutputRow,
  queueItem: { status: string | null } | null,
): {
  eyebrow: string;
  chipLabel: string;
  chipStyle: React.CSSProperties;
  pulse: boolean;
} {
  if (output.approval_status === 'rejected') {
    return {
      eyebrow: 'Rejected',
      chipLabel: 'REJECTED',
      chipStyle: { borderColor: 'var(--danger)', color: 'var(--danger)' },
      pulse: false,
    };
  }
  if (queueItem?.status === 'approved' || output.approval_status === 'approved') {
    return {
      eyebrow: 'Complete · Awaiting downstream',
      chipLabel: 'APPROVED',
      chipStyle: { borderColor: 'var(--ok)', color: 'var(--ok)' },
      pulse: false,
    };
  }
  if (queueItem?.status === 'pending' || output.approval_status === 'pending') {
    return {
      eyebrow: 'Awaiting Operator',
      chipLabel: 'AWAITING GATEWAY',
      chipStyle: { borderColor: 'var(--ink)', color: 'var(--ink)' },
      pulse: true,
    };
  }
  return {
    eyebrow: output.approval_status,
    chipLabel: output.approval_status.toUpperCase(),
    chipStyle: { borderColor: 'var(--rule)', color: 'var(--ink-2)' },
    pulse: false,
  };
}

function statusColor(status: string | null): string {
  switch (status) {
    case 'approved':
    case 'edited':
      return 'var(--ok)';
    case 'rejected':
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

function formatDuration(ms: number | null | undefined): string {
  if (!ms || ms < 0) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m${Math.floor((ms % 60_000) / 1000)
    .toString()
    .padStart(2, '0')}s`;
}

function OutputContent({
  outputType,
  content,
}: {
  outputType: string;
  content: Record<string, unknown>;
}) {
  if (outputType === 'daily_briefing' || outputType === 'editorial_landscape_briefing') {
    const html =
      typeof content.briefing_html === 'string'
        ? (content.briefing_html as string)
        : typeof content.html === 'string'
          ? (content.html as string)
          : undefined;
    const markdown =
      typeof content.briefing_markdown === 'string'
        ? (content.briefing_markdown as string)
        : typeof content.markdown === 'string'
          ? (content.markdown as string)
          : undefined;
    if (html || markdown) {
      return <LandscapeBody html={html} markdown={markdown} />;
    }
  }

  const entries = Object.entries(content).filter(([k]) => {
    return ![
      'raw_output',
      'inputs',
      'superseded_by_queue_id',
      'notion_entries_created',
      'notion_entry_ids',
      'superseded_feedback',
    ].includes(k);
  });
  if (entries.length === 0) {
    return (
      <p
        className="mono"
        style={{
          fontSize: 11,
          color: 'var(--ink-3)',
          letterSpacing: '0.04em',
        }}
      >
        (no content body)
      </p>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {entries.map(([key, value]) => (
        <div key={key}>
          <div
            className="mono"
            style={{
              fontSize: 10,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: 'var(--ink-2)',
              marginBottom: 4,
              fontWeight: 500,
            }}
          >
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
    return (
      <p
        className="mono"
        style={{ fontSize: 11, color: 'var(--ink-3)' }}
      >
        (empty)
      </p>
    );
  }
  if (typeof value === 'string') {
    return (
      <pre
        style={{
          whiteSpace: 'pre-wrap',
          fontSize: 14,
          lineHeight: 1.55,
          margin: 0,
          color: 'var(--ink)',
          fontFamily: 'inherit',
        }}
      >
        {value}
      </pre>
    );
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return (
      <p
        className="mono"
        style={{ fontSize: 13, margin: 0 }}
      >
        {String(value)}
      </p>
    );
  }
  return (
    <pre
      className="mono"
      style={{
        fontSize: 11,
        color: 'var(--ink-2)',
        whiteSpace: 'pre-wrap',
        margin: 0,
        lineHeight: 1.6,
        maxHeight: 360,
        overflow: 'auto',
        background: 'var(--bg-2)',
        padding: 12,
      }}
    >
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}
