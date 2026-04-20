import { NextResponse } from 'next/server';
import {
  runShowrunnerSubstackPost,
  type EpisodeType,
} from '@/lib/agents/showrunner';

export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const transcript =
      typeof body.transcript === 'string' ? body.transcript.trim() : '';
    const episodeType: EpisodeType =
      body.episodeType === 'interview' ? 'interview' : 'solo';
    const guestName =
      typeof body.guestName === 'string' ? body.guestName.trim() : '';
    const guestLinks =
      typeof body.guestLinks === 'string' ? body.guestLinks.trim() : '';

    if (!transcript) {
      return NextResponse.json({ error: 'transcript is required' }, { status: 400 });
    }
    if (transcript.split(/\s+/).filter(Boolean).length < 100) {
      return NextResponse.json(
        { error: 'transcript too short (minimum 100 words)' },
        { status: 400 },
      );
    }

    const result = await runShowrunnerSubstackPost({
      transcript,
      episodeType,
      guestName,
      guestLinks,
      trigger: 'manual',
    });

    return NextResponse.json({
      ok: true,
      runId: result.runId,
      queueId: result.queueId,
      substackTitle: result.parsed.substackTitle,
      tokensIn: result.result.inputTokens,
      tokensOut: result.result.outputTokens,
      costEstimate: result.result.costEstimate,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Substack run failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
