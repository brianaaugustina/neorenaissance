import {
  getContentEntriesForWeek,
  getInitiatives,
  getTTSTasksForWeek,
  type Initiative,
  type Task,
} from '../notion/client';
import {
  depositToQueue,
  logRunComplete,
  logRunStart,
} from '../supabase/client';

const AGENT_NAME = 'showrunner';

// Resolve TTS initiative ID dynamically
async function findTTSInitiativeId(initiatives: Initiative[]): Promise<string | null> {
  const tts = initiatives.find(
    (i) =>
      i.name.toLowerCase().includes('trades show') ||
      i.name.toLowerCase().includes('tts'),
  );
  return tts?.id ?? null;
}

interface PipelineItem {
  title: string;
  type: string;
  status: string | null;
  dueDate: string | null;
  whatNeeded: string;
}

function inferWhatNeeded(item: { title: string; status: string | null; contentType?: string[] }): string {
  const title = item.title.toLowerCase();
  const types = (item.contentType ?? []).map((t: string) => t.toLowerCase());

  if (title.includes('substack') || title.includes('newsletter') || types.includes('newsletter')) {
    return 'Transcript needed to draft Substack post. Paste or upload in the Showrunner input on the dashboard.';
  }
  if (title.includes('social') || title.includes('caption') || types.includes('reel') || types.includes('static')) {
    return 'Content files (video clips, images) needed to create captions. Attach when ready.';
  }
  if (title.includes('youtube') || title.includes('spotify') || types.includes('podcast') || types.includes('full video')) {
    return 'Episode video/audio needed for titles and descriptions.';
  }
  if (item.status === 'Planned' || item.status === 'Not started') {
    return 'This item is planned but has no draft yet. Review and provide source material or direction.';
  }
  if (item.status === 'Drafted') {
    return 'Draft ready for your review and approval.';
  }
  return 'Review needed — check status and provide any missing assets.';
}

function getWeekBounds(): { start: string; end: string } {
  const now = new Date();
  const dow = now.getDay();
  const mondayOffset = (dow + 6) % 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() - mondayOffset);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return {
    start: monday.toISOString().slice(0, 10),
    end: sunday.toISOString().slice(0, 10),
  };
}

export async function runShowrunnerDailyCheck(
  trigger: 'cron' | 'manual' = 'cron',
): Promise<{ runId: string; queueId: string | null; itemCount: number }> {
  const run = await logRunStart(AGENT_NAME, trigger);
  const todayIso = new Date().toISOString().slice(0, 10);

  try {
    const initiatives = await getInitiatives();
    const ttsId = await findTTSInitiativeId(initiatives);

    const { start, end } = getWeekBounds();
    const items: PipelineItem[] = [];

    // TTS tasks this week
    if (ttsId) {
      const ttsTasks = await getTTSTasksForWeek(start, end, ttsId);
      for (const t of ttsTasks) {
        // Only surface content-production-related tasks
        const isContent =
          t.type === 'Creation' ||
          t.title.toLowerCase().includes('draft') ||
          t.title.toLowerCase().includes('social') ||
          t.title.toLowerCase().includes('substack') ||
          t.title.toLowerCase().includes('caption') ||
          t.title.toLowerCase().includes('episode') ||
          t.title.toLowerCase().includes('film');
        if (isContent) {
          items.push({
            title: t.title,
            type: t.type ?? 'Task',
            status: t.status,
            dueDate: t.toDoDate,
            whatNeeded: inferWhatNeeded({ title: t.title, status: t.status }),
          });
        }
      }
    }

    // Content DB entries this week
    const contentEntries = await getContentEntriesForWeek(start, end);
    for (const entry of contentEntries) {
      items.push({
        title: entry.title,
        type: (entry as any).contentType?.join(', ') || 'Content',
        status: entry.status,
        dueDate: (entry as any).publishDate ?? null,
        whatNeeded: inferWhatNeeded({
          title: entry.title,
          status: entry.status,
          contentType: (entry as any).contentType,
        }),
      });
    }

    // If nothing needs attention, skip the deposit
    if (items.length === 0) {
      await logRunComplete({
        runId: run.id,
        startedAt: run.started_at,
        status: 'success',
        model: 'n/a',
        contextSummary: `daily_check today=${todayIso} tts_id=${ttsId ?? 'not found'}`,
        outputSummary: 'No TTS content items need attention this week',
      });
      return { runId: run.id, queueId: null, itemCount: 0 };
    }

    // Deposit report to queue
    const queueId = await depositToQueue({
      agent_name: AGENT_NAME,
      type: 'report',
      title: `Showrunner — Daily Pipeline Check (${todayIso})`,
      summary: `${items.length} content item${items.length === 1 ? '' : 's'} need${items.length === 1 ? 's' : ''} attention this week`,
      full_output: {
        date: todayIso,
        week_range: `${start} to ${end}`,
        items,
      },
      run_id: run.id,
    });

    await logRunComplete({
      runId: run.id,
      startedAt: run.started_at,
      status: 'success',
      model: 'n/a',
      contextSummary: `daily_check today=${todayIso} items=${items.length}`,
      outputSummary: `${items.length} content items flagged`,
      approvalQueueId: queueId,
    });

    return { runId: run.id, queueId, itemCount: items.length };
  } catch (e: any) {
    await logRunComplete({
      runId: run.id,
      startedAt: run.started_at,
      status: 'error',
      model: 'n/a',
      error: e?.message ?? String(e),
    });
    throw e;
  }
}
