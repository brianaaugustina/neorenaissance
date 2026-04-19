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

const AGENT_NAME = 'sponsorship-director';
const VENTURE = 'trades-show';
const NOTION_VENTURE = 'The Trades Show';
const NOTION_OUTREACH_TYPE = 'Sponsorship';
const SEASON_TAG = 'Season 2';
const MODEL = process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-5';

// Pricing for cost estimate — mirrors base.ts.
const PRICE_IN_PER_MTOK = 3;
const PRICE_OUT_PER_MTOK = 15;

// ============================================================================
// Output types
// ============================================================================

export type SponsorshipTier = 'tier-a' | 'tier-b' | 'tier-c';

export interface LeadReplacementHistoryEntry {
  brand_name: string;
  fit_score: number;
  fit_rationale: string;
  feedback: string | null;
  replaced_at: string;
}

export interface ResearchLead {
  lead_id: string;
  brand_name: string;
  tier: SponsorshipTier;
  contact_name: string | null;
  contact_email: string | null;
  contact_role: string | null;
  contact_linkedin: string | null;
  /** null when we can't verify a contact — flag for Briana instead of inventing one. */
  contact_flag: 'unverified-contact' | 'no-named-contact' | null;
  fit_score: number; // 1–5
  fit_rationale: string; // one sentence
  suggested_episode: string | null;
  source_note: string | null;
  // Mutated at Gate 1:
  approved?: boolean;
  draft_output_id?: string | null;
  outreach_row_id?: string | null;
  skipped?: boolean;
  // Mutated on replace:
  replaced_at?: string;
  replacement_feedback?: string | null;
  previous_versions?: LeadReplacementHistoryEntry[];
}

export interface ResearchBatch {
  total_reviewed: number;
  surfaced_count: number;
  surfaced_at: string;
  season: string;
  leads: ResearchLead[];
  candidates_not_surfaced: Array<{
    brand_name: string;
    fit_score: number;
    skip_reason: string;
  }>;
}

export interface PitchEmailDraft {
  lead_id: string;
  parent_batch_output_id: string | null;
  brand_name: string;
  contact_name: string | null;
  contact_email: string | null;
  touch_number: 1 | 2 | 3;
  subject: string;
  body: string;
  cta_type: 'one-pager' | 'warm-intro' | 'enterprise-both';
  suggested_episode: string | null;
  outreach_row_id: string | null;
}

// ============================================================================
// System prompt assembly — loads 4 context files, memory, exemplars, pipeline
// ============================================================================

function loadSponsorshipContextFiles(): string {
  return [
    loadContextFile('system.md'),
    loadContextFile('ventures/trades-show.md'),
    loadContextFile('agents/sponsorship-director/system-prompt.md'),
    loadContextFile('agents/sponsorship-director/voice.md'),
    loadContextFile('agents/sponsorship-director/playbook.md'),
    loadContextFile('agents/sponsorship-director/conflicts.md'),
  ]
    .filter(Boolean)
    .join('\n\n---\n\n');
}

function renderPipelineContext(rows: OutreachPipelineRow[]): string {
  if (!rows.length) return '(no existing sponsorship outreach in pipeline)';
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
  return `\n\n# RECENT FEEDBACK (last 14 days)\nBriana's corrections on past Sponsorship Director output. Apply to this run.\n${body}`;
}

// ============================================================================
// Output parsing — Claude returns a single JSON object wrapped in markers
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
    // Pick the earlier opening bracket as the start of the JSON payload.
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
// Research batch — weekly cron output
// ============================================================================

