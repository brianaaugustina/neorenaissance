import {
  getApprovedOutputsByType,
  logOutput,
  setApprovalQueueId,
  updateOutputStatus,
  type ApprovedOutputExample,
} from '../agent-outputs';
import {
  createOutreachRow,
  getActiveOutreachRows,
  updateOutreachRow,
  type OutreachPipelineRow,
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
import { loadContextFile, think, type ThinkResult } from './base';

const AGENT_NAME = 'pr-director';
const VENTURE = 'trades-show';
const NOTION_VENTURE = 'The Trades Show';
const NOTION_OUTREACH_TYPE = 'Press';
const SEASON_TAG = 'Season 2';
const MODEL = process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-5';

const PRICE_IN_PER_MTOK = 3;
const PRICE_OUT_PER_MTOK = 15;

// ============================================================================
// Output types
// ============================================================================

export type OutletTier =
  | 'tier-1-sf-local'
  | 'tier-2-national-culture'
  | 'tier-3-food'
  | 'tier-4-craft-design'
  | 'tier-5-podcast-industry'
  | 'tier-6-career-founder';

export type VoiceMode = 'founder-first' | 'show-first' | 'hybrid';

export type PressPitchOutputType =
  | 'press_pitch_founder_first'
  | 'press_pitch_show_first'
  | 'press_pitch_hybrid';

export interface LandscapeBriefing {
  date: string;
  month_label: string;
  markdown: string;
}

export interface PressLead {
  lead_id: string;
  journalist_name: string;
  outlet: string;
  role: string | null;
  beat: string | null;
  contact_email: string | null;
  contact_linkedin: string | null;
  outlet_tier: OutletTier;
  fit_score: number; // 1–5
  fit_rationale: string;
  suggested_angle: string | null;
  suggested_voice_mode: VoiceMode;
  cultural_moment: string | null; // e.g. "cultural-slow-living-week" or null for evergreen
  episode_pairing: string | null;
  source_link: string | null;
  /** null when the contact can't be verified — flag for Briana instead of inventing one. */
  contact_flag: 'unverified-contact' | 'no-named-contact' | null;
  // Mutated at Gate 1:
  approved?: boolean;
  draft_output_id?: string | null;
  outreach_row_id?: string | null;
  skipped?: boolean;
  // Mutated on replace:
  replaced_at?: string;
  replacement_feedback?: string | null;
  previous_versions?: Array<{
    journalist_name: string;
    outlet: string;
    fit_score: number;
    fit_rationale: string;
    feedback: string | null;
    replaced_at: string;
  }>;
}

export interface PressResearchBatch {
  total_reviewed: number;
  surfaced_count: number;
  surfaced_at: string;
  season: string;
  landscape_briefing_date: string | null;
  leads: PressLead[];
  candidates_not_surfaced: Array<{
    journalist_name: string;
    outlet: string;
    fit_score: number;
    skip_reason: string;
  }>;
}

export interface PressPitchDraft {
  lead_id: string;
  parent_batch_output_id: string | null;
  journalist_name: string;
  outlet: string;
  contact_email: string | null;
  touch_number: 1 | 2 | 3;
  voice_mode: VoiceMode;
  subject: string;
  body: string;
  angle_used: string | null;
  episode_pairing: string | null;
  outreach_row_id: string | null;
}

// ============================================================================
// Context assembly
// ============================================================================

function loadPrContextFiles(): string {
  return [
    loadContextFile('system.md'),
    loadContextFile('ventures/trades-show.md'),
    loadContextFile('agents/pr-director/system-prompt.md'),
    loadContextFile('agents/pr-director/voice.md'),
    loadContextFile('agents/pr-director/playbook.md'),
    loadContextFile('shared/conflicts.md'),
  ]
    .filter(Boolean)
    .join('\n\n---\n\n');
}

function renderPipelineContext(rows: OutreachPipelineRow[]): string {
  if (!rows.length) return '(no existing press outreach in pipeline)';
  return rows
    .map((r) => {
      const brand = r.organization ?? r.name;
      const fit = r.fitScore != null ? ` fit=${r.fitScore}` : '';
      return `- ${brand} [${r.status ?? 'no status'}${fit}${r.season ? ` · ${r.season}` : ''}]`;
    })
    .join('\n');
}

function renderExemplars(
  label: string,
  examples: ApprovedOutputExample[],
  maxChars = 700,
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
  return `\n\n# Past approved ${label} — reference only, do NOT copy\nUse these to understand what "good" looks like. Write fresh work in the same voice.\n\n${blocks.join('\n\n')}`;
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
  return `\n\n# RECENT FEEDBACK (last 14 days)\nBriana's corrections on past PR Director output. Apply to this run.\n${body}`;
}

// ============================================================================
// JSON extraction helpers (same shape as Sponsorship Director)
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
// Monthly editorial landscape briefing
// ============================================================================

const LANDSCAPE_SYSTEM_INSTRUCTIONS = `
You are producing the monthly editorial landscape briefing for PR Director.

This briefing is read for context by the next four weekly research runs. It
does NOT generate pitches. It does NOT surface leads. Its job is to give
future research runs a current view of where pitches will land best.

# Output format (strict — no JSON envelope)

Return clean markdown with these four H2 sections in order:

## Editorial calendars (next 60 days)
For each tracked outlet, what themes/issues are publishing and when.
Include submission deadlines where known. If an outlet has nothing
notable, skip it. Terse — one line per outlet-issue pairing.

## Cultural moments + observance dates
Slow Living Week, AAPI Heritage Month, gift guide season, awards season,
craft/SF/trades anniversaries — anything in the next 60 days that a
pitch could naturally tie into. Date + one-line note per moment.

## Trending narratives
What's being written about right now in craft, SF, AI/tech, slow living,
food/heritage. 3–5 narrative threads max. Qualitative, short.

## Milestone alignment opportunities
Concrete pairings where a known Trades Show event/episode lines up with
a cultural moment. Example: "Stuart Brioza episode airs week of [date],
which falls in Slow Living Week — natural angle for food/culture
outlets."

# Rules
- No fluff. Scannable in 2-3 minutes total.
- If a section has nothing meaningful this month, say so briefly and keep it short.
- All dates in Pacific Time.
- No JSON markers, no code fences around the markdown.

Return ONLY the markdown body. No preamble.
`.trim();

export interface RunLandscapeResult {
  runId: string;
  outputId: string;
  briefing: LandscapeBriefing;
  tokensUsed: number;
  costEstimate: number;
}

export async function runEditorialLandscapeBriefing(
  trigger: 'cron' | 'manual' = 'cron',
): Promise<RunLandscapeResult> {
  const run = await logRunStart(AGENT_NAME, trigger);
  try {
    const permanentPreferences = await getPermanentPreferences(AGENT_NAME).catch(
      () => [] as string[],
    );
    const memoryBlock = permanentPreferences.length
      ? '\n\n# Permanent preferences (apply every run)\n' +
        permanentPreferences.map((r) => `- ${r}`).join('\n')
      : '';

    const system =
      loadPrContextFiles() + memoryBlock + '\n\n---\n\n' + LANDSCAPE_SYSTEM_INSTRUCTIONS;

    const now = new Date();
    const monthLabel = now.toLocaleDateString('en-US', {
      timeZone: 'America/Los_Angeles',
      month: 'long',
      year: 'numeric',
    });

    const user = `Produce the editorial landscape briefing for ${monthLabel}.
Today is ${todayIsoPT()}. Season: ${SEASON_TAG}.

Scan the next 60 calendar days. Cover editorial calendars for the Tier 1-6
outlets named in the playbook. Flag cultural moments, trending narratives,
and concrete milestone alignments with current Season 2 episodes.`;

    const result = await think({
      systemPrompt: system,
      userPrompt: user,
      maxTokens: 3500,
    });

    const today = todayIsoPT();
    const briefing: LandscapeBriefing = {
      date: today,
      month_label: monthLabel,
      markdown: result.text.trim(),
    };

    const outputId = await logOutput({
      agentId: 'pr-director',
      venture: 'trades-show',
      outputType: 'editorial_landscape_briefing',
      runId: run.id,
      draftContent: briefing as unknown as Record<string, unknown>,
      tags: ['monthly-landscape', today, monthLabel.toLowerCase().replace(/\s+/g, '-')],
    });

    // Landscape briefing is read-only — no approval queue item, no Notion.
    // Mark the output as approved so it behaves as a published reference and
    // retrieval helpers that filter on approved_at will find it.
    await updateOutputStatus({
      outputId,
      status: 'approved',
      finalContent: briefing as unknown as Record<string, unknown>,
    });

    await logRunComplete({
      runId: run.id,
      startedAt: run.started_at,
      status: 'success',
      tokensUsed: result.inputTokens + result.outputTokens,
      model: MODEL,
      contextSummary: `landscape ${monthLabel}`,
      outputSummary: `Landscape briefing for ${monthLabel}`,
      costEstimate: Number(result.costEstimate.toFixed(4)),
    });

    return {
      runId: run.id,
      outputId,
      briefing,
      tokensUsed: result.inputTokens + result.outputTokens,
      costEstimate: result.costEstimate,
    };
  } catch (e: unknown) {
    await logRunComplete({
      runId: run.id,
      startedAt: run.started_at,
      status: 'error',
      model: MODEL,
      error: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}

// Fetch the latest approved landscape briefing for inclusion in research runs
// + for the dashboard landscape page.
export async function getLatestLandscapeBriefing(): Promise<
  | { id: string; created_at: string; briefing: LandscapeBriefing }
  | null
> {
  const { data, error } = await supabaseAdmin()
    .from('agent_outputs')
    .select('id, created_at, draft_content, final_content')
    .eq('agent_id', 'pr-director')
    .eq('output_type', 'editorial_landscape_briefing')
    .in('approval_status', ['approved', 'pending'])
    .order('created_at', { ascending: false })
    .limit(1);
  if (error || !data || !data.length) return null;
  const row = data[0];
  const content = (row.final_content ?? row.draft_content) as LandscapeBriefing;
  return { id: row.id, created_at: row.created_at, briefing: content };
}

export async function listRecentLandscapeBriefings(
  limit = 12,
): Promise<
  Array<{ id: string; created_at: string; month_label: string; date: string }>
> {
  const { data, error } = await supabaseAdmin()
    .from('agent_outputs')
    .select('id, created_at, draft_content')
    .eq('agent_id', 'pr-director')
    .eq('output_type', 'editorial_landscape_briefing')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return [];
  return (data ?? []).map((row) => {
    const b = (row.draft_content ?? {}) as Partial<LandscapeBriefing>;
    return {
      id: row.id,
      created_at: row.created_at,
      month_label: b.month_label ?? '(untitled)',
      date: b.date ?? row.created_at.slice(0, 10),
    };
  });
}

// ============================================================================
// Weekly press research batch
// ============================================================================

const RESEARCH_SYSTEM_INSTRUCTIONS = `
You are running the weekly PR Director press research scan.

Evaluate each candidate against the personalization minimums in playbook §4.
Candidates scoring below 3/5 MUST NOT appear in the surfaced list.

# Output format (strict JSON, no commentary)

<!-- BEGIN_RESEARCH -->
{
  "reviewed": [
    {
      "journalist_name": "string",
      "outlet": "string",
      "role": "string or null",
      "beat": "string or null",
      "contact_email": "string or null",
      "contact_linkedin": "string or null",
      "contact_flag": "unverified-contact" | "no-named-contact" | null,
      "outlet_tier": "tier-1-sf-local" | "tier-2-national-culture" | "tier-3-food" | "tier-4-craft-design" | "tier-5-podcast-industry" | "tier-6-career-founder",
      "fit_score": 1-5 (integer),
      "passes_threshold": true | false,
      "fit_rationale": "one concrete sentence",
      "suggested_angle": "string (e.g. angle-1-going-analog, angle-2-what-ai-cant-learn, angle-3-oldest-trades-newest-city, angle-5-disappearing-trades, angle-6-gen-z-trades, angle-7-ecosystem, angle-8-ai-in-service-of-trades, angle-9-episode-specific)",
      "suggested_voice_mode": "founder-first" | "show-first" | "hybrid",
      "cultural_moment": "string from landscape briefing (e.g. cultural-slow-living-week) or null if evergreen",
      "episode_pairing": "string (e.g. 'Stuart Brioza' / 'Elias Sideris' / 'Season arc') or null",
      "source_link": "URL to a recent piece by them within 90 days, or null if unverified"
    }
  ]
}
<!-- END_RESEARCH -->

# Rules
- Return 15-30 candidates total across all tiers. The code will cap the
  surfaced list at 10 and use your count as the "reviewed" total.
- Never include a journalist in the conflicts list.
- Never include an outlet already in the active pipeline below.
- NEVER re-pitch Matt Haber @ The Gazetteer — warm thread (see playbook §1).
- If a journalist's role isn't verifiable within 90 days, set contact_flag
  to "unverified-contact" and leave contact fields null.
- fit_rationale must be concrete — "SF-first lens + future-of-work coverage"
  beats "great fit."
- Voice mode selection (playbook §voice file): founder-first for SF local
  + verifiable personal moments; show-first for national + trade press;
  hybrid rare, only for specific warm signals to national outlets.
- If cultural_moment is set, it MUST match a moment from the landscape
  briefing below. Don't invent cultural tags.

Return ONLY the wrapped JSON. No prose.
`.trim();

export interface RunResearchResult {
  runId: string;
  queueId: string;
  outputId: string;
  batch: PressResearchBatch;
  tokensUsed: number;
  costEstimate: number;
}

export async function runPressResearch(
  trigger: 'cron' | 'manual' = 'cron',
): Promise<RunResearchResult> {
  const run = await logRunStart(AGENT_NAME, trigger);
  try {
    const [permanentPreferences, recentFeedback, pitchExemplars, pipeline, landscape] =
      await Promise.all([
        getPermanentPreferences(AGENT_NAME).catch(() => [] as string[]),
        getRecentFeedback(AGENT_NAME, 24 * 14, ['report']).catch(
          () => [] as RecentFeedbackItem[],
        ),
        getApprovedOutputsByType({
          agentId: 'pr-director',
          venture: 'trades-show',
          outputType: 'press_pitch_founder_first',
          limit: 3,
          requireFinalContent: true,
        }).catch(() => [] as ApprovedOutputExample[]),
        getActiveOutreachRows(NOTION_OUTREACH_TYPE, NOTION_VENTURE).catch(
          () => [] as OutreachPipelineRow[],
        ),
        getLatestLandscapeBriefing().catch(() => null),
      ]);

    const memoryBlock = permanentPreferences.length
      ? '\n\n# Permanent preferences (apply every run)\n' +
        permanentPreferences.map((r) => `- ${r}`).join('\n')
      : '';

    const landscapeBlock = landscape?.briefing.markdown
      ? `\n\n---\n\n# Current editorial landscape briefing (${landscape.briefing.month_label} · dated ${landscape.briefing.date})\nUse cultural moments and milestone alignments from this when tagging leads. Only reference cultural moments that appear here.\n\n${landscape.briefing.markdown}`
      : `\n\n# Landscape briefing\n(none available — first run or monthly cron hasn't fired. Proceed with evergreen angles.)`;

    const system =
      loadPrContextFiles() +
      memoryBlock +
      renderExemplars('press pitches', pitchExemplars) +
      renderRecentFeedback(recentFeedback) +
      landscapeBlock +
      '\n\n---\n\n' +
      RESEARCH_SYSTEM_INSTRUCTIONS;

    const user = `Today is ${todayIsoPT()}.
Season context: ${SEASON_TAG}.

# ACTIVE PIPELINE (already in flight — do NOT re-surface these outlets/journalists)
${renderPipelineContext(pipeline)}

# TASK
Produce the weekly press research batch per the instructions above. Aim for
15-30 scored candidates. Only journalists that pass the fit test (>=3)
should be surfaced. Return the JSON wrapped between BEGIN_RESEARCH /
END_RESEARCH markers.`;

    const result = await think({
      systemPrompt: system,
      userPrompt: user,
      maxTokens: 7000,
    });

    const rawJson =
      extractJsonBlock(result.text, '<!-- BEGIN_RESEARCH -->', '<!-- END_RESEARCH -->') ??
      result.text;
    type Reviewed = {
      journalist_name: string;
      outlet: string;
      role?: string | null;
      beat?: string | null;
      contact_email?: string | null;
      contact_linkedin?: string | null;
      contact_flag?: 'unverified-contact' | 'no-named-contact' | null;
      outlet_tier?: OutletTier;
      fit_score?: number;
      passes_threshold?: boolean;
      fit_rationale?: string;
      suggested_angle?: string | null;
      suggested_voice_mode?: VoiceMode;
      cultural_moment?: string | null;
      episode_pairing?: string | null;
      source_link?: string | null;
    };
    const parsed = tryParseJson<{ reviewed?: Reviewed[] }>(rawJson);
    const reviewed = Array.isArray(parsed?.reviewed) ? parsed!.reviewed : [];

    const passing = reviewed.filter(
      (r) =>
        typeof r.fit_score === 'number' &&
        r.fit_score >= 3 &&
        r.journalist_name &&
        r.outlet,
    );
    passing.sort((a, b) => (b.fit_score ?? 0) - (a.fit_score ?? 0));
    const surfaced: PressLead[] = passing.slice(0, 10).map((r, i) => ({
      lead_id: `lead_${i}`,
      journalist_name: r.journalist_name,
      outlet: r.outlet,
      role: r.role ?? null,
      beat: r.beat ?? null,
      contact_email: r.contact_email ?? null,
      contact_linkedin: r.contact_linkedin ?? null,
      contact_flag: r.contact_flag ?? null,
      outlet_tier: (r.outlet_tier as OutletTier) ?? 'tier-2-national-culture',
      fit_score: r.fit_score ?? 3,
      fit_rationale: r.fit_rationale ?? '',
      suggested_angle: r.suggested_angle ?? null,
      suggested_voice_mode: r.suggested_voice_mode ?? 'show-first',
      cultural_moment: r.cultural_moment ?? null,
      episode_pairing: r.episode_pairing ?? null,
      source_link: r.source_link ?? null,
      approved: false,
      draft_output_id: null,
      outreach_row_id: null,
      skipped: false,
    }));

    const notSurfaced = reviewed
      .filter((r) => typeof r.fit_score === 'number' && r.fit_score < 3)
      .slice(0, 20)
      .map((r) => ({
        journalist_name: r.journalist_name,
        outlet: r.outlet,
        fit_score: r.fit_score ?? 0,
        skip_reason: r.fit_rationale ?? '(no reason given)',
      }));

    const batch: PressResearchBatch = {
      total_reviewed: reviewed.length,
      surfaced_count: surfaced.length,
      surfaced_at: new Date().toISOString(),
      season: SEASON_TAG,
      landscape_briefing_date: landscape?.briefing.date ?? null,
      leads: surfaced,
      candidates_not_surfaced: notSurfaced,
    };

    const summary =
      surfaced.length > 0
        ? `Reviewed ${reviewed.length}, surfacing ${surfaced.length}${landscape ? ` (landscape ${landscape.briefing.date})` : ''}`
        : `Reviewed ${reviewed.length}, nothing passed fit threshold`;

    const outputId = await logOutput({
      agentId: 'pr-director',
      venture: 'trades-show',
      outputType: 'press_research',
      runId: run.id,
      draftContent: batch as unknown as Record<string, unknown>,
      tags: ['weekly-research', todayIsoPT(), SEASON_TAG.toLowerCase().replace(/\s+/g, '-')],
    });

    const queueId = await depositToQueue({
      agent_name: AGENT_NAME,
      type: 'report',
      title: `Press research — ${todayIsoPT()} (${surfaced.length} leads)`,
      summary,
      full_output: batch as unknown as Record<string, unknown>,
      initiative: 'The Trades Show',
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
      contextSummary: `pipeline=${pipeline.length} reviewed=${reviewed.length} surfaced=${surfaced.length} landscape=${landscape ? 'loaded' : 'missing'}`,
      outputSummary: summary,
      approvalQueueId: queueId,
      costEstimate: Number(result.costEstimate.toFixed(4)),
    });

    return {
      runId: run.id,
      queueId,
      outputId,
      batch,
      tokensUsed: result.inputTokens + result.outputTokens,
      costEstimate: result.costEstimate,
    };
  } catch (e: unknown) {
    await logRunComplete({
      runId: run.id,
      startedAt: run.started_at,
      status: 'error',
      model: MODEL,
      error: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}

// ============================================================================
// Press pitch draft — per-lead at Gate 1
// ============================================================================

function voiceModeToOutputType(voice: VoiceMode): PressPitchOutputType {
  switch (voice) {
    case 'founder-first':
      return 'press_pitch_founder_first';
    case 'show-first':
      return 'press_pitch_show_first';
    case 'hybrid':
      return 'press_pitch_hybrid';
  }
}

const PITCH_SYSTEM_INSTRUCTIONS = `
You are drafting a single Touch 1 cold press pitch for PR Director.

Apply every rule in the voice file exemplars (A-E for cold; F-J for
follow-up/specialty) and every item in the personalization minimums
checklist from playbook §4. Clear all items on the pre-send checklist
before returning.

# Voice mode
The suggested voice mode comes with the lead. Apply it unless the context
genuinely warrants an override. Never fabricate a personal moment — if
founder-first would require inventing warmth, downgrade to show-first.

# Output format (strict JSON, no commentary)

<!-- BEGIN_PITCH -->
{
  "subject": "specific subject line per voice patterns",
  "body": "the full email body in plain text, starting with 'Hi [First name],' and ending with the signature line 'Warmly + with gratitude, Briana' or 'Warmly, Briana' — no HTML, no markdown",
  "voice_mode_used": "founder-first" | "show-first" | "hybrid",
  "angle_used": "string matching the suggested_angle tag or a different one you chose, e.g. angle-1-going-analog"
}
<!-- END_PITCH -->

# Non-negotiables
- Subject line references the journalist or outlet specifically.
- Cold pitch body is 150-250 words.
- Opens with either a specific verified observation (founder-first) or a
  specific story hook (show-first). NEVER invent a personal moment.
- References one specific thing about their work or beat — a piece, a
  section, a topic they've covered in the last 90 days.
- One link max in body (press deck attached separately, NOT linked in body).
- Names 1-2 specific Season 2 artisans with trade + studio/brand.
- Ask is low-pressure: coffee / conversation / section fit — never "please
  write about me."
- Sign-off is "Warmly + with gratitude, Briana" or "Warmly, Briana".
- NO cobbler story in opener. NO AI tension for craft-only outlets
  (tier-4-craft-design). NO inflated metrics.

Return ONLY the wrapped JSON. No preamble.
`.trim();

export interface GenerateLeadPitchParams {
  lead: PressLead;
  parentBatchOutputId: string;
  parentQueueItemId: string;
}

export interface GenerateLeadPitchResult {
  outputId: string;
  queueId: string;
  outreachRowId: string;
  draft: PressPitchDraft;
  tokensUsed: number;
  costEstimate: number;
}

export async function generateLeadPitch(
  params: GenerateLeadPitchParams,
): Promise<GenerateLeadPitchResult> {
  const { lead, parentBatchOutputId, parentQueueItemId } = params;
  const run = await logRunStart(AGENT_NAME, 'manual');
  try {
    const pitchType = voiceModeToOutputType(lead.suggested_voice_mode);
    const [permanentPreferences, recentFeedback, pitchExemplars] = await Promise.all([
      getPermanentPreferences(AGENT_NAME).catch(() => [] as string[]),
      getRecentFeedback(AGENT_NAME, 24 * 14, ['draft']).catch(
        () => [] as RecentFeedbackItem[],
      ),
      getApprovedOutputsByType({
        agentId: 'pr-director',
        venture: 'trades-show',
        outputType: pitchType,
        limit: 5,
        requireFinalContent: true,
      }).catch(() => [] as ApprovedOutputExample[]),
    ]);

    const memoryBlock = permanentPreferences.length
      ? '\n\n# Permanent preferences (apply every run)\n' +
        permanentPreferences.map((r) => `- ${r}`).join('\n')
      : '';

    const system =
      loadPrContextFiles() +
      memoryBlock +
      renderExemplars(`${lead.suggested_voice_mode} pitches`, pitchExemplars) +
      renderRecentFeedback(recentFeedback) +
      '\n\n---\n\n' +
      PITCH_SYSTEM_INSTRUCTIONS;

    const contactBlock = lead.journalist_name
      ? `Journalist: ${lead.journalist_name}${lead.role ? ` (${lead.role})` : ''}${lead.contact_email ? ` · ${lead.contact_email}` : ''}`
      : `(no contact verified — use "[First name]" placeholder for now)`;

    const user = `Draft a Touch 1 cold press pitch for this lead.

# LEAD
Journalist: ${lead.journalist_name}
Outlet: ${lead.outlet}
Role / beat: ${lead.role ?? '(unknown)'} / ${lead.beat ?? '(unknown)'}
Tier: ${lead.outlet_tier}
Fit score: ${lead.fit_score}/5
${contactBlock}
Suggested angle: ${lead.suggested_angle ?? '(none — pick the best from the angle inventory)'}
Suggested voice mode: ${lead.suggested_voice_mode}
Episode pairing: ${lead.episode_pairing ?? '(none — season arc default)'}
Cultural moment: ${lead.cultural_moment ?? '(evergreen)'}
Why they fit: ${lead.fit_rationale}
${lead.source_link ? `Recent piece reference: ${lead.source_link}` : ''}

Today: ${todayIsoPT()}. Season: ${SEASON_TAG}.

Produce ONLY the JSON wrapped between BEGIN_PITCH / END_PITCH markers.`;

    const result = await think({
      systemPrompt: system,
      userPrompt: user,
      maxTokens: 2500,
    });

    const rawJson =
      extractJsonBlock(result.text, '<!-- BEGIN_PITCH -->', '<!-- END_PITCH -->') ??
      result.text;
    const parsed = tryParseJson<{
      subject?: string;
      body?: string;
      voice_mode_used?: VoiceMode;
      angle_used?: string;
    }>(rawJson);

    const draft: PressPitchDraft = {
      lead_id: lead.lead_id,
      parent_batch_output_id: parentBatchOutputId,
      journalist_name: lead.journalist_name,
      outlet: lead.outlet,
      contact_email: lead.contact_email,
      touch_number: 1,
      voice_mode: parsed?.voice_mode_used ?? lead.suggested_voice_mode,
      subject: parsed?.subject?.trim() ?? `A note for ${lead.outlet}`,
      body: parsed?.body?.trim() ?? result.text.trim(),
      angle_used: parsed?.angle_used ?? lead.suggested_angle,
      episode_pairing: lead.episode_pairing,
      outreach_row_id: null,
    };

    // Notion Outreach row — writes on draft creation per PR spec, using mapped
    // statuses per Briana's decision: draft_pending_approval → Pending Approval.
    let outreachRowId = '';
    try {
      outreachRowId = await createOutreachRow({
        name: `${lead.outlet} — Touch 1`,
        outreachType: NOTION_OUTREACH_TYPE,
        venture: NOTION_VENTURE,
        status: 'Pending Approval',
        source: 'Claude',
        season: SEASON_TAG,
        organization: lead.outlet,
        contactName: lead.journalist_name,
        contactEmail: lead.contact_email ?? undefined,
        contactLinkedin: lead.contact_linkedin ?? undefined,
        fitScore: lead.fit_score,
        whyFit: lead.fit_rationale,
        draftMessage: `Subject: ${draft.subject}\n\n${draft.body}`,
      });
      draft.outreach_row_id = outreachRowId;
    } catch (notionErr) {
      console.error('PR: Notion Outreach write failed (non-fatal):', notionErr);
    }

    const pitchTypeTag = pitchType;
    const outputId = await logOutput({
      agentId: 'pr-director',
      venture: 'trades-show',
      outputType: pitchType,
      runId: run.id,
      parentOutputId: parentBatchOutputId,
      draftContent: draft as unknown as Record<string, unknown>,
      tags: [
        'touch-1',
        draft.voice_mode,
        lead.outlet_tier,
        ...(draft.angle_used ? [draft.angle_used] : []),
        ...(lead.cultural_moment ? [lead.cultural_moment] : []),
        ...(lead.episode_pairing
          ? [`paired-${lead.episode_pairing.toLowerCase().replace(/\s+/g, '-')}`]
          : []),
        pitchTypeTag,
      ],
    });

    const queueId = await depositToQueue({
      agent_name: AGENT_NAME,
      type: 'draft',
      title: `Press pitch — ${lead.outlet}${lead.journalist_name ? ` (${lead.journalist_name})` : ''}`,
      summary: draft.subject,
      full_output: draft as unknown as Record<string, unknown>,
      initiative: 'The Trades Show',
      run_id: run.id,
      agent_output_id: outputId,
    });
    await setApprovalQueueId(outputId, queueId);

    await markLeadApproved({
      parentQueueItemId,
      leadId: lead.lead_id,
      draftOutputId: outputId,
      outreachRowId: outreachRowId || null,
    });

    await logRunComplete({
      runId: run.id,
      startedAt: run.started_at,
      status: 'success',
      tokensUsed: result.inputTokens + result.outputTokens,
      model: MODEL,
      contextSummary: `lead=${lead.outlet}/${lead.journalist_name} tier=${lead.outlet_tier} voice=${draft.voice_mode}`,
      outputSummary: `Press pitch for ${lead.outlet}`,
      approvalQueueId: queueId,
      costEstimate: Number(result.costEstimate.toFixed(4)),
    });

    return {
      outputId,
      queueId,
      outreachRowId,
      draft,
      tokensUsed: result.inputTokens + result.outputTokens,
      costEstimate: result.costEstimate,
    };
  } catch (e: unknown) {
    await logRunComplete({
      runId: run.id,
      startedAt: run.started_at,
      status: 'error',
      model: MODEL,
      error: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}

async function markLeadApproved(params: {
  parentQueueItemId: string;
  leadId: string;
  draftOutputId: string;
  outreachRowId: string | null;
}): Promise<void> {
  const db = supabaseAdmin();
  const { data: item } = await db
    .from('approval_queue')
    .select('full_output, agent_output_id')
    .eq('id', params.parentQueueItemId)
    .single();
  if (!item) return;

  const fullOutput = (item.full_output ?? {}) as PressResearchBatch;
  const leads = Array.isArray(fullOutput.leads) ? fullOutput.leads : [];
  const updatedLeads = leads.map((l) =>
    l.lead_id === params.leadId
      ? {
          ...l,
          approved: true,
          draft_output_id: params.draftOutputId,
          outreach_row_id: params.outreachRowId,
        }
      : l,
  );
  await db
    .from('approval_queue')
    .update({ full_output: { ...fullOutput, leads: updatedLeads } })
    .eq('id', params.parentQueueItemId);
  if (item.agent_output_id) {
    await db
      .from('agent_outputs')
      .update({ draft_content: { ...fullOutput, leads: updatedLeads } })
      .eq('id', item.agent_output_id);
  }
}

// ============================================================================
// Gate 2 hook — called from queue status route on pitch approve/reject
// ============================================================================

export async function onPressPitchApproval(params: {
  queueItemAgentOutputId: string;
  status: 'approved' | 'rejected';
  feedback?: string;
  finalBody?: string;
}): Promise<boolean> {
  const db = supabaseAdmin();
  const { data: out, error } = await db
    .from('agent_outputs')
    .select('draft_content, agent_id, output_type')
    .eq('id', params.queueItemAgentOutputId)
    .single();
  if (error || !out) return false;
  if (
    out.agent_id !== 'pr-director' ||
    !['press_pitch_founder_first', 'press_pitch_show_first', 'press_pitch_hybrid'].includes(
      out.output_type,
    )
  ) {
    return false;
  }

  const draft = (out.draft_content ?? {}) as PressPitchDraft;
  const rowId = draft.outreach_row_id;
  if (!rowId) return true;

  try {
    if (params.status === 'approved') {
      await updateOutreachRow(rowId, {
        status: 'Approved',
        draftMessage: params.finalBody
          ? `Subject: ${draft.subject}\n\n${params.finalBody}`
          : undefined,
      });
    } else {
      await updateOutreachRow(rowId, { status: 'Pass' });
    }
  } catch (e) {
    console.error('PR Outreach status update failed:', e);
  }
  return true;
}

// ============================================================================
// Per-lead replace (same pattern as Sponsorship Director)
// ============================================================================

const REPLACE_SYSTEM_INSTRUCTIONS = `
You are replacing ONE press research lead for The Trades Show.

The lead being replaced plus Briana's feedback (if any) is below. Return
exactly ONE new candidate that scores 3+ on the fit test. Avoid every
outlet/journalist listed in "do not re-surface" in the prompt.

# Output format (strict JSON)

<!-- BEGIN_REPLACEMENT -->
{
  "journalist_name": "string",
  "outlet": "string",
  "role": "string or null",
  "beat": "string or null",
  "contact_email": "string or null",
  "contact_linkedin": "string or null",
  "contact_flag": "unverified-contact" | "no-named-contact" | null,
  "outlet_tier": "tier-1-sf-local" | "tier-2-national-culture" | "tier-3-food" | "tier-4-craft-design" | "tier-5-podcast-industry" | "tier-6-career-founder",
  "fit_score": 3-5 (integer — must pass threshold),
  "fit_rationale": "one concrete sentence",
  "suggested_angle": "string from the angle inventory",
  "suggested_voice_mode": "founder-first" | "show-first" | "hybrid",
  "cultural_moment": "string or null",
  "episode_pairing": "string or null",
  "source_link": "URL or null"
}
<!-- END_REPLACEMENT -->

# Rules
- fit_score must be >=3.
- Never re-surface a journalist/outlet on the "do not re-surface" list.
- Never re-surface Matt Haber @ The Gazetteer (warm pipeline).
- If feedback names a concern (outlet type, tier, cultural tag,
  geographic preference), the replacement must directly address it.
- If feedback is empty, surface a candidate with a notably distinct
  angle from the one being replaced.

Return ONLY the wrapped JSON.
`.trim();

export interface ReplaceLeadParams {
  batch: PressResearchBatch;
  leadId: string;
  feedback?: string;
  parentQueueItemId: string;
  parentOutputId: string;
}

export interface ReplaceLeadResult {
  lead: PressLead;
  tokensUsed: number;
  costEstimate: number;
}

export async function replaceLead(
  params: ReplaceLeadParams,
): Promise<ReplaceLeadResult> {
  const { batch, leadId, parentQueueItemId, parentOutputId } = params;
  const feedback = (params.feedback ?? '').trim();

  const leadToReplace = batch.leads.find((l) => l.lead_id === leadId);
  if (!leadToReplace) throw new Error(`Lead ${leadId} not found in batch`);
  if (leadToReplace.approved) {
    throw new Error(`Lead ${leadId} already approved — cannot replace`);
  }

  const [permanentPreferences, recentFeedback, pitchExemplars, pipeline, landscape] =
    await Promise.all([
      getPermanentPreferences(AGENT_NAME).catch(() => [] as string[]),
      getRecentFeedback(AGENT_NAME, 24 * 14, ['report']).catch(
        () => [] as RecentFeedbackItem[],
      ),
      getApprovedOutputsByType({
        agentId: 'pr-director',
        venture: 'trades-show',
        outputType: 'press_pitch_founder_first',
        limit: 3,
        requireFinalContent: true,
      }).catch(() => [] as ApprovedOutputExample[]),
      getActiveOutreachRows(NOTION_OUTREACH_TYPE, NOTION_VENTURE).catch(
        () => [] as OutreachPipelineRow[],
      ),
      getLatestLandscapeBriefing().catch(() => null),
    ]);

  const memoryBlock = permanentPreferences.length
    ? '\n\n# Permanent preferences (apply every run)\n' +
      permanentPreferences.map((r) => `- ${r}`).join('\n')
    : '';

  const landscapeBlock = landscape?.briefing.markdown
    ? `\n\n---\n\n# Editorial landscape context (${landscape.briefing.month_label} · ${landscape.briefing.date})\n${landscape.briefing.markdown}`
    : '';

  const system =
    loadPrContextFiles() +
    memoryBlock +
    renderExemplars('press pitches', pitchExemplars) +
    renderRecentFeedback(recentFeedback) +
    landscapeBlock +
    '\n\n---\n\n' +
    REPLACE_SYSTEM_INSTRUCTIONS;

  const otherKeys = batch.leads
    .filter((l) => l.lead_id !== leadId)
    .map((l) => `${l.journalist_name} @ ${l.outlet}`);
  const priorKeys = (leadToReplace.previous_versions ?? []).map(
    (v) => `${v.journalist_name} @ ${v.outlet}`,
  );
  const pipelineKeys = pipeline
    .map((p) => p.organization ?? p.name)
    .filter(Boolean) as string[];
  const blocked = Array.from(
    new Set([
      `${leadToReplace.journalist_name} @ ${leadToReplace.outlet}`,
      ...otherKeys,
      ...priorKeys,
      ...pipelineKeys,
      'Matt Haber @ The Gazetteer',
    ]),
  );

  const user = `Replace this press lead.

# LEAD TO REPLACE
Journalist: ${leadToReplace.journalist_name}
Outlet: ${leadToReplace.outlet}
Tier: ${leadToReplace.outlet_tier}
Fit score: ${leadToReplace.fit_score}/5
Rationale: ${leadToReplace.fit_rationale}
${leadToReplace.suggested_angle ? `Angle: ${leadToReplace.suggested_angle}` : ''}

# BRIANA'S FEEDBACK
${feedback ? feedback : '(no specific feedback — surface a strong candidate with a different angle)'}

# DO NOT RE-SURFACE (duplicates, pipeline, prior replacements, warm threads)
${blocked.map((b) => `- ${b}`).join('\n')}

Today: ${todayIsoPT()}. Season: ${SEASON_TAG}.

Return the replacement JSON wrapped between BEGIN_REPLACEMENT /
END_REPLACEMENT markers.`;

  const result = await think({
    systemPrompt: system,
    userPrompt: user,
    maxTokens: 1800,
  });

  const rawJson =
    extractJsonBlock(result.text, '<!-- BEGIN_REPLACEMENT -->', '<!-- END_REPLACEMENT -->') ??
    result.text;
  type Candidate = {
    journalist_name?: string;
    outlet?: string;
    role?: string | null;
    beat?: string | null;
    contact_email?: string | null;
    contact_linkedin?: string | null;
    contact_flag?: 'unverified-contact' | 'no-named-contact' | null;
    outlet_tier?: OutletTier;
    fit_score?: number;
    fit_rationale?: string;
    suggested_angle?: string | null;
    suggested_voice_mode?: VoiceMode;
    cultural_moment?: string | null;
    episode_pairing?: string | null;
    source_link?: string | null;
  };
  const parsed = tryParseJson<Candidate>(rawJson);
  if (!parsed?.journalist_name || !parsed?.outlet) {
    throw new Error('Replacement returned no valid candidate — try again or edit feedback.');
  }

  const fitScore = typeof parsed.fit_score === 'number' ? parsed.fit_score : 3;
  const replacement: PressLead = {
    lead_id: leadToReplace.lead_id,
    journalist_name: parsed.journalist_name,
    outlet: parsed.outlet,
    role: parsed.role ?? null,
    beat: parsed.beat ?? null,
    contact_email: parsed.contact_email ?? null,
    contact_linkedin: parsed.contact_linkedin ?? null,
    contact_flag: parsed.contact_flag ?? null,
    outlet_tier: (parsed.outlet_tier as OutletTier) ?? 'tier-2-national-culture',
    fit_score: fitScore < 3 ? 3 : fitScore,
    fit_rationale: parsed.fit_rationale ?? '',
    suggested_angle: parsed.suggested_angle ?? null,
    suggested_voice_mode: parsed.suggested_voice_mode ?? 'show-first',
    cultural_moment: parsed.cultural_moment ?? null,
    episode_pairing: parsed.episode_pairing ?? null,
    source_link: parsed.source_link ?? null,
    approved: false,
    draft_output_id: null,
    outreach_row_id: null,
    skipped: false,
    replaced_at: new Date().toISOString(),
    replacement_feedback: feedback || null,
    previous_versions: [
      ...(leadToReplace.previous_versions ?? []),
      {
        journalist_name: leadToReplace.journalist_name,
        outlet: leadToReplace.outlet,
        fit_score: leadToReplace.fit_score,
        fit_rationale: leadToReplace.fit_rationale,
        feedback: feedback || null,
        replaced_at: new Date().toISOString(),
      },
    ],
  };

  await mutateResearchBatch({
    parentQueueItemId,
    parentOutputId,
    mutate: (b) => ({
      ...b,
      leads: b.leads.map((l) => (l.lead_id === leadId ? replacement : l)),
    }),
  });

  return {
    lead: replacement,
    tokensUsed: result.inputTokens + result.outputTokens,
    costEstimate: result.costEstimate,
  };
}

async function mutateResearchBatch(params: {
  parentQueueItemId: string;
  parentOutputId: string;
  mutate: (batch: PressResearchBatch) => PressResearchBatch;
}): Promise<void> {
  const db = supabaseAdmin();
  const { data: item } = await db
    .from('approval_queue')
    .select('full_output')
    .eq('id', params.parentQueueItemId)
    .single();
  if (!item) throw new Error('Parent queue item not found');
  const next = params.mutate((item.full_output ?? {}) as PressResearchBatch);
  await db
    .from('approval_queue')
    .update({ full_output: next as unknown as Record<string, unknown> })
    .eq('id', params.parentQueueItemId);
  await db
    .from('agent_outputs')
    .update({ draft_content: next as unknown as Record<string, unknown> })
    .eq('id', params.parentOutputId);
}

export function estimateCost(result: ThinkResult): number {
  return (
    (result.inputTokens / 1_000_000) * PRICE_IN_PER_MTOK +
    (result.outputTokens / 1_000_000) * PRICE_OUT_PER_MTOK
  );
}

export type { ThinkResult } from './base';
