import { NextResponse } from 'next/server';
import { runShowrunner, type EpisodeType } from '@/lib/agents/showrunner';

export const maxDuration = 120;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const transcript =
      typeof body?.transcript === 'string' ? body.transcript.trim() : '';
    const episodeType: EpisodeType =
      body?.episodeType === 'interview' ? 'interview' : 'solo';

    if (!transcript) {
      return NextResponse.json(
        { error: 'transcript is required' },
        { status: 400 },
      );
    }
    if (transcript.split(/\s+/).length < 100) {
      return NextResponse.json(
        { error: 'transcript too short (minimum 100 words)' },
        { status: 400 },
      );
    }

    const result = await runShowrunner(transcript, episodeType, 'manual');

    return NextResponse.json({
      ok: true,
      runId: result.runId,
      queueId: result.queueId,
      episodeTitle: result.parsed.episodeTitle,
      captionCount: result.parsed.socialCaptions.length,
      tokensIn: result.result.inputTokens,
      tokensOut: result.result.outputTokens,
      costEstimate: result.result.costEstimate,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? 'Showrunner failed' },
      { status: 500 },
    );
  }
}
