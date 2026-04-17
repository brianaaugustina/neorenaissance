import { NextResponse } from 'next/server';
import { runShowrunner, type ClipInput, type EpisodeType } from '@/lib/agents/showrunner';
import { uploadFileToNotion } from '@/lib/notion/client';

export const maxDuration = 300;

interface ClipInputPayload {
  description: string;
  publishDate?: string;
  platforms?: string[];
  fileFieldName?: string; // name of the multipart field holding the clip file
}

async function readJsonBody(req: Request): Promise<{ transcript: string; episodeType: EpisodeType; clips: ClipInput[] }> {
  const body: unknown = await req.json();
  const b = (body ?? {}) as Record<string, unknown>;
  const transcript = typeof b.transcript === 'string' ? b.transcript.trim() : '';
  const episodeType: EpisodeType = b.episodeType === 'interview' ? 'interview' : 'solo';
  const rawClips: unknown[] = Array.isArray(b.clips) ? b.clips : [];
  const clips: ClipInput[] = rawClips
    .map((raw) => {
      const c = (raw ?? {}) as Record<string, unknown>;
      return {
        description: typeof c.description === 'string' ? c.description.trim() : '',
        publishDate: typeof c.publishDate === 'string' ? c.publishDate : undefined,
        platforms: Array.isArray(c.platforms)
          ? (c.platforms as unknown[]).filter((p): p is string => typeof p === 'string')
          : undefined,
      };
    })
    .filter((c) => c.description);
  return { transcript, episodeType, clips };
}

async function readMultipartBody(
  req: Request,
): Promise<{ transcript: string; episodeType: EpisodeType; clips: ClipInput[] }> {
  const form = await req.formData();
  const transcript =
    typeof form.get('transcript') === 'string' ? String(form.get('transcript')).trim() : '';
  const episodeType: EpisodeType =
    form.get('episodeType') === 'interview' ? 'interview' : 'solo';
  const clipsJson = form.get('clips');
  const rawClips: ClipInputPayload[] =
    typeof clipsJson === 'string' ? JSON.parse(clipsJson) : [];

  // Upload each clip file to Notion and attach the returned id.
  const clips: ClipInput[] = [];
  for (let i = 0; i < rawClips.length; i++) {
    const c = rawClips[i];
    const clip: ClipInput = {
      description: c.description?.trim() ?? '',
      publishDate: c.publishDate,
      platforms: c.platforms,
    };
    if (c.fileFieldName) {
      const file = form.get(c.fileFieldName);
      if (file && file instanceof File && file.size > 0) {
        const buffer = Buffer.from(await file.arrayBuffer());
        const filename = file.name || `clip-${i + 1}`;
        const contentType = file.type || 'application/octet-stream';
        clip.fileUploadId = await uploadFileToNotion(buffer, filename, contentType);
      }
    }
    if (clip.description) clips.push(clip);
  }
  return { transcript, episodeType, clips };
}

export async function POST(req: Request) {
  try {
    const contentType = req.headers.get('content-type') ?? '';
    const { transcript, episodeType, clips } = contentType.includes('multipart/form-data')
      ? await readMultipartBody(req)
      : await readJsonBody(req);

    if (!transcript) {
      return NextResponse.json({ error: 'transcript is required' }, { status: 400 });
    }
    if (transcript.split(/\s+/).filter(Boolean).length < 100) {
      return NextResponse.json(
        { error: 'transcript too short (minimum 100 words)' },
        { status: 400 },
      );
    }

    const result = await runShowrunner({ transcript, episodeType, clips, trigger: 'manual' });

    return NextResponse.json({
      ok: true,
      runId: result.runId,
      queueId: result.queueId,
      episodeTitle: result.parsed.episodeTitle,
      clipCount: result.parsed.clipCaptions.length,
      captionCount: result.parsed.clipCaptions.length,
      tokensIn: result.result.inputTokens,
      tokensOut: result.result.outputTokens,
      costEstimate: result.result.costEstimate,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Showrunner failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
