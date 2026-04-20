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

// ============================================================================
// Funding Scout — opportunity scan + application draft shapes
// ============================================================================

interface FundingOpportunityCard {
  opportunity_id: string;
  opportunity_name: string;
  funder: string;
  funding_type: string;
  funding_amount: number | null;
  application_deadline: string | null;
  source_url: string | null;
  ventures: string[];
  primary_venture: string;
  eligibility_criteria: string;
  match_rating: number;
  reason_for_match: string;
  effort_estimate: string;
  effort_hours_low: number | null;
  effort_hours_high: number | null;
  fit_score_out_of_six: number;
  recommendation: 'Apply' | 'Flag for review' | 'Skip';
  skip_reason: string | null;
  approved?: boolean;
  skipped?: boolean;
  feedback?: string | null;
  notion_row_id?: string | null;
  draft_output_id?: string | null;
  previous_versions?: Array<{
    opportunity_name: string;
    funder: string;
    funding_type: string;
    feedback: string | null;
    replaced_at: string;
  }>;
}

interface FundingOpportunityScanPayload {
  total_reviewed?: number;
  surfaced_count?: number;
  opportunities?: FundingOpportunityCard[];
  candidates_not_surfaced?: Array<{
    funder: string;
    opportunity_name: string;
    skip_reason: string;
  }>;
}

interface SystemEngineerFinding {
  id: string;
  repo_short_id: string;
  severity: 'critical' | 'medium' | 'low';
  category: string;
  title: string;
  impact: string;
  fix_suggestion: string;
  effort: 'S' | 'M' | 'L';
  file_refs: string[];
  status: string;
  first_seen_at: string;
  last_seen_at: string;
  days_open?: number;
  action_taken?: {
    kind: 'fix' | 'defer' | 'ignore';
    note: string | null;
    learning_id: string | null;
    taken_at: string;
  } | null;
}

interface SystemEngineerReportPayload {
  period?: { start: string; end: string };
  top_line?: string;
  severity_counts?: { critical: number; medium: number; low: number };
  repos?: Array<{
    short_id: string;
    label: string;
    slug: string | null;
    configured: boolean;
    error: string | null;
    findings_count: number;
  }>;
  findings?: SystemEngineerFinding[];
  vercel?: {
    configured: boolean;
    deployments_last_7d?: number;
    failed_deployments?: Array<{
      uid: string;
      state: string;
      created_at: string;
      url: string;
      name: string | null;
    }>;
    error?: string;
  };
}

interface SupervisorDiffProposal {
  id: string;
  agent: string;
  file_path: string;
  section: string;
  current_text: string;
  proposed_text: string;
  hypothesis: string;
  confidence: 'high' | 'medium' | 'low';
  evidence_output_ids: string[];
  reversibility: 'simple' | 'complex';
  action_taken?: {
    kind: 'approved' | 'rejected';
    note: string | null;
    learning_id: string | null;
    taken_at: string;
  } | null;
}

interface SupervisorPreferencePromotion {
  id: string;
  agent: string;
  rule_text: string;
  rationale: string;
  occurrence_count: number;
  evidence_output_ids: string[];
  action_taken?: {
    kind: 'approved' | 'rejected';
    note: string | null;
    taken_at: string;
  } | null;
}

interface SupervisorPerAgentObservation {
  agent: string;
  approval_rate_this_window: number | null;
  approval_rate_trailing_4w: number | null;
  output_volume: number;
  output_type_mix: Record<string, number>;
  pattern: string | null;
  evidence: string[];
  sample_size: 'high' | 'medium' | 'low' | 'under-sampled';
}

interface SupervisorReportPayload {
  output_type?: string;
  period?: { start: string; end: string };
  overall_assessment?: string;
  per_agent_observations?: SupervisorPerAgentObservation[];
  feedback_implementation_tracking?: Array<{
    feedback_text: string;
    agents: string[];
    absorbed: 'yes' | 'partial' | 'no';
    evidence: string[];
  }>;
  diff_proposals?: SupervisorDiffProposal[];
  preference_promotions?: SupervisorPreferencePromotion[];
  retrospective_checkins?: Array<{
    learning_id: string;
    title: string;
    applied_at: string | null;
    expected_effect: string;
    observed_effect: string;
    verdict: 'worked' | 'partially_worked' | 'did_not_work' | 'too_early';
  }>;
  under_sampled_agents?: string[];
  summary?: string;
  source_refs?: {
    excluded_agents?: string[];
    outputs_analyzed?: number;
    feedback_items_analyzed?: number;
    past_learnings_referenced?: number;
  };
}

interface GrowthRecommendation {
  id: string;
  title: string;
  rationale: string;
  confidence: 'high' | 'medium' | 'low';
  venture: string;
  brand_or_traction: 'brand-building' | 'traction';
  effort: 'low' | 'medium' | 'high';
  expected_impact: string;
  kr_reference: string | null;
  routing: {
    type: 'task' | 'agent-work' | 'new-agent';
    task_title?: string;
    task_description?: string;
    suggested_agent?: string;
    agent_brief?: string;
    proposed_agent_name?: string;
    proposed_agent_purpose?: string;
  };
  action_taken?: {
    kind: 'task' | 'agent-work' | 'new-agent';
    ref_id: string | null;
    note: string | null;
    taken_at: string;
  } | null;
  feedback?: {
    note: string;
    given_at: string;
  } | null;
}

interface GrowthBriefingPayload {
  output_type?: string;
  period?: { start: string; end: string } | null;
  overall_assessment?: string;
  recommendations?: GrowthRecommendation[];
  source_refs?: {
    analytics_output_id?: string | null;
    analytics_period?: { start: string; end: string } | null;
    krs_count?: number;
    past_experiments_count?: number;
  };
}

interface AnalyticsReportPayload {
  period?: { type?: string; start?: string; end?: string };
  generated_at?: string;
  platforms?: Record<string, Record<string, unknown>>;
  not_configured?: string[];
  errored?: Array<{ platform: string; error: string }>;
  cross_platform_summary?: string;
  notable_spikes?: Array<{
    platform: string;
    metric: string;
    change: string;
    note: string;
  }>;
}

interface FundingApplicationDraftPayload {
  opportunity_id?: string;
  opportunity_name?: string;
  funder?: string;
  funding_type?: string;
  application_deadline?: string | null;
  source_url?: string | null;
  primary_venture?: string;
  sections?: Array<{
    prompt: string;
    response: string;
    word_count: number;
  }>;
  full_draft?: string;
  word_count_total?: number;
  notes_for_briana?: string;
  stats_bible_references?: string[];
  proof_moment_used?: string;
  notion_row_id?: string | null;
  submitted_at?: string;
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
  // v3: each Showrunner queue item carries one output_kind — substack_post,
  // episode_metadata, or social_captions. Legacy one-shot items (no kind) still
  // render with all three tabs via the combined detection below.
  const showrunnerKind = item.full_output?.output_kind as
    | 'substack_post'
    | 'episode_metadata'
    | 'social_captions'
    | undefined;
  const showrunner =
    item.agent_name === 'showrunner' &&
    (showrunnerKind ||
      item.full_output?.substack_post ||
      item.full_output?.post_draft ||
      item.full_output?.clip_captions ||
      item.full_output?.youtube_title ||
      item.full_output?.episode_description)
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
  const isAnalyticsAgent = item.agent_name === 'analytics-reporting';
  const analyticsReport =
    isAnalyticsAgent &&
    typeof item.full_output?.cross_platform_summary === 'string'
      ? (item.full_output as AnalyticsReportPayload)
      : null;
  const isGrowthAgent = item.agent_name === 'growth-strategist';
  const growthBriefing =
    isGrowthAgent && Array.isArray(item.full_output?.recommendations)
      ? (item.full_output as GrowthBriefingPayload)
      : null;
  const isSupervisorAgent = item.agent_name === 'agent-supervisor';
  const supervisorReport =
    isSupervisorAgent &&
    Array.isArray(item.full_output?.per_agent_observations)
      ? (item.full_output as SupervisorReportPayload)
      : null;
  const isSystemEngineerAgent = item.agent_name === 'system-engineer';
  const sysEngReport =
    isSystemEngineerAgent && Array.isArray(item.full_output?.findings)
      ? (item.full_output as SystemEngineerReportPayload)
      : null;
  const isFundingAgent = item.agent_name === 'funding-scout';
  const fundingScan =
    isFundingAgent && Array.isArray(item.full_output?.opportunities)
      ? (item.full_output as FundingOpportunityScanPayload)
      : null;
  const fundingDraft =
    isFundingAgent &&
    !Array.isArray(item.full_output?.opportunities) &&
    (Array.isArray(item.full_output?.sections) || typeof item.full_output?.full_draft === 'string')
      ? (item.full_output as FundingApplicationDraftPayload)
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
    pitchDraft ||
    fundingScan ||
    fundingDraft ||
    analyticsReport ||
    growthBriefing ||
    supervisorReport ||
    sysEngReport
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

