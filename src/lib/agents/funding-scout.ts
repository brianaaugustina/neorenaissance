import {
  getApprovedOutputsByType,
  logOutput,
  setApprovalQueueId,
  updateOutputStatus,
  type ApprovedOutputExample,
} from '../agent-outputs';
import {
  createFundingOpportunity,
  getActiveFundingOpportunities,
  updateFundingOpportunity,
  type FundingEffort,
  type FundingOpportunityRow,
  type FundingStatus,
  type FundingType,
  type FundingVenture,
} from '../notion/client';
import {
  depositToQueue,
  getPermanentPreferences,
  getRecentFeedback,
  logRunComplete,
  logRunStart,
  supabaseAdmin,
  type RecentFeedbackItem,
} from '../supabase/client';
import { todayIsoPT } from '../time';
import { loadContextFile, think } from './base';

const AGENT_NAME = 'funding-scout';
const MODEL = process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-5';

// ============================================================================
// Output types
// ============================================================================

export type FundingApplicationOutputType =
  | 'grant_application_draft'
  | 'fellowship_application_draft'
  | 'residency_application_draft'
  | 'accelerator_application_draft'
  | 'competition_application_draft'
  | 'sponsored_program_application_draft';

function fundingTypeToOutputType(
  t: FundingType | null | undefined,
): FundingApplicationOutputType {
  switch (t) {
    case 'Fellowship':
      return 'fellowship_application_draft';
    case 'Residency':
      return 'residency_application_draft';
    case 'Accelerator':
      return 'accelerator_application_draft';
    case 'Competition':
      return 'competition_application_draft';
    case 'Sponsored Program':
      return 'sponsored_program_application_draft';
    case 'Grant':
    default:
      return 'grant_application_draft';
  }
}

export interface FundingOpportunity {
  opportunity_id: string;
  opportunity_name: string;
  funder: string;
  funding_type: FundingType;
  funding_amount: number | null;
  application_deadline: string | null; // YYYY-MM-DD
  source_url: string | null;
  ventures: FundingVenture[];
  primary_venture: FundingVenture;
  eligibility_criteria: string;
  match_rating: number; // 0–10
  reason_for_match: string;
  effort_estimate: FundingEffort;
  effort_hours_low: number | null;
  effort_hours_high: number | null;
  fit_test: {
    non_dilutive: boolean;
    mission_alignment: boolean;
    eligibility: boolean;
    effort_to_reward: boolean;
    timeline: boolean;
    reputation: boolean;
  };
  fit_score_out_of_six: number;
  recommendation: 'Apply' | 'Flag for review' | 'Skip';
  skip_reason: string | null;
  // Mutated as Briana interacts:
  approved?: boolean;
  skipped?: boolean;
  feedback?: string | null;
  notion_row_id?: string | null;
  draft_output_id?: string | null;
  replaced_at?: string;
  previous_versions?: Array<{
    opportunity_name: string;
    funder: string;
    funding_type: FundingType;
    feedback: string | null;
    replaced_at: string;
  }>;
}

export interface FundingOpportunityScan {
  total_reviewed: number;
  surfaced_count: number;
  requested_count: number;
  surfaced_at: string;
  opportunities: FundingOpportunity[];
  candidates_not_surfaced: Array<{
    funder: string;
    opportunity_name: string;
    skip_reason: string;
  }>;
}

export interface FundingApplicationDraft {
  opportunity_id: string;
  parent_scan_output_id: string | null;
  opportunity_name: string;
  funder: string;
  funding_type: FundingType;
  application_deadline: string | null;
  source_url: string | null;
  primary_venture: FundingVenture;
  // The draft itself — sections keyed by prompt/question.
  sections: Array<{
    prompt: string;
    response: string;
    word_count: number;
  }>;
  /** Full concatenated draft for single-prompt funders or preview rendering. */
  full_draft: string;
  word_count_total: number;
  notes_for_briana: string;
  stats_bible_references: string[];
  proof_moment_used: 'cobbler' | 'frank_beneduci' | 'angela_wilson' | 'reddit_50' | 'thank_you_quote' | 'none';
  // Filled at Gate 2/3:
  notion_row_id?: string | null;
  submitted_at?: string;
}

// ============================================================================
// Context assembly
// ============================================================================

function loadFundingContextFiles(): string {
  return [
    loadContextFile('system.md'),
    loadContextFile('agents/funding-scout/system-prompt.md'),
    loadContextFile('agents/funding-scout/voice.md'),
    loadContextFile('agents/funding-scout/playbook.md'),
    loadContextFile('ventures/trades-show.md'),
    loadContextFile('shared/conflicts.md'),
  ]
    .filter(Boolean)
    .join('\n\n---\n\n');
}

function renderActivePipeline(rows: FundingOpportunityRow[]): string {
  if (!rows.length) return '(no active opportunities in Notion funding DB)';
  return rows
    .map((r) => {
      const amount = r.fundingAmount != null ? `$${r.fundingAmount.toLocaleString()}` : 'amt unknown';
      const deadline = r.deadline ? ` · deadline ${r.deadline}` : '';
      const funder = r.funder ? `${r.funder} — ` : '';
      return `- ${funder}${r.name} [${r.status ?? 'no status'} · ${amount}${deadline}]`;
    })
    .join('\n');
}

function renderExemplars(
  label: string,
  examples: ApprovedOutputExample[],
  maxChars = 1200,
): string {
  if (!examples.length) return '';
  const blocks = examples.map((ex, i) => {
    const when = ex.approved_at ? ex.approved_at.slice(0, 10) : 'unknown';
    const tags = ex.tags?.length ? ` [tags: ${ex.tags.join(', ')}]` : '';
    const content = ex.final_content
      ? JSON.stringify(ex.final_content, null, 2).slice(0, maxChars)
      : '(no final_content)';
    return `## Example ${i + 1} — approved ${when}${tags}\n${content}`;
  });
  return `\n\n# Past approved ${label} — reference only, do NOT copy\nFresh writing in the same voice. Do not recycle phrases wholesale.\n\n${blocks.join('\n\n')}`;
}

function renderRecentFeedback(items: RecentFeedbackItem[]): string {
  if (!items.length) return '';
  const body = items
    .map((f) => {
      const date = (f.reviewed_at ?? f.created_at).slice(0, 10);
      const fb = f.feedback ? ` — "${f.feedback}"` : '';
      return `- [${f.status.toUpperCase()} ${date}] ${f.type}: "${f.title}"${fb}`;
    })
    .join('\n');
  return `\n\n# RECENT FEEDBACK (last 14 days)\n${body}`;
}

