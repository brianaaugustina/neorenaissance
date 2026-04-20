'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

const FOCUS_AGENTS = [
  'ops_chief',
  'showrunner',
  'sponsorship-director',
  'pr-director',
  'talent-scout',
  'funding-scout',
  'growth-strategist',
  'analytics-reporting',
];

export function RunSupervisorButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [mode, setMode] = useState<'weekly' | 'deep-dive'>('weekly');
  const [focusAgent, setFocusAgent] = useState(FOCUS_AGENTS[0]);
  const [windowDays, setWindowDays] = useState('7');
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<{
    diffs: number;
    promotions: number;
    retros: number;
    underSampled: string[];
  } | null>(null);

  const run = () => {
    setError(null);
    setLast(null);
    startTransition(async () => {
      try {
        const body: Record<string, unknown> = {};
        if (mode === 'deep-dive') {
          body.outputType = 'agent_deep_dive';
          body.focusAgentId = focusAgent;
          body.currentWindowDays = Math.max(1, Number(windowDays) || 30);
        }
        const res = await fetch('/api/agents/agent-supervisor/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || 'Supervisor run failed');
        setLast({
          diffs: data.diffProposalsCount ?? 0,
          promotions: data.preferencePromotionsCount ?? 0,
          retros: data.retrospectiveCheckinsCount ?? 0,
          underSampled: data.underSampledAgents ?? [],
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
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as 'weekly' | 'deep-dive')}
          disabled={isPending}
          className="bg-transparent border px-3 py-2 text-sm"
          style={{ borderRadius: 0, borderColor: 'var(--rule)' }}
        >
          <option value="weekly">Weekly supervisor report</option>
          <option value="deep-dive">Agent deep dive</option>
        </select>
        {mode === 'deep-dive' && (
          <>
            <select
              value={focusAgent}
              onChange={(e) => setFocusAgent(e.target.value)}
              disabled={isPending}
              className="bg-transparent border px-3 py-2 text-sm"
              style={{ borderRadius: 0, borderColor: 'var(--rule)' }}
            >
              {FOCUS_AGENTS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={1}
              value={windowDays}
              onChange={(e) => setWindowDays(e.target.value)}
              disabled={isPending}
              placeholder="days"
              className="w-24 bg-transparent border px-3 py-2 text-sm"
              style={{ borderRadius: 0, borderColor: 'var(--rule)' }}
            />
          </>
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
          {last.diffs} diff{last.diffs === 1 ? '' : 's'} proposed · {last.promotions}{' '}
          preference{last.promotions === 1 ? '' : 's'} · {last.retros} retrospective
          {last.retros === 1 ? '' : 's'}
          {last.underSampled.length > 0
            ? ` · ${last.underSampled.length} agent${last.underSampled.length === 1 ? '' : 's'} under-sampled`
            : ''}
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
