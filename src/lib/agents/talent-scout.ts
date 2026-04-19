import {
  getApprovedOutputsByType,
  logOutput,
  setApprovalQueueId,
  type ApprovedOutputExample,
} from '../agent-outputs';
import {
  createContactRow,
  createOutreachRow,
  getActiveOutreachRows,
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

const AGENT_NAME = 'talent-scout';
const NOTION_VENTURE = 'The Trades Show';
const NOTION_OUTREACH_TYPE = 'Artisan Sourcing';
const SEASON_TAG = 'Season 2';
const MODEL = process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-5';

// ============================================================================
// Output types
// ============================================================================

export type ArtisanChannel = 'email' | 'ig-dm' | 'through-team';

export type ArtisanOutreachOutputType =
  | 'artisan_outreach_email'
  | 'artisan_outreach_dm'
  | 'artisan_outreach_through_team';

export interface ArtisanLead {
  lead_id: string;
  artisan_name: string;
  trade: string;
  studio_or_shop: string | null;
  location: string; // 'San Francisco' / 'West Oakland' / neighborhood
  contact_email: string | null;
  instagram_handle: string | null;
  shop_website: string | null;
  /** Agent's judgment on where outreach should go. Drives which draft
   *  type is generated at Gate 1. */
  suggested_channel: ArtisanChannel;
  venn_test_result: '3-of-3';
  fit_rationale: string;
  discovery_story: string;
  source_link: string | null;
  trade_gap_fill: boolean;
  // Mutated:
  approved?: boolean;
  draft_output_id?: string | null;
  contacts_row_id?: string | null;
  skipped?: boolean;
  replaced_at?: string;
  replacement_feedback?: string | null;
  previous_versions?: Array<{
    artisan_name: string;
    trade: string;
    location: string;
    fit_rationale: string;
    feedback: string | null;
    replaced_at: string;
  }>;
}

export interface ArtisanResearchBatch {
  total_reviewed: number;
  surfaced_count: number;
  requested_count: number;
  surfaced_at: string;
  season: string;
  leads: ArtisanLead[];
  candidates_not_surfaced: Array<{
    artisan_name: string;
    trade: string;
    skip_reason: string;
  }>;
}

export interface ArtisanOutreachDraft {
  lead_id: string;
  parent_batch_output_id: string | null;
  artisan_name: string;
  trade: string;
  contact_email: string | null;
  instagram_handle: string | null;
  channel: ArtisanChannel;
  touch_number: 1 | 2 | 3;
  subject: string | null; // null for ig-dm
  body: string;
  discovery_story: string;
  contacts_row_id: string | null;
  // Filled on Gate 3 / Mark-as-sent:
  outreach_row_id?: string | null;
  sent_at?: string;
}

// ============================================================================
// Context assembly
// ============================================================================

function loadTalentContextFiles(): string {
  return [
    loadContextFile('system.md'),
    loadContextFile('ventures/trades-show.md'),
    loadContextFile('agents/talent-scout/system-prompt.md'),
    loadContextFile('agents/talent-scout/voice.md'),
    loadContextFile('agents/talent-scout/playbook.md'),
    loadContextFile('shared/conflicts.md'),
  ]
    .filter(Boolean)
    .join('\n\n---\n\n');
}

function renderPipelineContext(rows: OutreachPipelineRow[]): string {
  if (!rows.length) return '(no existing artisan outreach in pipeline)';
  return rows
    .map((r) => {
      const name = r.organization ?? r.name;
      return `- ${name} [${r.status ?? 'no status'}${r.season ? ` · ${r.season}` : ''}]`;
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
  return `\n\n# Past approved ${label} — reference only, do NOT copy\nUse these to understand what "good" looks like. Fresh work in the same voice, never recycled phrasing.\n\n${blocks.join('\n\n')}`;
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
// Artisan research batch — manual trigger
// ============================================================================

const RESEARCH_SYSTEM_INSTRUCTIONS = `
You are running an on-demand artisan research scan for The Trades Show.

Apply the Venn test in playbook §2 strictly. Only candidates that score
3-of-3 (artisan trade AND established professional AND SF/West-Oakland
based) may appear in the surfaced list. The playbook's past-guest list
(§7) and declined list are hard blocks.

# Output format (strict JSON, no commentary)

Wrap in these markers:

<!-- BEGIN_RESEARCH -->
{
  "reviewed": [
    {
      "artisan_name": "string",
      "trade": "string (use a specific trade noun — 'bladesmith', 'upholsterer', not 'artisan')",
      "studio_or_shop": "string or null",
      "location": "string (SF neighborhood or 'West Oakland')",
      "contact_email": "string or null",
      "instagram_handle": "string or null (with @ prefix)",
      "shop_website": "url or null",
      "suggested_channel": "email" | "ig-dm" | "through-team",
      "venn_test_result": "3-of-3" | "2-of-3" | "1-of-3" | "0-of-3",
      "passes_threshold": true | false (true ONLY if venn_test_result is 3-of-3),
      "fit_rationale": "one concrete sentence",
      "discovery_story": "how you found them — friend recommendation, shop visit, press feature, IG discovery, etc. Be specific",
      "source_link": "URL to their work or a press feature, or null",
      "trade_gap_fill": true | false (true if they fill an OPEN trade category from playbook §9)
    }
  ]
}
<!-- END_RESEARCH -->

# Channel selection rules (suggested_channel)
- email: findable personal/professional email + clear professional setup
- ig-dm: active personal IG, no findable email
- through-team: team-run shop with info@ or general inbox, no clear founder email

# Rules
- Aim for ${'$'}{requestedCount} candidates total. Over-produce slightly so the
  code can filter to the passing set.
- Only surface candidates where passes_threshold is true (3-of-3 Venn AND
  not in the past-guest or declined list AND not already in the pipeline).
- NEVER include past guests (playbook §7) or declined entries (Bryr Studio).
- NEVER include confirmed Season 2 guests (Stuart Brioza, Elias Sideris,
  Momoko Schafer, Danny Hess, Sophie Smith).
- Location must be SF proper or West Oakland. No exceptions.
- discovery_story must be real-sounding — "found on Instagram" alone is
  insufficient. Name the path: searched which hashtags, which shop, which
  referral, which press piece.

Return ONLY the wrapped JSON.
`.trim();

export interface RunArtisanResearchParams {
  requestedCount?: number; // default 8
  trigger?: 'cron' | 'manual';
}

export interface RunArtisanResearchResult {
  runId: string;
  queueId: string;
  outputId: string;
  batch: ArtisanResearchBatch;
  contactsWritten: number;
  tokensUsed: number;
  costEstimate: number;
}

export async function runArtisanResearch(
  params: RunArtisanResearchParams = {},
): Promise<RunArtisanResearchResult> {
  const requestedCount = Math.min(Math.max(params.requestedCount ?? 8, 3), 15);
  const trigger = params.trigger ?? 'manual';
  const run = await logRunStart(AGENT_NAME, trigger);
  try {
    const [permanentPreferences, recentFeedback, outreachExemplars, pipeline] =
      await Promise.all([
        getPermanentPreferences(AGENT_NAME).catch(() => [] as string[]),
        getRecentFeedback(AGENT_NAME, 24 * 14, ['report']).catch(
          () => [] as RecentFeedbackItem[],
        ),
        getApprovedOutputsByType({
          agentId: 'talent-scout',
          venture: 'trades-show',
          outputType: 'artisan_outreach_email',
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
      loadTalentContextFiles() +
      memoryBlock +
      renderExemplars('artisan outreach emails', outreachExemplars) +
      renderRecentFeedback(recentFeedback) +
      '\n\n---\n\n' +
      RESEARCH_SYSTEM_INSTRUCTIONS.replace('${requestedCount}', String(requestedCount));

    const user = `Today is ${todayIsoPT()}.
Season: ${SEASON_TAG}. Requested count: ${requestedCount}.

# ACTIVE PIPELINE (already being pursued — do NOT re-surface)
${renderPipelineContext(pipeline)}

# TASK
Produce ${requestedCount} fresh artisan candidates (approximately; under-surface
if the Venn test bar eliminates too many). Only 3-of-3 Venn candidates. Return
the JSON wrapped between BEGIN_RESEARCH / END_RESEARCH markers.`;

    const result = await think({
      systemPrompt: system,
      userPrompt: user,
      maxTokens: 8000,
    });

    const rawJson =
      extractJsonBlock(result.text, '<!-- BEGIN_RESEARCH -->', '<!-- END_RESEARCH -->') ??
      result.text;
    type Reviewed = {
      artisan_name: string;
      trade: string;
      studio_or_shop?: string | null;
      location?: string;
      contact_email?: string | null;
      instagram_handle?: string | null;
      shop_website?: string | null;
      suggested_channel?: ArtisanChannel;
      venn_test_result?: string;
      passes_threshold?: boolean;
      fit_rationale?: string;
      discovery_story?: string;
      source_link?: string | null;
      trade_gap_fill?: boolean;
    };
    const parsed = tryParseJson<{ reviewed?: Reviewed[] }>(rawJson);
    const reviewed = Array.isArray(parsed?.reviewed) ? parsed!.reviewed : [];
    const passing = reviewed.filter(
      (r) => r.passes_threshold === true && r.venn_test_result === '3-of-3' && r.artisan_name && r.trade,
    );
    const surfaced: ArtisanLead[] = passing.slice(0, requestedCount).map((r, i) => ({
      lead_id: `lead_${i}`,
      artisan_name: r.artisan_name,
      trade: r.trade,
      studio_or_shop: r.studio_or_shop ?? null,
      location: r.location ?? 'San Francisco',
      contact_email: r.contact_email ?? null,
      instagram_handle: r.instagram_handle ?? null,
      shop_website: r.shop_website ?? null,
      suggested_channel: r.suggested_channel ?? 'email',
      venn_test_result: '3-of-3',
      fit_rationale: r.fit_rationale ?? '',
      discovery_story: r.discovery_story ?? '',
      source_link: r.source_link ?? null,
      trade_gap_fill: r.trade_gap_fill === true,
      approved: false,
      draft_output_id: null,
      contacts_row_id: null,
      skipped: false,
    }));

    const notSurfaced = reviewed
      .filter((r) => r.passes_threshold !== true)
      .slice(0, 15)
      .map((r) => ({
        artisan_name: r.artisan_name,
        trade: r.trade,
        skip_reason: r.fit_rationale ?? r.venn_test_result ?? '(no reason)',
      }));

    // Notion Contacts DB — append-only write per lead. Per the spec, this
    // happens at research time, before Gate 1, so every surfaced artisan is
    // permanently captured even if Briana never approves outreach.
    let contactsWritten = 0;
    for (const lead of surfaced) {
      try {
        const rowId = await createContactRow({
          name: lead.artisan_name,
          type: ['Podcast Guest'],
          connectionStatus: 'Need to Reach Out',
          email: lead.contact_email ?? undefined,
          social: lead.instagram_handle
            ? `https://instagram.com/${lead.instagram_handle.replace(/^@/, '')}`
            : lead.shop_website ?? undefined,
          industry: ['Artisan Trades'],
          notes: [
            `Trade: ${lead.trade}`,
            lead.studio_or_shop ? `Studio: ${lead.studio_or_shop}` : null,
            lead.location ? `Location: ${lead.location}` : null,
            lead.discovery_story ? `Discovery: ${lead.discovery_story}` : null,
          ]
            .filter(Boolean)
            .join('\n'),
        });
        lead.contacts_row_id = rowId;
        contactsWritten++;
      } catch (e) {
        console.error(`[talent-scout] Contacts DB write failed for ${lead.artisan_name}:`, e);
      }
    }

    const batch: ArtisanResearchBatch = {
      total_reviewed: reviewed.length,
      surfaced_count: surfaced.length,
      requested_count: requestedCount,
      surfaced_at: new Date().toISOString(),
      season: SEASON_TAG,
      leads: surfaced,
      candidates_not_surfaced: notSurfaced,
    };

    const summary =
      surfaced.length > 0
        ? `Reviewed ${reviewed.length}, surfacing ${surfaced.length} (${contactsWritten} written to Contacts DB)`
        : `Reviewed ${reviewed.length}, nothing passed the Venn test`;

    const outputId = await logOutput({
      agentId: 'talent-scout',
      venture: 'trades-show',
      outputType: 'artisan_research',
      runId: run.id,
      draftContent: batch as unknown as Record<string, unknown>,
      tags: ['artisan-research', todayIsoPT(), SEASON_TAG.toLowerCase().replace(/\s+/g, '-')],
    });

    const queueId = await depositToQueue({
      agent_name: AGENT_NAME,
      type: 'report',
      title: `Artisan research — ${todayIsoPT()} (${surfaced.length} leads)`,
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
      contextSummary: `pipeline=${pipeline.length} reviewed=${reviewed.length} surfaced=${surfaced.length} contacts_written=${contactsWritten}`,
      outputSummary: summary,
      approvalQueueId: queueId,
      costEstimate: Number(result.costEstimate.toFixed(4)),
    });

    return {
      runId: run.id,
      queueId,
      outputId,
      batch,
      contactsWritten,
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
// Outreach generation per channel (Gate 1 per-lead approve)
// ============================================================================

function channelToOutputType(c: ArtisanChannel): ArtisanOutreachOutputType {
  switch (c) {
    case 'email':
      return 'artisan_outreach_email';
    case 'ig-dm':
      return 'artisan_outreach_dm';
    case 'through-team':
      return 'artisan_outreach_through_team';
  }
}

function channelInstructions(c: ArtisanChannel): string {
  switch (c) {
    case 'email':
      return `
# Channel: EMAIL (Touch 1)
Draft a cold email 100-180 words body.
Subject line: specific and warm (never generic).
Structure per voice.md: personal hook → who I am + show (with thetradesshowpod.com link + YouTube/Spotify mention) → why them, why Season 2 → 15-min call ask (exploratory) → optional @brianaaugustina "proof I'm human" reference → "Warmly + with gratitude, Briana".

Output JSON:
{
  "subject": "string",
  "body": "string (full email body, starting 'Hi [First name],')"
}`;
    case 'ig-dm':
      return `
# Channel: INSTAGRAM DM (intro)
Draft a short DM (40-80 words) whose goal is to request an email pathway.
- Open with genuine, specific admiration
- Say who you are in one line with the show reference
- Ask for their email so you can send a proper outreach
- Include @brianaaugustina as a human-proof signal if appropriate
- End warmly, no sign-off needed

Output JSON:
{
  "subject": null,
  "body": "string (the DM text)"
}`;
    case 'through-team':
      return `
# Channel: THROUGH TEAM / SHOP (facilitator-respecting)
Draft a 100-160 word note to a team or shop, asking to be connected to
the founder/artisan. Polite, brief, respects the chain of contact.
- Open by naming the shop/team and your specific discovery
- Introduce yourself + show in one line
- Ask to be connected to [founder name] — don't go around the team
- Include past guest names as social proof when relevant
- "Warmly + with gratitude, Briana"

Output JSON:
{
  "subject": "string (if the shop accepts subject lines) or null",
  "body": "string"
}`;
  }
}

const OUTREACH_SYSTEM_INSTRUCTIONS = `
You are drafting a single Touch 1 artisan outreach for Talent Scout.

Channel is predetermined — apply the channel-specific rules below.
Follow the exemplars in voice.md (Momoko / Danny / Bryr patterns).

# Output format (strict JSON)

<!-- BEGIN_OUTREACH -->
{ ...channel JSON shape... }
<!-- END_OUTREACH -->

# Non-negotiables (all channels)
- Genuine admiration tied to specific aspect of their work — never generic.
- The discovery story appears verbatim from the lead (don't invent).
- 15-min call ask framed as exploratory ("see if it feels like a good fit").
- Season 2 SF narrative connects their work to the AI-era city.
- No audience metrics. No compensation mention.
- No "I'd love to feature you on my podcast" generic pitch voice.

Return ONLY the wrapped JSON.
`.trim();

export interface GenerateLeadOutreachParams {
  lead: ArtisanLead;
  parentBatchOutputId: string;
  parentQueueItemId: string;
}

export interface GenerateLeadOutreachResult {
  outputId: string;
  queueId: string;
  draft: ArtisanOutreachDraft;
  tokensUsed: number;
  costEstimate: number;
}

export async function generateLeadOutreach(
  params: GenerateLeadOutreachParams,
): Promise<GenerateLeadOutreachResult> {
  const { lead, parentBatchOutputId, parentQueueItemId } = params;
  const channel = lead.suggested_channel;
  const outputType = channelToOutputType(channel);
  const run = await logRunStart(AGENT_NAME, 'manual');

  try {
    const [permanentPreferences, recentFeedback, exemplars] = await Promise.all([
      getPermanentPreferences(AGENT_NAME).catch(() => [] as string[]),
      getRecentFeedback(AGENT_NAME, 24 * 14, ['draft']).catch(
        () => [] as RecentFeedbackItem[],
      ),
      // Retrieve exemplars from the SAME channel — email patterns differ from DM patterns.
      getApprovedOutputsByType({
        agentId: 'talent-scout',
        venture: 'trades-show',
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
      loadTalentContextFiles() +
      memoryBlock +
      renderExemplars(`${channel} outreach`, exemplars) +
      renderRecentFeedback(recentFeedback) +
      '\n\n---\n\n' +
      OUTREACH_SYSTEM_INSTRUCTIONS +
      '\n\n---\n\n' +
      channelInstructions(channel);

    const user = `Draft Touch 1 artisan outreach for this lead.

# LEAD
Artisan: ${lead.artisan_name}
Trade: ${lead.trade}
${lead.studio_or_shop ? `Studio/Shop: ${lead.studio_or_shop}` : ''}
Location: ${lead.location}
${lead.contact_email ? `Email: ${lead.contact_email}` : ''}
${lead.instagram_handle ? `Instagram: ${lead.instagram_handle}` : ''}
${lead.shop_website ? `Website: ${lead.shop_website}` : ''}
Channel: ${channel}
Fit rationale: ${lead.fit_rationale}
Discovery story: ${lead.discovery_story}
${lead.source_link ? `Source: ${lead.source_link}` : ''}

Today: ${todayIsoPT()}. Season: ${SEASON_TAG}.

Produce ONLY the JSON wrapped between BEGIN_OUTREACH / END_OUTREACH markers.`;

    const result = await think({
      systemPrompt: system,
      userPrompt: user,
      maxTokens: 2000,
    });

    const rawJson =
      extractJsonBlock(result.text, '<!-- BEGIN_OUTREACH -->', '<!-- END_OUTREACH -->') ??
      result.text;
    const parsed = tryParseJson<{ subject?: string | null; body?: string }>(rawJson);

    const draft: ArtisanOutreachDraft = {
      lead_id: lead.lead_id,
      parent_batch_output_id: parentBatchOutputId,
      artisan_name: lead.artisan_name,
      trade: lead.trade,
      contact_email: lead.contact_email,
      instagram_handle: lead.instagram_handle,
      channel,
      touch_number: 1,
      subject: channel === 'ig-dm' ? null : (parsed?.subject ?? null),
      body: parsed?.body?.trim() ?? result.text.trim(),
      discovery_story: lead.discovery_story,
      contacts_row_id: lead.contacts_row_id ?? null,
    };

    const titleSubject =
      draft.subject ?? `${lead.artisan_name} (${channel})`;

    const outputId = await logOutput({
      agentId: 'talent-scout',
      venture: 'trades-show',
      outputType,
      runId: run.id,
      parentOutputId: parentBatchOutputId,
      draftContent: draft as unknown as Record<string, unknown>,
      tags: [
        'touch-1',
        channel,
        `trade-${lead.trade.toLowerCase().replace(/\s+/g, '-')}`,
        ...(lead.trade_gap_fill ? ['trade-gap-fill'] : []),
      ],
    });

    const queueId = await depositToQueue({
      agent_name: AGENT_NAME,
      type: 'draft',
      title: `Talent Scout — ${lead.artisan_name} (${channel})`,
      summary: titleSubject,
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
    });

    await logRunComplete({
      runId: run.id,
      startedAt: run.started_at,
      status: 'success',
      tokensUsed: result.inputTokens + result.outputTokens,
      model: MODEL,
      contextSummary: `artisan=${lead.artisan_name} channel=${channel}`,
      outputSummary: `Draft outreach for ${lead.artisan_name}`,
      approvalQueueId: queueId,
      costEstimate: Number(result.costEstimate.toFixed(4)),
    });

    return {
      outputId,
      queueId,
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

async function markLeadApproved(params: {
  parentQueueItemId: string;
  leadId: string;
  draftOutputId: string;
}): Promise<void> {
  const db = supabaseAdmin();
  const { data: item } = await db
    .from('approval_queue')
    .select('full_output, agent_output_id')
    .eq('id', params.parentQueueItemId)
    .single();
  if (!item) return;
  const fullOutput = (item.full_output ?? {}) as ArtisanResearchBatch;
  const leads = Array.isArray(fullOutput.leads) ? fullOutput.leads : [];
  const updated = leads.map((l) =>
    l.lead_id === params.leadId
      ? { ...l, approved: true, draft_output_id: params.draftOutputId }
      : l,
  );
  await db
    .from('approval_queue')
    .update({ full_output: { ...fullOutput, leads: updated } })
    .eq('id', params.parentQueueItemId);
  if (item.agent_output_id) {
    await db
      .from('agent_outputs')
      .update({ draft_content: { ...fullOutput, leads: updated } })
      .eq('id', item.agent_output_id);
  }
}

// ============================================================================
// Mark-as-sent — creates Notion Outreach touch row on Gate 3 click
// ============================================================================

export interface MarkSentResult {
  outreachRowId: string;
  sentAt: string;
}

export async function markOutreachSent(params: {
  outputId: string;
  finalBody?: string;
}): Promise<MarkSentResult> {
  const db = supabaseAdmin();
  const { data: out, error } = await db
    .from('agent_outputs')
    .select('agent_id, output_type, draft_content, final_content, parent_output_id')
    .eq('id', params.outputId)
    .single();
  if (error || !out) throw new Error('Outreach draft not found');
  if (
    out.agent_id !== 'talent-scout' ||
    !['artisan_outreach_email', 'artisan_outreach_dm', 'artisan_outreach_through_team'].includes(
      out.output_type,
    )
  ) {
    throw new Error('Mark-as-sent only applies to Talent Scout outreach drafts');
  }

  const draft = ((out.final_content ?? out.draft_content) ?? {}) as ArtisanOutreachDraft;
  if (draft.outreach_row_id) {
    // Already sent — idempotent no-op.
    return {
      outreachRowId: draft.outreach_row_id,
      sentAt: draft.sent_at ?? new Date().toISOString(),
    };
  }

  const channel = draft.channel ?? 'email';
  const touch = draft.touch_number ?? 1;
  const bodyText = params.finalBody?.trim() || draft.body;

  // Notion Outreach DB — touch row. Mirrors Sponsorship / PR pattern but
  // uses Artisan Sourcing as the Outreach Type. Status=Sent; channel lives
  // in the draft_message so the row reads cleanly.
  const outreachRowId = await createOutreachRow({
    name: `${draft.artisan_name} — Touch ${touch}${channel === 'email' ? '' : ` (${channel})`}`,
    outreachType: NOTION_OUTREACH_TYPE,
    venture: NOTION_VENTURE,
    status: 'Sent',
    source: 'Claude',
    season: SEASON_TAG,
    organization: draft.trade,
    contactName: draft.artisan_name,
    contactEmail: draft.contact_email ?? undefined,
    instagramHandle: draft.instagram_handle ?? undefined,
    draftMessage:
      draft.subject && channel === 'email'
        ? `Channel: ${channel}\nSubject: ${draft.subject}\n\n${bodyText}`
        : `Channel: ${channel}\n\n${bodyText}`,
    dateSent: todayIsoPT(),
    approved: true,
  });

  const sentAt = new Date().toISOString();
  const updatedDraft: ArtisanOutreachDraft = {
    ...draft,
    outreach_row_id: outreachRowId,
    sent_at: sentAt,
    body: bodyText,
  };
  await db
    .from('agent_outputs')
    .update({
      final_content: updatedDraft as unknown as Record<string, unknown>,
      approval_status: 'approved',
    })
    .eq('id', params.outputId);

  return { outreachRowId, sentAt };
}

// ============================================================================
// Replace a single lead — mirrors Sponsorship/PR pattern
// ============================================================================

const REPLACE_SYSTEM_INSTRUCTIONS = `
You are replacing ONE artisan research lead for The Trades Show.

Return exactly ONE new candidate that passes the 3-of-3 Venn test and
addresses Briana's feedback (if any). Avoid every artisan on the "do not
re-surface" list.

# Output format (strict JSON)

<!-- BEGIN_REPLACEMENT -->
{
  "artisan_name": "string",
  "trade": "string",
  "studio_or_shop": "string or null",
  "location": "string (SF neighborhood or West Oakland)",
  "contact_email": "string or null",
  "instagram_handle": "string or null",
  "shop_website": "url or null",
  "suggested_channel": "email" | "ig-dm" | "through-team",
  "venn_test_result": "3-of-3",
  "fit_rationale": "one concrete sentence",
  "discovery_story": "specific path — friend, shop visit, press, etc.",
  "source_link": "url or null",
  "trade_gap_fill": true | false
}
<!-- END_REPLACEMENT -->

# Rules
- Must be 3-of-3 Venn. No exceptions.
- Never re-surface a past guest, declined artisan, pipeline artisan, or
  another lead from this batch.
- If feedback names a specific concern, the replacement must directly address it.

Return ONLY the wrapped JSON.
`.trim();

export interface ReplaceLeadParams {
  batch: ArtisanResearchBatch;
  leadId: string;
  feedback?: string;
  parentQueueItemId: string;
  parentOutputId: string;
}

export interface ReplaceLeadResult {
  lead: ArtisanLead;
  tokensUsed: number;
  costEstimate: number;
}

export async function replaceLead(
  params: ReplaceLeadParams,
): Promise<ReplaceLeadResult> {
  const { batch, leadId, parentQueueItemId, parentOutputId } = params;
  const feedback = (params.feedback ?? '').trim();

  const leadToReplace = batch.leads.find((l) => l.lead_id === leadId);
  if (!leadToReplace) throw new Error(`Lead ${leadId} not found`);
  if (leadToReplace.approved) throw new Error(`Lead already approved — cannot replace`);

  const [permanentPreferences, recentFeedback, pipeline] = await Promise.all([
    getPermanentPreferences(AGENT_NAME).catch(() => [] as string[]),
    getRecentFeedback(AGENT_NAME, 24 * 14, ['report']).catch(
      () => [] as RecentFeedbackItem[],
    ),
    getActiveOutreachRows(NOTION_OUTREACH_TYPE, NOTION_VENTURE).catch(
      () => [] as OutreachPipelineRow[],
    ),
  ]);

  const memoryBlock = permanentPreferences.length
    ? '\n\n# Permanent preferences\n' + permanentPreferences.map((r) => `- ${r}`).join('\n')
    : '';

  const system =
    loadTalentContextFiles() +
    memoryBlock +
    renderRecentFeedback(recentFeedback) +
    '\n\n---\n\n' +
    REPLACE_SYSTEM_INSTRUCTIONS;

  const otherNames = batch.leads
    .filter((l) => l.lead_id !== leadId)
    .map((l) => l.artisan_name);
  const priorNames = (leadToReplace.previous_versions ?? []).map((v) => v.artisan_name);
  const pipelineNames = pipeline
    .map((p) => p.organization ?? p.name)
    .filter(Boolean) as string[];
  const blocked = Array.from(
    new Set([
      leadToReplace.artisan_name,
      ...otherNames,
      ...priorNames,
      ...pipelineNames,
    ]),
  );

  const user = `Replace this artisan lead.

# LEAD TO REPLACE
Artisan: ${leadToReplace.artisan_name}
Trade: ${leadToReplace.trade}
Location: ${leadToReplace.location}
Rationale: ${leadToReplace.fit_rationale}

# BRIANA'S FEEDBACK
${feedback ? feedback : '(no specific feedback — surface a different angle / trade)'}

# DO NOT RE-SURFACE (duplicates, pipeline, prior replacements, past guests per playbook §7)
${blocked.map((b) => `- ${b}`).join('\n')}

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
    artisan_name?: string;
    trade?: string;
    studio_or_shop?: string | null;
    location?: string;
    contact_email?: string | null;
    instagram_handle?: string | null;
    shop_website?: string | null;
    suggested_channel?: ArtisanChannel;
    fit_rationale?: string;
    discovery_story?: string;
    source_link?: string | null;
    trade_gap_fill?: boolean;
  };
  const parsed = tryParseJson<Candidate>(rawJson);
  if (!parsed?.artisan_name || !parsed?.trade) {
    throw new Error('Replacement returned no valid candidate.');
  }

  // New Contacts DB row for the replacement (old row stays — append-only).
  let newContactsRowId: string | null = null;
  try {
    newContactsRowId = await createContactRow({
      name: parsed.artisan_name,
      type: ['Podcast Guest'],
      connectionStatus: 'Need to Reach Out',
      email: parsed.contact_email ?? undefined,
      social: parsed.instagram_handle
        ? `https://instagram.com/${parsed.instagram_handle.replace(/^@/, '')}`
        : parsed.shop_website ?? undefined,
      industry: ['Artisan Trades'],
      notes: [
        `Trade: ${parsed.trade}`,
        parsed.studio_or_shop ? `Studio: ${parsed.studio_or_shop}` : null,
        parsed.location ? `Location: ${parsed.location}` : null,
        parsed.discovery_story ? `Discovery: ${parsed.discovery_story}` : null,
      ]
        .filter(Boolean)
        .join('\n'),
    });
  } catch (e) {
    console.error('[talent-scout] replacement Contacts DB write failed:', e);
  }

  const replacement: ArtisanLead = {
    lead_id: leadToReplace.lead_id,
    artisan_name: parsed.artisan_name,
    trade: parsed.trade,
    studio_or_shop: parsed.studio_or_shop ?? null,
    location: parsed.location ?? 'San Francisco',
    contact_email: parsed.contact_email ?? null,
    instagram_handle: parsed.instagram_handle ?? null,
    shop_website: parsed.shop_website ?? null,
    suggested_channel: parsed.suggested_channel ?? 'email',
    venn_test_result: '3-of-3',
    fit_rationale: parsed.fit_rationale ?? '',
    discovery_story: parsed.discovery_story ?? '',
    source_link: parsed.source_link ?? null,
    trade_gap_fill: parsed.trade_gap_fill === true,
    approved: false,
    draft_output_id: null,
    contacts_row_id: newContactsRowId,
    skipped: false,
    replaced_at: new Date().toISOString(),
    replacement_feedback: feedback || null,
    previous_versions: [
      ...(leadToReplace.previous_versions ?? []),
      {
        artisan_name: leadToReplace.artisan_name,
        trade: leadToReplace.trade,
        location: leadToReplace.location,
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
  mutate: (batch: ArtisanResearchBatch) => ArtisanResearchBatch;
}): Promise<void> {
  const db = supabaseAdmin();
  const { data: item } = await db
    .from('approval_queue')
    .select('full_output')
    .eq('id', params.parentQueueItemId)
    .single();
  if (!item) throw new Error('Parent queue item not found');
  const next = params.mutate((item.full_output ?? {}) as ArtisanResearchBatch);
  await db
    .from('approval_queue')
    .update({ full_output: next as unknown as Record<string, unknown> })
    .eq('id', params.parentQueueItemId);
  await db
    .from('agent_outputs')
    .update({ draft_content: next as unknown as Record<string, unknown> })
    .eq('id', params.parentOutputId);
}

export type { ThinkResult } from './base';
