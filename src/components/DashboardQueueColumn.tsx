'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { formatPtRelative } from '@/lib/time';

type QueueGroup = 'approval' | 'input' | 'verify';
type FilterMode = 'all' | QueueGroup;

interface QueueItemLike {
  id: string;
  agent_name: string;
  type: string;
  status: string;
  title: string;
  summary: string | null;
  created_at: string;
  agent_output_id?: string | null;
  full_output?: any;
}

interface Props {
  pending: QueueItemLike[];
  approvedWithDownstream?: QueueItemLike[];
  limit?: number;
}

/**
 * Classify a queue item into one of three AGENT.DASH groups.
 * 'verify' → approved items still needing a commit/execute step
 * 'input'  → blocked waiting for operator upload / clarification
 * 'approval' → default: needs approve/reject/defer
 */
function classify(item: QueueItemLike): QueueGroup {
  if (item.status === 'approved' || item.status === 'executed') return 'verify';
  return 'approval';
}

function groupLabel(group: QueueGroup): string {
  return group === 'approval'
    ? 'Needs Approval'
    : group === 'input'
      ? 'Requires Your Input'
      : 'Verify & Commit';
}

function linkFor(item: QueueItemLike): string {
  if (item.agent_output_id) {
    return `/outputs/${item.agent_name}/${item.agent_output_id}`;
  }
  return `/queue/${item.id}/review`;
}

function statusContext(item: QueueItemLike): string {
  if (item.status === 'approved' || item.status === 'executed') return 'needs commit';
  if (item.type === 'draft') return 'draft';
  if (item.type === 'report') return 'report';
  if (item.type === 'recommendation') return 'plan';
  if (item.type === 'briefing') return 'briefing';
  return item.type;
}

/**
 * Does this item support a single-click Approve? Only for items whose primary
 * action is "approve the whole thing" — not multi-sub-item research batches
 * (funding scans, growth briefings, supervisor reports, system-engineer
 * reports) where the user needs per-sub-item decisions.
 */
function supportsInlineApprove(item: QueueItemLike): boolean {
  if (item.status !== 'pending') return false;
  const fo = (item.full_output ?? {}) as Record<string, unknown>;
  if (Array.isArray(fo.leads)) return false;
  if (Array.isArray(fo.opportunities)) return false;
  if (Array.isArray(fo.recommendations)) return false;
  if (Array.isArray(fo.diff_proposals)) return false;
  if (Array.isArray(fo.findings)) return false;
  return true;
}

