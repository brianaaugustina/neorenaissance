import { QueueCard } from './QueueCard';

interface AgentHQProps {
  pending: any[];
  completedToday: any[];
}

export function AgentHQ({ pending, completedToday }: AgentHQProps) {
  return (
    <section className="card p-6">
      <div className="flex items-baseline justify-between mb-4">
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

      {pending.length === 0 ? (
        <p className="muted text-sm mb-6">Nothing awaiting review.</p>
      ) : (
        <div className="space-y-4 mb-6">
          {pending.map((item) => (
            <QueueCard key={item.id} item={item} />
          ))}
        </div>
      )}

      {completedToday.length > 0 && (
        <div>
          <h3 className="serif text-sm uppercase tracking-widest muted mb-3">Completed today</h3>
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
    </section>
  );
}
