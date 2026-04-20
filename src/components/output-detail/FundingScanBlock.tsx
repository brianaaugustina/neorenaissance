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
import type {
  FundingOpportunityCard,
  FundingOpportunityScanPayload,
} from './types';

// Funding Scout opportunity scan — per-opportunity Approve / Skip / Replace.
// Each card shows the fit rationale, eligibility, and a funder / Notion link.
export function FundingScanBlock({
  payload,
  queueItemId,
}: {
  payload: FundingOpportunityScanPayload;
  queueItemId: string | null;
}) {
  const actions = useChildActions();

  const approve = (id: string) => {
    if (!queueItemId) {
      actions.setError(id, 'Queue item missing — cannot approve.');
      return;
    }
    actions.run(id, () =>
      fetch('/api/agents/funding-scout/opportunities/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queueItemId, opportunityId: id }),
      }),
    );
  };

  const skip = (id: string) => {
    if (!queueItemId) return;
    const feedback = actions.feedback[id]?.trim();
    actions.run(id, () =>
      fetch('/api/agents/funding-scout/opportunities/skip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          queueItemId,
          opportunityId: id,
          feedback: feedback || undefined,
        }),
      }),
    );
  };

  const replace = (id: string) => {
    if (!queueItemId) return;
    const feedback = actions.feedback[id]?.trim();
    actions.setReplacing(id, true);
    actions.run(
      id,
      () =>
        fetch('/api/agents/funding-scout/opportunities/replace', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            queueItemId,
            opportunityId: id,
            feedback: feedback || undefined,
          }),
        }),
      () => {
        actions.setFeedback(id, '');
        actions.setReplacing(id, false);
      },
    );
  };

  const opportunities = payload.opportunities ?? [];

  return (
    <>
      <Assessment
        html={`<p>Reviewed ${payload.total_reviewed ?? 0}, surfacing ${
          opportunities.length
        }.</p>`}
      />

      {opportunities.length > 0 && (
        <ChildrenSection
          title="Opportunities"
          count={opportunities.length}
        >
          {opportunities.map((opp) => (
            <OpportunityCard
              key={opp.opportunity_id}
              opp={opp}
              mutation={actions.mutations[opp.opportunity_id]}
              error={actions.errors[opp.opportunity_id]}
              feedback={actions.feedback[opp.opportunity_id] ?? ''}
              replacing={!!actions.replacing[opp.opportunity_id]}
              onFeedback={(v) => actions.setFeedback(opp.opportunity_id, v)}
              onApprove={() => approve(opp.opportunity_id)}
              onSkip={() => skip(opp.opportunity_id)}
              onReplace={() => replace(opp.opportunity_id)}
            />
          ))}
        </ChildrenSection>
      )}

      {Array.isArray(payload.candidates_not_surfaced) &&
        payload.candidates_not_surfaced.length > 0 && (
          <details style={{ marginTop: 16 }}>
            <summary
              className="mono"
              style={{
                cursor: 'pointer',
                fontSize: 11,
                color: 'var(--ink-3)',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
              }}
            >
              {payload.candidates_not_surfaced.length} candidates skipped by the fit test
            </summary>
            <ul
              style={{
                margin: '8px 0 0',
                padding: 0,
                listStyle: 'none',
                fontSize: 12,
                color: 'var(--ink-3)',
              }}
            >
              {payload.candidates_not_surfaced.map((c, i) => (
                <li key={i} style={{ padding: '4px 0' }}>
                  <span style={{ fontWeight: 500, color: 'var(--ink-2)' }}>
                    {c.funder}
                  </span>{' '}
                  — {c.opportunity_name}: {c.skip_reason}
                </li>
              ))}
            </ul>
          </details>
        )}
    </>
  );
}

