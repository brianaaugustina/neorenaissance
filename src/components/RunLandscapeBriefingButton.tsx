'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export function RunLandscapeBriefingButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{ monthLabel: string } | null>(null);

  const run = () => {
    setError(null);
    setLastResult(null);
    startTransition(async () => {
      try {
        const res = await fetch('/api/agents/pr-director/landscape', {
          method: 'POST',
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || 'Landscape briefing failed');
        setLastResult({ monthLabel: data.monthLabel });
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed');
      }
    });
  };

  return (
    <div className="flex flex-col items-start gap-1">
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
        {isPending ? 'Scanning…' : 'Run Landscape'}
      </button>
      {lastResult && (
        <p className="text-xs muted">
          {lastResult.monthLabel} briefing generated.
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
