'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export function RunPrResearchButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{
    reviewed: number;
    surfaced: number;
    landscapeDate: string | null;
  } | null>(null);

  const run = () => {
    setError(null);
    setLastResult(null);
    startTransition(async () => {
      try {
        const res = await fetch('/api/agents/pr-director/research', {
          method: 'POST',
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || 'Research failed');
        setLastResult({
          reviewed: data.reviewed,
          surfaced: data.surfaced,
          landscapeDate: data.landscapeDate ?? null,
        });
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed');
      }
    });
  };

  return (
    <div className="flex flex-col items-end gap-1">
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
      {lastResult && (
        <p className="text-xs muted">
          Reviewed {lastResult.reviewed}, surfaced {lastResult.surfaced}
          {lastResult.landscapeDate
            ? ` · landscape ${lastResult.landscapeDate}`
            : ' · no landscape yet'}
          .
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
