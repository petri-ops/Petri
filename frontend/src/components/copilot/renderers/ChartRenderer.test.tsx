import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ResultNode } from '../types';
import { ChartRenderer } from './ChartRenderer';

function makeBarNode(): ResultNode {
  return {
    id: 'chart-p2-bar',
    type: 'chart',
    title: 'Expression per gene',
    subtitle: 'RNA-seq · counts',
    meta: '4 genes · 2 series',
    payload: {
      kind: 'bar',
      labels: ['TP53', 'BRCA1', 'MYC', 'EGFR'],
      series: [
        { name: 'control', values: [10, 20, 30, 40] },
        { name: 'treated', values: [12, 18, 35, 45] },
      ],
    },
    createdAt: '2026-08-15T10:00:00Z',
  };
}

function makeLineNode(): ResultNode {
  return {
    id: 'chart-p2-line',
    type: 'chart',
    title: 'Timecourse',
    subtitle: 'qPCR',
    meta: '4 timepoints · 2 series',
    payload: {
      kind: 'line',
      xLabels: ['0h', '6h', '12h', '24h'],
      series: [
        { name: 'control', values: [10, 12, 14, 16] },
        { name: 'treated', values: [8, 10, 12, 14] },
      ],
    },
    createdAt: '2026-08-15T10:00:00Z',
  };
}

afterEach(() => {
  cleanup();
});

