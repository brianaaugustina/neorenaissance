'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { ChatMessageView } from '@/lib/dashboard/load';

interface OpsChiefChatProps {
  initialHistory: ChatMessageView[];
}

interface LocalMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  pending?: boolean;
  actionCount?: number;
}

function toLocal(m: ChatMessageView): LocalMessage {
  return { id: m.id, role: m.role, content: m.content };
}

export function OpsChiefChat({ initialHistory }: OpsChiefChatProps) {
  const router = useRouter();
  const [messages, setMessages] = useState<LocalMessage[]>(initialHistory.map(toLocal));
  const [input, setInput] = useState('');
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Listen for delegation-triggered prefill events fired by QueueCard.
  // Fills the textarea with a suggested prompt so Briana can review, edit,
  // and send — rather than blindly auto-submitting on her behalf.
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ text?: string }>;
      const text = ce.detail?.text;
      if (!text) return;
      setInput(text);
      // Defer focus so the textarea sees the new value first.
      queueMicrotask(() => {
        textareaRef.current?.focus();
        textareaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    };
    window.addEventListener('ops-chief:prefill', handler);
    return () => window.removeEventListener('ops-chief:prefill', handler);
  }, []);

  const send = () => {
    const text = input.trim();
    if (!text || isPending) return;
    setError(null);
    setInput('');

    const userMsg: LocalMessage = {
      id: `local-user-${Date.now()}`,
      role: 'user',
      content: text,
    };
    const placeholderId = `local-asst-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      userMsg,
      { id: placeholderId, role: 'assistant', content: 'Thinking…', pending: true },
    ]);

    startTransition(async () => {
      try {
        const res = await fetch('/api/agents/ops-chief/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || 'Failed');
        setMessages((prev) =>
          prev.map((m) =>
            m.id === placeholderId
              ? {
                  id: placeholderId,
                  role: 'assistant',
                  content: data.reply,
                  actionCount: Array.isArray(data.actions) ? data.actions.length : 0,
                }
              : m,
          ),
        );
        // Refresh server data so any task writes show up in My View.
        if (Array.isArray(data.actions) && data.actions.length > 0) {
          router.refresh();
        }
      } catch (e: any) {
        setError(e.message);
        setMessages((prev) => prev.filter((m) => m.id !== placeholderId));
      }
    });
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div>
      {messages.length > 0 && (
        <div
          ref={scrollRef}
          className="max-h-72 overflow-y-auto space-y-3 mb-3 pr-2 text-sm"
        >
          {messages.map((m) => (
            <div
              key={m.id}
              className={
                m.role === 'user'
                  ? 'flex justify-end'
                  : 'flex justify-start'
              }
            >
              <div
                className={
                  'max-w-[85%] rounded-lg px-3 py-2 whitespace-pre-wrap ' +
                  (m.role === 'user'
                    ? 'bg-white/5 border'
                    : 'border')
                }
                style={{
                  borderColor:
                    m.role === 'user' ? 'var(--gold-dim)' : 'var(--border)',
                  opacity: m.pending ? 0.6 : 1,
                }}
              >
                {m.content}
                {!!m.actionCount && (
                  <div className="text-[10px] muted mt-1">
                    {m.actionCount} action{m.actionCount === 1 ? '' : 's'} taken
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKey}
          placeholder="Push the Substack draft to Thursday…"
          rows={2}
          disabled={isPending}
          className="flex-1 bg-transparent border rounded-lg px-3 py-3 md:py-2 text-sm resize-none disabled:opacity-40 min-h-[48px]"
          style={{ borderColor: 'var(--border)' }}
        />
        <button
          onClick={send}
          disabled={isPending || !input.trim()}
          className="px-4 py-3 md:py-2 text-sm rounded-lg border transition disabled:opacity-40 min-h-[48px]"
          style={{ borderColor: 'var(--gold)', color: 'var(--gold)' }}
        >
          {isPending ? '…' : 'Send'}
        </button>
      </div>
      {error && (
        <p className="text-xs mt-2" style={{ color: 'var(--danger)' }}>
          {error}
        </p>
      )}
    </div>
  );
}