export function DashboardQueueColumn({
  pending,
  approvedWithDownstream = [],
  limit = 8,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [filter, setFilter] = useState<FilterMode>('all');
  const [mutations, setMutations] = useState<Record<string, 'pending' | 'done' | 'error'>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const combined = useMemo(
    () => [...pending, ...approvedWithDownstream],
    [pending, approvedWithDownstream],
  );

  const grouped = useMemo(() => {
    const g: Record<QueueGroup, QueueItemLike[]> = { approval: [], input: [], verify: [] };
    for (const item of combined) g[classify(item)].push(item);
    return g;
  }, [combined]);

  const total = combined.length;

  const approveInline = (item: QueueItemLike) => {
    setErrors((prev) => ({ ...prev, [item.id]: '' }));
    setMutations((prev) => ({ ...prev, [item.id]: 'pending' }));
    startTransition(async () => {
      try {
        const res = await fetch(`/api/queue/${item.id}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'approved' }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data?.error || `Approve failed (${res.status})`);
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

  const rejectInline = (item: QueueItemLike) => {
    setErrors((prev) => ({ ...prev, [item.id]: '' }));
    setMutations((prev) => ({ ...prev, [item.id]: 'pending' }));
    startTransition(async () => {
      try {
        const res = await fetch(`/api/queue/${item.id}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'rejected' }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data?.error || `Reject failed (${res.status})`);
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

  // Grid: header · stats · scrollable items · sticky CTA. Column height comes
  // from the parent (100%); items scroll within their own region so the CTA
  // stays anchored and the page itself doesn't scroll.
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateRows: 'auto auto 1fr auto',
        height: '100%',
        minHeight: 0,
      }}
    >
      {/* Header */}
      <div style={{ padding: '24px 28px 14px' }}>
        <p className="eyebrow" style={{ margin: '0 0 4px' }}>
          Human Gateway · Operator Actions
        </p>
        <h1
          style={{
            fontSize: 40,
            fontWeight: 700,
            letterSpacing: '-0.035em',
            lineHeight: 1,
            margin: '4px 0 2px',
          }}
        >
          Agent Queue
          <span
            style={{
              display: 'inline-block',
              fontSize: 13,
              letterSpacing: 0,
              verticalAlign: 'middle',
              marginLeft: 10,
              padding: '2px 10px',
              border: '1px solid var(--ink)',
              borderRadius: 999,
              fontWeight: 500,
              transform: 'translateY(-6px)',
            }}
          >
            {total}
          </span>
        </h1>
        <p
          className="mono"
          style={{
            fontSize: 11,
            color: 'var(--ink-3)',
            letterSpacing: '0.04em',
            marginTop: 6,
            maxWidth: 520,
            lineHeight: 1.55,
          }}
        >
          Items awaiting operator approval, input, or verification. Tap Approve
          for quick items; Review / Open for multi-step briefings.
        </p>
      </div>

      {/* Stat-filter row — click to filter; click again to reset */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          borderTop: '1px solid var(--rule-strong)',
          borderBottom: '1px solid var(--rule-strong)',
        }}
      >
        <StatFilter
          n={grouped.approval.length}
          label="Needs Approval"
          active={filter === 'approval' || filter === 'all'}
          highlighted={filter === 'approval'}
          onClick={() => setFilter(filter === 'approval' ? 'all' : 'approval')}
        />
        <StatFilter
          n={grouped.input.length}
          label="Needs Input"
          active={filter === 'input' || filter === 'all'}
          highlighted={filter === 'input'}
          onClick={() => setFilter(filter === 'input' ? 'all' : 'input')}
        />
        <StatFilter
          n={grouped.verify.length}
          label="Verify & Commit"
          active={filter === 'verify' || filter === 'all'}
          highlighted={filter === 'verify'}
          onClick={() => setFilter(filter === 'verify' ? 'all' : 'verify')}
          last
        />
      </div>

      {/* Scrollable item list */}
      <div style={{ overflow: 'auto', minHeight: 0 }}>
        {total === 0 ? (
          <div
            className="mono"
            style={{
              padding: '60px 28px',
              textAlign: 'center',
              color: 'var(--ink-3)',
              fontSize: 12,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}
          >
            Queue clear · no pending items
          </div>
        ) : (
          <div style={{ padding: '16px 24px 24px' }}>
            {filteredGroups.map((g) => {
              const items = grouped[g].slice(0, limit);
              if (items.length === 0) return null;
              return (
                <div key={g} style={{ marginBottom: 24 }}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: 10,
                      letterSpacing: '0.2em',
                      textTransform: 'uppercase',
                      color: 'var(--ink-2)',
                      padding: '6px 4px 10px',
                      fontWeight: 500,
                    }}
                  >
                    <span>
                      {groupLabel(g)} · {grouped[g].length}
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {items.map((item) => (
                      <QueueCardBox
                        key={item.id}
                        item={item}
                        onApprove={approveInline}
                        onReject={rejectInline}
                        mutation={mutations[item.id]}
                        errorMsg={errors[item.id]}
                        disabled={isPending}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Sticky bottom CTA */}
      <Link
        href="/queue"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '20px 28px',
          background: 'var(--ink)',
          color: 'var(--bg)',
          fontSize: 13,
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          fontWeight: 500,
          textDecoration: 'none',
          borderTop: '1px solid var(--ink)',
        }}
      >
        <span>View full queue</span>
        <span style={{ fontSize: 20 }}>→</span>
      </Link>
    </div>
  );
}

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

function QueueCardBox({
  item,
  onApprove,
  onReject,
  mutation,
  errorMsg,
  disabled,
}: {
  item: QueueItemLike;
  onApprove: (item: QueueItemLike) => void;
  onReject: (item: QueueItemLike) => void;
  mutation: 'pending' | 'done' | 'error' | undefined;
  errorMsg: string | undefined;
  disabled: boolean;
}) {
  const context = statusContext(item);
  const age = formatPtRelative(item.created_at).toUpperCase();
  const canApproveInline = supportsInlineApprove(item);
  const isApproved = item.status === 'approved' || item.status === 'executed';
  const acted = mutation === 'done';

  return (
    <div
      className="dash-card"
      style={{
        border: '1px solid var(--rule-strong)',
        padding: '24px 18px',
        opacity: acted ? 0.55 : 1,
        transition: 'opacity 0.18s, background 0.12s, border-color 0.12s',
      }}
    >
      <div
        className="mono"
        style={{
          display: 'flex',
          gap: 10,
          alignItems: 'center',
          fontSize: 10,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          marginBottom: 8,
          flexWrap: 'wrap',
        }}
      >
        <span style={{ fontWeight: 600, color: 'var(--ink)' }}>{item.agent_name}</span>
        <span style={{ color: 'var(--ink-4)' }}>·</span>
        <span style={{ color: 'var(--ink-3)' }}>{context}</span>
        <span style={{ color: 'var(--ink-4)' }}>·</span>
        <span style={{ color: 'var(--ink-3)' }}>{age}</span>
      </div>
      <h3
        style={{
          fontSize: 18,
          fontWeight: 500,
          letterSpacing: '-0.01em',
          lineHeight: 1.3,
          margin: '0 0 8px',
        }}
      >
        {item.title}
      </h3>
      {item.summary && (
        <p
          className="mono"
          style={{
            fontSize: 12,
            color: 'var(--ink-2)',
            lineHeight: 1.55,
            margin: '0 0 14px',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {item.summary}
        </p>
      )}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {acted ? (
          <span
            className="mono"
            style={{
              fontSize: 11,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: 'var(--ok)',
            }}
          >
            ✓ Done
          </span>
        ) : canApproveInline ? (
          <>
            <button
              onClick={() => onApprove(item)}
              disabled={disabled || mutation === 'pending'}
              className="btn primary"
            >
              {mutation === 'pending' ? 'Approving…' : 'Approve'}
            </button>
            <button
              onClick={() => onReject(item)}
              disabled={disabled || mutation === 'pending'}
              className="btn ghost"
            >
              Reject
            </button>
            <Link
              href={linkFor(item)}
              className="btn ghost"
              style={{ marginLeft: 'auto' }}
            >
              Open →
            </Link>
          </>
        ) : isApproved ? (
          <Link
            href={linkFor(item)}
            className="btn primary"
            style={{ marginLeft: 'auto' }}
          >
            {item.type === 'recommendation' ? 'Execute →' : 'Open →'}
          </Link>
        ) : (
          <Link
            href={linkFor(item)}
            className="btn"
            style={{ marginLeft: 'auto' }}
          >
            Review →
          </Link>
        )}
      </div>
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
  );
}
