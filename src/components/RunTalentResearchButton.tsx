'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

const DEFAULT_COUNT = 8;
const MIN_COUNT = 3;
const MAX_COUNT = 15;

export function RunTalentResearchButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  // Store as string so the user can freely edit (including intermediate
  // empty / out-of-range values while typing). Clamp only on blur / submit.
  const [countText, setCountText] = useState(String(DEFAULT_COUNT));
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{
    reviewed: number;
    surfaced: number;
    contactsWritten: number;
  } | null>(null);

  const clampAndNormalize = (raw: string): number => {
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n)) return DEFAULT_COUNT;
    return Math.min(MAX_COUNT, Math.max(MIN_COUNT, n));
  };

  const handleBlur = () => {
    // Snap the displayed value to the clamped one when focus leaves.
    setCountText(String(clampAndNormalize(countText)));
  };

  const run = () => {
    setError(null);
    setLastResult(null);
    const count = clampAndNormalize(countText);
    // Reflect the normalized value back into the field so the user sees
    // what actually got sent.
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
          min={MIN_COUNT}
          max={MAX_COUNT}
          value={countText}
          onChange={(e) => setCountText(e.target.value)}
          onBlur={handleBlur}
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
