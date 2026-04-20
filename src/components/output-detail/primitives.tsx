'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

// Shared helpers used by every per-agent children block — action handler
// wrapper, pending/error state keyed by child id, and a few UI primitives
// (section header, card shell, action button row).

export type ActionMutation = 'pending' | 'done' | 'error';

export interface ChildActionState {
  mutations: Record<string, ActionMutation>;
  errors: Record<string, string>;
  feedback: Record<string, string>;
  replacing: Record<string, boolean>;
  setMutation: (id: string, m: ActionMutation | null) => void;
  setError: (id: string, msg: string) => void;
  setFeedback: (id: string, text: string) => void;
  setReplacing: (id: string, val: boolean) => void;
  /** Wrap a POST against a child-action endpoint. Handles pending state,
   *  error capture, and router.refresh on success. */
  run: (
    id: string,
    body: () => Promise<Response>,
    onSuccess?: (data: unknown) => void,
  ) => void;
  isPending: boolean;
}

export function useChildActions(): ChildActionState {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [mutations, setMutations] = useState<Record<string, ActionMutation>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [feedback, setFeedbackState] = useState<Record<string, string>>({});
  const [replacing, setReplacingState] = useState<Record<string, boolean>>({});

  const setMutation = (id: string, m: ActionMutation | null) =>
    setMutations((prev) => {
      const next = { ...prev };
      if (m == null) delete next[id];
      else next[id] = m;
      return next;
    });
  const setError = (id: string, msg: string) =>
    setErrors((prev) => ({ ...prev, [id]: msg }));
  const setFeedback = (id: string, text: string) =>
    setFeedbackState((prev) => ({ ...prev, [id]: text }));
  const setReplacing = (id: string, val: boolean) =>
    setReplacingState((prev) => ({ ...prev, [id]: val }));

  const run = (
    id: string,
    body: () => Promise<Response>,
    onSuccess?: (data: unknown) => void,
  ) => {
    setError(id, '');
    setMutation(id, 'pending');
    startTransition(async () => {
      try {
        const res = await body();
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error((data as { error?: string }).error || 'Action failed');
        }
        setMutation(id, 'done');
        onSuccess?.(data);
        router.refresh();
      } catch (e) {
        setMutation(id, 'error');
        setError(id, e instanceof Error ? e.message : 'Failed');
      }
    });
  };

  return {
    mutations,
    errors,
    feedback,
    replacing,
    setMutation,
    setError,
    setFeedback,
    setReplacing,
    run,
    isPending,
  };
}

// ---------------------------------------------------------------------------
// UI primitives — match the Assessment / output-detail design language
// (sharp corners, hairline borders, ink accents).
// ---------------------------------------------------------------------------

export function ChildrenSection({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section style={{ marginBottom: 32 }}>
      <h3
        style={{
          fontSize: 11,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: 'var(--ink-2)',
          margin: '0 0 14px',
          fontWeight: 500,
          paddingBottom: 8,
          borderBottom: '1px solid var(--rule)',
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
        }}
      >
        <span>{title}</span>
        {count != null && (
          <span
            className="mono"
            style={{ color: 'var(--ink-3)', letterSpacing: '0.05em' }}
          >
            {count}
          </span>
        )}
      </h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {children}
      </div>
    </section>
  );
}

export function ChildCard({
  acted,
  tone,
  children,
}: {
  acted?: boolean;
  tone?: 'critical' | 'warn' | 'default';
  children: React.ReactNode;
}) {
  const borderColor =
    tone === 'critical'
      ? 'var(--danger)'
      : tone === 'warn'
        ? 'var(--ink)'
        : 'var(--rule)';
  return (
    <div
      className="dash-card"
      style={{
        border: `1px solid ${borderColor}`,
        padding: '14px 16px',
        opacity: acted ? 0.7 : 1,
      }}
    >
      {children}
    </div>
  );
}

