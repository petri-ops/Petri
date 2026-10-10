import { formatScientificValue } from '@/lib/format-scientific-value';
import { unknownText } from '@/lib/unknownText';
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
  type SelectionFilterClause,
  type SelectionFilterExpression,
  type SelectionSortSpec,
} from '@/lib/artifact-selection';
import {
  queryResultStudioTable,
  type ResultTableQuery,
} from '@/lib/result-studio-interaction-client';
import { setSelectionBusSelection, useSelectionBus } from '@/lib/selectionBus';
import styles from './ScientificInteractionViewer.module.css';

const ROW_HEIGHT = 32;
const PAGE_SIZE = 200;
const VIEW_ROWS = 18;
const SCATTER_WIDTH = 600;
const SCATTER_HEIGHT = 350;
const SCATTER_PLOT = Object.freeze({ left: 58, right: 576, top: 28, bottom: 310 });

/** 表格筛选子句构建器的可选操作符；数值比较的值合法性由子句归一化兜底。 */
const FILTER_OPS: Array<{ value: SelectionFilterClause['op']; label: string }> = [
  { value: 'contains', label: '包含' },
  { value: 'eq', label: '=' },
  { value: 'ne', label: '≠' },
  { value: 'gt', label: '>' },
  { value: 'gte', label: '≥' },
  { value: 'lt', label: '<' },
  { value: 'lte', label: '≤' },
];

function scatterPointerPosition(svg: SVGSVGElement, clientX: number, clientY: number): { x: number; y: number } {
  const matrix = svg.getScreenCTM?.();
  if (matrix && typeof matrix.inverse === 'function' && typeof svg.createSVGPoint === 'function') {
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    // 部分运行环境（测试用 happy-dom ≥20）只提供 getScreenCTM/createSVGPoint，
    // 返回点缺 matrixTransform——缺则回退到 getBoundingClientRect 等比换算，避免整块交互崩掉。
    if (typeof point.matrixTransform === 'function') {
      const local = point.matrixTransform(matrix.inverse());
      return { x: local.x, y: local.y };
    }
  }
  const box = svg.getBoundingClientRect();
  return {
    x: (clientX - box.left) * SCATTER_WIDTH / box.width,
    y: (clientY - box.top) * SCATTER_HEIGHT / box.height,
  };
}

