// ============================================================
// ChartRenderer — `chart` ResultNode renderer.
//
// Payload contract (strict; type-guard below):
//   { kind: 'bar';
//     labels: string[];
//     series: Array<{ name: string; values: number[] }> }
//   | { kind: 'line';
//       xLabels: string[];
//       series: Array<{ name: string; values: number[] }> }
//
// Behaviour:
//   - When payload matches the contract, render a native <svg>
//     viewBox="0 0 600 320" bar chart or line chart with a
//     single-color legend + per-series names. All values use
//     --petri-* design tokens so light/dark themes stay aligned
//     with ResultCard.module.css.
//   - When payload is malformed (unknown kind, missing series,
//     empty labels, non-numeric value, etc.), fail-soft to a
//     labelled JSON dump so a bad upstream payload never crashes
//     the card chrome (mirrors TableRenderer's graceful fallback
//     but stays inside ChartRenderer's own scope).
//   - Bar: equal-width columns with top value labels; Line:
//     polyline + node dots. Auto-scale to data min/max so the
//     placeholder chart stays readable across small payloads.
//
// P2 interaction + a11y layer (2026-08-15, UI-AGENTWB-005):
//   - Hover/focus on a data point shows a <div> tooltip with
//     series name + x label + numeric value. Default absolute
//     values (no percentage switch in P2 — that toggle was
//     explicitly out of scope).
//   - Legend entries are <button>s; clicking toggles the
//     series' UI visibility (UI-only, no data deletion).
//     Toggle state is component-local (useState): a fresh
//     chart always starts with all series visible.
//   - Clicking a data point selects it (stroke emphasis);
//     clicking the same point again clears the selection.
//     Hover never overrides the selected stroke — once a point
//     is selected, hovering other points only swaps the
//     tooltip text but never replaces the stroke emphasis.
//   - <svg> carries a <desc> element with the full series
//     summary so SR users can hear "Bar chart with 2 series:
//     control (10, 12, 14, 16), treated (8, 10, 12, 14)
//     across labels ..." instead of just "Chart: bar".
//   - Every data point (<rect>/<circle>) carries an aria-label
//     ("{series} at {x}: {value}") + tabIndex={0} + aria-selected.
//   - Legend <button>s carry aria-pressed for the toggle state.
//   - Fail-soft fallback path is unchanged: 5 kinds of malformed
//     payloads still render <pre data-testid="result-renderer-
//     chart-fallback"> with no interaction layer.
//
// This renderer is intentionally a pure presentational component
// that owns its own ephemeral interaction state via useState (no
// reducer, no zustand, no new dependency).
// ============================================================

import { useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { ResultNode } from '../types';
import styles from './ChartRenderer.module.css';

type Series = { name: string; values: number[] };

type BarPayload = { kind: 'bar'; labels: string[]; series: Series[] };
type LinePayload = { kind: 'line'; xLabels: string[]; series: Series[] };
type ChartPayload = BarPayload | LinePayload;

const VIEWBOX_W = 600;
const VIEWBOX_H = 320;
const PADDING = { top: 28, right: 16, bottom: 48, left: 44 };

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

function isFiniteNumberArray(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.every((v) => typeof v === 'number' && Number.isFinite(v))
  );
}

function isSeries(value: unknown): value is Series {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as { name?: unknown; values?: unknown };
  if (typeof candidate.name !== 'string') return false;
  if (!isFiniteNumberArray(candidate.values)) return false;
  return true;
}

function isSeriesArray(value: unknown): value is Series[] {
  return Array.isArray(value) && value.every(isSeries);
}

function isBarPayload(value: unknown): value is BarPayload {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as { kind?: unknown; labels?: unknown; series?: unknown };
  if (candidate.kind !== 'bar') return false;
  if (!isStringArray(candidate.labels)) return false;
  if (!isSeriesArray(candidate.series)) return false;
  // Reject when the bar chart is structurally empty (no labels
  // or no series). Avoids an empty SVG with just axis lines.
  if (candidate.labels.length === 0) return false;
  if (candidate.series.length === 0) return false;
  return true;
}

