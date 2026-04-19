'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import DOMPurify from 'isomorphic-dompurify';
import { computeReadiness } from '@/lib/dashboard/readiness';
import { formatPtTime } from '@/lib/time';

interface DelegationSuggestion {
  task_title: string;
  agent: string;
  readiness: 'ready' | 'blocked';
  blockers: string[];
  chat_prompt: string;
}

interface ResearchLead {
  lead_id: string;
  // Sponsorship fields
  brand_name?: string;
  tier?: 'tier-a' | 'tier-b' | 'tier-c';
  // PR fields
  journalist_name?: string;
  outlet?: string;
  outlet_tier?: string;
  role?: string | null;
  beat?: string | null;
  suggested_voice_mode?: 'founder-first' | 'show-first' | 'hybrid';
  cultural_moment?: string | null;
  episode_pairing?: string | null;
  source_link?: string | null;
  contact_linkedin?: string | null;
  // Talent Scout fields
  artisan_name?: string;
  trade?: string;
  studio_or_shop?: string | null;
  location?: string;
  instagram_handle?: string | null;
  shop_website?: string | null;
  suggested_channel?: 'email' | 'ig-dm' | 'through-team';
  venn_test_result?: string;
  discovery_story?: string;
  trade_gap_fill?: boolean;
  contacts_row_id?: string | null;
  // Shared
  contact_name?: string | null;
  contact_email?: string | null;
  contact_role?: string | null;
  contact_flag?: 'unverified-contact' | 'no-named-contact' | null;
  fit_score?: number;
  fit_rationale: string;
  suggested_episode?: string | null;
  suggested_angle?: string | null;
  source_note?: string | null;
  approved?: boolean;
  draft_output_id?: string | null;
  outreach_row_id?: string | null;
  replaced_at?: string;
  replacement_feedback?: string | null;
  previous_versions?: LeadPreviousVersion[];
}

interface ResearchBatchPayload {
  total_reviewed?: number;
  surfaced_count?: number;
  season?: string;
  landscape_briefing_date?: string | null;
  leads?: ResearchLead[];
  parse_diagnostic?: {
    raw_output_length: number;
    raw_output_snippet: string;
    likely_truncated: boolean;
    reason: 'parse_failed' | 'empty_reviewed_array' | null;
  } | null;
}

interface LeadPreviousVersion {
  brand_name?: string;
  journalist_name?: string;
  outlet?: string;
  fit_score: number;
  feedback: string | null;
  replaced_at: string;
}

interface PitchDraftPayload {
  subject?: string | null;
  body?: string;
  // Sponsorship:
  brand_name?: string;
  cta_type?: 'one-pager' | 'warm-intro' | 'enterprise-both';
  suggested_episode?: string | null;
  // PR:
  journalist_name?: string;
  outlet?: string;
  voice_mode?: 'founder-first' | 'show-first' | 'hybrid';
  angle_used?: string | null;
  episode_pairing?: string | null;
  // Talent Scout:
  artisan_name?: string;
  trade?: string;
  channel?: 'email' | 'ig-dm' | 'through-team';
  instagram_handle?: string | null;
  discovery_story?: string;
  contacts_row_id?: string | null;
  sent_at?: string;
  // Shared:
  contact_name?: string | null;
  contact_email?: string | null;
  touch_number?: number;
  outreach_row_id?: string | null;
}

interface QueueCardProps {
  item: {
    id: string;
    agent_name: string;
    type: string;
    status?: string;
    title: string;
    summary: string | null;
    full_output: any;
    created_at: string;
    agent_output_id?: string | null;
  };
}

