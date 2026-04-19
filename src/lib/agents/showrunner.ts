import {
  getApprovedOutputsByType,
  logOutput,
  type ApprovedOutputExample,
} from '../agent-outputs';
import { createContentEntry } from '../notion/client';
import {
  getPermanentPreferences,
  getRecentFeedback,
  type RecentFeedbackItem,
} from '../supabase/client';
import { todayIsoPT } from '../time';
import { loadContextFile, runAgent, type RunAgentResult } from './base';

const AGENT_NAME = 'showrunner';
const TTS_VENTURE_ID = '194e5c03a7f480c2bbf9ed13f3656511';

export type EpisodeType = 'solo' | 'interview';

// One clip = one social post. fileUploadId is set by the API route after
// uploading the clip bytes to Notion; agent code treats it as opaque.
export interface ClipInput {
  description: string;
  fileUploadId?: string;
  publishDate?: string;
  // Platform hints — overrides defaults. e.g. ['IN@tradesshow', 'TIKTOK@tradesshow']
  platforms?: string[];
}

export interface ShowrunnerContext {
  transcript: string;
  episodeType: EpisodeType;
  transcriptWordCount: number;
  clips: ClipInput[];
  guestName: string;
  guestLinks: string;
  timestampedOutline: string;
  recentFeedback: RecentFeedbackItem[];
  exemplars: {
    substackPost: ApprovedOutputExample[];
    episodeMetadata: ApprovedOutputExample[];
    socialCaption: ApprovedOutputExample[];
  };
}

export interface ClipCaption {
  index: number;
  description: string;
  caption: string;
  hashtags: string[];
  fileUploadId?: string;
  publishDate?: string;
  platforms?: string[];
  contentEntryId?: string;
}

export interface ParsedShowrunnerOutput {
  // v2 field set — canonical going forward.
  substackTitle: string;
  substackSubtitle: string;
  substackPost: string; // was postDraft
  youtubeTitle: string; // new: SEO-leaning verbose
  spotifyTitle: string; // new: templated per episode type
  episodeDescription: string; // new: shared YT + Spotify body
  clipCaptions: ClipCaption[];
  contentPillars: string[];
  suggestedPostDate?: string;
  raw: string;

  // Legacy field carried forward for any code path that still reads them.
  // postDraft / episodeTitle / youtubeDescription / spotifyDescription are
  // mirrored from the v2 fields so executeShowrunnerDraft and the dashboard
  // keep rendering until fully migrated.
  postDraft: string;
  episodeTitle: string;
  youtubeDescription: string;
  spotifyDescription: string;
}

export interface ShowrunnerResult extends RunAgentResult<ShowrunnerContext> {
  parsed: ParsedShowrunnerOutput;
}

// Default platform set for TTS social clips when user doesn't specify.
const DEFAULT_SOCIAL_PLATFORMS = [
  'IN@tradesshow',
  'TIKTOK@tradesshow',
  'LI@brianaottoboni',
];

// ---------------------------------------------------------------------------
// Output parsing
// ---------------------------------------------------------------------------
function parseSection(text: string, header: string): string {
  const pattern = new RegExp(`### ${header}\\s*\\n([\\s\\S]*?)(?=\\n### |$)`);
  const match = text.match(pattern);
  return match?.[1]?.trim() ?? '';
}