const RESEARCH_SYSTEM_INSTRUCTIONS = `
You are running the weekly Sponsorship Director research scan for The Trades Show.

Follow the 5-point fit test in the playbook strictly. Candidates scoring below 3/5
MUST NOT appear in the surfaced list.

# Output format (strict JSON, no commentary)

Return a single JSON object wrapped exactly in these markers:

<!-- BEGIN_RESEARCH -->
{
  "reviewed": [
    {
      "brand_name": "string",
      "tier": "tier-a" | "tier-b" | "tier-c",
      "fit_score": 1-5 (integer),
      "passes_threshold": true | false,
      "fit_rationale": "one specific sentence",
      "contact_name": "string or null",
      "contact_email": "string or null",
      "contact_role": "string or null",
      "contact_linkedin": "string or null",
      "contact_flag": "unverified-contact" | "no-named-contact" | null,
      "suggested_episode": "string or null",
      "source_note": "where you found them / what triggered consideration"
    }
  ]
}
<!-- END_RESEARCH -->

# Scoring rules
- fit_score in {1,2,3,4,5} — the 5-point test in playbook §3.
- passes_threshold = fit_score >= 3.
- Return 15–30 candidates total across all tiers. The code will cap the surfaced
  list at 10 and use your count as the "reviewed" total.
- Never include a brand in the conflict list. Never include a brand that is
  already in the pipeline context below — skip entirely.
- If you cannot find a specific named contact, set contact fields to null and
  contact_flag to "no-named-contact" or "unverified-contact". NEVER invent
  names or default to "Hi team".
- fit_rationale must be concrete and pass the 10-second approve test. Not
  "solid alignment" — name the specific angle.

# Never include
- Brands in the conflicts list (health insurance, current Fractal/Aura clients).
- Brands currently in the active pipeline (listed in the prompt).
- Brands scoring below 3.

Return ONLY the wrapped JSON. No prose before or after.
`.trim();

export interface RunResearchResult {
  runId: string;
  queueId: string;
  outputId: string;
  batch: ResearchBatch;
  tokensUsed: number;
  costEstimate: number;
}

