'use client';

import { useState, type ReactNode } from 'react';

interface DashboardShellProps {
  myView: ReactNode;
  agentHQ: ReactNode;
  chat: ReactNode;
}

type Tab = 'day' | 'agents' | 'chat';

export function DashboardShell({ myView, agentHQ, chat }: DashboardShellProps) {
  const [tab, setTab] = useState<Tab>('day');

  return (
    <>
      {/* Desktop: grid with chat below My View in the left column */}
      <div className="hidden lg:grid lg:grid-cols-2 gap-6">
        <div className="flex flex-col gap-6 min-w-0">
          {myView}
          {chat}
        </div>
        <div className="min-w-0">{agentHQ}</div>
      </div>

      {/* Mobile: single-panel with bottom tab bar */}
      <div className="lg:hidden pb-24">
        <div className={tab === 'day' ? 'block' : 'hidden'}>{myView}</div>
        <div className={tab === 'agents' ? 'block' : 'hidden'}>{agentHQ}</div>
        <div className={tab === 'chat' ? 'block' : 'hidden'}>{chat}</div>

        <nav
          className="fixed bottom-0 inset-x-0 z-40 border-t backdrop-blur-md"
          style={{
            background: 'color-mix(in srgb, var(--background) 85%, transparent)',
            borderColor: 'var(--border)',
            paddingBottom: 'env(safe-area-inset-bottom, 0)',
          }}
        >
          <div className="grid grid-cols-3">
            <TabButton active={tab === 'day'} onClick={() => setTab('day')} label="My Day" />
            <TabButton active={tab === 'agents'} onClick={() => setTab('agents')} label="Agents" />
            <TabButton active={tab === 'chat'} onClick={() => setTab('chat')} label="Chat" />
          </div>
        </nav>
      </div>
    </>
  );
}

function TabButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className="serif py-4 text-sm transition"
      style={{
        color: active ? 'var(--gold)' : 'var(--muted)',
        borderTop: active ? '2px solid var(--gold)' : '2px solid transparent',
        marginTop: -1,
      }}
    >
      {label}
    </button>
  );
}
