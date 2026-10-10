// ============================================================
// Lightweight markdown renderer for Copilot replies.
// No external deps to keep bundle small.
//
// Plan:  "会话文件直达预览" — 安全渲染 + 内部引用事件
//   - inline code stays inert unless its complete value resolves to a verified
//     artifact/workspace file, in which case it becomes a direct-open link;
//   - fenced code is excluded from extraction AND rendered as <pre><code>;
//   - http/https links keep target=_blank; mailto keeps target=_blank;
//   - same-origin / relative links are kept (react-router picks them up);
//   - javascript:, data:, file:, vbscript: and unknown protocols are dropped;
//   - petri://artifact|workspace URIs dispatch the typed onFileReferenceClick
//     callback (or onLinkClick for legacy callers).
// ============================================================

import React from 'react';
import { ActionCard } from './ActionCard';
import type { CopilotAction } from './actions';
import {
  classifyLink,
  extractFileReferenceCandidates,
  resolveFileReferences,
  type ExtractContext,
  type ResolvedReference,
  type LinkKind,
} from './chat-file-references';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Typed click handler for internal artifact / workspace references that the
 * renderer couldn't fully classify on its own. The renderer fires this with
 * the raw URI or the resolved `ResolvedReference` so the host can decide
 * navigation (artifact focus, workspace file open, cross-project jump).
 */
export interface FileReferenceClickDetail {
  /** The raw token / URI the user clicked. */
  raw: string;
  /** Optional pre-resolved payload from the file-references cache. */
  resolved?: ResolvedReference | null;
  /** Pre-classified link kind — lets the host short-circuit. */
  kind: LinkKind;
}

/**
 * Legacy catch-all click handler. Fired for every link the user activates.
 * `internalReference` is set when the click represents a file reference
 * (so the host can implement a unified event-bus dispatch without ever
 * touching the raw href).
 */
export type CopilotMarkdownClickHandler = (detail: {
  href: string;
  kind: LinkKind;
  internalReference?: FileReferenceClickDetail;
}) => void;

export interface CopilotMarkdownProps {
  text?: unknown;
  actions?: CopilotAction[];
  suppressAutoExec?: boolean;
  /** Optional click handler for non-reference links (raw href, classified). */
  onLinkClick?: CopilotMarkdownClickHandler;
  /**
   * Typed click handler for internal file references (artifact / workspace).
   * The host should translate this into the project's open-artifact /
   * open-workspace-file events.
   */
  onFileReferenceClick?: (detail: FileReferenceClickDetail) => void;
  /** Resolver scope supplied by the host after a message has settled. */
  resolveContext?: ExtractContext | null;
  /**
   * Bumping nonce forces a fresh resolve pass for the current text — used by
   * the "refresh file links" toolbar button so users can rerun the resolver
   * against the latest workspace state without regenerating the message.
   */
  resolveNonce?: number;
  /** Optional host renderer for syntax-highlighted fenced code. */
  highlightCode?: (code: string, language?: string) => React.ReactNode;
}

// ---------------------------------------------------------------------------
// Block parsing
// ---------------------------------------------------------------------------

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
  return s.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
}

function isTableSeparator(line: string): boolean {
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

function parse(md: unknown): Block[] {
  const source = typeof md === 'string' ? md : md == null ? '' : String(md);
  const blocks: Block[] = [];
  const lines = source.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    const actionM = line.match(/^\s*\[\[ACTION:(\d+)\]\]\s*$/);
    if (actionM) {
      blocks.push({ type: 'action', actionIdx: parseInt(actionM[1], 10), lines: [] });
      i++;
      continue;
    }

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
        rows.push(splitTableLines(lines[i]));
        i++;
      }
      blocks.push({ type: 'table', lines: [], header, rows, align });
      continue;
    }

    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      const lang = fence[1] || '';
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++;
      blocks.push({ type: 'code', lang, lines: buf });
      continue;
    }

    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      blocks.push({ type: 'h', level: h[1].length, lines: [h[2]] });
      i++;
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*[-*]\s+/, ''));
        i++;
      }
      blocks.push({ type: 'ul', lines: buf });
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
        i++;
      }
      blocks.push({ type: 'ol', lines: buf });
      continue;
    }

    if (line.trim() === '') {
      i++;
      continue;
    }

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

