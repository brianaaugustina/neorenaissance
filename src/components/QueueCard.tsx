'use client';

import { useState, useTransition } from 'react';

interface QueueCardProps {
  item: {
    id: string;
    agent_name: string;
    type: string;
    title: string;
    summary: string | null;
    full_output: any;
    created_at: string;
  };
}

export function QueueCard({ item }: QueueCardProps) {
  const [isPending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [hidden, setHidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const briefing = item.full_output?.briefing_markdown as string | undefined;

  const act = (status: 'approved' | 'rejected' | 'deferred') => {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/queue/${item.id}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status, feedback: feedback || undefined }),
        });
        if (!res.ok) throw new Error((await res.json()).error || 'Failed');
        setHidden(true);
      } catch (e: any) {
        setError(e.message);
      }
    });
  };

  if (hidden) return null;

  const created = new Date(item.created_at).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });

  return (
    <article className="border rounded-lg p-4" style={{ borderColor: 'var(--border)' }}>
      <div className="flex items-start justify-between gap-4 mb-2">
        <div className="min-w-0">
          <div className="text-xs muted uppercase tracking-wider mb-1">
            {item.agent_name} · {item.type} · {created}
          </div>
          <h3 className="serif text-lg">{item.title}</h3>
        </div>
      </div>

      {item.summary && !expanded && (
        <p className="muted text-sm mb-3 line-clamp-2">{item.summary}</p>
      )}

      {expanded && briefing && (
        <div className="prose prose-invert prose-sm max-w-none mb-3 whitespace-pre-wrap text-sm">
          {briefing}
        </div>
      )}

      {briefing && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-xs gold hover:underline mb-3"
        >
          {expanded ? 'Collapse' : 'Read full briefing'}
        </button>
      )}

      <div className="flex flex-wrap items-center gap-2 mt-3">
        <button
          onClick={() => act('approved')}
          disabled={isPending}
          className="px-4 py-2 text-sm rounded-md border hover:bg-white/5 transition disabled:opacity-40 min-h-[44px] min-w-[88px]"
          style={{ borderColor: 'var(--gold)', color: 'var(--gold)' }}
        >
          Approve
        </button>
        <button
          onClick={() => act('rejected')}
          disabled={isPending}
          className="px-4 py-2 text-sm rounded-md border hover:bg-white/5 transition disabled:opacity-40 min-h-[44px] min-w-[80px]"
          style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
        >
          Reject
        </button>
        <button
          onClick={() => act('deferred')}
          disabled={isPending}
          className="px-4 py-2 text-sm rounded-md border hover:bg-white/5 transition disabled:opacity-40 min-h-[44px] min-w-[80px]"
          style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
        >
          Defer
        </button>
        <input
          type="text"
          placeholder="Feedback…"
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          className="flex-1 min-w-[140px] bg-transparent border rounded-md px-3 py-2 text-sm min-h-[44px]"
          style={{ borderColor: 'var(--border)' }}
        />
      </div>
      {error && <p className="text-xs mt-2" style={{ color: 'var(--danger)' }}>{error}</p>}
    </article>
  );
}
