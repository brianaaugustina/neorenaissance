'use client';

import DOMPurify from 'isomorphic-dompurify';
import { useMemo } from 'react';

interface LandscapeBodyProps {
  html?: string;
  /** Legacy — briefings stored before the HTML switch. */
  markdown?: string;
}

// Renders the editorial landscape briefing body from whichever shape the row
// was saved in. Kept client-side because isomorphic-dompurify is jsdom-backed
// and doesn't play well with Next.js 16 server components.
export function LandscapeBody({ html, markdown }: LandscapeBodyProps) {
  const sanitized = useMemo(() => {
    if (html) return DOMPurify.sanitize(html);
    if (markdown) return DOMPurify.sanitize(convertLegacyMarkdown(markdown));
    return '';
  }, [html, markdown]);

  if (!sanitized) {
    return (
      <p className="muted text-sm">
        (Briefing body is empty — try running a fresh landscape briefing.)
      </p>
    );
  }

  return (
    <article
      className="briefing-body text-sm"
      dangerouslySetInnerHTML={{ __html: sanitized }}
    />
  );
}

// Legacy fallback — briefings stored before HTML. Converts the four-section
// markdown shape into minimal HTML. Kept small intentionally; the sanitizer
// then strips anything unexpected.
function convertLegacyMarkdown(md: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  let inList = false;
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${escapeHtml(para.join(' '))}</p>`);
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
    if (line.startsWith('## ')) {
      flushPara();
      closeList();
      out.push(`<h2>${escapeHtml(line.slice(3))}</h2>`);
      continue;
    }
    if (line.startsWith('# ')) {
      flushPara();
      closeList();
      out.push(`<h2>${escapeHtml(line.slice(2))}</h2>`);
      continue;
    }
    if (line.startsWith('- ') || line.startsWith('* ')) {
      flushPara();
      if (!inList) {
        out.push('<ul>');
        inList = true;
      }
      out.push(`<li>${escapeHtml(line.slice(2))}</li>`);
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
