'use client';

import { useState } from 'react';
import {
  Assessment,
  AssessmentStatRow,
  AssessmentSubhead,
} from './Assessment';
import {
  ActedDecision,
  ActionButton,
  ActionRow,
  ChildCard,
  ChildHeader,
  ChildrenSection,
  ErrorLine,
  FeedbackInput,
  useChildActions,
} from './primitives';
import type {
  SystemEngineerFinding,
  SystemEngineerReportPayload,
} from './types';

// System Engineer weekly codebase health report. Assessment combines the
// top_line narrative, severity stat row, and repo/Vercel coverage. Children:
// findings grouped Critical / Medium / Low with Fix / Defer / Ignore / Expand
// per finding.
export function SystemEngineerBlock({
  payload,
  queueItemId,
}: {
  payload: SystemEngineerReportPayload;
  queueItemId: string | null;
}) {
  const actions = useChildActions();
  const [expansions, setExpansions] = useState<Record<string, string>>({});

  const fixFinding = (id: string) => {
    if (!queueItemId) {
      actions.setError(id, 'Queue item missing.');
      return;
    }
    actions.run(id, () =>
      fetch(`/api/agents/system-engineer/findings/${id}/fix`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queueItemId }),
      }),
    );
  };

  const deferFinding = (id: string) => {
    if (!queueItemId) return;
    const reason = actions.feedback[id]?.trim();
    if (!reason) {
      actions.setError(
        id,
        'Defer reason required — tell the agent why so it does not re-surface.',
      );
      return;
    }
    actions.run(id, () =>
      fetch(`/api/agents/system-engineer/findings/${id}/defer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queueItemId, reason }),
      }),
    );
  };

  const ignoreFinding = (id: string) => {
    if (!queueItemId) return;
    actions.run(id, () =>
      fetch(`/api/agents/system-engineer/findings/${id}/ignore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queueItemId }),
      }),
    );
  };

  const expandFinding = (id: string) => {
    if (!queueItemId) return;
    actions.run(
      id,
      () =>
        fetch(`/api/agents/system-engineer/findings/${id}/expand`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ queueItemId }),
        }),
      (data) => {
        const text = (data as { expansion?: string }).expansion;
        if (text) setExpansions((prev) => ({ ...prev, [id]: text }));
      },
    );
  };

  const counts = payload.severity_counts ?? { critical: 0, medium: 0, low: 0 };
  const findings = payload.findings ?? [];

  return (
    <>
      <Assessment html={payload.top_line ? `<p>${esc(payload.top_line)}</p>` : ''}>
        <AssessmentStatRow
          stats={[
            { n: counts.critical, label: 'Critical', tone: counts.critical > 0 ? 'bad' : 'default' },
            { n: counts.medium, label: 'Medium', tone: counts.medium > 0 ? 'warn' : 'default' },
            { n: counts.low, label: 'Low' },
          ]}
        />

        {(payload.repos?.length ?? 0) > 0 && (
          <>
            <AssessmentSubhead>Repos scanned</AssessmentSubhead>
            <ul
              style={{
                listStyle: 'none',
                padding: 0,
                margin: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                fontSize: 13,
              }}
            >
              {payload.repos!.map((r) => (
                <li key={r.short_id}>
                  <span style={{ fontWeight: 500 }}>{r.label}</span>{' '}
                  <span style={{ color: 'var(--ink-3)' }}>
                    ·{' '}
                    {r.configured ? (
                      r.error ? (
                        <span style={{ color: 'var(--danger)' }}>
                          error: {r.error.slice(0, 80)}
                        </span>
                      ) : (
                        <>
                          {r.findings_count} finding
                          {r.findings_count === 1 ? '' : 's'}
                        </>
                      )
                    ) : (
                      <span style={{ color: 'var(--ink-3)' }}>not configured</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}

        {payload.vercel && (
          <>
            <AssessmentSubhead>Vercel</AssessmentSubhead>
            {payload.vercel.configured ? (
              <>
                <p style={{ fontSize: 13, color: 'var(--ink-3)', margin: 0 }}>
                  {payload.vercel.deployments_last_7d ?? 0} deployments · last 7d
                </p>
                {Array.isArray(payload.vercel.failed_deployments) &&
                  payload.vercel.failed_deployments.length > 0 && (
                    <ul
                      style={{
                        listStyle: 'none',
                        padding: 0,
                        margin: '6px 0 0',
                        fontSize: 12,
                        color: 'var(--danger)',
                      }}
                    >
                      {payload.vercel.failed_deployments.slice(0, 4).map((d) => (
                        <li key={d.uid}>
                          ⚠ {d.state} · {d.name ?? 'unnamed'} ·{' '}
                          {d.created_at.slice(0, 10)}
                        </li>
                      ))}
                    </ul>
                  )}
              </>
            ) : (
              <p style={{ fontSize: 13, color: 'var(--ink-3)', margin: 0 }}>
                {payload.vercel.error ?? 'not configured'}
              </p>
            )}
          </>
        )}
      </Assessment>

      {findings.length === 0 ? (
        <p
          style={{
            fontSize: 13,
            color: 'var(--ink-3)',
            padding: '16px 0',
          }}
        >
          No findings this scan — everything looks clean across the configured repos.
        </p>
      ) : (
        (['critical', 'medium', 'low'] as const).map((sev) => {
          const group = findings.filter((f) => f.severity === sev);
          if (group.length === 0) return null;
          return (
            <ChildrenSection
              key={sev}
              title={
                sev === 'critical'
                  ? 'Critical'
                  : sev === 'medium'
                    ? 'Medium'
                    : 'Low'
              }
              count={group.length}
            >
              {group.map((f) => (
                <FindingCard
                  key={f.id}
                  finding={f}
                  mutation={actions.mutations[f.id]}
                  error={actions.errors[f.id]}
                  feedback={actions.feedback[f.id] ?? ''}
                  expansion={expansions[f.id]}
                  onFeedback={(v) => actions.setFeedback(f.id, v)}
                  onFix={() => fixFinding(f.id)}
                  onDefer={() => deferFinding(f.id)}
                  onIgnore={() => ignoreFinding(f.id)}
                  onExpand={() => expandFinding(f.id)}
                />
              ))}
            </ChildrenSection>
          );
        })
      )}
    </>
  );
}

function FindingCard({
  finding: f,
  mutation,
  error,
  feedback,
  expansion,
  onFeedback,
  onFix,
  onDefer,
  onIgnore,
  onExpand,
}: {
  finding: SystemEngineerFinding;
  mutation: 'pending' | 'done' | 'error' | undefined;
  error: string | undefined;
  feedback: string;
  expansion: string | undefined;
  onFeedback: (v: string) => void;
  onFix: () => void;
  onDefer: () => void;
  onIgnore: () => void;
  onExpand: () => void;
}) {
  const acted = !!f.action_taken;
  const pending = mutation === 'pending';
  const tone: 'critical' | 'warn' | 'default' =
    f.severity === 'critical'
      ? 'critical'
      : f.severity === 'medium'
        ? 'warn'
        : 'default';
  return (
    <ChildCard acted={acted} tone={tone}>
      <ChildHeader
        title={f.title}
        chips={[
          { label: f.id, tone: tone === 'critical' ? 'bad' : tone === 'warn' ? 'warn' : 'default' },
          { label: f.category },
          { label: `${f.effort} effort` },
          ...(f.status === 'persisting' && f.days_open != null
            ? [{ label: `open ${f.days_open}d`, tone: 'warn' as const }]
            : []),
          ...(f.status === 'reopened'
            ? [{ label: 'reopened', tone: 'bad' as const }]
            : []),
        ]}
      />
      <p
        style={{
          margin: '8px 0 0',
          fontSize: 13,
          color: 'var(--ink-2)',
          lineHeight: 1.5,
        }}
      >
        <span
          className="mono"
          style={{
            fontSize: 10,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            marginRight: 6,
            color: 'var(--ink-3)',
          }}
        >
          Impact
        </span>
        {f.impact}
      </p>
      <p
        style={{
          margin: '4px 0 0',
          fontSize: 13,
          color: 'var(--ink-2)',
          lineHeight: 1.5,
        }}
      >
        <span
          className="mono"
          style={{
            fontSize: 10,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            marginRight: 6,
            color: 'var(--ink-3)',
          }}
        >
          Fix
        </span>
        {f.fix_suggestion}
      </p>
      {f.file_refs.length > 0 && (
        <p
          style={{
            margin: '4px 0 0',
            fontSize: 12,
            color: 'var(--ink-3)',
            lineHeight: 1.5,
          }}
        >
          <span
            className="mono"
            style={{
              fontSize: 10,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              marginRight: 6,
            }}
          >
            Files
          </span>
          {f.file_refs.join(' · ')}
        </p>
      )}

      {expansion && (
        <div
          style={{
            marginTop: 10,
            border: '1px solid var(--ink)',
            padding: 10,
            fontSize: 12,
            whiteSpace: 'pre-wrap',
            lineHeight: 1.5,
          }}
        >
          {expansion}
        </div>
      )}

      {acted ? (
        <ActedDecision
          label={
            f.action_taken!.kind === 'fix'
              ? '✓ Marked Fix — re-surfaces if still present after 14d'
              : f.action_taken!.kind === 'defer'
                ? `✗ Deferred${f.action_taken!.note ? ` — ${f.action_taken!.note}` : ''}`
                : '✗ Ignored — will not re-surface'
          }
          tone={f.action_taken!.kind === 'fix' ? 'ok' : 'muted'}
          takenAt={f.action_taken!.taken_at}
        />
      ) : (
        <ActionRow>
          <ActionButton
            tone="primary"
            disabled={pending}
            onClick={onFix}
          >
            Fix
          </ActionButton>
          <FeedbackInput
            value={feedback}
            onChange={onFeedback}
            placeholder="Defer reason (required)"
            disabled={pending}
          />
          <ActionButton tone="ghost" disabled={pending} onClick={onDefer}>
            Defer
          </ActionButton>
          <ActionButton tone="ghost" disabled={pending} onClick={onIgnore}>
            Ignore
          </ActionButton>
          <ActionButton tone="ghost" disabled={pending} onClick={onExpand}>
            {pending ? 'Expanding…' : 'Expand'}
          </ActionButton>
        </ActionRow>
      )}

      <ErrorLine msg={error} />
    </ChildCard>
  );
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
