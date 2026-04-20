'use client';

import DOMPurify from 'isomorphic-dompurify';
import { useMemo } from 'react';

// Renders the narrative/assessment section of an agent output. Prefers HTML,
// falls back to a simple markdown converter (shares the LandscapeBody
// approach but scoped — we don't depend on LandscapeBody directly so blocks
// can mix HTML text with structured children below it).
//
// Three content modes:
//   html      — already-HTML string (briefings, GoogleDocs-style drafts)
//   markdown  — legacy briefings; converted to minimal HTML
//   children  — arbitrary JSX rendered under the `.briefing-body` wrapper
//               (used by per-agent blocks to mix HTML narrative + cards).
//
// All three can combine: html renders first, then children below it.
export function Assessment({
  html,
  markdown,
  children,
}: {
  html?: string;
  markdown?: string;
  children?: React.ReactNode;
}) {
  const sanitized = useMemo(() => {
    if (html) return DOMPurify.sanitize(html);
    if (markdown) return DOMPurify.sanitize(convertLegacyMarkdown(markdown));
    return '';
  }, [html, markdown]);

  const hasAny = !!sanitized || !!children;
  if (!hasAny) return null;

  return (
    <section
      style={{
        marginBottom: 36,
        paddingBottom: 32,
        borderBottom: '1px solid var(--rule)',
      }}
    >
      <h2
        style={{
          fontSize: 11,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: 'var(--ink-2)',
          margin: '0 0 18px',
          fontWeight: 500,
          paddingBottom: 8,
          borderBottom: '1px solid var(--rule)',
        }}
      >
        Assessment
      </h2>
      {sanitized && (
        <article
          className="briefing-body"
          style={{ fontSize: 14, lineHeight: 1.6 }}
          dangerouslySetInnerHTML={{ __html: sanitized }}
        />
      )}
      {children}
    </section>
  );
}

// Minimal markdown → HTML (headings, lists, paragraphs). Mirrors the
// LandscapeBody legacy converter but kept local so Assessment can live
// alongside the block components as its own unit.
function convertLegacyMarkdown(md: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  let inList = false;
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${inlineFormat(escapeHtml(para.join(' ')))}</p>`);
      para = [];
    }
  };
  const closeList = () => {
    if (inList) {
      out.push('</ul>');
      inList = false;
    }
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flushPara();
      closeList();
      continue;
    }
    if (line.startsWith('### ')) {
      flushPara();
      closeList();
      out.push(`<h3>${inlineFormat(escapeHtml(line.slice(4)))}</h3>`);
      continue;
    }
    if (line.startsWith('## ')) {
      flushPara();
      closeList();
      out.push(`<h2>${inlineFormat(escapeHtml(line.slice(3)))}</h2>`);
      continue;
    }
    if (line.startsWith('# ')) {
      flushPara();
      closeList();
      out.push(`<h2>${inlineFormat(escapeHtml(line.slice(2)))}</h2>`);
      continue;
    }
    if (line.startsWith('- ') || line.startsWith('* ')) {
      flushPara();
      if (!inList) {
        out.push('<ul>');
        inList = true;
      }
      out.push(`<li>${inlineFormat(escapeHtml(line.slice(2)))}</li>`);
      continue;
    }
    closeList();
    para.push(line);
  }
  flushPara();
  closeList();
  return out.join('\n');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Post-escape inline markdown — **bold** and *italic* only, DOMPurify
// sanitises the result anyway so we don't need to handle links here.
function inlineFormat(s: string): string {
  return s
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, '$1<em>$2</em>');
}

// Helper blocks per-agent renderers can mix under the narrative.
// ---------------------------------------------------------------------------
export function AssessmentParagraph({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        fontSize: 14,
        lineHeight: 1.6,
        margin: '0 0 12px',
        whiteSpace: 'pre-wrap',
        color: 'var(--ink)',
      }}
    >
      {children}
    </p>
  );
}

export function AssessmentStatRow({
  stats,
}: {
  stats: Array<{ n: string | number; label: string; tone?: 'default' | 'warn' | 'bad' }>;
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${stats.length}, 1fr)`,
        gap: 0,
        border: '1px solid var(--rule)',
        marginTop: 16,
        marginBottom: 16,
      }}
    >
      {stats.map((s, i) => (
        <div
          key={i}
          style={{
            padding: '14px 16px',
            borderRight:
              i < stats.length - 1 ? '1px solid var(--rule)' : 'none',
          }}
        >
          <div
            style={{
              fontSize: 24,
              fontWeight: 700,
              letterSpacing: '-0.02em',
              lineHeight: 1,
              color:
                s.tone === 'bad'
                  ? 'var(--danger)'
                  : s.tone === 'warn'
                    ? 'var(--ink)'
                    : 'var(--ink)',
            }}
          >
            {s.n}
          </div>
          <div
            className="mono"
            style={{
              fontSize: 10,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: 'var(--ink-2)',
              marginTop: 6,
              fontWeight: 500,
            }}
          >
            {s.label}
          </div>
        </div>
      ))}
    </div>
  );
}

export function AssessmentSubhead({ children }: { children: React.ReactNode }) {
  return (
    <h3
      className="mono"
      style={{
        fontSize: 11,
        letterSpacing: '0.16em',
        textTransform: 'uppercase',
        color: 'var(--ink-2)',
        margin: '20px 0 10px',
        fontWeight: 600,
      }}
    >
      {children}
    </h3>
  );
}