function parsePillars(text: string): string[] {
  const section = parseSection(text, 'CONTENT PILLAR');
  if (!section) return [];
  return section
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function parsePostDate(text: string): string | undefined {
  const section = parseSection(text, 'SUGGESTED POST DATE');
  const m = section.match(/(\d{4}-\d{2}-\d{2})/);
  return m?.[1];
}

// Claude is instructed to emit one block per clip in the form:
//   ### CLIP 1 CAPTION
//   <caption body>
//   #hashtag1 #hashtag2
function parseClipCaptions(text: string, clips: ClipInput[]): ClipCaption[] {
  return clips.map((clip, i) => {
    const section = parseSection(text, `CLIP ${i + 1} CAPTION`);
    let caption = section;
    const hashtags: string[] = [];
    if (section) {
      // Split trailing hashtag line from caption body.
      const lines = section.split('\n');
      const lastLine = lines[lines.length - 1]?.trim() ?? '';
      if (lastLine.startsWith('#')) {
        hashtags.push(...lastLine.split(/\s+/).filter((w) => w.startsWith('#')));
        caption = lines.slice(0, -1).join('\n').trim();
      }
    }
    return {
      index: i + 1,
      description: clip.description,
      caption,
      hashtags,
      fileUploadId: clip.fileUploadId,
      publishDate: clip.publishDate,
      platforms: clip.platforms ?? DEFAULT_SOCIAL_PLATFORMS,
    };
  });
}

function parseShowrunnerOutput(text: string, clips: ClipInput[]): ParsedShowrunnerOutput {
  // Try v2 headers first. If a header is missing, fall back to the v1 equivalent
  // so this parser reads both shapes until the old prompt is fully retired.
  const substackTitle =
    parseSection(text, 'SUBSTACK TITLE') || parseSection(text, 'EPISODE TITLE');
  const substackSubtitle = parseSection(text, 'SUBSTACK SUBTITLE');
  const substackPost =
    parseSection(text, 'SUBSTACK POST') || parseSection(text, 'POST DRAFT');
  const youtubeTitle =
    parseSection(text, 'YOUTUBE TITLE') || parseSection(text, 'EPISODE TITLE');
  const spotifyTitle = parseSection(text, 'SPOTIFY TITLE');
  const episodeDescription =
    parseSection(text, 'EPISODE DESCRIPTION') ||
    parseSection(text, 'YOUTUBE DESCRIPTION');

  return {
    // v2 canonical
    substackTitle,
    substackSubtitle,
    substackPost,
    youtubeTitle,
    spotifyTitle,
    episodeDescription,
    clipCaptions: parseClipCaptions(text, clips),
    contentPillars: parsePillars(text),
    suggestedPostDate: parsePostDate(text),
    raw: text,
    // Legacy mirrors for any consumer still reading the old names.
    postDraft: substackPost,
    episodeTitle: substackTitle,
    youtubeDescription: episodeDescription,
    spotifyDescription:
      parseSection(text, 'SPOTIFY DESCRIPTION') || episodeDescription,
  };
}

// ---------------------------------------------------------------------------
// Prompt building — describes the required output structure in full so the
// parser can rely on stable section headers.
// ---------------------------------------------------------------------------
function renderClipsForPrompt(clips: ClipInput[]): string {
  if (!clips.length) return '(no clips provided — skip clip captions section)';
  return clips
    .map((c, i) => {
      const parts = [`CLIP ${i + 1}: ${c.description}`];
      if (c.publishDate) parts.push(`  publish_date=${c.publishDate}`);
      if (c.platforms?.length) parts.push(`  platforms=[${c.platforms.join(', ')}]`);
      if (c.fileUploadId) parts.push(`  has_video_file=yes`);
      return parts.join('\n');
    })
    .join('\n\n');
}

// Renders past approved/edited outputs of the same type as reference
// exemplars. The system prompt explicitly tells the model to treat these
// as "what good looks like" context, not as templates to copy.
function renderExemplarsBlock(
  label: string,
  examples: ApprovedOutputExample[],
  maxPerExample = 600,
): string {
  if (!examples.length) return '';
  const blocks = examples.map((ex, i) => {
    const tags = ex.tags?.length ? ` [tags: ${ex.tags.join(', ')}]` : '';
    const content = ex.final_content
      ? JSON.stringify(ex.final_content, null, 2).slice(0, maxPerExample)
      : '(no final_content)';
    const when = ex.approved_at ? ex.approved_at.slice(0, 10) : 'unknown';
    return `## Example ${i + 1} — approved ${when}${tags}\n${content}`;
  });
  return `\n\n---\n\n# Past approved ${label} — reference only, do NOT copy\nUse these to understand what "good" looks like for this output type. Write fresh work in the same voice and shape; don't recycle phrases.\n\n${blocks.join('\n\n')}`;
}

function renderFeedbackForPrompt(items: RecentFeedbackItem[]): string {
  if (!items.length) return '';
  const body = items
    .map((f) => {
      const date = (f.reviewed_at ?? f.created_at).slice(0, 10);
      const fb = f.feedback ? ` — "${f.feedback}"` : '';
      return `- [${f.status.toUpperCase()} ${date}] "${f.title}"${fb}`;
    })
    .join('\n');
  return `\n\n# RECENT FEEDBACK (last 14 days)\nBriana's corrections on past Showrunner drafts. Apply to this run; don't repeat the same choices.\n${body}`;
}

// Scope of an Update feedback pass. Determines which sub-outputs Claude
// regenerates vs preserves byte-identical from the prior run.
export type ShowrunnerUpdateScope =
  | 'social_captions'
  | 'episode_metadata'
  | 'substack_post'
  | 'all';

export interface ShowrunnerUpdateContext {
  feedback: string;
  scope?: ShowrunnerUpdateScope; // if omitted, agent infers from feedback text
  preserved: Partial<ParsedShowrunnerOutput>; // prior run's outputs to pass through
}

function renderUpdateBlock(ctx: ShowrunnerUpdateContext): string {
  const p = ctx.preserved;
  const scopeLine = ctx.scope
    ? `Scope (explicit): ${ctx.scope}`
    : `Scope: INFER from the feedback text. If the feedback names hashtags, captions, or clips → social_captions only. If it names title, description, YouTube, Spotify → episode_metadata only. If it names the post, newsletter, Substack body → substack_post only. If it's stylistic and clearly applies across → all.`;

  const priorSections: string[] = [];
  if (p.substackTitle)
    priorSections.push(`### PRIOR SUBSTACK TITLE\n${p.substackTitle}`);
  if (p.substackSubtitle)
    priorSections.push(`### PRIOR SUBSTACK SUBTITLE\n${p.substackSubtitle}`);
  if (p.youtubeTitle)
    priorSections.push(`### PRIOR YOUTUBE TITLE\n${p.youtubeTitle}`);
  if (p.spotifyTitle)
    priorSections.push(`### PRIOR SPOTIFY TITLE\n${p.spotifyTitle}`);
  if (p.episodeDescription)
    priorSections.push(`### PRIOR EPISODE DESCRIPTION\n${p.episodeDescription}`);
  if (p.substackPost)
    priorSections.push(`### PRIOR SUBSTACK POST\n${p.substackPost}`);
  if (p.clipCaptions?.length)
    priorSections.push(
      `### PRIOR CLIP CAPTIONS\n` +
        p.clipCaptions
          .map(
            (c, i) =>
              `Clip ${i + 1}: ${c.caption}\nhashtags: ${(c.hashtags ?? []).join(' ')}`,
          )
          .join('\n\n'),
    );

  return `\n\n---\n\n# UPDATE PASS — regenerate scoped to this feedback only

Briana hit Update with this feedback:
"""
${ctx.feedback}
"""

${scopeLine}

# RULES for this Update pass
1. Identify which sub-output the feedback applies to (or all if it's clearly stylistic).
2. For the in-scope sub-output: regenerate fully, applying the feedback as a hard constraint.
3. For out-of-scope sub-outputs: emit the PRIOR version BYTE-IDENTICAL. Do not rephrase, re-order, or "improve" them — just copy them through unchanged. Byte-identical means character-for-character the same.
4. The parser still expects every section (YOUTUBE TITLE, SPOTIFY TITLE, EPISODE DESCRIPTION, SUBSTACK TITLE, SUBSTACK SUBTITLE, CLIP N CAPTION, SUBSTACK POST, CONTENT PILLAR, SUGGESTED POST DATE). Emit all of them, preserved or regenerated per scope.
5. CONTENT PILLAR and SUGGESTED POST DATE are metadata — preserve unless the feedback specifically targets them.

# PRIOR OUTPUTS (copy these through verbatim unless they're in scope)

${priorSections.join('\n\n')}`;
}

// ---------------------------------------------------------------------------
// Run Showrunner
// ---------------------------------------------------------------------------
export async function runShowrunner(
  params: {
    transcript: string;
    episodeType: EpisodeType;
    clips?: ClipInput[];
    guestName?: string;
    guestLinks?: string;
    timestampedOutline?: string;
    trigger?: 'manual' | 'cron' | 'chat';
    /** Present when this run was triggered from the Update button. The agent
     *  applies the feedback scoped to the relevant sub-output and preserves
     *  other sub-outputs byte-identical. */
    updateContext?: ShowrunnerUpdateContext;
  },
): Promise<ShowrunnerResult> {
  const clips = params.clips ?? [];
  const trigger = params.trigger ?? 'manual';
  const guestName = (params.guestName ?? '').trim();
  const guestLinks = (params.guestLinks ?? '').trim();
  const timestampedOutline = (params.timestampedOutline ?? '').trim();
  const updateContext = params.updateContext;
  let parsed: ParsedShowrunnerOutput | null = null;

  const result = await runAgent<ShowrunnerContext>({
    agentName: AGENT_NAME,
    trigger,
    maxTokens: 8000,

    gatherContext: async () => {
      // Playbook: 14-day feedback window for scheduled/cadenced runs. Showrunner
      // runs are on-demand per transcript, but 14d keeps us aligned with Ops
      // Chief and gives enough signal.
      const [recentFeedback, substackPost, episodeMetadata, socialCaption] =
        await Promise.all([
          getRecentFeedback(AGENT_NAME, 24 * 14, ['draft']).catch(() => []),
          getApprovedOutputsByType({
            agentId: 'showrunner',
            venture: 'trades-show',
            outputType: 'substack_post',
            limit: 5,
            requireFinalContent: true,
          }).catch(() => []),
          getApprovedOutputsByType({
            agentId: 'showrunner',
            venture: 'trades-show',
            outputType: 'episode_metadata',
            limit: 5,
            requireFinalContent: true,
          }).catch(() => []),
          getApprovedOutputsByType({
            agentId: 'showrunner',
            venture: 'trades-show',
            outputType: 'social_caption',
            limit: 5,
            requireFinalContent: true,
          }).catch(() => []),
        ]);
      return {
        transcript: params.transcript,
        episodeType: params.episodeType,
        transcriptWordCount: params.transcript.split(/\s+/).filter(Boolean).length,
        clips,
        guestName,
        guestLinks,
        timestampedOutline,
        recentFeedback,
        exemplars: {
          substackPost,
          episodeMetadata,
          socialCaption,
        },
      };
    },

    summarizeContext: (ctx) =>
      `type=${ctx.episodeType} words=${ctx.transcriptWordCount} clips=${ctx.clips.length} guest=${ctx.guestName ? 'y' : 'n'} outline=${ctx.timestampedOutline ? 'provided' : 'generate'} feedback=${ctx.recentFeedback.length} exemplars=sp${ctx.exemplars.substackPost.length}/em${ctx.exemplars.episodeMetadata.length}/sc${ctx.exemplars.socialCaption.length}`,

    buildPrompt: async (ctx) => {
      const permanentPreferences = await getPermanentPreferences(AGENT_NAME);
      let memoryBlock = '';
      if (permanentPreferences.length) {
        memoryBlock =
          '\n\n---\n\n# Permanent Preferences (from past feedback)\nFollow these rules — direct instructions from Briana.\n' +
          permanentPreferences.map((r) => `- ${r}`).join('\n');
      }

      const clipsBlock = renderClipsForPrompt(ctx.clips);
      const feedbackBlock = renderFeedbackForPrompt(ctx.recentFeedback);

      // Conditional sub-voice file loading per system-prompt v2. The current
      // runShowrunner is a one-shot that produces all output types — so every
      // voice file that exists and is relevant gets loaded. Substack voice file
      // is not yet written; loadContextFile returns '' for missing files.
      const substackVoice = loadContextFile('agents/showrunner/substack-voice.md');
      const socialCaptionsVoice = ctx.clips.length
        ? loadContextFile('agents/showrunner/social-captions-voice.md')
        : '';
      const episodeMetadataVoice = loadContextFile(
        'agents/showrunner/episode-metadata-voice.md',
      );
      const voiceSection = [substackVoice, socialCaptionsVoice, episodeMetadataVoice]
        .filter(Boolean)
        .join('\n\n---\n\n');

      const exemplarsBlock =
        renderExemplarsBlock('Substack posts', ctx.exemplars.substackPost, 900) +
        renderExemplarsBlock('episode metadata', ctx.exemplars.episodeMetadata, 600) +
        renderExemplarsBlock('social captions', ctx.exemplars.socialCaption, 300);

      const clipInstructions = ctx.clips.length
        ? `Write one caption per clip listed below. Each clip gets its own \`### CLIP N CAPTION\` section where N is the clip number. Caption body is 1-3 sentences (hook in first sentence), then a blank line, then exactly \`Full episode linked in bio\` on its own line, then exactly 5 hashtags on a single line starting with #TheTradesShow. No Substack references anywhere.`
        : `No clips provided — omit CLIP CAPTION sections entirely.`;

      const system =
        loadContextFile('system.md') +
        '\n\n---\n\n' +
        loadContextFile('ventures/trades-show.md') +
        '\n\n---\n\n' +
        loadContextFile('workflows/trades-show-pipeline.md') +
        '\n\n---\n\n' +
        loadContextFile('agents/showrunner/system-prompt.md') +
        (voiceSection ? '\n\n---\n\n' + voiceSection : '') +
        exemplarsBlock +
        '\n\n---\n\n' +
        `# Output structure v2 (REQUIRED — parser depends on exact headers)

Emit sections in this exact order. Use the exact \`### HEADER\` text shown.

### YOUTUBE TITLE
<SEO-leaning, verbose, 70-95 chars. Example shape: "Artisan Crafts in the
Age of AI plus Why I Started a Show About Them in San Francisco". Stuff
real search terms without keyword spam.>

### SPOTIFY TITLE
<templated per episode type — see system prompt v2 rules>
- Solo: "[Episode #]. [Title] with Host Briana Ottoboni"
- Guest: "[Episode #]. [3-4 WORD ALL CAPS PHRASE NAMING THE TRADE]: [Trade Title + Guest Name] on [central themes]"
Infer [Episode #] from transcript + playbook + retrieval exemplars; use
"TBD" if you truly cannot.

### EPISODE DESCRIPTION
<ONE shared description used for both YouTube and Spotify. Follow the
YouTube description template in the pipeline workflow — hook in first 2
lines, guest links block (interview), timestamps, "Where to find"
blocks. 300-500 words.>

### SUBSTACK TITLE
<one line, the post headline — distinct from subtitle. Warm, specific.>

### SUBSTACK SUBTITLE
<one-sentence subtitle.>

### CLIP 1 CAPTION
<caption body — 1-3 sentences, hook in first sentence>

Full episode linked in bio
#TheTradesShow #hashtag2 #hashtag3 #hashtag4 #hashtag5

### CLIP 2 CAPTION
<same structure — body, blank line, "Full episode linked in bio", blank line, exactly 5 hashtags>
...

### SUBSTACK POST
<full Substack post in markdown, starting with a # H1 of the substack
title. Format per pipeline workflow — adapted essay for solo, exact
transcript with topic headers for interview. Follow the interview
speaker-formatting rules (full name on first mention, short form/initials
after). This is the ONLY place the transcript appears. No clickbait.>

### CONTENT PILLAR
<comma-separated pillars, e.g. Craft, Slow Renaissance>

### SUGGESTED POST DATE
YYYY-MM-DD

${clipInstructions}` +
        memoryBlock;

      const guestBlock =
        ctx.episodeType === 'interview' && (ctx.guestName || ctx.guestLinks)
          ? `# GUEST\nName: ${ctx.guestName || '(not provided — infer from transcript)'}\nLinks (use verbatim in "Where to find {guest}" block):\n${ctx.guestLinks || '(none provided)'}\n\n`
          : ctx.episodeType === 'interview'
            ? `# GUEST\n(no guest info provided — infer name from transcript, omit "Where to find" links if you cannot find them)\n\n`
            : `# GUEST\n(solo episode — omit the "Where to find {guest}" block entirely)\n\n`;

      const outlineBlock = ctx.timestampedOutline
        ? `# TIMESTAMPED OUTLINE (use verbatim in "In this episode" section)\n${ctx.timestampedOutline}\n\n`
        : `# TIMESTAMPED OUTLINE\n(none provided — generate 10-20 chapter markers from the transcript in "MM:SS Title" format)\n\n`;

      // Update context — present when this run was triggered from the Update
      // button. Gives Claude the prior outputs + the new feedback so it can
      // regenerate only the affected sub-output and emit the rest verbatim.
      const updateBlock = updateContext
        ? renderUpdateBlock(updateContext)
        : '';

      const user =
        `Episode type: ${ctx.episodeType}\n` +
        `Word count: ${ctx.transcriptWordCount}\n` +
        `Today's date: ${todayIsoPT()}\n\n` +
        guestBlock +
        outlineBlock +
        `# TRANSCRIPT\n\n${ctx.transcript}\n\n` +
        `# CLIPS\n${clipsBlock}` +
        feedbackBlock +
        updateBlock +
        `\n\nProduce all outputs following the format in your system prompt. For the YOUTUBE DESCRIPTION, follow the template in the pipeline workflow exactly — including emoji spacing, line breaks, and the fixed "Where to find The Trades Show" and "Where to find your host, Briana" blocks.`;

      return { system, user };
    },

    buildDeposit: (ctx, r) => {
      parsed = parseShowrunnerOutput(r.text, ctx.clips);
      const titleDisplay =
        parsed.substackTitle ||
        parsed.youtubeTitle ||
        'Episode Content Package';
      return {
        type: 'draft' as const,
        title: `Showrunner — ${titleDisplay}`,
        summary: `${ctx.episodeType} episode | ${ctx.transcriptWordCount} words | ${parsed.clipCaptions.length} clips`,
        full_output: {
          episode_type: ctx.episodeType,
          // v2 fields
          substack_title: parsed.substackTitle,
          substack_subtitle: parsed.substackSubtitle,
          substack_post: parsed.substackPost,
          youtube_title: parsed.youtubeTitle,
          spotify_title: parsed.spotifyTitle,
          episode_description: parsed.episodeDescription,
          clip_captions: parsed.clipCaptions,
          content_pillars: parsed.contentPillars,
          suggested_post_date: parsed.suggestedPostDate,
          // Legacy mirrors (so executeShowrunnerDraft + pre-v2 dashboard
          // cards keep rendering without a migration).
          post_draft: parsed.substackPost,
          episode_title: parsed.substackTitle,
          youtube_description: parsed.episodeDescription,
          spotify_description: parsed.episodeDescription,
          social_captions: parsed.clipCaptions.map((c) => c.caption),
          raw_output: r.text,
          // Inputs — stored so a reject-with-feedback retry can re-run with
          // the same transcript/clips/guest info and only the feedback changes.
          inputs: {
            transcript: ctx.transcript,
            episode_type: ctx.episodeType,
            guest_name: ctx.guestName,
            guest_links: ctx.guestLinks,
            timestamped_outline: ctx.timestampedOutline,
            clips: ctx.clips,
          },
        },
        initiative: 'The Trades Show',
      };
    },
    output: {
      venture: 'trades-show',
      // Parent row = the substack_post — the primary writing artifact.
      // episode_metadata + per-caption rows log as children below.
      outputType: 'substack_post',
      tags: (ctx) =>
        ['episode', ctx.episodeType, ctx.guestName].filter(Boolean) as string[],
      children: async ({ ctx, runId, parentOutputId }) => {
        // Parsed is set by buildDeposit immediately before; safe to reference.
        if (!parsed) return;

        // 1 episode_metadata row — v2 fields
        await logOutput({
          agentId: 'showrunner',
          venture: 'trades-show',
          outputType: 'episode_metadata',
          parentOutputId,
          runId,
          draftContent: {
            substack_title: parsed.substackTitle,
            substack_subtitle: parsed.substackSubtitle,
            youtube_title: parsed.youtubeTitle,
            spotify_title: parsed.spotifyTitle,
            episode_description: parsed.episodeDescription,
          },
          tags: ['episode_metadata', ctx.episodeType],
        });

        // One social_caption row per clip. Supervisor needs per-caption
        // granularity to cluster which specific captions Briana edits or
        // rejects.
        for (const clip of parsed.clipCaptions) {
          await logOutput({
            agentId: 'showrunner',
            venture: 'trades-show',
            outputType: 'social_caption',
            parentOutputId,
            runId,
            draftContent: {
              clip_index: clip.index,
              clip_description: clip.description,
              caption: clip.caption,
              hashtags: clip.hashtags,
              platforms: clip.platforms,
            },
            tags: [
              'social_caption',
              `clip_${clip.index}`,
              ...(clip.platforms ?? []),
            ],
          });
        }
      },
    },
  });

  return {
    ...result,
    parsed: parsed ?? parseShowrunnerOutput(result.result.text, clips),
  };
}

// ---------------------------------------------------------------------------
// Execute a Showrunner draft — called when Briana approves the queue item.
// Creates the Notion Content DB entries (one Newsletter + one per clip).
// Idempotent via the queue item's `notion_entries_created` flag, so double-
// clicks on Approve don't duplicate entries.
// ---------------------------------------------------------------------------
export interface ShowrunnerExecuteResult {
  newsletterId?: string;
  clipIds: { index: number; contentEntryId: string }[];
  errors: string[];
}

export async function executeShowrunnerDraft(
  fullOutput: Record<string, unknown>,
): Promise<ShowrunnerExecuteResult> {
  // v2 fields preferred; fall back to v1 names so existing queue items still execute.
  const substackPost = String(
    fullOutput.substack_post ?? fullOutput.post_draft ?? '',
  );
  const episodeTitle = String(
    fullOutput.substack_title ?? fullOutput.episode_title ?? 'Episode',
  );
  const substackSubtitle = String(fullOutput.substack_subtitle ?? '');
  const contentPillars = Array.isArray(fullOutput.content_pillars)
    ? (fullOutput.content_pillars as string[])
    : [];
  const suggestedPostDate =
    typeof fullOutput.suggested_post_date === 'string'
      ? fullOutput.suggested_post_date
      : undefined;
  const clipCaptions = (Array.isArray(fullOutput.clip_captions)
    ? (fullOutput.clip_captions as ClipCaption[])
    : []) as ClipCaption[];

  const result: ShowrunnerExecuteResult = { clipIds: [], errors: [] };

  if (substackPost) {
    try {
      result.newsletterId = await createContentEntry({
        name: `${episodeTitle} — Newsletter`,
        contentType: ['Newsletter'],
        platforms: ['Trade Secrets Substack'],
        contentPillar: contentPillars,
        publishDate: suggestedPostDate,
        ventureIds: [TTS_VENTURE_ID],
        caption: substackSubtitle,
      });
    } catch (e) {
      result.errors.push(`Newsletter: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // v2: clip Content DB rows are NOT created on approve anymore. Each clip
  // gets a per-clip Schedule button on the dashboard; when Briana schedules
  // one, the showrunner scheduling route uploads the file from Supabase
  // Storage → Notion and creates the Content DB row with date + time.
  // The Newsletter still creates on approve (above) because scheduling a
  // Substack post is a single decision, not per-clip.

  return result;
}

// Hydrate a stored full_output back into the ParsedShowrunnerOutput shape so
// runShowrunner's updateContext can reference it for byte-identical preserve
// passes. v2 fields preferred, v1 mirrors as fallback.
export function extractShowrunnerPreserved(
  fullOutput: Record<string, unknown>,
): Partial<ParsedShowrunnerOutput> {
  const str = (k: string): string | undefined => {
    const v = fullOutput[k];
    return typeof v === 'string' ? v : undefined;
  };
  const clipCaptions = Array.isArray(fullOutput.clip_captions)
    ? (fullOutput.clip_captions as ClipCaption[])
    : [];
  const contentPillars = Array.isArray(fullOutput.content_pillars)
    ? (fullOutput.content_pillars as string[])
    : undefined;
  return {
    substackTitle: str('substack_title') ?? str('episode_title'),
    substackSubtitle: str('substack_subtitle'),
    substackPost: str('substack_post') ?? str('post_draft'),
    youtubeTitle: str('youtube_title') ?? str('episode_title'),
    spotifyTitle: str('spotify_title'),
    episodeDescription:
      str('episode_description') ?? str('youtube_description'),
    clipCaptions,
    contentPillars,
    suggestedPostDate: str('suggested_post_date'),
  };
}

// Extract the original inputs from a Showrunner queue item's full_output so
// a retry can re-run with the same transcript plus whatever new feedback is
// now loaded by getRecentFeedback.
export function extractShowrunnerInputs(
  fullOutput: Record<string, unknown>,
): {
  transcript: string;
  episodeType: EpisodeType;
  guestName: string;
  guestLinks: string;
  timestampedOutline: string;
  clips: ClipInput[];
} | null {
  const inputs = fullOutput.inputs as Record<string, unknown> | undefined;
  if (!inputs || typeof inputs.transcript !== 'string' || !inputs.transcript.trim()) {
    return null;
  }
  return {
    transcript: inputs.transcript,
    episodeType: inputs.episode_type === 'interview' ? 'interview' : 'solo',
    guestName: typeof inputs.guest_name === 'string' ? inputs.guest_name : '',
    guestLinks: typeof inputs.guest_links === 'string' ? inputs.guest_links : '',
    timestampedOutline:
      typeof inputs.timestamped_outline === 'string' ? inputs.timestamped_outline : '',
    clips: Array.isArray(inputs.clips) ? (inputs.clips as ClipInput[]) : [],
  };
}