// ============================================================================
// JSON extraction helpers
// ============================================================================

function extractJsonBlock(text: string, startMarker: string, endMarker: string): string | null {
  const s = text.indexOf(startMarker);
  if (s < 0) return null;
  const after = text.slice(s + startMarker.length);
  const e = after.indexOf(endMarker);
  if (e < 0) return null;
  return after.slice(0, e).trim();
}

function tryParseJson<T>(text: string): T | null {
  try {
    const start = text.indexOf('{');
    const arrStart = text.indexOf('[');
    const actualStart =
      start >= 0 && (arrStart < 0 || start < arrStart) ? start
      : arrStart >= 0 ? arrStart
      : -1;
    if (actualStart < 0) return null;
    const opener = text[actualStart];
    const closer = opener === '{' ? '}' : ']';
    const end = text.lastIndexOf(closer);
    if (end <= actualStart) return null;
    return JSON.parse(text.slice(actualStart, end + 1)) as T;
  } catch {
    return null;
  }
}

// ============================================================================
// Gate 0 — opportunity scan (web_search enabled)
// ============================================================================

const SCAN_SYSTEM_INSTRUCTIONS = `
You are running an on-demand funding opportunity scan for Briana's ventures.

You MUST apply the 6-point fit test from playbook §1 strictly. Apply the
threshold tiers from system-prompt.md §Core Operating Principles:
  - <$500: skip
  - $500–$1,000: skip unless easy + aligned
  - $1,000–$5,000: surface if alignment is strong
  - $5,000+: priority
  - $50,000+: flagship, highest care

# CRITICAL: verify every opportunity via web search before surfacing

You have the web_search tool available. Use it. Your training data is stale
and will lead you to surface grants that no longer exist or that Briana has
already applied to. Made-up grants burn her time and trust.

For each candidate opportunity you consider:

1. Web search the funder + program name to confirm it currently exists.
2. Verify the 2026 cycle is open or upcoming — NOT a closed cycle.
3. Check the deadline from a primary source (funder's site, not aggregator).
4. Confirm award size and non-dilutive nature from the funder's own page.
5. The source_url MUST be a URL that appeared in your web_search results AND
   is tied to the funder's application page (or primary info page). Never
   invent a URL. Never link to an aggregator listing when the funder's own
   page is verifiable.
6. Run the 6-point fit test. Only surface opportunities that pass 5-of-6 or
   6-of-6. 4-of-6 or lower = skip (log in candidates_not_surfaced).

Prefer surfacing fewer verified opportunities over more unverified ones.
Do NOT pad the list.

# Hard blocks — never surface

- Any VC firm, equity accelerator, convertible note, SAFE, revenue share, or
  royalty-based program. The non-dilutive-only rule is non-negotiable.
- Any opportunity in the "active pipeline" list — Briana's already on these.
- Any opportunity with a closed 2026 cycle or no upcoming deadline.
- Any opportunity with an application fee above $50.
- Any funder with active public controversy (labor, political, values).

# Output format (strict JSON, no commentary)

Wrap in these markers:

<!-- BEGIN_SCAN -->
{
  "reviewed": [
    {
      "opportunity_name": "string (program name, e.g., 'Small Business Grant')",
      "funder": "string (organization, e.g., 'Hello Alice')",
      "funding_type": "Grant" | "Fellowship" | "Residency" | "Accelerator" | "Competition" | "Sponsored Program",
      "funding_amount": number or null (US dollars; null if tiered/variable),
      "application_deadline": "YYYY-MM-DD" or null,
      "source_url": "verified URL from web_search (funder's program page)" or null,
      "ventures": ["Artisanship" | "The Trades Show" | "The Corral" | "Artisan Mag" | "Artisanship Community" | "Detto" | "Neo-Renaissance Ecosystem" | "Cross-venture", ...],
      "primary_venture": "one of the venture values above — the best-fit venture angle",
      "eligibility_criteria": "specific eligibility requirements (entity type, location, demographics, stage)",
      "match_rating": number 0-10 (strength of mission + venture fit),
      "reason_for_match": "one concrete sentence on why this fits",
      "effort_estimate": "low (<2hr)" | "medium (2-8hr)" | "high (>8hr)",
      "effort_hours_low": number (estimated low end in hours),
      "effort_hours_high": number (estimated high end in hours),
      "fit_test": {
        "non_dilutive": true | false,
        "mission_alignment": true | false,
        "eligibility": true | false,
        "effort_to_reward": true | false,
        "timeline": true | false,
        "reputation": true | false
      },
      "fit_score_out_of_six": number (count of trues above),
      "recommendation": "Apply" | "Flag for review" | "Skip",
      "skip_reason": "string if recommendation is Skip, else null",
      "passes_threshold": true | false (true only if fit_score_out_of_six >= 5 AND non_dilutive AND recommendation != 'Skip')
    }
  ]
}
<!-- END_SCAN -->

# Rules
- Aim for \${requestedCount} surfaced opportunities. Over-produce slightly so
  the code can filter to the passing set.
- Only surface candidates where passes_threshold is true.
- Every surfaced opportunity MUST have a verified source_url from web_search.
- Every funding_amount + deadline MUST be from the funder's own site.
- Use the venture angles in playbook §2 to pick primary_venture.
- Diversify across venture categories and funding types when possible.
- NEVER surface pitch competitions where the prize is investment-contingent.
- NEVER surface 501(c)(3)-only grants (Briana's entity is for-profit LLC).

Return ONLY the wrapped JSON.
`.trim();

export interface RunFundingScanParams {
  requestedCount?: number; // default 5
  trigger?: 'cron' | 'manual';
  focusArea?: string; // optional free-text focus (e.g., "fellowships for founders")
}

export interface RunFundingScanResult {
  runId: string;
  queueId: string;
  outputId: string;
  scan: FundingOpportunityScan;
  webSearches: number;
  tokensUsed: number;
  costEstimate: number;
}

