'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export function RunTalentResearchButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [count, setCount] = useState(8);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{
    reviewed: number;
    surfaced: number;
    contactsWritten: number;
  } | null>(null);

  const run = () => {
    setError(null);
    setLastResult(null);
    startTransition(async () => {
      try {
        const res = await fetch('/api/agents/talent-scout/research', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ count }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || 'Research failed');
        setLastResult({
          reviewed: data.reviewed,
          surfaced: data.surfaced,
          contactsWritten: data.contactsWritten,
        });
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed');
      }
    });
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <label className="text-xs muted">Count</label>
        <input
          type="number"
          min={3}
          max={15}
          value={count}
          onChange={(e) => setCount(Math.min(15, Math.max(3, Number(e.target.value) || 8)))}
          disabled={isPending}
          className="w-16 bg-transparent border rounded-md px-2 py-1 text-sm"
          style={{ borderColor: 'var(--border)' }}
        />
        <button
          onClick={run}
          disabled={isPending}
          className="px-4 py-2 text-sm rounded-lg border transition disabled:opacity-40"
          style={{
            borderColor: 'var(--gold)',
            color: 'var(--gold)',
            background: isPending ? 'var(--surface-2)' : 'transparent',
          }}
        >
          {isPending ? 'Scanning…' : 'Run Research'}
        </button>
      </div>
      {lastResult && (
        <p className="text-xs muted">
          Reviewed {lastResult.reviewed}, surfaced {lastResult.surfaced}.{' '}
          {lastResult.contactsWritten} added to Contacts DB.
        </p>
      )}
      {error && (
        <p className="text-xs" style={{ color: 'var(--danger)' }}>
          {error}
        </p>
      )}
    </div>
  );
}
