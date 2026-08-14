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
//     align with the existing --biof3-* tokens used by
//     ResultCard.module.css.
//   - When payload is malformed, fail-soft to a labelled JSON
//     dump so a bad upstream payload never crashes the card
//     chrome (mirrors TextRenderer's graceful fallback but
//     stays inside TableRenderer's own scope).
//   - Null cells render a muted em-dash placeholder rather
//     than the string "null".
//   - Numeric cells right-align with tabular figures.
//
// This renderer is intentionally a pure presentational
// component; it does not own selection, sort, or pagination
// (P1.3 / later phases can layer those via context).
// ============================================================

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

export function TableRenderer({ node }: { node: ResultNode }) {
  const payload = node.payload;

  if (!isTablePayload(payload)) {
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

  const { columns, rows } = payload;

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
