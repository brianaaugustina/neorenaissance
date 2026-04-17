import { NextResponse } from 'next/server';
import {
  createTask,
  getInitiatives,
  updateTask,
} from '@/lib/notion/client';
import {
  supabaseAdmin,
  updateQueueStatus,
} from '@/lib/supabase/client';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    // Fetch the queue item
    const { data: item, error: fetchErr } = await supabaseAdmin()
      .from('approval_queue')
      .select('*')
      .eq('id', id)
      .single();
    if (fetchErr || !item) {
      return NextResponse.json({ error: 'Queue item not found' }, { status: 404 });
    }
    if (item.status !== 'approved') {
      return NextResponse.json(
        { error: `Cannot execute — status is "${item.status}", expected "approved"` },
        { status: 400 },
      );
    }

    const output = item.full_output ?? {};
    const reschedules: any[] = output.reschedules ?? [];
    const newTasks: any[] = output.new_tasks ?? [];

    // Resolve initiative names to IDs for new tasks
    const initiatives = await getInitiatives();
    function resolveInitiative(name: string): string | undefined {
      if (!name) return undefined;
      const lower = name.toLowerCase();
      return initiatives.find(
        (i) => i.name.toLowerCase() === lower || i.name.toLowerCase().includes(lower),
      )?.id;
    }

    const results: { action: string; title: string; ok: boolean; error?: string }[] = [];

    // Execute reschedules
    for (const r of reschedules) {
      try {
        await updateTask(r.task_id ?? r.taskId, {
          toDoDate: r.new_date ?? r.newDate,
        });
        results.push({
          action: 'reschedule',
          title: r.task_title ?? r.taskTitle,
          ok: true,
        });
      } catch (e: any) {
        results.push({
          action: 'reschedule',
          title: r.task_title ?? r.taskTitle,
          ok: false,
          error: e?.message,
        });
      }
    }

    // Execute new task creation
    for (const t of newTasks) {
      try {
        const initiativeId = resolveInitiative(
          t.initiative_name ?? t.initiativeName ?? '',
        );
        await createTask({
          title: t.title,
          type: t.type ?? 'Tasks',
          toDoDate: t.to_do_date ?? t.toDoDate,
          initiativeId,
          status: 'Not started',
          source: 'Claude',
        });
        results.push({ action: 'create', title: t.title, ok: true });
      } catch (e: any) {
        results.push({
          action: 'create',
          title: t.title,
          ok: false,
          error: e?.message,
        });
      }
    }

    // Mark as executed
    await updateQueueStatus(id, 'executed');

    const succeeded = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok).length;

    return NextResponse.json({
      ok: true,
      executed: { reschedules: reschedules.length, newTasks: newTasks.length },
      succeeded,
      failed,
      results,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Execute failed' }, { status: 500 });
  }
}