export function QueueCard({ item }: QueueCardProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [hidden, setHidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isSuperseded = item.status === 'superseded';
  const supersededByQueueId =
    (item.full_output?.superseded_by_queue_id as string | undefined) ?? undefined;

  const briefingHtml = item.full_output?.briefing_html as string | undefined;
  const briefingLegacyMarkdown = item.full_output?.briefing_markdown as string | undefined;
  const hasBriefing = !!(briefingHtml || briefingLegacyMarkdown);
  const delegationSuggestions = (item.full_output?.delegation_suggestions ?? []) as DelegationSuggestion[];
  // v2 fields first, legacy fallback for older queue items. Detect either shape.
  const showrunner =
    item.full_output?.substack_post || item.full_output?.post_draft
      ? item.full_output
      : null;
  const weeklyPlan = item.type === 'recommendation' && item.full_output?.plan_markdown ? item.full_output : null;
  const isOutreachAgent =
    item.agent_name === 'sponsorship-director' ||
    item.agent_name === 'pr-director' ||
    item.agent_name === 'talent-scout';
  const researchBatch =
    isOutreachAgent && Array.isArray(item.full_output?.leads)
      ? (item.full_output as ResearchBatchPayload)
      : null;
  const pitchDraft =
    isOutreachAgent &&
    !Array.isArray(item.full_output?.leads) &&
    typeof item.full_output?.body === 'string'
      ? (item.full_output as PitchDraftPayload)
      : null;
  const agentRoutePrefix = `/api/agents/${item.agent_name}`;
  const [editedBody, setEditedBody] = useState<string | null>(null);
  // v2 tab order: meta (Titles & Descriptions) → captions → post (Substack Post)
  const [activeTab, setActiveTab] = useState<'meta' | 'captions' | 'post'>('meta');
  const [showExecutePreview, setShowExecutePreview] = useState(false);
  const [leadMutations, setLeadMutations] = useState<Record<string, 'pending' | 'done' | 'error'>>({});
  const [leadReplacing, setLeadReplacing] = useState<Record<string, boolean>>({});
  const [leadFeedback, setLeadFeedback] = useState<Record<string, string>>({});
  const [leadErrors, setLeadErrors] = useState<Record<string, string>>({});
  const hasExpandable = !!(
    hasBriefing ||
    showrunner ||
    weeklyPlan ||
    researchBatch ||
    pitchDraft
  );
  const isApprovedPlan = weeklyPlan && item.status === 'approved';

  const approveLead = (leadId: string) => {
    setLeadErrors((prev) => ({ ...prev, [leadId]: '' }));
    setLeadMutations((prev) => ({ ...prev, [leadId]: 'pending' }));
    startTransition(async () => {
      try {
        const res = await fetch(
          `${agentRoutePrefix}/leads/approve`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ queueItemId: item.id, leadId }),
          },
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || 'Lead approval failed');
        setLeadMutations((prev) => ({ ...prev, [leadId]: 'done' }));
        router.refresh(); // pull the new pitch draft into the queue
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Failed';
        setLeadMutations((prev) => ({ ...prev, [leadId]: 'error' }));
        setLeadErrors((prev) => ({ ...prev, [leadId]: msg }));
      }
    });
  };

  const replaceLead = (leadId: string) => {
    setLeadErrors((prev) => ({ ...prev, [leadId]: '' }));
    setLeadReplacing((prev) => ({ ...prev, [leadId]: true }));
    const feedback = leadFeedback[leadId]?.trim() || undefined;
    startTransition(async () => {
      try {
        const res = await fetch(
          `${agentRoutePrefix}/leads/replace`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ queueItemId: item.id, leadId, feedback }),
          },
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || 'Replacement failed');
        setLeadFeedback((prev) => ({ ...prev, [leadId]: '' }));
        setLeadReplacing((prev) => ({ ...prev, [leadId]: false }));
        router.refresh(); // pull the updated batch
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Failed';
        setLeadReplacing((prev) => ({ ...prev, [leadId]: false }));
        setLeadErrors((prev) => ({ ...prev, [leadId]: msg }));
      }
    });
  };

  const approve = () => {
    setError(null);
    // For pitch drafts, include the (possibly edited) body. Status route
    // writes it back to approval_queue.full_output.body + Notion.
    const finalBody = pitchDraft
      ? (editedBody ?? pitchDraft.body ?? '').trim() || undefined
      : undefined;

    startTransition(async () => {
      try {
        const res = await fetch(`/api/queue/${item.id}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: 'approved',
            finalBody,
          }),
        });
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(payload.error || `Approve failed (${res.status})`);
        }
        setEditing(false);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed');
      }
    });
  };

  const ignore = () => {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/queue/${item.id}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'ignored' }),
        });
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(payload.error || `Ignore failed (${res.status})`);
        }
        setHidden(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed');
      }
    });
  };

  const submitUpdate = () => {
    setError(null);
    const text = feedback.trim();
    if (!text) {
      setError('Feedback is required for Update.');
      return;
    }
    startTransition(async () => {
      try {
        const res = await fetch(`/api/queue/${item.id}/update`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ feedback: text }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || `Update failed (${res.status})`);
        // Old card stays in the list as 'superseded' until next page load;
        // router.refresh pulls the new item.
        setHidden(true);
        setFeedback('');
        setUpdating(false);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed');
      }
    });
  };

  if (hidden) return null;

  const created = formatPtTime(item.created_at);

  return (
    <article className="border rounded-lg p-4" style={{ borderColor: 'var(--border)' }}>
      <div className="flex items-start justify-between gap-4 mb-2">
        <div className="min-w-0">
          <div className="text-xs muted uppercase tracking-wider mb-1">
            {item.agent_name} · {item.type} · {created}
          </div>
          <h3 className="serif text-lg">{item.title}</h3>
        </div>
      </div>

      {/* Readiness line — Blocked vs Ready state per item type. Renders
          above the summary so the most important context lands first. */}
      {!isSuperseded && (() => {
        const readiness = computeReadiness(item);
        if (!readiness) return null;
        const color =
          readiness.kind === 'ready'
            ? 'var(--ok)'
            : readiness.kind === 'blocked'
              ? 'var(--gold-dim)'
              : 'var(--muted)';
        return (
          <div className="mb-2 text-xs" style={{ color }}>
            {readiness.message}
            {readiness.blockers && readiness.blockers.length > 0 && (
              <ul className="list-disc list-inside mt-1 space-y-0.5">
                {readiness.blockers.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
            )}
          </div>
        );
      })()}

      {item.summary && !expanded && (
        <p className="muted text-sm mb-3 line-clamp-2">{item.summary}</p>
      )}

      {/* Ops Chief briefing — new HTML path with delegation action surface */}
      {expanded && briefingHtml && (
        <>
          <div
            className="briefing-body prose prose-invert prose-sm max-w-none mb-3 text-sm"
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(briefingHtml) }}
          />
          {delegationSuggestions.length > 0 && (
            <div className="mt-3 mb-3 space-y-2">
              <div className="text-xs muted uppercase tracking-wider mb-2">
                Delegation suggestions
              </div>
              {delegationSuggestions.map((s, i) => (
                <div
                  key={i}
                  className="border rounded-md p-3 text-sm"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <div className="flex items-start justify-between gap-3 mb-1">
                    <div className="min-w-0">
                      <div className="serif">{s.task_title}</div>
                      <div className="text-xs muted mt-0.5">
                        {s.agent} ·{' '}
                        <span
                          style={{
                            color:
                              s.readiness === 'ready'
                                ? 'var(--gold)'
                                : 'var(--muted)',
                          }}
                        >
                          {s.readiness === 'ready' ? 'All inputs ready' : 'Blocked'}
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        window.dispatchEvent(
                          new CustomEvent('ops-chief:prefill', {
                            detail: { text: s.chat_prompt },
                          }),
                        );
                      }}
                      className="shrink-0 px-3 py-1.5 text-xs rounded-md border hover:bg-white/5 transition min-h-[36px]"
                      style={{ borderColor: 'var(--gold)', color: 'var(--gold)' }}
                    >
                      Delegate to {s.agent}
                    </button>
                  </div>
                  {s.readiness === 'blocked' && s.blockers.length > 0 && (
                    <ul className="list-disc list-inside text-xs muted mt-2 space-y-0.5">
                      {s.blockers.map((b, j) => (
                        <li key={j}>{b}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Back-compat: old briefings stored as markdown */}
      {expanded && !briefingHtml && briefingLegacyMarkdown && (
        <div className="prose prose-invert prose-sm max-w-none mb-3 whitespace-pre-wrap text-sm">
          {briefingLegacyMarkdown}
        </div>
      )}

      {/* Showrunner content package — v2 tab order + labels */}
      {expanded && showrunner && (
        <div className="mb-3">
          <div className="flex gap-2 mb-3">
            {(['meta', 'captions', 'post'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className="px-3 py-1 text-xs rounded-md border transition"
                style={{
                  borderColor: activeTab === tab ? 'var(--gold)' : 'var(--border)',
                  color: activeTab === tab ? 'var(--gold)' : 'var(--muted)',
                }}
              >
                {tab === 'meta'
                  ? 'Titles & Descriptions'
                  : tab === 'captions'
                    ? 'Social Captions'
                    : 'Substack Post'}
              </button>
            ))}
          </div>

          {activeTab === 'meta' && (
            <div className="space-y-4 text-sm">
              <div>
                <span className="text-xs muted uppercase tracking-wider">
                  YouTube title
                </span>
                <p className="serif mt-1">
                  {showrunner.youtube_title ?? showrunner.episode_title ?? '(not set)'}
                </p>
              </div>
              <div>
                <span className="text-xs muted uppercase tracking-wider">
                  Spotify title
                </span>
                <p className="serif mt-1">
                  {showrunner.spotify_title ?? '(not set)'}
                </p>
              </div>
              <div>
                <span className="text-xs muted uppercase tracking-wider">
                  Episode description (YouTube + Spotify)
                </span>
                <pre className="mt-1 whitespace-pre-wrap text-xs muted">
                  {showrunner.episode_description ??
                    showrunner.youtube_description ??
                    showrunner.spotify_description ??
                    '(not set)'}
                </pre>
              </div>
              <div>
                <span className="text-xs muted uppercase tracking-wider">
                  Substack title
                </span>
                <p className="serif mt-1">
                  {showrunner.substack_title ?? showrunner.episode_title ?? '(not set)'}
                </p>
              </div>
              <div>
                <span className="text-xs muted uppercase tracking-wider">
                  Substack subtitle
                </span>
                <p className="mt-1">{showrunner.substack_subtitle ?? '(not set)'}</p>
              </div>
            </div>
          )}

          {activeTab === 'captions' && (
            <ShowrunnerCaptionsList
              clipCaptions={
                Array.isArray(showrunner.clip_captions)
                  ? (showrunner.clip_captions as ShowrunnerClipCaptionCard[])
                  : []
              }
              legacySocialCaptions={
                Array.isArray(showrunner.social_captions)
                  ? (showrunner.social_captions as string[])
                  : []
              }
              approved={item.status === 'approved' || item.status === 'executed'}
            />
          )}

          {activeTab === 'post' && (
            <div className="prose prose-invert prose-sm max-w-none whitespace-pre-wrap text-sm max-h-[400px] overflow-y-auto">
              {showrunner.substack_post ?? showrunner.post_draft ?? '(empty)'}
            </div>
          )}
        </div>
      )}

      {/* Outreach research batch (Sponsorship or PR) */}
      {expanded && researchBatch && (
        <div className="mb-3 space-y-3">
          <div className="text-xs muted">
            Reviewed {researchBatch.total_reviewed ?? 0}, surfacing{' '}
            {researchBatch.leads?.length ?? 0}
            {researchBatch.season ? ` · ${researchBatch.season}` : ''}
            {researchBatch.landscape_briefing_date
              ? ` · landscape ${researchBatch.landscape_briefing_date}`
              : ''}
          </div>
          {researchBatch.parse_diagnostic && (
            <div
              className="text-xs border rounded-md p-3 space-y-1"
              style={{
                borderColor: 'var(--danger)',
                color: 'var(--foreground)',
              }}
            >
              <div className="uppercase tracking-wider" style={{ color: 'var(--danger)' }}>
                Parse diagnostic — 0 leads surfaced
              </div>
              <div className="muted">
                reason · {researchBatch.parse_diagnostic.reason} ·{' '}
                {researchBatch.parse_diagnostic.likely_truncated
                  ? 'likely output-token truncation'
                  : 'structure mismatch'}
              </div>
              <div className="muted">
                raw output · {researchBatch.parse_diagnostic.raw_output_length} chars
              </div>
              <details>
                <summary className="cursor-pointer gold">first 1000 chars</summary>
                <pre className="whitespace-pre-wrap mt-1 text-xs muted">
                  {researchBatch.parse_diagnostic.raw_output_snippet}
                </pre>
              </details>
            </div>
          )}
          <ol className="space-y-3">
            {(researchBatch.leads ?? []).map((lead) => {
              const mutation = leadMutations[lead.lead_id];
              const isDone = lead.approved || mutation === 'done';
              const isApproving = mutation === 'pending';
              const isReplacing = leadReplacing[lead.lead_id];
              const priorCount = lead.previous_versions?.length ?? 0;
              return (
                <li
                  key={lead.lead_id}
                  className="border rounded-md p-3 text-sm"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="serif text-base">
                          {lead.brand_name ??
                            lead.artisan_name ??
                            (lead.journalist_name && lead.outlet
                              ? `${lead.journalist_name} · ${lead.outlet}`
                              : (lead.outlet ?? lead.journalist_name ?? 'Lead'))}
                        </span>
                        <span className="text-xs muted">
                          {lead.trade ? `${lead.trade} · ` : ''}
                          {(lead.tier ?? lead.outlet_tier) ? `${lead.tier ?? lead.outlet_tier} · ` : ''}
                          {lead.fit_score != null
                            ? `fit ${lead.fit_score}/5`
                            : lead.venn_test_result
                              ? `venn ${lead.venn_test_result}`
                              : ''}
                          {lead.location ? ` · ${lead.location}` : ''}
                        </span>
                        {lead.suggested_channel && (
                          <span
                            className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm"
                            style={{
                              border: '1px solid var(--gold-dim)',
                              color: 'var(--gold)',
                            }}
                          >
                            {lead.suggested_channel}
                          </span>
                        )}
                        {lead.trade_gap_fill && (
                          <span
                            className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm"
                            style={{ border: '1px solid var(--ok)', color: 'var(--ok)' }}
                          >
                            gap-fill
                          </span>
                        )}
                        {lead.suggested_voice_mode && (
                          <span
                            className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm"
                            style={{
                              border: '1px solid var(--border)',
                              color: 'var(--muted)',
                            }}
                          >
                            {lead.suggested_voice_mode}
                          </span>
                        )}
                        {lead.cultural_moment && (
                          <span
                            className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm"
                            style={{
                              border: '1px solid var(--gold-dim)',
                              color: 'var(--gold)',
                            }}
                          >
                            {lead.cultural_moment.replace(/^cultural-/, '')}
                          </span>
                        )}
                        {priorCount > 0 && (
                          <span
                            className="text-[10px] uppercase tracking-wider"
                            style={{ color: 'var(--gold-dim)' }}
                            title={(lead.previous_versions ?? [])
                              .map((v) => {
                                const n = v.brand_name ??
                                  (v.journalist_name && v.outlet
                                    ? `${v.journalist_name} · ${v.outlet}`
                                    : v.outlet ?? v.journalist_name ?? '');
                                return `${n}${v.feedback ? ` — ${v.feedback}` : ''}`;
                              })
                              .join('\n')}
                          >
                            replaced {priorCount}x
                          </span>
                        )}
                      </div>
                      <div className="text-xs muted mt-0.5">
                        {lead.contact_name || lead.journalist_name
                          ? `${lead.contact_name ?? lead.journalist_name}${lead.contact_role || lead.role ? ` · ${lead.contact_role ?? lead.role}` : ''}${lead.contact_email ? ` · ${lead.contact_email}` : ''}`
                          : lead.contact_flag === 'no-named-contact'
                            ? 'no named contact found — agent flagged for manual research'
                            : 'contact unverified'}
                      </div>
                      <p className="mt-1.5">{lead.fit_rationale}</p>
                      {lead.discovery_story && (
                        <p className="text-xs muted mt-1 italic">
                          discovered · {lead.discovery_story}
                        </p>
                      )}
                      {(lead.suggested_episode || lead.episode_pairing) && (
                        <p className="text-xs muted mt-1">
                          pair with · {lead.suggested_episode ?? lead.episode_pairing}
                        </p>
                      )}
                      {lead.suggested_angle && (
                        <p className="text-xs muted mt-0.5">
                          angle · {lead.suggested_angle}
                        </p>
                      )}
                      {(lead.source_note || lead.source_link) && (
                        <p className="text-xs muted mt-0.5">
                          source ·{' '}
                          {lead.source_link ? (
                            <a
                              href={lead.source_link}
                              target="_blank"
                              rel="noreferrer"
                              className="gold hover:underline"
                            >
                              recent piece ↗
                            </a>
                          ) : (
                            lead.source_note
                          )}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => approveLead(lead.lead_id)}
                      disabled={isDone || isApproving || isReplacing}
                      className="shrink-0 px-3 py-1.5 text-xs rounded-md border hover:bg-white/5 transition disabled:opacity-40 min-h-[36px]"
                      style={{
                        borderColor: isDone ? 'var(--gold-dim)' : 'var(--gold)',
                        color: isDone ? 'var(--muted)' : 'var(--gold)',
                      }}
                    >
                      {isDone
                        ? 'Draft queued'
                        : isApproving
                          ? 'Drafting…'
                          : 'Approve lead'}
                    </button>
                  </div>

                  {/* Feedback + Replace row — hidden once the lead is approved */}
                  {!isDone && (
                    <div className="mt-2.5 flex items-stretch gap-2">
                      <input
                        type="text"
                        placeholder="Feedback to guide a replacement (optional)…"
                        value={leadFeedback[lead.lead_id] ?? ''}
                        onChange={(e) =>
                          setLeadFeedback((prev) => ({
                            ...prev,
                            [lead.lead_id]: e.target.value,
                          }))
                        }
                        disabled={isApproving || isReplacing}
                        className="flex-1 min-w-0 bg-transparent border rounded-md px-2.5 py-1.5 text-xs disabled:opacity-40"
                        style={{ borderColor: 'var(--border)' }}
                      />
                      <button
                        onClick={() => replaceLead(lead.lead_id)}
                        disabled={isApproving || isReplacing}
                        className="shrink-0 px-3 py-1.5 text-xs rounded-md border hover:bg-white/5 transition disabled:opacity-40 min-h-[36px]"
                        style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
                      >
                        {isReplacing ? 'Replacing…' : 'Replace'}
                      </button>
                    </div>
                  )}

                  {leadErrors[lead.lead_id] && (
                    <p
                      className="text-xs mt-1.5"
                      style={{ color: 'var(--danger)' }}
                    >
                      {leadErrors[lead.lead_id]}
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {/* Sponsorship pitch draft — editable body, audit link to Notion */}
      {expanded && pitchDraft && (
        <div className="mb-3 space-y-3 text-sm">
          <div>
            <div className="text-xs muted uppercase tracking-wider mb-1">
              Subject
            </div>
            <p className="serif">{pitchDraft.subject ?? '(no subject)'}</p>
          </div>
          <div>
            <div className="text-xs muted uppercase tracking-wider mb-1">
              Body {editedBody != null && (
                <span style={{ color: 'var(--gold-dim)' }}>· edited</span>
              )}
            </div>
            {editing ? (
              <textarea
                value={editedBody ?? pitchDraft.body ?? ''}
                onChange={(e) => setEditedBody(e.target.value)}
                rows={Math.min(
                  20,
                  Math.max(
                    8,
                    (editedBody ?? pitchDraft.body ?? '').split('\n').length + 1,
                  ),
                )}
                className="w-full bg-transparent border rounded-md px-3 py-2 text-sm leading-relaxed resize-y"
                style={{ borderColor: 'var(--gold-dim)' }}
              />
            ) : (
              <pre className="whitespace-pre-wrap text-sm leading-relaxed">
                {editedBody ?? pitchDraft.body ?? ''}
              </pre>
            )}
            <p className="text-xs muted mt-1">
              {editing
                ? 'Edit mode on — changes save to Notion on Approve.'
                : 'Read-only. Click Edit below to modify, or Update for agent regen.'}
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs muted">
            {(pitchDraft.contact_name || pitchDraft.journalist_name) && (
              <div>
                <span className="uppercase tracking-wider">Contact · </span>
                {pitchDraft.contact_name ?? pitchDraft.journalist_name}
                {pitchDraft.contact_email ? ` (${pitchDraft.contact_email})` : ''}
              </div>
            )}
            {pitchDraft.brand_name && (
              <div>
                <span className="uppercase tracking-wider">Brand · </span>
                {pitchDraft.brand_name}
              </div>
            )}
            {pitchDraft.outlet && (
              <div>
                <span className="uppercase tracking-wider">Outlet · </span>
                {pitchDraft.outlet}
              </div>
            )}
            {pitchDraft.voice_mode && (
              <div>
                <span className="uppercase tracking-wider">Voice · </span>
                {pitchDraft.voice_mode}
              </div>
            )}
            {pitchDraft.cta_type && (
              <div>
                <span className="uppercase tracking-wider">CTA · </span>
                {pitchDraft.cta_type}
              </div>
            )}
            {pitchDraft.angle_used && (
              <div>
                <span className="uppercase tracking-wider">Angle · </span>
                {pitchDraft.angle_used}
              </div>
            )}
            {(pitchDraft.suggested_episode || pitchDraft.episode_pairing) && (
              <div>
                <span className="uppercase tracking-wider">Episode · </span>
                {pitchDraft.suggested_episode ?? pitchDraft.episode_pairing}
              </div>
            )}
            {pitchDraft.artisan_name && (
              <div>
                <span className="uppercase tracking-wider">Artisan · </span>
                {pitchDraft.artisan_name}
                {pitchDraft.trade ? ` (${pitchDraft.trade})` : ''}
              </div>
            )}
            {pitchDraft.channel && (
              <div>
                <span className="uppercase tracking-wider">Channel · </span>
                {pitchDraft.channel}
              </div>
            )}
            {pitchDraft.outreach_row_id && (
              <div className="md:col-span-2">
                <a
                  href={`https://www.notion.so/${pitchDraft.outreach_row_id.replace(/-/g, '')}`}
                  target="_blank"
                  rel="noreferrer"
                  className="gold hover:underline"
                >
                  Open Outreach row in Notion ↗
                </a>
              </div>
            )}
            {/* Talent Scout Mark-as-sent — Gate 3 for IG DM and team-intro
                channels (always), and email channel until Gmail OAuth lands.
                Writes the Notion Outreach touch row. */}
            {item.agent_name === 'talent-scout' &&
              pitchDraft.channel &&
              item.status === 'approved' &&
              item.agent_output_id && (
                <div className="md:col-span-2">
                  <MarkAsSentControl
                    agentOutputId={item.agent_output_id}
                    channel={pitchDraft.channel}
                    alreadySentAt={pitchDraft.sent_at}
                    editedBody={editedBody ?? pitchDraft.body ?? null}
                  />
                </div>
              )}
          </div>
        </div>
      )}

      {/* Weekly plan */}
      {expanded && weeklyPlan && (
        <div className="mb-3">
          <div className="prose prose-invert prose-sm max-w-none whitespace-pre-wrap text-sm max-h-[400px] overflow-y-auto">
            {weeklyPlan.plan_markdown}
          </div>
          {weeklyPlan.reschedules?.length > 0 && (
            <div className="mt-3 text-xs muted">
              {weeklyPlan.reschedules.length} task(s) to reschedule
              {weeklyPlan.new_tasks?.length > 0 && `, ${weeklyPlan.new_tasks.length} new task(s) to create`}
            </div>
          )}
        </div>
      )}

      {/* Execute preview for approved weekly plans */}
      {isApprovedPlan && showExecutePreview && (
        <div className="border rounded-md p-3 mb-3 text-sm" style={{ borderColor: 'var(--gold)' }}>
          <p className="serif mb-2">Changes to execute:</p>
          {weeklyPlan.reschedules?.length > 0 && (
            <div className="mb-2">
              <span className="text-xs muted uppercase tracking-wider">Reschedule ({weeklyPlan.reschedules.length})</span>
              <ul className="mt-1 space-y-1 text-xs muted">
                {weeklyPlan.reschedules.map((r: any, i: number) => (
                  <li key={i}>{r.task_title ?? r.taskTitle} → {r.new_date ?? r.newDate}</li>
                ))}
              </ul>
            </div>
          )}
          {weeklyPlan.new_tasks?.length > 0 && (
            <div className="mb-2">
              <span className="text-xs muted uppercase tracking-wider">Create ({weeklyPlan.new_tasks.length})</span>
              <ul className="mt-1 space-y-1 text-xs muted">
                {weeklyPlan.new_tasks.map((t: any, i: number) => (
                  <li key={i}>{t.title} — {t.to_do_date ?? t.toDoDate}</li>
                ))}
              </ul>
            </div>
          )}
          <button
            onClick={() => {
              setError(null);
              startTransition(async () => {
                try {
                  const res = await fetch(`/api/queue/${item.id}/execute`, { method: 'POST' });
                  if (!res.ok) throw new Error((await res.json()).error || 'Execute failed');
                  setHidden(true);
                } catch (e: any) {
                  setError(e.message);
                }
              });
            }}
            disabled={isPending}
            className="mt-2 px-4 py-2 text-sm rounded-md border hover:bg-white/5 transition disabled:opacity-40"
            style={{ borderColor: 'var(--gold)', color: 'var(--gold)' }}
          >
            {isPending ? 'Executing...' : 'Confirm & Execute'}
          </button>
        </div>
      )}

      {hasExpandable && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-xs gold hover:underline mb-3"
        >
          {expanded
            ? 'Collapse'
            : hasBriefing
              ? 'Read full briefing'
              : weeklyPlan
                ? 'View weekly plan'
                : researchBatch
                  ? `Review ${researchBatch.leads?.length ?? 0} leads`
                  : pitchDraft
                    ? 'Read pitch draft'
                    : 'View content package'}
        </button>
      )}

      {/* Execute Plan button for approved recommendations */}
      {isApprovedPlan && !showExecutePreview && (
        <button
          onClick={() => setShowExecutePreview(true)}
          className="px-4 py-2 text-sm rounded-md border hover:bg-white/5 transition mb-3 block"
          style={{ borderColor: 'var(--gold)', color: 'var(--gold)' }}
        >
          Execute Plan
        </button>
      )}

      {/* Superseded banner — this card was replaced by a newer run. No approve controls. */}
      {isSuperseded && (
        <div
          className="mt-3 text-xs border rounded-md px-3 py-2"
          style={{
            borderColor: 'var(--gold-dim)',
            color: 'var(--muted)',
            background: 'color-mix(in srgb, var(--surface-2) 70%, transparent)',
          }}
        >
          Superseded — replaced by a newer draft
          {supersededByQueueId ? ' (see latest below).' : '.'}
          {item.full_output?.superseded_feedback && (
            <div className="mt-1 italic" style={{ color: 'var(--gold-dim)' }}>
              Feedback used: &ldquo;{item.full_output.superseded_feedback}&rdquo;
            </div>
          )}
        </div>
      )}

      {/* Update-in-progress feedback textarea. Shown when the Update button is
          clicked; supersedes the regular 4-button row until Cancel or Submit. */}
      {!isSuperseded && updating && (
        <div
          className="mt-3 border rounded-md p-3 space-y-2"
          style={{ borderColor: 'var(--gold-dim)' }}
        >
          <div
            className="text-xs uppercase tracking-wider"
            style={{ color: 'var(--gold)' }}
          >
            Feedback for this output
          </div>
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder={updatePlaceholder(item.agent_name, item.type)}
            rows={3}
            disabled={isPending}
            className="w-full bg-transparent border rounded-md px-3 py-2 text-sm resize-y"
            style={{ borderColor: 'var(--border)' }}
          />
          <p className="text-[11px] muted">
            The agent re-runs and applies this feedback to the relevant
            sub-output. Other sections stay byte-identical.
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={submitUpdate}
              disabled={isPending || !feedback.trim()}
              className="px-4 py-2 text-sm rounded-md border hover:bg-white/5 transition disabled:opacity-40 min-h-[40px]"
              style={{ borderColor: 'var(--gold)', color: 'var(--gold)' }}
            >
              {isPending ? 'Running…' : 'Update'}
            </button>
            <button
              onClick={() => {
                setUpdating(false);
                setFeedback('');
                setError(null);
              }}
              disabled={isPending}
              className="px-4 py-2 text-sm rounded-md border hover:bg-white/5 transition disabled:opacity-40 min-h-[40px]"
              style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* 4-button action row — Review, Approve, Edit, Update. Hidden while
          Update feedback is being composed or item is superseded. */}
      {!isSuperseded && !updating && (
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <a
            href={
              item.agent_output_id
                ? `/outputs/${item.agent_name}/${item.agent_output_id}`
                : `/queue/${item.id}/review`
            }
            className="px-4 py-2 text-sm rounded-md border hover:bg-white/5 transition min-h-[40px] inline-flex items-center"
            style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
          >
            Review
          </a>
          <button
            onClick={approve}
            disabled={isPending}
            className="px-4 py-2 text-sm rounded-md border hover:bg-white/5 transition disabled:opacity-40 min-h-[40px] min-w-[88px]"
            style={{ borderColor: 'var(--gold)', color: 'var(--gold)' }}
          >
            {isPending && !updating ? 'Saving…' : 'Approve'}
          </button>
          <button
            onClick={() => {
              setEditing((v) => !v);
              if (expanded === false) setExpanded(true);
            }}
            disabled={isPending}
            className="px-4 py-2 text-sm rounded-md border hover:bg-white/5 transition disabled:opacity-40 min-h-[40px]"
            style={{
              borderColor: editing ? 'var(--gold)' : 'var(--border)',
              color: editing ? 'var(--gold)' : 'var(--muted)',
            }}
          >
            {editing ? 'Editing · click to lock' : 'Edit'}
          </button>
          <button
            onClick={() => {
              setUpdating(true);
              setError(null);
            }}
            disabled={isPending}
            className="px-4 py-2 text-sm rounded-md border hover:bg-white/5 transition disabled:opacity-40 min-h-[40px]"
            style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
          >
            Update
          </button>
          <button
            onClick={ignore}
            disabled={isPending}
            title="Remove from queue + mark as known-incorrect sample for future training. Row stays in agent_outputs."
            className="px-4 py-2 text-sm rounded-md border hover:bg-white/5 transition disabled:opacity-40 min-h-[40px] ml-auto"
            style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
          >
            Ignore
          </button>
        </div>
      )}
      {error && <p className="text-xs mt-2" style={{ color: 'var(--danger)' }}>{error}</p>}
    </article>
  );
}

