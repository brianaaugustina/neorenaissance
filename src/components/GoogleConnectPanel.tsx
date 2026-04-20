'use client';

import { useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';

export function GoogleConnectPanel({
  connected,
  channelTitle,
}: {
  connected: boolean;
  channelTitle: string | null;
}) {
  const search = useSearchParams();
  const statusParam = search.get('googleOAuth');
  const messageParam = search.get('message');
  const [isPending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [localConnected, setLocalConnected] = useState(connected);

  const connect = () => {
    // Full page navigation to trigger Google consent.
    window.location.href = '/api/auth/google/start?next=/agents/analytics-reporting';
  };

  const disconnect = () => {
    setErr(null);
    startTransition(async () => {
      try {
        const res = await fetch('/api/auth/google/disconnect', { method: 'POST' });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || 'Disconnect failed');
        setLocalConnected(false);
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Failed');
      }
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3 flex-wrap">
        {localConnected ? (
          <>
            <span className="text-xs" style={{ color: 'var(--ok)' }}>
              ✓ Connected{channelTitle ? ` · ${channelTitle}` : ''}
            </span>
            <button
              onClick={disconnect}
              disabled={isPending}
              className="px-3 py-1.5 text-xs border hover:bg-white/5 transition disabled:opacity-40"
              style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
            >
              {isPending ? 'Disconnecting…' : 'Disconnect'}
            </button>
          </>
        ) : (
          <button
            onClick={connect}
            className="px-4 py-2 text-sm border transition"
            style={{ borderColor: 'var(--gold)', color: 'var(--gold)' }}
          >
            Connect YouTube (Google OAuth)
          </button>
        )}
      </div>
      {statusParam === 'connected' && (
        <p className="text-xs" style={{ color: 'var(--ok)' }}>
          ✓ Google consent complete. Run the monthly report to pull YouTube data.
        </p>
      )}
      {statusParam === 'error' && messageParam && (
        <p className="text-xs" style={{ color: 'var(--danger)' }}>
          Consent failed: {messageParam}
        </p>
      )}
      {err && (
        <p className="text-xs" style={{ color: 'var(--danger)' }}>
          {err}
        </p>
      )}
    </div>
  );
}
