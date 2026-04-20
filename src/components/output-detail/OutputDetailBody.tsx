'use client';

import { LandscapeBody } from '@/components/LandscapeBody';
import { Assessment } from './Assessment';
import { CaptionsBlock } from './CaptionsBlock';
import { FundingScanBlock } from './FundingScanBlock';
import { GrowthBlock } from './GrowthBlock';
import { ResearchBatchBlock } from './ResearchBatchBlock';
import { SupervisorBlock } from './SupervisorBlock';
import { SystemEngineerBlock } from './SystemEngineerBlock';
import type {
  FundingOpportunityScanPayload,
  GrowthBriefingPayload,
  ResearchBatchPayload,
  ShowrunnerCaptionsPayload,
  SupervisorReportPayload,
  SystemEngineerReportPayload,
} from './types';

// Top-level dispatcher. Routes to the right per-type Assessment + Children
// block based on agentId + outputType. Falls through to a light default
// that shows briefings via LandscapeBody and/or surfaces a few narrative
// string fields. The collapsible raw-JSON debug block lives in the page,
// not here.
export function OutputDetailBody({
  agentId,
  outputType,
  content,
  queueItemId,
  queueStatus,
}: {
  agentId: string;
  outputType: string;
  content: Record<string, unknown>;
  queueItemId: string | null;
  queueStatus: string | null;
}) {
  const normalisedAgent = agentId.replace(/_/g, '-');

  // Agent Supervisor
  if (
    normalisedAgent === 'agent-supervisor' &&
    (outputType === 'weekly_supervisor_report' || outputType === 'agent_deep_dive')
  ) {
    return (
      <SupervisorBlock
        payload={content as SupervisorReportPayload}
        queueItemId={queueItemId}
      />
    );
  }

  // Growth Strategist
  if (
    normalisedAgent === 'growth-strategist' &&
    (outputType === 'monthly_pulse_check' ||
      outputType === 'quarterly_growth_review' ||
      outputType === 'channel_recommendation' ||
      outputType === 'audience_analysis' ||
      outputType === 'cross_venture_synergy')
  ) {
    return (
      <GrowthBlock
        payload={content as GrowthBriefingPayload}
        queueItemId={queueItemId}
      />
    );
  }

  // Research batches — Sponsorship / PR / Talent
  if (
    (normalisedAgent === 'sponsorship-director' ||
      normalisedAgent === 'pr-director' ||
      normalisedAgent === 'talent-scout') &&
    Array.isArray((content as { leads?: unknown[] }).leads)
  ) {
    return (
      <ResearchBatchBlock
        payload={content as ResearchBatchPayload}
        queueItemId={queueItemId}
        agentId={normalisedAgent}
      />
    );
  }

  // Funding Scout opportunity scan
  if (
    normalisedAgent === 'funding-scout' &&
    Array.isArray((content as { opportunities?: unknown[] }).opportunities)
  ) {
    return (
      <FundingScanBlock
        payload={content as FundingOpportunityScanPayload}
        queueItemId={queueItemId}
      />
    );
  }

  // System Engineer codebase health report
  if (
    normalisedAgent === 'system-engineer' &&
    outputType === 'weekly_codebase_health_report'
  ) {
    return (
      <SystemEngineerBlock
        payload={content as SystemEngineerReportPayload}
        queueItemId={queueItemId}
      />
    );
  }

  // Showrunner social-captions batch
  if (
    normalisedAgent === 'showrunner' &&
    (outputType === 'social_caption' ||
      (content as { output_kind?: string }).output_kind === 'social_captions')
  ) {
    return (
      <CaptionsBlock
        payload={content as ShowrunnerCaptionsPayload}
        queueStatus={queueStatus}
      />
    );
  }

  // ─── Fallback: briefings + simple narratives ────────────────────────────
  // Ops Chief daily briefing / editorial landscape briefing carry either
  // briefing_html or briefing_markdown; render through LandscapeBody.
  const briefingHtml = typeof (content as { briefing_html?: unknown }).briefing_html === 'string'
    ? ((content as { briefing_html: string }).briefing_html)
    : typeof (content as { html?: unknown }).html === 'string'
      ? ((content as { html: string }).html)
      : undefined;
  const briefingMarkdown = typeof (content as { briefing_markdown?: unknown }).briefing_markdown === 'string'
    ? ((content as { briefing_markdown: string }).briefing_markdown)
    : typeof (content as { markdown?: unknown }).markdown === 'string'
      ? ((content as { markdown: string }).markdown)
      : undefined;
  if (briefingHtml || briefingMarkdown) {
    return (
      <section
        style={{
          marginBottom: 36,
          paddingBottom: 32,
          borderBottom: '1px solid var(--rule)',
        }}
      >
        <h2
          style={{
            fontSize: 11,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: 'var(--ink-2)',
            margin: '0 0 18px',
            fontWeight: 500,
            paddingBottom: 8,
            borderBottom: '1px solid var(--rule)',
          }}
        >
          Assessment
        </h2>
        <LandscapeBody html={briefingHtml} markdown={briefingMarkdown} />
      </section>
    );
  }

  // Showrunner substack post — render the markdown body.
  if (
    normalisedAgent === 'showrunner' &&
    outputType === 'substack_post' &&
    typeof (content as { substack_post?: unknown }).substack_post === 'string'
  ) {
    const md = (content as { substack_post: string }).substack_post;
    return <Assessment markdown={md} />;
  }

  // Pitch drafts — single-item outputs from Sponsorship / PR / Talent. Not
  // multi-child like research batches; just a subject + body + metadata
  // block. No per-child actions — Gateway handles the parent-level Approve.
  const hasPitchBody =
    (normalisedAgent === 'sponsorship-director' ||
      normalisedAgent === 'pr-director' ||
      normalisedAgent === 'talent-scout') &&
    typeof (content as { body?: unknown }).body === 'string';
  if (hasPitchBody) {
    const pitch = content as {
      subject?: string;
      body?: string;
      brand_name?: string;
      journalist_name?: string;
      outlet?: string;
      voice_mode?: string;
      cta_type?: string;
      artisan_name?: string;
      trade?: string;
      channel?: string;
      suggested_episode?: string;
      episode_pairing?: string;
      angle_used?: string;
      contact_name?: string;
      contact_email?: string;
      outreach_row_id?: string;
    };
    const metaRowsAll: Array<[string, string | undefined]> = [
      ['Brand', pitch.brand_name],
      ['Outlet', pitch.outlet],
      ['Journalist', pitch.journalist_name],
      ['Artisan', pitch.artisan_name],
      ['Trade', pitch.trade],
      ['Channel', pitch.channel],
      ['Voice mode', pitch.voice_mode],
      ['CTA', pitch.cta_type],
      ['Angle', pitch.angle_used],
      ['Episode', pitch.suggested_episode ?? pitch.episode_pairing],
      [
        'Contact',
        pitch.contact_name
          ? `${pitch.contact_name}${pitch.contact_email ? ` (${pitch.contact_email})` : ''}`
          : undefined,
      ],
    ];
    const metaRows = metaRowsAll.filter(
      (row): row is [string, string] => !!row[1],
    );
    return (
      <section
        style={{
          marginBottom: 36,
          paddingBottom: 32,
          borderBottom: '1px solid var(--rule)',
        }}
      >
        <h2
          style={{
            fontSize: 11,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: 'var(--ink-2)',
            margin: '0 0 18px',
            fontWeight: 500,
            paddingBottom: 8,
            borderBottom: '1px solid var(--rule)',
          }}
        >
          Draft
        </h2>
        {pitch.subject && (
          <div style={{ marginBottom: 16 }}>
            <div
              className="mono"
              style={{
                fontSize: 10,
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                color: 'var(--ink-3)',
                marginBottom: 4,
              }}
            >
              Subject
            </div>
            <p style={{ fontSize: 15, fontWeight: 500, margin: 0 }}>
              {pitch.subject}
            </p>
          </div>
        )}
        <div>
          <div
            className="mono"
            style={{
              fontSize: 10,
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              color: 'var(--ink-3)',
              marginBottom: 4,
            }}
          >
            Body
          </div>
          <pre
            style={{
              whiteSpace: 'pre-wrap',
              fontFamily: 'inherit',
              fontSize: 14,
              lineHeight: 1.6,
              margin: 0,
              color: 'var(--ink)',
            }}
          >
            {pitch.body}
          </pre>
        </div>
        {metaRows.length > 0 && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 6,
              marginTop: 20,
              fontSize: 12,
              color: 'var(--ink-3)',
            }}
          >
            {metaRows.map(([label, value]) => (
              <div key={label}>
                <span
                  className="mono"
                  style={{
                    textTransform: 'uppercase',
                    letterSpacing: '0.12em',
                    marginRight: 6,
                  }}
                >
                  {label}
                </span>
                {value}
              </div>
            ))}
          </div>
        )}
        {pitch.outreach_row_id && (
          <p style={{ marginTop: 12, fontSize: 12 }}>
            <a
              href={`https://www.notion.so/${pitch.outreach_row_id.replace(/-/g, '')}`}
              target="_blank"
              rel="noreferrer"
              style={{ color: 'var(--ink)' }}
            >
              Open Outreach row in Notion ↗
            </a>
          </p>
        )}
      </section>
    );
  }

  // Cross-platform analytics summary — plain text narrative.
  if (
    normalisedAgent === 'analytics-reporting' &&
    typeof (content as { cross_platform_summary?: unknown }).cross_platform_summary === 'string'
  ) {
    const txt = (content as { cross_platform_summary: string }).cross_platform_summary;
    return (
      <Assessment
        html={txt
          .split(/\n\s*\n/)
          .map(
            (p) =>
              `<p>${p
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/\n/g, '<br/>')}</p>`,
          )
          .join('\n')}
      />
    );
  }

  // Generic fallback: render any string/number/list narrative fields from
  // draft_content as a field list. Mirrors the old OutputContent behavior so
  // outputs without a dedicated block (weekly_plan, calendar_entry, etc.)
  // still show their body.
  return <GenericFields content={content} />;
}

