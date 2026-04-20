import Link from 'next/link';
import { OpsChiefChat } from './OpsChiefChat';
import { formatPtTime } from '@/lib/time';

interface AgentRun {
  id: string;
  agent_name: string;
  started_at: string;
  completed_at: string | null;
  status: string;
  output_summary: string | null;
  trigger: string;
}

interface ChatMessageView {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

interface Props {
  agentRuns: AgentRun[];
  outputHrefByRunId?: Record<string, { agentId: string; outputId: string }>;
  chatHistory: ChatMessageView[];
}

/**
 * Right column — split between live agent stream (top, 5 most-recent runs
 * with a "View all →" CTA) and Ops Chief chat (bottom). Rows in the stream
 * have no separators per Briana's refinement pass; density is carried by
 * the bullet + mono time instead.
 */
export function DashboardRight({ agentRuns, outputHrefByRunId, chatHistory }: Props) {
  const recent = agentRuns.slice(0, 5);

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateRows: 'auto auto auto 1fr',
        minHeight: 0,
      }}
    >
      {/* Live stream header */}
      <div style={{ padding: '24px 28px 12px' }}>
        <div
          className="section-head"
          style={{ border: 'none', paddingBottom: 0, marginBottom: 0 }}
        >
          <span>Live Stream</span>
          <span className="tag">PAST 24H</span>
        </div>
      </div>

      {/* Stream items — no separators per design refinement */}
      <ul
        style={{
          listStyle: 'none',
          padding: '0 28px',
          margin: 0,
        }}
      >
        {recent.length === 0 ? (
          <li
            className="mono"
            style={{
              padding: '12px 0',
              color: 'var(--ink-3)',
              fontSize: 11,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}
          >
            No agent runs in the last 24 hours.
          </li>
        ) : (
          recent.map((run, i) => {
            const href = outputHrefByRunId?.[run.id];
            const rowStyle: React.CSSProperties = {
              display: 'grid',
              gridTemplateColumns: '10px 1fr auto',
              gap: 10,
              alignItems: 'baseline',
              padding: '10px 0',
              textDecoration: 'none',
              color: 'inherit',
              opacity: i >= 2 ? 0.7 : 1,
            };
            const content = (
              <>
                <span
                  style={{
                    width: 6,
                    height: 6,
                    background: i >= 2 ? 'var(--ink-3)' : 'var(--ink)',
                    display: 'inline-block',
                    marginTop: 6,
                  }}
                />
                <span style={{ fontSize: 12.5, lineHeight: 1.35 }}>
                  <span
                    className="mono"
                    style={{
                      fontSize: 10,
                      letterSpacing: '0.12em',
                      textTransform: 'uppercase',
                      marginRight: 6,
                      fontWeight: 600,
                    }}
                  >
                    {run.agent_name}
                  </span>
                  <span style={{ color: 'var(--ink-2)' }}>
                    {run.output_summary ??
                      (run.status === 'error' ? 'run failed' : `${run.trigger} run`)}
                  </span>
                </span>
                <span
                  className="mono"
                  style={{ fontSize: 11, color: 'var(--ink-2)' }}
                >
                  {formatPtTime(run.started_at)}
                </span>
              </>
            );
            return href ? (
              <li key={run.id}>
                <Link href={`/outputs/${href.agentId}/${href.outputId}`} style={rowStyle}>
                  {content}
                </Link>
              </li>
            ) : (
              <li key={run.id} style={rowStyle}>
                {content}
              </li>
            );
          })
        )}
      </ul>

      {/* View all CTA */}
      <div style={{ padding: '16px 28px 24px' }}>
        <Link
          href="/outputs"
          className="btn ghost"
          style={{ display: 'block', textAlign: 'center', width: '100%' }}
        >
          View all →
        </Link>
      </div>

      {/* Chat docked at the bottom */}
      <div
        style={{
          borderTop: '1px solid var(--rule-strong)',
          display: 'grid',
          gridTemplateRows: 'auto 1fr',
          minHeight: 340,
        }}
      >
        <div
          style={{
            padding: '14px 28px 8px',
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 10,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: 'var(--ink-2)',
            fontWeight: 500,
          }}
        >
          <span>Ops Chief · Direct Line</span>
          <span
            className="mono"
            style={{
              fontSize: 10,
              letterSpacing: '0.05em',
              textTransform: 'none',
              color: 'var(--ink-3)',
            }}
          >
            {chatHistory.length} msgs today
          </span>
        </div>
        <div
          style={{
            padding: '0 28px 24px',
            display: 'flex',
            flexDirection: 'column',
            minHeight: 300,
          }}
        >
          <OpsChiefChat initialHistory={chatHistory} />
        </div>
      </div>
    </div>
  );
}
