'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export function RunOpsChiefButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = () => {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch('/api/agents/ops-chief/run', { method: 'POST' });
        if (!res.ok) throw new Error((await res.json()).error || 'Failed');
        router.refresh();
      } catch (e: any) {
        setError(e.message);
      }
    });
  };

  const runWeekly = () => {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch('/api/agents/ops-chief/weekly', { method: 'POST' });
        if (!res.ok) throw new Error((await res.json()).error || 'Failed');
        router.refresh();
      } catch (e: any) {
        setError(e.message);
      }
    });
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        <button
          onClick={run}
          disabled={isPending}
          className="px-4 py-2 text-sm border transition disabled:opacity-40"
          style={{
            borderRadius: 0,
            borderColor: 'var(--ink)',
            color: 'var(--ink)',
            background: isPending ? 'var(--bg-2)' : 'transparent',
          }}
        >
          {isPending ? 'Running…' : 'Run agent'}
        </button>
        <button
          onClick={runWeekly}
          disabled={isPending}
          className="px-4 py-2 text-sm border transition disabled:opacity-40"
          style={{
            borderRadius: 0,
            borderColor: 'var(--rule)',
            color: 'var(--ink-2)',
            background: isPending ? 'var(--bg-2)' : 'transparent',
          }}
        >
          Weekly Plan
        </button>
      </div>
      {error && <p className="text-xs" style={{ color: 'var(--danger)' }}>{error}</p>}
    </div>
  );
}
