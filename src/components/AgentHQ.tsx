import Link from 'next/link';
import { AgentUpdates } from './AgentUpdates';
import { QueueCard } from './QueueCard';

interface AgentHQProps {
  pending: any[];
  completedToday: any[];
  agentRuns: any[];
  outputHrefByRunId?: Record<string, { agentId: string; outputId: string }>;
}

export function AgentHQ({ pending, completedToday, agentRuns, outputHrefByRunId }: AgentHQProps) {
  return (
    <section className="card p-6 space-y-8">
      <div className="flex items-baseline justify-between">
        <h2 className="serif text-2xl">Agent HQ</h2>
        <div className="text-xs muted flex gap-4 items-baseline">
          <span>
            <span className="gold">{pending.length}</span> pending
          </span>
          <span>
            <span style={{ color: 'var(--ok)' }}>{completedToday.length}</span> done today
          </span>
          <Link href="/agents" className="gold hover:underline">
            Run an agent →
          </Link>
        </div>
      </div>

      {/* ---- Agent Updates ---- */}
      <div>
        <div className="flex items-baseline justify-between mb-3">
          <h3 className="serif text-sm uppercase tracking-widest muted">
            Agent Updates <span className="muted" style={{ opacity: 0.6 }}>· past 24h</span>
          </h3>
          <Link
            href="/agent-updates"
            className="text-xs gold hover:underline"
          >
            View all →
          </Link>
        </div>
        <AgentUpdates runs={agentRuns} outputHrefByRunId={outputHrefByRunId} />
      </div>

      {/* ---- Divider ---- */}
      <hr style={{ borderColor: 'var(--border)' }} />

      {/* ---- Agent Queue ---- */}
      <div>
        <h3 className="serif text-sm uppercase tracking-widest muted mb-3">
          Agent Queue
        </h3>

        {pending.length === 0 ? (
          <p className="muted text-sm mb-4">Nothing awaiting review.</p>
        ) : (
          <div className="space-y-4 mb-4">
            {pending.map((item) => (
              <QueueCard key={item.id} item={item} />
            ))}
          </div>
        )}

        {completedToday.length > 0 && (
          <div>
            <h4 className="serif text-xs uppercase tracking-widest muted mb-2">
              Completed today
            </h4>
            <ul className="space-y-2 text-sm">
              {completedToday.map((item) => (
                <li key={item.id} className="flex items-start gap-2">
                  <span style={{ color: 'var(--ok)' }}>✓</span>
                  <span className="flex-1">
                    <span className="gold">{item.agent_name}</span> · {item.title}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
