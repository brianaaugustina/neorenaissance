import { AgentUpdates } from './AgentUpdates';
import { QueueCard } from './QueueCard';
import { ShowrunnerInput } from './ShowrunnerInput';

interface AgentHQProps {
  pending: any[];
  completedToday: any[];
  agentRuns: any[];
}

export function AgentHQ({ pending, completedToday, agentRuns }: AgentHQProps) {
  return (
    <section className="card p-6 space-y-8">
      <div className="flex items-baseline justify-between">
        <h2 className="serif text-2xl">Agent HQ</h2>
        <div className="text-xs muted flex gap-4">
          <span>
            <span className="gold">{pending.length}</span> pending
          </span>
          <span>
            <span style={{ color: 'var(--ok)' }}>{completedToday.length}</span> done today
          </span>
        </div>
      </div>

      {/* ---- Agent Updates ---- */}
      <div>
        <h3 className="serif text-sm uppercase tracking-widest muted mb-3">
          Agent Updates
        </h3>
        <AgentUpdates runs={agentRuns} />
      </div>

      {/* ---- Showrunner ---- */}
      <hr style={{ borderColor: 'var(--border)' }} />
      <div>
        <h3 className="serif text-sm uppercase tracking-widest muted mb-3">
          Run Showrunner
        </h3>
        <ShowrunnerInput />
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
