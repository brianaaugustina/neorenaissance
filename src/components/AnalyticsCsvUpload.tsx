'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export function AnalyticsCsvUpload() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [platform, setPlatform] = useState<'substack' | 'spotify'>('substack');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<{
    ok: boolean;
    csvKind?: string;
    subscribers?: number;
    totalPlays?: number;
    parseError?: string;
  } | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLast(null);
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError('Pick a CSV first');
      return;
    }
    if (!periodStart || !periodEnd) {
      setError('Both period dates are required');
      return;
    }
    const form = new FormData();
    form.set('platform', platform);
    form.set('periodStart', periodStart);
    form.set('periodEnd', periodEnd);
    form.set('file', file);

    startTransition(async () => {
      try {
        const res = await fetch('/api/agents/analytics-reporting/upload', {
          method: 'POST',
          body: form,
        });
        const data = await res.json();
        if (!res.ok && !data?.uploadId) {
          throw new Error(data?.error || 'Upload failed');
        }
        setLast({
          ok: !!data.ok,
          csvKind: data.csvKind,
          subscribers: data.subscribers,
          totalPlays: data.totalPlays,
          parseError: data.parseError,
        });
        if (fileRef.current) fileRef.current.value = '';
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed');
      }
    });
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs muted uppercase tracking-wider">Platform</span>
          <select
            value={platform}
            onChange={(e) => setPlatform(e.target.value as 'substack' | 'spotify')}
            disabled={isPending}
            className="bg-transparent border px-2 py-1.5 text-sm"
            style={{ borderColor: 'var(--border)' }}
          >
            <option value="substack">Substack</option>
            <option value="spotify">Spotify for Podcasters</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs muted uppercase tracking-wider">Period start</span>
          <input
            type="date"
            value={periodStart}
            onChange={(e) => setPeriodStart(e.target.value)}
            disabled={isPending}
            className="bg-transparent border px-2 py-1.5 text-sm"
            style={{ borderColor: 'var(--border)' }}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs muted uppercase tracking-wider">Period end</span>
          <input
            type="date"
            value={periodEnd}
            onChange={(e) => setPeriodEnd(e.target.value)}
            disabled={isPending}
            className="bg-transparent border px-2 py-1.5 text-sm"
            style={{ borderColor: 'var(--border)' }}
          />
        </label>
        <label className="flex flex-col gap-1 flex-1 min-w-[200px]">
          <span className="text-xs muted uppercase tracking-wider">CSV file</span>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            disabled={isPending}
            className="bg-transparent border px-2 py-1.5 text-sm"
            style={{ borderColor: 'var(--border)' }}
          />
        </label>
        <button
          type="submit"
          disabled={isPending}
          className="px-4 py-2 text-sm border transition disabled:opacity-40"
          style={{
            borderColor: 'var(--gold)',
            color: 'var(--gold)',
          }}
        >
          {isPending ? 'Uploading…' : 'Upload + parse'}
        </button>
      </div>
      {last?.ok && (
        <p className="text-xs" style={{ color: 'var(--ok)' }}>
          ✓ Parsed {last.csvKind}
          {last.subscribers != null ? ` · ${last.subscribers} subscribers` : ''}
          {last.totalPlays != null ? ` · ${last.totalPlays} plays` : ''}
          {' — snapshot upserted.'}
        </p>
      )}
      {last && !last.ok && last.parseError && (
        <p className="text-xs" style={{ color: 'var(--danger)' }}>
          Upload stored, but parse failed: {last.parseError}
        </p>
      )}
      {error && (
        <p className="text-xs" style={{ color: 'var(--danger)' }}>
          {error}
        </p>
      )}
    </form>
  );
}