export function ChildHeader({
  title,
  chips,
  right,
}: {
  title: string;
  chips?: Array<{ label: string; tone?: 'default' | 'ok' | 'warn' | 'bad' }>;
  right?: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        flexWrap: 'wrap',
        justifyContent: 'space-between',
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <span
            style={{
              fontSize: 15,
              fontWeight: 500,
              letterSpacing: '-0.005em',
              color: 'var(--ink)',
            }}
          >
            {title}
          </span>
          {chips?.map((c, i) => (
            <Chip key={i} tone={c.tone}>
              {c.label}
            </Chip>
          ))}
        </div>
      </div>
      {right}
    </div>
  );
}

export function Chip({
  children,
  tone = 'default',
}: {
  children: React.ReactNode;
  tone?: 'default' | 'ok' | 'warn' | 'bad';
}) {
  const color =
    tone === 'ok'
      ? 'var(--ok)'
      : tone === 'warn'
        ? 'var(--ink)'
        : tone === 'bad'
          ? 'var(--danger)'
          : 'var(--ink-3)';
  const border =
    tone === 'ok'
      ? 'var(--ok)'
      : tone === 'warn'
        ? 'var(--ink)'
        : tone === 'bad'
          ? 'var(--danger)'
          : 'var(--rule)';
  return (
    <span
      className="mono"
      style={{
        fontSize: 10,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        padding: '2px 6px',
        border: `1px solid ${border}`,
        color,
      }}
    >
      {children}
    </span>
  );
}

export function ActionButton({
  children,
  onClick,
  disabled,
  tone = 'default',
  title,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  tone?: 'default' | 'primary' | 'ghost' | 'bad';
  title?: string;
}) {
  const styles: React.CSSProperties =
    tone === 'primary'
      ? { borderColor: 'var(--ink)', color: 'var(--ink)' }
      : tone === 'bad'
        ? { borderColor: 'var(--danger)', color: 'var(--danger)' }
        : tone === 'ghost'
          ? { borderColor: 'var(--rule)', color: 'var(--ink-3)' }
          : { borderColor: 'var(--rule)', color: 'var(--ink-2)' };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        ...styles,
        borderRadius: 0,
        borderStyle: 'solid',
        borderWidth: 1,
        background: 'transparent',
        padding: '6px 12px',
        fontSize: 11,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        fontWeight: 500,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        minHeight: 32,
      }}
    >
      {children}
    </button>
  );
}

export function ActionRow({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        marginTop: 12,
        display: 'flex',
        alignItems: 'stretch',
        flexWrap: 'wrap',
        gap: 8,
      }}
    >
      {children}
    </div>
  );
}

export function FeedbackInput({
  value,
  onChange,
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      style={{
        flex: 1,
        minWidth: 180,
        background: 'transparent',
        border: '1px solid var(--rule)',
        borderRadius: 0,
        padding: '6px 10px',
        fontSize: 12,
        color: 'var(--ink)',
        fontFamily: 'inherit',
      }}
    />
  );
}

export function ActedDecision({
  label,
  tone = 'ok',
  takenAt,
}: {
  label: string;
  tone?: 'ok' | 'muted' | 'bad';
  takenAt?: string | null;
}) {
  const color =
    tone === 'ok'
      ? 'var(--ok)'
      : tone === 'bad'
        ? 'var(--danger)'
        : 'var(--ink-3)';
  return (
    <div
      style={{
        marginTop: 12,
        fontSize: 12,
        color,
        letterSpacing: '0.02em',
      }}
    >
      {label}
      {takenAt && (
        <span
          className="mono"
          style={{
            color: 'var(--ink-3)',
            marginLeft: 8,
            fontSize: 10,
            letterSpacing: '0.06em',
          }}
        >
          · {formatTakenAt(takenAt)}
        </span>
      )}
    </div>
  );
}

export function ErrorLine({ msg }: { msg: string | undefined }) {
  if (!msg) return null;
  return (
    <p
      className="mono"
      style={{
        fontSize: 11,
        color: 'var(--danger)',
        marginTop: 8,
        letterSpacing: '0.04em',
      }}
    >
      {msg}
    </p>
  );
}

// Relative-ish time label; keeps the card light without full date parsing.
function formatTakenAt(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return iso.slice(0, 10);
  }
}