function OpportunityCard({
  opp,
  mutation,
  error,
  feedback,
  replacing,
  onFeedback,
  onApprove,
  onSkip,
  onReplace,
}: {
  opp: FundingOpportunityCard;
  mutation: 'pending' | 'done' | 'error' | undefined;
  error: string | undefined;
  feedback: string;
  replacing: boolean;
  onFeedback: (v: string) => void;
  onApprove: () => void;
  onSkip: () => void;
  onReplace: () => void;
}) {
  const isDone = opp.approved || mutation === 'done';
  const isApproving = mutation === 'pending';
  const isSkipped = opp.skipped;
  const amountLabel =
    opp.funding_amount != null
      ? `$${opp.funding_amount.toLocaleString()}`
      : 'variable';
  const effortHoursLabel =
    opp.effort_hours_low != null && opp.effort_hours_high != null
      ? ` (${opp.effort_hours_low}–${opp.effort_hours_high}h)`
      : '';

  return (
    <ChildCard acted={isDone || isSkipped}>
      <ChildHeader
        title={`${opp.funder} — ${opp.opportunity_name}`}
        chips={[
          {
            label: opp.recommendation,
            tone:
              opp.recommendation === 'Apply'
                ? 'ok'
                : opp.recommendation === 'Flag for review'
                  ? 'warn'
                  : 'default',
          },
          { label: `${opp.effort_estimate}${effortHoursLabel}` },
          { label: `fit ${opp.fit_score_out_of_six}/6` },
          { label: opp.funding_type },
          { label: amountLabel },
          ...(opp.application_deadline
            ? [{ label: `deadline ${opp.application_deadline}` }]
            : []),
        ]}
        right={
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            <ActionButton
              tone={isDone ? 'ghost' : 'primary'}
              disabled={isDone || isApproving || replacing || isSkipped}
              onClick={onApprove}
            >
              {isDone
                ? 'Draft queued'
                : isApproving
                  ? 'Drafting…'
                  : isSkipped
                    ? 'Skipped'
                    : 'Approve + Draft'}
            </ActionButton>
            {!isDone && !isSkipped && (
              <ActionButton
                tone="ghost"
                disabled={isApproving || replacing}
                onClick={onSkip}
              >
                Skip
              </ActionButton>
            )}
          </div>
        }
      />
      {opp.ventures.length > 0 && (
        <div
          style={{
            display: 'flex',
            gap: 4,
            flexWrap: 'wrap',
            marginTop: 8,
          }}
        >
          {opp.ventures.map((v, i) => (
            <span
              key={i}
              className="mono"
              style={{
                fontSize: 10,
                letterSpacing: '0.08em',
                padding: '1px 5px',
                border: '1px solid var(--rule)',
                color: 'var(--ink-3)',
              }}
            >
              {v}
            </span>
          ))}
        </div>
      )}
      <p style={{ margin: '10px 0 0', fontSize: 14, lineHeight: 1.5 }}>
        {opp.reason_for_match}
      </p>
      {opp.eligibility_criteria && (
        <p
          style={{
            margin: '6px 0 0',
            fontSize: 12,
            color: 'var(--ink-3)',
            fontStyle: 'italic',
          }}
        >
          eligibility · {opp.eligibility_criteria}
        </p>
      )}
      <p
        style={{
          margin: '4px 0 0',
          fontSize: 12,
          color: 'var(--ink-3)',
          display: 'flex',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        {opp.source_url && (
          <a
            href={opp.source_url}
            target="_blank"
            rel="noreferrer"
            style={{ color: 'var(--ink)' }}
          >
            funder page ↗
          </a>
        )}
        {opp.notion_row_id && (
          <a
            href={`https://www.notion.so/${opp.notion_row_id.replace(/-/g, '')}`}
            target="_blank"
            rel="noreferrer"
            style={{ color: 'var(--ink)' }}
          >
            open funding row ↗
          </a>
        )}
      </p>

      {isDone && (
        <ActedDecision label="✓ Application draft queued" tone="ok" />
      )}
      {isSkipped && <ActedDecision label="✗ Skipped" tone="muted" />}

      {!isDone && !isSkipped && (
        <ActionRow>
          <FeedbackInput
            value={feedback}
            onChange={onFeedback}
            placeholder="Feedback for replacement or skip reason (optional)"
            disabled={isApproving || replacing}
          />
          <ActionButton
            tone="ghost"
            disabled={isApproving || replacing}
            onClick={onReplace}
          >
            {replacing ? 'Replacing…' : 'Replace'}
          </ActionButton>
        </ActionRow>
      )}
      <ErrorLine msg={error} />
    </ChildCard>
  );
}
