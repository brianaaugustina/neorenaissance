'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

const DEFAULT_COUNT = 8;

export function RunTalentResearchButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  // Raw string while typing. Parsed (but not clamped) at submit time.
  const [countText, setCountText] = useState(String(DEFAULT_COUNT));
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{
    reviewed: number;
    surfaced: number;
    contactsWritten: number;
    webSearches: number;
  } | null>(null);

  const normalize = (raw: string): number => {
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n <= 0) return DEFAULT_COUNT;
    return n;
  };

  const run = () => {
    setError(null);
    setLastResult(null);
    const count = normalize(countText);
    setCountText(String(count));
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
          webSearches: data.webSearches ?? 0,
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
          min={1}
          value={countText}
          onChange={(e) => setCountText(e.target.value)}
          disabled={isPending}
          className="w-20 bg-transparent border rounded-md px-2 py-1 text-sm"
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
          Reviewed {lastResult.reviewed}, surfaced {lastResult.surfaced} ·{' '}
          {lastResult.webSearches} web search{lastResult.webSearches === 1 ? '' : 'es'} ·{' '}
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