export async function runFundingOpportunityScan(
  params: RunFundingScanParams = {},
): Promise<RunFundingScanResult> {
  const requestedCount =
    Number.isFinite(params.requestedCount) && (params.requestedCount ?? 0) > 0
      ? Math.floor(params.requestedCount as number)
      : 5;
  const trigger = params.trigger ?? 'manual';
  const focusArea = (params.focusArea ?? '').trim();

  const run = await logRunStart(AGENT_NAME, trigger);
  try {
    const [permanentPreferences, recentFeedback, pastApps, activePipeline] =
      await Promise.all([
        getPermanentPreferences(AGENT_NAME).catch(() => [] as string[]),
        getRecentFeedback(AGENT_NAME, 24 * 14, ['report']).catch(
          () => [] as RecentFeedbackItem[],
        ),
        getApprovedOutputsByType({
          agentId: 'funding-scout',
          venture: 'cross',
          outputType: 'grant_application_draft',
          limit: 3,
          requireFinalContent: true,
        }).catch(() => [] as ApprovedOutputExample[]),
        getActiveFundingOpportunities().catch(() => [] as FundingOpportunityRow[]),
      ]);

    const memoryBlock = permanentPreferences.length
      ? '\n\n# Permanent preferences (apply every run)\n' +
        permanentPreferences.map((r) => `- ${r}`).join('\n')
      : '';

    const system =
      loadFundingContextFiles() +
      memoryBlock +
      renderExemplars('application drafts', pastApps) +
      renderRecentFeedback(recentFeedback) +
      '\n\n---\n\n' +
      SCAN_SYSTEM_INSTRUCTIONS.replace('${requestedCount}', String(requestedCount));

    const user = `Today is ${todayIsoPT()}.
Requested count: ${requestedCount}.
${focusArea ? `Focus area (optional): ${focusArea}` : ''}

# ACTIVE PIPELINE (already tracked in Notion — do NOT re-surface)
${renderActivePipeline(activePipeline)}

# TASK
Scan for non-dilutive funding opportunities for Briana's ventures. Use web
search to verify each opportunity is currently open and matches the 6-point
fit test. Produce up to ${requestedCount} surfaced opportunities.

Return the JSON wrapped between BEGIN_SCAN / END_SCAN markers.`;

    const perOpportunityTokens = 1200;
    const maxTokens = Math.min(
      60000,
      Math.max(6000, requestedCount * perOpportunityTokens),
    );
    // Web search budget: ~5 searches per opportunity (funder check, cycle
    // confirmation, deadline, amount, reputation) with a 10-call floor. Cap
    // at 80 to keep cost predictable (roughly $0.80 at Anthropic pricing).
    const webSearchBudget = Math.min(80, Math.max(10, requestedCount * 5));
    const result = await think({
      systemPrompt: system,
      userPrompt: user,
      maxTokens,
      webSearch: { maxUses: webSearchBudget },
    });

    const rawJson =
      extractJsonBlock(result.text, '<!-- BEGIN_SCAN -->', '<!-- END_SCAN -->') ??
      result.text;
    type Reviewed = {
      opportunity_name?: string;
      funder?: string;
      funding_type?: FundingType;
      funding_amount?: number | null;
      application_deadline?: string | null;
      source_url?: string | null;
      ventures?: FundingVenture[];
      primary_venture?: FundingVenture;
      eligibility_criteria?: string;
      match_rating?: number;
      reason_for_match?: string;
      effort_estimate?: FundingEffort;
      effort_hours_low?: number;
      effort_hours_high?: number;
      fit_test?: FundingOpportunity['fit_test'];
      fit_score_out_of_six?: number;
      recommendation?: FundingOpportunity['recommendation'];
      skip_reason?: string | null;
      passes_threshold?: boolean;
    };
    const parsed = tryParseJson<{ reviewed?: Reviewed[] }>(rawJson);
    const reviewed = Array.isArray(parsed?.reviewed) ? parsed!.reviewed : [];

    const passing = reviewed.filter(
      (r) =>
        r.passes_threshold === true &&
        r.funder &&
        r.opportunity_name &&
        r.fit_test?.non_dilutive === true,
    );

    const opportunities: FundingOpportunity[] = passing
      .slice(0, requestedCount)
      .map((r, i) => ({
        opportunity_id: `opp_${i}`,
        opportunity_name: r.opportunity_name!,
        funder: r.funder!,
        funding_type: r.funding_type ?? 'Grant',
        funding_amount: r.funding_amount ?? null,
        application_deadline: r.application_deadline ?? null,
        source_url: r.source_url ?? null,
        ventures: Array.isArray(r.ventures) && r.ventures.length > 0 ? r.ventures : ['Cross-venture'],
        primary_venture: r.primary_venture ?? (r.ventures?.[0] ?? 'Cross-venture'),
        eligibility_criteria: r.eligibility_criteria ?? '',
        match_rating: typeof r.match_rating === 'number' ? r.match_rating : 0,
        reason_for_match: r.reason_for_match ?? '',
        effort_estimate: r.effort_estimate ?? 'medium (2-8hr)',
        effort_hours_low: typeof r.effort_hours_low === 'number' ? r.effort_hours_low : null,
        effort_hours_high: typeof r.effort_hours_high === 'number' ? r.effort_hours_high : null,
        fit_test: r.fit_test ?? {
          non_dilutive: true,
          mission_alignment: true,
          eligibility: true,
          effort_to_reward: true,
          timeline: true,
          reputation: true,
        },
        fit_score_out_of_six: r.fit_score_out_of_six ?? 6,
        recommendation: r.recommendation ?? 'Apply',
        skip_reason: r.skip_reason ?? null,
        approved: false,
        skipped: false,
        feedback: null,
        notion_row_id: null,
        draft_output_id: null,
      }));

    const notSurfaced = reviewed
      .filter((r) => r.passes_threshold !== true)
      .slice(0, 15)
      .map((r) => ({
        funder: r.funder ?? '(unknown funder)',
        opportunity_name: r.opportunity_name ?? '(unknown)',
        skip_reason:
          r.skip_reason ??
          (r.fit_test?.non_dilutive === false
            ? 'dilutive (hard pass)'
            : `fit ${r.fit_score_out_of_six ?? '?'}/6`),
      }));

    const scan: FundingOpportunityScan = {
      total_reviewed: reviewed.length,
      surfaced_count: opportunities.length,
      requested_count: requestedCount,
      surfaced_at: new Date().toISOString(),
      opportunities,
      candidates_not_surfaced: notSurfaced,
    };

    const summary =
      opportunities.length > 0
        ? `Reviewed ${reviewed.length}, surfacing ${opportunities.length} (${opportunities.filter((o) => o.recommendation === 'Apply').length} recommended)`
        : `Reviewed ${reviewed.length}, nothing cleared the 6-point fit test`;

    const outputId = await logOutput({
      agentId: 'funding-scout',
      venture: 'cross',
      outputType: 'funding_opportunity_scan',
      runId: run.id,
      draftContent: scan as unknown as Record<string, unknown>,
      tags: [
        'funding-scan',
        todayIsoPT(),
        ...(focusArea ? [`focus:${focusArea.toLowerCase().slice(0, 30)}`] : []),
      ],
    });

    const queueId = await depositToQueue({
      agent_name: AGENT_NAME,
      type: 'report',
      title: `Funding scan — ${todayIsoPT()} (${opportunities.length} opportunities)`,
      summary,
      full_output: scan as unknown as Record<string, unknown>,
      initiative: 'Cross-venture',
      run_id: run.id,
      agent_output_id: outputId,
    });
    await setApprovalQueueId(outputId, queueId);

    await logRunComplete({
      runId: run.id,
      startedAt: run.started_at,
      status: 'success',
      tokensUsed: result.inputTokens + result.outputTokens,
      model: MODEL,
      contextSummary: `pipeline=${activePipeline.length} reviewed=${reviewed.length} surfaced=${opportunities.length} web_searches=${result.webSearchCount ?? 0}`,
      outputSummary: summary,
      approvalQueueId: queueId,
      costEstimate: Number(result.costEstimate.toFixed(4)),
    });

    return {
      runId: run.id,
      queueId,
      outputId,
      scan,
      webSearches: result.webSearchCount ?? 0,
      tokensUsed: result.inputTokens + result.outputTokens,
      costEstimate: result.costEstimate,
    };
  } catch (e: any) {
    await logRunComplete({
      runId: run.id,
      startedAt: run.started_at,
      status: 'error',
      model: MODEL,
      error: e?.message ?? String(e),
    });
    throw e;
  }
}

