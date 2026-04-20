'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

type OutputType =
  | 'monthly_pulse_check'
  | 'quarterly_growth_review'
  | 'channel_recommendation'
  | 'audience_analysis'
  | 'cross_venture_synergy';

const LABELS: Record<OutputType, string> = {
  monthly_pulse_check: 'Monthly pulse check',
  quarterly_growth_review: 'Quarterly growth review',
  channel_recommendation: 'Channel recommendation',
  audience_analysis: 'Audience analysis',
  cross_venture_synergy: 'Cross-venture synergy',
};

export function RunGrowthBriefingButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [outputType, setOutputType] = useState<OutputType>('monthly_pulse_check');
  const [focus, setFocus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<{ recs: number; hadAnalytics: boolean } | null>(null);

  const run = () => {
    setError(null);
    setLast(null);
    startTransition(async () => {
      try {
        const res = await fetch('/api/agents/growth-strategist/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            outputType,
            focus: focus.trim() || undefined,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || 'Run failed');
        setLast({
          recs: data.recommendationsCount,
          hadAnalytics: data.hadAnalytics,
        });
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed');
      }
    });
  };

  const showsFocus =
    outputType === 'channel_recommendation' ||
    outputType === 'audience_analysis' ||
    outputType === 'cross_venture_synergy';

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2 flex-wrap justify-end">
        <select
          value={outputType}
          onChange={(e) => setOutputType(e.target.value as OutputType)}
          disabled={isPending}
          className="bg-transparent border px-3 py-2 text-sm"
          style={{ borderRadius: 0, borderColor: 'var(--rule)' }}
        >
          {(Object.keys(LABELS) as OutputType[]).map((t) => (
            <option key={t} value={t}>
              {LABELS[t]}
            </option>
          ))}
        </select>
        {showsFocus && (
          <input
            type="text"
            placeholder="Focus (optional)"
            value={focus}
            onChange={(e) => setFocus(e.target.value)}
            disabled={isPending}
            className="bg-transparent border px-3 py-2 text-sm w-48"
            style={{ borderRadius: 0, borderColor: 'var(--rule)' }}
          />
        )}
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
      {last && (
        <p className="text-xs muted">
          {last.recs} recommendation{last.recs === 1 ? '' : 's'} surfaced
          {last.hadAnalytics ? '' : ' · no analytics data (ran on KRs + experiments only)'}
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
