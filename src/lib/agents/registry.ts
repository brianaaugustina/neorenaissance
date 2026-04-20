// Static registry of every agent live in the system.
// Powers the /agents page (fleet table + filter) and /agents/[agent] detail
// pages (capabilities, connections, cadence). The runtime agent_runs +
// agent_outputs tables provide live data; this file provides identity +
// shape metadata that doesn't change between runs.

export interface AgentCapability {
  /** agent_outputs.output_type value this agent emits */
  outputType: string;
  /** Human-readable label */
  label: string;
  /** One-line description */
  description: string;
  /** Trigger URL, if this output type has a dedicated manual trigger */
  triggerHref?: string;
}

export interface AgentConnection {
  /** Either an agent_id (from the registry) or a data-source label */
  target: string;
  /** Short clause explaining the connection */
  note: string;
}

export interface AgentRegistryEntry {
  /** Matches agent_name in approval_queue + agent_runs tables */
  id: string;
  /** Alternate ids — mostly to handle ops_chief vs ops-chief historical drift */
  aliases?: string[];
  /** Display name */
  name: string;
  /** Short tagline */
  tagline: string;
  /** Venture this agent serves */
  venture: string;
  /** Layer in the system */
  layer: 'execution' | 'strategy' | 'meta';
  /** Longer description — what this agent does and why */
  purpose: string;
  /** Known capabilities (output types) */
  capabilities: AgentCapability[];
  /** Cadence summary (e.g., "Daily 5:30am PT") */
  cadence: string;
  /** Inbound / outbound connections */
  connections: {
    reads_from: AgentConnection[];
    writes_to: AgentConnection[];
  };
  /** Link to the agent's trigger / home page inside the app */
  triggerHref: string | null;
  /** Optional — a short color ribbon hint. Kept monochrome for now. */
  accent?: string;
}

