import { NextResponse } from 'next/server';
import { runOpsChiefChat } from '@/lib/agents/ops-chief-chat';

export const maxDuration = 120;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const message = typeof body?.message === 'string' ? body.message.trim() : '';
    if (!message) {
      return NextResponse.json({ error: 'message required' }, { status: 400 });
    }
    const result = await runOpsChiefChat(message);
    return NextResponse.json({
      ok: true,
      reply: result.reply,
      actions: result.actions,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      costEstimate: result.costEstimate,
      runId: result.runId,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Failed' }, { status: 500 });
  }
}
