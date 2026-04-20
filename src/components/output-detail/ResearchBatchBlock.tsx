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
import type { ResearchBatchPayload, ResearchLead } from './types';

// Shared child renderer for Sponsorship / PR / Talent research batches. Each
// agent emits a leads[] array with slightly different fields; the lead-card
// picks up whichever shape is present.
//
// Actions all route to `${agentRoutePrefix}/leads/approve` and
// `${agentRoutePrefix}/leads/replace` — same contract as QueueCard.
export function ResearchBatchBlock({
  payload,
  queueItemId,
  agentId,
}: {
  payload: ResearchBatchPayload;
  queueItemId: string | null;
  agentId: string;
}) {
  const actions = useChildActions();
  const routePrefix = `/api/agents/${agentId}`;

  const approveLead = (leadId: string) => {
    if (!queueItemId) {
      actions.setError(leadId, 'Queue item missing — cannot approve this lead.');
      return;
    }
    actions.run(leadId, () =>
      fetch(`${routePrefix}/leads/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queueItemId, leadId }),
      }),
    );
  };

  const replaceLead = (leadId: string) => {
    if (!queueItemId) return;
    const fb = actions.feedback[leadId]?.trim();
    actions.setReplacing(leadId, true);
    actions.run(
      leadId,
      () =>
        fetch(`${routePrefix}/leads/replace`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            queueItemId,
            leadId,
            feedback: fb || undefined,
          }),
        }),
      () => {
        actions.setFeedback(leadId, '');
        actions.setReplacing(leadId, false);
      },
    );
  };

  const leads = payload.leads ?? [];
  const summary = buildBatchAssessmentHtml(payload);

  return (
    <>
      <Assessment html={summary} />

      {payload.parse_diagnostic && (
        <div
          style={{
            marginBottom: 20,
            padding: 12,
            border: '1px solid var(--danger)',
            fontSize: 12,
            color: 'var(--ink)',
          }}
        >
          <div
            className="mono"
            style={{
              fontSize: 10,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: 'var(--danger)',
              marginBottom: 6,
            }}
          >
            Parse diagnostic — 0 leads surfaced
          </div>
          <p style={{ margin: 0, color: 'var(--ink-3)' }}>
            reason · {payload.parse_diagnostic.reason} ·{' '}
            {payload.parse_diagnostic.likely_truncated
              ? 'likely output-token truncation'
              : 'structure mismatch'}
          </p>
          <p style={{ margin: '4px 0 0', color: 'var(--ink-3)' }}>
            raw output · {payload.parse_diagnostic.raw_output_length} chars
          </p>
          <details style={{ marginTop: 6 }}>
            <summary style={{ cursor: 'pointer', color: 'var(--ink)' }}>
              first 1000 chars
            </summary>
            <pre
              style={{
                whiteSpace: 'pre-wrap',
                fontSize: 11,
                color: 'var(--ink-3)',
                margin: '6px 0 0',
              }}
            >
              {payload.parse_diagnostic.raw_output_snippet}
            </pre>
          </details>
        </div>
      )}

      {leads.length > 0 && (
        <ChildrenSection title="Leads" count={leads.length}>
          {leads.map((lead) => {
            const mutation = actions.mutations[lead.lead_id];
            const isDone = lead.approved || mutation === 'done';
            const isApproving = mutation === 'pending';
            const isReplacing = !!actions.replacing[lead.lead_id];

            return (
              <ChildCard key={lead.lead_id} acted={isDone}>
                <ChildHeader
                  title={leadTitle(lead)}
                  chips={leadChips(lead)}
                  right={
                    <ActionButton
                      tone={isDone ? 'ghost' : 'primary'}
                      disabled={isDone || isApproving || isReplacing}
                      onClick={() => approveLead(lead.lead_id)}
                    >
                      {isDone
                        ? 'Draft queued'
                        : isApproving
                          ? 'Drafting…'
                          : 'Approve lead'}
                    </ActionButton>
                  }
                />
                <LeadMeta lead={lead} />

                {!isDone && (
                  <ActionRow>
                    <FeedbackInput
                      value={actions.feedback[lead.lead_id] ?? ''}
                      onChange={(v) => actions.setFeedback(lead.lead_id, v)}
                      placeholder="Feedback to guide a replacement (optional)"
                      disabled={isApproving || isReplacing}
                    />
                    <ActionButton
                      tone="ghost"
                      disabled={isApproving || isReplacing}
                      onClick={() => replaceLead(lead.lead_id)}
                    >
                      {isReplacing ? 'Replacing…' : 'Replace'}
                    </ActionButton>
                  </ActionRow>
                )}

                {isDone && lead.draft_output_id && (
                  <ActedDecision
                    label="✓ Pitch draft queued"
                    tone="ok"
                    takenAt={lead.replaced_at ?? null}
                  />
                )}

                <ErrorLine msg={actions.errors[lead.lead_id]} />
              </ChildCard>
            );
          })}
        </ChildrenSection>
      )}

      {leads.length === 0 && !payload.parse_diagnostic && (
        <p
          className="mono"
          style={{
            fontSize: 12,
            color: 'var(--ink-3)',
            letterSpacing: '0.04em',
          }}
        >
          No leads in this batch.
        </p>
      )}
    </>
  );
}

function leadTitle(lead: ResearchLead): string {
  if (lead.brand_name) return lead.brand_name;
  if (lead.artisan_name) return lead.artisan_name;
  if (lead.journalist_name && lead.outlet) {
    return `${lead.journalist_name} · ${lead.outlet}`;
  }
  return lead.outlet ?? lead.journalist_name ?? 'Lead';
}

function leadChips(lead: ResearchLead): Array<{
  label: string;
  tone?: 'default' | 'ok' | 'warn' | 'bad';
}> {
  const chips: Array<{
    label: string;
    tone?: 'default' | 'ok' | 'warn' | 'bad';
  }> = [];
  const tierLabel = lead.tier ?? lead.outlet_tier;
  if (tierLabel) chips.push({ label: tierLabel });
  if (lead.trade) chips.push({ label: lead.trade });
  if (lead.fit_score != null) chips.push({ label: `fit ${lead.fit_score}/5` });
  if (lead.venn_test_result)
    chips.push({ label: `venn ${lead.venn_test_result}` });
  if (lead.location) chips.push({ label: lead.location });
  if (lead.suggested_channel)
    chips.push({ label: lead.suggested_channel, tone: 'warn' });
  if (lead.suggested_voice_mode) chips.push({ label: lead.suggested_voice_mode });
  if (lead.trade_gap_fill) chips.push({ label: 'gap-fill', tone: 'ok' });
  return chips;
}

function LeadMeta({ lead }: { lead: ResearchLead }) {
  const contactLine =
    lead.contact_name || lead.journalist_name
      ? `${lead.contact_name ?? lead.journalist_name}${
          lead.contact_role || lead.role
            ? ` · ${lead.contact_role ?? lead.role}`
            : ''
        }${lead.contact_email ? ` · ${lead.contact_email}` : ''}`
      : lead.contact_flag === 'no-named-contact'
        ? 'no named contact found — agent flagged for manual research'
        : 'contact unverified';
  return (
    <>
      <p
        className="mono"
        style={{
          fontSize: 11,
          color: 'var(--ink-3)',
          margin: '6px 0 0',
          letterSpacing: '0.04em',
        }}
      >
        {contactLine}
      </p>
      <p style={{ margin: '10px 0 0', fontSize: 14, lineHeight: 1.5 }}>
        {lead.fit_rationale}
      </p>
      {lead.discovery_story && (
        <p
          style={{
            margin: '6px 0 0',
            fontSize: 12,
            color: 'var(--ink-3)',
            fontStyle: 'italic',
          }}
        >
          discovered · {lead.discovery_story}
        </p>
      )}
      {(lead.suggested_episode || lead.episode_pairing) && (
        <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--ink-3)' }}>
          pair with · {lead.suggested_episode ?? lead.episode_pairing}
        </p>
      )}
      {lead.suggested_angle && (
        <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--ink-3)' }}>
          angle · {lead.suggested_angle}
        </p>
      )}
      {(lead.source_note || lead.source_link) && (
        <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--ink-3)' }}>
          source ·{' '}
          {lead.source_link ? (
            <a
              href={lead.source_link}
              target="_blank"
              rel="noreferrer"
              style={{ color: 'var(--ink)' }}
            >
              recent piece ↗
            </a>
          ) : (
            lead.source_note
          )}
        </p>
      )}
    </>
  );
}

function buildBatchAssessmentHtml(payload: ResearchBatchPayload): string {
  const bits: string[] = [];
  bits.push(
    `<p>Reviewed ${payload.total_reviewed ?? 0}, surfacing ${
      payload.leads?.length ?? 0
    }${payload.season ? ` · ${esc(payload.season)}` : ''}${
      payload.landscape_briefing_date
        ? ` · landscape ${esc(payload.landscape_briefing_date)}`
        : ''
    }.</p>`,
  );
  return bits.join('\n');
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
