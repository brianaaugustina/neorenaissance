import { createContentEntry } from '../notion/client';
import { getAgentMemory } from '../supabase/client';
import { loadContextFile, runAgent, type RunAgentResult } from './base';

const AGENT_NAME = 'showrunner';
const TTS_VENTURE_ID = '194e5c03a7f480c2bbf9ed13f3656511';

export type EpisodeType = 'solo' | 'interview';

export interface ShowrunnerContext {
  transcript: string;
  episodeType: EpisodeType;
  transcriptWordCount: number;
}

export interface ParsedShowrunnerOutput {
  postDraft: string;
  episodeTitle: string;
  youtubeDescription: string;
  spotifyDescription: string;
  substackSubtitle: string;
  socialCaptions: string[];
  contentPillars: string[];
  suggestedDates: { post?: string; social: string[] };
  raw: string;
}

export interface ShowrunnerResult extends RunAgentResult<ShowrunnerContext> {
  parsed: ParsedShowrunnerOutput;
}

// ---------------------------------------------------------------------------
// Output parsing — extract sections from Claude's structured output
// ---------------------------------------------------------------------------
function parseSection(text: string, header: string): string {
  const pattern = new RegExp(`### ${header}\\s*\\n([\\s\\S]*?)(?=\\n### |$)`);
  const match = text.match(pattern);
  return match?.[1]?.trim() ?? '';
}

function parseCaptions(text: string): string[] {
  const section = parseSection(text, 'SOCIAL CAPTIONS');
  if (!section) return [];
  return section
    .split('\n')
    .filter((line) => /^Caption \d+:/i.test(line.trim()))
    .map((line) => line.replace(/^Caption \d+:\s*/i, '').trim())
    .filter(Boolean);
}

function parsePillars(text: string): string[] {
  const section = parseSection(text, 'CONTENT PILLAR');
  if (!section) return [];
  return section
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseDates(text: string): { post?: string; social: string[] } {
  const section = parseSection(text, 'SUGGESTED PUBLISH DATES');
  if (!section) return { social: [] };
  const lines = section.split('\n').filter(Boolean);
  let post: string | undefined;
  const social: string[] = [];
  for (const line of lines) {
    const dateMatch = line.match(/(\d{4}-\d{2}-\d{2})/);
    if (!dateMatch) continue;
    if (/^Post:/i.test(line.trim())) {
      post = dateMatch[1];
    } else {
      social.push(dateMatch[1]);
    }
  }
  return { post, social };
}

function parseShowrunnerOutput(text: string): ParsedShowrunnerOutput {
  return {
    postDraft: parseSection(text, 'POST DRAFT'),
    episodeTitle: parseSection(text, 'EPISODE TITLE'),
    youtubeDescription: parseSection(text, 'YOUTUBE DESCRIPTION'),
    spotifyDescription: parseSection(text, 'SPOTIFY DESCRIPTION'),
    substackSubtitle: parseSection(text, 'SUBSTACK SUBTITLE'),
    socialCaptions: parseCaptions(text),
    contentPillars: parsePillars(text),
    suggestedDates: parseDates(text),
    raw: text,
  };
}

// ---------------------------------------------------------------------------
// Run Showrunner
// ---------------------------------------------------------------------------
export async function runShowrunner(
  transcript: string,
  episodeType: EpisodeType,
  trigger: 'manual' | 'cron' | 'chat' = 'manual',
): Promise<ShowrunnerResult> {
  let parsed: ParsedShowrunnerOutput | null = null;

  const result = await runAgent<ShowrunnerContext>({
    agentName: AGENT_NAME,
    trigger,
    maxTokens: 8000,

    gatherContext: async () => ({
      transcript,
      episodeType,
      transcriptWordCount: transcript.split(/\s+/).length,
    }),

    summarizeContext: (ctx) =>
      `type=${ctx.episodeType} words=${ctx.transcriptWordCount}`,

    buildPrompt: async (ctx) => {
      // Load persistent memory (feedback rules)
      const memory = await getAgentMemory(AGENT_NAME);
      let memoryBlock = '';
      if (Array.isArray(memory.feedback_rules) && memory.feedback_rules.length) {
        memoryBlock =
          '\n\n---\n\n# Persistent Rules (from past feedback)\nFollow these rules — they are direct instructions from Briana.\n' +
          memory.feedback_rules.map((r: string) => `- ${r}`).join('\n');
      }

      return {
        system:
          loadContextFile('system.md') +
          '\n\n---\n\n' +
          loadContextFile('ventures/trades-show.md') +
          '\n\n---\n\n' +
          loadContextFile('workflows/trades-show-pipeline.md') +
          '\n\n---\n\n' +
          loadContextFile('agents/showrunner.md') +
          memoryBlock,
        user:
          `Episode type: ${ctx.episodeType}\n` +
          `Word count: ${ctx.transcriptWordCount}\n` +
          `Today's date: ${new Date().toISOString().slice(0, 10)}\n\n` +
          `# TRANSCRIPT\n\n${ctx.transcript}\n\n` +
          `Produce all outputs following the format in your system prompt.`,
      };
    },

    buildDeposit: (ctx, r) => {
      parsed = parseShowrunnerOutput(r.text);
      const captionCount = parsed.socialCaptions.length;
      return {
        type: 'draft' as const,
        title: `Showrunner — ${parsed.episodeTitle || 'Episode Content Package'}`,
        summary: `${ctx.episodeType} episode | ${ctx.transcriptWordCount} words | ${captionCount} captions`,
        full_output: {
          episode_type: ctx.episodeType,
          post_draft: parsed.postDraft,
          episode_title: parsed.episodeTitle,
          youtube_description: parsed.youtubeDescription,
          spotify_description: parsed.spotifyDescription,
          substack_subtitle: parsed.substackSubtitle,
          social_captions: parsed.socialCaptions,
          content_pillars: parsed.contentPillars,
          suggested_dates: parsed.suggestedDates,
          raw_output: r.text,
        },
        initiative: 'The Trades Show',
      };
    },

    onSuccess: async (_ctx, _r) => {
      if (!parsed) return;

      try {
        // Create newsletter entry in Content DB
        if (parsed.postDraft) {
          await createContentEntry({
            name: `${parsed.episodeTitle || 'Episode'} — Newsletter`,
            status: 'Drafted',
            contentType: ['Newsletter'],
            platforms: ['Trade Secrets Substack'],
            contentPillar: parsed.contentPillars,
            publishDate: parsed.suggestedDates.post,
            ventureIds: [TTS_VENTURE_ID],
          });
        }

        // Create social content entries
        for (let i = 0; i < parsed.socialCaptions.length; i++) {
          await createContentEntry({
            name: `${parsed.episodeTitle || 'Episode'} — Social ${i + 1}`,
            status: 'Planned',
            contentType: ['Reel'],
            platforms: ['IN@tradesshow', 'TIKTOK@tradesshow', 'LI@brianaottoboni'],
            caption: parsed.socialCaptions[i],
            contentPillar: parsed.contentPillars,
            publishDate: parsed.suggestedDates.social[i],
            ventureIds: [TTS_VENTURE_ID],
          });
        }
      } catch (e) {
        console.error('Content DB writes failed (non-fatal):', e);
      }
    },
  });

  return {
    ...result,
    parsed: parsed ?? parseShowrunnerOutput(result.result.text),
  };
}
