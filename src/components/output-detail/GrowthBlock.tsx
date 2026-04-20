'use client';

import { Assessment } from './Assessment';
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
import type { GrowthBriefingPayload } from './types';

// Growth Strategist briefings (monthly pulse, quarterly review,
// channel/audience/cross-venture analyses). Each recommendation has three
// routing options — task, agent-work, new-agent — plus an always-available
// feedback channel that feeds the next run.
export function GrowthBlock({
  payload,
  queueItemId,
}: {
  payload: GrowthBriefingPayload;
  queueItemId: string | null;
}) {
  const actions = useChildActions();

  const route = (recId: string, kind: 'task' | 'agent-work' | 'new-agent') => {
    if (!queueItemId) {
      actions.setError(recId, 'Queue item missing — cannot route this recommendation.');
      return;
    }
    const path =
      kind === 'task'
        ? 'approve-as-task'
        : kind === 'agent-work'
          ? 'approve-as-agent-work'
          : 'new-agent-proposal';
    actions.run(recId, () =>
      fetch(`/api/agents/growth-strategist/recommendations/${recId}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queueItemId }),
      }),
    );
  };

  const submitFeedback = (recId: string) => {
    if (!queueItemId) return;
    const note = actions.feedback[recId]?.trim();
    if (!note) return;
    actions.run(recId, () =>
      fetch(`/api/agents/growth-strategist/recommendations/${recId}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queueItemId, note }),
      }),
    );
  };

  const recs = payload.recommendations ?? [];

  return (
    <>
      <Assessment html={buildGrowthAssessmentHtml(payload)} />

      {recs.length > 0 && (
        <ChildrenSection title="Recommendations" count={recs.length}>
          {recs.map((rec) => {
            const acted = !!rec.action_taken;
            const pending = actions.mutations[rec.id] === 'pending';
            const routingType = rec.routing?.type;

            return (
              <ChildCard key={rec.id} acted={acted}>
                <ChildHeader
                  title={rec.title}
                  chips={[
                    {
                      label: `${rec.confidence} confidence`,
                      tone:
                        rec.confidence === 'high'
                          ? 'ok'
                          : rec.confidence === 'medium'
                            ? 'warn'
                            : 'default',
                    },
                    { label: rec.brand_or_traction },
                    { label: rec.venture },
                    { label: `${rec.effort} effort` },
                  ]}
                />
                <p style={{ margin: '10px 0 0', fontSize: 14, lineHeight: 1.5 }}>
                  {rec.rationale}
                </p>
                <p
                  style={{
                    margin: '6px 0 0',
                    fontSize: 12,
                    color: 'var(--ink-3)',
                    lineHeight: 1.5,
                  }}
                >
                  <span
                    className="mono"
                    style={{
                      textTransform: 'uppercase',
                      letterSpacing: '0.12em',
                      marginRight: 6,
                    }}
                  >
                    Impact
                  </span>
                  {rec.expected_impact}
                </p>
                {rec.kr_reference && (
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
                        textTransform: 'uppercase',
                        letterSpacing: '0.12em',
                        marginRight: 6,
                      }}
                    >
                      KR
                    </span>
                    {rec.kr_reference}
                  </p>
                )}
                {rec.routing?.type === 'agent-work' &&
                  rec.routing.suggested_agent && (
                    <p
                      style={{
                        margin: '4px 0 0',
                        fontSize: 12,
                        color: 'var(--ink-3)',
                      }}
                    >
                      <span
                        className="mono"
                        style={{
                          textTransform: 'uppercase',
                          letterSpacing: '0.12em',
                          marginRight: 6,
                        }}
                      >
                        Suggests
                      </span>
                      {rec.routing.suggested_agent}
                    </p>
                  )}
                {rec.routing?.type === 'new-agent' &&
                  rec.routing.proposed_agent_name && (
                    <p
                      style={{
                        margin: '4px 0 0',
                        fontSize: 12,
                        color: 'var(--ink-3)',
                      }}
                    >
                      <span
                        className="mono"
                        style={{
                          textTransform: 'uppercase',
                          letterSpacing: '0.12em',
                          marginRight: 6,
                        }}
                      >
                        Proposes
                      </span>
                      new agent · {rec.routing.proposed_agent_name}
                    </p>
                  )}

                {acted ? (
                  <ActedDecision
                    label={
                      rec.action_taken!.kind === 'task'
                        ? '✓ Notion task created'
                        : rec.action_taken!.kind === 'agent-work'
                          ? `✓ Routed to ${rec.action_taken!.note ?? 'agent'} queue`
                          : `✓ New-agent proposal queued${rec.action_taken!.note ? ` (${rec.action_taken!.note})` : ''}`
                    }
                    tone="ok"
                    takenAt={rec.action_taken!.taken_at}
                  />
                ) : (
                  <ActionRow>
                    <ActionButton
                      tone={routingType === 'task' ? 'primary' : 'default'}
                      disabled={pending}
                      onClick={() => route(rec.id, 'task')}
                    >
                      {routingType === 'task' ? 'Approve as task ✓' : 'Approve as task'}
                    </ActionButton>
                    <ActionButton
                      tone={routingType === 'agent-work' ? 'primary' : 'default'}
                      disabled={pending}
                      onClick={() => route(rec.id, 'agent-work')}
                    >
                      {routingType === 'agent-work'
                        ? 'Approve as agent work ✓'
                        : 'Approve as agent work'}
                    </ActionButton>
                    <ActionButton
                      tone={routingType === 'new-agent' ? 'primary' : 'default'}
                      disabled={pending}
                      onClick={() => route(rec.id, 'new-agent')}
                    >
                      {routingType === 'new-agent'
                        ? 'Propose new agent ✓'
                        : 'Propose new agent'}
                    </ActionButton>
                  </ActionRow>
                )}

                {/* Feedback — non-terminal. Feeds into next Growth run. */}
                {rec.feedback ? (
                  <div
                    style={{
                      marginTop: 12,
                      paddingLeft: 10,
                      borderLeft: '2px solid var(--ink)',
                    }}
                  >
                    <div
                      className="mono"
                      style={{
                        fontSize: 10,
                        letterSpacing: '0.14em',
                        textTransform: 'uppercase',
                        color: 'var(--ink-2)',
                        marginBottom: 4,
                      }}
                    >
                      Your feedback
                    </div>
                    <p style={{ fontSize: 13, lineHeight: 1.5, margin: 0 }}>
                      {rec.feedback.note}
                    </p>
                  </div>
                ) : (
                  <ActionRow>
                    <FeedbackInput
                      value={actions.feedback[rec.id] ?? ''}
                      onChange={(v) => actions.setFeedback(rec.id, v)}
                      placeholder="Add context — what you know the agent doesn't (optional)"
                      disabled={pending}
                    />
                    <ActionButton
                      tone="ghost"
                      disabled={pending || !(actions.feedback[rec.id] ?? '').trim()}
                      onClick={() => submitFeedback(rec.id)}
                    >
                      Save feedback
                    </ActionButton>
                  </ActionRow>
                )}

                <ErrorLine msg={actions.errors[rec.id]} />
              </ChildCard>
            );
          })}
        </ChildrenSection>
      )}

      {payload.source_refs && (
        <p
          className="mono"
          style={{
            fontSize: 11,
            color: 'var(--ink-3)',
            letterSpacing: '0.04em',
            marginTop: 12,
          }}
        >
          Based on ·{' '}
          {payload.source_refs.analytics_period
            ? `Analytics ${payload.source_refs.analytics_period.start} → ${payload.source_refs.analytics_period.end}`
            : 'no analytics data'}
          {` · ${payload.source_refs.krs_count ?? 0} KRs`}
          {` · ${payload.source_refs.past_experiments_count ?? 0} past experiments`}
        </p>
      )}
    </>
  );
}

function buildGrowthAssessmentHtml(payload: GrowthBriefingPayload): string {
  const parts: string[] = [];
  if (payload.period) {
    parts.push(
      `<p class="mono" style="font-size:11px;letter-spacing:0.05em;color:var(--ink-3);margin:0 0 12px">${esc(
        payload.period.start,
      )} → ${esc(payload.period.end)}</p>`,
    );
  }
  if (payload.overall_assessment) {
    parts.push(paragraphise(payload.overall_assessment));
  }
  if (payload.summary && payload.summary !== payload.overall_assessment) {
    parts.push(
      `<p style="margin-top:16px;padding-left:12px;border-left:2px solid var(--ink)">${esc(
        payload.summary,
      ).replace(/\n/g, '<br/>')}</p>`,
    );
  }
  return parts.join('\n');
}

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