function splitTableLines(line: string): string[] {
  return splitTableRow(line);
}

// ---------------------------------------------------------------------------
// Inline rendering (React nodes — no dangerouslySetInnerHTML)
// ---------------------------------------------------------------------------

type InlineToken =
  | { kind: 'text'; value: string }
  | { kind: 'code'; value: string }
  | { kind: 'bold'; value: string }
  | { kind: 'italic'; value: string }
  | { kind: 'link'; label: string; href: string }
  | { kind: 'br' };

function tokenizeInline(input: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let i = 0;
  let buf = '';
  const flushText = () => {
    if (buf) {
      tokens.push({ kind: 'text', value: buf });
      buf = '';
    }
  };
  while (i < input.length) {
    const ch = input[i];

    // Inline code — emit verbatim, no link parsing inside.
    if (ch === '`') {
      const end = input.indexOf('`', i + 1);
      if (end > i) {
        flushText();
        tokens.push({ kind: 'code', value: input.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }

    // Bold (** ... **)
    if (ch === '*' && input[i + 1] === '*') {
      const end = input.indexOf('**', i + 2);
      if (end > i + 2) {
        const inner = input.slice(i + 2, end);
        if (inner && !inner.includes('\n')) {
          flushText();
          tokens.push({ kind: 'bold', value: inner });
          i = end + 2;
          continue;
        }
      }
    }

    // Italic (* ... *) — must not be adjacent to another `*`
    if (ch === '*') {
      const end = input.indexOf('*', i + 1);
      if (end > i + 1 && input[end + 1] !== '*' && input[end - 1] !== '*') {
        const inner = input.slice(i + 1, end);
        if (inner && !inner.includes('\n')) {
          flushText();
          tokens.push({ kind: 'italic', value: inner });
          i = end + 1;
          continue;
        }
      }
    }

    // Markdown link [label](href) — label can include other tokens but we
    // keep it simple: only flat label, no nested markdown inside link.
    if (ch === '[') {
      const labelEnd = findMatchingBracket(input, i);
      if (labelEnd > i) {
        const after = input.slice(labelEnd + 1);
        const linkMatch = after.match(/^\(([^()\s]+)\)/);
        if (linkMatch) {
          flushText();
          tokens.push({
            kind: 'link',
            label: input.slice(i + 1, labelEnd),
            href: linkMatch[1],
          });
          i = labelEnd + 1 + linkMatch[0].length;
          continue;
        }
      }
    }

    // Hard line break
    if (ch === '\n') {
      flushText();
      tokens.push({ kind: 'br' });
      i++;
      continue;
    }

    buf += ch;
    i++;
  }
  flushText();
  return tokens;
}

function findMatchingBracket(input: string, start: number): number {
  // start points at '['; find the matching ']' at the same nesting level.
  let depth = 0;
  for (let i = start; i < input.length; i++) {
    const ch = input[i];
    if (ch === '\\' && i + 1 < input.length) {
      i++;
      continue;
    }
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

interface RenderInlineOptions {
  onLinkClick?: CopilotMarkdownClickHandler;
  onFileReferenceClick?: (detail: FileReferenceClickDetail) => void;
  resolvedByToken?: Map<string, ResolvedReference | null>;
}

function renderInlineTokens(
  tokens: InlineToken[],
  keyPrefix: string,
  options: RenderInlineOptions
): React.ReactNode[] {
  return tokens.map((token, idx) => {
    const key = `${keyPrefix}-${idx}`;
    if (token.kind === 'text') {
      return (
        <React.Fragment key={key}>
          {renderAutolinks(token.value, keyPrefix, options)}
        </React.Fragment>
      );
    }
    if (token.kind === 'code') {
      const resolvedReference = options.resolvedByToken?.get(token.value.trim()) || null;
      if (resolvedReference) {
        return (
          <FileReferenceLink
            key={key}
            raw={token.value.trim()}
            label={token.value}
            kind={resolvedReference.kind}
            resolved={{
              raw: token.value.trim(),
              kind: resolvedReference.kind,
              resolved: resolvedReference,
            }}
            onFileReferenceClick={options.onFileReferenceClick}
            onLinkClick={options.onLinkClick}
            inlineCode
          />
        );
      }
      return (
        <code key={key} className="cp-inline-code">
          {token.value}
        </code>
      );
    }
    if (token.kind === 'bold') {
      return (
        <strong key={key}>
          {renderInlineTokens(tokenizeInline(token.value), `${key}-b`, options)}
        </strong>
      );
    }
    if (token.kind === 'italic') {
      return (
        <em key={key}>{renderInlineTokens(tokenizeInline(token.value), `${key}-i`, options)}</em>
      );
    }
    if (token.kind === 'br') {
      return <br key={key} />;
    }
    // link
    const resolvedReference = options.resolvedByToken?.get(token.href) || null;
    if (resolvedReference) {
      return (
        <FileReferenceLink
          key={key}
          raw={token.href}
          label={token.label}
          kind={resolvedReference.kind}
          resolved={{ raw: token.href, kind: resolvedReference.kind, resolved: resolvedReference }}
          onFileReferenceClick={options.onFileReferenceClick}
          onLinkClick={options.onLinkClick}
        />
      );
    }
    const kind = classifyLink(token.href);
    if (kind === 'dangerous') {
      return <React.Fragment key={key}>{token.label}</React.Fragment>;
    }
    const internalRef = buildInternalReference(token.href, kind, options);
    if (kind === 'external' || kind === 'internal') {
      return (
        <a
          key={key}
          href={token.href}
          target={kind === 'external' ? '_blank' : undefined}
          rel={kind === 'external' ? 'noopener noreferrer' : undefined}
          onClick={(event) => {
            // For internal same-origin links let the browser / react-router
            // take over — only intercept when the host supplies a handler.
            if (options.onLinkClick) {
              event.preventDefault();
              options.onLinkClick({ href: token.href, kind });
            }
          }}
        >
          {token.label}
        </a>
      );
    }
    if (internalRef) {
      return (
        <FileReferenceLink
          key={key}
          raw={token.href}
          label={token.label}
          kind={kind}
          resolved={internalRef}
          onFileReferenceClick={options.onFileReferenceClick}
          onLinkClick={options.onLinkClick}
        />
      );
    }
    return <React.Fragment key={key}>{token.label}</React.Fragment>;
  });
}

const STATUS_MARKS: Record<string, { symbol: string; className: string }> = {
  '✅': { symbol: '✓', className: 'cp-status-mark-success' },
  '❌': { symbol: '×', className: 'cp-status-mark-error' },
  '⚠️': { symbol: '!', className: 'cp-status-mark-warning' },
  '⚠': { symbol: '!', className: 'cp-status-mark-warning' },
  '🔄': { symbol: '↻', className: 'cp-status-mark-progress' },
};

function renderStatusText(text: string, keyPrefix: string): React.ReactNode[] {
  const pattern = /(✅|❌|⚠️|⚠|🔄)/g;
  const parts = text.split(pattern);
  return parts.filter(Boolean).map((part, index) => {
    const mark = STATUS_MARKS[part];
    return mark ? (
      <span key={`${keyPrefix}-status-${index}`} className={`cp-status-mark ${mark.className}`} aria-label={part}>
        {mark.symbol}
      </span>
    ) : (
      <React.Fragment key={`${keyPrefix}-text-${index}`}>{part}</React.Fragment>
    );
  });
}

function buildInternalReference(
  href: string,
  kind: LinkKind,
  options: RenderInlineOptions
): FileReferenceClickDetail | null {
  if (kind !== 'artifact' && kind !== 'workspace') return null;
  const resolved = options.resolvedByToken?.get(href) || null;
  return resolved ? { raw: href, kind, resolved } : null;
}

/**
 * Auto-link raw petri:// URIs that aren't already wrapped in a markdown link.
 * Without this, references like  "see petri://artifact/JOB/deg.csv" wouldn't
 * be clickable. Everything else (http/https) is left for the user to wrap
 * explicitly to avoid accidentally promoting raw URLs in prose.
 */
function renderAutolinks(
  text: string,
  keyPrefix: string,
  options: RenderInlineOptions
): React.ReactNode[] {
  const candidates = Array.from(options.resolvedByToken?.entries() || [])
    .filter((entry): entry is [string, ResolvedReference] => Boolean(entry[0] && entry[1]))
    .sort((a, b) => b[0].length - a[0].length);
  if (candidates.length === 0)
    return renderStatusText(text, keyPrefix);

  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  let counter = 0;
  while (cursor < text.length) {
    let next: { index: number; raw: string; resolved: ResolvedReference } | null = null;
    for (const [raw, resolved] of candidates) {
      const index = text.indexOf(raw, cursor);
      if (index < 0 || (next && index >= next.index)) continue;
      next = { index, raw, resolved };
    }
    if (!next) break;
    if (next.index > cursor) {
      nodes.push(
        ...renderStatusText(text.slice(cursor, next.index), `${keyPrefix}-t-${counter++}`),
      );
    }
    nodes.push(
      <FileReferenceLink
        key={`${keyPrefix}-auto-${counter++}`}
        raw={next.raw}
        label={next.raw.startsWith('petri://') ? displayLabelForUri(next.raw) : next.raw}
        kind={next.resolved.kind}
        resolved={{ raw: next.raw, kind: next.resolved.kind, resolved: next.resolved }}
        onFileReferenceClick={options.onFileReferenceClick}
        onLinkClick={options.onLinkClick}
      />
    );
    cursor = next.index + next.raw.length;
  }
  if (cursor < text.length) {
    nodes.push(...renderStatusText(text.slice(cursor), `${keyPrefix}-tail`));
  }
  return nodes;
}

function displayLabelForUri(uri: string): string {
  // petri://artifact/<jobId>/<filename> -> <filename>
  // petri://workspace/<projectId>/<relpath...> -> relpath basename
  const artifactMatch = uri.match(/^petri:\/\/artifact\/[^/]+\/(.+)$/i);
  if (artifactMatch) {
    const tail = decodeURIComponent(artifactMatch[1]);
    return tail.split('/').pop() || tail;
  }
  const workspaceMatch = uri.match(/^petri:\/\/workspace\/[^/]+\/(.+)$/i);
  if (workspaceMatch) {
    const tail = decodeURIComponent(workspaceMatch[1]);
    return tail.split('/').pop() || tail;
  }
  return uri;
}

// ---------------------------------------------------------------------------
// File-reference link component
// ---------------------------------------------------------------------------

interface FileReferenceLinkProps {
  raw: string;
  label: string;
  kind: LinkKind;
  resolved: FileReferenceClickDetail;
  onFileReferenceClick?: (detail: FileReferenceClickDetail) => void;
  onLinkClick?: CopilotMarkdownClickHandler;
  inlineCode?: boolean;
}

function FileReferenceLink({
  raw,
  label,
  kind,
  resolved,
  onFileReferenceClick,
  onLinkClick,
  inlineCode = false,
}: FileReferenceLinkProps) {
  const handleClick = (event: React.MouseEvent) => {
    event.preventDefault();
    if (onFileReferenceClick) {
      onFileReferenceClick(resolved);
    }
    if (onLinkClick) {
      onLinkClick({ href: raw, kind, internalReference: resolved });
    }
  };
  return (
    <a
      href={raw}
      className={`cp-file-ref${inlineCode ? ' cp-file-ref-code' : ''}`}
      onClick={handleClick}
      title={raw}
      data-reference-kind={kind}
    >
      {label}
    </a>
  );
}

// ---------------------------------------------------------------------------
// Code block
// ---------------------------------------------------------------------------

function CodeBlock({
  lang,
  code,
  highlightCode,
}: {
  lang?: string;
  code: string;
  highlightCode?: (code: string, language?: string) => React.ReactNode;
}) {
  const [copied, setCopied] = React.useState(false);
  const onCopy = () => {
    try {
      navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };
  const accessibleLabel = copied ? '已复制' : '复制代码';
  const normalizedLang = (lang || '').trim().toLowerCase();
  const isPlainText = !normalizedLang || ['text', 'txt', 'plaintext', 'tree'].includes(normalizedLang);
  const copyButton = (
    <button
      type="button"
      className={`cp-copy-button${copied ? ' is-copied' : ''}`}
      onClick={onCopy}
      title={accessibleLabel}
      aria-label={accessibleLabel}
    >
      <span className="cp-copy-button-icon" aria-hidden="true">
        {copied ? '✓' : ''}
      </span>
    </button>
  );
  return (
    <div className={`cp-code-block${isPlainText ? ' cp-code-block-plain' : ''}`}>
      {isPlainText ? (
        <div className="cp-code-plain-action">{copyButton}</div>
      ) : (
        <div className="cp-code-head">
          <span className="cp-code-lang">{lang}</span>
          {copyButton}
        </div>
      )}
      <pre className="cp-code-pre">
        {highlightCode ? highlightCode(code, lang) : <code>{code}</code>}
      </pre>
    </div>
  );
}

function CopyButton({ text, label = '复制' }: { text: string; label?: string }) {
  const [copied, setCopied] = React.useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard access can be unavailable in non-secure previews */
    }
  };
  const accessibleLabel = copied ? '已复制' : label;
  return (
    <button
      type="button"
      className={`cp-copy-button${copied ? ' is-copied' : ''}`}
      onClick={() => void onCopy()}
      title={accessibleLabel}
      aria-label={accessibleLabel}
    >
      <span className="cp-copy-button-icon" aria-hidden="true">
        {copied ? '✓' : ''}
      </span>
    </button>
  );
}

function tableCopyText(header: string[], rows: string[][]): string {
  return [header, ...rows].map((row) => row.join('\t')).join('\n');
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

export function CopilotMarkdown({
  text,
  actions,
  suppressAutoExec,
  onLinkClick,
  onFileReferenceClick,
  resolveContext,
  resolveNonce = 0,
  highlightCode,
}: CopilotMarkdownProps) {
  const safeText = typeof text === 'string' ? text : text == null ? '' : String(text);
  const blocks = React.useMemo(() => parse(safeText), [safeText]);

  // Resolve file references in the background. Streaming partials should
  // pass `resolveContext={undefined}` to avoid hammering the resolver on
  // every delta; the parent (SimpleChat) flips this on only after `onDone`.
  const [resolvedByToken, setResolvedByToken] = React.useState<
    Map<string, ResolvedReference | null>
  >(() => new Map());
  React.useEffect(() => {
    let cancelled = false;
    if (!resolveContext) {
      setResolvedByToken(new Map());
      return () => {
        cancelled = true;
      };
    }
    const candidates = extractFileReferenceCandidates(safeText, {
      projectId: resolveContext.projectId,
      activeJobId: resolveContext.activeJobId || null,
      activeArtifactName: resolveContext.activeArtifactName,
    });
    if (candidates.length === 0) {
      setResolvedByToken(new Map());
      return () => {
        cancelled = true;
      };
    }
    (async () => {
      const results = await resolveFileReferences(resolveContext, candidates);
      if (cancelled) return;
      // Build a lookup keyed by candidate string and by any internal URI
      // the server returned (so auto-linked URIs map to their resolved
      // counterpart).
      const next = new Map<string, ResolvedReference | null>();
      for (const [candidate, entry] of results.entries()) {
        next.set(candidate, entry?.resolved ?? null);
        if (entry?.resolved) {
          const synthetic = syntheticInternalUri(candidate, entry.resolved);
          if (synthetic) next.set(synthetic, entry.resolved);
        }
      }
      setResolvedByToken(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [resolveContext, safeText, resolveNonce]);

  const renderOptions: RenderInlineOptions = React.useMemo(
    () => ({ onLinkClick, onFileReferenceClick, resolvedByToken }),
    [onLinkClick, onFileReferenceClick, resolvedByToken]
  );

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
          return (
            <CodeBlock
              key={idx}
              lang={b.lang}
              code={b.lines.join('\n')}
              highlightCode={highlightCode}
            />
          );
        }
        if (b.type === 'table') {
          const cols = b.header ? b.header.length : 0;
          const copyText = tableCopyText(b.header || [], b.rows || []);
          return (
            <figure key={idx} className="cp-table-figure">
              <div className="cp-table-tools" aria-label="表格操作">
                <CopyButton text={copyText} />
              </div>
              <div className="cp-table-scroll">
                <table className="cp-table">
                  <thead>
                    <tr>
                      {(b.header || []).map((cell, j) => (
                        <th
                          key={j}
                          scope="col"
                          style={{ textAlign: (b.align && b.align[j]) || 'left' }}
                        >
                          {renderInlineTokens(tokenizeInline(cell), `${idx}-th-${j}`, renderOptions)}
                        </th>
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
                          >
                            {renderInlineTokens(
                              tokenizeInline(row[ci] || ''),
                              `${idx}-tr-${ri}-${ci}`,
                              renderOptions
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </figure>
          );
        }
        if (b.type === 'h') {
          const Tag = `h${Math.min(6, (b.level || 2) + 2)}` as 'h3' | 'h4' | 'h5';
          return (
            <Tag key={idx} className={`cp-h cp-h-${b.level || 2}`}>
              {renderInlineTokens(tokenizeInline(b.lines[0] || ''), `${idx}-h`, renderOptions)}
            </Tag>
          );
        }
        if (b.type === 'ul') {
          return (
            <ul key={idx} className="cp-list">
              {b.lines.map((l, j) => (
                <li key={j}>
                  {renderInlineTokens(tokenizeInline(l), `${idx}-ul-${j}`, renderOptions)}
                </li>
              ))}
            </ul>
          );
        }
        if (b.type === 'ol') {
          return (
            <ol key={idx} className="cp-list">
              {b.lines.map((l, j) => (
                <li key={j}>
                  {renderInlineTokens(tokenizeInline(l), `${idx}-ol-${j}`, renderOptions)}
                </li>
              ))}
            </ol>
          );
        }
        // paragraph
        return (
          <p key={idx} className="cp-p">
            {renderInlineTokens(tokenizeInline(b.lines.join('\n')), `${idx}-p`, renderOptions)}
          </p>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers exposed for tests
// ---------------------------------------------------------------------------

function syntheticInternalUri(
  candidate: string,
  resolved: ResolvedReference
): string | null {
  if (resolved.kind === 'artifact') {
    const artifactName = resolved.artifactName || resolved.name;
    if (!resolved.jobId || !artifactName) return null;
    return `petri://artifact/${encodeURIComponent(resolved.jobId)}/${artifactName
      .split('/')
      .map((part) => encodeURIComponent(part))
      .join('/')}`;
  }
  if (resolved.kind === 'workspace') {
    if (!resolved.projectId || !resolved.relativePath) return null;
    const tail = resolved.relativePath
      .split('/')
      .map((part) => encodeURIComponent(part))
      .join('/');
    return `petri://workspace/${encodeURIComponent(resolved.projectId)}/${tail}`;
  }
  return null;
}

