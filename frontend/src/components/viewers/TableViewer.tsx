import React from 'react';
import { csvPreviewPageCount, csvPreviewPageRows } from '@/lib/csv-preview-pagination';

// BLOCK-334 P2 Slice A — 表格唯一 viewer：合并 ResultArtifactShell 内联 csv 分页表
// （paged：预览文本预算内 + 页码/上下页）与 WorkspaceFilePreview 40 行截断表
// （clipped：提示去外部工具）。外观类名由宿主注入，零视觉变化。

export function TableViewer({
  rows,
  mode,
  page = 0,
  onPageChange,
  clipRows = 40,
  classNames,
  testId,
}: {
  /** 首行为表头的二维表。 */
  rows: string[][];
  mode: 'paged' | 'clipped';
  /** paged 模式受控页码（0 基）。 */
  page?: number;
  onPageChange?: (next: number | ((current: number) => number)) => void;
  /** clipped 模式最多展示的数据行数。 */
  clipRows?: number;
  classNames?: { root?: string; pager?: string; hint?: string };
  testId?: string;
}): React.ReactElement {
  const [header, ...dataRows] = rows;
  const pageCount = mode === 'paged' ? csvPreviewPageCount(dataRows.length) : 0;
  const pageRows = mode === 'paged' ? csvPreviewPageRows(dataRows, page) : dataRows.slice(0, clipRows);
  const showClippedHint = mode === 'clipped' && dataRows.length > clipRows;
  return (
    <div className={classNames?.root} data-testid={testId}>
      <table>
        <thead>
          <tr>
            {header.map((cell, idx) => (
              <th key={`${cell || 'col'}-${idx}`} scope="col">{cell || `列 ${idx + 1}`}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {pageRows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {header.map((_, cellIndex) => (
                <td key={cellIndex}>{row[cellIndex] || '—'}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {mode === 'paged' && (
        <div className={classNames?.pager}>
          <span>共 {dataRows.length.toLocaleString()} 行（预览文本预算内） · 第 {Math.min(page, pageCount - 1) + 1}/{pageCount} 页</span>
          <button className="petri-btn petri-btn--ghost petri-btn--sm" type="button" disabled={page <= 0} onClick={() => onPageChange?.((p) => Math.max(0, p - 1))}>上一页</button>
          <button className="petri-btn petri-btn--ghost petri-btn--sm" type="button" disabled={page >= pageCount - 1} onClick={() => onPageChange?.((p) => Math.min(pageCount - 1, p + 1))}>下一页</button>
        </div>
      )}
      {mode === 'clipped' && showClippedHint && (
        <p className={classNames?.hint}>
          已展示前 {clipRows} 行 / 共 {dataRows.length} 行，完整数据请在外部工具打开。
        </p>
      )}
    </div>
  );
}
