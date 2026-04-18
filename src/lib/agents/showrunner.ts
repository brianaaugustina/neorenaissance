import { createContentEntry } from '../notion/client';
import {
  getAgentMemory,
  getRecentFeedback,
  type RecentFeedbackItem,
} from '../supabase/client';
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
  recentFeedback: RecentFeedbackItem[];
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
  postDraft: string;
  episodeTitle: string;
  youtubeDescription: string;
  spotifyDescription: string;
  substackSubtitle: string;
  clipCaptions: ClipCaption[];
  contentPillars: string[];
  suggestedPostDate?: string;
  raw: string;
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
  return {
    postDraft: parseSection(text, 'POST DRAFT'),
    episodeTitle: parseSection(text, 'EPISODE TITLE'),
    youtubeDescription: parseSection(text, 'YOUTUBE DESCRIPTION'),
    spotifyDescription: parseSection(text, 'SPOTIFY DESCRIPTION'),
    substackSubtitle: parseSection(text, 'SUBSTACK SUBTITLE'),
    clipCaptions: parseClipCaptions(text, clips),
    contentPillars: parsePillars(text),
    suggestedPostDate: parsePostDate(text),
    raw: text,
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

function renderFeedbackForPrompt(items: RecentFeedbackItem[]): string {
  if (!items.length) return '';
  const body = items
    .map((f) => {
      const date = (f.reviewed_at ?? f.created_at).slice(0, 10);
      const fb = f.feedback ? ` — "${f.feedback}"` : '';
      return `- [${f.status.toUpperCase()} ${date}] "${f.title}"${fb}`;
    })
    .join('\n');
  return `\n\n# RECENT FEEDBACK (last 7 days)\nBriana's corrections on past Showrunner output. Don't repeat the same choices.\n${body}`;
}

// ---------------------------------------------------------------------------
// Run Showrunner
// ---------------------------------------------------------------------------
export async function runShowrunner(
  params: {
    transcript: string;
    episodeType: EpisodeType;
    clips?: ClipInput[];
    trigger?: 'manual' | 'cron' | 'chat';
  },
): Promise<ShowrunnerResult> {
  const clips = params.clips ?? [];
  const trigger = params.trigger ?? 'manual';
  let parsed: ParsedShowrunnerOutput | null = null;

  const result = await runAgent<ShowrunnerContext>({
    agentName: AGENT_NAME,
    trigger,
    maxTokens: 8000,

    gatherContext: async () => {
      const recentFeedback = await getRecentFeedback(AGENT_NAME, 24 * 7).catch(() => []);
      return {
        transcript: params.transcript,
        episodeType: params.episodeType,
        transcriptWordCount: params.transcript.split(/\s+/).filter(Boolean).length,
        clips,
        recentFeedback,
      };
    },

    summarizeContext: (ctx) =>
      `type=${ctx.episodeType} words=${ctx.transcriptWordCount} clips=${ctx.clips.length} feedback=${ctx.recentFeedback.length}`,

    buildPrompt: async (ctx) => {
      const memory = await getAgentMemory(AGENT_NAME);
      let memoryBlock = '';
      if (Array.isArray(memory.feedback_rules) && memory.feedback_rules.length) {
        memoryBlock =
          '\n\n---\n\n# Persistent Rules (from past feedback)\nFollow these rules — direct instructions from Briana.\n' +
          memory.feedback_rules.map((r: string) => `- ${r}`).join('\n');
      }

      const clipsBlock = renderClipsForPrompt(ctx.clips);
      const feedbackBlock = renderFeedbackForPrompt(ctx.recentFeedback);

      const clipInstructions = ctx.clips.length
        ? `Write one caption per clip listed below. Each clip gets its own \`### CLIP N CAPTION\` section where N is the clip number. End each caption with a single line of hashtags.`
        : `No clips provided — omit CLIP CAPTION sections entirely.`;

      const system =
        loadContextFile('system.md') +
        '\n\n---\n\n' +
        loadContextFile('ventures/trades-show.md') +
        '\n\n---\n\n' +
        loadContextFile('workflows/trades-show-pipeline.md') +
        '\n\n---\n\n' +
        loadContextFile('agents/showrunner.md') +
        '\n\n---\n\n' +
        `# Output structure (REQUIRED — parser depends on exact headers)

### EPISODE TITLE
<one line, plainspoken title>

### SUBSTACK SUBTITLE
<one-sentence subtitle>

### YOUTUBE DESCRIPTION
<300-500 words; first 2 lines are the hook>

### SPOTIFY DESCRIPTION
<150-250 words>

### POST DRAFT
<full Substack post — 800-1500 words, TTS voice, no clickbait>

### CLIP 1 CAPTION
<caption body>
#hashtag1 #hashtag2 #hashtag3

### CLIP 2 CAPTION
<same structure>
...

### CONTENT PILLAR
<comma-separated pillars, e.g. Craft, Slow Renaissance>

### SUGGESTED POST DATE
YYYY-MM-DD

${clipInstructions}` +
        memoryBlock;

      const user =
        `Episode type: ${ctx.episodeType}\n` +
        `Word count: ${ctx.transcriptWordCount}\n` +
        `Today's date: ${new Date().toISOString().slice(0, 10)}\n\n` +
        `# TRANSCRIPT\n\n${ctx.transcript}\n\n` +
        `# CLIPS\n${clipsBlock}` +
        feedbackBlock +
        `\n\nProduce all outputs following the format in your system prompt.`;

      return { system, user };
    },

    buildDeposit: (ctx, r) => {
      parsed = parseShowrunnerOutput(r.text, ctx.clips);
      return {
        type: 'draft' as const,
        title: `Showrunner — ${parsed.episodeTitle || 'Episode Content Package'}`,
        summary: `${ctx.episodeType} episode | ${ctx.transcriptWordCount} words | ${parsed.clipCaptions.length} clips`,
        full_output: {
          episode_type: ctx.episodeType,
          post_draft: parsed.postDraft,
          episode_title: parsed.episodeTitle,
          youtube_description: parsed.youtubeDescription,
          spotify_description: parsed.spotifyDescription,
          substack_subtitle: parsed.substackSubtitle,
          clip_captions: parsed.clipCaptions,
          // Back-compat: dashboard still reads social_captions for existing Showrunner cards.
          social_captions: parsed.clipCaptions.map((c) => c.caption),
          content_pillars: parsed.contentPillars,
          suggested_post_date: parsed.suggestedPostDate,
          raw_output: r.text,
        },
        initiative: 'The Trades Show',
      };
    },

    onSuccess: async () => {
      if (!parsed) return;

      // Newsletter entry (only if a post draft was generated). Status left to
      // the Content DB default; Briana can finalize once she reviews the draft.
      if (parsed.postDraft) {
        try {
          await createContentEntry({
            name: `${parsed.episodeTitle || 'Episode'} — Newsletter`,
            contentType: ['Newsletter'],
            platforms: ['Trade Secrets Substack'],
            contentPillar: parsed.contentPillars,
            publishDate: parsed.suggestedPostDate,
            ventureIds: [TTS_VENTURE_ID],
            caption: parsed.substackSubtitle,
          });
        } catch (e) {
          console.error('Newsletter Content DB write failed:', e);
        }
      }

      // One Content entry per clip. When a fileUploadId is present (future:
      // once upload infra is wired up via Supabase Storage), attach the video
      // and mark "Done". Without a file, leave status at the DB default so
      // Briana can attach the video manually in Notion and advance it.
      for (const clip of parsed.clipCaptions) {
        try {
          const id = await createContentEntry({
            name: `${parsed.episodeTitle || 'Episode'} — Clip ${clip.index}`,
            status: clip.fileUploadId ? '✅ Done' : undefined,
            contentType: ['Reel'],
            platforms: clip.platforms ?? DEFAULT_SOCIAL_PLATFORMS,
            caption: [clip.caption, clip.hashtags.join(' ')].filter(Boolean).join('\n\n'),
            contentPillar: parsed.contentPillars,
            publishDate: clip.publishDate,
            ventureIds: [TTS_VENTURE_ID],
            fileUploadIds: clip.fileUploadId ? [clip.fileUploadId] : undefined,
          });
          clip.contentEntryId = id;
        } catch (e) {
          console.error(`Clip ${clip.index} Content DB write failed:`, e);
        }
      }
    },
  });

  return {
    ...result,
    parsed: parsed ?? parseShowrunnerOutput(result.result.text, clips),
  };
}
