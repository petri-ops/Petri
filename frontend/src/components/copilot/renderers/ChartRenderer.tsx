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
//     --biof3-* design tokens so light/dark themes stay aligned
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
// This renderer is intentionally a pure presentational
// component; no interactivity, no axes tooltip, no zoom (P2+
// can layer those via context).
// ============================================================

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

function renderBarChart(payload: BarPayload, title: string): ReactNode {
  const { labels, series } = payload;
  const { x0, x1, y0, y1 } = plotBox();

  // Each series shares the same X slots; every series is drawn
  // as a side-by-side group of bars. Auto-scale Y across ALL
  // series values so the largest bar in any series reaches the
  // top of the plot area.
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
          const bx = slotX + seriesIdx * barWidth;
          const by = yScale(value, min, max);
          const bh = y1 - by;
          return (
            <g key={`bar-${slotIdx}-${seriesIdx}`}>
              <rect
                x={bx}
                y={by}
                width={Math.max(barWidth - 1, 1)}
                height={Math.max(bh, 0)}
                className={styles.bar}
                rx={1.5}
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
      {/* Legend with single-color series squares + names */}
      <g transform={`translate(${x0}, ${VIEWBOX_H - 16})`}>
        {series.map((s, idx) => (
          <g key={`legend-${idx}`} transform={`translate(${idx * 110}, 0)`}>
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

function renderLineChart(payload: LinePayload, title: string): ReactNode {
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
            {points.map((p, idx) => (
              <circle
                key={`dot-${seriesIdx}-${idx}`}
                cx={p.px}
                cy={p.py}
                r={2.5}
                className={styles.dot}
              >
                <title>{`${p.label} · ${s.name}: ${p.v}`}</title>
              </circle>
            ))}
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
      {/* Legend */}
      <g transform={`translate(${x0}, ${VIEWBOX_H - 16})`}>
        {series.map((s, idx) => (
          <g key={`legend-${idx}`} transform={`translate(${idx * 110}, 0)`}>
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

  const kind = payload.kind;
  const title = `${node.title} (${kind})`;

  return (
    <div
      className={styles.wrapper}
      data-testid="result-renderer-chart"
      data-result-id={node.id}
      data-chart-kind={kind}
      data-series-count={
        payload.series.length /* series/label count lives in JSON for full audit */
      }
      role="img"
      aria-label={`Chart: ${kind}`}
    >
      <svg
        className={styles.svg}
        viewBox={`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`}
        preserveAspectRatio="xMidYMid meet"
        focusable="false"
      >
        {kind === 'bar'
          ? renderBarChart(payload, title)
          : renderLineChart(payload, title)}
      </svg>
    </div>
  );
}