function updatePlaceholder(agent: string, type: string): string {
  if (agent === 'showrunner' && type === 'draft') {
    return 'e.g. "Tighten the Spotify title — lead with the trade." Or "Replace the #HandsAtWork tag with #ModernCraft in every caption." The agent figures out scope from your wording.';
  }
  if (agent === 'ops_chief' && type === 'briefing') {
    return 'e.g. "Reorder so the grant deadline leads, not the jacket return."';
  }
  if (
    (agent === 'sponsorship-director' || agent === 'pr-director') &&
    type === 'draft'
  ) {
    return 'e.g. "Less formal — drop the opening flattery. Keep everything else."';
  }
  return 'What should the agent change?';
}

// ============================================================================
// Showrunner captions tab — with per-clip Schedule button (Pass B)
// ============================================================================

interface ShowrunnerClipCaptionCard {
  index?: number;
  caption?: string;
  hashtags?: string[];
  platforms?: string[];
  filename?: string;
  storage_path?: string;
  output_id?: string;
  scheduled_at?: string;
  publish_date?: string;
  publish_time?: string;
  publish_timezone?: string;
  notion_content_id?: string;
}

function ShowrunnerCaptionsList({
  clipCaptions,
  legacySocialCaptions,
  approved,
}: {
  clipCaptions: ShowrunnerClipCaptionCard[];
  legacySocialCaptions: string[];
  approved: boolean;
}) {
  if (clipCaptions.length === 0 && legacySocialCaptions.length === 0) {
    return <p className="text-xs muted">(no captions)</p>;
  }
  if (clipCaptions.length === 0) {
    return (
      <ol className="space-y-3 text-sm list-decimal list-inside">
        {legacySocialCaptions.map((caption, i) => (
          <li key={i} className="muted whitespace-pre-wrap">
            {caption}
          </li>
        ))}
      </ol>
    );
  }
  return (
    <ol className="space-y-4 text-sm list-decimal list-inside">
      {clipCaptions.map((c, i) => (
        <li key={c.output_id ?? i} className="muted whitespace-pre-wrap">
          <div className="inline-flex flex-wrap items-center gap-2 align-top">
            <span>{c.caption ?? ''}</span>
          </div>
          {Array.isArray(c.hashtags) && c.hashtags.length > 0 && (
            <div className="text-xs mt-1" style={{ color: 'var(--gold-dim)' }}>
              {c.hashtags.join(' ')}
            </div>
          )}
          <ClipMeta clip={c} />
          {approved && c.output_id && <ClipScheduleControl clip={c} />}
        </li>
      ))}
    </ol>
  );
}

