import { AgentDashNav } from '@/components/AgentDashNav';
import { QueuePageClient } from '@/components/QueuePageClient';
import { getQueueItems } from '@/lib/supabase/client';
import type { QueueItemLike } from '@/lib/queue/classify';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function QueuePage() {
  const [pending, approved, executed] = await Promise.all([
    getQueueItems('pending', 100).catch(() => [] as unknown[]),
    getQueueItems('approved', 50).catch(() => [] as unknown[]),
    getQueueItems('executed', 30).catch(() => [] as unknown[]),
  ]);

  // Keep: pending items + approved-with-downstream + recent executed (so
  // Briana can see what she just finished).
  const items: QueueItemLike[] = [
    ...(pending as QueueItemLike[]),
    ...((approved as QueueItemLike[]).filter((i) => hasDownstream(i))),
  ];

  // Drop rows already superseded/ignored/rejected (they'd confuse the
  // "action-needed" framing of this page). The /outputs page is where past
  // outputs live.
  const actionable = items.filter(
    (i) => !['superseded', 'ignored', 'rejected', 'deferred'].includes(i.status),
  );

  return (
    <>
      <AgentDashNav pendingCount={actionable.length} />
      <QueuePageClient
        items={actionable}
        recentlyExecuted={(executed as QueueItemLike[]).slice(0, 8)}
      />
    </>
  );
}

function hasDownstream(item: QueueItemLike): boolean {
  // Weekly plans stay in queue until Execute; Showrunner drafts stay until
  // every clip is scheduled; others drop out on approval.
  if (item.type === 'recommendation') return true;
  if (item.agent_name === 'showrunner' && item.type === 'draft') {
    const fo = (item.full_output ?? {}) as {
      clip_captions?: Array<{ scheduled_at?: unknown }>;
    };
    const clips = Array.isArray(fo.clip_captions) ? fo.clip_captions : [];
    return clips.length > 0 && clips.some((c) => !c.scheduled_at);
  }
  if (item.agent_name === 'talent-scout' && item.type === 'draft') {
    const fo = (item.full_output ?? {}) as { sent_at?: unknown };
    return !fo.sent_at;
  }
  return false;
}