// ============================================================================
// Gate 1 — approve opportunity: create Notion row + generate draft
// ============================================================================

function draftInstructionsForType(
  type: FundingType,
  prompts: Array<{ label: string; wordCap?: number | null }> | null,
): string {
  const base =
    `# Funding Type: ${type}\nFollow the structure that fits this funder type (see playbook §5/§6 and voice.md exemplars).`;
  if (prompts && prompts.length > 0) {
    const list = prompts
      .map(
        (p, i) =>
          `  ${i + 1}. ${p.label}${p.wordCap ? ` (≤${p.wordCap} words)` : ''}`,
      )
      .join('\n');
    return `${base}\n\n# Prompts to answer (respond to each as its own section)\n${list}`;
  }
  switch (type) {
    case 'Fellowship':
      return `${base}\n\n# Fellowship structure (founder-level, e.g., O'Shaughnessy)\n- Opener: a unifying insight or formative moment\n- The worldview (Slow Renaissance / human-in-the-loop thesis)\n- What I've built: Artisanship, Detto, agent ecosystem\n- The connecting thread\n- What the fellowship enables\n- The bigger picture\n- Close with "the human in the loop" signature line`;
    case 'Residency':
      return `${base}\n\n# Residency structure\n- Artistic/work statement grounded in the Slow Renaissance thesis\n- What the residency would enable (specific work to complete)\n- Why this residency, why now\n- Concrete deliverable by end of residency`;
    case 'Accelerator':
      return `${base}\n\n# Accelerator structure (non-dilutive only)\n- The problem Artisanship/Detto solves\n- Current traction (Stats Bible numbers, no inflation)\n- What the accelerator's resources enable (not equity, not dilution)\n- Specific milestones during the program\n- Why this cohort, why now`;
    case 'Competition':
    case 'Sponsored Program':
      return `${base}\n\n# Competition / sponsored program structure\n- Hook with a concrete moment or stat (per voice.md)\n- What Artisanship is (ecosystem framing)\n- Specific ask and what it enables\n- Measurable outcome\n- Confident closing`;
    case 'Grant':
    default:
      return `${base}\n\n# Standard grant structure (500–1,000 words)\n- Opener: specific moment / stat / scene — NOT mission language\n- Who we are: Briana + Artisanship as ecosystem with stage-appropriate traction\n- Why this work, why now: cultural moment / industry stats / AI-tension\n- The ask: specifically what the funding enables, broken into clean buckets if >$5K\n- Measurable impact: what will be true in 6–12 months\n- Closing: confident forward-looking (optional "pick me" flourish)`;
  }
}

const DRAFT_SYSTEM_INSTRUCTIONS = `
You are drafting a single funder application for Briana. Follow voice.md
exactly — founder-voiced, not grant-writer-voiced. Lead with specifics.
Stats must come from the Stats Bible in voice.md only — never invent.

# CRITICAL voice rules (non-negotiable)

- Artisanship is an ECOSYSTEM, not a company. Never "the company."
- Use "secondhand loafers" — never "Gucci loafers" or "beat-up leather loafers."
- Cobbler story: at most once per application.
- "The human in the loop" — at most once, typically in closing.
- "Taste, authenticity, and trust" — when funder cares about craft/AI differentiation.
- Stats Bible numbers verbatim. Don't round up. Don't invent.
- Briana Augustina LLC is the umbrella entity. Artisanship LLC is NOT formed.
- Never claim partnerships, press, or endorsements that don't exist.
- Never use generic "mission-driven at the intersection of..." openers.
- No "thank you for your consideration" endings.

# Output format (strict JSON, no commentary)

Wrap in these markers:

<!-- BEGIN_DRAFT -->
{
  "sections": [
    {
      "prompt": "the funder's question or section label",
      "response": "the drafted response (founder voice, specific, structured per voice.md)",
      "word_count": number (approximate word count of response)
    }
  ],
  "full_draft": "string (concatenated draft for preview; sections joined with double newlines + prompt as heading)",
  "word_count_total": number,
  "notes_for_briana": "1-3 sentences flagging anything that needs her review — e.g., missing data, a statement she should verify, a decision point",
  "stats_bible_references": ["list of specific stats used, e.g., '1,000+ Corral opportunities', '350K+ social views'"],
  "proof_moment_used": "cobbler" | "frank_beneduci" | "angela_wilson" | "reddit_50" | "thank_you_quote" | "none"
}
<!-- END_DRAFT -->

Return ONLY the wrapped JSON.
`.trim();

