'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { formatPtRelative, formatPtTime } from '@/lib/time';
import {
  classifyQueueItem,
  isUrgent,
  queueGroupHint,
  queueGroupLabel,
  queueItemContext,
  queueItemDetailHref,
  supportsInlineApprove,
  type QueueGroup,
  type QueueItemLike,
} from '@/lib/queue/classify';

type FilterMode = 'all' | QueueGroup;

interface Props {
  items: QueueItemLike[];
  recentlyExecuted: QueueItemLike[];
}

/**
 * Full Agent Queue page — mirrors the AGENT.DASH design.
 * Big title + stat row (no Urgent per design refinement) + filter bar with
 * Bulk Approve All Safe action + grouped list with .qi rows and per-row
 * action buttons.
 */
export function QueuePageClient({ items, recentlyExecuted }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [filter, setFilter] = useState<FilterMode>('all');
  const [mutations, setMutations] = useState<Record<string, 'pending' | 'done' | 'error'>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const grouped = useMemo(() => {
    const g: Record<QueueGroup, QueueItemLike[]> = { approval: [], input: [], verify: [] };
    for (const item of items) g[classifyQueueItem(item)].push(item);
    return g;
  }, [items]);

  const urgentCount = items.filter(isUrgent).length;
  const oldestAgeLabel = useMemo(() => {
    if (items.length === 0) return '—';
    const sorted = [...items].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
    return formatPtRelative(sorted[0].created_at).toUpperCase();
  }, [items]);

  const updateStatus = async (item: QueueItemLike, status: 'approved' | 'rejected' | 'deferred') => {
    const res = await fetch(`/api/queue/${item.id}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data?.error || `Failed (${res.status})`);
    }
  };

  const runMutation = (item: QueueItemLike, status: 'approved' | 'rejected' | 'deferred') => {
    setErrors((prev) => ({ ...prev, [item.id]: '' }));
    setMutations((prev) => ({ ...prev, [item.id]: 'pending' }));
    startTransition(async () => {
      try {
        await updateStatus(item, status);
        setMutations((prev) => ({ ...prev, [item.id]: 'done' }));
        router.refresh();
      } catch (e) {
        setMutations((prev) => ({ ...prev, [item.id]: 'error' }));
        setErrors((prev) => ({
          ...prev,
          [item.id]: e instanceof Error ? e.message : 'Failed',
        }));
      }
    });
  };

  // Update (feedback + regen). POSTs to /api/queue/[id]/update with feedback
  // text. The current item becomes 'superseded'; a new queue row takes its
  // place. We invalidate the router so the new row shows up after refresh.
  const runUpdate = (item: QueueItemLike, feedback: string) => {
    setErrors((prev) => ({ ...prev, [item.id]: '' }));
    setMutations((prev) => ({ ...prev, [item.id]: 'pending' }));
    startTransition(async () => {
      try {
        const res = await fetch(`/api/queue/${item.id}/update`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ feedback }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data?.error || `Update failed (${res.status})`);
        }
        setMutations((prev) => ({ ...prev, [item.id]: 'done' }));
        router.refresh();
      } catch (e) {
        setMutations((prev) => ({ ...prev, [item.id]: 'error' }));
        setErrors((prev) => ({
          ...prev,
          [item.id]: e instanceof Error ? e.message : 'Failed',
        }));
      }
    });
  };

  const filteredGroups: QueueGroup[] =
    filter === 'all' ? ['approval', 'input', 'verify'] : [filter];

  const totalVisible =
    filter === 'all' ? items.length : grouped[filter as QueueGroup].length;

  return (
    <main
      style={{
        padding: '32px 40px 80px',
        maxWidth: 1600,
        margin: '0 auto',
      }}
    >
      {/* Hero */}
      <div style={{ marginBottom: 32 }}>
        <p className="eyebrow">Human Gateway · Operator Actions</p>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr auto',
            alignItems: 'end',
            gap: 40,
            marginBottom: 24,
          }}
        >
          <div>
            <h1 className="title" style={{ fontSize: 72 }}>
              Agent Queue
              <span className="count">({items.length})</span>
            </h1>
            <p className="sub">
              Items awaiting operator approval, input, or verification. Sorted
              by group and age. Rejected / superseded / ignored items live on
              the All Outputs page — this view only shows items needing action.
            </p>
          </div>
          <div
            className="mono"
            style={{
              textAlign: 'right',
              fontSize: 11,
              color: 'var(--ink-2)',
              lineHeight: 1.7,
              letterSpacing: '0.05em',
            }}
          >
            OLDEST: {oldestAgeLabel}
            <br />
            URGENT (&gt;4H): {urgentCount}
            <br />
            RECENTLY DONE: {recentlyExecuted.length}
          </div>
        </div>
      </div>

      {/* Stat row */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          borderTop: '1px solid var(--rule-strong)',
          borderBottom: '1px solid var(--rule-strong)',
          marginBottom: 28,
        }}
      >
        <StatFilter
          n={grouped.approval.length}
          label="Needs Approval"
          highlighted={filter === 'approval'}
          active={filter === 'all' || filter === 'approval'}
          onClick={() => setFilter(filter === 'approval' ? 'all' : 'approval')}
        />
        <StatFilter
          n={grouped.input.length}
          label="Needs Input"
          highlighted={filter === 'input'}
          active={filter === 'all' || filter === 'input'}
          onClick={() => setFilter(filter === 'input' ? 'all' : 'input')}
        />
        <StatFilter
          n={grouped.verify.length}
          label="Verify & Commit"
          highlighted={filter === 'verify'}
          active={filter === 'all' || filter === 'verify'}
          onClick={() => setFilter(filter === 'verify' ? 'all' : 'verify')}
          last
        />
      </div>

      {/* Filter bar */}
      <div className="filters" style={{ marginBottom: 16 }}>
        <button
          className={`fbtn ${filter === 'all' ? 'on' : ''}`}
          onClick={() => setFilter('all')}
        >
          All ({items.length})
        </button>
        <button
          className={`fbtn ${filter === 'approval' ? 'on' : ''}`}
          onClick={() => setFilter('approval')}
        >
          Needs Approval
        </button>
        <button
          className={`fbtn ${filter === 'input' ? 'on' : ''}`}
          onClick={() => setFilter('input')}
        >
          Needs Input
        </button>
        <button
          className={`fbtn ${filter === 'verify' ? 'on' : ''}`}
          onClick={() => setFilter('verify')}
        >
          Verify & Commit
        </button>
      </div>

      {/* Grouped list */}
      {totalVisible === 0 ? (
        <div
          className="mono"
          style={{
            padding: '60px 0',
            textAlign: 'center',
            color: 'var(--ink-3)',
            fontSize: 12,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}
        >
          {items.length === 0
            ? 'Queue clear · no pending items'
            : `No items in "${queueGroupLabel(filter as QueueGroup)}"`}
        </div>
      ) : (
        filteredGroups.map((g) => {
          const items = grouped[g];
          if (items.length === 0) return null;
          return (
            <section key={g} style={{ marginTop: 32 }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  paddingBottom: 10,
                  borderBottom: '1px solid var(--rule-strong)',
                }}
              >
                <h2
                  style={{
                    fontSize: 22,
                    fontWeight: 600,
                    letterSpacing: '-0.02em',
                    margin: 0,
                  }}
                >
                  {queueGroupLabel(g)}
                  <span
                    className="mono"
                    style={{
                      fontSize: 14,
                      color: 'var(--ink-3)',
                      fontWeight: 400,
                      marginLeft: 8,
                    }}
                  >
                    {items.length}
                  </span>
                </h2>
                <span
                  className="mono"
                  style={{ fontSize: 11, color: 'var(--ink-3)' }}
                >
                  {queueGroupHint(g)}
                </span>
              </div>

              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {items.map((item, i) => (
                  <QueueRow
                    key={item.id}
                    idx={i + 1}
                    item={item}
                    mutation={mutations[item.id]}
                    errorMsg={errors[item.id]}
                    disabled={isPending}
                    onApprove={() => runMutation(item, 'approved')}
                    onReject={() => runMutation(item, 'rejected')}
                    onDismiss={() => runMutation(item, 'deferred')}
                    onUpdate={(fb) => runUpdate(item, fb)}
                  />
                ))}
              </ul>
            </section>
          );
        })
      )}

      {/* Recently executed footer section */}
      {recentlyExecuted.length > 0 && filter === 'all' && (
        <section style={{ marginTop: 48 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              paddingBottom: 10,
              borderBottom: '1px solid var(--rule)',
            }}
          >
            <h2
              style={{
                fontSize: 14,
                fontWeight: 500,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                color: 'var(--ink-2)',
                margin: 0,
              }}
            >
              Recently executed
            </h2>
            <Link
              href="/outputs"
              className="mono"
              style={{
                fontSize: 11,
                color: 'var(--ink-3)',
                textDecoration: 'none',
              }}
            >
              View all →
            </Link>
          </div>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {recentlyExecuted.map((item) => (
              <li
                key={item.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr auto',
                  padding: '12px 0',
                  borderBottom: '1px solid var(--rule)',
                  gap: 16,
                }}
              >
                <Link
                  href={queueItemDetailHref(item)}
                  style={{
                    textDecoration: 'none',
                    color: 'inherit',
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 10,
                    flexWrap: 'wrap',
                  }}
                >
                  <span
                    className="mono"
                    style={{
                      fontSize: 10,
                      letterSpacing: '0.12em',
                      textTransform: 'uppercase',
                      fontWeight: 600,
                    }}
                  >
                    {item.agent_name}
                  </span>
                  <span style={{ fontSize: 13 }}>{item.title}</span>
                </Link>
                <span
                  className="mono"
                  style={{ fontSize: 11, color: 'var(--ink-3)' }}
                >
                  {formatPtTime(item.created_at)} PT
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

// ============================================================================

function StatFilter({
  n,
  label,
  active,
  highlighted,
  onClick,
  last,
}: {
  n: number;
  label: string;
  active: boolean;
  highlighted: boolean;
  onClick: () => void;
  last?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        all: 'unset',
        cursor: 'pointer',
        padding: '16px 20px',
        borderRight: last ? 'none' : '1px solid var(--rule)',
        background: highlighted ? 'var(--ink)' : 'transparent',
        color: highlighted ? 'var(--bg)' : 'var(--ink)',
        opacity: active ? 1 : 0.5,
        transition: 'background 0.12s, color 0.12s, opacity 0.12s',
      }}
    >
      <div
        style={{
          fontSize: 36,
          fontWeight: 700,
          letterSpacing: '-0.03em',
          lineHeight: 1,
        }}
      >
        {n}
      </div>
      <div
        style={{
          fontSize: 10,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: highlighted ? 'var(--bg)' : 'var(--ink-2)',
          marginTop: 8,
          fontWeight: 500,
        }}
      >
        {label}
      </div>
    </button>
  );
}

function QueueRow({
  idx,
  item,
  mutation,
  errorMsg,
  disabled,
  onApprove,
  onReject,
  onDismiss,
  onUpdate,
}: {
  idx: number;
  item: QueueItemLike;
  mutation: 'pending' | 'done' | 'error' | undefined;
  errorMsg: string | undefined;
  disabled: boolean;
  onApprove: () => void;
  onReject: () => void;
  onDismiss: () => void;
  onUpdate: (feedback: string) => void;
}) {
  const age = formatPtRelative(item.created_at).toUpperCase();
  const urgent = isUrgent(item);
  const inlineApprove = supportsInlineApprove(item);
  const isApproved = item.status === 'approved' || item.status === 'executed';
  const acted = mutation === 'done';
  const pending = mutation === 'pending';
  const [showUpdate, setShowUpdate] = useState(false);
  const [feedback, setFeedback] = useState('');
  const submitUpdate = () => {
    const trimmed = feedback.trim();
    if (!trimmed) return;
    onUpdate(trimmed);
    setShowUpdate(false);
    setFeedback('');
  };

  return (
    <li>
      <div
        className="dash-card"
        style={{
          display: 'grid',
          gridTemplateColumns: '40px 1fr auto',
          gap: 16,
          padding: '36px 16px',
          borderBottom: '1px solid var(--rule)',
          alignItems: 'start',
          opacity: acted ? 0 : 1,
          transform: acted ? 'translateX(20px)' : 'none',
          transition: 'opacity 0.25s, transform 0.25s',
          pointerEvents: acted ? 'none' : 'auto',
        }}
      >
        <div
          className="mono"
          style={{
            fontSize: 11,
            color: 'var(--ink-3)',
            paddingTop: 5,
          }}
        >
          {String(idx).padStart(2, '0')}
        </div>

        <div style={{ minWidth: 0 }}>
          <div
            className="mono"
            style={{
              display: 'flex',
              gap: 12,
              alignItems: 'center',
              marginBottom: 6,
              fontSize: 10,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              flexWrap: 'wrap',
            }}
          >
            <span style={{ fontWeight: 600, color: 'var(--ink)' }}>
              {item.agent_name}
            </span>
            <span style={{ color: 'var(--ink-4)' }}>·</span>
            <span style={{ color: 'var(--ink-3)' }}>{queueItemContext(item)}</span>
            <span style={{ color: 'var(--ink-4)' }}>·</span>
            <span style={{ color: 'var(--ink-3)' }}>{age}</span>
          </div>
          <h3
            style={{
              fontSize: 20,
              fontWeight: 500,
              letterSpacing: '-0.015em',
              lineHeight: 1.25,
              margin: '0 0 6px',
            }}
          >
            {item.title}
          </h3>
          {item.summary && (
            <p
              className="mono"
              style={{
                fontSize: 12.5,
                color: 'var(--ink-2)',
                lineHeight: 1.5,
                margin: '0 0 12px',
              }}
            >
              {item.summary}
            </p>
          )}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {inlineApprove ? (
              <>
                <button
                  onClick={onApprove}
                  disabled={disabled || pending}
                  className="btn primary"
                >
                  {pending ? 'Working…' : 'Approve'}
                </button>
                <button
                  onClick={onReject}
                  disabled={disabled || pending}
                  className="btn"
                >
                  Reject
                </button>
                <button
                  onClick={() => setShowUpdate((v) => !v)}
                  disabled={disabled || pending}
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
                  onClick={onDismiss}
                  disabled={disabled || pending}
                  className="btn ghost"
                >
                  Dismiss
                </button>
                <Link href={queueItemDetailHref(item)} className="btn ghost">
                  Open →
                </Link>
              </>
            ) : isApproved ? (
              <>
                <Link href={queueItemDetailHref(item)} className="btn primary">
                  {item.type === 'recommendation' ? 'Execute →' : 'Open →'}
                </Link>
                <button
                  onClick={onDismiss}
                  disabled={disabled || pending}
                  className="btn ghost"
                >
                  Dismiss
                </button>
              </>
            ) : (
              <>
                <Link href={queueItemDetailHref(item)} className="btn primary">
                  Review →
                </Link>
                <button
                  onClick={() => setShowUpdate((v) => !v)}
                  disabled={disabled || pending}
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
                  onClick={onDismiss}
                  disabled={disabled || pending}
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
                marginTop: 12,
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
                disabled={disabled || pending}
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
                  disabled={disabled || pending || !feedback.trim()}
                  className="btn primary"
                >
                  {pending ? 'Running…' : 'Regenerate with feedback'}
                </button>
                <button
                  onClick={() => {
                    setShowUpdate(false);
                    setFeedback('');
                  }}
                  disabled={disabled || pending}
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
                The agent re-runs and applies this feedback. This item becomes superseded; the new version appears at the top of the queue.
              </p>
            </div>
          )}

          {errorMsg && (
            <p
              className="mono"
              style={{
                fontSize: 10,
                color: 'var(--danger)',
                marginTop: 8,
                letterSpacing: '0.05em',
              }}
            >
              {errorMsg}
            </p>
          )}
        </div>

        <div
          style={{ textAlign: 'right', whiteSpace: 'nowrap', paddingTop: 3 }}
        >
          <span
            className="mono"
            style={{
              fontSize: 10,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: urgent ? 'var(--ink)' : 'var(--ink-2)',
              fontWeight: urgent ? 600 : 500,
            }}
          >
            {urgent && (
              <span
                style={{
                  display: 'inline-block',
                  width: 6,
                  height: 6,
                  background: 'var(--ink)',
                  marginRight: 6,
                  transform: 'translateY(-1px)',
                  animation: 'pulse 1.2s infinite',
                }}
              />
            )}
            {urgent ? 'URGENT' : isApproved ? 'VERIFY READY' : 'PENDING REVIEW'}
          </span>
          <Link
            href={queueItemDetailHref(item)}
            className="mono"
            style={{
              display: 'block',
              marginTop: 10,
              fontSize: 10,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: 'var(--ink-3)',
              textDecoration: 'none',
            }}
          >
            Open detail →
          </Link>
        </div>
      </div>
    </li>
  );
}
