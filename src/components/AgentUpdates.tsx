import { formatPtRelative } from '@/lib/time';

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
  approval_queue_id?: string | null;
}

interface AgentUpdatesProps {
  runs: AgentRun[];
  /** Map: run_id → { agentId, outputId } so each entry can deep-link to
   *  its dedicated output page. Absent entries render without a link. */
  outputHrefByRunId?: Record<string, { agentId: string; outputId: string }>;
}

function formatTime(iso: string): string {
  // All day/time comparisons and renders go through the PT helper so SSR
  // and client hydration agree. See lib/time.ts rationale.
  return formatPtRelative(iso);
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

export function AgentUpdates({ runs, outputHrefByRunId }: AgentUpdatesProps) {
  if (!runs.length) {
    return <p className="muted text-sm">No agent activity yet.</p>;
  }

  return (
    <ul className="space-y-3">
      {runs.map((run) => {
        const href = outputHrefByRunId?.[run.id];
        const Wrapper: React.ElementType = href ? 'a' : 'div';
        const wrapperProps = href
          ? {
              href: `/outputs/${href.agentId}/${href.outputId}`,
              className: 'flex items-start gap-3 hover:opacity-80 transition',
            }
          : { className: 'flex items-start gap-3' };
        return (
          <li key={run.id}>
            <Wrapper {...wrapperProps}>
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
                <div className="flex gap-3 mt-0.5 text-xs muted items-center">
                  {run.duration_ms != null && (
                    <span>{(run.duration_ms / 1000).toFixed(1)}s</span>
                  )}
                  {run.cost_estimate != null && (
                    <span>${run.cost_estimate.toFixed(4)}</span>
                  )}
                  {href && (
                    <span className="gold ml-auto">View output ↗</span>
                  )}
                </div>
              </div>
            </Wrapper>
          </li>
        );
      })}
    </ul>
  );
}