describe('ChartRenderer — P2 interaction + a11y layer', () => {
  it('renders a <desc> element on the SVG root containing the series summary', () => {
    render(<ChartRenderer node={makeBarNode()} />);

    const desc = screen.getByTestId('result-renderer-chart-desc');
    expect(desc).toBeTruthy();
    // The <desc> text content is the human-readable summary
    // that screen readers announce instead of "Chart: bar".
    const text = desc.textContent ?? '';
    expect(text).toContain('Bar chart with 2 series');
    expect(text).toContain('control');
    expect(text).toContain('treated');
    expect(text).toContain('10, 20, 30, 40');
    expect(text).toContain('12, 18, 35, 45');
    expect(text).toContain("'TP53'");
    expect(text).toContain("'EGFR'");
  });

  it('renders a <desc> summary for a line chart with xLabels', () => {
    render(<ChartRenderer node={makeLineNode()} />);

    const desc = screen.getByTestId('result-renderer-chart-desc');
    const text = desc.textContent ?? '';
    expect(text).toContain('Line chart with 2 series');
    expect(text).toContain("'0h'");
    expect(text).toContain("'24h'");
    expect(text).toContain('10, 12, 14, 16');
  });

  it('attaches aria-label and tabIndex=0 to every bar data point', () => {
    render(<ChartRenderer node={makeBarNode()} />);

    // 2 series × 4 labels = 8 bars. Each must carry an
    // aria-label "{series} at {label}: {value}" so screen
    // readers can announce it, plus tabIndex=0 so keyboard
    // users can reach the point.
    for (let seriesIdx = 0; seriesIdx < 2; seriesIdx++) {
      const seriesName = seriesIdx === 0 ? 'control' : 'treated';
      const values = seriesIdx === 0
        ? [10, 20, 30, 40]
        : [12, 18, 35, 45];
      for (let slotIdx = 0; slotIdx < 4; slotIdx++) {
        const point = screen.getByTestId(
          `result-renderer-chart-bar-${seriesIdx}-${slotIdx}`,
        );
        expect(point.getAttribute('aria-label')).toBe(
          `${seriesName} at TP53, BRCA1, MYC, EGFR`.split(', ')[slotIdx] ===
            undefined
            ? ''
            : `${seriesName} at ${
                ['TP53', 'BRCA1', 'MYC', 'EGFR'][slotIdx]
              }: ${values[slotIdx]}`,
        );
        expect(point.getAttribute('tabindex')).toBe('0');
        // Default aria-selected=false before any click.
        expect(point.getAttribute('aria-selected')).toBe('false');
      }
    }
  });

  it('attaches aria-label and tabIndex=0 to every line-chart dot', () => {
    render(<ChartRenderer node={makeLineNode()} />);

    const labels = ['0h', '6h', '12h', '24h'];
    const values = [10, 12, 14, 16];
    for (let idx = 0; idx < labels.length; idx++) {
      const dot = screen.getByTestId(
        `result-renderer-chart-dot-0-${idx}`,
      );
      expect(dot.getAttribute('aria-label')).toBe(
        `control at ${labels[idx]}: ${values[idx]}`,
      );
      expect(dot.getAttribute('tabindex')).toBe('0');
    }
  });

  it('shows the tooltip on bar hover (series + x label + value)', () => {
    render(<ChartRenderer node={makeBarNode()} />);

    // Hovering a bar should surface the tooltip with the
    // expected series/x/value triple. The tooltip is a real
    // DOM <div> outside the <svg> with role="status".
    const bar = screen.getByTestId('result-renderer-chart-bar-0-1');
    fireEvent.mouseEnter(bar);

    const tooltip = screen.getByTestId('result-renderer-chart-tooltip');
    expect(tooltip).toBeTruthy();
    expect(tooltip.getAttribute('data-series-name')).toBe('control');
    expect(tooltip.getAttribute('data-x-label')).toBe('BRCA1');
    expect(tooltip.getAttribute('data-value')).toBe('20');
    // role=status + aria-live=polite so screen readers
    // announce the new value without stealing focus.
    expect(tooltip.getAttribute('role')).toBe('status');
  });

  it('shows the tooltip on line-chart hover', () => {
    render(<ChartRenderer node={makeLineNode()} />);

    const dot = screen.getByTestId('result-renderer-chart-dot-1-2');
    fireEvent.mouseEnter(dot);

    const tooltip = screen.getByTestId('result-renderer-chart-tooltip');
    expect(tooltip.getAttribute('data-series-name')).toBe('treated');
    expect(tooltip.getAttribute('data-x-label')).toBe('12h');
    expect(tooltip.getAttribute('data-value')).toBe('12');
  });

  it('hides the tooltip when the hovered bar loses pointer', () => {
    render(<ChartRenderer node={makeBarNode()} />);

    const bar = screen.getByTestId('result-renderer-chart-bar-0-0');
    fireEvent.mouseEnter(bar);
    expect(
      screen.queryByTestId('result-renderer-chart-tooltip'),
    ).not.toBeNull();

    fireEvent.mouseLeave(bar);
    expect(
      screen.queryByTestId('result-renderer-chart-tooltip'),
    ).toBeNull();
  });

  it('treats keyboard focus as equivalent to hover for the tooltip', () => {
    render(<ChartRenderer node={makeBarNode()} />);

    const bar = screen.getByTestId('result-renderer-chart-bar-1-3');
    // Focus the bar via tab/focus — no mouse involved.
    fireEvent.focus(bar);
    const tooltip = screen.getByTestId('result-renderer-chart-tooltip');
    expect(tooltip.getAttribute('data-series-name')).toBe('treated');
    expect(tooltip.getAttribute('data-x-label')).toBe('EGFR');
    expect(tooltip.getAttribute('data-value')).toBe('45');

    fireEvent.blur(bar);
    expect(
      screen.queryByTestId('result-renderer-chart-tooltip'),
    ).toBeNull();
  });

  it('clicking a legend button hides that series and flips aria-pressed', () => {
    render(<ChartRenderer node={makeBarNode()} />);

    const legend0 = screen.getByTestId('result-renderer-chart-legend-0');
    // Initially every series is visible and aria-pressed=false.
    expect(legend0.getAttribute('aria-pressed')).toBe('false');
    expect(
      screen.queryByTestId('result-renderer-chart-bar-0-0'),
    ).not.toBeNull();

    // Toggle the "control" series off.
    fireEvent.click(legend0);

    // aria-pressed flipped + every bar in series 0 must be gone
    // from the DOM. Series 1 must still be rendered.
    expect(legend0.getAttribute('aria-pressed')).toBe('true');
    expect(
      screen.queryByTestId('result-renderer-chart-bar-0-0'),
    ).toBeNull();
    expect(
      screen.queryByTestId('result-renderer-chart-bar-0-3'),
    ).toBeNull();
    expect(
      screen.queryByTestId('result-renderer-chart-bar-1-0'),
    ).not.toBeNull();

    // Click again — series comes back, aria-pressed restored.
    fireEvent.click(legend0);
    expect(legend0.getAttribute('aria-pressed')).toBe('false');
    expect(
      screen.queryByTestId('result-renderer-chart-bar-0-0'),
    ).not.toBeNull();
  });

  it('treats keyboard Enter / Space on the legend as equivalent to click', () => {
    render(<ChartRenderer node={makeBarNode()} />);

    const legend1 = screen.getByTestId('result-renderer-chart-legend-1');
    // Enter on the legend must toggle the "treated" series.
    fireEvent.keyDown(legend1, { key: 'Enter' });
    expect(legend1.getAttribute('aria-pressed')).toBe('true');
    expect(
      screen.queryByTestId('result-renderer-chart-bar-1-0'),
    ).toBeNull();

    fireEvent.keyDown(legend1, { key: ' ' });
    expect(legend1.getAttribute('aria-pressed')).toBe('false');
    expect(
      screen.queryByTestId('result-renderer-chart-bar-1-0'),
    ).not.toBeNull();
  });

  it('clicking a bar selects it (aria-selected=true + selected stroke class)', () => {
    render(<ChartRenderer node={makeBarNode()} />);

    const bar = screen.getByTestId('result-renderer-chart-bar-0-2');
    // Initial selection state.
    expect(bar.getAttribute('aria-selected')).toBe('false');

    fireEvent.click(bar);
    // The DOM node now reflects aria-selected=true.
    expect(bar.getAttribute('aria-selected')).toBe('true');

    // The selected stroke emphasis is applied as a CSS Module
    // class. The className token is hashed by Vite so we cannot
    // compare exact strings — but the class attribute must grow
    // (selected class is appended) AND must include a token
    // distinct from the baseline `.bar` class.
    const cls = bar.getAttribute('class') ?? '';
    const tokens = cls.split(/\s+/).filter(Boolean);
    expect(tokens.length).toBeGreaterThanOrEqual(2);
    expect(tokens.some((t) => t !== tokens[0])).toBe(true);
  });

  it('clicking the same bar a second time clears the selection', () => {
    render(<ChartRenderer node={makeBarNode()} />);

    const bar = screen.getByTestId('result-renderer-chart-bar-0-0');
    fireEvent.click(bar);
    expect(bar.getAttribute('aria-selected')).toBe('true');

    fireEvent.click(bar);
    expect(bar.getAttribute('aria-selected')).toBe('false');
  });

  it('hovering another point does not override the selected stroke', () => {
    render(<ChartRenderer node={makeBarNode()} />);

    const selected = screen.getByTestId('result-renderer-chart-bar-0-1');
    fireEvent.click(selected);
    expect(selected.getAttribute('aria-selected')).toBe('true');

    // Hover a different bar — the selected bar must still be
    // aria-selected=true (hover never overrides the selection
    // attribute, the selection class never flips back).
    const other = screen.getByTestId('result-renderer-chart-bar-1-2');
    fireEvent.mouseEnter(other);

    expect(selected.getAttribute('aria-selected')).toBe('true');
    expect(other.getAttribute('aria-selected')).toBe('false');
    // The tooltip just swaps to the new point.
    const tooltip = screen.getByTestId('result-renderer-chart-tooltip');
    expect(tooltip.getAttribute('data-series-name')).toBe('treated');
    expect(tooltip.getAttribute('data-x-label')).toBe('MYC');
  });

  it('keyboard Enter / Space on a data point toggles its selection', () => {
    render(<ChartRenderer node={makeBarNode()} />);

    const bar = screen.getByTestId('result-renderer-chart-bar-0-3');
    fireEvent.keyDown(bar, { key: 'Enter' });
    expect(bar.getAttribute('aria-selected')).toBe('true');

    fireEvent.keyDown(bar, { key: ' ' });
    expect(bar.getAttribute('aria-selected')).toBe('false');
  });

  it('does not attach interaction handlers to the fail-soft fallback path', () => {
    // Every P1.3 malformed payload must still render the JSON
    // fallback with NO <svg>, NO interactive <button>, NO
    // <desc>, NO tooltip — proving the interaction layer is
    // strictly scoped to the validated chart payload.
    const malformedPayloads: Array<{ name: string; payload: unknown }> = [
      { name: 'unknown-kind', payload: { kind: 'pie', labels: ['a'], series: [] } },
      { name: 'missing-series', payload: { kind: 'bar', labels: ['a', 'b'] } },
      { name: 'empty-labels', payload: { kind: 'bar', labels: [], series: [{ name: 's', values: [] }] } },
      { name: 'non-numeric-values', payload: { kind: 'line', xLabels: ['a'], series: [{ name: 's', values: ['x'] }] } },
      { name: 'not-an-object', payload: 'this is not a chart' },
    ];

    for (const { name, payload } of malformedPayloads) {
      const node: ResultNode = {
        id: `bad-${name}`,
        type: 'chart',
        title: `Bad (${name})`,
        payload,
        createdAt: '2026-08-15T10:00:00Z',
      };
      const { container } = render(<ChartRenderer node={node} />);

      const fallback = screen.getByTestId(
        'result-renderer-chart-fallback',
      );
      expect(fallback).toBeTruthy();
      // No interaction layer leaks into the fallback DOM.
      expect(container.querySelector('svg')).toBeNull();
      expect(container.querySelector('button')).toBeNull();
      expect(container.querySelector('[data-testid="result-renderer-chart-tooltip"]')).toBeNull();
      expect(container.querySelector('[data-testid="result-renderer-chart-desc"]')).toBeNull();
      expect(container.querySelector('[data-testid="result-renderer-chart-legend"]')).toBeNull();

      cleanup();
    }
  });
});