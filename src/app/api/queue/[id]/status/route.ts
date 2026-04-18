import { NextResponse } from 'next/server';
import {
  bulkUpdateOutputsByRunId,
  logOutput,
  updateOutputStatus,
} from '@/lib/agent-outputs';
import { executeShowrunnerDraft } from '@/lib/agents/showrunner';
import {
  getAgentMemory,
  setAgentMemory,
  supabaseAdmin,
  updateQueueStatus,
  type QueueStatus,
} from '@/lib/supabase/client';
import { todayIsoPT } from '@/lib/time';

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

    // Sync agent_outputs. Parent row is updated directly; any children from
    // the same run get bulk-approved/rejected under the same package-level
    // decision. Per-item approval UI lands with Step 7.
    if (
      (status === 'approved' || status === 'rejected') &&
      item.agent_output_id
    ) {
      try {
        await updateOutputStatus({
          outputId: item.agent_output_id,
          status,
          finalContent:
            status === 'approved' ? (item.full_output ?? {}) : undefined,
          rejectionReason: status === 'rejected' ? feedback : undefined,
        });
        if (item.run_id) {
          await bulkUpdateOutputsByRunId(
            item.run_id,
            status,
            status === 'rejected' ? feedback : undefined,
          );
        }
      } catch (outputErr) {
        console.error('Failed to sync agent_outputs:', outputErr);
      }
    }

    // Persist feedback as a permanent behavioral rule in agent memory
    if (feedback && (status === 'approved' || status === 'rejected')) {
      try {
        const agentName = item.agent_name ?? 'ops_chief';
        const existing = (await getAgentMemory(agentName, 'feedback_rules')) as string[] | null;
        const rules = existing ?? [];
        const prefix = status === 'approved' ? 'APPROVED' : 'REJECTED';
        rules.push(`[${prefix} ${todayIsoPT()}] ${feedback}`);
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

        // Log one calendar_entry agent_output per Notion row created. These
        // are already approved by virtue of the package being approved.
        if (item.agent_output_id) {
          try {
            if (exec.newsletterId) {
              const calOutId = await logOutput({
                agentId: 'showrunner',
                venture: 'trades-show',
                outputType: 'calendar_entry',
                parentOutputId: item.agent_output_id,
                runId: item.run_id ?? undefined,
                draftContent: {
                  notion_id: exec.newsletterId,
                  kind: 'newsletter',
                  episode_title: item.full_output?.episode_title,
                  publish_date: item.full_output?.suggested_post_date,
                },
                tags: ['calendar_entry', 'newsletter'],
              });
              await updateOutputStatus({
                outputId: calOutId,
                status: 'approved',
                finalContent: {
                  notion_id: exec.newsletterId,
                  kind: 'newsletter',
                },
              });
            }
            for (const clip of exec.clipIds) {
              const calOutId = await logOutput({
                agentId: 'showrunner',
                venture: 'trades-show',
                outputType: 'calendar_entry',
                parentOutputId: item.agent_output_id,
                runId: item.run_id ?? undefined,
                draftContent: {
                  notion_id: clip.contentEntryId,
                  kind: 'clip',
                  clip_index: clip.index,
                  episode_title: item.full_output?.episode_title,
                },
                tags: ['calendar_entry', 'clip', `clip_${clip.index}`],
              });
              await updateOutputStatus({
                outputId: calOutId,
                status: 'approved',
                finalContent: {
                  notion_id: clip.contentEntryId,
                  kind: 'clip',
                  clip_index: clip.index,
                },
              });
            }
          } catch (logErr) {
            console.error('Failed to log calendar_entry outputs:', logErr);
          }
        }

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
