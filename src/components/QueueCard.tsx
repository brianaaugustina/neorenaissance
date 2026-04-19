'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import DOMPurify from 'isomorphic-dompurify';

interface DelegationSuggestion {
  task_title: string;
  agent: string;
  readiness: 'ready' | 'blocked';
  blockers: string[];
  chat_prompt: string;
}

interface QueueCardProps {
  item: {
    id: string;
    agent_name: string;
    type: string;
    status?: string;
    title: string;
    summary: string | null;
    full_output: any;
    created_at: string;
  };
}

export function QueueCard({ item }: QueueCardProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isRetrying, setIsRetrying] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [hidden, setHidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const briefingHtml = item.full_output?.briefing_html as string | undefined;
  const briefingLegacyMarkdown = item.full_output?.briefing_markdown as string | undefined;
  const hasBriefing = !!(briefingHtml || briefingLegacyMarkdown);
  const delegationSuggestions = (item.full_output?.delegation_suggestions ?? []) as DelegationSuggestion[];
  const showrunner = item.full_output?.post_draft ? item.full_output : null;
  const weeklyPlan = item.type === 'recommendation' && item.full_output?.plan_markdown ? item.full_output : null;
  const [activeTab, setActiveTab] = useState<'post' | 'meta' | 'captions'>('post');
  const [showExecutePreview, setShowExecutePreview] = useState(false);
  const hasExpandable = !!(hasBriefing || showrunner || weeklyPlan);
  const isApprovedPlan = weeklyPlan && item.status === 'approved';

  const act = (status: 'approved' | 'rejected') => {
    setError(null);
    const feedbackText = feedback.trim();
    const shouldRetry = status === 'rejected' && !!feedbackText;

    startTransition(async () => {
      try {
        const res = await fetch(`/api/queue/${item.id}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status, feedback: feedbackText || undefined }),
        });
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(payload.error || `Status update failed (${res.status})`);
        }

        if (!shouldRetry) {
          setHidden(true);
          return;
        }

        // Reject with feedback → trigger a retry. Keep the card visible with a
        // "Retrying..." state so Briana sees progress.
        setIsRetrying(true);
        const retryRes = await fetch(`/api/queue/${item.id}/retry`, {
          method: 'POST',
        });
        const retryPayload = await retryRes.json().catch(() => ({}));
        if (!retryRes.ok) {
          setIsRetrying(false);
          // Retry failed — undo the rejection so the item isn't lost. The
          // feedback text stays promoted in feedback_rules (it's useful there
          // regardless), but the item returns to pending so Briana can decide
          // whether to approve as-is or take another action.
          try {
            await fetch(`/api/queue/${item.id}/status`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ status: 'pending' }),
            });
          } catch {
            // Best-effort undo; if this fails, the recover-deferred script
            // can restore the item from the command line.
          }
          throw new Error(
            retryPayload.error ||
              `Retry failed (${retryRes.status}). Item restored to pending.`,
          );
        }
        setHidden(true);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed');
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

      {/* Ops Chief briefing — new HTML path with delegation action surface */}
      {expanded && briefingHtml && (
        <>
          <div
            className="briefing-body prose prose-invert prose-sm max-w-none mb-3 text-sm"
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(briefingHtml) }}
          />
          {delegationSuggestions.length > 0 && (
            <div className="mt-3 mb-3 space-y-2">
              <div className="text-xs muted uppercase tracking-wider mb-2">
                Delegation suggestions
              </div>
              {delegationSuggestions.map((s, i) => (
                <div
                  key={i}
                  className="border rounded-md p-3 text-sm"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <div className="flex items-start justify-between gap-3 mb-1">
                    <div className="min-w-0">
                      <div className="serif">{s.task_title}</div>
                      <div className="text-xs muted mt-0.5">
                        {s.agent} ·{' '}
                        <span
                          style={{
                            color:
                              s.readiness === 'ready'
                                ? 'var(--gold)'
                                : 'var(--muted)',
                          }}
                        >
                          {s.readiness === 'ready' ? 'All inputs ready' : 'Blocked'}
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        window.dispatchEvent(
                          new CustomEvent('ops-chief:prefill', {
                            detail: { text: s.chat_prompt },
                          }),
                        );
                      }}
                      className="shrink-0 px-3 py-1.5 text-xs rounded-md border hover:bg-white/5 transition min-h-[36px]"
                      style={{ borderColor: 'var(--gold)', color: 'var(--gold)' }}
                    >
                      Delegate to {s.agent}
                    </button>
                  </div>
                  {s.readiness === 'blocked' && s.blockers.length > 0 && (
                    <ul className="list-disc list-inside text-xs muted mt-2 space-y-0.5">
                      {s.blockers.map((b, j) => (
                        <li key={j}>{b}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Back-compat: old briefings stored as markdown */}
      {expanded && !briefingHtml && briefingLegacyMarkdown && (
        <div className="prose prose-invert prose-sm max-w-none mb-3 whitespace-pre-wrap text-sm">
          {briefingLegacyMarkdown}
        </div>
      )}

      {/* Showrunner content package */}
      {expanded && showrunner && (
        <div className="mb-3">
          <div className="flex gap-2 mb-3">
            {(['post', 'meta', 'captions'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className="px-3 py-1 text-xs rounded-md border transition"
                style={{
                  borderColor: activeTab === tab ? 'var(--gold)' : 'var(--border)',
                  color: activeTab === tab ? 'var(--gold)' : 'var(--muted)',
                }}
              >
                {tab === 'post' ? 'Post Draft' : tab === 'meta' ? 'Titles & Descriptions' : 'Social Captions'}
              </button>
            ))}
          </div>

          {activeTab === 'post' && (
            <div className="prose prose-invert prose-sm max-w-none whitespace-pre-wrap text-sm max-h-[400px] overflow-y-auto">
              {showrunner.post_draft}
            </div>
          )}

          {activeTab === 'meta' && (
            <div className="space-y-3 text-sm">
              <div>
                <span className="text-xs muted uppercase tracking-wider">Episode Title</span>
                <p className="serif mt-1">{showrunner.episode_title}</p>
              </div>
              <div>
                <span className="text-xs muted uppercase tracking-wider">Substack Subtitle</span>
                <p className="mt-1">{showrunner.substack_subtitle}</p>
              </div>
              <div>
                <span className="text-xs muted uppercase tracking-wider">YouTube Description</span>
                <pre className="mt-1 whitespace-pre-wrap text-xs muted">{showrunner.youtube_description}</pre>
              </div>
              <div>
                <span className="text-xs muted uppercase tracking-wider">Spotify Description</span>
                <p className="mt-1 text-xs muted">{showrunner.spotify_description}</p>
              </div>
            </div>
          )}

          {activeTab === 'captions' && (
            <ol className="space-y-3 text-sm list-decimal list-inside">
              {(showrunner.social_captions as string[] ?? []).map((caption: string, i: number) => (
                <li key={i} className="muted">
                  {caption}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {/* Weekly plan */}
      {expanded && weeklyPlan && (
        <div className="mb-3">
          <div className="prose prose-invert prose-sm max-w-none whitespace-pre-wrap text-sm max-h-[400px] overflow-y-auto">
            {weeklyPlan.plan_markdown}
          </div>
          {weeklyPlan.reschedules?.length > 0 && (
            <div className="mt-3 text-xs muted">
              {weeklyPlan.reschedules.length} task(s) to reschedule
              {weeklyPlan.new_tasks?.length > 0 && `, ${weeklyPlan.new_tasks.length} new task(s) to create`}
            </div>
          )}
        </div>
      )}

      {/* Execute preview for approved weekly plans */}
      {isApprovedPlan && showExecutePreview && (
        <div className="border rounded-md p-3 mb-3 text-sm" style={{ borderColor: 'var(--gold)' }}>
          <p className="serif mb-2">Changes to execute:</p>
          {weeklyPlan.reschedules?.length > 0 && (
            <div className="mb-2">
              <span className="text-xs muted uppercase tracking-wider">Reschedule ({weeklyPlan.reschedules.length})</span>
              <ul className="mt-1 space-y-1 text-xs muted">
                {weeklyPlan.reschedules.map((r: any, i: number) => (
                  <li key={i}>{r.task_title ?? r.taskTitle} → {r.new_date ?? r.newDate}</li>
                ))}
              </ul>
            </div>
          )}
          {weeklyPlan.new_tasks?.length > 0 && (
            <div className="mb-2">
              <span className="text-xs muted uppercase tracking-wider">Create ({weeklyPlan.new_tasks.length})</span>
              <ul className="mt-1 space-y-1 text-xs muted">
                {weeklyPlan.new_tasks.map((t: any, i: number) => (
                  <li key={i}>{t.title} — {t.to_do_date ?? t.toDoDate}</li>
                ))}
              </ul>
            </div>
          )}
          <button
            onClick={() => {
              setError(null);
              startTransition(async () => {
                try {
                  const res = await fetch(`/api/queue/${item.id}/execute`, { method: 'POST' });
                  if (!res.ok) throw new Error((await res.json()).error || 'Execute failed');
                  setHidden(true);
                } catch (e: any) {
                  setError(e.message);
                }
              });
            }}
            disabled={isPending}
            className="mt-2 px-4 py-2 text-sm rounded-md border hover:bg-white/5 transition disabled:opacity-40"
            style={{ borderColor: 'var(--gold)', color: 'var(--gold)' }}
          >
            {isPending ? 'Executing...' : 'Confirm & Execute'}
          </button>
        </div>
      )}

      {hasExpandable && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-xs gold hover:underline mb-3"
        >
          {expanded
            ? 'Collapse'
            : hasBriefing
              ? 'Read full briefing'
              : weeklyPlan
                ? 'View weekly plan'
                : 'View content package'}
        </button>
      )}

      {/* Execute Plan button for approved recommendations */}
      {isApprovedPlan && !showExecutePreview && (
        <button
          onClick={() => setShowExecutePreview(true)}
          className="px-4 py-2 text-sm rounded-md border hover:bg-white/5 transition mb-3 block"
          style={{ borderColor: 'var(--gold)', color: 'var(--gold)' }}
        >
          Execute Plan
        </button>
      )}

      {isRetrying && (
        <p className="text-xs mb-2" style={{ color: 'var(--gold)' }}>
          Retrying with your feedback… this usually takes 30-60 seconds.
        </p>
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
          {isRetrying ? 'Rejecting…' : feedback.trim() ? 'Reject & Retry' : 'Reject'}
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