export async function runSponsorshipResearch(
  trigger: 'cron' | 'manual' = 'cron',
): Promise<RunResearchResult> {
  const run = await logRunStart(AGENT_NAME, trigger);

  try {
    const [permanentPreferences, recentFeedback, pitchExemplars, pipeline] =
      await Promise.all([
        getPermanentPreferences(AGENT_NAME).catch(() => [] as string[]),
        getRecentFeedback(AGENT_NAME, 24 * 14, ['report']).catch(() => [] as RecentFeedbackItem[]),
        getApprovedOutputsByType({
          agentId: 'sponsorship-director',
          venture: 'trades-show',
          outputType: 'pitch_email',
          limit: 3,
          requireFinalContent: true,
        }).catch(() => [] as ApprovedOutputExample[]),
        getActiveOutreachRows(NOTION_OUTREACH_TYPE, NOTION_VENTURE).catch(
          () => [] as OutreachPipelineRow[],
        ),
      ]);

    const memoryBlock = permanentPreferences.length
      ? '\n\n# Permanent preferences (apply every run)\n' +
        permanentPreferences.map((r) => `- ${r}`).join('\n')
      : '';

    const system =
      loadSponsorshipContextFiles() +
      memoryBlock +
      renderExemplars('pitch emails', pitchExemplars) +
      renderRecentFeedback(recentFeedback) +
      '\n\n---\n\n' +
      RESEARCH_SYSTEM_INSTRUCTIONS;

    const user = `Today is ${todayIsoPT()}.
Season context: ${SEASON_TAG}. Target: 2 Episode Partnerships closed (see playbook §1).

# ACTIVE PIPELINE (already being pitched — do NOT re-surface these brands)
${renderPipelineContext(pipeline)}

# TASK
Produce the weekly research batch per the instructions above. Aim for 15–30 scored candidates.
Only brands that pass the 5-point fit test (>=3) should be surfaced. Return the JSON wrapped
between BEGIN_RESEARCH / END_RESEARCH markers.`;

    const result = await think({
      systemPrompt: system,
      userPrompt: user,
      maxTokens: 6000,
    });

    const rawJson =
      extractJsonBlock(result.text, '<!-- BEGIN_RESEARCH -->', '<!-- END_RESEARCH -->') ??
      result.text;
    type Reviewed = {
      brand_name: string;
      tier?: SponsorshipTier;
      fit_score?: number;
      passes_threshold?: boolean;
      fit_rationale?: string;
      contact_name?: string | null;
      contact_email?: string | null;
      contact_role?: string | null;
      contact_linkedin?: string | null;
      contact_flag?: 'unverified-contact' | 'no-named-contact' | null;
      suggested_episode?: string | null;
      source_note?: string | null;
    };
    const parsed = tryParseJson<{ reviewed?: Reviewed[] }>(rawJson);
    const reviewed = Array.isArray(parsed?.reviewed) ? parsed!.reviewed : [];

    // Filter/sort/slice to get the surfaced 10.
    const passing = reviewed.filter(
      (r) => typeof r.fit_score === 'number' && r.fit_score >= 3 && r.brand_name,
    );
    passing.sort((a, b) => (b.fit_score ?? 0) - (a.fit_score ?? 0));
    const surfaced: ResearchLead[] = passing.slice(0, 10).map((r, i) => ({
      lead_id: `lead_${i}`,
      brand_name: r.brand_name,
      tier: (r.tier as SponsorshipTier) ?? 'tier-b',
      contact_name: r.contact_name ?? null,
      contact_email: r.contact_email ?? null,
      contact_role: r.contact_role ?? null,
      contact_linkedin: r.contact_linkedin ?? null,
      contact_flag: r.contact_flag ?? null,
      fit_score: r.fit_score ?? 3,
      fit_rationale: r.fit_rationale ?? '',
      suggested_episode: r.suggested_episode ?? null,
      source_note: r.source_note ?? null,
      approved: false,
      draft_output_id: null,
      outreach_row_id: null,
      skipped: false,
    }));

    const notSurfaced = reviewed
      .filter((r) => typeof r.fit_score === 'number' && r.fit_score < 3)
      .slice(0, 20)
      .map((r) => ({
        brand_name: r.brand_name,
        fit_score: r.fit_score ?? 0,
        skip_reason: r.fit_rationale ?? '(no reason given)',
      }));

    const batch: ResearchBatch = {
      total_reviewed: reviewed.length,
      surfaced_count: surfaced.length,
      surfaced_at: new Date().toISOString(),
      season: SEASON_TAG,
      leads: surfaced,
      candidates_not_surfaced: notSurfaced,
    };

    const summary =
      surfaced.length > 0
        ? `Reviewed ${reviewed.length}, surfacing ${surfaced.length}`
        : `Reviewed ${reviewed.length}, nothing passed fit threshold`;

    // Log to agent_outputs first so the queue item can point back to it.
    const outputId = await logOutput({
      agentId: 'sponsorship-director',
      venture: 'trades-show',
      outputType: 'research_batch',
      runId: run.id,
      draftContent: batch as unknown as Record<string, unknown>,
      tags: ['weekly-research', todayIsoPT(), SEASON_TAG.toLowerCase().replace(/\s+/g, '-')],
    });

    const queueId = await depositToQueue({
      agent_name: AGENT_NAME,
      type: 'report',
      title: `Sponsorship research — ${todayIsoPT()} (${surfaced.length} leads)`,
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
      contextSummary: `pipeline=${pipeline.length} reviewed=${reviewed.length} surfaced=${surfaced.length}`,
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
// Pitch email draft — triggered per lead on Gate 1 approval
// ============================================================================

const PITCH_SYSTEM_INSTRUCTIONS = `
You are drafting a single Touch 1 cold pitch email for Sponsorship Director.

Follow every rule in the voice file exemplars (A, B, C, D) and the personalization
minimums from the playbook. Clear all items on the pre-send checklist before returning.

# Output format (strict JSON, no commentary)

Return exactly:

<!-- BEGIN_PITCH -->
{
  "subject": "specific subject line per voice patterns",
  "body": "the full email body in plain text, starting with 'Hi [First name],' and ending with the signature line 'Warmly, Briana' or 'Best, Briana' — no HTML, no markdown",
  "cta_type": "one-pager" | "warm-intro" | "enterprise-both"
}
<!-- END_PITCH -->

# Non-negotiables
- Subject line references the sponsor specifically (never generic).
- Body is 110–160 words.
- Opens with a specific verified observation — not flattery.
- One link max in body (thetradesshowpod.com or a specific episode).
- CTA matches context: default "one-pager".
- No inflated metrics. No fake scarcity. No em-dash over 3 per email.
- Signature is "Warmly, Briana" or "Best, Briana".

Return ONLY the wrapped JSON. No preamble.
`.trim();

export interface GenerateLeadPitchParams {
  lead: ResearchLead;
  parentBatchOutputId: string;
  parentQueueItemId: string;
}

export interface GenerateLeadPitchResult {
  outputId: string;
  queueId: string;
  outreachRowId: string;
  draft: PitchEmailDraft;
  tokensUsed: number;
  costEstimate: number;
}

export async function generateLeadPitch(
  params: GenerateLeadPitchParams,
): Promise<GenerateLeadPitchResult> {
  const { lead, parentBatchOutputId, parentQueueItemId } = params;
  const run = await logRunStart(AGENT_NAME, 'manual');

  try {
    const [permanentPreferences, recentFeedback, pitchExemplars] = await Promise.all([
      getPermanentPreferences(AGENT_NAME).catch(() => [] as string[]),
      getRecentFeedback(AGENT_NAME, 24 * 14, ['draft']).catch(() => [] as RecentFeedbackItem[]),
      getApprovedOutputsByType({
        agentId: 'sponsorship-director',
        venture: 'trades-show',
        outputType: 'pitch_email',
        limit: 5,
        requireFinalContent: true,
      }).catch(() => [] as ApprovedOutputExample[]),
    ]);

    const memoryBlock = permanentPreferences.length
      ? '\n\n# Permanent preferences (apply every run)\n' +
        permanentPreferences.map((r) => `- ${r}`).join('\n')
      : '';

    const system =
      loadSponsorshipContextFiles() +
      memoryBlock +
      renderExemplars('pitch emails', pitchExemplars) +
      renderRecentFeedback(recentFeedback) +
      '\n\n---\n\n' +
      PITCH_SYSTEM_INSTRUCTIONS;

    const contactBlock = lead.contact_name
      ? `Contact: ${lead.contact_name}${lead.contact_role ? ` (${lead.contact_role})` : ''}${lead.contact_email ? ` · ${lead.contact_email}` : ''}`
      : `Contact: (no named contact — Briana will fill in before sending; draft with a placeholder first name "[First name]")`;

    const user = `Draft a Touch 1 cold pitch email for this lead.

# LEAD
Brand: ${lead.brand_name}
Tier: ${lead.tier}
Fit score: ${lead.fit_score}/5
${contactBlock}
Suggested episode pairing: ${lead.suggested_episode ?? '(none — pick the best one from the Season 2 roster in context)'}
Why they fit: ${lead.fit_rationale}
${lead.source_note ? `Source: ${lead.source_note}` : ''}

Today: ${todayIsoPT()}. Season: ${SEASON_TAG}.

Produce ONLY the JSON wrapped between BEGIN_PITCH / END_PITCH markers.`;

    const result = await think({
      systemPrompt: system,
      userPrompt: user,
      maxTokens: 2000,
    });

    const rawJson =
      extractJsonBlock(result.text, '<!-- BEGIN_PITCH -->', '<!-- END_PITCH -->') ??
      result.text;
    const parsed = tryParseJson<{
      subject?: string;
      body?: string;
      cta_type?: 'one-pager' | 'warm-intro' | 'enterprise-both';
    }>(rawJson);

    const draft: PitchEmailDraft = {
      lead_id: lead.lead_id,
      parent_batch_output_id: parentBatchOutputId,
      brand_name: lead.brand_name,
      contact_name: lead.contact_name,
      contact_email: lead.contact_email,
      touch_number: 1,
      subject: parsed?.subject?.trim() ?? `A note for ${lead.brand_name}`,
      body: parsed?.body?.trim() ?? result.text.trim(),
      cta_type: parsed?.cta_type ?? 'one-pager',
      suggested_episode: lead.suggested_episode,
      outreach_row_id: null,
    };

    // Create the Outreach row in Notion with Status='Draft Ready'. Then update
    // it with the draft body and Status='Pending Approval' once we have the
    // row id. Two steps so we don't lose the draft if Notion create fails.
    let outreachRowId = '';
    try {
      outreachRowId = await createOutreachRow({
        name: `${lead.brand_name} — Touch 1`,
        outreachType: NOTION_OUTREACH_TYPE,
        venture: NOTION_VENTURE,
        status: 'Draft Ready',
        source: 'Claude',
        season: SEASON_TAG,
        organization: lead.brand_name,
        contactName: lead.contact_name ?? undefined,
        contactEmail: lead.contact_email ?? undefined,
        contactLinkedin: lead.contact_linkedin ?? undefined,
        fitScore: lead.fit_score,
        whyFit: lead.fit_rationale,
      });
      await updateOutreachRow(outreachRowId, {
        draftMessage: `Subject: ${draft.subject}\n\n${draft.body}`,
        status: 'Pending Approval',
      });
      draft.outreach_row_id = outreachRowId;
    } catch (notionErr) {
      console.error('Sponsorship: Notion Outreach write failed (non-fatal):', notionErr);
    }

    const outputId = await logOutput({
      agentId: 'sponsorship-director',
      venture: 'trades-show',
      outputType: 'pitch_email',
      runId: run.id,
      parentOutputId: parentBatchOutputId,
      draftContent: draft as unknown as Record<string, unknown>,
      tags: [
        'touch-1',
        draft.cta_type,
        lead.tier,
        ...(lead.suggested_episode
          ? [`paired-${lead.suggested_episode.toLowerCase().replace(/\s+/g, '-')}`]
          : []),
      ],
    });

    const queueId = await depositToQueue({
      agent_name: AGENT_NAME,
      type: 'draft',
      title: `Pitch draft — ${lead.brand_name}${lead.contact_name ? ` (${lead.contact_name})` : ''}`,
      summary: draft.subject,
      full_output: draft as unknown as Record<string, unknown>,
      initiative: 'The Trades Show',
      run_id: run.id,
      agent_output_id: outputId,
    });
    await setApprovalQueueId(outputId, queueId);

    // Update the research_batch queue item's embedded leads[] so the dashboard
    // knows this lead has a draft. We re-read, mutate, write back.
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
      contextSummary: `lead=${lead.brand_name} tier=${lead.tier} fit=${lead.fit_score}`,
      outputSummary: `Draft pitch for ${lead.brand_name}`,
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

// Update the parent research_batch queue item so the dashboard reflects that
// this lead now has a generated draft. Kept here (not in QueueCard) so the
// server is the source of truth.
async function markLeadApproved(params: {
  parentQueueItemId: string;
  leadId: string;
  draftOutputId: string;
  outreachRowId: string | null;
}): Promise<void> {
  const db = supabaseAdmin();
  const { data: item, error: fetchErr } = await db
    .from('approval_queue')
    .select('full_output, agent_output_id')
    .eq('id', params.parentQueueItemId)
    .single();
  if (fetchErr || !item) return;

  const fullOutput = (item.full_output ?? {}) as ResearchBatch;
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
    .update({
      full_output: { ...fullOutput, leads: updatedLeads },
    })
    .eq('id', params.parentQueueItemId);

  // Mirror the mutation into the parent agent_outputs row's draft_content
  // so the audit trail stays consistent.
  if (item.agent_output_id) {
    await db
      .from('agent_outputs')
      .update({
        draft_content: { ...fullOutput, leads: updatedLeads },
      })
      .eq('id', item.agent_output_id);
  }
}

// ============================================================================
// Gate 2 hook — called from the queue status route when a pitch is approved.
// Updates the Notion Outreach row's Status to 'Approved'. Returns false if
// the agent isn't responsible for this queue item (no-op for non-pitch items).
// ============================================================================

export async function onPitchApproval(params: {
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
  if (out.agent_id !== 'sponsorship-director' || out.output_type !== 'pitch_email') {
    return false;
  }

  const draft = (out.draft_content ?? {}) as PitchEmailDraft;
  const rowId = draft.outreach_row_id;
  if (!rowId) return true; // agent_outputs path handled elsewhere; Notion no-op

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
    console.error('Sponsorship Outreach status update failed:', e);
  }
  return true;
}

// ============================================================================
// Replace a single lead — triggered from the per-lead Replace button.
// Accepts optional feedback ("already in pipeline", "not a values fit", etc.)
// and regenerates one new lead that addresses it while avoiding duplicates
// against both the remaining batch and the active Notion pipeline.
// ============================================================================

const REPLACE_SYSTEM_INSTRUCTIONS = `
You are replacing ONE sponsor research lead for The Trades Show.

The lead being replaced plus Briana's feedback (if any) is below. Return
exactly ONE new candidate that scores 3+ on the 5-point fit test in the
playbook. Avoid every brand listed in "do not re-surface" in the prompt.

# Output format (strict JSON, no commentary)

Wrap the single candidate exactly between these markers:

<!-- BEGIN_REPLACEMENT -->
{
  "brand_name": "string",
  "tier": "tier-a" | "tier-b" | "tier-c",
  "fit_score": 3-5 (integer — must pass threshold),
  "fit_rationale": "one concrete sentence",
  "contact_name": "string or null",
  "contact_email": "string or null",
  "contact_role": "string or null",
  "contact_linkedin": "string or null",
  "contact_flag": "unverified-contact" | "no-named-contact" | null,
  "suggested_episode": "string or null",
  "source_note": "where you found them / what triggered consideration"
}
<!-- END_REPLACEMENT -->

# Rules
- fit_score must be at least 3. If you cannot find a brand that clears
  the threshold AND addresses the feedback AND avoids duplicates, return
  the best candidate available at score 3 — do not go below.
- Never re-surface a brand on the "do not re-surface" list.
- Never re-surface a brand currently in the Notion pipeline.
- If the feedback names a specific concern (category saturation, values
  mismatch, geographic preference), the replacement must directly address it.
- If the feedback is empty, treat it as "surface a different strong
  candidate with a notably distinct angle from the one being replaced."

Return ONLY the wrapped JSON. No preamble.
`.trim();

export interface ReplaceLeadParams {
  batch: ResearchBatch;
  leadId: string;
  feedback?: string;
  parentQueueItemId: string;
  parentOutputId: string;
}

export interface ReplaceLeadResult {
  lead: ResearchLead;
  tokensUsed: number;
  costEstimate: number;
}

export async function replaceLead(
  params: ReplaceLeadParams,
): Promise<ReplaceLeadResult> {
  const { batch, leadId, parentQueueItemId, parentOutputId } = params;
  const feedback = (params.feedback ?? '').trim();

  const leadToReplace = batch.leads.find((l) => l.lead_id === leadId);
  if (!leadToReplace) {
    throw new Error(`Lead ${leadId} not found in batch`);
  }
  if (leadToReplace.approved) {
    throw new Error(`Lead ${leadId} already approved — cannot replace`);
  }

  const [permanentPreferences, recentFeedback, pitchExemplars, pipeline] =
    await Promise.all([
      getPermanentPreferences(AGENT_NAME).catch(() => [] as string[]),
      getRecentFeedback(AGENT_NAME, 24 * 14, ['report']).catch(
        () => [] as RecentFeedbackItem[],
      ),
      getApprovedOutputsByType({
        agentId: 'sponsorship-director',
        venture: 'trades-show',
        outputType: 'pitch_email',
        limit: 3,
        requireFinalContent: true,
      }).catch(() => [] as ApprovedOutputExample[]),
      getActiveOutreachRows(NOTION_OUTREACH_TYPE, NOTION_VENTURE).catch(
        () => [] as OutreachPipelineRow[],
      ),
    ]);

  const memoryBlock = permanentPreferences.length
    ? '\n\n# Permanent preferences (apply every run)\n' +
      permanentPreferences.map((r) => `- ${r}`).join('\n')
    : '';

  const system =
    loadSponsorshipContextFiles() +
    memoryBlock +
    renderExemplars('pitch emails', pitchExemplars) +
    renderRecentFeedback(recentFeedback) +
    '\n\n---\n\n' +
    REPLACE_SYSTEM_INSTRUCTIONS;

  // Build the "do not re-surface" list: every other surfaced brand, every
  // pipeline brand, plus the brand being replaced AND all its prior versions.
  const otherBrands = batch.leads
    .filter((l) => l.lead_id !== leadId)
    .map((l) => l.brand_name);
  const priorVersionBrands = (leadToReplace.previous_versions ?? []).map(
    (v) => v.brand_name,
  );
  const pipelineBrands = pipeline.map((p) => p.organization ?? p.name).filter(Boolean) as string[];
  const blockedBrands = Array.from(
    new Set([leadToReplace.brand_name, ...otherBrands, ...priorVersionBrands, ...pipelineBrands]),
  );

  const user = `Replace this sponsor lead.

# LEAD TO REPLACE
Brand: ${leadToReplace.brand_name}
Tier: ${leadToReplace.tier}
Fit score: ${leadToReplace.fit_score}/5
Rationale: ${leadToReplace.fit_rationale}
${leadToReplace.suggested_episode ? `Paired episode: ${leadToReplace.suggested_episode}` : ''}

# BRIANA'S FEEDBACK
${feedback ? feedback : '(no specific feedback — surface a strong candidate with a different angle)'}

# DO NOT RE-SURFACE (duplicates, pipeline, prior replacements)
${blockedBrands.map((b) => `- ${b}`).join('\n')}

Today: ${todayIsoPT()}. Season: ${SEASON_TAG}.

Return the replacement JSON wrapped between BEGIN_REPLACEMENT / END_REPLACEMENT markers.`;

  const result = await think({
    systemPrompt: system,
    userPrompt: user,
    maxTokens: 1500,
  });

  const rawJson =
    extractJsonBlock(result.text, '<!-- BEGIN_REPLACEMENT -->', '<!-- END_REPLACEMENT -->') ??
    result.text;
  type Candidate = {
    brand_name?: string;
    tier?: SponsorshipTier;
    fit_score?: number;
    fit_rationale?: string;
    contact_name?: string | null;
    contact_email?: string | null;
    contact_role?: string | null;
    contact_linkedin?: string | null;
    contact_flag?: 'unverified-contact' | 'no-named-contact' | null;
    suggested_episode?: string | null;
    source_note?: string | null;
  };
  const parsed = tryParseJson<Candidate>(rawJson);
  if (!parsed?.brand_name) {
    throw new Error('Replacement returned no valid candidate — try again or edit feedback.');
  }

  // Guard: even if the model ignored the block list, drop duplicates. Don't
  // throw — fall back to surfaced data but warn in the server log.
  const lowered = parsed.brand_name.toLowerCase();
  if (blockedBrands.some((b) => b.toLowerCase() === lowered)) {
    console.warn(
      `[sponsorship] replacement returned a blocked brand: ${parsed.brand_name}. Surfacing anyway so Briana can re-replace.`,
    );
  }

  const fitScore = typeof parsed.fit_score === 'number' ? parsed.fit_score : 3;
  const replacement: ResearchLead = {
    lead_id: leadToReplace.lead_id, // preserve the lead slot
    brand_name: parsed.brand_name,
    tier: (parsed.tier as SponsorshipTier) ?? 'tier-b',
    contact_name: parsed.contact_name ?? null,
    contact_email: parsed.contact_email ?? null,
    contact_role: parsed.contact_role ?? null,
    contact_linkedin: parsed.contact_linkedin ?? null,
    contact_flag: parsed.contact_flag ?? null,
    fit_score: fitScore < 3 ? 3 : fitScore,
    fit_rationale: parsed.fit_rationale ?? '',
    suggested_episode: parsed.suggested_episode ?? null,
    source_note: parsed.source_note ?? null,
    approved: false,
    draft_output_id: null,
    outreach_row_id: null,
    skipped: false,
    replaced_at: new Date().toISOString(),
    replacement_feedback: feedback || null,
    previous_versions: [
      ...(leadToReplace.previous_versions ?? []),
      {
        brand_name: leadToReplace.brand_name,
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

// Shared helper — re-read the batch, apply a mutation, write back to both
// approval_queue.full_output and agent_outputs.draft_content so the audit
// trail stays consistent across both stores.
async function mutateResearchBatch(params: {
  parentQueueItemId: string;
  parentOutputId: string;
  mutate: (batch: ResearchBatch) => ResearchBatch;
}): Promise<void> {
  const db = supabaseAdmin();
  const { data: item, error } = await db
    .from('approval_queue')
    .select('full_output')
    .eq('id', params.parentQueueItemId)
    .single();
  if (error || !item) throw new Error('Parent queue item not found');
  const next = params.mutate((item.full_output ?? {}) as ResearchBatch);
  await db
    .from('approval_queue')
    .update({ full_output: next as unknown as Record<string, unknown> })
    .eq('id', params.parentQueueItemId);
  await db
    .from('agent_outputs')
    .update({ draft_content: next as unknown as Record<string, unknown> })
    .eq('id', params.parentOutputId);
}

// Narrow export for the ThinkResult type consumers shouldn't re-import from base.
export type { ThinkResult } from './base';

// Internal helper — kept available in case a future caller needs to recompute
// cost for a manually-invoked think() call that bypasses runAgent.
export function estimateCost(result: ThinkResult): number {
  return (
    (result.inputTokens / 1_000_000) * PRICE_IN_PER_MTOK +
    (result.outputTokens / 1_000_000) * PRICE_OUT_PER_MTOK
  );
}