export interface ApproveOpportunityParams {
  scanQueueItemId: string;
  opportunityId: string;
  /** Optional funder-specific prompts to draft against (e.g., pulled from
   *  the funder's application form). If omitted, draft uses the default
   *  structure for the funding type. */
  applicationPrompts?: Array<{ label: string; wordCap?: number | null }>;
}

export interface ApproveOpportunityResult {
  draftOutputId: string;
  draftQueueId: string;
  notionRowId: string | null;
  draft: FundingApplicationDraft;
  tokensUsed: number;
  costEstimate: number;
}

export async function approveOpportunityAndDraft(
  params: ApproveOpportunityParams,
): Promise<ApproveOpportunityResult> {
  const { scanQueueItemId, opportunityId, applicationPrompts } = params;
  const db = supabaseAdmin();

  const { data: scanItem, error: scanErr } = await db
    .from('approval_queue')
    .select('full_output, agent_output_id, run_id')
    .eq('id', scanQueueItemId)
    .single();
  if (scanErr || !scanItem) throw new Error('Funding scan queue item not found');

  const scan = (scanItem.full_output ?? {}) as FundingOpportunityScan;
  const opportunity = scan.opportunities?.find((o) => o.opportunity_id === opportunityId);
  if (!opportunity) throw new Error(`Opportunity ${opportunityId} not found in scan`);
  if (opportunity.approved) throw new Error('Opportunity already approved');
  if (opportunity.skipped) throw new Error('Opportunity was skipped — cannot approve');

  const parentOutputId = scanItem.agent_output_id as string | null;
  const parentRunId = scanItem.run_id as string | null;

  // ── Step A: Create Notion funding DB row with status=approved ────────────
  let notionRowId: string | null = null;
  try {
    notionRowId = await createFundingOpportunity({
      opportunityName: `${opportunity.funder} — ${opportunity.opportunity_name}`,
      funder: opportunity.funder,
      fundingType: opportunity.funding_type,
      fundingAmount: opportunity.funding_amount ?? undefined,
      applicationDeadline: opportunity.application_deadline ?? undefined,
      status: 'approved',
      ventures: opportunity.ventures,
      effortEstimate: opportunity.effort_estimate,
      matchRating: opportunity.match_rating,
      reasonForMatch: opportunity.reason_for_match,
      eligibilityCriteria: opportunity.eligibility_criteria,
      sourceUrl: opportunity.source_url ?? undefined,
      notes: `Surfaced via funding-scout scan on ${todayIsoPT()}. Fit: ${opportunity.fit_score_out_of_six}/6. Primary venture: ${opportunity.primary_venture}.`,
    });
  } catch (e) {
    console.error('[funding-scout] Notion DB write failed on approval:', e);
  }

  // ── Step B: Generate the application draft ───────────────────────────────
  const outputType = fundingTypeToOutputType(opportunity.funding_type);
  const run = await logRunStart(AGENT_NAME, 'manual');
  try {
    const [permanentPreferences, recentFeedback, exemplars] = await Promise.all([
      getPermanentPreferences(AGENT_NAME).catch(() => [] as string[]),
      getRecentFeedback(AGENT_NAME, 24 * 14, ['draft']).catch(
        () => [] as RecentFeedbackItem[],
      ),
      getApprovedOutputsByType({
        agentId: 'funding-scout',
        venture: 'cross',
        outputType,
        limit: 5,
        requireFinalContent: true,
      }).catch(() => [] as ApprovedOutputExample[]),
    ]);

    const memoryBlock = permanentPreferences.length
      ? '\n\n# Permanent preferences (apply every run)\n' +
        permanentPreferences.map((r) => `- ${r}`).join('\n')
      : '';

    const system =
      loadFundingContextFiles() +
      memoryBlock +
      renderExemplars(`${opportunity.funding_type.toLowerCase()} application drafts`, exemplars) +
      renderRecentFeedback(recentFeedback) +
      '\n\n---\n\n' +
      DRAFT_SYSTEM_INSTRUCTIONS +
      '\n\n---\n\n' +
      draftInstructionsForType(opportunity.funding_type, applicationPrompts ?? null);

    const user = `Draft the application for this opportunity.

# OPPORTUNITY
Funder: ${opportunity.funder}
Program: ${opportunity.opportunity_name}
Funding type: ${opportunity.funding_type}
Funding amount: ${opportunity.funding_amount != null ? `$${opportunity.funding_amount.toLocaleString()}` : 'variable / unspecified'}
Deadline: ${opportunity.application_deadline ?? 'unspecified'}
Primary venture: ${opportunity.primary_venture}
All matching ventures: ${opportunity.ventures.join(', ')}
Eligibility: ${opportunity.eligibility_criteria}
Why it's a fit: ${opportunity.reason_for_match}
Effort estimate: ${opportunity.effort_estimate}
Source URL: ${opportunity.source_url ?? 'unknown'}

${applicationPrompts?.length ? `# APPLICATION PROMPTS (answer each)\n${applicationPrompts.map((p, i) => `${i + 1}. ${p.label}${p.wordCap ? ` — ≤${p.wordCap} words` : ''}`).join('\n')}` : '# No specific prompts given — use the default structure for this funding type.'}

Today: ${todayIsoPT()}.

Produce ONLY the JSON wrapped between BEGIN_DRAFT / END_DRAFT markers.`;

    const result = await think({
      systemPrompt: system,
      userPrompt: user,
      maxTokens: 8000,
    });

    const rawJson =
      extractJsonBlock(result.text, '<!-- BEGIN_DRAFT -->', '<!-- END_DRAFT -->') ??
      result.text;
    type ParsedDraft = {
      sections?: Array<{ prompt: string; response: string; word_count?: number }>;
      full_draft?: string;
      word_count_total?: number;
      notes_for_briana?: string;
      stats_bible_references?: string[];
      proof_moment_used?: FundingApplicationDraft['proof_moment_used'];
    };
    const parsed = tryParseJson<ParsedDraft>(rawJson);

    const sections =
      parsed?.sections?.map((s) => ({
        prompt: s.prompt ?? '',
        response: s.response ?? '',
        word_count:
          typeof s.word_count === 'number'
            ? s.word_count
            : (s.response ?? '').split(/\s+/).filter(Boolean).length,
      })) ??
      (parsed?.full_draft
        ? [
            {
              prompt: opportunity.opportunity_name,
              response: parsed.full_draft,
              word_count: parsed.full_draft.split(/\s+/).filter(Boolean).length,
            },
          ]
        : []);

    const fullDraft =
      parsed?.full_draft?.trim() ||
      sections.map((s) => `## ${s.prompt}\n\n${s.response}`).join('\n\n');

    const wordCountTotal =
      parsed?.word_count_total ??
      sections.reduce((acc, s) => acc + (s.word_count ?? 0), 0);

    const draft: FundingApplicationDraft = {
      opportunity_id: opportunity.opportunity_id,
      parent_scan_output_id: parentOutputId,
      opportunity_name: opportunity.opportunity_name,
      funder: opportunity.funder,
      funding_type: opportunity.funding_type,
      application_deadline: opportunity.application_deadline,
      source_url: opportunity.source_url,
      primary_venture: opportunity.primary_venture,
      sections,
      full_draft: fullDraft,
      word_count_total: wordCountTotal,
      notes_for_briana: parsed?.notes_for_briana ?? '',
      stats_bible_references: parsed?.stats_bible_references ?? [],
      proof_moment_used: parsed?.proof_moment_used ?? 'none',
      notion_row_id: notionRowId,
    };

    const draftOutputId = await logOutput({
      agentId: 'funding-scout',
      venture: 'cross',
      outputType,
      runId: run.id,
      parentOutputId: parentOutputId ?? undefined,
      draftContent: draft as unknown as Record<string, unknown>,
      tags: [
        'funding-draft',
        opportunity.funding_type.toLowerCase(),
        opportunity.primary_venture.toLowerCase().replace(/\s+/g, '-'),
        ...(opportunity.funding_amount && opportunity.funding_amount >= 50000 ? ['flagship'] : []),
      ],
    });

    const draftQueueId = await depositToQueue({
      agent_name: AGENT_NAME,
      type: 'draft',
      title: `Funding draft — ${opportunity.funder} (${opportunity.opportunity_name})`,
      summary: `${opportunity.funding_type} · ${opportunity.funding_amount != null ? `$${opportunity.funding_amount.toLocaleString()}` : 'amount TBD'}${opportunity.application_deadline ? ` · deadline ${opportunity.application_deadline}` : ''}`,
      full_output: draft as unknown as Record<string, unknown>,
      initiative: 'Cross-venture',
      run_id: run.id,
      agent_output_id: draftOutputId,
    });
    await setApprovalQueueId(draftOutputId, draftQueueId);

    // ── Step C: Update Notion status approved → drafted ─────────────────────
    if (notionRowId) {
      try {
        await updateFundingOpportunity(notionRowId, { status: 'drafted' });
      } catch (e) {
        console.error('[funding-scout] Notion status update to drafted failed:', e);
      }
    }

    // ── Step D: Mark opportunity approved in parent scan ────────────────────
    await markOpportunityApprovedInScan({
      scanQueueItemId,
      parentOutputId,
      opportunityId,
      notionRowId,
      draftOutputId,
    });

    await logRunComplete({
      runId: run.id,
      startedAt: run.started_at,
      status: 'success',
      tokensUsed: result.inputTokens + result.outputTokens,
      model: MODEL,
      contextSummary: `opp=${opportunity.funder}/${opportunity.opportunity_name} type=${opportunity.funding_type}`,
      outputSummary: `Draft for ${opportunity.funder} (${wordCountTotal} words)`,
      approvalQueueId: draftQueueId,
      costEstimate: Number(result.costEstimate.toFixed(4)),
    });

    return {
      draftOutputId,
      draftQueueId,
      notionRowId,
      draft,
      tokensUsed: result.inputTokens + result.outputTokens,
      costEstimate: result.costEstimate,
    };
  } catch (e: any) {
    await logRunComplete({
      runId: run.id,
      startedAt: run.started_at,
      status: 'error',
      model: MODEL,
      error: e?.message ?? String(e),
    });
    // Suppress unused var warning on parentRunId (reserved for future Supervisor wiring)
    void parentRunId;
    throw e;
  }
}

