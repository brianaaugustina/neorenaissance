import { NextResponse } from 'next/server';
import { markOutreachSent } from '@/lib/agents/talent-scout';

export const maxDuration = 120;

// Gate 3 for Talent Scout — records that outreach happened. For email channel
// this pre-dates Gmail OAuth (Sub-step 2); for now Briana sends manually and
// clicks "Mark as sent." For IG DM and team-intro, this is the permanent
// pattern: those channels are always manual.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ outputId: string }> },
) {
  try {
    const { outputId } = await params;
    const body = await req.json().catch(() => ({}));
    const finalBody: string | undefined = body?.finalBody;
    const result = await markOutreachSent({
      outputId,
      finalBody: finalBody?.trim() || undefined,
    });
    return NextResponse.json({
      ok: true,
      outreachRowId: result.outreachRowId,
      sentAt: result.sentAt,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Mark as sent failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
