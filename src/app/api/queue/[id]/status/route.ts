import { NextResponse } from 'next/server';
import { executeShowrunnerDraft } from '@/lib/agents/showrunner';
import {
  getAgentMemory,
  setAgentMemory,
  supabaseAdmin,
  updateQueueStatus,
  type QueueStatus,
} from '@/lib/supabase/client';

export const maxDuration = 60;

const ALLOWED: QueueStatus[] = ['approved', 'rejected', 'deferred', 'executed', 'pending'];

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

    // Load the item first — we need agent_name + full_output for downstream
    // behaviors (approve = execute Showrunner, rejection = feedback rule).
    const { data: item, error: fetchErr } = await supabaseAdmin()
      .from('approval_queue')
      .select('*')
      .eq('id', id)
      .single();
    if (fetchErr || !item) {
      return NextResponse.json({ error: 'Queue item not found' }, { status: 404 });
    }

    await updateQueueStatus(id, status, feedback);

    // Persist feedback as a permanent behavioral rule in agent memory
    if (feedback && (status === 'approved' || status === 'rejected')) {
      try {
        const agentName = item.agent_name ?? 'ops_chief';
        const existing = (await getAgentMemory(agentName, 'feedback_rules')) as string[] | null;
        const rules = existing ?? [];
        const prefix = status === 'approved' ? 'APPROVED' : 'REJECTED';
        rules.push(`[${prefix} ${new Date().toISOString().slice(0, 10)}] ${feedback}`);
        await setAgentMemory(agentName, 'feedback_rules', rules);
      } catch (memErr) {
        console.error('Failed to persist feedback to agent memory:', memErr);
      }
    }

    // Approve flow: for a Showrunner draft, write the Notion Content DB
    // entries now (not at run time) so rejected outputs don't leave orphans.
    let executeResult: unknown = undefined;
    if (
      status === 'approved' &&
      item.agent_name === 'showrunner' &&
      item.type === 'draft' &&
      !item.full_output?.notion_entries_created
    ) {
      try {
        const exec = await executeShowrunnerDraft(item.full_output ?? {});
        // Stamp the queue item so re-approving or a double-click doesn't
        // create duplicate Notion entries.
        await supabaseAdmin()
          .from('approval_queue')
          .update({
            full_output: {
              ...(item.full_output ?? {}),
              notion_entries_created: true,
              notion_entry_ids: {
                newsletter_id: exec.newsletterId,
                clip_ids: exec.clipIds,
              },
            },
          })
          .eq('id', id);
        executeResult = {
          newsletterCreated: !!exec.newsletterId,
          clipsCreated: exec.clipIds.length,
          errors: exec.errors,
        };
      } catch (execErr) {
        console.error('Showrunner execute failed:', execErr);
        executeResult = {
          error: execErr instanceof Error ? execErr.message : String(execErr),
        };
      }
    }

    return NextResponse.json({ ok: true, execute: executeResult });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
