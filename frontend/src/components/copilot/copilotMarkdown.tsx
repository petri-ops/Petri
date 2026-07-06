// ============================================================
// Lightweight markdown renderer for Copilot replies.
// Handles: code fences, inline code, **bold**, *italic*, links, lists.
// Also renders [[ACTION:i]] sentinels as ActionCard components.
// No external deps to keep bundle small.
// ============================================================

import React from 'react';
import { ActionCard } from './ActionCard';
import type { CopilotAction } from './copilotActions';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Inline formatter: returns raw HTML string. Input must be already HTML-escaped. */
function renderInline(text: string): string {
  // links [text](url)
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, t, u) => {
    const safeU = u.replace(/"/g, '&quot;');
    return `<a href="${safeU}" target="_blank" rel="noopener noreferrer">${t}</a>`;
  });
  // inline code `...`
  text = text.replace(/`([^`\n]+)`/g, '<code class="cp-inline-code">$1</code>');
  // bold **...**
  text = text.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  // italic *...* (avoid clashing with bold; lookarounds not universal — simple pass)
  text = text.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  return text;
}

interface Block {
  type: 'p' | 'code' | 'ul' | 'ol' | 'h' | 'action' | 'table';
  level?: number; // for h
  lang?: string; // for code
  actionIdx?: number; // for action sentinels
  lines: string[];
  header?: string[]; // for table: header cells
  rows?: string[][]; // for table: body rows
  align?: Array<'left' | 'center' | 'right' | null>; // for table: column alignment
}

// GFM table helpers
function splitTableRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  // split on unescaped pipes
  return s.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
}

function isTableSeparator(line: string): boolean {
  // e.g. |---|:--:|--:|  — each cell is dashes with optional leading/trailing colon
  const t = line.trim();
  if (!t.includes('-') || !t.includes('|')) return false;
  return splitTableRow(t).every((c) => /^:?-{1,}:?$/.test(c.replace(/\s/g, '')));
}

function parseAlign(cell: string): 'left' | 'center' | 'right' | null {
  const c = cell.replace(/\s/g, '');
  const l = c.startsWith(':');
  const r = c.endsWith(':');
  if (l && r) return 'center';
  if (r) return 'right';
  if (l) return 'left';
  return null;
}

function parse(md: string): Block[] {
  const blocks: Block[] = [];
  const lines = md.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // action sentinel — single-line marker [[ACTION:0]]
    const actionM = line.match(/^\s*\[\[ACTION:(\d+)\]\]\s*$/);
    if (actionM) {
      blocks.push({ type: 'action', actionIdx: parseInt(actionM[1], 10), lines: [] });
      i++;
      continue;
    }

    // GFM table: header row + separator row + 0..n data rows
    if (
      line.includes('|') &&
      i + 1 < lines.length &&
      isTableSeparator(lines[i + 1]) &&
      splitTableRow(line).length >= 2
    ) {
      const header = splitTableRow(line);
      const align = splitTableRow(lines[i + 1]).map(parseAlign);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      blocks.push({ type: 'table', lines: [], header, rows, align });
      continue;
    }

    // fenced code
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      const lang = fence[1] || '';
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // closing fence
      blocks.push({ type: 'code', lang, lines: buf });
      continue;
    }

    // heading
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      blocks.push({ type: 'h', level: h[1].length, lines: [h[2]] });
      i++;
      continue;
    }

    // unordered list
    if (/^\s*[-*]\s+/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*[-*]\s+/, ''));
        i++;
      }
      blocks.push({ type: 'ul', lines: buf });
      continue;
    }

    // ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
        i++;
      }
      blocks.push({ type: 'ol', lines: buf });
      continue;
    }

    // blank
    if (line.trim() === '') {
      i++;
      continue;
    }

    // paragraph (consume until blank, fence, list, heading, table)
    const buf: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^```/.test(lines[i]) &&
      !/^(#{1,3})\s+/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !(lines[i].includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1]))
    ) {
      buf.push(lines[i]);
      i++;
    }
    blocks.push({ type: 'p', lines: buf });
  }
  return blocks;
}

function CodeBlock({ lang, code }: { lang?: string; code: string }) {
  const [copied, setCopied] = React.useState(false);
  const onCopy = () => {
    try {
      navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };
  return (
    <div className="cp-code-block">
      <div className="cp-code-head">
        <span className="cp-code-lang">{lang || 'code'}</span>
        <button className="cp-code-copy" onClick={onCopy}>
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <pre className="cp-code-pre">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function CopilotMarkdown({
  text,
  actions,
  suppressAutoExec,
}: {
  text: string;
  actions?: CopilotAction[];
  suppressAutoExec?: boolean;
}) {
  const blocks = React.useMemo(() => parse(text), [text]);
  return (
    <div className="cp-md">
      {blocks.map((b, idx) => {
        if (b.type === 'action') {
          const a = actions && b.actionIdx != null ? actions[b.actionIdx] : null;
          if (!a) return null;
          return (
            <ActionCard
              key={`a-${idx}-${b.actionIdx}`}
              action={a}
              suppressAutoExec={suppressAutoExec}
            />
          );
        }
        if (b.type === 'code') {
          return <CodeBlock key={idx} lang={b.lang} code={b.lines.join('\n')} />;
        }
        if (b.type === 'table') {
          const cols = b.header ? b.header.length : 0;
          return (
            <div key={idx} className="cp-table-wrap">
              <table className="cp-table">
                <thead>
                  <tr>
                    {(b.header || []).map((cell, j) => (
                      <th
                        key={j}
                        style={{ textAlign: (b.align && b.align[j]) || 'left' }}
                        dangerouslySetInnerHTML={{ __html: renderInline(escapeHtml(cell)) }}
                      />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(b.rows || []).map((row, ri) => (
                    <tr key={ri}>
                      {Array.from({ length: cols }).map((_, ci) => (
                        <td
                          key={ci}
                          style={{ textAlign: (b.align && b.align[ci]) || 'left' }}
                          dangerouslySetInnerHTML={{
                            __html: renderInline(escapeHtml(row[ci] || '')),
                          }}
                        />
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        if (b.type === 'h') {
          const Tag = `h${Math.min(6, (b.level || 2) + 2)}` as 'h3' | 'h4' | 'h5';
          return (
            <Tag
              key={idx}
              className="cp-h"
              dangerouslySetInnerHTML={{ __html: renderInline(escapeHtml(b.lines[0])) }}
            />
          );
        }
        if (b.type === 'ul') {
          return (
            <ul key={idx} className="cp-list">
              {b.lines.map((l, j) => (
                <li key={j} dangerouslySetInnerHTML={{ __html: renderInline(escapeHtml(l)) }} />
              ))}
            </ul>
          );
        }
        if (b.type === 'ol') {
          return (
            <ol key={idx} className="cp-list">
              {b.lines.map((l, j) => (
                <li key={j} dangerouslySetInnerHTML={{ __html: renderInline(escapeHtml(l)) }} />
              ))}
            </ol>
          );
        }
        // paragraph
        return (
          <p
            key={idx}
            className="cp-p"
            dangerouslySetInnerHTML={{
              __html: renderInline(escapeHtml(b.lines.join('\n'))).replace(/\n/g, '<br/>'),
            }}
          />
        );
      })}
    </div>
  );
}
