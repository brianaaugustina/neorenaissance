'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export function RunAnalyticsReportButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [periodEndDate, setPeriodEndDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{
    configured: string[];
    notConfigured: string[];
    errored: number;
  } | null>(null);

  const run = () => {
    setError(null);
    setLastResult(null);
    startTransition(async () => {
      try {
        const res = await fetch('/api/agents/analytics-reporting/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            periodEndDate: periodEndDate || undefined,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || 'Report failed');
        setLastResult({
          configured: data.platforms_configured ?? [],
          notConfigured: data.platforms_not_configured ?? [],
          errored: Array.isArray(data.errored) ? data.errored.length : 0,
        });
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed');
      }
    });
  };

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2 flex-wrap justify-end">
        <label className="text-xs muted">Period end (optional)</label>
        <input
          type="date"
          value={periodEndDate}
          onChange={(e) => setPeriodEndDate(e.target.value)}
          disabled={isPending}
          className="bg-transparent border px-2 py-1 text-sm"
          style={{ borderRadius: 0, borderColor: 'var(--rule)' }}
        />
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
      </div>
      {lastResult && (
        <p className="text-xs muted">
          Pulled {lastResult.configured.length} platform
          {lastResult.configured.length === 1 ? '' : 's'}
          {lastResult.configured.length > 0
            ? ` (${lastResult.configured.join(', ')})`
            : ''}
          {lastResult.notConfigured.length > 0
            ? ` · ${lastResult.notConfigured.length} not configured`
            : ''}
          {lastResult.errored > 0 ? ` · ${lastResult.errored} errored` : ''}
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