function numeric(value: unknown): number | null {
  const text = unknownText(value).trim();
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
  selection: selectionProp,
  onSelectionChange,
}: {
  language: 'r' | 'python';
  jobId: string;
  artifactName: string;
  manifest: ArtifactInteractionManifest;
  backingTable?: ResultTableQuery | null;
  // BLOCK-139 P0-3 平迁：两 prop 收窄为可选。提供 onSelectionChange = 既有回调
  // 面（零回归）；未提供 = 总线模式——交互出口把 ArtifactSelection 写进总线
  //（D1 单选择真相，坐标来自 manifest），选中回显从总线读取并随总线清除同步消失。
  selection?: ArtifactSelection | null;
  onSelectionChange?: (selection: ArtifactSelection | null) => void;
}): React.ReactElement {
  const busState = useSelectionBus();
  // BLOCK-139 P1 mark-to-entity：总线出口写入时随 context 携带 manifest.idField
  //（entityType 在选择对象自身词汇里）；回调模式原样透传，零回归。
  const emitSelection = onSelectionChange
    ?? ((next: ArtifactSelection | null) => setSelectionBusSelection(next, { idField: manifest.idField }));
  // 总线回显按 artifactId 归位：总线只持有当前活跃 artifact 的选择（D1），
  // 其他 artifact 的选择不在本 viewer 回显。
  const selection = onSelectionChange
    ? selectionProp ?? null
    : busState.selection && busState.selection.artifactId === manifest.artifactId
      ? busState.selection
      : null;
  const mode = manifest.interactionMode || 'read_only';
  if (mode === 'table') {
    return (
      <VirtualScientificTable
        language={language}
        jobId={jobId}
        artifactName={artifactName}
        manifest={manifest}
        selection={selection}
        onSelectionChange={emitSelection}
      />
    );
  }
  if (mode === 'scatter' && backingTable) {
    return <ScientificScatter manifest={withQueryColumns(manifest, backingTable)} query={backingTable} selection={selection} onSelectionChange={emitSelection} />;
  }
  if (mode === 'matrix' && backingTable) {
    return <ScientificMatrix manifest={withQueryColumns(manifest, backingTable)} query={backingTable} selection={selection} onSelectionChange={emitSelection} />;
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
      {selection && <button className="petri-btn petri-btn--ghost petri-btn--sm" type="button" onClick={onClear}>清除</button>}
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
  const [filterClauses, setFilterClauses] = React.useState<Array<{ field: string; op: SelectionFilterClause['op']; value: string }>>([{ field: '', op: 'contains', value: '' }]);
  const [sort, setSort] = React.useState<SelectionSortSpec[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const selectedRows = React.useRef(new Map<string, Record<string, unknown>>());
  const viewportRef = React.useRef<HTMLDivElement | null>(null);
  // 选择真相 → 行勾选回显的同步在渲染期进行（BLOCK-139 P0-3 平迁）：总线模式下
  // 「清除选择」只有一次重渲染，若留在 effect 里清 ref，本次提交的 checkbox 仍按
  // 旧 ref 渲染且清 ref 不触发重渲染，回显会滞留。渲染期同步使同一帧内 ref 与
  // selection 一致；行勾选累积/恢复语义与既有回调面完全相同。
  const hydratedSelectionRef = React.useRef<ArtifactSelection | null | undefined>(undefined);
  if (hydratedSelectionRef.current !== selection) {
    hydratedSelectionRef.current = selection;
    if (!selection) {
      selectedRows.current.clear();
    } else if (selection.origin === 'row_select' && manifest.idField) {
      selectedRows.current = new Map(
        selection.entityIds.map((entityId) => [entityId, { [manifest.idField!]: entityId }]),
      );
    }
  }
  const filterExpression = React.useMemo<SelectionFilterExpression>(() => ({
    logic: 'and',
    clauses: filterClauses.flatMap((clause): Array<{ field: string; op: SelectionFilterClause['op']; value: string | number }> => {
      if (!clause.field || !clause.value) return [];
      if (clause.op === 'contains') return [{ field: clause.field, op: 'contains', value: clause.value }];
      const numericValue = Number(clause.value);
      // 数值比较操作符遇到不可解析的值时整条子句不生效，不猜测语义。
      if (!Number.isFinite(numericValue)) return [];
      return [{ field: clause.field, op: clause.op, value: numericValue }];
    }),
  }), [filterClauses]);

  const updateClause = (index: number, patch: Partial<{ field: string; op: SelectionFilterClause['op']; value: string }>) => {
    setFilterClauses((current) => current.map((clause, i) => (i === index ? { ...clause, ...patch } : clause)));
  };

  React.useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    queryResultStudioTable({
      language,
      jobId,
      artifact: artifactName,
      filterExpression,
      sort,
      offset,
      limit: PAGE_SIZE,
      signal: controller.signal,
    })
      .then((data) => { if (!cancelled) setQuery(data); })
      .catch((reason: Error) => {
        if (!cancelled && reason.name !== 'AbortError') setError(reason.message || '表格查询失败');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; controller.abort(); };
  }, [artifactName, filterExpression, jobId, language, offset, sort]);

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
      <div className={styles.tableToolbar} role="group" aria-label="表格筛选">
        {filterClauses.map((clause, index) => (
          <div className={styles.filterClauseRow} key={index}>
            <select value={clause.field} onChange={(event) => { updateClause(index, { field: event.target.value }); resetViewport(); }} aria-label={`筛选字段 ${index + 1}`}>
              <option value="">筛选字段</option>
              {columns.map((column) => <option key={column.field} value={column.field}>{column.field}</option>)}
            </select>
            <select value={clause.op} onChange={(event) => { updateClause(index, { op: event.target.value as SelectionFilterClause['op'] }); resetViewport(); }} aria-label={`筛选操作 ${index + 1}`}>
              {FILTER_OPS.map((op) => <option key={op.value} value={op.value}>{op.label}</option>)}
            </select>
            <input value={clause.value} onChange={(event) => { updateClause(index, { value: event.target.value }); resetViewport(); }} placeholder="筛选值" aria-label={`筛选条件 ${index + 1}`} />
            {filterClauses.length > 1 && (
              <button className="petri-btn petri-btn--ghost petri-btn--sm" type="button" aria-label={`移除筛选条件 ${index + 1}`} onClick={() => setFilterClauses((current) => current.filter((_, i) => i !== index))}>×</button>
            )}
          </div>
        ))}
        <button className="petri-btn petri-btn--ghost petri-btn--sm" type="button" onClick={() => setFilterClauses((current) => [...current, { field: '', op: 'contains', value: '' }])}>添加筛选条件</button>
        <button className="petri-btn petri-btn--ghost petri-btn--sm" type="button" disabled={!query?.selectionEvidence.entityIdsHash} onClick={selectAllFiltered}>选择全部筛选结果</button>
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
          <button className="petri-btn petri-btn--ghost petri-btn--sm" key={column.field} type="button" onClick={() => toggleSort(column.field)}>
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
                {columns.map((column) => {
                  const raw = row[column.field];
                  const display = column.type === 'number' ? formatScientificValue(raw) : String(raw ?? '—');
                  return <span key={column.field} title={String(raw ?? '')}>{display}</span>;
                })}
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
  const px = (value: number) => SCATTER_PLOT.left
    + ((value - minX) / (maxX - minX || 1)) * (SCATTER_PLOT.right - SCATTER_PLOT.left);
  const py = (value: number) => SCATTER_PLOT.bottom
    - ((value - minY) / (maxY - minY || 1)) * (SCATTER_PLOT.bottom - SCATTER_PLOT.top);
  const [drag, setDrag] = React.useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [search, setSearch] = React.useState('');
  const [showThresholds, setShowThresholds] = React.useState(true);
  const [thresholdX, setThresholdX] = React.useState(1);
  const [thresholdP, setThresholdP] = React.useState(0.05);
  const legends = mapping.legendField ? [...new Set(query.rows.map((row) => row[mapping.legendField!]).filter(Boolean))] : [];
  const searchQuery = search.trim().toLowerCase();
  const searchHits = React.useMemo(() => {
    if (!searchQuery) return null;
    const ids = new Set<string>();
    for (const point of points) {
      const id = readEntityId(manifest, point.row);
      if (id && id.toLowerCase().includes(searchQuery)) ids.add(id);
    }
    return ids;
  }, [manifest, points, searchQuery]);
  // 参考线是展示辅助，不回写任何分析参数；y 阈值仅在 -log10(p) 变换下有 padj 语义。
  const thresholdY = mapping.yTransform === 'neg_log10' && thresholdP > 0 && thresholdP < 1 ? -Math.log10(thresholdP) : null;
  return (
    <div className={styles.viewer} data-mode="scatter">
      <SelectionBar selection={selection} onClear={() => onSelectionChange(null)} />
      <div className={styles.scatterTools}>
        <input
          type="text"
          value={search}
          placeholder={`搜索${manifest.entityType}…`}
          aria-label="搜索实体"
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || !searchHits || searchHits.size === 0) return;
            event.preventDefault();
            onSelectionChange(buildPointSelection(manifest, points
              .filter((point) => searchHits.has(readEntityId(manifest, point.row) || ''))
              .map((point) => point.row)));
          }}
        />
        <label>
          <input type="checkbox" checked={showThresholds} onChange={(event) => setShowThresholds(event.target.checked)} aria-label="显示参考线" />
          参考线
        </label>
        {showThresholds && (
          <>
            <label>
              |{mapping.xField}| <input type="number" step="0.1" min="0" value={thresholdX} onChange={(event) => setThresholdX(Math.abs(Number(event.target.value) || 0))} aria-label="log2FC 阈值" title={`x 轴是效应量（${mapping.xField}，对数倍数变化）：参考线画在 ±${thresholdX}，线外的点倍数变化更大。展示辅助，不回写分析参数`} />
            </label>
            {mapping.yTransform === 'neg_log10' && (
              <label>
                padj <input type="number" step="0.01" min="0" max="1" value={thresholdP} onChange={(event) => setThresholdP(Math.min(1, Math.max(0, Number(event.target.value) || 0)))} aria-label="padj 阈值" title="padj 是多重检验校正后的 p 值，越小越显著；横线画在其 -log10 位置，线上方的点校正后越显著。展示辅助，不回写分析参数" />
              </label>
            )}
            <em title="参考线只帮助读图：不回写分析参数，也不筛掉任何数据点。">展示辅助</em>
          </>
        )}
      </div>
      {legends.length > 0 && <div className={styles.legend}>{legends.map((legend) => (
        <button className="petri-btn petri-btn--ghost petri-btn--sm" key={legend} type="button" onClick={() => onSelectionChange(buildLegendSelection(manifest, query.rows.filter((row) => row[mapping.legendField!] === legend)))}>{legend}</button>
      ))}</div>}
      <svg
        className={styles.scatter}
        viewBox={`0 0 ${SCATTER_WIDTH} ${SCATTER_HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        role="group"
        aria-label="可选择科学散点图"
        onPointerDown={(event) => {
          const point = scatterPointerPosition(event.currentTarget, event.clientX, event.clientY);
          setDrag({ x0: point.x, y0: point.y, x1: point.x, y1: point.y });
        }}
        onPointerMove={(event) => {
          if (!drag) return;
          const point = scatterPointerPosition(event.currentTarget, event.clientX, event.clientY);
          setDrag({ ...drag, x1: point.x, y1: point.y });
        }}
        onPointerUp={() => {
          if (!drag) return;
          const left = Math.min(drag.x0, drag.x1); const right = Math.max(drag.x0, drag.x1);
          const top = Math.min(drag.y0, drag.y1); const bottom = Math.max(drag.y0, drag.y1);
          const matched = points.filter((point) => px(point.x) >= left && px(point.x) <= right && py(point.y) >= top && py(point.y) <= bottom).map((point) => point.row);
          if (Math.abs(right - left) > 5 && Math.abs(bottom - top) > 5) onSelectionChange(buildRegionSelection(manifest, drag, matched));
          setDrag(null);
        }}
      >
        <line x1={SCATTER_PLOT.left} y1={SCATTER_PLOT.bottom} x2={SCATTER_PLOT.right} y2={SCATTER_PLOT.bottom} />
        <line x1={SCATTER_PLOT.left} y1={SCATTER_PLOT.top} x2={SCATTER_PLOT.left} y2={SCATTER_PLOT.bottom} />
        {showThresholds && thresholdX > 0 && minX <= -thresholdX && (
          <line data-threshold="x" className={styles.thresholdLine} x1={px(-thresholdX)} y1={SCATTER_PLOT.top} x2={px(-thresholdX)} y2={SCATTER_PLOT.bottom}>
            <title>{`|${mapping.xField}| = ${thresholdX} 效应量阈值——线外点倍数变化更大（展示辅助，不回写分析参数）`}</title>
          </line>
        )}
        {showThresholds && thresholdX > 0 && maxX >= thresholdX && (
          <line data-threshold="x" className={styles.thresholdLine} x1={px(thresholdX)} y1={SCATTER_PLOT.top} x2={px(thresholdX)} y2={SCATTER_PLOT.bottom}>
            <title>{`|${mapping.xField}| = ${thresholdX} 效应量阈值——线外点倍数变化更大（展示辅助，不回写分析参数）`}</title>
          </line>
        )}
        {showThresholds && thresholdY !== null && thresholdY >= minY && thresholdY <= maxY && (
          <line data-threshold="y" className={styles.thresholdLine} x1={SCATTER_PLOT.left} y1={py(thresholdY)} x2={SCATTER_PLOT.right} y2={py(thresholdY)}>
            <title>{`padj = ${thresholdP} 显著性阈值（-log10 = ${thresholdY.toFixed(2)}）——线上方的点校正后 p 值更小、更显著（展示辅助，不回写分析参数）`}</title>
          </line>
        )}
        {points.map((point) => {
          const id = readEntityId(manifest, point.row) || '';
          const active = !!id && selection?.entityIds.includes(id);
          const searchHit = !!id && !!searchHits?.has(id);
          const selectPoint = () => onSelectionChange(buildPointSelection(manifest, [point.row]));
          return (
            <circle
              key={id || `${point.x}-${point.y}`}
              cx={px(point.x)}
              cy={py(point.y)}
              r={active || searchHit ? 5 : 3}
              data-active={active}
              data-search-hit={searchHit ? 'true' : undefined}
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
              <title>{[
                id,
                mapping.xField ? `${mapping.xField}: ${point.row[mapping.xField]}` : '',
                mapping.yField ? `${mapping.yField}: ${point.row[mapping.yField]}` : '',
                mapping.legendField ? `${mapping.legendField}: ${point.row[mapping.legendField]}` : '',
              ].filter(Boolean).join('\n')}</title>
            </circle>
          );
        })}
        {drag && <rect x={Math.min(drag.x0, drag.x1)} y={Math.min(drag.y0, drag.y1)} width={Math.abs(drag.x1 - drag.x0)} height={Math.abs(drag.y1 - drag.y0)} />}
        <text className={styles.axisLabel} x={SCATTER_WIDTH / 2} y="342">{mapping.xField}</text>
        <text
          className={styles.axisLabel}
          x="16"
          y={(SCATTER_PLOT.top + SCATTER_PLOT.bottom) / 2}
          transform={`rotate(-90 16 ${(SCATTER_PLOT.top + SCATTER_PLOT.bottom) / 2})`}
        >
          {mapping.yTransform === 'neg_log10' ? `-log10(${mapping.yField})` : mapping.yField}
        </text>
      </svg>
      <small className={styles.caveat}>
        {searchHits ? `搜索命中 ${searchHits.size}；` : ''}显示 {points.length} 个有界 backing-data 点；点选、框选和图例均回写稳定 {manifest.entityType} ID；参考线为展示辅助。
        点数与搜索命中均只统计当前有界窗口——后端交互能力按界回传数据、不整表渲染，未显示不代表全表没有该 {manifest.entityType}，完整结果见原始文件与报告图。
      </small>
    </div>
  );
}

function ScientificMatrix({ manifest, query, selection, onSelectionChange }: {
  manifest: ArtifactInteractionManifest; query: ResultTableQuery; selection: ArtifactSelection | null;
  onSelectionChange: (selection: ArtifactSelection | null) => void;
}): React.ReactElement {
  // BLOCK-141 R-6（plan §1.3）：行选 idField 回退链只认**后端声明的**稳定 ID 列
  //（mapping.rowIdField → manifest.idField）。columns[0] 只是"第一列数据"，不是
  // 身份列——两级声明列都缺失时行选拒绝注入（按钮禁用 + 点击产 null），不得把
  // 数据列单元格值冒充稳定实体 ID 写进选择（fabricated entityIds 会经选择总线 /
  // D2 注入流到 Agent 上下文）。展示用的行标题回退 columns[0] 保留（展示不是
  // 身份），但不再进入 rowManifest。
  const declaredRowIdField = manifest.mapping?.rowIdField || manifest.idField || null;
  // 展示兜底空串（零列查询是边角；key/标签随之为空，不参与选择身份）。
  const displayRowField = declaredRowIdField || query.columns[0]?.field || '';
  // UI-454：解除前端自缚——后端 backing 已有界（行 100/列不截断），
  // 这里全量渲染交给网格滚动；有界口径由 caveat 如实标注。
  const columns = query.columns.map((column) => column.field).filter((field) => field !== declaredRowIdField);
  const rows = query.rows;
  const values = rows.flatMap((row) => columns.map((field) => numeric(row[field])).filter((value): value is number => value !== null));
  const min = Math.min(...values); const max = Math.max(...values);
  const rowManifest = { ...manifest, idField: declaredRowIdField, entityType: manifest.mapping?.rowEntityType || manifest.entityType, selectionDurable: true };
  const columnManifest = { ...manifest, entityType: manifest.mapping?.columnEntityType || 'column', columns: columns.map((field) => ({ field })), selectionDurable: true };
  return (
    <div className={styles.viewer} data-mode="matrix">
      <SelectionBar selection={selection} onClear={() => onSelectionChange(null)} />
      <div className={styles.matrix} style={{ gridTemplateColumns: `minmax(110px, auto) repeat(${columns.length}, 28px)` }}>
        <span />
        {columns.map((field) => <button className="petri-btn petri-btn--ghost petri-btn--sm" key={field} type="button" title={`选择 ${field}`} onClick={() => onSelectionChange(buildColumnSelection(columnManifest, [field]))}>{field}</button>)}
        {rows.map((row) => (
          <React.Fragment key={row[displayRowField]}>
            <button
              className="petri-btn petri-btn--ghost petri-btn--sm"
              type="button"
              disabled={!declaredRowIdField}
              title={declaredRowIdField ? undefined : '该矩阵没有稳定行 ID 列，无法按行选择科学实体'}
              onClick={() => onSelectionChange(declaredRowIdField ? buildRowSelection(rowManifest, [row]).selection : null)}
            >{row[displayRowField]}</button>
            {columns.map((field) => {
              const value = numeric(row[field]); const ratio = value === null ? .5 : (value - min) / (max - min || 1);
              return <span key={field} title={`${row[displayRowField]} × ${field}: ${row[field]}`} style={{ ['--matrix-value' as string]: ratio }} />;
            })}
          </React.Fragment>
        ))}
      </div>
      <small className={styles.caveat}>行选择映射为 {manifest.mapping?.rowEntityType}，列选择映射为 {manifest.mapping?.columnEntityType}；渲染后端有界矩阵窗口（{rows.length} 行 × {columns.length} 列），完整数据见原文件。</small>
    </div>
  );
}