function GenericFields({ content }: { content: Record<string, unknown> }) {
  const HIDDEN = new Set([
    'raw_output',
    'inputs',
    'superseded_by_queue_id',
    'notion_entries_created',
    'notion_entry_ids',
    'superseded_feedback',
    'output_kind',
  ]);
  const entries = Object.entries(content).filter(([k]) => !HIDDEN.has(k));
  if (entries.length === 0) return null;
  return (
    <section
      style={{
        marginBottom: 36,
        paddingBottom: 32,
        borderBottom: '1px solid var(--rule)',
      }}
    >
      <h2
        style={{
          fontSize: 11,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: 'var(--ink-2)',
          margin: '0 0 18px',
          fontWeight: 500,
          paddingBottom: 8,
          borderBottom: '1px solid var(--rule)',
        }}
      >
        Assessment
      </h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        {entries.map(([key, value]) => (
          <GenericField key={key} fieldKey={key} value={value} />
        ))}
      </div>
    </section>
  );
}

function GenericField({
  fieldKey,
  value,
}: {
  fieldKey: string;
  value: unknown;
}) {
  return (
    <div>
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
        {fieldKey.replace(/_/g, ' ')}
      </div>
      <GenericValue value={value} />
    </div>
  );
}

function GenericValue({ value }: { value: unknown }) {
  if (value == null || value === '') {
    return (
      <p
        className="mono"
        style={{ fontSize: 11, color: 'var(--ink-3)' }}
      >
        (empty)
      </p>
    );
  }
  if (typeof value === 'string') {
    return (
      <pre
        style={{
          whiteSpace: 'pre-wrap',
          fontFamily: 'inherit',
          fontSize: 14,
          lineHeight: 1.55,
          margin: 0,
          color: 'var(--ink)',
        }}
      >
        {value}
      </pre>
    );
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return (
      <p className="mono" style={{ fontSize: 13, margin: 0 }}>
        {String(value)}
      </p>
    );
  }
  return (
    <pre
      className="mono"
      style={{
        fontSize: 11,
        color: 'var(--ink-2)',
        whiteSpace: 'pre-wrap',
        margin: 0,
        lineHeight: 1.6,
        maxHeight: 360,
        overflow: 'auto',
        background: 'var(--bg-2)',
        padding: 12,
      }}
    >
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}
