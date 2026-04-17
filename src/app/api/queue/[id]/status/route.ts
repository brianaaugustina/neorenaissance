import { NextResponse } from 'next/server';
import {
  getAgentMemory,
  setAgentMemory,
  supabaseAdmin,
  updateQueueStatus,
  type QueueStatus,
} from '@/lib/supabase/client';

const ALLOWED: QueueStatus[] = ['approved', 'rejected', 'deferred', 'executed'];

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const status = body?.status as QueueStatus | undefined;
    const feedback = body?.feedback as string | undefined;
    if (!status || !ALLOWED.includes(status)) {
      return NextResponse.json(
        { error: `status must be one of ${ALLOWED.join(', ')}` },
        { status: 400 },
      );
    }
    await updateQueueStatus(id, status, feedback);

    // Persist feedback as a permanent behavioral rule in agent memory
    if (feedback && (status === 'approved' || status === 'rejected')) {
      try {
        const { data: item } = await supabaseAdmin()
          .from('approval_queue')
          .select('agent_name')
          .eq('id', id)
          .single();
        const agentName = item?.agent_name ?? 'ops_chief';
        const existing = (await getAgentMemory(agentName, 'feedback_rules')) as string[] | null;
        const rules = existing ?? [];
        const prefix = status === 'approved' ? 'APPROVED' : 'REJECTED';
        rules.push(`[${prefix} ${new Date().toISOString().slice(0, 10)}] ${feedback}`);
        await setAgentMemory(agentName, 'feedback_rules', rules);
      } catch (memErr) {
        console.error('Failed to persist feedback to agent memory:', memErr);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Failed' }, { status: 500 });
  }
}
