'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

interface Props {
  queueItemId: string;
  queueStatus: string | null;
}

/**
 * Action surface inside the Gateway panel on the output detail page.
 * Mirrors the queue-page row actions: Approve / Reject / Update / Dismiss,
 * plus per-state shortcuts for already-approved items.
 */
export function OutputDetailActions({ queueItemId, queueStatus }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [mutation, setMutation] = useState<'idle' | 'pending' | 'done' | 'error'>('idle');
  const [err, setErr] = useState<string | null>(null);
  const [showUpdate, setShowUpdate] = useState(false);
  const [feedback, setFeedback] = useState('');

  const setStatus = (status: 'approved' | 'rejected' | 'deferred') => {
    setErr(null);
    setMutation('pending');
    startTransition(async () => {
      try {
        const res = await fetch(`/api/queue/${queueItemId}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data?.error || `Failed (${res.status})`);
        }
        setMutation('done');
        router.refresh();
      } catch (e) {
        setMutation('error');
        setErr(e instanceof Error ? e.message : 'Failed');
      }
    });
  };

  const submitUpdate = () => {
    const trimmed = feedback.trim();
    if (!trimmed) return;
    setErr(null);
    setMutation('pending');
    startTransition(async () => {
      try {
        const res = await fetch(`/api/queue/${queueItemId}/update`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ feedback: trimmed }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data?.error || `Update failed (${res.status})`);
        }
        setMutation('done');
        setShowUpdate(false);
        setFeedback('');
        router.refresh();
      } catch (e) {
        setMutation('error');
        setErr(e instanceof Error ? e.message : 'Failed');
      }
    });
  };

  const busy = isPending || mutation === 'pending';
  const approved = queueStatus === 'approved' || queueStatus === 'executed';
  const pending = queueStatus === 'pending';

  if (mutation === 'done') {
    return (
      <p
        className="mono"
        style={{
          fontSize: 11,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'var(--ok)',
          padding: '10px 0',
        }}
      >
        ✓ Gateway resolved · pipeline unblocked
      </p>
    );
  }

  return (
    <>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        {pending && (
          <>
            <button
              onClick={() => setStatus('approved')}
              disabled={busy}
              className="btn primary"
            >
              {busy ? 'Working…' : 'Approve'}
            </button>
            <button
              onClick={() => setStatus('rejected')}
              disabled={busy}
              className="btn"
            >
              Reject
            </button>
            <button
              onClick={() => setShowUpdate((v) => !v)}
              disabled={busy}
              className="btn"
              style={
                showUpdate
                  ? { borderColor: 'var(--ink)', background: 'var(--bg-2)' }
                  : undefined
              }
            >
              {showUpdate ? 'Cancel update' : 'Update'}
            </button>
            <button
              onClick={() => setStatus('deferred')}
              disabled={busy}
              className="btn ghost"
            >
              Dismiss
            </button>
          </>
        )}
        {approved && (
          <>
            <Link href={`/queue/${queueItemId}/review`} className="btn primary">
              Commit / Execute →
            </Link>
            <button
              onClick={() => setStatus('deferred')}
              disabled={busy}
              className="btn ghost"
            >
              Dismiss
            </button>
          </>
        )}
      </div>

      {showUpdate && (
        <div
          style={{
            marginTop: 14,
            padding: 12,
            border: '1px solid var(--rule-strong)',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <label
            className="mono"
            style={{
              fontSize: 10,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: 'var(--ink-2)',
            }}
          >
            What should the agent change?
          </label>
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            rows={3}
            disabled={busy}
            className="mono"
            style={{
              width: '100%',
              background: 'var(--bg)',
              border: '1px solid var(--rule)',
              padding: '8px 10px',
              fontSize: 12,
              lineHeight: 1.5,
              color: 'var(--ink)',
              resize: 'vertical',
              fontFamily: 'var(--font-mono)',
            }}
            placeholder="Tighten the opener · cut the budget section · lead with the Angela Wilson story · …"
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={submitUpdate}
              disabled={busy || !feedback.trim()}
              className="btn primary"
            >
              {busy ? 'Running…' : 'Regenerate with feedback'}
            </button>
            <button
              onClick={() => {
                setShowUpdate(false);
                setFeedback('');
              }}
              disabled={busy}
              className="btn ghost"
            >
              Cancel
            </button>
          </div>
          <p
            className="mono"
            style={{
              fontSize: 10,
              color: 'var(--ink-3)',
              letterSpacing: '0.04em',
              margin: 0,
            }}
          >
            The agent re-runs and applies this feedback. This item becomes
            superseded; the new version appears at the top of the queue.
          </p>
        </div>
      )}

      {err && (
        <p
          className="mono"
          style={{
            fontSize: 10,
            color: 'var(--danger)',
            marginTop: 8,
            letterSpacing: '0.05em',
          }}
        >
          {err}
        </p>
      )}
    </>
  );
}