async function markOpportunityApprovedInScan(params: {
  scanQueueItemId: string;
  parentOutputId: string | null;
  opportunityId: string;
  notionRowId: string | null;
  draftOutputId: string;
}): Promise<void> {
  const db = supabaseAdmin();
  const { data: item } = await db
    .from('approval_queue')
    .select('full_output')
    .eq('id', params.scanQueueItemId)
    .single();
  if (!item) return;
  const scan = (item.full_output ?? {}) as FundingOpportunityScan;
  const opportunities = Array.isArray(scan.opportunities) ? scan.opportunities : [];
  const updated = opportunities.map((o) =>
    o.opportunity_id === params.opportunityId
      ? {
          ...o,
          approved: true,
          notion_row_id: params.notionRowId,
          draft_output_id: params.draftOutputId,
        }
      : o,
  );
  const nextScan = { ...scan, opportunities: updated };
  await db
    .from('approval_queue')
    .update({ full_output: nextScan as unknown as Record<string, unknown> })
    .eq('id', params.scanQueueItemId);
  if (params.parentOutputId) {
    await db
      .from('agent_outputs')
      .update({ draft_content: nextScan as unknown as Record<string, unknown> })
      .eq('id', params.parentOutputId);
  }
}

// ============================================================================
// Skip opportunity — mark in scan, no Notion write
// ============================================================================

export interface SkipOpportunityParams {
  scanQueueItemId: string;
  opportunityId: string;
  feedback?: string;
}

export async function skipOpportunity(params: SkipOpportunityParams): Promise<void> {
  const db = supabaseAdmin();
  const { data: item } = await db
    .from('approval_queue')
    .select('full_output, agent_output_id')
    .eq('id', params.scanQueueItemId)
    .single();
  if (!item) throw new Error('Scan queue item not found');
  const scan = (item.full_output ?? {}) as FundingOpportunityScan;
  const opportunities = Array.isArray(scan.opportunities) ? scan.opportunities : [];
  const updated = opportunities.map((o) =>
    o.opportunity_id === params.opportunityId
      ? { ...o, skipped: true, feedback: params.feedback?.trim() || null }
      : o,
  );
  const nextScan = { ...scan, opportunities: updated };
  await db
    .from('approval_queue')
    .update({ full_output: nextScan as unknown as Record<string, unknown> })
    .eq('id', params.scanQueueItemId);
  if (item.agent_output_id) {
    await db
      .from('agent_outputs')
      .update({ draft_content: nextScan as unknown as Record<string, unknown> })
      .eq('id', item.agent_output_id);
  }
}

