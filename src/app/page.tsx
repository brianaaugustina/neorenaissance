import { AgentDashNav } from '@/components/AgentDashNav';
import { DashboardLeft } from '@/components/DashboardLeft';
import { DashboardQueueColumn } from '@/components/DashboardQueueColumn';
import { DashboardRight } from '@/components/DashboardRight';
import { loadDashboardData } from '@/lib/dashboard/load';
import { formatPtLongDate } from '@/lib/time';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function Home() {
  const data = await loadDashboardData();
  const errorEntries = Object.entries(data.errors);
  const totalPending = data.pendingQueue.length;
  const agentCount = 9; // TTS + Corral + Detto + cross-venture agents currently live

  return (
    <>
      <AgentDashNav pendingCount={totalPending} agentCount={agentCount} />

      <div
        style={{
          display: 'grid',
          gridTemplateRows: 'auto 1fr',
          minHeight: 'calc(100vh - 60px)',
        }}
      >
        {/* Header */}
        <header
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr auto',
            alignItems: 'end',
            padding: '36px 40px 28px',
            gap: 40,
          }}
        >
          <div>
            <p className="eyebrow">
              Operator Dashboard · {formatPtLongDate(new Date())}
            </p>
            <h1
              className="title"
              style={{ fontSize: 96, lineHeight: 0.88, letterSpacing: '-0.045em' }}
            >
              AGENT.OS
              <span
                className="count"
                style={{ verticalAlign: 'super', marginLeft: 10 }}
              >
                ({totalPending})
              </span>
            </h1>
          </div>
          <div
            className="mono"
            style={{
              textAlign: 'right',
              fontSize: 11,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: 'var(--ink-2)',
              lineHeight: 1.7,
            }}
          >
            <span
              style={{
                display: 'block',
                fontSize: 44,
                fontWeight: 700,
                letterSpacing: '-0.02em',
                color: 'var(--ink)',
                lineHeight: 1,
                marginBottom: 8,
                textTransform: 'none',
                fontFamily: 'var(--font-sans), "Inter", sans-serif',
              }}
            >
              <small
                style={{
                  fontSize: 11,
                  letterSpacing: '0.14em',
                  color: 'var(--ink-2)',
                  fontWeight: 500,
                  verticalAlign: 'top',
                  marginRight: 2,
                }}
              >
                №
              </small>
              {String(totalPending).padStart(3, '0')}
            </span>
            <span className="chip dot">LIVE</span>
            <br />
            {agentCount} AGENTS · {data.completedToday.length} DONE TODAY
          </div>
        </header>

        {/* Error banner, if any data fetches failed */}
        {errorEntries.length > 0 && (
          <div
            style={{
              margin: '0 40px 12px',
              padding: '10px 14px',
              border: '1px solid var(--danger)',
              fontSize: 12,
              fontFamily: 'var(--font-mono)',
              color: 'var(--ink)',
            }}
          >
            <div
              className="uc"
              style={{ color: 'var(--danger)', marginBottom: 6 }}
            >
              Data fetch issues
            </div>
            <ul style={{ margin: 0, paddingLeft: 16 }}>
              {errorEntries.map(([k, v]) => (
                <li key={k} style={{ fontSize: 11, color: 'var(--ink-2)' }}>
                  {k}: {v}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Three-column frame — each column is height-capped so the center
            column can scroll internally (with the sticky "View full queue"
            CTA pinned at its bottom) without the whole page scrolling. */}
        <div
          data-dashboard-grid
          style={{
            display: 'grid',
            gridTemplateColumns: '300px 1fr 360px',
            borderTop: '1px solid var(--rule-strong)',
            height: 'calc(100vh - 260px)',
            minHeight: 600,
          }}
        >
          <div
            style={{
              borderRight: '1px solid var(--rule-strong)',
              overflow: 'auto',
              minHeight: 0,
            }}
          >
            <DashboardLeft
              todayIso={data.todayIso}
              todaysTasks={data.todaysTasks}
              overdueTasks={data.overdueTasks}
              weekTasks={data.weekTasks}
              initiatives={data.initiatives}
            />
          </div>
          <div
            style={{
              borderRight: '1px solid var(--rule-strong)',
              overflow: 'hidden',
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <DashboardQueueColumn
              pending={data.pendingQueue}
              approvedWithDownstream={data.pendingQueue.filter(
                (i: { status?: string; type?: string }) =>
                  i.status === 'approved' || i.type === 'recommendation',
              )}
              limit={6}
            />
          </div>
          <div style={{ overflow: 'auto', minHeight: 0 }}>
            <DashboardRight
              agentRuns={data.agentRuns}
              outputHrefByRunId={data.outputHrefByRunId}
              chatHistory={data.chatHistory}
            />
          </div>
        </div>
      </div>
    </>
  );
}
