interface AgentRun {
  id: string;
  agent_name: string;
  trigger: string;
  started_at: string;
  completed_at: string | null;
  status: string;
  duration_ms: number | null;
  output_summary: string | null;
  cost_estimate: number | null;
}

interface AgentUpdatesProps {
  runs: AgentRun[];
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();

  const time = d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });

  if (isToday) return time;
  if (isYesterday) return `Yesterday, ${time}`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + `, ${time}`;
}

function statusColor(status: string): string {
  switch (status) {
    case 'success':
      return 'var(--ok)';
    case 'error':
      return 'var(--danger)';
    case 'running':
      return 'var(--gold)';
    default:
      return 'var(--muted)';
  }
}

function triggerLabel(trigger: string): string {
  switch (trigger) {
    case 'cron':
      return 'scheduled';
    case 'manual':
      return 'manual';
    case 'chat':
      return 'chat';
    default:
      return trigger;
  }
}

export function AgentUpdates({ runs }: AgentUpdatesProps) {
  if (!runs.length) {
    return <p className="muted text-sm">No agent activity yet.</p>;
  }

  return (
    <ul className="space-y-3">
      {runs.map((run) => (
        <li key={run.id} className="flex items-start gap-3">
          <span
            className="mt-1.5 block h-2 w-2 rounded-full flex-shrink-0"
            style={{ backgroundColor: statusColor(run.status) }}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="gold text-sm font-medium">
                {run.agent_name.replace(/_/g, ' ')}
              </span>
              <span className="muted text-xs">{triggerLabel(run.trigger)}</span>
              <span className="muted text-xs ml-auto flex-shrink-0">
                {formatTime(run.started_at)}
              </span>
            </div>
            {run.output_summary && (
              <p className="muted text-xs mt-0.5 line-clamp-1">
                {run.output_summary}
              </p>
            )}
            {(run.duration_ms != null || run.cost_estimate != null) && (
              <div className="flex gap-3 mt-0.5 text-xs muted">
                {run.duration_ms != null && (
                  <span>{(run.duration_ms / 1000).toFixed(1)}s</span>
                )}
                {run.cost_estimate != null && (
                  <span>${run.cost_estimate.toFixed(4)}</span>
                )}
              </div>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
