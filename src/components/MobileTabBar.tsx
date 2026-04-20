'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// Fixed bottom tab bar shown only on ≤768px screens (enforced in globals.css).
// Three tabs per the Mobile.html design: Dashboard · Queue · Chat. Other pages
// (Outputs, Agents, Schedule, To-Dos) stay reachable through in-page links.
export function MobileTabBar({ queueCount = 0 }: { queueCount?: number }) {
  const pathname = usePathname() ?? '/';

  const tabs = [
    {
      id: 'dashboard',
      label: 'Dashboard',
      href: '/',
      active: pathname === '/',
      icon: (
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
          <rect x="1" y="1" width="8" height="8" fill="currentColor" />
          <rect
            x="11"
            y="1"
            width="8"
            height="8"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <rect
            x="1"
            y="11"
            width="8"
            height="8"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <rect x="11" y="11" width="8" height="8" fill="currentColor" />
        </svg>
      ),
    },
    {
      id: 'queue',
      label: 'Queue',
      href: '/queue',
      active: pathname.startsWith('/queue'),
      icon: (
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
          <rect
            x="2"
            y="3"
            width="16"
            height="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <line x1="5" y1="7" x2="15" y2="7" stroke="currentColor" strokeWidth="1.5" />
          <line x1="5" y1="10" x2="15" y2="10" stroke="currentColor" strokeWidth="1.5" />
          <line x1="5" y1="13" x2="11" y2="13" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      ),
      badge: queueCount,
    },
    {
      id: 'chat',
      label: 'Chat',
      href: '/chat',
      active: pathname.startsWith('/chat'),
      icon: (
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
          <path
            d="M2 5c0-1.1.9-2 2-2h12c1.1 0 2 .9 2 2v8c0 1.1-.9 2-2 2H8l-4 3v-3H4c-1.1 0-2-.9-2-2V5z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          />
        </svg>
      ),
    },
  ];

  return (
    <nav className="mobile-tabbar" aria-label="Primary">
      {tabs.map((tab) => (
        <Link
          key={tab.id}
          href={tab.href}
          className={`tab${tab.active ? ' on' : ''}`}
          aria-current={tab.active ? 'page' : undefined}
        >
          <div className="ico">{tab.icon}</div>
          <span>{tab.label}</span>
          {tab.badge && tab.badge > 0 ? (
            <span className="badge">{tab.badge}</span>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}
