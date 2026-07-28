import React from 'react';
import {
  buildColumnSelection,
  buildLegendSelection,
  buildPointSelection,
  buildQuerySelection,
  buildRegionSelection,
  buildRowSelection,
  formatSelectionChip,
  readEntityId,
  type ArtifactInteractionManifest,
  type ArtifactSelection,
  type SelectionFilterExpression,
  type SelectionSortSpec,
} from '@/lib/artifact-selection';
import {
  queryResultStudioTable,
  type ResultTableQuery,
} from '@/lib/result-studio-interaction-client';
import styles from './ScientificInteractionViewer.module.css';

const ROW_HEIGHT = 32;
const PAGE_SIZE = 200;
const VIEW_ROWS = 18;

function numeric(value: unknown): number | null {
  const text = String(value ?? '').trim();
  const ratio = text.match(/^(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)$/);
  if (ratio) {
    const denominator = Number(ratio[2]);
    return denominator ? Number(ratio[1]) / denominator : null;
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function withQueryColumns(manifest: ArtifactInteractionManifest, query: ResultTableQuery): ArtifactInteractionManifest {
  return {
    ...manifest,
    columns: query.columns.map((column) => ({
      field: column.field,
      sortable: column.sortable,
      filterable: column.filterable,
      numeric: column.type === 'number',
    })),
    totalRowCount: query.totalRows,
  };
}

export function ScientificInteractionViewer({
  language,
  jobId,
  artifactName,
  manifest,
  backingTable,
  selection,
  onSelectionChange,
}: {
  language: 'r' | 'python';
  jobId: string;
  artifactName: string;
  manifest: ArtifactInteractionManifest;
  backingTable?: ResultTableQuery | null;
  selection: ArtifactSelection | null;
  onSelectionChange: (selection: ArtifactSelection | null) => void;
}): React.ReactElement {
  const mode = manifest.interactionMode || 'read_only';
  if (mode === 'table') {
    return (
      <VirtualScientificTable
        language={language}
        jobId={jobId}
        artifactName={artifactName}
        manifest={manifest}
        selection={selection}
        onSelectionChange={onSelectionChange}
      />
    );
  }
  if (mode === 'scatter' && backingTable) {
    return <ScientificScatter manifest={withQueryColumns(manifest, backingTable)} query={backingTable} selection={selection} onSelectionChange={onSelectionChange} />;
  }
  if (mode === 'matrix' && backingTable) {
    return <ScientificMatrix manifest={withQueryColumns(manifest, backingTable)} query={backingTable} selection={selection} onSelectionChange={onSelectionChange} />;
  }
  return (
    <div className={styles.readOnlyNotice}>
      <strong>只读结果</strong>
      <span>{manifest.diagnostics?.find((item) => item.code.includes('mapping'))?.message || '插件没有提供稳定实体映射。'}</span>
    </div>
  );
}

function SelectionBar({ selection, onClear }: { selection: ArtifactSelection | null; onClear: () => void }): React.ReactElement {
  return (
    <div className={styles.selectionBar}>
      <span>{selection ? formatSelectionChip(selection) : '尚未选择科学实体'}</span>
      {selection?.compatibility && selection.compatibility !== 'compatible' && (
        <em data-status={selection.compatibility}>{selection.compatibility === 'stale' ? '选择已过期' : '选择不可用'}</em>
      )}
      {selection && <button type="button" onClick={onClear}>清除</button>}
    </div>
  );
}

function VirtualScientificTable({
  language, jobId, artifactName, manifest, selection, onSelectionChange,
}: {
  language: 'r' | 'python'; jobId: string; artifactName: string;
  manifest: ArtifactInteractionManifest; selection: ArtifactSelection | null;
  onSelectionChange: (selection: ArtifactSelection | null) => void;
}): React.ReactElement {
  const [query, setQuery] = React.useState<ResultTableQuery | null>(null);
  const [offset, setOffset] = React.useState(0);
  const [viewportStart, setViewportStart] = React.useState(0);
  const [filterField, setFilterField] = React.useState('');
  const [filterValue, setFilterValue] = React.useState('');
  const [sort, setSort] = React.useState<SelectionSortSpec[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const selectedRows = React.useRef(new Map<string, Record<string, unknown>>());
  const viewportRef = React.useRef<HTMLDivElement | null>(null);
  const filterExpression = React.useMemo<SelectionFilterExpression>(() => ({
    logic: 'and',
    clauses: filterField && filterValue
      ? [{ field: filterField, op: 'contains', value: filterValue }]
      : [],
  }), [filterField, filterValue]);

  React.useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError('');
      queryResultStudioTable({ language, jobId, artifact: artifactName, filterExpression, sort, offset, limit: PAGE_SIZE })
        .then((data) => { if (!cancelled) setQuery(data); })
        .catch((reason: Error) => { if (!cancelled) setError(reason.message || '表格查询失败'); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 120);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [artifactName, filterExpression, jobId, language, offset, sort]);

  React.useEffect(() => {
    if (!selection) {
      selectedRows.current.clear();
      return;
    }
    if (selection.origin !== 'row_select' || !manifest.idField) return;
    selectedRows.current = new Map(
      selection.entityIds.map((entityId) => [entityId, { [manifest.idField!]: entityId }]),
    );
  }, [manifest.artifactId, manifest.idField, selection]);

  const effectiveManifest = query ? withQueryColumns(manifest, query) : manifest;
  const columns = query?.columns || [];
  const queryOffset = query?.offset ?? offset;
  const localViewportStart = Math.max(0, viewportStart - queryOffset);
  const visibleRows = query?.rows.slice(localViewportStart, localViewportStart + VIEW_ROWS) || [];
  const selectedFields = selection?.origin === 'column_select' ? selection.fields : [];

  const resetViewport = () => {
    setOffset(0);
    setViewportStart(0);
    if (viewportRef.current) viewportRef.current.scrollTop = 0;
  };

  const toggleRow = (row: Record<string, unknown>) => {
    const id = readEntityId(effectiveManifest, row);
    if (!id) return;
    if (selectedRows.current.has(id)) selectedRows.current.delete(id);
    else selectedRows.current.set(id, row);
    const next = buildRowSelection(effectiveManifest, [...selectedRows.current.values()]).selection;
    onSelectionChange(next.entityIdCount ? next : null);
  };

  const toggleSort = (field: string) => {
    resetViewport();
    setSort((current) => {
      const active = current[0];
      if (active?.field !== field) return [{ field, direction: 'asc' }];
      if (active.direction === 'asc') return [{ field, direction: 'desc' }];
      return [];
    });
  };

  const selectAllFiltered = () => {
    if (!query) return;
    onSelectionChange(buildQuerySelection(effectiveManifest, {
      filterExpression: query.filterExpression,
      sort: query.sort,
      matchedEntityIds: query.selectionEvidence.sampleEntityIds,
      matchedCount: query.selectionEvidence.entityIdCount,
      entityIdsHash: query.selectionEvidence.entityIdsHash,
      filterHash: query.filterHash,
    }));
  };

  const toggleColumn = (field: string) => {
    const next = selectedFields.includes(field)
      ? selectedFields.filter((item) => item !== field)
      : [...selectedFields, field];
    onSelectionChange(next.length > 0 ? buildColumnSelection(effectiveManifest, next) : null);
  };

  return (
    <div className={styles.viewer} data-mode="table">
      <div className={styles.tableToolbar}>
        <select value={filterField} onChange={(event) => { setFilterField(event.target.value); resetViewport(); }} aria-label="筛选字段">
          <option value="">筛选字段</option>
          {columns.map((column) => <option key={column.field} value={column.field}>{column.field}</option>)}
        </select>
        <input value={filterValue} onChange={(event) => { setFilterValue(event.target.value); resetViewport(); }} placeholder="输入筛选内容" aria-label="筛选内容" />
        <button type="button" disabled={!query?.selectionEvidence.entityIdsHash} onClick={selectAllFiltered}>选择全部筛选结果</button>
        <span>{query ? `${query.matchedCount.toLocaleString()} / ${query.totalRows.toLocaleString()} 行` : '读取中'}</span>
      </div>
      <SelectionBar selection={selection} onClear={() => { selectedRows.current.clear(); onSelectionChange(null); }} />
      <details className={styles.columnPicker}>
        <summary>选择结果列{selectedFields.length > 0 ? ` · ${selectedFields.length}` : ''}</summary>
        <div role="group" aria-label="选择结果列">
          {columns.map((column) => (
            <label key={column.field}>
              <input
                type="checkbox"
                aria-label={`选择列 ${column.field}`}
                checked={selectedFields.includes(column.field)}
                onChange={() => toggleColumn(column.field)}
              />
              <span>{column.field}</span>
            </label>
          ))}
        </div>
      </details>
      {error && <div className={styles.error}>{error}</div>}
      <div className={styles.tableHeader} style={{ gridTemplateColumns: `34px repeat(${columns.length}, minmax(112px, 1fr))` }}>
        <span />
        {columns.map((column) => (
          <button key={column.field} type="button" onClick={() => toggleSort(column.field)}>
            {column.field}{sort[0]?.field === column.field ? (sort[0].direction === 'asc' ? ' ↑' : ' ↓') : ''}
          </button>
        ))}
      </div>
      <div
        ref={viewportRef}
        className={styles.virtualViewport}
        aria-label="科学结果表格"
        onScroll={(event) => {
          const first = Math.floor(event.currentTarget.scrollTop / ROW_HEIGHT);
          const next = Math.floor(first / PAGE_SIZE) * PAGE_SIZE;
          setViewportStart(first);
          if (next !== offset) setOffset(next);
        }}
      >
        <div className={styles.virtualSpacer} style={{ height: Math.max(1, query?.matchedCount || 0) * ROW_HEIGHT }}>
          {visibleRows.map((row, index) => {
            const id = readEntityId(effectiveManifest, row);
            const checked = !!id && selectedRows.current.has(id);
            return (
              <div
                key={id || `${queryOffset}-${index}`}
                className={styles.virtualRow}
                style={{ top: (queryOffset + localViewportStart + index) * ROW_HEIGHT, gridTemplateColumns: `34px repeat(${columns.length}, minmax(112px, 1fr))` }}
              >
                <input type="checkbox" checked={checked} disabled={!id} onChange={() => toggleRow(row)} aria-label={id ? `选择 ${id}` : '该行无稳定 ID'} />
                {columns.map((column) => <span key={column.field} title={String(row[column.field] ?? '')}>{String(row[column.field] ?? '—')}</span>)}
              </div>
            );
          })}
        </div>
        {loading && <div className={styles.loading}>读取完整表查询…</div>}
      </div>
    </div>
  );
}

function ScientificScatter({ manifest, query, selection, onSelectionChange }: {
  manifest: ArtifactInteractionManifest; query: ResultTableQuery; selection: ArtifactSelection | null;
  onSelectionChange: (selection: ArtifactSelection | null) => void;
}): React.ReactElement {
  const mapping = manifest.mapping!;
  const points = React.useMemo(() => query.rows.map((row) => {
    const x = numeric(row[mapping.xField || '']);
    const rawY = numeric(row[mapping.yField || '']);
    const y = rawY === null ? null : mapping.yTransform === 'neg_log10' ? -Math.log10(Math.max(rawY, 1e-300)) : rawY;
    return { row, x, y };
  }).filter((point): point is { row: Record<string, string>; x: number; y: number } => point.x !== null && point.y !== null), [mapping, query.rows]);
  const xs = points.map((point) => point.x); const ys = points.map((point) => point.y);
  const minX = Math.min(...xs); const maxX = Math.max(...xs); const minY = Math.min(...ys); const maxY = Math.max(...ys);
  const px = (value: number) => 42 + ((value - minX) / (maxX - minX || 1)) * 526;
  const py = (value: number) => 318 - ((value - minY) / (maxY - minY || 1)) * 284;
  const [drag, setDrag] = React.useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const legends = mapping.legendField ? [...new Set(query.rows.map((row) => row[mapping.legendField!]).filter(Boolean))] : [];
  return (
    <div className={styles.viewer} data-mode="scatter">
      <SelectionBar selection={selection} onClear={() => onSelectionChange(null)} />
      {legends.length > 0 && <div className={styles.legend}>{legends.map((legend) => (
        <button key={legend} type="button" onClick={() => onSelectionChange(buildLegendSelection(manifest, query.rows.filter((row) => row[mapping.legendField!] === legend)))}>{legend}</button>
      ))}</div>}
      <svg
        className={styles.scatter}
        viewBox="0 0 600 350"
        role="group"
        aria-label="可选择科学散点图"
        onPointerDown={(event) => { const box = event.currentTarget.getBoundingClientRect(); const x = (event.clientX - box.left) * 600 / box.width; const y = (event.clientY - box.top) * 350 / box.height; setDrag({ x0: x, y0: y, x1: x, y1: y }); }}
        onPointerMove={(event) => { if (!drag) return; const box = event.currentTarget.getBoundingClientRect(); setDrag({ ...drag, x1: (event.clientX - box.left) * 600 / box.width, y1: (event.clientY - box.top) * 350 / box.height }); }}
        onPointerUp={() => {
          if (!drag) return;
          const left = Math.min(drag.x0, drag.x1); const right = Math.max(drag.x0, drag.x1);
          const top = Math.min(drag.y0, drag.y1); const bottom = Math.max(drag.y0, drag.y1);
          const matched = points.filter((point) => px(point.x) >= left && px(point.x) <= right && py(point.y) >= top && py(point.y) <= bottom).map((point) => point.row);
          if (Math.abs(right - left) > 5 && Math.abs(bottom - top) > 5) onSelectionChange(buildRegionSelection(manifest, drag, matched));
          setDrag(null);
        }}
      >
        <line x1="42" y1="318" x2="568" y2="318" />
        <line x1="42" y1="34" x2="42" y2="318" />
        {points.map((point) => {
          const id = readEntityId(manifest, point.row) || '';
          const active = !!id && selection?.entityIds.includes(id);
          const selectPoint = () => onSelectionChange(buildPointSelection(manifest, [point.row]));
          return (
            <circle
              key={id || `${point.x}-${point.y}`}
              cx={px(point.x)}
              cy={py(point.y)}
              r={active ? 5 : 3}
              data-active={active}
              role="button"
              tabIndex={id ? 0 : -1}
              aria-label={id ? `选择 ${id}` : '该散点无稳定 ID'}
              aria-pressed={active}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={selectPoint}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                selectPoint();
              }}
            >
              <title>{id}</title>
            </circle>
          );
        })}
        {drag && <rect x={Math.min(drag.x0, drag.x1)} y={Math.min(drag.y0, drag.y1)} width={Math.abs(drag.x1 - drag.x0)} height={Math.abs(drag.y1 - drag.y0)} />}
        <text x="300" y="344">{mapping.xField}</text><text x="8" y="22">{mapping.yTransform === 'neg_log10' ? `-log10(${mapping.yField})` : mapping.yField}</text>
      </svg>
      <small className={styles.caveat}>显示 {points.length} 个有界 backing-data 点；点选、框选和图例均回写稳定 {manifest.entityType} ID。</small>
    </div>
  );
}

function ScientificMatrix({ manifest, query, selection, onSelectionChange }: {
  manifest: ArtifactInteractionManifest; query: ResultTableQuery; selection: ArtifactSelection | null;
  onSelectionChange: (selection: ArtifactSelection | null) => void;
}): React.ReactElement {
  const rowField = manifest.mapping?.rowIdField || manifest.idField || query.columns[0]?.field;
  const columns = query.columns.map((column) => column.field).filter((field) => field !== rowField).slice(0, 24);
  const rows = query.rows.slice(0, 40);
  const values = rows.flatMap((row) => columns.map((field) => numeric(row[field])).filter((value): value is number => value !== null));
  const min = Math.min(...values); const max = Math.max(...values);
  const rowManifest = { ...manifest, idField: rowField, entityType: manifest.mapping?.rowEntityType || manifest.entityType, selectionDurable: true };
  const columnManifest = { ...manifest, entityType: manifest.mapping?.columnEntityType || 'column', columns: columns.map((field) => ({ field })), selectionDurable: true };
  return (
    <div className={styles.viewer} data-mode="matrix">
      <SelectionBar selection={selection} onClear={() => onSelectionChange(null)} />
      <div className={styles.matrix} style={{ gridTemplateColumns: `minmax(110px, auto) repeat(${columns.length}, 28px)` }}>
        <span />
        {columns.map((field) => <button key={field} type="button" title={`选择 ${field}`} onClick={() => onSelectionChange(buildColumnSelection(columnManifest, [field]))}>{field}</button>)}
        {rows.map((row) => (
          <React.Fragment key={row[rowField]}>
            <button type="button" onClick={() => onSelectionChange(buildRowSelection(rowManifest, [row]).selection)}>{row[rowField]}</button>
            {columns.map((field) => {
              const value = numeric(row[field]); const ratio = value === null ? .5 : (value - min) / (max - min || 1);
              return <span key={field} title={`${row[rowField]} × ${field}: ${row[field]}`} style={{ ['--matrix-value' as string]: ratio }} />;
            })}
          </React.Fragment>
        ))}
      </div>
      <small className={styles.caveat}>行选择映射为 {manifest.mapping?.rowEntityType}，列选择映射为 {manifest.mapping?.columnEntityType}；仅渲染有界矩阵窗口。</small>
    </div>
  );
}
