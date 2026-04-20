// Shape definitions for each multi-item output the detail page knows how to
// render. These mirror the interfaces in src/components/QueueCard.tsx —
// duplicated on purpose this pass so QueueCard can stay untouched. When
// QueueCard gets refactored to consume output-detail components, these can
// collapse into a single shared module.

export type ActionMutation = 'pending' | 'done' | 'error';

// ---------------------------------------------------------------------------
// Agent Supervisor
// ---------------------------------------------------------------------------
export interface SupervisorDiffProposal {
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

export interface SupervisorPreferencePromotion {
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

export interface SupervisorPerAgentObservation {
  agent: string;
  approval_rate_this_window: number | null;
  approval_rate_trailing_4w: number | null;
  output_volume: number;
  output_type_mix: Record<string, number>;
  pattern: string | null;
  evidence: string[];
  sample_size: 'high' | 'medium' | 'low' | 'under-sampled';
}

export interface SupervisorFeedbackTrack {
  feedback_text: string;
  agents: string[];
  absorbed: 'yes' | 'partial' | 'no';
  evidence: string[];
}

export interface SupervisorRetroCheckin {
  learning_id: string;
  title: string;
  applied_at: string | null;
  expected_effect: string;
  observed_effect: string;
  verdict: 'worked' | 'partially_worked' | 'did_not_work' | 'too_early';
}

export interface SupervisorReportPayload {
  period?: { start: string; end: string };
  overall_assessment?: string;
  per_agent_observations?: SupervisorPerAgentObservation[];
  feedback_implementation_tracking?: SupervisorFeedbackTrack[];
  diff_proposals?: SupervisorDiffProposal[];
  preference_promotions?: SupervisorPreferencePromotion[];
  retrospective_checkins?: SupervisorRetroCheckin[];
  under_sampled_agents?: string[];
  summary?: string;
  source_refs?: {
    excluded_agents?: string[];
    outputs_analyzed?: number;
    feedback_items_analyzed?: number;
    past_learnings_referenced?: number;
  };
}

// ---------------------------------------------------------------------------
// Growth Strategist
// ---------------------------------------------------------------------------
export interface GrowthRecommendation {
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

export interface GrowthBriefingPayload {
  period?: { start: string; end: string } | null;
  overall_assessment?: string;
  summary?: string;
  recommendations?: GrowthRecommendation[];
  source_refs?: {
    analytics_output_id?: string | null;
    analytics_period?: { start: string; end: string } | null;
    krs_count?: number;
    past_experiments_count?: number;
  };
}

// ---------------------------------------------------------------------------
// Research batches — shared across Sponsorship / PR / Talent
// ---------------------------------------------------------------------------
export interface ResearchLead {
  lead_id: string;
  brand_name?: string;
  tier?: string;
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
}

export interface ResearchBatchPayload {
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

// ---------------------------------------------------------------------------
// Funding Scout
// ---------------------------------------------------------------------------
export interface FundingOpportunityCard {
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

export interface FundingOpportunityScanPayload {
  total_reviewed?: number;
  surfaced_count?: number;
  opportunities?: FundingOpportunityCard[];
  candidates_not_surfaced?: Array<{
    funder: string;
    opportunity_name: string;
    skip_reason: string;
  }>;
}

// ---------------------------------------------------------------------------
// System Engineer
// ---------------------------------------------------------------------------
export interface SystemEngineerFinding {
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

export interface SystemEngineerReportPayload {
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

// ---------------------------------------------------------------------------
// Showrunner captions
// ---------------------------------------------------------------------------
export interface ShowrunnerClipCaption {
  index: number;
  output_id?: string;
  description?: string;
  caption?: string;
  hashtags?: string[];
  storage_path?: string;
  filename?: string;
  file_content_type?: string;
  scheduled_at?: string;
  publish_date?: string;
  publish_time?: string;
  platforms?: string[];
}

export interface ShowrunnerCaptionsPayload {
  output_kind?: 'social_captions';
  episode_type?: 'solo' | 'interview';
  clip_captions?: ShowrunnerClipCaption[];
  social_captions?: string[];
}