  // ── Funding Scout per-opportunity handlers ────────────────────────────────
  const approveOpportunity = (opportunityId: string) => {
    setLeadErrors((prev) => ({ ...prev, [opportunityId]: '' }));
    setLeadMutations((prev) => ({ ...prev, [opportunityId]: 'pending' }));
    startTransition(async () => {
      try {
        const res = await fetch('/api/agents/funding-scout/opportunities/approve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ queueItemId: item.id, opportunityId }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || 'Opportunity approval failed');
        setLeadMutations((prev) => ({ ...prev, [opportunityId]: 'done' }));
        router.refresh();
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Failed';
        setLeadMutations((prev) => ({ ...prev, [opportunityId]: 'error' }));
        setLeadErrors((prev) => ({ ...prev, [opportunityId]: msg }));
      }
    });
  };

  const skipOpportunityHandler = (opportunityId: string) => {
    setLeadErrors((prev) => ({ ...prev, [opportunityId]: '' }));
    const feedback = leadFeedback[opportunityId]?.trim() || undefined;
    startTransition(async () => {
      try {
        const res = await fetch('/api/agents/funding-scout/opportunities/skip', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ queueItemId: item.id, opportunityId, feedback }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || 'Skip failed');
        setLeadFeedback((prev) => ({ ...prev, [opportunityId]: '' }));
        router.refresh();
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Failed';
        setLeadErrors((prev) => ({ ...prev, [opportunityId]: msg }));
      }
    });
  };