function ClipMeta({ clip }: { clip: ShowrunnerClipCaptionCard }) {
  if (!clip.storage_path && !clip.filename) return null;
  return (
    <div className="mt-1.5 text-[11px] muted flex items-center gap-2 flex-wrap">
      {clip.filename && <span>📎 {clip.filename}</span>}
      {clip.storage_path && <span>(in storage — ready to schedule)</span>}
    </div>
  );
}

function MarkAsSentControl({
  agentOutputId,
  channel,
  alreadySentAt,
  editedBody,
}: {
  agentOutputId: string;
  channel: 'email' | 'ig-dm' | 'through-team';
  alreadySentAt?: string;
  editedBody: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [sentAt, setSentAt] = useState<string | null>(alreadySentAt ?? null);
  const [err, setErr] = useState<string | null>(null);

  if (sentAt) {
    return (
      <div className="text-xs" style={{ color: 'var(--ok)' }}>
        ✓ Marked as sent {formatPtTime(sentAt)} PT — Notion Outreach row created.
      </div>
    );
  }

  const label =
    channel === 'email'
      ? 'Mark as sent (email — Gmail OAuth pending)'
      : channel === 'ig-dm'
        ? 'Mark as sent (IG DM — you send manually)'
        : 'Mark as sent (through team — you send manually)';

  const click = () => {
    setErr(null);
    startTransition(async () => {
      try {
        const res = await fetch(
          `/api/agents/talent-scout/drafts/${agentOutputId}/mark-sent`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              finalBody: editedBody ?? undefined,
            }),
          },
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || 'Mark as sent failed');
        setSentAt(data.sentAt ?? new Date().toISOString());
        router.refresh();
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Failed');
      }
    });
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <button
        onClick={click}
        disabled={isPending}
        className="px-3 py-1.5 text-xs rounded-md border hover:bg-white/5 transition disabled:opacity-40"
        style={{ borderColor: 'var(--gold)', color: 'var(--gold)' }}
      >
        {isPending ? 'Logging…' : label}
      </button>
      {err && (
        <span className="text-xs" style={{ color: 'var(--danger)' }}>
          {err}
        </span>
      )}
    </div>
  );
}

