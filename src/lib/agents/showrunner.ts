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

// Each run produces a queue item tagged with its output_kind so QueueCard +
// approve/update/retry routes know which renderer and regen path to use.
export type ShowrunnerOutputKind =
  | 'substack_post'
  | 'episode_metadata'
  | 'social_captions';

// One clip = one social post. fileUploadId stays opaque to agent code.
export interface ClipInput {
  description: string;
  fileUploadId?: string;
  publishDate?: string;
  platforms?: string[];
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

const DEFAULT_SOCIAL_PLATFORMS = [
  'IN@tradesshow',
  'TIKTOK@tradesshow',
  'LI@brianaottoboni',
];

// ---------------------------------------------------------------------------
// Shared helpers
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
  return `\n\n---\n\n# Past approved ${label} — reference only, do NOT copy\nUse these to understand what "good" looks like. Write fresh work in the same voice and shape; don't recycle phrases.\n\n${blocks.join('\n\n')}`;
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

async function buildMemoryBlock(): Promise<string> {
  const prefs = await getPermanentPreferences(AGENT_NAME);
  if (!prefs.length) return '';
  return (
    '\n\n---\n\n# Permanent Preferences (from past feedback)\nFollow these rules — direct instructions from Briana.\n' +
    prefs.map((r) => `- ${r}`).join('\n')
  );
}

function renderGuestBlock(
  episodeType: EpisodeType,
  guestName: string,
  guestLinks: string,
): string {
  if (episodeType !== 'interview') {
    return `# GUEST\n(solo episode — omit the "Where to find {guest}" block entirely)\n\n`;
  }
  if (guestName || guestLinks) {
    return `# GUEST\nName: ${guestName || '(not provided — infer from transcript)'}\nLinks (use verbatim in "Where to find {guest}" block):\n${guestLinks || '(none provided)'}\n\n`;
  }
  return `# GUEST\n(no guest info provided — infer name from transcript, omit "Where to find" links if you cannot find them)\n\n`;
}

// ---------------------------------------------------------------------------
// Run 1 — Substack post
// ---------------------------------------------------------------------------
export interface SubstackPostContext {
  transcript: string;
  episodeType: EpisodeType;
  transcriptWordCount: number;
  guestName: string;
  guestLinks: string;
  recentFeedback: RecentFeedbackItem[];
  exemplars: ApprovedOutputExample[];
}

export interface ParsedSubstackPost {
  substackTitle: string;
  substackSubtitle: string;
  substackPost: string;
  contentPillars: string[];
  suggestedPostDate?: string;
  raw: string;
}

export interface SubstackPostResult extends RunAgentResult<SubstackPostContext> {
  parsed: ParsedSubstackPost;
}

function parseSubstackPost(text: string): ParsedSubstackPost {
  return {
    substackTitle: parseSection(text, 'SUBSTACK TITLE'),
    substackSubtitle: parseSection(text, 'SUBSTACK SUBTITLE'),
    substackPost: parseSection(text, 'SUBSTACK POST'),
    contentPillars: parsePillars(text),
    suggestedPostDate: parsePostDate(text),
    raw: text,
  };
}

export async function runShowrunnerSubstackPost(params: {
  transcript: string;
  episodeType: EpisodeType;
  guestName?: string;
  guestLinks?: string;
  trigger?: 'manual' | 'cron' | 'chat';
  updateFeedback?: string;
}): Promise<SubstackPostResult> {
  const trigger = params.trigger ?? 'manual';
  const guestName = (params.guestName ?? '').trim();
  const guestLinks = (params.guestLinks ?? '').trim();
  let parsed: ParsedSubstackPost | null = null;

  const result = await runAgent<SubstackPostContext>({
    agentName: AGENT_NAME,
    trigger,
    maxTokens: 6000,

    gatherContext: async () => {
      const [recentFeedback, exemplars] = await Promise.all([
        getRecentFeedback(AGENT_NAME, 24 * 14, ['draft']).catch(() => []),
        getApprovedOutputsByType({
          agentId: 'showrunner',
          venture: 'trades-show',
          outputType: 'substack_post',
          limit: 5,
          requireFinalContent: true,
        }).catch(() => []),
      ]);
      return {
        transcript: params.transcript,
        episodeType: params.episodeType,
        transcriptWordCount: params.transcript.split(/\s+/).filter(Boolean).length,
        guestName,
        guestLinks,
        recentFeedback,
        exemplars,
      };
    },

    summarizeContext: (ctx) =>
      `kind=substack_post type=${ctx.episodeType} words=${ctx.transcriptWordCount} guest=${ctx.guestName ? 'y' : 'n'} feedback=${ctx.recentFeedback.length} exemplars=${ctx.exemplars.length}${params.updateFeedback ? ' update=y' : ''}`,

    buildPrompt: async (ctx) => {
      const memoryBlock = await buildMemoryBlock();
      const feedbackBlock = renderFeedbackForPrompt(ctx.recentFeedback);
      const substackVoice = loadContextFile('agents/showrunner/substack-voice.md');
      const exemplarsBlock = renderExemplarsBlock(
        'Substack posts',
        ctx.exemplars,
        900,
      );

      const updateBlock = params.updateFeedback
        ? `\n\n---\n\n# UPDATE PASS\nBriana hit Update with this feedback:\n"""\n${params.updateFeedback}\n"""\nApply it as a hard constraint when regenerating the Substack post.`
        : '';

      const system =
        loadContextFile('system.md') +
        '\n\n---\n\n' +
        loadContextFile('ventures/trades-show.md') +
        '\n\n---\n\n' +
        loadContextFile('workflows/trades-show-pipeline.md') +
        '\n\n---\n\n' +
        loadContextFile('agents/showrunner/system-prompt.md') +
        (substackVoice ? '\n\n---\n\n' + substackVoice : '') +
        exemplarsBlock +
        '\n\n---\n\n' +
        `# Output structure (REQUIRED — parser depends on exact headers)

Emit sections in this exact order. Use the exact \`### HEADER\` text shown.

### SUBSTACK TITLE
<one line, the post headline. Warm, specific.>

### SUBSTACK SUBTITLE
<one-sentence subtitle.>

### SUBSTACK POST
<full Substack post in markdown, starting with a # H1 of the substack
title. Format per pipeline workflow — adapted essay for solo, exact
transcript with topic headers for interview. Follow the interview
speaker-formatting rules (full name on first mention, short form/initials
after). No clickbait.>

### CONTENT PILLAR
<comma-separated pillars, e.g. Craft, Slow Renaissance>

### SUGGESTED POST DATE
YYYY-MM-DD` +
        memoryBlock;

      const guestBlock = renderGuestBlock(ctx.episodeType, ctx.guestName, ctx.guestLinks);

      const user =
        `Episode type: ${ctx.episodeType}\n` +
        `Word count: ${ctx.transcriptWordCount}\n` +
        `Today's date: ${todayIsoPT()}\n\n` +
        guestBlock +
        `# TRANSCRIPT\n\n${ctx.transcript}\n\n` +
        feedbackBlock +
        updateBlock;

      return { system, user };
    },

    buildDeposit: (ctx, r) => {
      parsed = parseSubstackPost(r.text);
      const titleDisplay = parsed.substackTitle || 'Substack post';
      return {
        type: 'draft' as const,
        title: `Showrunner — ${titleDisplay}`,
        summary: `Substack post · ${ctx.episodeType} · ${ctx.transcriptWordCount} words`,
        full_output: {
          output_kind: 'substack_post' satisfies ShowrunnerOutputKind,
          episode_type: ctx.episodeType,
          substack_title: parsed.substackTitle,
          substack_subtitle: parsed.substackSubtitle,
          substack_post: parsed.substackPost,
          content_pillars: parsed.contentPillars,
          suggested_post_date: parsed.suggestedPostDate,
          raw_output: r.text,
          inputs: {
            transcript: ctx.transcript,
            episode_type: ctx.episodeType,
            guest_name: ctx.guestName,
            guest_links: ctx.guestLinks,
          },
        },
        initiative: 'The Trades Show',
      };
    },
    output: {
      venture: 'trades-show',
      outputType: 'substack_post',
      tags: (ctx) =>
        ['episode', 'substack_post', ctx.episodeType, ctx.guestName].filter(
          Boolean,
        ) as string[],
    },
  });

  return {
    ...result,
    parsed: parsed ?? parseSubstackPost(result.result.text),
  };
}

// ---------------------------------------------------------------------------
// Run 2 — Episode metadata (YT title, Spotify title, shared description)
// ---------------------------------------------------------------------------
export interface EpisodeMetadataContext {
  transcript: string;
  episodeType: EpisodeType;
  transcriptWordCount: number;
  guestName: string;
  guestLinks: string;
  timestampedOutline: string;
  recentFeedback: RecentFeedbackItem[];
  exemplars: ApprovedOutputExample[];
}

export interface ParsedEpisodeMetadata {
  youtubeTitle: string;
  spotifyTitle: string;
  episodeDescription: string;
  raw: string;
}

export interface EpisodeMetadataResult extends RunAgentResult<EpisodeMetadataContext> {
  parsed: ParsedEpisodeMetadata;
}

function parseEpisodeMetadata(text: string): ParsedEpisodeMetadata {
  return {
    youtubeTitle: parseSection(text, 'YOUTUBE TITLE'),
    spotifyTitle: parseSection(text, 'SPOTIFY TITLE'),
    episodeDescription: parseSection(text, 'EPISODE DESCRIPTION'),
    raw: text,
  };
}

export async function runShowrunnerEpisodeMetadata(params: {
  transcript: string;
  episodeType: EpisodeType;
  guestName?: string;
  guestLinks?: string;
  timestampedOutline?: string;
  trigger?: 'manual' | 'cron' | 'chat';
  updateFeedback?: string;
}): Promise<EpisodeMetadataResult> {
  const trigger = params.trigger ?? 'manual';
  const guestName = (params.guestName ?? '').trim();
  const guestLinks = (params.guestLinks ?? '').trim();
  const timestampedOutline = (params.timestampedOutline ?? '').trim();
  let parsed: ParsedEpisodeMetadata | null = null;

  const result = await runAgent<EpisodeMetadataContext>({
    agentName: AGENT_NAME,
    trigger,
    maxTokens: 4000,

    gatherContext: async () => {
      const [recentFeedback, exemplars] = await Promise.all([
        getRecentFeedback(AGENT_NAME, 24 * 14, ['draft']).catch(() => []),
        getApprovedOutputsByType({
          agentId: 'showrunner',
          venture: 'trades-show',
          outputType: 'episode_metadata',
          limit: 5,
          requireFinalContent: true,
        }).catch(() => []),
      ]);
      return {
        transcript: params.transcript,
        episodeType: params.episodeType,
        transcriptWordCount: params.transcript.split(/\s+/).filter(Boolean).length,
        guestName,
        guestLinks,
        timestampedOutline,
        recentFeedback,
        exemplars,
      };
    },

    summarizeContext: (ctx) =>
      `kind=episode_metadata type=${ctx.episodeType} words=${ctx.transcriptWordCount} guest=${ctx.guestName ? 'y' : 'n'} outline=${ctx.timestampedOutline ? 'provided' : 'generate'} feedback=${ctx.recentFeedback.length} exemplars=${ctx.exemplars.length}${params.updateFeedback ? ' update=y' : ''}`,

    buildPrompt: async (ctx) => {
      const memoryBlock = await buildMemoryBlock();
      const feedbackBlock = renderFeedbackForPrompt(ctx.recentFeedback);
      const metadataVoice = loadContextFile(
        'agents/showrunner/episode-metadata-voice.md',
      );
      const exemplarsBlock = renderExemplarsBlock(
        'episode metadata',
        ctx.exemplars,
        600,
      );

      const updateBlock = params.updateFeedback
        ? `\n\n---\n\n# UPDATE PASS\nBriana hit Update with this feedback:\n"""\n${params.updateFeedback}\n"""\nApply it as a hard constraint when regenerating the titles and description.`
        : '';

      const system =
        loadContextFile('system.md') +
        '\n\n---\n\n' +
        loadContextFile('ventures/trades-show.md') +
        '\n\n---\n\n' +
        loadContextFile('workflows/trades-show-pipeline.md') +
        '\n\n---\n\n' +
        loadContextFile('agents/showrunner/system-prompt.md') +
        (metadataVoice ? '\n\n---\n\n' + metadataVoice : '') +
        exemplarsBlock +
        '\n\n---\n\n' +
        `# Output structure (REQUIRED — parser depends on exact headers)

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
blocks. 300-500 words.>` +
        memoryBlock;

      const guestBlock = renderGuestBlock(ctx.episodeType, ctx.guestName, ctx.guestLinks);

      const outlineBlock = ctx.timestampedOutline
        ? `# TIMESTAMPED OUTLINE (use verbatim in "In this episode" section)\n${ctx.timestampedOutline}\n\n`
        : `# TIMESTAMPED OUTLINE\n(none provided — generate 10-20 chapter markers from the transcript in "MM:SS Title" format)\n\n`;

      const user =
        `Episode type: ${ctx.episodeType}\n` +
        `Word count: ${ctx.transcriptWordCount}\n` +
        `Today's date: ${todayIsoPT()}\n\n` +
        guestBlock +
        outlineBlock +
        `# TRANSCRIPT\n\n${ctx.transcript}\n\n` +
        feedbackBlock +
        updateBlock +
        `\n\nFor the EPISODE DESCRIPTION, follow the template in the pipeline workflow exactly — including emoji spacing, line breaks, and the fixed "Where to find The Trades Show" and "Where to find your host, Briana" blocks.`;

      return { system, user };
    },

    buildDeposit: (ctx, r) => {
      parsed = parseEpisodeMetadata(r.text);
      const titleDisplay = parsed.youtubeTitle || 'Episode metadata';
      return {
        type: 'draft' as const,
        title: `Showrunner — ${titleDisplay}`,
        summary: `Title & description · ${ctx.episodeType} · ${ctx.transcriptWordCount} words`,
        full_output: {
          output_kind: 'episode_metadata' satisfies ShowrunnerOutputKind,
          episode_type: ctx.episodeType,
          youtube_title: parsed.youtubeTitle,
          spotify_title: parsed.spotifyTitle,
          episode_description: parsed.episodeDescription,
          raw_output: r.text,
          inputs: {
            transcript: ctx.transcript,
            episode_type: ctx.episodeType,
            guest_name: ctx.guestName,
            guest_links: ctx.guestLinks,
            timestamped_outline: ctx.timestampedOutline,
          },
        },
        initiative: 'The Trades Show',
      };
    },
    output: {
      venture: 'trades-show',
      outputType: 'episode_metadata',
      tags: (ctx) =>
        ['episode', 'episode_metadata', ctx.episodeType, ctx.guestName].filter(
          Boolean,
        ) as string[],
    },
  });

  return {
    ...result,
    parsed: parsed ?? parseEpisodeMetadata(result.result.text),
  };
}

// ---------------------------------------------------------------------------
// Run 3 — Social captions (one caption per clip; no full episode transcript)
// ---------------------------------------------------------------------------
export interface SocialCaptionsContext {
  clips: ClipInput[];
  episodeType: EpisodeType;
  episodeContextNote: string;
  recentFeedback: RecentFeedbackItem[];
  exemplars: ApprovedOutputExample[];
}

export interface ParsedSocialCaptions {
  clipCaptions: ClipCaption[];
  raw: string;
}

export interface SocialCaptionsResult extends RunAgentResult<SocialCaptionsContext> {
  parsed: ParsedSocialCaptions;
}

function parseSocialCaptions(text: string, clips: ClipInput[]): ParsedSocialCaptions {
  const clipCaptions = clips.map((clip, i) => {
    const section = parseSection(text, `CLIP ${i + 1} CAPTION`);
    let caption = section;
    const hashtags: string[] = [];
    if (section) {
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
  return { clipCaptions, raw: text };
}

function renderClipsForPrompt(clips: ClipInput[]): string {
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

export async function runShowrunnerSocialCaptions(params: {
  clips: ClipInput[];
  episodeType: EpisodeType;
  episodeContextNote?: string;
  trigger?: 'manual' | 'cron' | 'chat';
  updateFeedback?: string;
}): Promise<SocialCaptionsResult> {
  const trigger = params.trigger ?? 'manual';
  const episodeContextNote = (params.episodeContextNote ?? '').trim();
  const clips = params.clips;
  let parsed: ParsedSocialCaptions | null = null;

  if (!clips.length) {
    throw new Error('At least one clip is required for the captions run.');
  }

  const result = await runAgent<SocialCaptionsContext>({
    agentName: AGENT_NAME,
    trigger,
    maxTokens: 3000,

    gatherContext: async () => {
      const [recentFeedback, exemplars] = await Promise.all([
        getRecentFeedback(AGENT_NAME, 24 * 14, ['draft']).catch(() => []),
        getApprovedOutputsByType({
          agentId: 'showrunner',
          venture: 'trades-show',
          outputType: 'social_caption',
          limit: 5,
          requireFinalContent: true,
        }).catch(() => []),
      ]);
      return {
        clips,
        episodeType: params.episodeType,
        episodeContextNote,
        recentFeedback,
        exemplars,
      };
    },

    summarizeContext: (ctx) =>
      `kind=social_captions type=${ctx.episodeType} clips=${ctx.clips.length} context=${ctx.episodeContextNote ? 'y' : 'n'} feedback=${ctx.recentFeedback.length} exemplars=${ctx.exemplars.length}${params.updateFeedback ? ' update=y' : ''}`,

    buildPrompt: async (ctx) => {
      const memoryBlock = await buildMemoryBlock();
      const feedbackBlock = renderFeedbackForPrompt(ctx.recentFeedback);
      const captionsVoice = loadContextFile(
        'agents/showrunner/social-captions-voice.md',
      );
      const exemplarsBlock = renderExemplarsBlock(
        'social captions',
        ctx.exemplars,
        300,
      );

      const updateBlock = params.updateFeedback
        ? `\n\n---\n\n# UPDATE PASS\nBriana hit Update with this feedback:\n"""\n${params.updateFeedback}\n"""\nApply it as a hard constraint when regenerating the captions.`
        : '';

      const system =
        loadContextFile('system.md') +
        '\n\n---\n\n' +
        loadContextFile('ventures/trades-show.md') +
        '\n\n---\n\n' +
        loadContextFile('workflows/trades-show-pipeline.md') +
        '\n\n---\n\n' +
        loadContextFile('agents/showrunner/system-prompt.md') +
        (captionsVoice ? '\n\n---\n\n' + captionsVoice : '') +
        exemplarsBlock +
        '\n\n---\n\n' +
        `# Output structure (REQUIRED — parser depends on exact headers)

Write one caption per clip listed below. Each clip gets its own \`### CLIP N CAPTION\` section where N is the clip number.

Caption body is 1-3 sentences (hook in first sentence), then a blank line, then exactly \`Full episode linked in bio\` on its own line, then exactly 5 hashtags on a single line starting with #TheTradesShow. No Substack references anywhere.

### CLIP 1 CAPTION
<caption body — 1-3 sentences, hook in first sentence>

Full episode linked in bio
#TheTradesShow #hashtag2 #hashtag3 #hashtag4 #hashtag5

### CLIP 2 CAPTION
<same structure>
...` +
        memoryBlock;

      const contextBlock = ctx.episodeContextNote
        ? `# EPISODE CONTEXT (optional note — tone alignment only)\n${ctx.episodeContextNote}\n\n`
        : '';

      const user =
        `Episode type: ${ctx.episodeType}\n` +
        `Today's date: ${todayIsoPT()}\n\n` +
        contextBlock +
        `# CLIPS\n${renderClipsForPrompt(ctx.clips)}\n\n` +
        feedbackBlock +
        updateBlock +
        `\n\nWrite one caption per clip above, using the exact section headers.`;

      return { system, user };
    },

    buildDeposit: (ctx, r) => {
      parsed = parseSocialCaptions(r.text, ctx.clips);
      return {
        type: 'draft' as const,
        title: `Showrunner — Social captions (${parsed.clipCaptions.length} clip${parsed.clipCaptions.length === 1 ? '' : 's'})`,
        summary: `Social captions · ${ctx.episodeType} · ${parsed.clipCaptions.length} clips`,
        full_output: {
          output_kind: 'social_captions' satisfies ShowrunnerOutputKind,
          episode_type: ctx.episodeType,
          clip_captions: parsed.clipCaptions,
          raw_output: r.text,
          inputs: {
            episode_type: ctx.episodeType,
            episode_context_note: ctx.episodeContextNote,
            clips: ctx.clips,
          },
        },
        initiative: 'The Trades Show',
      };
    },
    output: {
      venture: 'trades-show',
      outputType: 'social_caption',
      tags: (ctx) =>
        ['social_captions', ctx.episodeType, `clips_${ctx.clips.length}`],
      children: async ({ ctx, runId, parentOutputId }) => {
        if (!parsed) return;
        // One social_caption child per clip — matches old one-shot pattern so
        // Supervisor retains per-caption granularity.
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
        void ctx;
      },
    },
  });

  return {
    ...result,
    parsed: parsed ?? parseSocialCaptions(result.result.text, clips),
  };
}

// ---------------------------------------------------------------------------
// Execute on approve — creates Notion Content DB entries.
// Substack approve: creates one Newsletter row.
// Metadata approve: no-op (metadata gets copied manually into Episode DB).
// Captions approve: no-op at approve time; per-clip Schedule button triggers
// the scheduling route which uploads the clip and creates the Content DB row.
// ---------------------------------------------------------------------------
export interface ShowrunnerExecuteResult {
  newsletterId?: string;
  clipIds: { index: number; contentEntryId: string }[];
  errors: string[];
}

export async function executeShowrunnerDraft(
  fullOutput: Record<string, unknown>,
): Promise<ShowrunnerExecuteResult> {
  const outputKind = fullOutput.output_kind as ShowrunnerOutputKind | undefined;
  const result: ShowrunnerExecuteResult = { clipIds: [], errors: [] };

  // Legacy one-shot items (no output_kind) — the old behavior created one
  // Newsletter row from the embedded substack fields.
  const isSubstack =
    outputKind === 'substack_post' ||
    (!outputKind && (fullOutput.substack_post || fullOutput.post_draft));

  if (isSubstack) {
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
        result.errors.push(
          `Newsletter: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  }

  // episode_metadata + social_captions: no Notion create on approve.
  return result;
}

// ---------------------------------------------------------------------------
// Retry / Update helpers — extract inputs per output_kind so the right runner
// can be invoked with the original transcript/clips plus new feedback.
// ---------------------------------------------------------------------------
export function getShowrunnerOutputKind(
  fullOutput: Record<string, unknown>,
): ShowrunnerOutputKind | 'legacy' | null {
  const kind = fullOutput.output_kind;
  if (
    kind === 'substack_post' ||
    kind === 'episode_metadata' ||
    kind === 'social_captions'
  ) {
    return kind;
  }
  // Legacy one-shot items carry substack_post + clip_captions + episode_description
  // all together. Update flow for these still goes through the legacy combined path.
  if (fullOutput.substack_post || fullOutput.post_draft) return 'legacy';
  return null;
}

export interface SubstackInputs {
  transcript: string;
  episodeType: EpisodeType;
  guestName: string;
  guestLinks: string;
}

export interface MetadataInputs {
  transcript: string;
  episodeType: EpisodeType;
  guestName: string;
  guestLinks: string;
  timestampedOutline: string;
}

export interface CaptionsInputs {
  clips: ClipInput[];
  episodeType: EpisodeType;
  episodeContextNote: string;
}

function extractStr(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

export function extractSubstackInputs(
  fullOutput: Record<string, unknown>,
): SubstackInputs | null {
  const inputs = fullOutput.inputs as Record<string, unknown> | undefined;
  if (!inputs || typeof inputs.transcript !== 'string' || !inputs.transcript.trim()) {
    return null;
  }
  return {
    transcript: inputs.transcript,
    episodeType: inputs.episode_type === 'interview' ? 'interview' : 'solo',
    guestName: extractStr(inputs.guest_name),
    guestLinks: extractStr(inputs.guest_links),
  };
}

export function extractMetadataInputs(
  fullOutput: Record<string, unknown>,
): MetadataInputs | null {
  const inputs = fullOutput.inputs as Record<string, unknown> | undefined;
  if (!inputs || typeof inputs.transcript !== 'string' || !inputs.transcript.trim()) {
    return null;
  }
  return {
    transcript: inputs.transcript,
    episodeType: inputs.episode_type === 'interview' ? 'interview' : 'solo',
    guestName: extractStr(inputs.guest_name),
    guestLinks: extractStr(inputs.guest_links),
    timestampedOutline: extractStr(inputs.timestamped_outline),
  };
}

export function extractCaptionsInputs(
  fullOutput: Record<string, unknown>,
): CaptionsInputs | null {
  const inputs = fullOutput.inputs as Record<string, unknown> | undefined;
  if (!inputs || !Array.isArray(inputs.clips) || inputs.clips.length === 0) {
    return null;
  }
  return {
    clips: inputs.clips as ClipInput[],
    episodeType: inputs.episode_type === 'interview' ? 'interview' : 'solo',
    episodeContextNote: extractStr(inputs.episode_context_note),
  };
}
