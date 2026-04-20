import { NextResponse } from 'next/server';
import { markOpportunitySubmitted } from '@/lib/agents/funding-scout';

export const maxDuration = 120;

// Gate 3 for Funding Scout — Briana submits the application manually at the
// funder's portal, then clicks "Mark as submitted" here. Flips Notion funding
// DB status from "ready to apply" to "applied" and locks the final draft.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ outputId: string }> },
) {
  try {
    const { outputId } = await params;
    const body = await req.json().catch(() => ({}));
    const finalDraft: string | undefined = body?.finalDraft;
    const result = await markOpportunitySubmitted({
      outputId,
      finalDraft: finalDraft?.trim() || undefined,
    });
    return NextResponse.json({
      ok: true,
      notionRowId: result.notionRowId,
      submittedAt: result.submittedAt,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Mark as submitted failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