function isLinePayload(value: unknown): value is LinePayload {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as { kind?: unknown; xLabels?: unknown; series?: unknown };
  if (candidate.kind !== 'line') return false;
  if (!isStringArray(candidate.xLabels)) return false;
  if (!isSeriesArray(candidate.series)) return false;
  if (candidate.xLabels.length === 0) return false;
  if (candidate.series.length === 0) return false;
  return true;
}

function isChartPayload(value: unknown): value is ChartPayload {
  return isBarPayload(value) || isLinePayload(value);
}

function tryStringify(payload: unknown): string {
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
}

function range(values: number[]): [number, number] {
  let min = values[0] ?? 0;
  let max = values[0] ?? 1;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (min === max) {
    // Avoid divide-by-zero when all values are identical; pad
    // symmetrically so the column/line sits visibly off the axis.
    return [min - 1, max + 1];
  }
  return [min, max];
}

function plotBox() {
  return {
    x0: PADDING.left,
    y0: PADDING.top,
    x1: VIEWBOX_W - PADDING.right,
    y1: VIEWBOX_H - PADDING.bottom,
  };
}

function yScale(value: number, min: number, max: number): number {
  const { y0, y1 } = plotBox();
  const span = max - min || 1;
  const ratio = (value - min) / span;
  return y1 - ratio * (y1 - y0);
}

function joinWithAnd(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0] ?? '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

function buildChartSummary(payload: ChartPayload): string {
  // Build a single human-readable sentence that lists every
  // series with its numeric values + the chart's x axis labels.
  // Goes inside <desc> so screen readers announce the full
  // content instead of just "Chart: bar".
  const labels = payload.kind === 'bar' ? payload.labels : payload.xLabels;
  const labelClause = joinWithAnd(labels.map((l) => `'${l}'`));
  const seriesClause = payload.series
    .map(
      (s) =>
        `${s.name} (${s.values.map((v) => String(v)).join(', ')})`,
    )
    .join('; ');
  return `${payload.kind === 'bar' ? 'Bar' : 'Line'} chart with ${
    payload.series.length
  } series: ${seriesClause} across labels ${labelClause}`;
}

type SelectedPoint = { seriesIdx: number; pointIdx: number } | null;

export function ChartRenderer({ node }: { node: ResultNode }) {
  const payload = node.payload;

  if (!isChartPayload(payload)) {
    return (
      <div
        data-testid="result-renderer-chart-fallback"
        data-result-id={node.id}
        role="region"
        aria-label={`${node.title}（图表数据无效，已降级为 JSON）`}
      >
        <p className={styles.fallbackNote}>
          图表数据格式无法解析，已降级为原始 JSON（fail-soft）：
        </p>
        <pre className={styles.fallback}>{tryStringify(payload)}</pre>
      </div>
    );
  }

  return <ChartRendererValid node={node} payload={payload} />;
}