  const replaceOpportunityHandler = (opportunityId: string) => {
    setLeadErrors((prev) => ({ ...prev, [opportunityId]: '' }));
    setLeadReplacing((prev) => ({ ...prev, [opportunityId]: true }));
    const feedback = leadFeedback[opportunityId]?.trim() || undefined;
    startTransition(async () => {
      try {
        const res = await fetch('/api/agents/funding-scout/opportunities/replace', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ queueItemId: item.id, opportunityId, feedback }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || 'Replacement failed');
        setLeadFeedback((prev) => ({ ...prev, [opportunityId]: '' }));
        setLeadReplacing((prev) => ({ ...prev, [opportunityId]: false }));
        router.refresh();
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Failed';
        setLeadReplacing((prev) => ({ ...prev, [opportunityId]: false }));
        setLeadErrors((prev) => ({ ...prev, [opportunityId]: msg }));
      }
    });
  };

  // ── Growth Strategist per-recommendation handlers ────────────────────────
  const approveRecAsTask = (recId: string) => {
    setLeadErrors((prev) => ({ ...prev, [recId]: '' }));
    setLeadMutations((prev) => ({ ...prev, [recId]: 'pending' }));
    startTransition(async () => {
      try {
        const res = await fetch(
          `/api/agents/growth-strategist/recommendations/${recId}/approve-as-task`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ queueItemId: item.id }),
          },
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || 'Task creation failed');
        setLeadMutations((prev) => ({ ...prev, [recId]: 'done' }));
        router.refresh();
      } catch (e) {
        setLeadMutations((prev) => ({ ...prev, [recId]: 'error' }));
        setLeadErrors((prev) => ({
          ...prev,
          [recId]: e instanceof Error ? e.message : 'Failed',
        }));
      }
    });
  };

  const approveRecAsAgentWork = (recId: string) => {
    setLeadErrors((prev) => ({ ...prev, [recId]: '' }));
    setLeadMutations((prev) => ({ ...prev, [recId]: 'pending' }));
    startTransition(async () => {
      try {
        const res = await fetch(
          `/api/agents/growth-strategist/recommendations/${recId}/approve-as-agent-work`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ queueItemId: item.id }),
          },
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || 'Agent routing failed');
        setLeadMutations((prev) => ({ ...prev, [recId]: 'done' }));
        router.refresh();
      } catch (e) {
        setLeadMutations((prev) => ({ ...prev, [recId]: 'error' }));
        setLeadErrors((prev) => ({
          ...prev,
          [recId]: e instanceof Error ? e.message : 'Failed',
        }));
      }
    });
  };

  const approveRecAsNewAgent = (recId: string) => {
    setLeadErrors((prev) => ({ ...prev, [recId]: '' }));
    setLeadMutations((prev) => ({ ...prev, [recId]: 'pending' }));
    startTransition(async () => {
      try {
        const res = await fetch(
          `/api/agents/growth-strategist/recommendations/${recId}/new-agent-proposal`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ queueItemId: item.id }),
          },
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || 'New-agent proposal failed');
        setLeadMutations((prev) => ({ ...prev, [recId]: 'done' }));
        router.refresh();
      } catch (e) {
        setLeadMutations((prev) => ({ ...prev, [recId]: 'error' }));
        setLeadErrors((prev) => ({
          ...prev,
          [recId]: e instanceof Error ? e.message : 'Failed',
        }));
      }
    });
  };

  // ── Supervisor handlers ───────────────────────────────────────────────────
  const [supervisorDiffText, setSupervisorDiffText] = useState<Record<string, string>>({});

  const approveSupervisorProposal = (proposalId: string) => {
    setLeadErrors((prev) => ({ ...prev, [proposalId]: '' }));
    setLeadMutations((prev) => ({ ...prev, [proposalId]: 'pending' }));
    startTransition(async () => {
      try {
        const res = await fetch(
          `/api/agents/agent-supervisor/proposals/${proposalId}/approve`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ queueItemId: item.id }),
          },
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || 'Approve failed');
        setLeadMutations((prev) => ({ ...prev, [proposalId]: 'done' }));
        if (data.diffText) {
          setSupervisorDiffText((prev) => ({ ...prev, [proposalId]: data.diffText }));
        }
        router.refresh();
      } catch (e) {
        setLeadMutations((prev) => ({ ...prev, [proposalId]: 'error' }));
        setLeadErrors((prev) => ({
          ...prev,
          [proposalId]: e instanceof Error ? e.message : 'Failed',
        }));
      }
    });
  };

  const rejectSupervisorProposal = (proposalId: string) => {
    const reason = leadFeedback[proposalId]?.trim();
    setLeadErrors((prev) => ({ ...prev, [proposalId]: '' }));
    setLeadMutations((prev) => ({ ...prev, [proposalId]: 'pending' }));
    startTransition(async () => {
      try {
        const res = await fetch(
          `/api/agents/agent-supervisor/proposals/${proposalId}/reject`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ queueItemId: item.id, reason: reason || undefined }),
          },
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || 'Reject failed');
        setLeadMutations((prev) => ({ ...prev, [proposalId]: 'done' }));
        setLeadFeedback((prev) => ({ ...prev, [proposalId]: '' }));
        router.refresh();
      } catch (e) {
        setLeadMutations((prev) => ({ ...prev, [proposalId]: 'error' }));
        setLeadErrors((prev) => ({
          ...prev,
          [proposalId]: e instanceof Error ? e.message : 'Failed',
        }));
      }
    });
  };

  const actOnSupervisorPromotion = (promotionId: string, action: 'approve' | 'reject') => {
    const reason = action === 'reject' ? leadFeedback[promotionId]?.trim() : undefined;
    setLeadErrors((prev) => ({ ...prev, [promotionId]: '' }));
    setLeadMutations((prev) => ({ ...prev, [promotionId]: 'pending' }));
    startTransition(async () => {
      try {
        const res = await fetch(
          `/api/agents/agent-supervisor/preferences/${promotionId}/approve`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              queueItemId: item.id,
              action,
              reason: reason || undefined,
            }),
          },
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || 'Action failed');
        setLeadMutations((prev) => ({ ...prev, [promotionId]: 'done' }));
        setLeadFeedback((prev) => ({ ...prev, [promotionId]: '' }));
        router.refresh();
      } catch (e) {
        setLeadMutations((prev) => ({ ...prev, [promotionId]: 'error' }));
        setLeadErrors((prev) => ({
          ...prev,
          [promotionId]: e instanceof Error ? e.message : 'Failed',
        }));
      }
    });
  };

  // ── System Engineer per-finding handlers ──────────────────────────────────
  const [findingExpansions, setFindingExpansions] = useState<Record<string, string>>({});

  const markFindingFixAction = (findingId: string) => {
    setLeadErrors((prev) => ({ ...prev, [findingId]: '' }));
    setLeadMutations((prev) => ({ ...prev, [findingId]: 'pending' }));
    startTransition(async () => {
      try {
        const res = await fetch(
          `/api/agents/system-engineer/findings/${findingId}/fix`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ queueItemId: item.id }),
          },
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || 'Mark fix failed');
        setLeadMutations((prev) => ({ ...prev, [findingId]: 'done' }));
        router.refresh();
      } catch (e) {
        setLeadMutations((prev) => ({ ...prev, [findingId]: 'error' }));
        setLeadErrors((prev) => ({
          ...prev,
          [findingId]: e instanceof Error ? e.message : 'Failed',
        }));
      }
    });
  };

  const markFindingDeferAction = (findingId: string) => {
    const reason = leadFeedback[findingId]?.trim();
    if (!reason) {
      setLeadErrors((prev) => ({
        ...prev,
        [findingId]: 'Defer reason required — tell the agent why so it does not re-surface.',
      }));
      return;
    }
    setLeadErrors((prev) => ({ ...prev, [findingId]: '' }));
    setLeadMutations((prev) => ({ ...prev, [findingId]: 'pending' }));
    startTransition(async () => {
      try {
        const res = await fetch(
          `/api/agents/system-engineer/findings/${findingId}/defer`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ queueItemId: item.id, reason }),
          },
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || 'Defer failed');
        setLeadMutations((prev) => ({ ...prev, [findingId]: 'done' }));
        setLeadFeedback((prev) => ({ ...prev, [findingId]: '' }));
        router.refresh();
      } catch (e) {
        setLeadMutations((prev) => ({ ...prev, [findingId]: 'error' }));
        setLeadErrors((prev) => ({
          ...prev,
          [findingId]: e instanceof Error ? e.message : 'Failed',
        }));
      }
    });
  };

  const markFindingIgnoreAction = (findingId: string) => {
    setLeadErrors((prev) => ({ ...prev, [findingId]: '' }));
    setLeadMutations((prev) => ({ ...prev, [findingId]: 'pending' }));
    startTransition(async () => {
      try {
        const res = await fetch(
          `/api/agents/system-engineer/findings/${findingId}/ignore`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ queueItemId: item.id }),
          },
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || 'Ignore failed');
        setLeadMutations((prev) => ({ ...prev, [findingId]: 'done' }));
        router.refresh();
      } catch (e) {
        setLeadMutations((prev) => ({ ...prev, [findingId]: 'error' }));
        setLeadErrors((prev) => ({
          ...prev,
          [findingId]: e instanceof Error ? e.message : 'Failed',
        }));
      }
    });
  };

  const expandFindingAction = (findingId: string) => {
    setLeadErrors((prev) => ({ ...prev, [findingId]: '' }));
    setLeadMutations((prev) => ({ ...prev, [findingId]: 'pending' }));
    startTransition(async () => {
      try {
        const res = await fetch(
          `/api/agents/system-engineer/findings/${findingId}/expand`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ queueItemId: item.id }),
          },
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || 'Expand failed');
        setFindingExpansions((prev) => ({
          ...prev,
          [findingId]: data.expansion ?? '',
        }));
        setLeadMutations((prev) => ({ ...prev, [findingId]: 'done' }));
      } catch (e) {
        setLeadMutations((prev) => ({ ...prev, [findingId]: 'error' }));
        setLeadErrors((prev) => ({
          ...prev,
          [findingId]: e instanceof Error ? e.message : 'Failed',
        }));
      }
    });
  };

  // Feedback capture — non-terminal. Briana can add feedback AND still take a
  // routing action (or not). Next Growth Strategist run reads past feedback
  // and uses it to refine / drop / reframe recommendations.
  const [recFeedbackEditing, setRecFeedbackEditing] = useState<Record<string, boolean>>({});
  const submitRecFeedback = (recId: string) => {
    const note = (leadFeedback[recId] ?? '').trim();
    if (!note) {
      setLeadErrors((prev) => ({ ...prev, [recId]: 'feedback cannot be empty' }));
      return;
    }
    setLeadErrors((prev) => ({ ...prev, [recId]: '' }));
    startTransition(async () => {
      try {
        const res = await fetch(
          `/api/agents/growth-strategist/recommendations/${recId}/feedback`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ queueItemId: item.id, note }),
          },
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || 'Feedback save failed');
        setLeadFeedback((prev) => ({ ...prev, [recId]: '' }));
        setRecFeedbackEditing((prev) => ({ ...prev, [recId]: false }));
        router.refresh();
      } catch (e) {
        setLeadErrors((prev) => ({
          ...prev,
          [recId]: e instanceof Error ? e.message : 'Failed',
        }));
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

      {/* Showrunner — v3 per-kind single section, or legacy 3-tab view */}
      {expanded && showrunner && (
        <div className="mb-3">
          {/* Single-kind view (v3): render only the relevant section */}
          {showrunnerKind === 'episode_metadata' && (
            <div className="space-y-4 text-sm">
              <div>
                <span className="text-xs muted uppercase tracking-wider">
                  YouTube title
                </span>
                <p className="serif mt-1">
                  {showrunner.youtube_title ?? '(not set)'}
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
                  {showrunner.episode_description ?? '(not set)'}
                </pre>
              </div>
            </div>
          )}

          {showrunnerKind === 'substack_post' && (
            <div className="space-y-4 text-sm">
              <div>
                <span className="text-xs muted uppercase tracking-wider">
                  Substack title
                </span>
                <p className="serif mt-1">
                  {showrunner.substack_title ?? '(not set)'}
                </p>
              </div>
              <div>
                <span className="text-xs muted uppercase tracking-wider">
                  Substack subtitle
                </span>
                <p className="mt-1">
                  {showrunner.substack_subtitle ?? '(not set)'}
                </p>
              </div>
              <div>
                <span className="text-xs muted uppercase tracking-wider">
                  Substack post
                </span>
                <div className="prose prose-invert prose-sm max-w-none whitespace-pre-wrap text-sm max-h-[400px] overflow-y-auto mt-1">
                  {showrunner.substack_post ?? '(empty)'}
                </div>
              </div>
            </div>
          )}

          {showrunnerKind === 'social_captions' && (
            <ShowrunnerCaptionsList
              clipCaptions={
                Array.isArray(showrunner.clip_captions)
                  ? (showrunner.clip_captions as ShowrunnerClipCaptionCard[])
                  : []
              }
              legacySocialCaptions={[]}
              approved={item.status === 'approved' || item.status === 'executed'}
            />
          )}

          {/* Legacy one-shot items — keep the 3-tab view for back-compat */}
          {!showrunnerKind && (
            <>
              <div className="flex gap-2 mb-3">
                {(['meta', 'captions', 'post'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className="px-3 py-1 text-xs rounded-md border transition"
                    style={{
                      borderColor:
                        activeTab === tab ? 'var(--gold)' : 'var(--border)',
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
            </>
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

      {/* Funding Scout opportunity scan — per-opportunity Approve/Skip/Replace */}
      {expanded && fundingScan && (
        <div className="mb-3 space-y-3">
          <div className="text-xs muted">
            Reviewed {fundingScan.total_reviewed ?? 0}, surfacing{' '}
            {fundingScan.opportunities?.length ?? 0}
          </div>
          <ol className="space-y-3">
            {(fundingScan.opportunities ?? []).map((opp) => {
              const mutation = leadMutations[opp.opportunity_id];
              const isDone = opp.approved || mutation === 'done';
              const isApproving = mutation === 'pending';
              const isReplacing = leadReplacing[opp.opportunity_id];
              const isSkipped = opp.skipped;
              const priorCount = opp.previous_versions?.length ?? 0;
              const amountLabel =
                opp.funding_amount != null
                  ? `$${opp.funding_amount.toLocaleString()}`
                  : 'variable';
              const effortHoursLabel =
                opp.effort_hours_low != null && opp.effort_hours_high != null
                  ? ` (${opp.effort_hours_low}–${opp.effort_hours_high}h)`
                  : '';
              return (
                <li
                  key={opp.opportunity_id}
                  className="border rounded-md p-3 text-sm"
                  style={{
                    borderColor: 'var(--border)',
                    opacity: isSkipped ? 0.5 : 1,
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="serif text-base">
                          {opp.funder} — {opp.opportunity_name}
                        </span>
                        <span className="text-xs muted">
                          {opp.funding_type} · {amountLabel}
                          {opp.application_deadline
                            ? ` · deadline ${opp.application_deadline}`
                            : ''}
                          {` · fit ${opp.fit_score_out_of_six}/6`}
                        </span>
                        <span
                          className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm"
                          style={{
                            border:
                              opp.recommendation === 'Apply'
                                ? '1px solid var(--ok)'
                                : opp.recommendation === 'Flag for review'
                                  ? '1px solid var(--gold-dim)'
                                  : '1px solid var(--border)',
                            color:
                              opp.recommendation === 'Apply'
                                ? 'var(--ok)'
                                : opp.recommendation === 'Flag for review'
                                  ? 'var(--gold)'
                                  : 'var(--muted)',
                          }}
                        >
                          {opp.recommendation}
                        </span>
                        <span
                          className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm"
                          style={{
                            border: '1px solid var(--border)',
                            color: 'var(--muted)',
                          }}
                        >
                          {opp.effort_estimate}
                          {effortHoursLabel}
                        </span>
                        {priorCount > 0 && (
                          <span
                            className="text-[10px] uppercase tracking-wider"
                            style={{ color: 'var(--gold-dim)' }}
                            title={(opp.previous_versions ?? [])
                              .map(
                                (v) =>
                                  `${v.funder} — ${v.opportunity_name}${v.feedback ? ` (${v.feedback})` : ''}`,
                              )
                              .join('\n')}
                          >
                            replaced {priorCount}x
                          </span>
                        )}
                      </div>
                      <div className="text-xs muted mt-0.5 flex flex-wrap gap-1">
                        {opp.ventures.map((v, i) => (
                          <span
                            key={i}
                            className="px-1.5 py-0.5 rounded-sm"
                            style={{
                              border: '1px solid var(--border)',
                              color: 'var(--muted)',
                            }}
                          >
                            {v}
                          </span>
                        ))}
                      </div>
                      <p className="mt-1.5">{opp.reason_for_match}</p>
                      {opp.eligibility_criteria && (
                        <p className="text-xs muted mt-1 italic">
                          eligibility · {opp.eligibility_criteria}
                        </p>
                      )}
                      {opp.source_url && (
                        <p className="text-xs muted mt-0.5">
                          source ·{' '}
                          <a
                            href={opp.source_url}
                            target="_blank"
                            rel="noreferrer"
                            className="gold hover:underline"
                          >
                            funder page ↗
                          </a>
                        </p>
                      )}
                      {opp.notion_row_id && (
                        <p className="text-xs muted mt-0.5">
                          notion ·{' '}
                          <a
                            href={`https://www.notion.so/${opp.notion_row_id.replace(/-/g, '')}`}
                            target="_blank"
                            rel="noreferrer"
                            className="gold hover:underline"
                          >
                            open funding row ↗
                          </a>
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col gap-1 shrink-0">
                      <button
                        onClick={() => approveOpportunity(opp.opportunity_id)}
                        disabled={isDone || isApproving || isReplacing || isSkipped}
                        className="px-3 py-1.5 text-xs rounded-md border hover:bg-white/5 transition disabled:opacity-40 min-h-[36px]"
                        style={{
                          borderColor: isDone ? 'var(--gold-dim)' : 'var(--gold)',
                          color: isDone ? 'var(--muted)' : 'var(--gold)',
                        }}
                      >
                        {isDone
                          ? 'Draft queued'
                          : isApproving
                            ? 'Drafting…'
                            : isSkipped
                              ? 'Skipped'
                              : 'Approve + Draft'}
                      </button>
                      {!isDone && !isSkipped && (
                        <button
                          onClick={() => skipOpportunityHandler(opp.opportunity_id)}
                          disabled={isApproving || isReplacing}
                          className="px-3 py-1.5 text-xs rounded-md border hover:bg-white/5 transition disabled:opacity-40 min-h-[36px]"
                          style={{
                            borderColor: 'var(--border)',
                            color: 'var(--muted)',
                          }}
                        >
                          Skip
                        </button>
                      )}
                    </div>
                  </div>

                  {!isDone && !isSkipped && (
                    <div className="mt-2.5 flex items-stretch gap-2">
                      <input
                        type="text"
                        placeholder="Feedback for replacement or skip reason (optional)…"
                        value={leadFeedback[opp.opportunity_id] ?? ''}
                        onChange={(e) =>
                          setLeadFeedback((prev) => ({
                            ...prev,
                            [opp.opportunity_id]: e.target.value,
                          }))
                        }
                        disabled={isApproving || isReplacing}
                        className="flex-1 min-w-0 bg-transparent border rounded-md px-2.5 py-1.5 text-xs disabled:opacity-40"
                        style={{ borderColor: 'var(--border)' }}
                      />
                      <button
                        onClick={() => replaceOpportunityHandler(opp.opportunity_id)}
                        disabled={isApproving || isReplacing}
                        className="shrink-0 px-3 py-1.5 text-xs rounded-md border hover:bg-white/5 transition disabled:opacity-40 min-h-[36px]"
                        style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
                      >
                        {isReplacing ? 'Replacing…' : 'Replace'}
                      </button>
                    </div>
                  )}

                  {leadErrors[opp.opportunity_id] && (
                    <p
                      className="text-xs mt-1.5"
                      style={{ color: 'var(--danger)' }}
                    >
                      {leadErrors[opp.opportunity_id]}
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
          {Array.isArray(fundingScan.candidates_not_surfaced) &&
            fundingScan.candidates_not_surfaced.length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs muted hover:text-[var(--gold)]">
                  {fundingScan.candidates_not_surfaced.length} candidates skipped by the fit test
                </summary>
                <ul className="mt-2 space-y-1 text-xs muted">
                  {fundingScan.candidates_not_surfaced.map((c, i) => (
                    <li key={i}>
                      <span className="serif">{c.funder}</span> — {c.opportunity_name}: {c.skip_reason}
                    </li>
                  ))}
                </ul>
              </details>
            )}
        </div>
      )}

      {/* Funding Scout application draft — sections, stats bible, submit control */}
      {expanded && fundingDraft && (
        <div className="mb-3 space-y-3 text-sm">
          <div className="text-xs muted flex flex-wrap gap-2">
            <span>{fundingDraft.funder}</span>
            <span>· {fundingDraft.funding_type}</span>
            {fundingDraft.application_deadline && (
              <span>· deadline {fundingDraft.application_deadline}</span>
            )}
            {fundingDraft.word_count_total != null && (
              <span>· {fundingDraft.word_count_total} words</span>
            )}
            {fundingDraft.proof_moment_used &&
              fundingDraft.proof_moment_used !== 'none' && (
                <span>· proof: {fundingDraft.proof_moment_used}</span>
              )}
          </div>

          {fundingDraft.notes_for_briana && (
            <div
              className="text-xs border rounded-md p-2.5"
              style={{
                borderColor: 'var(--gold-dim)',
                color: 'var(--gold)',
              }}
            >
              <div className="uppercase tracking-wider mb-0.5">Notes for Briana</div>
              <div className="text-sm" style={{ color: 'var(--foreground)' }}>
                {fundingDraft.notes_for_briana}
              </div>
            </div>
          )}

          {Array.isArray(fundingDraft.sections) && fundingDraft.sections.length > 0 ? (
            <div className="space-y-4">
              {fundingDraft.sections.map((s, i) => (
                <div key={i}>
                  <div className="text-xs muted uppercase tracking-wider mb-1">
                    {s.prompt}
                    {s.word_count ? ` · ${s.word_count} words` : ''}
                  </div>
                  <pre className="whitespace-pre-wrap text-sm leading-relaxed">
                    {s.response}
                  </pre>
                </div>
              ))}
            </div>
          ) : (
            <pre className="whitespace-pre-wrap text-sm leading-relaxed">
              {fundingDraft.full_draft ?? ''}
            </pre>
          )}

          {Array.isArray(fundingDraft.stats_bible_references) &&
            fundingDraft.stats_bible_references.length > 0 && (
              <div className="text-xs muted">
                <span className="uppercase tracking-wider">Stats used · </span>
                {fundingDraft.stats_bible_references.join(' · ')}
              </div>
            )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs muted">
            {fundingDraft.source_url && (
              <div>
                <a
                  href={fundingDraft.source_url}
                  target="_blank"
                  rel="noreferrer"
                  className="gold hover:underline"
                >
                  Open funder application page ↗
                </a>
              </div>
            )}
            {fundingDraft.notion_row_id && (
              <div>
                <a
                  href={`https://www.notion.so/${fundingDraft.notion_row_id.replace(/-/g, '')}`}
                  target="_blank"
                  rel="noreferrer"
                  className="gold hover:underline"
                >
                  Open funding row in Notion ↗
                </a>
              </div>
            )}
            {item.status === 'approved' && item.agent_output_id && (
              <div className="md:col-span-2">
                <MarkAsSubmittedControl
                  agentOutputId={item.agent_output_id}
                  alreadySubmittedAt={fundingDraft.submitted_at}
                  funder={fundingDraft.funder ?? 'this funder'}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* System Engineer weekly report — severity-ranked findings with Fix / Defer / Ignore */}
      {expanded && sysEngReport && (
        <div className="mb-3 space-y-4 text-sm">
          {sysEngReport.top_line && (
            <div className="whitespace-pre-wrap leading-relaxed">
              {sysEngReport.top_line}
            </div>
          )}

          {/* Repo coverage + Vercel summary */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
            <div>
              <div className="muted uppercase tracking-wider mb-1">Repos scanned</div>
              <ul className="space-y-0.5">
                {(sysEngReport.repos ?? []).map((r) => (
                  <li key={r.short_id}>
                    <span className="serif">{r.label}</span>{' '}
                    <span className="muted">
                      ·{' '}
                      {r.configured ? (
                        r.error ? (
                          <span style={{ color: 'var(--danger)' }}>error: {r.error.slice(0, 80)}</span>
                        ) : (
                          <>
                            {r.findings_count} finding{r.findings_count === 1 ? '' : 's'}
                          </>
                        )
                      ) : (
                        <span style={{ color: 'var(--muted)' }}>not configured</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="muted uppercase tracking-wider mb-1">Vercel</div>
              {sysEngReport.vercel?.configured ? (
                <>
                  <div className="muted">
                    {sysEngReport.vercel.deployments_last_7d ?? 0} deployments · last 7d
                  </div>
                  {Array.isArray(sysEngReport.vercel.failed_deployments) &&
                    sysEngReport.vercel.failed_deployments.length > 0 && (
                      <ul
                        className="mt-1 space-y-0.5"
                        style={{ color: 'var(--danger)' }}
                      >
                        {sysEngReport.vercel.failed_deployments.slice(0, 4).map((d) => (
                          <li key={d.uid}>
                            ⚠ {d.state} · {d.name ?? 'unnamed'} · {d.created_at.slice(0, 10)}
                          </li>
                        ))}
                      </ul>
                    )}
                </>
              ) : (
                <div className="muted">
                  {sysEngReport.vercel?.error ?? 'not configured'}
                </div>
              )}
            </div>
          </div>

          {/* Findings list */}
          {Array.isArray(sysEngReport.findings) && sysEngReport.findings.length > 0 ? (
            (['critical', 'medium', 'low'] as const).map((sev) => {
              const group = (sysEngReport.findings ?? []).filter((f) => f.severity === sev);
              if (group.length === 0) return null;
              return (
                <div key={sev}>
                  <div className="text-xs muted uppercase tracking-wider mb-1.5">
                    {sev === 'critical'
                      ? `Critical · ${group.length}`
                      : sev === 'medium'
                        ? `Medium · ${group.length}`
                        : `Low · ${group.length}`}
                  </div>
                  <ol className="space-y-2">
                    {group.map((f) => {
                      const mutation = leadMutations[f.id];
                      const pending = mutation === 'pending';
                      const acted = !!f.action_taken;
                      const expansion = findingExpansions[f.id];
                      return (
                        <li
                          key={f.id}
                          className="border rounded-md p-3"
                          style={{
                            borderColor:
                              sev === 'critical'
                                ? 'var(--danger)'
                                : sev === 'medium'
                                  ? 'var(--gold-dim)'
                                  : 'var(--border)',
                            opacity: acted ? 0.7 : 1,
                          }}
                        >
                          <div className="flex items-start gap-2 flex-wrap">
                            <span
                              className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm shrink-0"
                              style={{
                                border:
                                  sev === 'critical'
                                    ? '1px solid var(--danger)'
                                    : sev === 'medium'
                                      ? '1px solid var(--gold-dim)'
                                      : '1px solid var(--border)',
                                color:
                                  sev === 'critical'
                                    ? 'var(--danger)'
                                    : sev === 'medium'
                                      ? 'var(--gold)'
                                      : 'var(--muted)',
                              }}
                            >
                              {f.id}
                            </span>
                            <span className="serif min-w-0 flex-1">{f.title}</span>
                            <span className="text-[10px] uppercase tracking-wider muted shrink-0">
                              {f.category} · {f.effort}
                            </span>
                          </div>
                          <p className="text-xs muted mt-1">
                            <span className="uppercase tracking-wider">Impact · </span>
                            {f.impact}
                          </p>
                          <p className="text-xs muted mt-0.5">
                            <span className="uppercase tracking-wider">Fix · </span>
                            {f.fix_suggestion}
                          </p>
                          {f.file_refs.length > 0 && (
                            <p className="text-xs muted mt-0.5">
                              <span className="uppercase tracking-wider">Files · </span>
                              {f.file_refs.join(' · ')}
                            </p>
                          )}
                          {f.status === 'persisting' && f.days_open != null && (
                            <p className="text-xs mt-0.5" style={{ color: 'var(--gold-dim)' }}>
                              Open {f.days_open}d
                            </p>
                          )}
                          {f.status === 'reopened' && (
                            <p className="text-xs mt-0.5" style={{ color: 'var(--danger)' }}>
                              Reopened — previously marked fixed
                            </p>
                          )}

                          {expansion && (
                            <div
                              className="mt-2 border rounded-md p-2 text-xs whitespace-pre-wrap"
                              style={{ borderColor: 'var(--gold-dim)' }}
                            >
                              {expansion}
                            </div>
                          )}

                          {acted ? (
                            <div
                              className="mt-2 text-xs"
                              style={{
                                color:
                                  f.action_taken!.kind === 'fix'
                                    ? 'var(--gold)'
                                    : 'var(--muted)',
                              }}
                            >
                              {f.action_taken!.kind === 'fix'
                                ? '✓ Marked Fix — re-surfaces if still present after 14d'
                                : f.action_taken!.kind === 'defer'
                                  ? `✗ Deferred${f.action_taken!.note ? ` — ${f.action_taken!.note}` : ''}`
                                  : '✗ Ignored — will not re-surface'}{' '}
                              · {formatPtTime(f.action_taken!.taken_at)} PT
                            </div>
                          ) : (
                            <div className="mt-2.5 flex items-stretch gap-2 flex-wrap">
                              <button
                                onClick={() => markFindingFixAction(f.id)}
                                disabled={pending}
                                className="px-3 py-1.5 text-xs rounded-md border hover:bg-white/5 transition disabled:opacity-40 min-h-[36px]"
                                style={{ borderColor: 'var(--gold)', color: 'var(--gold)' }}
                              >
                                Fix
                              </button>
                              <input
                                type="text"
                                placeholder="Defer reason (required)"
                                value={leadFeedback[f.id] ?? ''}
                                onChange={(e) =>
                                  setLeadFeedback((prev) => ({
                                    ...prev,
                                    [f.id]: e.target.value,
                                  }))
                                }
                                disabled={pending}
                                className="flex-1 min-w-[180px] bg-transparent border rounded-md px-2.5 py-1.5 text-xs disabled:opacity-40"
                                style={{ borderColor: 'var(--border)' }}
                              />
                              <button
                                onClick={() => markFindingDeferAction(f.id)}
                                disabled={pending}
                                className="px-3 py-1.5 text-xs rounded-md border hover:bg-white/5 transition disabled:opacity-40 min-h-[36px]"
                                style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
                              >
                                Defer
                              </button>
                              <button
                                onClick={() => markFindingIgnoreAction(f.id)}
                                disabled={pending}
                                className="px-3 py-1.5 text-xs rounded-md border hover:bg-white/5 transition disabled:opacity-40 min-h-[36px]"
                                style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
                              >
                                Ignore
                              </button>
                              <button
                                onClick={() => expandFindingAction(f.id)}
                                disabled={pending}
                                className="px-3 py-1.5 text-xs rounded-md border hover:bg-white/5 transition disabled:opacity-40 min-h-[36px]"
                                style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
                              >
                                {pending ? 'Expanding…' : 'Expand'}
                              </button>
                            </div>
                          )}

                          {leadErrors[f.id] && (
                            <p className="text-xs mt-1.5" style={{ color: 'var(--danger)' }}>
                              {leadErrors[f.id]}
                            </p>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                </div>
              );
            })
          ) : (
            <p className="text-sm muted">
              No findings this scan — everything looks clean across the
              configured repos.
            </p>
          )}
        </div>
      )}

      {/* Agent Supervisor report — narrative + diff proposals + preference promotions */}
      {expanded && supervisorReport && (
        <div className="mb-3 space-y-4 text-sm">
          {supervisorReport.period && (
            <div className="text-xs muted">
              {supervisorReport.period.start} → {supervisorReport.period.end}
              {supervisorReport.source_refs?.outputs_analyzed != null &&
                ` · ${supervisorReport.source_refs.outputs_analyzed} outputs analyzed`}
            </div>
          )}
          {supervisorReport.overall_assessment && (
            <div className="whitespace-pre-wrap leading-relaxed">
              {supervisorReport.overall_assessment}
            </div>
          )}

          {/* Per-agent observations */}
          {Array.isArray(supervisorReport.per_agent_observations) &&
            supervisorReport.per_agent_observations.length > 0 && (
              <div>
                <div className="text-xs muted uppercase tracking-wider mb-1.5">
                  Per-agent observations
                </div>
                <ul className="space-y-2">
                  {supervisorReport.per_agent_observations.map((o, i) => (
                    <li
                      key={i}
                      className="border rounded-md p-3"
                      style={{ borderColor: 'var(--border)' }}
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="serif">{o.agent}</span>
                        <span
                          className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm"
                          style={{
                            border: '1px solid var(--border)',
                            color:
                              o.sample_size === 'high'
                                ? 'var(--ok)'
                                : o.sample_size === 'under-sampled'
                                  ? 'var(--muted)'
                                  : 'var(--gold-dim)',
                          }}
                        >
                          {o.sample_size}
                        </span>
                        {o.approval_rate_this_window != null && (
                          <span className="text-xs muted">
                            {(o.approval_rate_this_window * 100).toFixed(0)}% approval
                            {o.approval_rate_trailing_4w != null
                              ? ` · trailing ${(o.approval_rate_trailing_4w * 100).toFixed(0)}%`
                              : ''}
                          </span>
                        )}
                        <span className="text-xs muted">· {o.output_volume} outputs</span>
                      </div>
                      {o.pattern && (
                        <p className="mt-1 text-sm">{o.pattern}</p>
                      )}
                      {Array.isArray(o.evidence) && o.evidence.length > 0 && (
                        <p className="text-xs muted mt-1">
                          Evidence · {o.evidence.join(' · ')}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

          {/* Feedback implementation tracking */}
          {Array.isArray(supervisorReport.feedback_implementation_tracking) &&
            supervisorReport.feedback_implementation_tracking.length > 0 && (
              <div>
                <div className="text-xs muted uppercase tracking-wider mb-1.5">
                  Feedback implementation
                </div>
                <ul className="space-y-1.5 text-sm">
                  {supervisorReport.feedback_implementation_tracking.map((f, i) => (
                    <li key={i} className="flex items-baseline gap-2 flex-wrap">
                      <span
                        className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm"
                        style={{
                          border:
                            f.absorbed === 'yes'
                              ? '1px solid var(--ok)'
                              : f.absorbed === 'no'
                                ? '1px solid var(--danger)'
                                : '1px solid var(--gold-dim)',
                          color:
                            f.absorbed === 'yes'
                              ? 'var(--ok)'
                              : f.absorbed === 'no'
                                ? 'var(--danger)'
                                : 'var(--gold)',
                        }}
                      >
                        {f.absorbed}
                      </span>
                      <span>&ldquo;{f.feedback_text.slice(0, 160)}&rdquo;</span>
                      <span className="text-xs muted">→ {f.agents.join(', ')}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

          {/* Diff proposals */}
          {Array.isArray(supervisorReport.diff_proposals) &&
            supervisorReport.diff_proposals.length > 0 && (
              <div>
                <div className="text-xs muted uppercase tracking-wider mb-1.5">
                  Diff proposals
                </div>
                <ol className="space-y-3">
                  {supervisorReport.diff_proposals.map((p) => {
                    const mutation = leadMutations[p.id];
                    const pending = mutation === 'pending';
                    const acted = !!p.action_taken;
                    const diffTextJustApproved = supervisorDiffText[p.id];
                    return (
                      <li
                        key={p.id}
                        className="border rounded-md p-3"
                        style={{
                          borderColor: 'var(--border)',
                          opacity: acted ? 0.85 : 1,
                        }}
                      >
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="serif">
                            {p.agent} — {p.file_path}
                          </span>
                          <span
                            className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm"
                            style={{
                              border:
                                p.confidence === 'high'
                                  ? '1px solid var(--ok)'
                                  : p.confidence === 'medium'
                                    ? '1px solid var(--gold-dim)'
                                    : '1px solid var(--border)',
                              color:
                                p.confidence === 'high'
                                  ? 'var(--ok)'
                                  : p.confidence === 'medium'
                                    ? 'var(--gold)'
                                    : 'var(--muted)',
                            }}
                          >
                            {p.confidence}
                          </span>
                          <span
                            className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm"
                            style={{ border: '1px solid var(--border)', color: 'var(--muted)' }}
                          >
                            {p.reversibility}
                          </span>
                        </div>
                        <p className="text-xs muted mt-0.5">Section · {p.section}</p>
                        <p className="mt-1.5">{p.hypothesis}</p>
                        {p.current_text && (
                          <details className="mt-2">
                            <summary className="cursor-pointer text-xs gold hover:underline">
                              View current / proposed
                            </summary>
                            <div className="mt-2 space-y-2 text-xs">
                              <div>
                                <div className="muted uppercase tracking-wider mb-0.5">
                                  Current
                                </div>
                                <pre className="whitespace-pre-wrap border rounded-md p-2" style={{ borderColor: 'var(--border)' }}>
                                  {p.current_text}
                                </pre>
                              </div>
                              <div>
                                <div className="muted uppercase tracking-wider mb-0.5">
                                  Proposed
                                </div>
                                <pre
                                  className="whitespace-pre-wrap border rounded-md p-2"
                                  style={{ borderColor: 'var(--gold-dim)' }}
                                >
                                  {p.proposed_text}
                                </pre>
                              </div>
                            </div>
                          </details>
                        )}

                        {acted ? (
                          <div
                            className="mt-2.5 text-xs"
                            style={{
                              color:
                                p.action_taken!.kind === 'approved'
                                  ? 'var(--ok)'
                                  : 'var(--muted)',
                            }}
                          >
                            {p.action_taken!.kind === 'approved'
                              ? '✓ Approved — apply via Claude Code'
                              : `✗ Rejected${p.action_taken!.note ? ` — ${p.action_taken!.note}` : ''}`}
                            {' · '}
                            {formatPtTime(p.action_taken!.taken_at)} PT
                          </div>
                        ) : (
                          <div className="mt-2.5 flex items-stretch gap-2 flex-wrap">
                            <button
                              onClick={() => approveSupervisorProposal(p.id)}
                              disabled={pending}
                              className="px-3 py-1.5 text-xs rounded-md border hover:bg-white/5 transition disabled:opacity-40 min-h-[36px]"
                              style={{ borderColor: 'var(--gold)', color: 'var(--gold)' }}
                            >
                              Approve proposal
                            </button>
                            <input
                              type="text"
                              placeholder="Rejection reason (optional)"
                              value={leadFeedback[p.id] ?? ''}
                              onChange={(e) =>
                                setLeadFeedback((prev) => ({
                                  ...prev,
                                  [p.id]: e.target.value,
                                }))
                              }
                              disabled={pending}
                              className="flex-1 min-w-[180px] bg-transparent border rounded-md px-2.5 py-1.5 text-xs disabled:opacity-40"
                              style={{ borderColor: 'var(--border)' }}
                            />
                            <button
                              onClick={() => rejectSupervisorProposal(p.id)}
                              disabled={pending}
                              className="px-3 py-1.5 text-xs rounded-md border hover:bg-white/5 transition disabled:opacity-40 min-h-[36px]"
                              style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
                            >
                              Reject
                            </button>
                          </div>
                        )}

                        {diffTextJustApproved && (
                          <div
                            className="mt-3 border rounded-md p-3"
                            style={{ borderColor: 'var(--gold-dim)' }}
                          >
                            <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--gold)' }}>
                              Apply via Claude Code — paste this
                            </div>
                            <pre className="whitespace-pre-wrap text-xs">{diffTextJustApproved}</pre>
                          </div>
                        )}

                        {leadErrors[p.id] && (
                          <p className="text-xs mt-1.5" style={{ color: 'var(--danger)' }}>
                            {leadErrors[p.id]}
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </div>
            )}

          {/* Preference promotions */}
          {Array.isArray(supervisorReport.preference_promotions) &&
            supervisorReport.preference_promotions.length > 0 && (
              <div>
                <div className="text-xs muted uppercase tracking-wider mb-1.5">
                  Preference promotions
                </div>
                <ol className="space-y-3">
                  {supervisorReport.preference_promotions.map((p) => {
                    const mutation = leadMutations[p.id];
                    const pending = mutation === 'pending';
                    const acted = !!p.action_taken;
                    return (
                      <li
                        key={p.id}
                        className="border rounded-md p-3"
                        style={{ borderColor: 'var(--border)' }}
                      >
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="serif">{p.agent}</span>
                          <span className="text-xs muted">
                            {p.occurrence_count}× in window
                          </span>
                        </div>
                        <p className="mt-1.5">{p.rule_text}</p>
                        <p className="text-xs muted mt-0.5">{p.rationale}</p>
                        {acted ? (
                          <div
                            className="mt-2.5 text-xs"
                            style={{
                              color:
                                p.action_taken!.kind === 'approved'
                                  ? 'var(--ok)'
                                  : 'var(--muted)',
                            }}
                          >
                            {p.action_taken!.kind === 'approved'
                              ? '✓ Promoted to permanent preferences'
                              : '✗ Rejected'}{' '}
                            · {formatPtTime(p.action_taken!.taken_at)} PT
                          </div>
                        ) : (
                          <div className="mt-2.5 flex items-stretch gap-2 flex-wrap">
                            <button
                              onClick={() => actOnSupervisorPromotion(p.id, 'approve')}
                              disabled={pending}
                              className="px-3 py-1.5 text-xs rounded-md border hover:bg-white/5 transition disabled:opacity-40 min-h-[36px]"
                              style={{ borderColor: 'var(--gold)', color: 'var(--gold)' }}
                            >
                              Promote
                            </button>
                            <input
                              type="text"
                              placeholder="Rejection reason (optional)"
                              value={leadFeedback[p.id] ?? ''}
                              onChange={(e) =>
                                setLeadFeedback((prev) => ({
                                  ...prev,
                                  [p.id]: e.target.value,
                                }))
                              }
                              disabled={pending}
                              className="flex-1 min-w-[180px] bg-transparent border rounded-md px-2.5 py-1.5 text-xs disabled:opacity-40"
                              style={{ borderColor: 'var(--border)' }}
                            />
                            <button
                              onClick={() => actOnSupervisorPromotion(p.id, 'reject')}
                              disabled={pending}
                              className="px-3 py-1.5 text-xs rounded-md border hover:bg-white/5 transition disabled:opacity-40 min-h-[36px]"
                              style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
                            >
                              Reject
                            </button>
                          </div>
                        )}
                        {leadErrors[p.id] && (
                          <p className="text-xs mt-1.5" style={{ color: 'var(--danger)' }}>
                            {leadErrors[p.id]}
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </div>
            )}

          {/* Retrospective check-ins (read-only) */}
          {Array.isArray(supervisorReport.retrospective_checkins) &&
            supervisorReport.retrospective_checkins.length > 0 && (
              <div>
                <div className="text-xs muted uppercase tracking-wider mb-1.5">
                  30-day retrospectives
                </div>
                <ul className="space-y-1.5 text-sm">
                  {supervisorReport.retrospective_checkins.map((r, i) => (
                    <li key={i}>
                      <span className="serif">{r.title}</span>
                      <span className="text-xs muted">
                        {' · '}verdict: {r.verdict}
                        {r.applied_at ? ` · applied ${r.applied_at.slice(0, 10)}` : ''}
                      </span>
                      <div className="text-xs muted mt-0.5">
                        Expected: {r.expected_effect} · Observed: {r.observed_effect}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

          {/* Under-sampled agents */}
          {Array.isArray(supervisorReport.under_sampled_agents) &&
            supervisorReport.under_sampled_agents.length > 0 && (
              <div className="text-xs muted">
                <span className="uppercase tracking-wider">Under-sampled · </span>
                {supervisorReport.under_sampled_agents.join(', ')}
              </div>
            )}

          {supervisorReport.summary && (
            <div
              className="border-l-2 pl-3"
              style={{ borderColor: 'var(--gold-dim)' }}
            >
              <div className="text-[10px] uppercase tracking-wider mb-0.5" style={{ color: 'var(--gold)' }}>
                Summary
              </div>
              <p className="text-sm">{supervisorReport.summary}</p>
            </div>
          )}
        </div>
      )}

      {/* Growth Strategist briefing — overall assessment + per-rec action buttons */}
      {expanded && growthBriefing && (
        <div className="mb-3 space-y-4 text-sm">
          {growthBriefing.period && (
            <div className="text-xs muted">
              {growthBriefing.period.start} → {growthBriefing.period.end}
            </div>
          )}
          {growthBriefing.overall_assessment && (
            <div className="whitespace-pre-wrap leading-relaxed">
              {growthBriefing.overall_assessment}
            </div>
          )}
          {Array.isArray(growthBriefing.recommendations) &&
            growthBriefing.recommendations.length > 0 && (
              <ol className="space-y-3">
                {growthBriefing.recommendations.map((rec) => {
                  const mutation = leadMutations[rec.id];
                  const isPendingAction = mutation === 'pending';
                  const isActed = !!rec.action_taken;
                  const routingType = rec.routing?.type;
                  return (
                    <li
                      key={rec.id}
                      className="border rounded-md p-3"
                      style={{
                        borderColor: 'var(--border)',
                        opacity: isActed ? 0.7 : 1,
                      }}
                    >
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="serif text-base">{rec.title}</span>
                            <span
                              className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm"
                              style={{
                                border:
                                  rec.confidence === 'high'
                                    ? '1px solid var(--ok)'
                                    : rec.confidence === 'medium'
                                      ? '1px solid var(--gold-dim)'
                                      : '1px solid var(--border)',
                                color:
                                  rec.confidence === 'high'
                                    ? 'var(--ok)'
                                    : rec.confidence === 'medium'
                                      ? 'var(--gold)'
                                      : 'var(--muted)',
                              }}
                            >
                              {rec.confidence} confidence
                            </span>
                            <span
                              className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm"
                              style={{
                                border: '1px solid var(--border)',
                                color: 'var(--muted)',
                              }}
                            >
                              {rec.brand_or_traction}
                            </span>
                            <span
                              className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm"
                              style={{
                                border: '1px solid var(--border)',
                                color: 'var(--muted)',
                              }}
                            >
                              {rec.venture}
                            </span>
                            <span
                              className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm"
                              style={{
                                border: '1px solid var(--border)',
                                color: 'var(--muted)',
                              }}
                            >
                              {rec.effort} effort
                            </span>
                          </div>
                          <p className="mt-1.5">{rec.rationale}</p>
                          <p className="text-xs muted mt-1">
                            <span className="uppercase tracking-wider">Impact · </span>
                            {rec.expected_impact}
                          </p>
                          {rec.kr_reference && (
                            <p className="text-xs muted mt-0.5">
                              <span className="uppercase tracking-wider">KR · </span>
                              {rec.kr_reference}
                            </p>
                          )}
                          {rec.routing?.type === 'agent-work' && rec.routing.suggested_agent && (
                            <p className="text-xs muted mt-0.5">
                              <span className="uppercase tracking-wider">Suggests · </span>
                              {rec.routing.suggested_agent} agent
                            </p>
                          )}
                          {rec.routing?.type === 'new-agent' && rec.routing.proposed_agent_name && (
                            <p className="text-xs muted mt-0.5">
                              <span className="uppercase tracking-wider">Proposes new agent · </span>
                              {rec.routing.proposed_agent_name}
                            </p>
                          )}
                        </div>
                      </div>

                      {isActed ? (
                        <div className="mt-2.5 text-xs" style={{ color: 'var(--ok)' }}>
                          ✓ {rec.action_taken!.kind === 'task'
                            ? 'Notion task created'
                            : rec.action_taken!.kind === 'agent-work'
                              ? `Routed to ${rec.action_taken!.note ?? 'agent'} queue`
                              : rec.action_taken!.kind === 'new-agent'
                                ? `New-agent proposal queued (${rec.action_taken!.note ?? ''})`
                                : 'Acted'}{' '}
                          · {formatPtTime(rec.action_taken!.taken_at)} PT
                        </div>
                      ) : (
                        <div className="mt-2.5 flex items-center gap-2 flex-wrap">
                          <button
                            onClick={() => approveRecAsTask(rec.id)}
                            disabled={isPendingAction}
                            className="px-3 py-1.5 text-xs rounded-md border hover:bg-white/5 transition disabled:opacity-40 min-h-[36px]"
                            style={{
                              borderColor:
                                routingType === 'task' ? 'var(--gold)' : 'var(--border)',
                              color:
                                routingType === 'task' ? 'var(--gold)' : 'var(--muted)',
                            }}
                          >
                            {routingType === 'task' ? 'Approve as task ✓' : 'Approve as task'}
                          </button>
                          <button
                            onClick={() => approveRecAsAgentWork(rec.id)}
                            disabled={isPendingAction}
                            className="px-3 py-1.5 text-xs rounded-md border hover:bg-white/5 transition disabled:opacity-40 min-h-[36px]"
                            style={{
                              borderColor:
                                routingType === 'agent-work' ? 'var(--gold)' : 'var(--border)',
                              color:
                                routingType === 'agent-work' ? 'var(--gold)' : 'var(--muted)',
                            }}
                          >
                            {routingType === 'agent-work'
                              ? 'Approve as agent work ✓'
                              : 'Approve as agent work'}
                          </button>
                          <button
                            onClick={() => approveRecAsNewAgent(rec.id)}
                            disabled={isPendingAction}
                            className="px-3 py-1.5 text-xs rounded-md border hover:bg-white/5 transition disabled:opacity-40 min-h-[36px]"
                            style={{
                              borderColor:
                                routingType === 'new-agent' ? 'var(--gold)' : 'var(--border)',
                              color:
                                routingType === 'new-agent' ? 'var(--gold)' : 'var(--muted)',
                            }}
                          >
                            {routingType === 'new-agent'
                              ? 'Propose new agent ✓'
                              : 'Propose new agent'}
                          </button>
                          {isPendingAction && (
                            <span className="text-xs muted">Working…</span>
                          )}
                        </div>
                      )}

                      {/* Feedback — always available; saved feedback shown
                          below with Edit option. Non-terminal so Briana can
                          provide context AND route (or not). Feeds into the
                          next Growth Strategist run. */}
                      {(() => {
                        const fb = rec.feedback;
                        const editing = !!recFeedbackEditing[rec.id] || !fb;
                        if (fb && !editing) {
                          return (
                            <div
                              className="mt-2.5 border-l-2 pl-3 py-1"
                              style={{ borderColor: 'var(--gold-dim)' }}
                            >
                              <div className="text-[10px] uppercase tracking-wider mb-0.5" style={{ color: 'var(--gold)' }}>
                                Your feedback · {formatPtTime(fb.given_at)} PT
                              </div>
                              <p className="text-sm">{fb.note}</p>
                              <button
                                onClick={() => {
                                  setRecFeedbackEditing((prev) => ({ ...prev, [rec.id]: true }));
                                  setLeadFeedback((prev) => ({ ...prev, [rec.id]: fb.note }));
                                }}
                                className="text-xs gold hover:underline mt-1"
                              >
                                Edit feedback
                              </button>
                            </div>
                          );
                        }
                        return (
                          <div className="mt-2.5 flex items-stretch gap-2">
                            <input
                              type="text"
                              placeholder={
                                fb
                                  ? 'Update feedback…'
                                  : 'Add context — what you know that the agent doesn\'t (optional)…'
                              }
                              value={leadFeedback[rec.id] ?? ''}
                              onChange={(e) =>
                                setLeadFeedback((prev) => ({
                                  ...prev,
                                  [rec.id]: e.target.value,
                                }))
                              }
                              disabled={isPendingAction}
                              className="flex-1 min-w-0 bg-transparent border rounded-md px-2.5 py-1.5 text-xs disabled:opacity-40"
                              style={{ borderColor: 'var(--border)' }}
                            />
                            <button
                              onClick={() => submitRecFeedback(rec.id)}
                              disabled={isPendingAction || !(leadFeedback[rec.id] ?? '').trim()}
                              className="shrink-0 px-3 py-1.5 text-xs rounded-md border hover:bg-white/5 transition disabled:opacity-40 min-h-[36px]"
                              style={{
                                borderColor: 'var(--gold-dim)',
                                color: 'var(--gold)',
                              }}
                            >
                              {fb ? 'Update' : 'Save feedback'}
                            </button>
                            {fb && (
                              <button
                                onClick={() => {
                                  setRecFeedbackEditing((prev) => ({ ...prev, [rec.id]: false }));
                                  setLeadFeedback((prev) => ({ ...prev, [rec.id]: '' }));
                                  setLeadErrors((prev) => ({ ...prev, [rec.id]: '' }));
                                }}
                                disabled={isPendingAction}
                                className="shrink-0 px-3 py-1.5 text-xs rounded-md border hover:bg-white/5 transition disabled:opacity-40"
                                style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
                              >
                                Cancel
                              </button>
                            )}
                          </div>
                        );
                      })()}

                      {leadErrors[rec.id] && (
                        <p
                          className="text-xs mt-1.5"
                          style={{ color: 'var(--danger)' }}
                        >
                          {leadErrors[rec.id]}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          {growthBriefing.source_refs && (
            <div className="text-xs muted">
              Based on ·{' '}
              {growthBriefing.source_refs.analytics_period
                ? `Analytics ${growthBriefing.source_refs.analytics_period.start} → ${growthBriefing.source_refs.analytics_period.end}`
                : 'no analytics data'}
              {` · ${growthBriefing.source_refs.krs_count ?? 0} KRs`}
              {` · ${growthBriefing.source_refs.past_experiments_count ?? 0} past experiments`}
            </div>
          )}
        </div>
      )}

      {/* Analytics & Reporting monthly report — read-only narrative */}
      {expanded && analyticsReport && (
        <div className="mb-3 space-y-3 text-sm">
          <div className="text-xs muted flex flex-wrap gap-2">
            {analyticsReport.period?.type && (
              <span>{analyticsReport.period.type} report</span>
            )}
            {analyticsReport.period?.start && analyticsReport.period?.end && (
              <span>
                · {analyticsReport.period.start} → {analyticsReport.period.end}
              </span>
            )}
          </div>
          {analyticsReport.cross_platform_summary && (
            <div className="whitespace-pre-wrap leading-relaxed">
              {analyticsReport.cross_platform_summary}
            </div>
          )}
          {Array.isArray(analyticsReport.notable_spikes) &&
            analyticsReport.notable_spikes.length > 0 && (
              <div>
                <div className="text-xs muted uppercase tracking-wider mb-1.5">
                  Notable spikes
                </div>
                <ul className="space-y-1">
                  {analyticsReport.notable_spikes.map((s, i) => (
                    <li key={i} className="text-sm">
                      <span className="serif">{s.platform}</span> · {s.metric}{' '}
                      <span style={{ color: 'var(--gold)' }}>{s.change}</span> — {s.note}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          {analyticsReport.platforms &&
            Object.keys(analyticsReport.platforms).length > 0 && (
              <div>
                <div className="text-xs muted uppercase tracking-wider mb-1.5">
                  Platforms pulled
                </div>
                <ul className="space-y-0.5 text-xs">
                  {Object.keys(analyticsReport.platforms).map((name) => (
                    <li key={name} className="muted">
                      <span className="serif">{name}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          {Array.isArray(analyticsReport.not_configured) &&
            analyticsReport.not_configured.length > 0 && (
              <div className="text-xs muted">
                <span className="uppercase tracking-wider">Not configured · </span>
                {analyticsReport.not_configured.join(', ')}
              </div>
            )}
          {Array.isArray(analyticsReport.errored) &&
            analyticsReport.errored.length > 0 && (
              <div className="text-xs" style={{ color: 'var(--danger)' }}>
                <span className="uppercase tracking-wider">Errored · </span>
                {analyticsReport.errored
                  .map((e) => `${e.platform}: ${e.error}`)
                  .join(' · ')}
              </div>
            )}
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
                    : fundingScan
                      ? `Review ${fundingScan.opportunities?.length ?? 0} opportunities`
                      : fundingDraft
                        ? 'Read application draft'
                        : analyticsReport
                          ? 'View monthly report'
                          : growthBriefing
                            ? `Review ${growthBriefing.recommendations?.length ?? 0} recommendations`
                            : supervisorReport
                              ? `Open supervisor report (${supervisorReport.diff_proposals?.length ?? 0} diffs, ${supervisorReport.preference_promotions?.length ?? 0} preferences)`
                              : sysEngReport
                                ? `Review ${sysEngReport.findings?.length ?? 0} findings (${sysEngReport.severity_counts?.critical ?? 0}C / ${sysEngReport.severity_counts?.medium ?? 0}M / ${sysEngReport.severity_counts?.low ?? 0}L)`
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
  if (agent === 'funding-scout' && type === 'draft') {
    return 'e.g. "Lead with the Reddit 50-signups moment instead of the cobbler story." Or "Cut the budget section — they only asked for impact."';
  }
  if (agent === 'funding-scout' && type === 'report') {
    return 'e.g. "More fellowships, fewer workforce-dev grants." Or "Only surface opportunities above $5K."';
  }
  return 'What should the agent change?';
}

// ============================================================================
// Showrunner captions tab — with per-clip Schedule button (Pass B)
// ============================================================================

export interface ShowrunnerClipCaptionCard {
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

export function ShowrunnerCaptionsList({
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

function MarkAsSubmittedControl({
  agentOutputId,
  alreadySubmittedAt,
  funder,
}: {
  agentOutputId: string;
  alreadySubmittedAt?: string;
  funder: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [submittedAt, setSubmittedAt] = useState<string | null>(
    alreadySubmittedAt ?? null,
  );
  const [err, setErr] = useState<string | null>(null);

  if (submittedAt) {
    return (
      <div className="text-xs" style={{ color: 'var(--ok)' }}>
        ✓ Marked as submitted {formatPtTime(submittedAt)} PT — Notion funding row
        now shows &ldquo;applied.&rdquo;
      </div>
    );
  }

  const click = () => {
    setErr(null);
    startTransition(async () => {
      try {
        const res = await fetch(
          `/api/agents/funding-scout/drafts/${agentOutputId}/mark-submitted`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          },
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || 'Mark as submitted failed');
        setSubmittedAt(data.submittedAt ?? new Date().toISOString());
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
        {isPending ? 'Logging…' : `Mark as submitted to ${funder}`}
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