// ============================================================================
// Gate 2 — approve draft: mark Notion status=ready, create reminder task
// Called from /api/queue/[id]/status on approve for funding-scout drafts.
// ============================================================================

export async function markOpportunityReadyToApply(params: {
  draftOutputId: string;
}): Promise<{ notionRowId: string | null; reminderTaskId: string | null }> {
  const db = supabaseAdmin();
  const { data: out, error } = await db
    .from('agent_outputs')
    .select('agent_id, output_type, draft_content, final_content')
    .eq('id', params.draftOutputId)
    .single();
  if (error || !out) throw new Error('Draft output not found');
  if (out.agent_id !== 'funding-scout') {
    throw new Error('markOpportunityReadyToApply only applies to funding-scout drafts');
  }

  const draft = ((out.final_content ?? out.draft_content) ?? {}) as FundingApplicationDraft;
  const notionRowId = draft.notion_row_id ?? null;

  let reminderTaskId: string | null = null;
  if (notionRowId) {
    try {
      await updateFundingOpportunity(notionRowId, { status: 'ready to apply' });
    } catch (e) {
      console.error('[funding-scout] Notion status update to ready to apply failed:', e);
    }
  }

  // Create a Notion Task reminding Briana to submit, with the deadline as the
  // To-Do Date. Leave the Initiative / Outcome relations empty — these are
  // cross-venture tasks.
  if (draft.application_deadline) {
    try {
      const { createTask } = await import('../notion/client');
      const dueDate = computeTaskDueDate(draft.application_deadline);
      reminderTaskId = await createTask({
        title: `${draft.funder} — Application deadline (${draft.opportunity_name})`,
        type: 'Task',
        toDoDate: dueDate,
        datesStart: draft.application_deadline,
        datesEnd: draft.application_deadline,
        source: 'Claude',
      });
    } catch (e) {
      console.error('[funding-scout] Task creation failed:', e);
    }
  }

  return { notionRowId, reminderTaskId };
}

function computeTaskDueDate(deadlineIso: string): string {
  // Start working on the application ~7 days before the deadline.
  try {
    const d = new Date(deadlineIso);
    d.setUTCDate(d.getUTCDate() - 7);
    return d.toISOString().slice(0, 10);
  } catch {
    return deadlineIso;
  }
}

// ============================================================================
// Gate 3 — mark as submitted: Notion status=applied, final_content locked
// ============================================================================

export interface MarkSubmittedResult {
  notionRowId: string | null;
  submittedAt: string;
}

export async function markOpportunitySubmitted(params: {
  outputId: string;
  finalDraft?: string;
}): Promise<MarkSubmittedResult> {
  const db = supabaseAdmin();
  const { data: out, error } = await db
    .from('agent_outputs')
    .select('agent_id, output_type, draft_content, final_content')
    .eq('id', params.outputId)
    .single();
  if (error || !out) throw new Error('Draft output not found');
  if (out.agent_id !== 'funding-scout') {
    throw new Error('markOpportunitySubmitted only applies to funding-scout drafts');
  }

  const draft = ((out.final_content ?? out.draft_content) ?? {}) as FundingApplicationDraft;
  if (draft.submitted_at) {
    return {
      notionRowId: draft.notion_row_id ?? null,
      submittedAt: draft.submitted_at,
    };
  }

  const submittedAt = new Date().toISOString();
  const updatedDraft: FundingApplicationDraft = {
    ...draft,
    submitted_at: submittedAt,
    full_draft: params.finalDraft?.trim() || draft.full_draft,
  };

  if (draft.notion_row_id) {
    try {
      await updateFundingOpportunity(draft.notion_row_id, {
        status: 'applied',
      });
    } catch (e) {
      console.error('[funding-scout] Notion status update to applied failed:', e);
    }
  }

  await updateOutputStatus({
    outputId: params.outputId,
    status: 'approved',
    finalContent: updatedDraft as unknown as Record<string, unknown>,
  });

  return { notionRowId: draft.notion_row_id ?? null, submittedAt };
}

// ============================================================================
// Replace an opportunity in a scan — dynamic swap
// ============================================================================

const REPLACE_SYSTEM_INSTRUCTIONS = `
You are replacing ONE funding opportunity in a funding scan.

Return exactly ONE new opportunity that passes the 6-point fit test and
addresses Briana's feedback (if any). Avoid every opportunity on the "do
not re-surface" list.

# CRITICAL: verify via web search

Use web_search. Do not fabricate opportunities or URLs. Confirm the funder
exists, the program is currently open, and the deadline is in the future.
Never compose URLs from training data.

# Output format (strict JSON)

<!-- BEGIN_REPLACEMENT -->
{
  "opportunity_name": "string",
  "funder": "string",
  "funding_type": "Grant" | "Fellowship" | "Residency" | "Accelerator" | "Competition" | "Sponsored Program",
  "funding_amount": number or null,
  "application_deadline": "YYYY-MM-DD" or null,
  "source_url": "verified URL from web_search" or null,
  "ventures": ["..."],
  "primary_venture": "string",
  "eligibility_criteria": "string",
  "match_rating": number 0-10,
  "reason_for_match": "one sentence",
  "effort_estimate": "low (<2hr)" | "medium (2-8hr)" | "high (>8hr)",
  "effort_hours_low": number,
  "effort_hours_high": number,
  "fit_test": { "non_dilutive": true, "mission_alignment": true, "eligibility": true, "effort_to_reward": true, "timeline": true, "reputation": true },
  "fit_score_out_of_six": number,
  "recommendation": "Apply" | "Flag for review"
}
<!-- END_REPLACEMENT -->

Return ONLY the wrapped JSON.
`.trim();

export interface ReplaceOpportunityParams {
  scanQueueItemId: string;
  opportunityId: string;
  feedback?: string;
}

export interface ReplaceOpportunityResult {
  opportunity: FundingOpportunity;
  tokensUsed: number;
  costEstimate: number;
}