function ChartRendererValid({
  node,
  payload,
}: {
  node: ResultNode;
  payload: ChartPayload;
}) {
  const kind = payload.kind;
  const title = `${node.title} (${kind})`;

  // All interaction state is local to the renderer so a fresh
  // chart always starts with all series visible and no selection.
  const [hiddenSeries, setHiddenSeries] = useState<Set<number>>(
    () => new Set<number>(),
  );
  const [selectedPoint, setSelectedPoint] = useState<SelectedPoint>(null);
  const [hoverPoint, setHoverPoint] = useState<SelectedPoint>(null);

  const toggleSeries = useCallback((seriesIdx: number) => {
    setHiddenSeries((prev) => {
      const next = new Set(prev);
      if (next.has(seriesIdx)) {
        next.delete(seriesIdx);
      } else {
        next.add(seriesIdx);
      }
      return next;
    });
  }, []);

  const handlePointClick = useCallback(
    (seriesIdx: number, pointIdx: number) => {
      setSelectedPoint((prev) => {
        if (
          prev !== null &&
          prev.seriesIdx === seriesIdx &&
          prev.pointIdx === pointIdx
        ) {
          return null;
        }
        return { seriesIdx, pointIdx };
      });
    },
    [],
  );

  const handlePointEnter = useCallback(
    (seriesIdx: number, pointIdx: number) => {
      setHoverPoint({ seriesIdx, pointIdx });
    },
    [],
  );

  const handlePointLeave = useCallback(() => {
    setHoverPoint(null);
  }, []);

  // Tooltip data is derived from hoverPoint so the tooltip
  // simply disappears when nothing is hovered/focused.
  const tooltipData = useMemo(() => {
    if (hoverPoint === null) return null;
    const { seriesIdx, pointIdx } = hoverPoint;
    if (seriesIdx < 0 || seriesIdx >= payload.series.length) return null;
    const s = payload.series[seriesIdx];
    if (!s) return null;
    const value = s.values[pointIdx];
    if (value === undefined) return null;
    const labels =
      payload.kind === 'bar' ? payload.labels : payload.xLabels;
    const xLabel = labels[pointIdx] ?? '';
    return {
      seriesName: s.name,
      xLabel,
      value,
    };
  }, [hoverPoint, payload]);

  return (
    <div
      className={styles.wrapper}
      data-testid="result-renderer-chart"
      data-result-id={node.id}
      data-chart-kind={kind}
      data-series-count={
        payload.series.length /* series/label count lives in JSON for full audit */
      }
      data-hidden-series-count={hiddenSeries.size}
      role="img"
      aria-label={`Chart: ${kind}`}
    >
      <svg
        className={styles.svg}
        viewBox={`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`}
        preserveAspectRatio="xMidYMid meet"
        focusable="false"
      >
        <desc data-testid="result-renderer-chart-desc">
          {buildChartSummary(payload)}
        </desc>
        {kind === 'bar'
          ? renderBarChart(payload, title, {
              hiddenSeries,
              selectedPoint,
              onPointClick: handlePointClick,
              onPointEnter: handlePointEnter,
              onPointLeave: handlePointLeave,
            })
          : renderLineChart(payload, title, {
              hiddenSeries,
              selectedPoint,
              onPointClick: handlePointClick,
              onPointEnter: handlePointEnter,
              onPointLeave: handlePointLeave,
            })}
      </svg>
      {/* Hover/focus tooltip lives outside the <svg> so screen
          readers do not treat it as part of the graphic. Pointer
          events disabled — the tooltip never intercepts clicks. */}
      {tooltipData !== null && (
        <div
          className={styles.tooltip}
          data-testid="result-renderer-chart-tooltip"
          data-series-name={tooltipData.seriesName}
          data-x-label={tooltipData.xLabel}
          data-value={tooltipData.value}
          role="status"
          aria-live="polite"
        >
          <span className={styles.tooltipSeries}>
            {tooltipData.seriesName}
          </span>
          <span className={styles.tooltipX}>{tooltipData.xLabel}</span>
          <span className={styles.tooltipValue}>{tooltipData.value}</span>
        </div>
      )}
      <Legend
        payload={payload}
        hiddenSeries={hiddenSeries}
        onToggle={toggleSeries}
      />
    </div>
  );
}

function Legend({
  payload,
  hiddenSeries,
  onToggle,
}: {
  payload: ChartPayload;
  hiddenSeries: Set<number>;
  onToggle: (seriesIdx: number) => void;
}) {
  // Render legend as DOM <button>s outside the <svg> so each
  // entry is a real keyboard-accessible toggle, not a <text>
  // inside the graphic.
  return (
    <div
      className={styles.legend}
      data-testid="result-renderer-chart-legend"
      role="group"
      aria-label="Chart series toggle"
    >
      {payload.series.map((s, idx) => {
        const hidden = hiddenSeries.has(idx);
        return (
          <button
            key={`legend-btn-${idx}`}
            type="button"
            className={`${styles.legendButton}${hidden ? ` ${styles.legendButtonHidden}` : ''}`}
            data-testid={`result-renderer-chart-legend-${idx}`}
            data-series-name={s.name}
            data-hidden={hidden ? 'true' : 'false'}
            aria-pressed={hidden}
            aria-label={`${hidden ? 'Show' : 'Hide'} series ${s.name}`}
            onClick={() => onToggle(idx)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onToggle(idx);
              }
            }}
          >
            <span className={styles.legendSwatch} aria-hidden="true" />
            <span className={styles.legendText}>{s.name}</span>
          </button>
        );
      })}
    </div>
  );
}

type InteractionHandlers = {
  hiddenSeries: Set<number>;
  selectedPoint: SelectedPoint;
  onPointClick: (seriesIdx: number, pointIdx: number) => void;
  onPointEnter: (seriesIdx: number, pointIdx: number) => void;
  onPointLeave: () => void;
};

