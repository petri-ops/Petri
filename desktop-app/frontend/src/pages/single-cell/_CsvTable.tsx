// ============================================================
// CsvTable — embedded CSV viewer with per-column search
// + row selection for subset creation
// ============================================================

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { getApiPrefix } from './_config';
import { getAuthHeaders } from './_auth';

interface Props {
  fileUrl: string;
  pageSize?: number;
  /** Column name used as row key for selection (e.g. 'cell_id', 'gene_symbol') */
  rowKey?: string;
  /** Whether to show selection checkboxes */
  selectable?: boolean;
  /** Callback when selection changes — receives the array of selected row keys */
  onSelectionChange?: (selectedKeys: string[]) => void;
  /** External selected keys (controlled mode) */
  selectedKeys?: string[];
  /** Action button area at the bottom */
  actions?: React.ReactNode;
}

export function CsvTable({
  fileUrl,
  pageSize = 50,
  rowKey,
  selectable = false,
  onSelectionChange,
  selectedKeys: externalSelected,
  actions,
}: Props) {
  const [raw, setRaw] = useState('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [colSearch, setColSearch] = useState<Record<string, string>>({});
  const [page, setPage] = useState(0);
  const [currentPageSize, setCurrentPageSize] = useState(pageSize);
  const [internalSelected, setInternalSelected] = useState<Set<string>>(new Set());

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const selected = externalSelected ? new Set(externalSelected) : internalSelected;
  const isControlled = externalSelected !== undefined;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    setColSearch({});
    setPage(0);
    if (!isControlled) setInternalSelected(new Set());

    const proxyUrl = `${getApiPrefix()}/proxy-file?url=${encodeURIComponent(fileUrl)}`;
    fetch(proxyUrl, { headers: getAuthHeaders() })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then((text) => {
        if (!cancelled) {
          setRaw(text);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setErr(e.message);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileUrl]);

  // Parse CSV
  const { headers, rows } = useMemo(() => {
    if (!raw) return { headers: [] as string[], rows: [] as string[][] };
    const lines = raw.split(/\r?\n/).filter((l) => l.length > 0);
    if (lines.length === 0) return { headers: [], rows: [] };
    const parseLine = (line: string): string[] => {
      const out: string[] = [];
      let cur = '';
      let inQuote = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') {
          inQuote = !inQuote;
          continue;
        }
        if (c === ',' && !inQuote) {
          out.push(cur);
          cur = '';
          continue;
        }
        cur += c;
      }
      out.push(cur);
      return out;
    };
    const headers = parseLine(lines[0]);
    const rows = lines.slice(1).map(parseLine);
    return { headers, rows };
  }, [raw]);

  // Test a single value against a single comparison expression
  const testOne = (cellRaw: string, expr: string): boolean => {
    const trimmed = expr.trim();
    if (!trimmed) return true;
    const cmp = trimmed.match(/^(>=|<=|>|<|=|!=)\s*(-?\d+(?:\.\d+)?)\s*$/);
    const between = trimmed.match(/^(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)\s*$/);
    const num = parseFloat(cellRaw);
    if (cmp && !isNaN(num)) {
      const op = cmp[1];
      const v = parseFloat(cmp[2]);
      if (op === '>') return num > v;
      if (op === '>=') return num >= v;
      if (op === '<') return num < v;
      if (op === '<=') return num <= v;
      if (op === '=') return num === v;
      if (op === '!=') return num !== v;
    } else if (between && !isNaN(num)) {
      const lo = parseFloat(between[1]);
      const hi = parseFloat(between[2]);
      return num >= lo && num <= hi;
    }
    // Substring match
    return cellRaw.toLowerCase().includes(trimmed.toLowerCase());
  };

  // Filter rows by per-column search.
  // Within a column:
  //   - " AND " separator → all sub-expressions must match (e.g. ">200 AND <5000")
  //   - " OR " separator  → any sub-expression matches (e.g. "naive OR memory")
  //   - "," ";" "/" "|" ":" separator → OR (legacy multi-value)
  //   - Otherwise treat as a single expression (numeric compare or substring)
  // Across columns: AND (must satisfy every active filter).
  const filteredRows = useMemo(() => {
    const keys = Object.keys(colSearch).filter((k) => colSearch[k]?.trim());
    if (keys.length === 0) return rows;
    return rows.filter((r) =>
      keys.every((col) => {
        const idx = headers.indexOf(col);
        if (idx < 0) return true;
        const cellRaw = r[idx] || '';
        const searchStr = colSearch[col].trim();
        // Compound AND
        if (/\s+AND\s+/i.test(searchStr)) {
          const parts = searchStr
            .split(/\s+AND\s+/i)
            .map((s) => s.trim())
            .filter(Boolean);
          return parts.every((p) => testOne(cellRaw, p));
        }
        // Compound OR (explicit keyword)
        if (/\s+OR\s+/i.test(searchStr)) {
          const parts = searchStr
            .split(/\s+OR\s+/i)
            .map((s) => s.trim())
            .filter(Boolean);
          return parts.some((p) => testOne(cellRaw, p));
        }
        // Legacy multi-value OR
        if (/[,;:\/\|]/.test(searchStr) && !/^[><=!]/.test(searchStr)) {
          const terms = searchStr
            .split(/[,;:\/\|]+/)
            .map((t) => t.trim())
            .filter(Boolean);
          if (terms.length > 0) return terms.some((t) => testOne(cellRaw, t));
        }
        // Single expression
        return testOne(cellRaw, searchStr);
      })
    );
  }, [rows, colSearch, headers]);

  // rowKey index for selection
  const keyIdx = rowKey ? headers.indexOf(rowKey) : -1;

  // Reset page when filter changes
  useEffect(() => {
    setPage(0);
  }, [colSearch]);

  // Auto-select all filtered rows when filter is active
  useEffect(() => {
    if (!selectable || keyIdx < 0) return;
    const hasFilters = Object.values(colSearch).some((v) => v?.trim());
    if (hasFilters && filteredRows.length > 0 && filteredRows.length < rows.length) {
      const next = new Set<string>();
      filteredRows.forEach((r) => next.add(r[keyIdx]));
      if (isControlled) {
        onSelectionChange?.([...next]);
      } else {
        setInternalSelected(next);
        onSelectionChange?.([...next]);
      }
    } else if (!hasFilters) {
      // Clear selection when filter is cleared
      if (isControlled) {
        onSelectionChange?.([]);
      } else {
        setInternalSelected(new Set());
        onSelectionChange?.([]);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredRows, colSearch, keyIdx, selectable, rows.length]);

  // ---- Copilot UI control: respond to AI-driven filter and selection events ----
  useEffect(() => {
    const onFilter = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      const next: Record<string, string> = {};
      if (detail.columnFilters && typeof detail.columnFilters === 'object') {
        for (const k of Object.keys(detail.columnFilters)) {
          const v = detail.columnFilters[k];
          if (typeof v === 'string' && v.trim()) next[k] = v.trim();
        }
      }
      // Validate that all referenced columns exist
      const valid: Record<string, string> = {};
      for (const k of Object.keys(next)) {
        if (headers.includes(k)) valid[k] = next[k];
      }
      setColSearch(valid);
    };
    const onSelectByKeys = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      const ids = Array.isArray(detail.cellIds) ? detail.cellIds : [];
      if (!selectable || keyIdx < 0) return;
      const known = new Set(rows.map((r) => r[keyIdx]));
      const next = new Set<string>(ids.filter((x: string) => known.has(x)));
      if (isControlled) {
        onSelectionChange?.([...next]);
      } else {
        setInternalSelected(next);
        onSelectionChange?.([...next]);
      }
    };
    window.addEventListener('biof3:csvtable-filter', onFilter as EventListener);
    window.addEventListener('biof3:csvtable-select', onSelectByKeys as EventListener);
    return () => {
      window.removeEventListener('biof3:csvtable-filter', onFilter as EventListener);
      window.removeEventListener('biof3:csvtable-select', onSelectByKeys as EventListener);
    };
  }, [headers, rows, keyIdx, selectable, isControlled, onSelectionChange]);

  const _totalPages = Math.max(1, Math.ceil(filteredRows.length / currentPageSize));
  const pageRows = filteredRows.slice(page * currentPageSize, (page + 1) * currentPageSize);

  // Selection handlers
  const updateSelection = useCallback(
    (next: Set<string>) => {
      if (isControlled) {
        onSelectionChange?.([...next]);
      } else {
        setInternalSelected(next);
        onSelectionChange?.([...next]);
      }
    },
    [isControlled, onSelectionChange]
  );

  const toggleRow = useCallback(
    (key: string) => {
      const next = new Set(selected);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      updateSelection(next);
    },
    [selected, updateSelection]
  );

  const togglePageAll = useCallback(() => {
    if (keyIdx < 0) return;
    const pageKeys = pageRows.map((r) => r[keyIdx]);
    const allSelected = pageKeys.every((k) => selected.has(k));
    const next = new Set(selected);
    if (allSelected) pageKeys.forEach((k) => next.delete(k));
    else pageKeys.forEach((k) => next.add(k));
    updateSelection(next);
  }, [keyIdx, pageRows, selected, updateSelection]);

  const selectFiltered = useCallback(() => {
    if (keyIdx < 0) return;
    const next = new Set<string>();
    filteredRows.forEach((r) => next.add(r[keyIdx]));
    updateSelection(next);
  }, [filteredRows, keyIdx, updateSelection]);

  const clearSelection = useCallback(() => {
    updateSelection(new Set());
  }, [updateSelection]);

  // Merge uploaded annotation columns
  const [mergedCols, setMergedCols] = useState<{
    headers: string[];
    data: Record<string, string[]>;
  }>({ headers: [], data: {} });
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleAnnotUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      if (!text) return;
      const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
      if (lines.length < 2) return;
      const parseLine = (line: string): string[] => {
        const out: string[] = [];
        let cur = '';
        let inQuote = false;
        for (let i = 0; i < line.length; i++) {
          const c = line[i];
          if (c === '"') {
            inQuote = !inQuote;
            continue;
          }
          if (c === ',' && !inQuote) {
            out.push(cur);
            cur = '';
            continue;
          }
          cur += c;
        }
        out.push(cur);
        return out;
      };
      const uploadHeaders = parseLine(lines[0]);
      const keyColIdx = uploadHeaders.findIndex((h) => h.toLowerCase() === 'cell_id');
      if (keyColIdx < 0) {
        alert('上传的文件需要包含 cell_id 列');
        return;
      }
      const newCols = uploadHeaders.filter((_, i) => i !== keyColIdx);
      const dataMap: Record<string, string[]> = {};
      for (let i = 1; i < lines.length; i++) {
        const row = parseLine(lines[i]);
        const cellId = row[keyColIdx];
        if (!cellId) continue;
        dataMap[cellId] = row.filter((_, j) => j !== keyColIdx);
      }
      setMergedCols({ headers: newCols, data: dataMap });
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  // Merged headers and rows (original + uploaded columns)
  const mergedHeaders = useMemo(
    () => [...headers, ...mergedCols.headers],
    [headers, mergedCols.headers]
  );
  const mergedRows = useMemo(() => {
    if (mergedCols.headers.length === 0) return rows;
    return rows.map((r) => {
      const cellId = keyIdx >= 0 ? r[keyIdx] : '';
      const extra = mergedCols.data[cellId] || mergedCols.headers.map(() => '');
      return [...r, ...extra];
    });
  }, [rows, mergedCols, keyIdx]);

  // Use merged data for filtering
  const effectiveHeaders = mergedCols.headers.length > 0 ? mergedHeaders : headers;
  const effectiveRows = mergedCols.headers.length > 0 ? mergedRows : rows;

  const allPageSelected =
    selectable &&
    keyIdx >= 0 &&
    pageRows.length > 0 &&
    pageRows.every((r) => selected.has(r[keyIdx]));

  const hasFilters = Object.values(colSearch).some((v) => v?.trim());

  // For display: use merged data
  const displayHeaders = effectiveHeaders;
  const displayFilteredRows = useMemo(() => {
    const keys = Object.keys(colSearch).filter((k) => colSearch[k]?.trim());
    if (keys.length === 0) return effectiveRows;
    return effectiveRows.filter((r) =>
      keys.every((col) => {
        const idx = displayHeaders.indexOf(col);
        if (idx < 0) return true;
        const cellVal = (r[idx] || '').toLowerCase();
        const searchStr = colSearch[col].trim();
        const terms = searchStr
          .split(/[,;:\/\|]+/)
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean);
        if (terms.length === 0) return true;
        return terms.some((term) => cellVal.includes(term));
      })
    );
  }, [effectiveRows, colSearch, displayHeaders]);
  const displayPageRows = displayFilteredRows.slice(
    page * currentPageSize,
    (page + 1) * currentPageSize
  );
  const displayTotalPages = Math.max(1, Math.ceil(displayFilteredRows.length / currentPageSize));

  if (loading) return <div className="sc-csv-empty">加载中...</div>;
  if (err)
    return (
      <div className="sc-csv-empty" style={{ color: '#dc2626' }}>
        加载失败: {err}
      </div>
    );
  if (rows.length === 0) return <div className="sc-csv-empty">空表</div>;

  return (
    <div className="sc-csv-table">
      {/* Status bar */}
      <div className="sc-csv-toolbar">
        <span className="sc-csv-status">
          {displayFilteredRows.length.toLocaleString()} / {effectiveRows.length.toLocaleString()} 行
          {hasFilters && <span className="sc-csv-filtered-tag">已筛选</span>}
        </span>
        {selectable && (
          <span className="sc-csv-selection-count">
            已选 <strong>{selected.size.toLocaleString()}</strong>
          </span>
        )}
        {hasFilters && (
          <button className="sc-btn sc-btn-sm" onClick={() => setColSearch({})}>
            清除筛选
          </button>
        )}
        {selectable && filteredRows.length > 0 && filteredRows.length < rows.length && (
          <button className="sc-btn sc-btn-sm" onClick={selectFiltered}>
            选中筛选结果
          </button>
        )}
        {selectable && selected.size > 0 && (
          <button className="sc-btn sc-btn-sm" onClick={clearSelection}>
            清空选择
          </button>
        )}
        <label className="sc-btn sc-btn-sm" style={{ cursor: 'pointer' }}>
          + 上传标注
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.tsv,.txt"
            onChange={handleAnnotUpload}
            style={{ display: 'none' }}
          />
        </label>
        {mergedCols.headers.length > 0 && (
          <span style={{ fontSize: 10, color: '#10b981' }}>+{mergedCols.headers.length} 列</span>
        )}
      </div>

      <div className="sc-csv-scroll">
        <table className="sc-table">
          <thead>
            <tr>
              {selectable && keyIdx >= 0 && (
                <th className="sc-csv-select-col">
                  <input
                    type="checkbox"
                    checked={allPageSelected}
                    onChange={togglePageAll}
                    title="选中本页"
                  />
                </th>
              )}
              {displayHeaders.map((h, i) => (
                <th key={i}>{h}</th>
              ))}
            </tr>
            <tr className="sc-csv-search-row">
              {selectable && keyIdx >= 0 && <th></th>}
              {displayHeaders.map((h, i) => (
                <th key={i}>
                  <input
                    type="text"
                    className="sc-csv-col-search"
                    placeholder="搜索 (多值用,分隔)"
                    value={colSearch[h] || ''}
                    onChange={(e) => setColSearch((prev) => ({ ...prev, [h]: e.target.value }))}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayPageRows.map((r, i) => {
              const key = keyIdx >= 0 ? r[keyIdx] : String(i);
              const isSel = selected.has(key);
              return (
                <tr key={key + '-' + i} className={isSel ? 'sc-csv-row-selected' : ''}>
                  {selectable && keyIdx >= 0 && (
                    <td className="sc-csv-select-col">
                      <input type="checkbox" checked={isSel} onChange={() => toggleRow(key)} />
                    </td>
                  )}
                  {r.map((c, j) => (
                    <td key={j} title={c}>
                      {c}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {displayTotalPages > 1 && (
        <div className="sc-csv-pagination">
          <button className="sc-btn sc-btn-sm" onClick={() => setPage(0)} disabled={page === 0}>
            « 首页
          </button>
          <button
            className="sc-btn sc-btn-sm"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
          >
            上一页
          </button>
          <span className="sc-csv-pageinfo">
            {page + 1} / {displayTotalPages}
          </span>
          <button
            className="sc-btn sc-btn-sm"
            onClick={() => setPage((p) => Math.min(displayTotalPages - 1, p + 1))}
            disabled={page === displayTotalPages - 1}
          >
            下一页
          </button>
          <button
            className="sc-btn sc-btn-sm"
            onClick={() => setPage(displayTotalPages - 1)}
            disabled={page === displayTotalPages - 1}
          >
            末页 »
          </button>
          <select
            className="sc-csv-pagesize"
            value={currentPageSize}
            onChange={(e) => {
              setCurrentPageSize(+e.target.value);
              setPage(0);
            }}
          >
            <option value={20}>20 行/页</option>
            <option value={50}>50 行/页</option>
            <option value={100}>100 行/页</option>
            <option value={200}>200 行/页</option>
            <option value={500}>500 行/页</option>
          </select>
        </div>
      )}

      {actions && <div className="sc-csv-actions">{actions}</div>}
    </div>
  );
}
