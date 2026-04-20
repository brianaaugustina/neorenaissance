'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

interface NavMeta {
  pendingCount?: number;
  agentCount?: number;
}

const LINKS: Array<{ id: string; label: string; href: string; matcher: (p: string) => boolean }> = [
  { id: 'dashboard', label: 'Dashboard', href: '/', matcher: (p) => p === '/' },
  { id: 'queue', label: 'Agent Queue', href: '/queue', matcher: (p) => p.startsWith('/queue') },
  { id: 'outputs', label: 'All Outputs', href: '/outputs', matcher: (p) => p.startsWith('/outputs') },
  { id: 'schedule', label: 'Schedule', href: '/schedule', matcher: (p) => p.startsWith('/schedule') },
  { id: 'agents', label: 'All Agents', href: '/agents', matcher: (p) => p.startsWith('/agents') },
  { id: 'chat', label: 'Chat', href: '/chat', matcher: (p) => p.startsWith('/chat') },
];

/**
 * Shared top nav that ships on every page. Matches the AGENT.DASH design:
 * brand wordmark left · pipe-separated link list center · live meta right.
 */
export function AgentDashNav({ pendingCount, agentCount }: NavMeta = {}) {
  const pathname = usePathname() ?? '/';
  const [timeStr, setTimeStr] = useState('');

  useEffect(() => {
    const tick = () => {
      const d = new Date();
      const h = String(d.getHours()).padStart(2, '0');
      const m = String(d.getMinutes()).padStart(2, '0');
      setTimeStr(`${h}:${m}`);
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <nav className="topnav">
      <Link href="/" className="brand">
        AGENT.OS
      </Link>
      <ul>
        {LINKS.map((l) => (
          <li key={l.id}>
            <Link href={l.href} className={l.matcher(pathname) ? 'active' : ''}>
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
      <div className="meta">
        <span className="dot" />
        {agentCount != null ? `${agentCount} AGENTS · ` : ''}
        {timeStr}
        {pendingCount != null ? ` · QUEUE ${pendingCount}` : ''}
        <br />
        OPERATOR · BRIANA
      </div>
    </nav>
  );
}
