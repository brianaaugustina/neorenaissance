'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

const REPOS = [
  { value: '', label: 'All tracked repos' },
  { value: 'agent-system', label: 'Agent System' },
  { value: 'detto', label: 'Detto' },
  { value: 'tts', label: 'TTS site' },
  { value: 'personal-site', label: 'Personal site' },
];

export function RunSystemEngineerButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [repo, setRepo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<{
    critical: number;
    medium: number;
    low: number;
    configuredRepos: number;
  } | null>(null);

  const run = () => {
    setError(null);
    setLast(null);
    startTransition(async () => {
      try {
        const res = await fetch('/api/agents/system-engineer/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            focusRepoShortId: repo || undefined,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || 'Scan failed');
        setLast({
          critical: data.severity_counts?.critical ?? 0,
          medium: data.severity_counts?.medium ?? 0,
          low: data.severity_counts?.low ?? 0,
          configuredRepos: data.configured_repos ?? 0,
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
          value={repo}
          onChange={(e) => setRepo(e.target.value)}
          disabled={isPending}
          className="bg-transparent border px-3 py-2 text-sm"
          style={{ borderRadius: 0, borderColor: 'var(--rule)' }}
        >
          {REPOS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
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
          {last.critical} Critical · {last.medium} Medium · {last.low} Low across{' '}
          {last.configuredRepos} configured repo
          {last.configuredRepos === 1 ? '' : 's'}
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
