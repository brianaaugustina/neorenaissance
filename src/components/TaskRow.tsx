'use client';

import { useState, useTransition } from 'react';
import type { Initiative, Task } from '@/lib/notion/client';

interface TaskRowProps {
  task: Task;
  initiatives: Initiative[];
  showOverdue?: boolean;
  todayIso: string;
}

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round(
    (new Date(toIso).getTime() - new Date(fromIso).getTime()) / 864e5,
  );
}

export function TaskRow({ task, showOverdue, todayIso }: TaskRowProps) {
  const [isPending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [newDate, setNewDate] = useState(todayIso);
  const [error, setError] = useState<string | null>(null);

  const markDone = () => {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/tasks/${task.id}/done`, { method: 'POST' });
        if (!res.ok) throw new Error((await res.json()).error || 'Failed');
        setDone(true);
      } catch (e: any) {
        setError(e.message);
      }
    });
  };

  const reschedule = () => {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/tasks/${task.id}/reschedule`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ toDoDate: newDate }),
        });
        if (!res.ok) throw new Error((await res.json()).error || 'Failed');
        setRescheduleOpen(false);
        setDone(true); // hide from list after reschedule
      } catch (e: any) {
        setError(e.message);
      }
    });
  };

  if (done) return null;

  const overdueDays =
    showOverdue && task.toDoDate ? daysBetween(task.toDoDate, todayIso) : 0;

  return (
    <li className="group flex items-start gap-3 py-1.5 text-sm">
      <button
        onClick={markDone}
        disabled={isPending}
        aria-label="Mark done"
        className="mt-0.5 w-4 h-4 rounded border hover:bg-white/5 transition disabled:opacity-40 cursor-pointer"
        style={{ borderColor: 'var(--gold-dim)' }}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="truncate">{task.title}</span>
          {task.type && (
            <span className="muted text-[10px] uppercase tracking-wider">{task.type}</span>
          )}
          {overdueDays > 0 && (
            <span className="text-[10px]" style={{ color: 'var(--danger)' }}>
              {overdueDays}d overdue
            </span>
          )}
        </div>
        {rescheduleOpen && (
          <div className="mt-2 flex items-center gap-2">
            <input
              type="date"
              value={newDate}
              onChange={(e) => setNewDate(e.target.value)}
              className="bg-transparent border rounded px-2 py-1 text-xs"
              style={{ borderColor: 'var(--border)' }}
            />
            <button
              onClick={reschedule}
              disabled={isPending}
              className="text-xs gold hover:underline"
            >
              Save
            </button>
            <button
              onClick={() => setRescheduleOpen(false)}
              className="text-xs muted hover:underline"
            >
              Cancel
            </button>
          </div>
        )}
        {error && <p className="text-xs mt-1" style={{ color: 'var(--danger)' }}>{error}</p>}
      </div>
      {!rescheduleOpen && (
        <button
          onClick={() => setRescheduleOpen(true)}
          disabled={isPending}
          className="opacity-0 group-hover:opacity-100 text-xs muted hover:text-gold transition"
          title="Reschedule"
        >
          ↗
        </button>
      )}
    </li>
  );
}
