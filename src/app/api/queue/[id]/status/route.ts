import { NextResponse } from 'next/server';
import {
  bulkUpdateOutputsByRunId,
  computeEditDiff,
  logOutput,
  updateOutputStatus,
} from '@/lib/agent-outputs';
import { onPressPitchApproval } from '@/lib/agents/pr-director';
import { executeShowrunnerDraft } from '@/lib/agents/showrunner';
import { onPitchApproval } from '@/lib/agents/sponsorship-director';
import {
  getPermanentPreferences,
  setPermanentPreferences,
  supabaseAdmin,
  updateQueueStatus,
  type QueueStatus,
} from '@/lib/supabase/client';
import { todayIsoPT } from '@/lib/time';

export const maxDuration = 60;

const ALLOWED: QueueStatus[] = [
  'approved',
  'rejected',
  'deferred',
  'executed',
  'pending',
  'ignored',
];

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const status = body?.status as QueueStatus | undefined;
    const feedback = body?.feedback as string | undefined;
    // Optional: pitch drafts can send an edited body at Gate 2. If present
    // we treat it as the final pitch text (overrides the original draft).
    const finalBodyFromClient =
      typeof body?.finalBody === 'string' ? (body.finalBody as string) : undefined;
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

    // If Briana edited the pitch body before approval, persist it into
    // approval_queue.full_output.body FIRST so the rest of the pipeline
    // (agent_outputs final_content, Notion) sees the edit as the source
    // of truth.
    let effectiveFullOutput = item.full_output;
    if (
      status === 'approved' &&
      finalBodyFromClient !== undefined &&
      item.full_output &&
      typeof item.full_output === 'object' &&
      typeof (item.full_output as Record<string, unknown>).body === 'string'
    ) {
      const prev = (item.full_output as Record<string, unknown>).body as string;
      if (finalBodyFromClient !== prev) {
        const updated = { ...(item.full_output as Record<string, unknown>), body: finalBodyFromClient };
        effectiveFullOutput = updated;
        await supabaseAdmin()
          .from('approval_queue')
          .update({ full_output: updated })
          .eq('id', id);
      }
    }

    // Ignored — a terminal state distinct from approve/reject. Stamps the
    // agent_output + children so the Supervisor (Phase 4) can learn from
    // known-incorrect samples without confusing them with feedback-backed
    // rejections. No downstream Notion writes, no permanent_preferences
    // promotion, no executeShowrunnerDraft.
    if (status === 'ignored' && item.agent_output_id) {
      try {
        await updateOutputStatus({
          outputId: item.agent_output_id,
          status: 'ignored',
          rejectionReason: feedback || 'ignored by user',
        });
        if (item.run_id) {
          await bulkUpdateOutputsByRunId(item.run_id, 'ignored');
        }
      } catch (e) {
        console.error('Failed to sync agent_outputs for ignored:', e);
      }
      return NextResponse.json({ ok: true });
    }

    // Sync agent_outputs. Parent row is updated directly; any children from
    // the same run get bulk-approved/rejected under the same package-level
    // decision. Per-item approval UI lands with Step 7.
    if (
      (status === 'approved' || status === 'rejected') &&
      item.agent_output_id
    ) {
      try {
        // Edit diff capture — fetch the original draft_content and compute
        // the field-level diff vs what's being approved. Foundation for the
        // Supervisor's future "you keep editing X — promote to permanent?"
        // prompt. When diff is non-null, store the agent_output status as
        // 'edited' (preserves approval_queue.status='approved' unchanged).
        let editDiff: Record<string, unknown> | undefined;
        let outputStatus: 'approved' | 'rejected' | 'edited' = status;
        if (status === 'approved' && effectiveFullOutput) {
          const { data: agentOutput } = await supabaseAdmin()
            .from('agent_outputs')
            .select('draft_content')
            .eq('id', item.agent_output_id)
            .single();
          const draft = (agentOutput?.draft_content ?? {}) as Record<string, unknown>;
          const diff = computeEditDiff(
            draft,
            effectiveFullOutput as Record<string, unknown>,
          );
          if (diff) {
            editDiff = diff as unknown as Record<string, unknown>;
            outputStatus = 'edited';
          }
        }
        await updateOutputStatus({
          outputId: item.agent_output_id,
          status: outputStatus,
          finalContent:
            status === 'approved' ? (effectiveFullOutput ?? {}) : undefined,
          rejectionReason: status === 'rejected' ? feedback : undefined,
          editDiff,
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

      // Sponsorship Director — Gate 2: mirror approve/reject into the Notion
      // Outreach row's Status (Approved on approve, Pass on reject). No-op
      // for non-pitch items. Intentionally after the agent_outputs sync so
      // Supabase stays the source of truth even if Notion fails.
      try {
        const finalBody =
          status === 'approved' &&
          effectiveFullOutput &&
          typeof effectiveFullOutput === 'object' &&
          typeof (effectiveFullOutput as Record<string, unknown>).body === 'string'
            ? ((effectiveFullOutput as Record<string, unknown>).body as string)
            : undefined;
        await onPitchApproval({
          queueItemAgentOutputId: item.agent_output_id,
          status,
          feedback,
          finalBody,
        });
      } catch (notionErr) {
        console.error('Sponsorship onPitchApproval failed:', notionErr);
      }

      // PR Director — Gate 2: same Notion mirror pattern for press pitches.
      // No-op when the queue item is a Sponsorship pitch or any other type.
      try {
        const finalBody =
          status === 'approved' &&
          effectiveFullOutput &&
          typeof effectiveFullOutput === 'object' &&
          typeof (effectiveFullOutput as Record<string, unknown>).body === 'string'
            ? ((effectiveFullOutput as Record<string, unknown>).body as string)
            : undefined;
        await onPressPitchApproval({
          queueItemAgentOutputId: item.agent_output_id,
          status,
          feedback,
          finalBody,
        });
      } catch (notionErr) {
        console.error('PR onPressPitchApproval failed:', notionErr);
      }
    }

    // Persist feedback as a permanent behavioral rule in agent memory.
    // Note: Agent Supervisor (Phase 4) will eventually own the 3+ occurrence
    // promotion logic per playbook §7. Until then, queue feedback promotes
    // immediately — preserves existing behavior but uses the canonical
    // permanent_preferences key instead of the legacy feedback_rules.
    if (feedback && (status === 'approved' || status === 'rejected')) {
      try {
        const agentName = item.agent_name ?? 'ops_chief';
        const existing = await getPermanentPreferences(agentName);
        const prefix = status === 'approved' ? 'APPROVED' : 'REJECTED';
        const newRule = `[${prefix} ${todayIsoPT()}] ${feedback}`;
        const existingBodies = new Set(
          existing.map((r) => r.replace(/^\[[^\]]+\]\s*/, '').trim()),
        );
        const newBody = newRule.replace(/^\[[^\]]+\]\s*/, '').trim();
        if (!existingBodies.has(newBody)) {
          await setPermanentPreferences(agentName, [...existing, newRule]);
        }
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