function isPointSelected(
  selected: SelectedPoint,
  seriesIdx: number,
  pointIdx: number,
): boolean {
  return (
    selected !== null &&
    selected.seriesIdx === seriesIdx &&
    selected.pointIdx === pointIdx
  );
}

function pointAriaLabel(seriesName: string, xLabel: string, value: number): string {
  return `${seriesName} at ${xLabel}: ${value}`;
}

function renderBarChart(
  payload: BarPayload,
  title: string,
  handlers: InteractionHandlers,
): ReactNode {
  const { labels, series } = payload;
  const { x0, x1, y0, y1 } = plotBox();

  const allValues = series.flatMap((s) => s.values);
  const [min, max] = range(allValues);
  const slotCount = labels.length;
  const slotWidth = (x1 - x0) / Math.max(slotCount, 1);
  const groupWidth = slotWidth * 0.78;
  const barWidth = groupWidth / Math.max(series.length, 1);

  return (
    <g>
      {/* Y axis baseline */}
      <line
        x1={x0}
        x2={x1}
        y1={y1}
        y2={y1}
        className={styles.axis}
      />
      {/* X axis */}
      <line
        x1={x0}
        x2={x0}
        y1={y0}
        y2={y1}
        className={styles.axis}
      />
      {labels.map((label, slotIdx) => {
        const slotX = x0 + slotIdx * slotWidth + (slotWidth - groupWidth) / 2;
        return series.map((s, seriesIdx) => {
          const value = s.values[slotIdx];
          if (value === undefined) return null;
          const isHidden = handlers.hiddenSeries.has(seriesIdx);
          if (isHidden) return null;
          const bx = slotX + seriesIdx * barWidth;
          const by = yScale(value, min, max);
          const bh = y1 - by;
          const selected = isPointSelected(
            handlers.selectedPoint,
            seriesIdx,
            slotIdx,
          );
          return (
            <g key={`bar-${slotIdx}-${seriesIdx}`}>
              <rect
                x={bx}
                y={by}
                width={Math.max(barWidth - 1, 1)}
                height={Math.max(bh, 0)}
                className={`${styles.bar}${selected ? ` ${styles.barSelected}` : ''}`}
                rx={1.5}
                role="button"
                tabIndex={0}
                aria-label={pointAriaLabel(s.name, label, value)}
                aria-selected={selected}
                data-testid={`result-renderer-chart-bar-${seriesIdx}-${slotIdx}`}
                onClick={() => handlers.onPointClick(seriesIdx, slotIdx)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handlers.onPointClick(seriesIdx, slotIdx);
                  }
                }}
                onMouseEnter={() =>
                  handlers.onPointEnter(seriesIdx, slotIdx)
                }
                onMouseLeave={handlers.onPointLeave}
                onFocus={() => handlers.onPointEnter(seriesIdx, slotIdx)}
                onBlur={handlers.onPointLeave}
              >
                <title>{`${label} · ${s.name}: ${value}`}</title>
              </rect>
              {barWidth >= 18 && (
                <text
                  x={bx + barWidth / 2}
                  y={by - 3}
                  className={styles.barLabel}
                  textAnchor="middle"
                >
                  {value}
                </text>
              )}
            </g>
          );
        });
      })}
      {labels.map((label, slotIdx) => {
        const cx = x0 + slotIdx * slotWidth + slotWidth / 2;
        return (
          <text
            key={`xt-${slotIdx}`}
            x={cx}
            y={y1 + 14}
            className={styles.tickLabel}
            textAnchor="middle"
          >
            {label}
          </text>
        );
      })}
      {/* In-SVG legend text mirrors the interactive DOM <button>
          legend. The DOM buttons carry the real a11y + keyboard
          behaviour; these <text>s keep series names discoverable
          inside the <svg> so screen readers that walk the
          graphic still see them. Marked aria-hidden so SR does
          not double-announce. */}
      <g
        transform={`translate(${x0}, ${VIEWBOX_H - 16})`}
        aria-hidden="true"
        data-testid="result-renderer-chart-legend-svg"
      >
        {series.map((s, idx) => (
          <g key={`legend-svg-${idx}`} transform={`translate(${idx * 110}, 0)`}>
            <rect
              x={0}
              y={-8}
              width={10}
              height={10}
              className={styles.legendSwatch}
              rx={1.5}
            />
            <text x={14} y={0} className={styles.legendText}>
              {s.name}
            </text>
          </g>
        ))}
      </g>
      <title>{title}</title>
    </g>
  );
}