export async function replaceOpportunity(
  params: ReplaceOpportunityParams,
): Promise<ReplaceOpportunityResult> {
  const db = supabaseAdmin();
  const { data: item, error } = await db
    .from('approval_queue')
    .select('full_output, agent_output_id')
    .eq('id', params.scanQueueItemId)
    .single();
  if (error || !item) throw new Error('Scan queue item not found');

  const scan = (item.full_output ?? {}) as FundingOpportunityScan;
  const opportunities = Array.isArray(scan.opportunities) ? scan.opportunities : [];
  const target = opportunities.find((o) => o.opportunity_id === params.opportunityId);
  if (!target) throw new Error(`Opportunity ${params.opportunityId} not found`);
  if (target.approved) throw new Error('Opportunity already approved — cannot replace');

  const feedback = (params.feedback ?? '').trim();
  const [permanentPreferences, recentFeedback, pipeline] = await Promise.all([
    getPermanentPreferences(AGENT_NAME).catch(() => [] as string[]),
    getRecentFeedback(AGENT_NAME, 24 * 14, ['report']).catch(
      () => [] as RecentFeedbackItem[],
    ),
    getActiveFundingOpportunities().catch(() => [] as FundingOpportunityRow[]),
  ]);

  const memoryBlock = permanentPreferences.length
    ? '\n\n# Permanent preferences\n' + permanentPreferences.map((r) => `- ${r}`).join('\n')
    : '';

  const system =
    loadFundingContextFiles() +
    memoryBlock +
    renderRecentFeedback(recentFeedback) +
    '\n\n---\n\n' +
    REPLACE_SYSTEM_INSTRUCTIONS;

  const otherFunders = opportunities
    .filter((o) => o.opportunity_id !== params.opportunityId)
    .map((o) => `${o.funder} — ${o.opportunity_name}`);
  const priorFunders = (target.previous_versions ?? []).map(
    (v) => `${v.funder} — ${v.opportunity_name}`,
  );
  const pipelineFunders = pipeline
    .map((p) => (p.funder ? `${p.funder} — ${p.name}` : p.name));
  const blocked = Array.from(
    new Set([
      `${target.funder} — ${target.opportunity_name}`,
      ...otherFunders,
      ...priorFunders,
      ...pipelineFunders,
    ]),
  );

  const user = `Replace this funding opportunity.

# OPPORTUNITY TO REPLACE
Funder: ${target.funder}
Program: ${target.opportunity_name}
Funding type: ${target.funding_type}
Amount: ${target.funding_amount != null ? `$${target.funding_amount.toLocaleString()}` : 'variable'}
Primary venture: ${target.primary_venture}
Why it's currently surfaced: ${target.reason_for_match}

# BRIANA'S FEEDBACK
${feedback ? feedback : '(no specific feedback — surface a different angle / funding type / venture)'}

# DO NOT RE-SURFACE (pipeline, other scan leads, prior replacements)
${blocked.map((b) => `- ${b}`).join('\n')}

Today: ${todayIsoPT()}.

Return the replacement JSON wrapped between BEGIN_REPLACEMENT / END_REPLACEMENT markers.`;

  const result = await think({
    systemPrompt: system,
    userPrompt: user,
    maxTokens: 3000,
    webSearch: { maxUses: 12 },
  });

  const rawJson =
    extractJsonBlock(result.text, '<!-- BEGIN_REPLACEMENT -->', '<!-- END_REPLACEMENT -->') ??
    result.text;
  type Candidate = {
    opportunity_name?: string;
    funder?: string;
    funding_type?: FundingType;
    funding_amount?: number | null;
    application_deadline?: string | null;
    source_url?: string | null;
    ventures?: FundingVenture[];
    primary_venture?: FundingVenture;
    eligibility_criteria?: string;
    match_rating?: number;
    reason_for_match?: string;
    effort_estimate?: FundingEffort;
    effort_hours_low?: number;
    effort_hours_high?: number;
    fit_test?: FundingOpportunity['fit_test'];
    fit_score_out_of_six?: number;
    recommendation?: FundingOpportunity['recommendation'];
  };
  const parsed = tryParseJson<Candidate>(rawJson);
  if (!parsed?.opportunity_name || !parsed?.funder) {
    throw new Error('Replacement returned no valid opportunity.');
  }

  const replacement: FundingOpportunity = {
    opportunity_id: target.opportunity_id,
    opportunity_name: parsed.opportunity_name,
    funder: parsed.funder,
    funding_type: parsed.funding_type ?? 'Grant',
    funding_amount: parsed.funding_amount ?? null,
    application_deadline: parsed.application_deadline ?? null,
    source_url: parsed.source_url ?? null,
    ventures:
      Array.isArray(parsed.ventures) && parsed.ventures.length > 0
        ? parsed.ventures
        : ['Cross-venture'],
    primary_venture: parsed.primary_venture ?? (parsed.ventures?.[0] ?? 'Cross-venture'),
    eligibility_criteria: parsed.eligibility_criteria ?? '',
    match_rating: typeof parsed.match_rating === 'number' ? parsed.match_rating : 0,
    reason_for_match: parsed.reason_for_match ?? '',
    effort_estimate: parsed.effort_estimate ?? 'medium (2-8hr)',
    effort_hours_low: typeof parsed.effort_hours_low === 'number' ? parsed.effort_hours_low : null,
    effort_hours_high: typeof parsed.effort_hours_high === 'number' ? parsed.effort_hours_high : null,
    fit_test: parsed.fit_test ?? {
      non_dilutive: true,
      mission_alignment: true,
      eligibility: true,
      effort_to_reward: true,
      timeline: true,
      reputation: true,
    },
    fit_score_out_of_six: parsed.fit_score_out_of_six ?? 6,
    recommendation: parsed.recommendation ?? 'Apply',
    skip_reason: null,
    approved: false,
    skipped: false,
    feedback: null,
    notion_row_id: null,
    draft_output_id: null,
    replaced_at: new Date().toISOString(),
    previous_versions: [
      ...(target.previous_versions ?? []),
      {
        opportunity_name: target.opportunity_name,
        funder: target.funder,
        funding_type: target.funding_type,
        feedback: feedback || null,
        replaced_at: new Date().toISOString(),
      },
    ],
  };

  const nextScan: FundingOpportunityScan = {
    ...scan,
    opportunities: opportunities.map((o) =>
      o.opportunity_id === params.opportunityId ? replacement : o,
    ),
  };
  await db
    .from('approval_queue')
    .update({ full_output: nextScan as unknown as Record<string, unknown> })
    .eq('id', params.scanQueueItemId);
  if (item.agent_output_id) {
    await db
      .from('agent_outputs')
      .update({ draft_content: nextScan as unknown as Record<string, unknown> })
      .eq('id', item.agent_output_id);
  }

  return {
    opportunity: replacement,
    tokensUsed: result.inputTokens + result.outputTokens,
    costEstimate: result.costEstimate,
  };
}
