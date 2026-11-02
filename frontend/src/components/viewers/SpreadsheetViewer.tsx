import React, { useEffect, useRef, useState } from 'react';
import styles from './SpreadsheetViewer.module.css';

/**
 * BLOCK-142（成果面切片 E·renderer 补课）— xlsx/xlsm 产物 viewer（只读预览）。
 *
 * 契约（plan §1.2）：fetch 产物 URL → ArrayBuffer → exceljs（动态 import，
 * bundle 语义同 pdfjs 先例：仅点开 xlsx 时加载）解析 → 首工作表网格渲染；
 * 行 ≤200 / 列 ≤50 有界预览，超限**如实标注截断**（展示真实总行/列数，不伪造）；
 * 多工作表列 sheet 名可切换；获取/解析失败如实显示错误。
 * xlsx 写回/编辑不在本包（红线）。样式只走 --petri-* token。
 */

const MAX_ROWS = 200;
const MAX_COLS = 50;

interface SheetGrid {
  name: string;
  rows: string[][];
  totalRows: number;
  totalCols: number;
}

type ExcelWorksheetLike = {
  name: string;
  rowCount: number;
  columnCount: number;
  getRow: (rowNumber: number) => {
    getCell: (colNumber: number) => { text: string };
  };
};

function extractBoundedSheet(sheet: ExcelWorksheetLike): SheetGrid {
  const rows: string[][] = [];
  const boundedRows = Math.min(sheet.rowCount, MAX_ROWS);
  const boundedCols = Math.min(sheet.columnCount, MAX_COLS);
  for (let r = 1; r <= boundedRows; r += 1) {
    const row = sheet.getRow(r);
    const cells: string[] = [];
    for (let c = 1; c <= boundedCols; c += 1) {
      cells.push(String(row.getCell(c).text ?? ''));
    }
    rows.push(cells);
  }
  return { name: sheet.name, rows, totalRows: sheet.rowCount, totalCols: sheet.columnCount };
}

// BLOCK-334 P2 Slice D — xlsx/xlsm 两宿主唯一 viewer（自 workspace-panels/SpreadsheetResultViewer 平移并泛化）。
// 反向统一的理由：office-file-preview 的 xlsx 路径只解析首工作表且无截断元数据，exceljs 引擎
// 有多工作表切换 + 行/列有界并如实标注——把壳改过去是能力减法，故文件宿主改用本 viewer（获得多表），
// exceljs 依赖保留（原「可删依赖」假设被实证推翻）。行级批注经 onAnnotateRow 可选接入（无回调不渲染死按钮）。
export function SpreadsheetViewer({
  url,
  name,
  authToken,
  onAnnotateRow,
  onLoaded,
}: {
  url: string;
  name: string;
  /** 文件宿主的受保护工作区 URL 需 Bearer；结果壳产物 URL 无条件放行可不传。 */
  authToken?: string | null;
  /** 表格行批注（文件宿主）：rowIndex 从 0 起（数据行，不含表头），quote=该行拼接文本。 */
  onAnnotateRow?: (rowIndex: number, quote: string) => void;
  /** 解析成功回调（宿主据此启用批注条等就绪态）。 */
  onLoaded?: (info: { sheets: number; rows: number }) => void;
}): React.ReactElement {
  // state 携带其取数来源的 url：切换产物时由渲染期派生「陈旧 → 加载中」，
  // effect 内不做同步 setState（react-hooks set-state-in-effect 禁级联渲染），
  // 语义不变：url 变化即回加载态并重新取数。
  const [loaded, setLoaded] = useState<{
    url: string;
    sheets: SheetGrid[] | null;
    activeSheet: number;
    error: string | null;
  }>(() => ({ url, sheets: null, activeSheet: 0, error: null }));
  const current = loaded.url === url ? loaded : null;
  // 回调经 ref 转发（宿主每轮渲染换函数不触发重取数）
  const onLoadedRef = useRef(onLoaded);
  useEffect(() => { onLoadedRef.current = onLoaded; });

  useEffect(() => {
    let cancelled = false;
    if (!url) return undefined;
    void (async () => {
      try {
        const resp = await fetch(url, authToken ? { headers: { Authorization: `Bearer ${authToken}` } } : undefined);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const buffer = await resp.arrayBuffer();
        const ExcelJS = await import('exceljs');
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(buffer);
        if (cancelled) return;
        const extracted = workbook.worksheets.map((sheet) => extractBoundedSheet(sheet));
        if (extracted.length === 0) throw new Error('工作簿没有工作表');
        setLoaded({ url, sheets: extracted, activeSheet: 0, error: null });
        onLoadedRef.current?.({ sheets: extracted.length, rows: extracted[0].rows.length });
      } catch (e: unknown) {
        if (!cancelled) setLoaded({ url, sheets: null, activeSheet: 0, error: (e as Error).message || '读取 Excel 文件失败' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (current?.error) {
    return (
      <div className={styles.sheetError} data-testid="spreadsheet-error" role="alert">
        <strong>Excel 读取失败</strong>
        <span>{current.error}</span>
      </div>
    );
  }
  if (current === null || current.sheets === null) {
    return <div className={styles.sheetLoading}>解析 Excel…</div>;
  }
  const sheets = current.sheets;
  const sheet = sheets[Math.min(current.activeSheet, sheets.length - 1)];
  const truncated = sheet.totalRows > MAX_ROWS || sheet.totalCols > MAX_COLS;
  const [header, ...dataRows] = sheet.rows.length > 0 ? sheet.rows : [[]];
  return (
    <div className={styles.sheetViewer} data-testid="spreadsheet-viewer" aria-label={`Excel 预览：${name}`}>
      {sheets.length > 1 && (
        <div className={styles.sheetTabs} role="tablist" aria-label="工作表">
          {sheets.map((s, idx) => (
            <button
              key={`${s.name}-${idx}`}
              type="button"
              role="tab"
              aria-selected={idx === current.activeSheet}
              className={`${styles.sheetTab} ${idx === current.activeSheet ? styles.sheetTabActive : ''}`}
              onClick={() => setLoaded((prev) => ({ ...prev, activeSheet: idx }))}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
      {truncated && (
        <div className={styles.sheetTruncateNote} data-testid="spreadsheet-truncated">
          共 {sheet.totalRows.toLocaleString()} 行 × {sheet.totalCols.toLocaleString()} 列，预览截断至前 {MAX_ROWS} 行 × {MAX_COLS} 列
        </div>
      )}
      <div className={styles.sheetGridScroll}>
        <table className={styles.sheetGrid}>
          <thead>
            <tr>
              {header.map((cell, idx) => (
                <th key={`h-${idx}`}>{cell || `列 ${idx + 1}`}</th>
              ))}
              {onAnnotateRow && <th key="h-annotate" aria-label="批注" />}
            </tr>
          </thead>
          <tbody>
            {dataRows.map((row, rowIndex) => (
              <tr key={`r-${rowIndex}`}>
                {header.map((_, cellIndex) => (
                  <td key={`c-${cellIndex}`}>{row[cellIndex] || '—'}</td>
                ))}
                {onAnnotateRow && (
                  <td key="c-annotate">
                    <button
                      type="button"
                      className="petri-btn petri-btn--ghost petri-btn--sm"
                      title={`为第 ${rowIndex + 1} 行添加批注`}
                      data-testid="spreadsheet-annotate-row"
                      onClick={() => onAnnotateRow(rowIndex, row.filter(Boolean).join(' | '))}
                    >
                      批注
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
