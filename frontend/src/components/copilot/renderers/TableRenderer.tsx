// ============================================================
// TableRenderer — `table` ResultNode renderer.
//
// Payload contract (strict; type-guard below):
//   {
//     columns: string[];                              // header labels
//     rows: Array<Array<string | number | null>>;     // one row per column slot
//   }
//
// Behaviour:
//   - When payload matches the contract, render a compact
//     <table> with <thead>/<tbody>, scoped CSS module, and
//     align with the existing --petri-* tokens used by
//     ResultCard.module.css.
//   - When payload is malformed, fail-soft to a labelled JSON
//     dump so a bad upstream payload never crashes the card
//     chrome (mirrors TextRenderer's graceful fallback but
//     stays inside TableRenderer's own scope).
//   - Null cells render a muted em-dash placeholder rather
//     than the string "null".
//   - Numeric cells right-align with tabular figures.
//
// P1.5 export layer (2026-08-15, UI-AGENTWB-006):
//   - Valid tables expose CSV / Markdown download buttons in
//     an action bar above the table body. The buttons live
//     next to the rendered table so the actions slot is
//     visually associated with the card (ResultCard supplies
//     the chrome, this renderer supplies the per-table
//     download affordance).
//   - CSV: `text/csv;charset=utf-8` with `\uFEFF` BOM prefix
//     so Excel consumers see UTF-8 by default. Cells
//     containing `,` / `"` / `\n` are wrapped in double quotes
//     with internal `"` escaped as `""`. Null cells become
//     empty strings; numeric cells stay unquoted.
//   - Markdown: `text/markdown;charset=utf-8`. Header row
//     pipes to header, separator row uses `| --- | --- |`,
//     body rows pipe-tabular, null cells become empty cells.
//   - Filename: a safer title slug plus a deterministic ISO
//     timestamp segment (`table-YYYY-MM-DDTHH-MM.csv` when
//     no title is provided). The timestamp is derived from
//     the node's `createdAt` field so the same agent message
//     maps to a stable filename across re-renders.
//   - Download implementation: vanilla `Blob` +
//     `URL.createObjectURL` + temporary `<a download>` click
//     + `URL.revokeObjectURL`. No FileSaver.js / SheetJS /
//     new npm dependency.
//   - Fail-soft fallback path is unchanged: 5 kinds of
//     malformed payloads still render
//     `<pre data-testid="result-renderer-table-fallback">`
//     with no action bar / no download buttons.
//
// This renderer is intentionally a pure presentational
// component; it does not own selection, sort, or pagination
// (P1.3 / later phases can layer those via context).
// ============================================================

import { useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';
import type { ResultNode } from '../types';
import styles from './TableRenderer.module.css';

type Cell = string | number | null;
type TablePayload = { columns: string[]; rows: Cell[][] };

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

function isCellArray(value: unknown): value is Cell[] {
  return (
    Array.isArray(value) &&
    value.every((v) => v === null || typeof v === 'string' || typeof v === 'number')
  );
}

function isTablePayload(value: unknown): value is TablePayload {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as { columns?: unknown; rows?: unknown };
  if (!isStringArray(candidate.columns)) return false;
  if (!Array.isArray(candidate.rows)) return false;
  if (!candidate.rows.every(isCellArray)) return false;
  // Reject when the table is structurally empty (no columns).
  if (candidate.columns.length === 0) return false;
  return true;
}

function tryStringify(payload: unknown): string {
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
}

function renderCell(cell: Cell, columnIndex: number): ReactNode {
  if (cell === null || cell === undefined) {
    return (
      <td key={`c-${columnIndex}`} className={styles.cell}>
        <span className={styles.cellNull}>—</span>
      </td>
    );
  }
  const isNumeric = typeof cell === 'number';
  const className = isNumeric ? `${styles.cell} ${styles.cellNumeric}` : styles.cell;
  return (
    <td
      key={`c-${columnIndex}`}
      className={className}
      data-cell-type={isNumeric ? 'number' : 'string'}
    >
      {String(cell)}
    </td>
  );
}

// ============================================================
// CSV / Markdown export helpers — pure functions, exported as
// top-level helpers so tests can assert byte-for-byte content
// without mounting the renderer. Kept inside the module so the
// export contract stays in lockstep with the type-guard above.
// ============================================================

const CSV_HEADER_BREAK_CHARS = /[",\n\r]/;

function csvEscape(cell: Cell): string {
  if (cell === null || cell === undefined) return '';
  const raw = typeof cell === 'number' ? String(cell) : String(cell);
  if (CSV_HEADER_BREAK_CHARS.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

function markdownEscape(cell: Cell): string {
  if (cell === null || cell === undefined) return '';
  // Markdown table cells must escape the pipe so a literal
  // `|` inside a value does not break the column layout.
  return String(cell).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

export function buildCsv(columns: string[], rows: Cell[][]): string {
  const header = columns.map(csvEscape).join(',');
  const body = rows.map((row) => row.map(csvEscape).join(',')).join('\n');
  // BOM prefix so Excel defaults to UTF-8 instead of CP-1252.
  return `\uFEFF${header}\n${body}`;
}

export function buildMarkdown(columns: string[], rows: Cell[][]): string {
  const header = `| ${columns.map(markdownEscape).join(' | ')} |`;
  const separator = `| ${columns.map(() => '---').join(' | ')} |`;
  const body = rows
    .map((row) => `| ${row.map(markdownEscape).join(' | ')} |`)
    .join('\n');
  return `${header}\n${separator}\n${body}`;
}

function slugifyTitle(title: string): string {
  const cleaned = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned.length > 0 ? cleaned : 'table';
}

function buildTimestampSegment(createdAt: string): string {
  // Match either an ISO timestamp or fall back to a fresh
  // `Date.now()` derived slice. We only use the UTC date +
  // hour + minute so the filename stays predictable and
  // short, and remains stable across machines in different
  // timezones (the agent's `createdAt` is what the user
  // sees in the message metadata anyway).
  const date = new Date(createdAt);
  const base = Number.isNaN(date.getTime()) ? new Date() : date;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${base.getUTCFullYear()}-${pad(base.getUTCMonth() + 1)}-${pad(base.getUTCDate())}T${pad(base.getUTCHours())}-${pad(base.getUTCMinutes())}`;
}

export function buildFilename(
  title: string,
  createdAt: string,
  extension: 'csv' | 'md',
): string {
  return `${slugifyTitle(title)}-${buildTimestampSegment(createdAt)}.${extension}`;
}

function triggerDownload(
  filename: string,
  content: string,
  mimeType: string,
): void {
  // Browser-only path. Tests exercise this through the
  // Blob / URL.createObjectURL / URL.revokeObjectURL shape
  // and the live app triggers it through a real `<a>` click.
  if (typeof document === 'undefined' || typeof URL === 'undefined') return;
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  // Some happy-dom versions ignore programmatic anchor
  // clicks; we still call click() so the real Chromium path
  // stays exercised and the test can mock `click` if needed.
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    URL.revokeObjectURL(url);
  }
}

export function TableRenderer({ node }: { node: ResultNode }) {
  const payload = node.payload;
  const tablePayload = isTablePayload(payload) ? payload : null;

  // rules-of-hooks：hooks 必须无条件先于条件早退调用（BLOCK-105 §7 tail 真修）；
  // tablePayload 空值分支在下载回调内与渲染早退处统一守卫。
  const csvFilename = useMemo(
    () => buildFilename(node.title, node.createdAt, 'csv'),
    [node.title, node.createdAt],
  );
  const markdownFilename = useMemo(
    () => buildFilename(node.title, node.createdAt, 'md'),
    [node.title, node.createdAt],
  );

  const onDownloadCsv = useCallback(() => {
    if (!tablePayload) return;
    const content = buildCsv(tablePayload.columns, tablePayload.rows);
    triggerDownload(csvFilename, content, 'text/csv;charset=utf-8');
  }, [tablePayload, csvFilename]);

  const onDownloadMarkdown = useCallback(() => {
    if (!tablePayload) return;
    const content = buildMarkdown(tablePayload.columns, tablePayload.rows);
    triggerDownload(markdownFilename, content, 'text/markdown;charset=utf-8');
  }, [tablePayload, markdownFilename]);

  if (!tablePayload) {
    return (
      <div
        data-testid="result-renderer-table-fallback"
        data-result-id={node.id}
        role="region"
        aria-label={`${node.title}（表格数据无效，已降级为 JSON）`}
      >
        <p className={styles.fallbackNote}>
          表格数据格式无法解析，已降级为原始 JSON（fail-soft）：
        </p>
        <pre className={styles.fallback}>{tryStringify(payload)}</pre>
      </div>
    );
  }

  const { columns, rows } = tablePayload;

  return (
    <div
      className={styles.wrapper}
      data-testid="result-renderer-table"
      data-result-id={node.id}
      data-row-count={rows.length}
      data-column-count={columns.length}
      role="region"
      aria-label={node.title}
    >
      <div className={styles.actions} role="group" aria-label="表格导出">
        <button
          type="button"
          className={styles.downloadButton}
          aria-label="Download CSV"
          data-testid="result-renderer-table-download-csv"
          onClick={onDownloadCsv}
        >
          CSV
        </button>
        <button
          type="button"
          className={styles.downloadButton}
          aria-label="Download Markdown"
          data-testid="result-renderer-table-download-markdown"
          onClick={onDownloadMarkdown}
        >
          Markdown
        </button>
      </div>
      <table className={styles.table}>
        <caption className={styles.caption}>{node.title}</caption>
        <thead className={styles.thead}>
          <tr>
            {columns.map((label, idx) => (
              <th
                key={`h-${idx}`}
                scope="col"
                className={styles.headerCell}
                title={label}
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIdx) => (
            <tr key={`r-${rowIdx}`} className={styles.bodyRow}>
              {columns.map((_, colIdx) => renderCell(row[colIdx] ?? null, colIdx))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