export const AGENT_REGISTRY: AgentRegistryEntry[] = [
  {
    id: 'ops_chief',
    aliases: ['ops-chief'],
    name: 'Ops Chief',
    tagline: 'Daily briefing + weekly planner',
    venture: 'Cross-venture',
    layer: 'execution',
    purpose:
      'Runs the morning briefing and the Sunday weekly plan. Synthesizes Notion tasks, agent queue state, and recent feedback into a prioritized day-view. Holds the direct-line chat on the dashboard.',
    capabilities: [
      {
        outputType: 'daily_briefing',
        label: 'Daily briefing',
        description: 'Morning synthesis of what to work on today + delegation suggestions.',
      },
      {
        outputType: 'weekly_plan',
        label: 'Weekly plan',
        description: 'Sunday plan that reschedules tasks and proposes new ones for the week.',
      },
    ],
    cadence: 'Daily Mon–Fri 5am PT · Weekly Sun 12pm PT',
    connections: {
      reads_from: [
        { target: 'Notion Tasks DB', note: 'today / overdue / week tasks' },
        { target: 'approval_queue', note: 'pending items for cross-agent visibility' },
        { target: 'agent_memory', note: 'permanent preferences' },
      ],
      writes_to: [
        { target: 'approval_queue', note: 'briefings and weekly plans' },
        { target: 'Notion Tasks DB', note: 'task creates/updates when plan is executed' },
      ],
    },
    triggerHref: '/agents',
  },
  {
    id: 'showrunner',
    name: 'Showrunner',
    tagline: 'TTS episode package writer',
    venture: 'The Trades Show',
    layer: 'execution',
    purpose:
      "Three separate triggers per episode — Substack post, Title & description, and Social captions. Each run produces its own queue item so you approve and update them independently. Clip files stay in Showrunner storage until scheduled; Substack approve writes a Notion Content DB newsletter row.",
    capabilities: [
      {
        outputType: 'substack_post',
        label: 'Substack post',
        description: 'Transcript → Substack title + subtitle + full post body.',
        triggerHref: '/agents',
      },
      {
        outputType: 'episode_metadata',
        label: 'Title & description',
        description: 'Transcript → YouTube title, Spotify title, shared episode description.',
      },
      {
        outputType: 'social_caption',
        label: 'Social captions',
        description: 'Clip inputs (no full transcript) → one caption per clip with hashtags.',
      },
      {
        outputType: 'calendar_entry',
        label: 'Calendar entries',
        description: 'Notion Content DB rows — written on approve, one per clip + newsletter.',
      },
      {
        outputType: 'pipeline_check',
        label: 'Daily pipeline check',
        description: 'Morning check for blockers on the TTS content calendar.',
      },
    ],
    cadence: 'On-demand · daily pipeline check 7am PT',
    connections: {
      reads_from: [
        { target: 'context/agents/showrunner/*', note: 'voice + episode-metadata + captions' },
        { target: 'Notion Content DB', note: 'scheduled + published episodes' },
        { target: 'Supabase Storage · showrunner-clips', note: 'clip files awaiting scheduling' },
      ],
      writes_to: [
        { target: 'approval_queue', note: 'draft package awaiting review' },
        { target: 'Notion Content DB', note: 'newsletter + clips on approve' },
      ],
    },
    triggerHref: '/agents',
  },
  {
    id: 'sponsorship-director',
    name: 'Sponsorship Director',
    tagline: 'Weekly sponsor research + pitch drafts',
    venture: 'The Trades Show',
    layer: 'execution',
    purpose:
      'Surfaces 10 sponsor leads per week scored against the 5-point fit test, generates per-lead Touch 1 pitch drafts on approval, mirrors each as an Outreach row in Notion. Gate 3 Send stays manual until Gmail OAuth lands.',
    capabilities: [
      {
        outputType: 'research_batch',
        label: 'Weekly sponsor research',
        description: '10 leads scored against fit test · trade-gap-fill flagging.',
      },
      {
        outputType: 'pitch_email',
        label: 'Touch 1 pitch email',
        description: 'Per-lead draft generated on approve + mirrored to Notion Outreach DB.',
      },
    ],
    cadence: 'Weekly Mon 8am PT',
    connections: {
      reads_from: [
        { target: 'Notion Companies + Outreach DBs', note: 'existing pipeline' },
        { target: 'context/agents/sponsorship-director/*', note: 'voice + playbook + fit test' },
      ],
      writes_to: [
        { target: 'approval_queue', note: 'research batch + per-lead drafts' },
        { target: 'Notion Outreach DB', note: 'rows on Gate 1 approval' },
      ],
    },
    triggerHref: '/agents',
  },
  {
    id: 'pr-director',
    name: 'PR Director',
    tagline: 'Editorial landscape + press research',
    venture: 'The Trades Show',
    layer: 'execution',
    purpose:
      'Monthly editorial landscape scan + weekly press research. Per-lead Touch 1 pitch drafts in the voice-mode you pick (founder-first / show-first / hybrid).',
    capabilities: [
      {
        outputType: 'editorial_landscape_briefing',
        label: 'Editorial landscape',
        description: 'Monthly read of what the craft press is publishing + where TTS fits.',
      },
      {
        outputType: 'press_research',
        label: 'Weekly press research',
        description: '10 journalist/outlet leads with cultural-moment + episode pairing.',
      },
      {
        outputType: 'press_pitch_founder_first',
        label: 'Founder-first press pitch',
        description: 'Voice mode leading with Briana as builder.',
      },
      {
        outputType: 'press_pitch_show_first',
        label: 'Show-first press pitch',
        description: 'Voice mode leading with an artisan story.',
      },
      {
        outputType: 'press_pitch_hybrid',
        label: 'Hybrid press pitch',
        description: 'Voice mode blending founder + show.',
      },
    ],
    cadence: 'Monthly 1st 7am PT · Weekly Mon 7am PT',
    connections: {
      reads_from: [
        { target: 'Notion Contacts + Outreach DBs', note: 'existing press pipeline' },
        { target: 'context/agents/pr-director/*', note: 'voice modes + playbook' },
      ],
      writes_to: [
        { target: 'approval_queue', note: 'landscape + research + pitches' },
        { target: 'Notion Outreach DB', note: 'per-lead rows' },
      ],
    },
    triggerHref: '/agents/pr-director/landscape',
  },
  {
    id: 'talent-scout',
    name: 'Talent Scout',
    tagline: 'Artisan guest research',
    venture: 'The Trades Show',
    layer: 'execution',
    purpose:
      'Surfaces verified artisan guest candidates for Season 2/3 with suggested outreach channel (email / IG DM / through-team). Each surfaced artisan is written to Notion Contacts append-only; per-lead outreach drafts on approve.',
    capabilities: [
      {
        outputType: 'artisan_research',
        label: 'Artisan research batch',
        description: 'Venn-test verified candidates with discovery story + channel routing.',
      },
      {
        outputType: 'artisan_outreach_email',
        label: 'Email outreach',
        description: 'Touch 1 pitch for email channel.',
      },
      {
        outputType: 'artisan_outreach_dm',
        label: 'IG DM outreach',
        description: 'Short DM asking for an email pathway.',
      },
      {
        outputType: 'artisan_outreach_through_team',
        label: 'Through-team outreach',
        description: 'Polite ask to a shop/team to connect with the founder.',
      },
    ],
    cadence: 'On-demand',
    connections: {
      reads_from: [
        { target: 'Notion Contacts DB', note: 'past guests + declined list' },
        { target: 'context/agents/talent-scout/*', note: 'Venn test + voice + playbook' },
        { target: 'Web (web_search)', note: 'verifies each candidate before surfacing' },
      ],
      writes_to: [
        { target: 'approval_queue', note: 'batch + per-lead pitch drafts' },
        { target: 'Notion Contacts DB', note: 'new artisan rows at research time' },
        { target: 'Notion Outreach DB', note: 'row on Mark-as-sent' },
      ],
    },
    triggerHref: '/agents',
  },
  {
    id: 'funding-scout',
    name: 'Funding Scout',
    tagline: 'Non-dilutive funding research + app drafting',
    venture: 'Cross-venture',
    layer: 'execution',
    purpose:
      "Scans for grants / fellowships / residencies / non-dilutive competitions (no VC, ever). Each opportunity verified via web search and scored against the 6-point fit test. On approve, drafts a custom application in Briana's voice grounded in the Stats Bible.",
    capabilities: [
      {
        outputType: 'funding_opportunity_scan',
        label: 'Opportunity scan',
        description: 'Web-verified candidates with fit score + effort estimate + venture match.',
      },
      {
        outputType: 'grant_application_draft',
        label: 'Grant application',
        description: 'Per-opportunity drafted application; Stats Bible references tracked.',
      },
      {
        outputType: 'fellowship_application_draft',
        label: 'Fellowship application',
        description: 'Founder-level fellowship drafts (O\u2019Shaughnessy-style).',
      },
      {
        outputType: 'residency_application_draft',
        label: 'Residency application',
        description: 'Artist-residency drafts.',
      },
    ],
    cadence: 'On-demand',
    connections: {
      reads_from: [
        { target: 'context/agents/funding-scout/*', note: 'Stats Bible + voice + playbook' },
        { target: 'Notion Funding Opportunities DB', note: "don\u2019t re-surface active ones" },
        { target: 'Web (web_search)', note: 'opportunity + deadline verification' },
      ],
      writes_to: [
        { target: 'approval_queue', note: 'scan + per-application drafts' },
        { target: 'Notion Funding Opportunities DB', note: 'row on Gate 1 approval' },
        { target: 'Notion Tasks DB', note: 'reminder task with deadline' },
      ],
    },
    triggerHref: '/agents',
  },
  {
    id: 'analytics-reporting',
    name: 'Analytics & Reporting',
    tagline: 'Monthly cross-platform snapshot',
    venture: 'Cross-venture',
    layer: 'execution',
    purpose:
      'Deterministic data-pulls from every connected platform (PostHog, ConvertKit, YouTube, plus CSV uploads for Substack/Spotify and OAuth Meta/TikTok when wired). Publishes one monthly report Growth Strategist reads at 10am PT.',
    capabilities: [
      {
        outputType: 'analytics_report',
        label: 'Monthly analytics report',
        description: 'Cross-platform snapshot with per-platform metrics + notable spikes.',
      },
    ],
    cadence: 'Monthly 1st 9am PT',
    connections: {
      reads_from: [
        { target: 'PostHog', note: 'web analytics via REST API' },
        { target: 'ConvertKit', note: 'subscriber + broadcast stats' },
        { target: 'YouTube Analytics API', note: 'channel metrics (OAuth)' },
        { target: 'Substack CSV · Spotify CSV', note: 'manual uploads' },
      ],
      writes_to: [
        { target: 'agent_outputs', note: 'analytics_report — read by Growth Strategist' },
        { target: 'platform_snapshots', note: 'raw per-platform snapshots' },
      ],
    },
    triggerHref: '/agents/analytics-reporting',
  },
  {
    id: 'growth-strategist',
    name: 'Growth Strategist',
    tagline: 'Monthly pulse + experiment design',
    venture: 'Cross-venture',
    layer: 'strategy',
    purpose:
      'Reads the latest Analytics report + active Notion KRs + past experiment results. Produces strategic recommendations tagged with routing (task / agent work / new agent) and confidence. Experiment proposals + 30-day results come through here.',
    capabilities: [
      {
        outputType: 'monthly_pulse_check',
        label: 'Monthly pulse check',
        description: '3\u20137 recommendations with per-item routing + confidence.',
      },
      {
        outputType: 'quarterly_growth_review',
        label: 'Quarterly review',
        description: 'Deeper 3-month pattern analysis with cross-venture synergy.',
      },
      {
        outputType: 'channel_recommendation',
        label: 'Channel recommendation',
        description: 'On-demand per-venture channel-mix analysis.',
      },
      {
        outputType: 'audience_analysis',
        label: 'Audience analysis',
        description: 'On-demand demographic + behavioral read across platforms.',
      },
      {
        outputType: 'cross_venture_synergy',
        label: 'Cross-venture synergy',
        description: 'Opportunities to route audience between ventures.',
      },
    ],
    cadence: 'Monthly 1st 10am PT · Quarterly Jan/Apr/Jul/Oct 1st 8am PT',
    connections: {
      reads_from: [
        { target: 'analytics-reporting', note: 'latest analytics_report' },
        { target: 'Notion Outcomes + Intentions DBs', note: 'active KRs' },
        { target: 'agent_outputs', note: 'past experiment_results + prior recommendation feedback' },
      ],
      writes_to: [
        { target: 'approval_queue', note: 'briefings with per-recommendation actions' },
        { target: 'Notion Tasks DB', note: 'task creation on approve-as-task' },
      ],
    },
    triggerHref: '/agents/growth-strategist',
  },
  {
    id: 'agent-supervisor',
    name: 'Agent Supervisor',
    tagline: 'System\u2019s memory of itself',
    venture: 'Meta layer',
    layer: 'meta',
    purpose:
      'Weekly read-only observer. Watches every other agent, spots approval-rate shifts / recurring rejections / cross-agent feedback themes, and proposes specific context-file diffs + recurring-feedback promotions. Self-excluded from its own analysis.',
    capabilities: [
      {
        outputType: 'weekly_supervisor_report',
        label: 'Weekly supervisor report',
        description: 'Per-agent health + patterns + proposed context diffs.',
      },
      {
        outputType: 'agent_deep_dive',
        label: 'Agent deep dive',
        description: 'On-demand deeper analysis on one agent.',
      },
    ],
    cadence: 'Weekly Sun 6am PT',
    connections: {
      reads_from: [
        { target: 'agent_outputs', note: 'self-exclusion enforced in retrieval layer' },
        { target: 'approval_queue', note: 'approval + feedback history' },
        { target: 'agent_runs', note: 'success/failure logs' },
        { target: 'agent_learnings', note: 'prior proposals + retrospectives' },
      ],
      writes_to: [
        { target: 'agent_outputs', note: 'own briefings' },
        { target: 'agent_learnings', note: 'approved diffs + rejections + retrospectives' },
        { target: 'agent_memory', note: 'permanent preferences on promotion' },
      ],
    },
    triggerHref: '/agents/agent-supervisor',
  },
  {
    id: 'system-engineer',
    name: 'System Engineer',
    tagline: 'Weekly code review across tracked repos',
    venture: 'Meta layer',
    layer: 'meta',
    purpose:
      'Weekly read-only code health scan. Reads 4 tracked GitHub repos + Vercel deployment logs. Produces batched, severity-ranked findings (Critical / Medium / Low) with per-finding Fix / Defer / Ignore actions. Delegation to engineer agents lands in Phase 5.',
    capabilities: [
      {
        outputType: 'weekly_codebase_health_report',
        label: 'Weekly codebase health',
        description: 'Severity-ranked findings across all tracked repos.',
      },
      {
        outputType: 'finding_detail_expansion',
        label: 'Finding detail',
        description: 'On-demand deeper analysis of one finding with file content.',
      },
    ],
    cadence: 'Weekly Sat 8pm PT',
    connections: {
      reads_from: [
        { target: 'GitHub · neorenaissance', note: 'agent system repo' },
        { target: 'GitHub · detto-app', note: 'Detto repo' },
        { target: 'GitHub · tradesshow-website', note: 'TTS site repo' },
        { target: 'GitHub · brianaaugustina-website', note: 'personal site repo' },
        { target: 'Vercel API', note: 'deployment + runtime errors' },
      ],
      writes_to: [
        { target: 'agent_outputs', note: 'weekly health reports' },
        { target: 'agent_learnings', note: 'deferred + ignored findings' },
      ],
    },
    triggerHref: '/agents/system-engineer',
  },
];

export function getAgentById(id: string): AgentRegistryEntry | undefined {
  return AGENT_REGISTRY.find(
    (a) => a.id === id || (a.aliases && a.aliases.includes(id)),
  );
}

export function agentIds(): string[] {
  return AGENT_REGISTRY.map((a) => a.id);
}
