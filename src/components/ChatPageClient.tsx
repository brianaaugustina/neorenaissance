'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { formatPtTime, formatPtRelative } from '@/lib/time';

interface AgentInfo {
  id: string;
  aliases: string[];
  name: string;
  tagline: string;
  venture: string;
  layer: 'execution' | 'strategy' | 'meta';
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

interface LocalMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at?: string;
  pending?: boolean;
  actionCount?: number;
}

interface Props {
  agents: AgentInfo[];
  initialActiveId: string;
  opsChiefHistory: ChatMessage[];
  lastRunsByAgent: Record<
    string,
    { started_at: string; output_summary: string | null; status: string }
  >;
}

const OPS_CHIEF_WIRED = true;
const OPS_CHIEF_IDS = new Set(['ops_chief', 'ops-chief']);

const SUGGESTED_PROMPTS_OPS_CHIEF = [
  'Summarize today\u2019s briefing in one paragraph.',
  'What\u2019s blocking me right now?',
  'Move the Substack draft to tomorrow and bump the sponsor outreach forward.',
  'What\u2019s the single most important thing on my plate today?',
];

export function ChatPageClient({
  agents,
  initialActiveId,
  opsChiefHistory,
  lastRunsByAgent,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [activeId, setActiveId] = useState<string>(
    agents.find((a) => a.id === initialActiveId || a.aliases.includes(initialActiveId))?.id ??
      'ops_chief',
  );
  const [search, setSearch] = useState('');

  // Per-thread message store (client-side). Ops Chief seeds with server history.
  const [threadMessages, setThreadMessages] = useState<Record<string, LocalMessage[]>>(() => {
    const initial: Record<string, LocalMessage[]> = {};
    initial['ops_chief'] = opsChiefHistory.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      created_at: m.created_at,
    }));
    return initial;
  });
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const activeAgent = agents.find((a) => a.id === activeId) ?? agents[0];
  const isOpsChief = OPS_CHIEF_IDS.has(activeAgent.id);
  const wired = OPS_CHIEF_WIRED && isOpsChief;
  const messages = threadMessages[activeAgent.id] ?? [];

  const filteredAgents = useMemo(() => {
    if (!search.trim()) return agents;
    const q = search.trim().toLowerCase();
    return agents.filter(
      (a) =>
        a.id.toLowerCase().includes(q) ||
        a.name.toLowerCase().includes(q) ||
        a.tagline.toLowerCase().includes(q) ||
        a.venture.toLowerCase().includes(q),
    );
  }, [agents, search]);

  // Scroll the log to the bottom when messages change.
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [messages.length]);

  const send = () => {
    const text = input.trim();
    if (!text || !wired) return;
    setError(null);
    setInput('');

    const userMsg: LocalMessage = {
      id: `local-user-${Date.now()}`,
      role: 'user',
      content: text,
      created_at: new Date().toISOString(),
    };
    const placeholderId = `local-asst-${Date.now()}`;
    setThreadMessages((prev) => ({
      ...prev,
      [activeAgent.id]: [
        ...(prev[activeAgent.id] ?? []),
        userMsg,
        {
          id: placeholderId,
          role: 'assistant',
          content: 'Thinking\u2026',
          pending: true,
        },
      ],
    }));

    startTransition(async () => {
      try {
        const res = await fetch('/api/agents/ops-chief/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || 'Failed');
        setThreadMessages((prev) => ({
          ...prev,
          [activeAgent.id]: (prev[activeAgent.id] ?? []).map((m) =>
            m.id === placeholderId
              ? {
                  id: placeholderId,
                  role: 'assistant',
                  content: data.reply,
                  created_at: new Date().toISOString(),
                  actionCount: Array.isArray(data.actions) ? data.actions.length : 0,
                }
              : m,
          ),
        }));
        if (Array.isArray(data.actions) && data.actions.length > 0) {
          router.refresh();
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed');
        setThreadMessages((prev) => ({
          ...prev,
          [activeAgent.id]: (prev[activeAgent.id] ?? []).filter(
            (m) => m.id !== placeholderId,
          ),
        }));
      }
    });
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      send();
    }
  };

  const unreadForAgent = (id: string): boolean => {
    // Simple heuristic: an agent is "unread" if their last run was in the last
    // 8 hours and they have no chat messages in today's history.
    const run = lastRunsByAgent[id.replace(/_/g, '-')];
    if (!run) return false;
    const ageMs = Date.now() - new Date(run.started_at).getTime();
    return ageMs < 8 * 3600 * 1000;
  };

  const totalUnread = agents.filter((a) => unreadForAgent(a.id)).length;

  return (
    <main
      style={{
        padding: '32px 40px 0',
        maxWidth: 1600,
        margin: '0 auto',
      }}
    >
      <div style={{ marginBottom: 10 }}>
        <p className="eyebrow">Direct Agent Comms · Operator Console</p>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'end',
            gap: 40,
            flexWrap: 'wrap',
          }}
        >
          <h1 className="title" style={{ fontSize: 72 }}>
            Chat
            <span className="count">({totalUnread})</span>
          </h1>
          <p className="sub" style={{ margin: 0 }}>
            Ops Chief is wired. Other channels surface soon — each agent will
            get its own direct line as it grows.
          </p>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '300px 1fr 300px',
          border: '1px solid var(--rule-strong)',
          minHeight: 'calc(100vh - 240px)',
          marginTop: 20,
        }}
      >
        {/* Sidebar */}
        <aside
          style={{
            borderRight: '1px solid var(--rule-strong)',
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
          }}
        >
          <div
            style={{
              padding: '14px 18px',
              borderBottom: '1px solid var(--rule-strong)',
              fontSize: 10,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: 'var(--ink-2)',
              fontWeight: 500,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
            }}
          >
            <span>Threads</span>
            <span className="mono" style={{ color: 'var(--ink-3)', letterSpacing: '0.04em' }}>
              {agents.length}
            </span>
          </div>
          <div style={{ padding: '10px 18px', borderBottom: '1px solid var(--rule)' }}>
            <input
              type="text"
              placeholder="Search agents\u2026"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="mono"
              style={{
                width: '100%',
                background: 'transparent',
                border: 'none',
                borderBottom: '1px solid var(--ink)',
                padding: '6px 2px',
                fontSize: 12,
                color: 'var(--ink)',
                outline: 'none',
                letterSpacing: '0.04em',
              }}
            />
          </div>
          <ul
            style={{
              listStyle: 'none',
              padding: 0,
              margin: 0,
              overflowY: 'auto',
              flex: 1,
            }}
          >
            {filteredAgents.map((a) => {
              const isActive = a.id === activeAgent.id;
              const unread = unreadForAgent(a.id);
              const run = lastRunsByAgent[a.id.replace(/_/g, '-')];
              return (
                <li
                  key={a.id}
                  onClick={() => setActiveId(a.id)}
                  style={{
                    padding: '14px 18px',
                    borderBottom: '1px solid var(--rule)',
                    cursor: 'pointer',
                    background: isActive ? 'var(--ink)' : 'transparent',
                    color: isActive ? 'var(--bg)' : 'inherit',
                    transition: 'background 0.12s',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'baseline',
                      marginBottom: 4,
                      gap: 8,
                    }}
                  >
                    <span
                      style={{
                        fontWeight: 600,
                        fontSize: 14,
                        letterSpacing: '-0.005em',
                      }}
                    >
                      {unread && !isActive && (
                        <span
                          style={{
                            display: 'inline-block',
                            width: 6,
                            height: 6,
                            background: 'var(--ink)',
                            borderRadius: '50%',
                            marginRight: 6,
                            transform: 'translateY(-1px)',
                          }}
                        />
                      )}
                      {a.name}
                    </span>
                    <span
                      className="mono"
                      style={{
                        fontSize: 10,
                        color: isActive ? 'var(--bg-3)' : 'var(--ink-3)',
                        letterSpacing: '0.04em',
                      }}
                    >
                      {run ? formatPtRelative(run.started_at).toUpperCase() : '—'}
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: isActive ? 'var(--bg-3)' : 'var(--ink-3)',
                      lineHeight: 1.4,
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}
                  >
                    {run?.output_summary ?? a.tagline}
                  </div>
                </li>
              );
            })}
          </ul>
        </aside>

        {/* Conversation */}
        <section style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div
            style={{
              padding: '18px 28px',
              borderBottom: '1px solid var(--rule-strong)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 20,
              flexWrap: 'wrap',
            }}
          >
            <div style={{ minWidth: 0, flex: 1 }}>
              <h2
                style={{
                  fontSize: 22,
                  fontWeight: 600,
                  letterSpacing: '-0.02em',
                  margin: 0,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {activeAgent.name}
              </h2>
              <div
                className="mono"
                style={{
                  fontSize: 11,
                  color: 'var(--ink-2)',
                  letterSpacing: '0.06em',
                  marginTop: 2,
                }}
              >
                {activeAgent.venture} · {activeAgent.layer}
                {!wired ? ' · channel not wired yet' : ''}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
              <Link
                href={`/agents/${activeAgent.id}`}
                className="btn ghost sm"
                style={{ borderRadius: 0 }}
              >
                Agent page →
              </Link>
              <Link
                href={`/outputs?agent=${encodeURIComponent(activeAgent.id)}`}
                className="btn ghost sm"
                style={{ borderRadius: 0 }}
              >
                View outputs →
              </Link>
            </div>
          </div>

          <div
            ref={logRef}
            style={{
              flex: 1,
              padding: '28px 28px 12px',
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
              minHeight: 0,
            }}
          >
            {!wired ? (
              <MsgSystem>
                This channel isn\u2019t wired yet. {activeAgent.name} runs on a
                schedule — you\u2019ll get a direct line when it ships. For now,
                open the <Link href={`/agents/${activeAgent.id}`} style={{ color: 'var(--ink)' }}>agent page</Link> to trigger runs or inspect outputs.
              </MsgSystem>
            ) : messages.length === 0 ? (
              <MsgSystem>
                No messages yet today. Ops Chief picks up fresh Notion tasks,
                queue state, and permanent preferences at the start of every
                turn — so ask anything.
              </MsgSystem>
            ) : (
              messages.map((m) => <Message key={m.id} message={m} />)
            )}
          </div>

          <div
            style={{
              borderTop: '1px solid var(--rule-strong)',
              padding: '18px 28px',
              display: 'grid',
              gridTemplateRows: 'auto auto',
              gap: 10,
            }}
          >
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKey}
              disabled={!wired || isPending}
              placeholder={
                wired
                  ? `Message ${activeAgent.name.toLowerCase()}\u2026 (\u2318 + Enter to send)`
                  : 'This channel isn\u2019t wired yet'
              }
              style={{
                width: '100%',
                border: 'none',
                background: 'transparent',
                fontSize: 14,
                color: 'var(--ink)',
                outline: 'none',
                resize: 'none',
                minHeight: 52,
                maxHeight: 200,
                lineHeight: 1.5,
                fontFamily: 'inherit',
              }}
            />
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                borderTop: '1px solid var(--rule)',
                paddingTop: 10,
              }}
            >
              <div
                className="mono"
                style={{
                  display: 'flex',
                  gap: 14,
                  fontSize: 10,
                  letterSpacing: '0.08em',
                  color: 'var(--ink-3)',
                  textTransform: 'uppercase',
                }}
              >
                <span>\u2318 + Enter to send</span>
              </div>
              <button
                onClick={send}
                disabled={!wired || isPending || !input.trim()}
                className="btn primary sm"
                style={{ borderRadius: 0 }}
              >
                {isPending ? 'Sending\u2026' : 'Send \u2192'}
              </button>
            </div>
            {error && (
              <p
                className="mono"
                style={{
                  fontSize: 10,
                  color: 'var(--danger)',
                  letterSpacing: '0.04em',
                  margin: 0,
                }}
              >
                {error}
              </p>
            )}
          </div>
        </section>

        {/* Context rail */}
        <aside
          style={{
            borderLeft: '1px solid var(--rule-strong)',
            padding: '20px 24px',
            overflowY: 'auto',
          }}
        >
          <h4 style={railH4}>Active agent</h4>
          <Kv k="id" v={activeAgent.id} />
          <Kv k="venture" v={activeAgent.venture} />
          <Kv k="layer" v={activeAgent.layer} />
          <Kv k="wired" v={wired ? 'yes' : 'not yet'} color={wired ? 'var(--ok)' : 'var(--ink-3)'} />
          {lastRunsByAgent[activeAgent.id.replace(/_/g, '-')] && (
            <Kv
              k="last run"
              v={formatPtRelative(
                lastRunsByAgent[activeAgent.id.replace(/_/g, '-')]!.started_at,
              )}
            />
          )}

          {wired && (
            <>
              <h4 style={railH4}>Suggested prompts</h4>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {SUGGESTED_PROMPTS_OPS_CHIEF.map((p) => (
                  <li
                    key={p}
                    onClick={() => {
                      setInput(p);
                      textareaRef.current?.focus();
                    }}
                    style={{
                      padding: '10px 0',
                      borderBottom: '1px solid var(--rule)',
                      fontSize: 12,
                      cursor: 'pointer',
                      color: 'var(--ink-2)',
                      lineHeight: 1.45,
                    }}
                  >
                    {p}
                  </li>
                ))}
              </ul>
            </>
          )}

          <h4 style={railH4}>Tagline</h4>
          <p
            className="mono"
            style={{
              fontSize: 11,
              color: 'var(--ink-3)',
              letterSpacing: '0.04em',
              lineHeight: 1.55,
              margin: 0,
            }}
          >
            {activeAgent.tagline}
          </p>
        </aside>
      </div>
    </main>
  );
}

