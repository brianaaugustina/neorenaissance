import type { Initiative, Task } from '@/lib/notion/client';
import { TaskRow } from './TaskRow';

interface MyViewProps {
  todayIso: string;
  todaysTasks: Task[];
  overdueTasks: Task[];
  initiatives: Initiative[];
}

function groupByVenture(
  tasks: Task[],
  initiatives: Initiative[],
): Array<{ venture: string; tasks: Task[] }> {
  const groups = new Map<string, Task[]>();
  for (const t of tasks) {
    const name =
      t.initiativeIds
        .map((id) => initiatives.find((i) => i.id === id)?.name)
        .filter(Boolean)
        .join(', ') || 'Unassigned';
    const arr = groups.get(name) ?? [];
    arr.push(t);
    groups.set(name, arr);
  }
  return Array.from(groups, ([venture, tasks]) => ({ venture, tasks })).sort((a, b) =>
    a.venture.localeCompare(b.venture),
  );
}

export function MyView({ todayIso, todaysTasks, overdueTasks, initiatives }: MyViewProps) {
  const groups = groupByVenture(todaysTasks, initiatives);

  return (
    <section className="card p-6">
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="serif text-2xl">My View</h2>
        <span className="muted text-xs uppercase tracking-wider">{todayIso}</span>
      </div>

      {overdueTasks.length > 0 && (
        <div className="mb-6">
          <h3 className="serif text-sm uppercase tracking-widest mb-3" style={{ color: 'var(--danger)' }}>
            Carry-forward ({overdueTasks.length})
          </h3>
          <ul className="space-y-1">
            {overdueTasks.slice(0, 12).map((t) => (
              <TaskRow key={t.id} task={t} initiatives={initiatives} showOverdue todayIso={todayIso} />
            ))}
          </ul>
          {overdueTasks.length > 12 && (
            <p className="muted text-xs mt-2">+{overdueTasks.length - 12} more overdue</p>
          )}
        </div>
      )}

      {groups.length === 0 ? (
        <p className="muted text-sm">Nothing scheduled for today.</p>
      ) : (
        <div className="space-y-6">
          {groups.map(({ venture, tasks }) => (
            <div key={venture}>
              <h3 className="serif text-sm uppercase tracking-widest gold mb-3">{venture}</h3>
              <ul className="space-y-1">
                {tasks.map((t) => (
                  <TaskRow key={t.id} task={t} initiatives={initiatives} todayIso={todayIso} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
