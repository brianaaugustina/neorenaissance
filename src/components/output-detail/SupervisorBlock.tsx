'use client';

import { useState } from 'react';
import { Assessment, AssessmentSubhead } from './Assessment';
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
import type { SupervisorReportPayload } from './types';

// Renders the weekly supervisor report + agent-deep-dive outputs. Assessment
// merges the narrative (overall_assessment, feedback tracking, per-agent
// observations). Children: diff proposals (approve/reject), preference
// promotions (approve/reject), retrospective check-ins (read-only).
export function SupervisorBlock({
  payload,
  queueItemId,
}: {
  payload: SupervisorReportPayload;
  queueItemId: string | null;
}) {
  const actions = useChildActions();
  // Supervisor Approve returns the diff text for copy/paste into Claude Code.
  const [diffText, setDiffText] = useState<Record<string, string>>({});

  const approveProposal = (id: string) => {
    if (!queueItemId) {
      actions.setError(id, 'Queue item missing — cannot approve this proposal.');
      return;
    }
    actions.run(
      id,
      () =>
        fetch(`/api/agents/agent-supervisor/proposals/${id}/approve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ queueItemId }),
        }),
      (data) => {
        const maybeText = (data as { diffText?: string }).diffText;
        if (maybeText) setDiffText((prev) => ({ ...prev, [id]: maybeText }));
      },
    );
  };

  const rejectProposal = (id: string) => {
    if (!queueItemId) return;
    const reason = actions.feedback[id]?.trim();
    actions.run(id, () =>
      fetch(`/api/agents/agent-supervisor/proposals/${id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queueItemId, reason: reason || undefined }),
      }),
    );
  };

  const actOnPromotion = (id: string, action: 'approve' | 'reject') => {
    if (!queueItemId) return;
    const reason =
      action === 'reject' ? actions.feedback[id]?.trim() : undefined;
    actions.run(id, () =>
      fetch(`/api/agents/agent-supervisor/preferences/${id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          queueItemId,
          action,
          reason: reason || undefined,
        }),
      }),
    );
  };

  const proposals = payload.diff_proposals ?? [];
  const promotions = payload.preference_promotions ?? [];
  const retros = payload.retrospective_checkins ?? [];

  return (
    <>
      <Assessment html={buildSupervisorAssessmentHtml(payload)}>
        {/* Per-agent observations as structured cards below the narrative */}
        {(payload.per_agent_observations?.length ?? 0) > 0 && (
          <>
            <AssessmentSubhead>Per-agent observations</AssessmentSubhead>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {payload.per_agent_observations!.map((o, i) => (
                <div
                  key={i}
                  style={{
                    border: '1px solid var(--rule)',
                    padding: '12px 14px',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      gap: 8,
                      alignItems: 'baseline',
                      flexWrap: 'wrap',
                    }}
                  >
                    <span style={{ fontWeight: 500 }}>{o.agent}</span>
                    <span
                      className="mono"
                      style={{
                        fontSize: 10,
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                        padding: '1px 5px',
                        border: '1px solid var(--rule)',
                        color:
                          o.sample_size === 'high'
                            ? 'var(--ok)'
                            : o.sample_size === 'under-sampled'
                              ? 'var(--ink-3)'
                              : 'var(--ink-2)',
                      }}
                    >
                      {o.sample_size}
                    </span>
                    {o.approval_rate_this_window != null && (
                      <span
                        className="mono"
                        style={{ fontSize: 11, color: 'var(--ink-3)' }}
                      >
                        {(o.approval_rate_this_window * 100).toFixed(0)}%
                        approval ·{' '}
                        {o.output_volume} outputs
                      </span>
                    )}
                  </div>
                  {o.pattern && (
                    <p style={{ margin: '6px 0 0', fontSize: 13, lineHeight: 1.5 }}>
                      {o.pattern}
                    </p>
                  )}
                  {o.evidence.length > 0 && (
                    <p
                      className="mono"
                      style={{
                        fontSize: 11,
                        color: 'var(--ink-3)',
                        marginTop: 6,
                        letterSpacing: '0.04em',
                      }}
                    >
                      Evidence · {o.evidence.join(' · ')}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        {/* Feedback implementation tracking */}
        {(payload.feedback_implementation_tracking?.length ?? 0) > 0 && (
          <>
            <AssessmentSubhead>Feedback implementation</AssessmentSubhead>
            <ul
              style={{
                listStyle: 'none',
                padding: 0,
                margin: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              {payload.feedback_implementation_tracking!.map((f, i) => (
                <li key={i} style={{ fontSize: 13, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <span
                    className="mono"
                    style={{
                      fontSize: 10,
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      padding: '1px 5px',
                      border: `1px solid ${
                        f.absorbed === 'yes'
                          ? 'var(--ok)'
                          : f.absorbed === 'no'
                            ? 'var(--danger)'
                            : 'var(--rule)'
                      }`,
                      color:
                        f.absorbed === 'yes'
                          ? 'var(--ok)'
                          : f.absorbed === 'no'
                            ? 'var(--danger)'
                            : 'var(--ink-2)',
                    }}
                  >
                    {f.absorbed}
                  </span>
                  <span>&ldquo;{f.feedback_text.slice(0, 200)}&rdquo;</span>
                  <span
                    className="mono"
                    style={{ fontSize: 11, color: 'var(--ink-3)' }}
                  >
                    → {f.agents.join(', ')}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}

        {payload.summary && (
          <div
            style={{
              marginTop: 24,
              paddingLeft: 12,
              borderLeft: '2px solid var(--ink)',
            }}
          >
            <div
              className="mono"
              style={{
                fontSize: 10,
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                color: 'var(--ink-2)',
                marginBottom: 4,
                fontWeight: 500,
              }}
            >
              Summary
            </div>
            <p style={{ fontSize: 14, lineHeight: 1.55, margin: 0 }}>
              {payload.summary}
            </p>
          </div>
        )}
      </Assessment>

      {proposals.length > 0 && (
        <ChildrenSection title="Diff proposals" count={proposals.length}>
          {proposals.map((p) => {
            const acted = !!p.action_taken;
            const pending = actions.mutations[p.id] === 'pending';
            const justApproved = diffText[p.id];
            return (
              <ChildCard key={p.id} acted={acted}>
                <ChildHeader
                  title={`${p.agent} — ${p.file_path}`}
                  chips={[
                    {
                      label: p.confidence,
                      tone:
                        p.confidence === 'high'
                          ? 'ok'
                          : p.confidence === 'medium'
                            ? 'warn'
                            : 'default',
                    },
                    { label: p.reversibility },
                  ]}
                />
                <p
                  className="mono"
                  style={{
                    fontSize: 11,
                    color: 'var(--ink-3)',
                    letterSpacing: '0.04em',
                    margin: '4px 0 0',
                  }}
                >
                  Section · {p.section}
                </p>
                <p style={{ margin: '10px 0 0', fontSize: 14, lineHeight: 1.5 }}>
                  {p.hypothesis}
                </p>
                {p.current_text && (
                  <details style={{ marginTop: 10 }}>
                    <summary
                      style={{
                        cursor: 'pointer',
                        fontSize: 11,
                        color: 'var(--ink)',
                        letterSpacing: '0.04em',
                      }}
                    >
                      View current / proposed
                    </summary>
                    <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
                      <div>
                        <div
                          className="mono"
                          style={{
                            fontSize: 10,
                            letterSpacing: '0.14em',
                            textTransform: 'uppercase',
                            color: 'var(--ink-3)',
                            marginBottom: 4,
                          }}
                        >
                          Current
                        </div>
                        <pre
                          style={{
                            whiteSpace: 'pre-wrap',
                            border: '1px solid var(--rule)',
                            padding: 10,
                            fontSize: 12,
                            margin: 0,
                          }}
                        >
                          {p.current_text}
                        </pre>
                      </div>
                      <div>
                        <div
                          className="mono"
                          style={{
                            fontSize: 10,
                            letterSpacing: '0.14em',
                            textTransform: 'uppercase',
                            color: 'var(--ink-3)',
                            marginBottom: 4,
                          }}
                        >
                          Proposed
                        </div>
                        <pre
                          style={{
                            whiteSpace: 'pre-wrap',
                            border: '1px solid var(--ink)',
                            padding: 10,
                            fontSize: 12,
                            margin: 0,
                          }}
                        >
                          {p.proposed_text}
                        </pre>
                      </div>
                    </div>
                  </details>
                )}

                {acted ? (
                  <ActedDecision
                    label={
                      p.action_taken!.kind === 'approved'
                        ? '✓ Approved — apply via Claude Code'
                        : `✗ Rejected${p.action_taken!.note ? ` — ${p.action_taken!.note}` : ''}`
                    }
                    tone={p.action_taken!.kind === 'approved' ? 'ok' : 'muted'}
                    takenAt={p.action_taken!.taken_at}
                  />
                ) : (
                  <ActionRow>
                    <ActionButton
                      tone="primary"
                      disabled={pending}
                      onClick={() => approveProposal(p.id)}
                    >
                      Approve
                    </ActionButton>
                    <FeedbackInput
                      value={actions.feedback[p.id] ?? ''}
                      onChange={(v) => actions.setFeedback(p.id, v)}
                      placeholder="Rejection reason (optional)"
                      disabled={pending}
                    />
                    <ActionButton
                      tone="ghost"
                      disabled={pending}
                      onClick={() => rejectProposal(p.id)}
                    >
                      Reject
                    </ActionButton>
                  </ActionRow>
                )}

                {justApproved && (
                  <div
                    style={{
                      marginTop: 12,
                      border: '1px solid var(--ink)',
                      padding: 12,
                    }}
                  >
                    <div
                      className="mono"
                      style={{
                        fontSize: 10,
                        letterSpacing: '0.14em',
                        textTransform: 'uppercase',
                        color: 'var(--ink-2)',
                        marginBottom: 6,
                      }}
                    >
                      Apply via Claude Code — paste this
                    </div>
                    <pre
                      style={{
                        whiteSpace: 'pre-wrap',
                        fontSize: 12,
                        margin: 0,
                      }}
                    >
                      {justApproved}
                    </pre>
                  </div>
                )}

                <ErrorLine msg={actions.errors[p.id]} />
              </ChildCard>
            );
          })}
        </ChildrenSection>
      )}

      {promotions.length > 0 && (
        <ChildrenSection
          title="Preference promotions"
          count={promotions.length}
        >
          {promotions.map((p) => {
            const acted = !!p.action_taken;
            const pending = actions.mutations[p.id] === 'pending';
            return (
              <ChildCard key={p.id} acted={acted}>
                <ChildHeader
                  title={p.agent}
                  chips={[{ label: `${p.occurrence_count}× in window` }]}
                />
                <p style={{ margin: '10px 0 4px', fontSize: 14, lineHeight: 1.5 }}>
                  {p.rule_text}
                </p>
                <p
                  style={{
                    margin: 0,
                    fontSize: 12,
                    color: 'var(--ink-3)',
                    lineHeight: 1.5,
                  }}
                >
                  {p.rationale}
                </p>
                {acted ? (
                  <ActedDecision
                    label={
                      p.action_taken!.kind === 'approved'
                        ? '✓ Promoted to permanent preferences'
                        : '✗ Rejected'
                    }
                    tone={p.action_taken!.kind === 'approved' ? 'ok' : 'muted'}
                    takenAt={p.action_taken!.taken_at}
                  />
                ) : (
                  <ActionRow>
                    <ActionButton
                      tone="primary"
                      disabled={pending}
                      onClick={() => actOnPromotion(p.id, 'approve')}
                    >
                      Promote
                    </ActionButton>
                    <FeedbackInput
                      value={actions.feedback[p.id] ?? ''}
                      onChange={(v) => actions.setFeedback(p.id, v)}
                      placeholder="Rejection reason (optional)"
                      disabled={pending}
                    />
                    <ActionButton
                      tone="ghost"
                      disabled={pending}
                      onClick={() => actOnPromotion(p.id, 'reject')}
                    >
                      Reject
                    </ActionButton>
                  </ActionRow>
                )}
                <ErrorLine msg={actions.errors[p.id]} />
              </ChildCard>
            );
          })}
        </ChildrenSection>
      )}

      {retros.length > 0 && (
        <ChildrenSection
          title="30-day retrospectives"
          count={retros.length}
        >
          {retros.map((r, i) => (
            <ChildCard key={i}>
              <ChildHeader
                title={r.title}
                chips={[
                  {
                    label: r.verdict,
                    tone:
                      r.verdict === 'worked'
                        ? 'ok'
                        : r.verdict === 'did_not_work'
                          ? 'bad'
                          : 'warn',
                  },
                  ...(r.applied_at
                    ? [{ label: `applied ${r.applied_at.slice(0, 10)}` }]
                    : []),
                ]}
              />
              <p
                style={{
                  margin: '8px 0 0',
                  fontSize: 12,
                  color: 'var(--ink-2)',
                  lineHeight: 1.55,
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
                  Expected
                </span>
                {r.expected_effect}
              </p>
              <p
                style={{
                  margin: '4px 0 0',
                  fontSize: 12,
                  color: 'var(--ink-2)',
                  lineHeight: 1.55,
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
                  Observed
                </span>
                {r.observed_effect}
              </p>
            </ChildCard>
          ))}
        </ChildrenSection>
      )}

      {(payload.under_sampled_agents?.length ?? 0) > 0 && (
        <p
          className="mono"
          style={{
            marginTop: 24,
            fontSize: 11,
            color: 'var(--ink-3)',
            letterSpacing: '0.04em',
          }}
        >
          <span
            style={{
              textTransform: 'uppercase',
              letterSpacing: '0.12em',
              marginRight: 6,
            }}
          >
            Under-sampled
          </span>
          {payload.under_sampled_agents!.join(', ')}
        </p>
      )}
    </>
  );
}

// Compose the narrative fields into an HTML string that Assessment will
// sanitise + render. Escaping happens in the helper; DOMPurify is the
// backstop.
function buildSupervisorAssessmentHtml(payload: SupervisorReportPayload): string {
  const parts: string[] = [];
  if (payload.period) {
    parts.push(
      `<p class="mono" style="font-size:11px;letter-spacing:0.05em;color:var(--ink-3);margin:0 0 12px">${esc(
        payload.period.start,
      )} → ${esc(payload.period.end)}${
        payload.source_refs?.outputs_analyzed != null
          ? ` · ${payload.source_refs.outputs_analyzed} outputs analyzed`
          : ''
      }</p>`,
    );
  }
  if (payload.overall_assessment) {
    parts.push(paragraphise(payload.overall_assessment));
  }
  return parts.join('\n');
}

// Split a plaintext blob on blank lines → wrap each block in <p>. Preserves
// line breaks within a paragraph as <br/>. DOMPurify strips anything weird.
function paragraphise(text: string): string {
  return text
    .split(/\n\s*\n/)
    .map((block) => `<p>${esc(block.trim()).replace(/\n/g, '<br/>')}</p>`)
    .join('\n');
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