// ============================================================================

const railH4: React.CSSProperties = {
  fontSize: 10,
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  margin: '24px 0 12px',
  fontWeight: 500,
  color: 'var(--ink-2)',
};

function Kv({ k, v, color }: { k: string; v: string; color?: string }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr auto',
        fontSize: 12,
        padding: '6px 0',
        borderBottom: '1px solid var(--rule)',
      }}
    >
      <span
        className="mono"
        style={{
          color: 'var(--ink-2)',
          fontSize: 11,
          letterSpacing: '0.04em',
        }}
      >
        {k}
      </span>
      <span
        className="mono"
        style={{ fontWeight: 600, color: color ?? 'var(--ink)' }}
      >
        {v}
      </span>
    </div>
  );
}

function MsgSystem({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        alignSelf: 'center',
        maxWidth: 520,
        border: '1px dashed var(--rule-strong)',
        padding: '14px 18px',
        fontSize: 12,
        lineHeight: 1.55,
        color: 'var(--ink-2)',
        fontFamily: 'var(--font-mono)',
        letterSpacing: '0.04em',
        textAlign: 'center',
      }}
    >
      {children}
    </div>
  );
}

function Message({ message }: { message: LocalMessage }) {
  const isUser = message.role === 'user';
  return (
    <div
      style={{
        maxWidth: 680,
        marginLeft: isUser ? 'auto' : 0,
      }}
    >
      <div
        style={{
          fontSize: 10,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          fontWeight: 600,
          color: 'var(--ink-2)',
          marginBottom: 4,
          display: 'flex',
          gap: 10,
        }}
      >
        <span>{isUser ? 'You' : 'Ops Chief'}</span>
        {message.created_at && (
          <span
            className="mono"
            style={{
              color: 'var(--ink-3)',
              fontWeight: 400,
              letterSpacing: '0.06em',
            }}
          >
            {formatPtTime(message.created_at)}
          </span>
        )}
      </div>
      <div
        style={{
          padding: '14px 18px',
          fontSize: 14,
          lineHeight: 1.55,
          border: '1px solid var(--rule-strong)',
          background: isUser ? 'var(--ink)' : 'var(--bg)',
          color: isUser ? 'var(--bg)' : 'var(--ink)',
          borderColor: isUser ? 'var(--ink)' : 'var(--rule-strong)',
          whiteSpace: 'pre-wrap',
          opacity: message.pending ? 0.6 : 1,
        }}
      >
        {message.content}
        {!!message.actionCount && (
          <div
            className="mono"
            style={{
              fontSize: 10,
              color: isUser ? 'var(--bg-3)' : 'var(--ink-3)',
              marginTop: 8,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
            }}
          >
            {message.actionCount} action
            {message.actionCount === 1 ? '' : 's'} taken
          </div>
        )}
      </div>
    </div>
  );
}