function renderLineChart(
  payload: LinePayload,
  title: string,
  handlers: InteractionHandlers,
): ReactNode {
  const { xLabels, series } = payload;
  const { x0, x1, y0, y1 } = plotBox();

  const allValues = series.flatMap((s) => s.values);
  const [min, max] = range(allValues);
  const pointCount = xLabels.length;
  const dx = (x1 - x0) / Math.max(pointCount - 1, 1);

  return (
    <g>
      {/* X axis */}
      <line
        x1={x0}
        x2={x1}
        y1={y1}
        y2={y1}
        className={styles.axis}
      />
      {/* Y axis */}
      <line
        x1={x0}
        x2={x0}
        y1={y0}
        y2={y1}
        className={styles.axis}
      />
      {series.map((s, seriesIdx) => {
        const isHidden = handlers.hiddenSeries.has(seriesIdx);
        if (isHidden) {
          // Render nothing for a hidden series so its polyline
          // and dots are not visible at all. Its legend button
          // remains so the user can re-enable it.
          return null;
        }
        const points = s.values.map((v, idx) => {
          const px = x0 + idx * dx;
          const py = yScale(v, min, max);
          return { px, py, v, label: xLabels[idx] ?? '' };
        });
        const polyline = points.map((p) => `${p.px},${p.py}`).join(' ');
        return (
          <g key={`line-${seriesIdx}`}>
            <polyline
              points={polyline}
              className={styles.line}
              fill="none"
            />
            {points.map((p, idx) => {
              const selected = isPointSelected(
                handlers.selectedPoint,
                seriesIdx,
                idx,
              );
              return (
                <circle
                  key={`dot-${seriesIdx}-${idx}`}
                  cx={p.px}
                  cy={p.py}
                  r={selected ? 4.5 : 2.5}
                  className={`${styles.dot}${selected ? ` ${styles.dotSelected}` : ''}`}
                  role="button"
                  tabIndex={0}
                  aria-label={pointAriaLabel(s.name, p.label, p.v)}
                  aria-selected={selected}
                  data-testid={`result-renderer-chart-dot-${seriesIdx}-${idx}`}
                  onClick={() => handlers.onPointClick(seriesIdx, idx)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handlers.onPointClick(seriesIdx, idx);
                    }
                  }}
                  onMouseEnter={() =>
                    handlers.onPointEnter(seriesIdx, idx)
                  }
                  onMouseLeave={handlers.onPointLeave}
                  onFocus={() => handlers.onPointEnter(seriesIdx, idx)}
                  onBlur={handlers.onPointLeave}
                >
                  <title>{`${p.label} · ${s.name}: ${p.v}`}</title>
                </circle>
              );
            })}
          </g>
        );
      })}
      {xLabels.map((label, idx) => {
        const cx = x0 + idx * dx;
        return (
          <text
            key={`xt-${idx}`}
            x={cx}
            y={y1 + 14}
            className={styles.tickLabel}
            textAnchor="middle"
          >
            {label}
          </text>
        );
      })}
      {/* In-SVG legend text mirrors the interactive DOM <button>
          legend. The DOM buttons carry the real a11y + keyboard
          behaviour; these <text>s keep series names discoverable
          inside the <svg> so screen readers that walk the
          graphic still see them. Marked aria-hidden so SR does
          not double-announce. */}
      <g
        transform={`translate(${x0}, ${VIEWBOX_H - 16})`}
        aria-hidden="true"
        data-testid="result-renderer-chart-legend-svg"
      >
        {series.map((s, idx) => (
          <g key={`legend-svg-${idx}`} transform={`translate(${idx * 110}, 0)`}>
            <rect
              x={0}
              y={-8}
              width={10}
              height={10}
              className={styles.legendSwatch}
              rx={1.5}
            />
            <text x={14} y={0} className={styles.legendText}>
              {s.name}
            </text>
          </g>
        ))}
      </g>
      <title>{title}</title>
    </g>
  );
}