function ClipScheduleControl({ clip }: { clip: ShowrunnerClipCaptionCard }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [date, setDate] = useState(clip.publish_date ?? '');
  const [time, setTime] = useState(clip.publish_time ?? '11:11');
  const [err, setErr] = useState<string | null>(null);
  const isScheduled = !!clip.scheduled_at;

  const onSchedule = () => {
    setErr(null);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setErr('Pick a date first');
      return;
    }
    startTransition(async () => {
      try {
        const res = await fetch(
          `/api/agents/showrunner/clips/${clip.output_id}/schedule`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              publishDate: date,
              publishTime: time,
              publishTimezone: 'America/Los_Angeles',
            }),
          },
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || 'Schedule failed');
        router.refresh();
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Failed');
      }
    });
  };

  if (isScheduled) {
    return (
      <div className="mt-2 text-xs">
        <span style={{ color: 'var(--ok)' }}>
          ✓ Scheduled for {clip.publish_date} {clip.publish_time} PT
        </span>
        {clip.notion_content_id && (
          <a
            href={`https://www.notion.so/${clip.notion_content_id.replace(/-/g, '')}`}
            target="_blank"
            rel="noreferrer"
            className="ml-2 gold hover:underline"
          >
            Open in Notion ↗
          </a>
        )}
      </div>
    );
  }

  return (
    <div className="mt-2 flex items-center gap-2 flex-wrap">
      <input
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        disabled={isPending}
        className="bg-transparent border rounded-md px-2 py-1 text-xs"
        style={{ borderColor: 'var(--border)' }}
      />
      <input
        type="time"
        value={time}
        onChange={(e) => setTime(e.target.value)}
        disabled={isPending}
        className="bg-transparent border rounded-md px-2 py-1 text-xs"
        style={{ borderColor: 'var(--border)' }}
      />
      <span className="text-[11px] muted">PT</span>
      <button
        onClick={onSchedule}
        disabled={isPending}
        className="px-3 py-1 text-xs rounded-md border hover:bg-white/5 transition disabled:opacity-40"
        style={{ borderColor: 'var(--gold)', color: 'var(--gold)' }}
      >
        {isPending ? 'Scheduling…' : 'Schedule'}
      </button>
      {err && (
        <span className="text-xs" style={{ color: 'var(--danger)' }}>
          {err}
        </span>
      )}
    </div>
  );
}
