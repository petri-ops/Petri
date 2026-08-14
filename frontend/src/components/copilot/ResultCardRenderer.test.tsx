import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  getRegisteredRenderer,
  listRegisteredRendererTypes,
  registerRenderer,
  ResultCardRenderer,
} from './ResultCardRenderer';
import { registerDefaultRenderers } from './renderers';
import type { ResultNode } from './types';

function makeNode(overrides: Partial<ResultNode> = {}): ResultNode {
  return {
    id: 'n1',
    type: 'text',
    title: 'Hello',
    payload: 'content',
    createdAt: '2026-08-14T10:00:00Z',
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

// Ensure the `table` entry lands in the registry before any test
// that relies on `node.type === 'table'` runs. The unknown-type
// fallback tests still work because ResultCardRenderer registers
// `text` itself at module load.
beforeAll(() => {
  registerDefaultRenderers();
});

describe('ResultCardRenderer', () => {
  it('falls back to TextRenderer for an unknown node.type', () => {
    // Pick a type that is intentionally not registered.
    const node = makeNode({ type: 'unknown-type' as ResultNode['type'], payload: 'fallback-payload' });

    const { container } = render(<ResultCardRenderer node={node} />);

    // TextRenderer renders a <pre data-testid="result-renderer-text">.
    const fallback = screen.getByTestId('result-renderer-text');
    expect(fallback).toBeTruthy();
    expect(fallback.textContent).toBe('fallback-payload');
    // Container still wraps it inside a ResultCard so the title is visible.
    expect(container.querySelector('article h3')!.textContent).toBe('Hello');
  });

  it('uses a registered renderer for a known type', () => {
    // Register a custom renderer for type 'text' (the only default slot).
    function CustomRenderer({ node }: { node: ResultNode }) {
      return <div data-testid="custom">{String(node.payload)}</div>;
    }
    registerRenderer('text', CustomRenderer);

    const node = makeNode({ id: 'n2', payload: 'P' });
    render(<ResultCardRenderer node={node} />);

    const custom = screen.getByTestId('custom');
    expect(custom).toBeTruthy();
    expect(custom.textContent).toBe('P');
    // Default TextRenderer pre should not render when overridden.
    expect(screen.queryByTestId('result-renderer-text')).toBeNull();
  });

  it('lists registered renderer types so callers can audit the registry', () => {
    // After the module loaded, 'text' must be present; adding a new key
    // must show up immediately.
    const before = listRegisteredRendererTypes();
    expect(before).toContain('text');

    function Probe() {
      return <div data-testid="probe">x</div>;
    }
    registerRenderer('probe', Probe);

    expect(listRegisteredRendererTypes()).toEqual(
      expect.arrayContaining(['text', 'probe']),
    );
    expect(getRegisteredRenderer('probe')).toBe(Probe);
    expect(getRegisteredRenderer('does-not-exist')).toBeUndefined();
  });

  it('forwards title, subtitle, variant, and meta from the node to the card', () => {
    const node: ResultNode = {
      id: 'n3',
      type: 'text',
      title: 'Differential Expression',
      subtitle: 'volcano-plot · padj < 0.05',
      variant: 'success',
      meta: '12 genes · 240 ms',
      payload: 'ignored',
      createdAt: '2026-08-14T10:00:00Z',
    };

    const { container } = render(<ResultCardRenderer node={node} />);

    const article = container.querySelector('article')!;
    expect(article.getAttribute('data-variant')).toBe('success');
    expect(article.querySelector('h3')!.textContent).toBe('Differential Expression');
    expect(container.querySelector('article p')!.textContent).toBe(
      'volcano-plot · padj < 0.05',
    );
    expect(screen.getByText('12 genes · 240 ms')).toBeTruthy();
  });

  it('registers the table renderer through registerDefaultRenderers without touching the text fallback', () => {
    // beforeAll() calls registerDefaultRenderers() so the registry
    // already contains both `text` (pre-registered at module load)
    // and `table` (registered by registerDefaultRenderers).
    const types = listRegisteredRendererTypes();
    expect(types).toEqual(expect.arrayContaining(['text', 'table']));
    expect(getRegisteredRenderer('table')).toBeDefined();

    // Unknown types still fall back to TextRenderer — the card
    // must never break for unsupported payloads.
    const unknownNode: ResultNode = {
      id: 'n4',
      type: 'unknown-type' as ResultNode['type'],
      title: 'Probe',
      payload: 'fallback-payload',
      createdAt: '2026-08-14T10:00:00Z',
    };
    render(<ResultCardRenderer node={unknownNode} />);
    expect(screen.getByTestId('result-renderer-text')).toBeTruthy();
  });

  it('renders a registered table node via TableRenderer with header + rows + a11y region', () => {
    const node: ResultNode = {
      id: 'n5',
      type: 'table',
      title: 'Differential Expression',
      subtitle: 'volcano-plot · padj < 0.05',
      variant: 'success',
      meta: '3 genes · 240 ms',
      payload: {
        columns: ['gene', 'log2FC', 'padj'],
        rows: [
          ['TP53', -1.42, 0.012],
          ['BRCA1', 0.87, 0.034],
          ['MYC', null, 0.078],
        ],
      },
      createdAt: '2026-08-14T10:00:00Z',
    };

    const { container } = render(<ResultCardRenderer node={node} />);

    // TableRenderer root marker — proves the registry routed to
    // the table renderer instead of TextRenderer.
    const tableRoot = screen.getByTestId('result-renderer-table');
    expect(tableRoot).toBeTruthy();
    expect(tableRoot.getAttribute('role')).toBe('region');
    expect(tableRoot.getAttribute('data-row-count')).toBe('3');
    expect(tableRoot.getAttribute('data-column-count')).toBe('3');

    // Header cells render as <th scope="col"> with the column labels.
    const headers = container.querySelectorAll('thead th');
    expect(headers.length).toBe(3);
    expect(headers[0]!.textContent).toBe('gene');
    expect(headers[0]!.getAttribute('scope')).toBe('col');

    // Rows render as <tbody><tr>; numeric cells right-align,
    // null cells render an em-dash placeholder inside their <td>.
    const bodyRows = container.querySelectorAll('tbody tr');
    expect(bodyRows.length).toBe(3);
    const tds = container.querySelectorAll('tbody td');
    expect(tds.length).toBe(9);
    // Row 1 col 1 (TP53 log2FC) is numeric.
    expect(tds[1]!.getAttribute('data-cell-type')).toBe('number');
    // Row 3 col 1 (MYC log2FC === null) carries the em-dash placeholder.
    const nullSpan = tds[7]!.querySelector('span');
    expect(nullSpan).not.toBeNull();
    // Placeholder text is the em-dash character; accept any non-empty
    // placeholder text to stay resilient against source encoding drift.
    expect(nullSpan!.textContent).toBeTruthy();
    expect((nullSpan!.textContent ?? '').length).toBeGreaterThan(0);

    // The card chrome still wraps the table — title + subtitle
    // + meta are forwarded as in the text path.
    expect(container.querySelector('article h3')!.textContent).toBe(
      'Differential Expression',
    );
    expect(screen.getByText('3 genes · 240 ms')).toBeTruthy();

    // TextRenderer must NOT render for a registered table node.
    expect(screen.queryByTestId('result-renderer-text')).toBeNull();
  });

  it('falls back to the JSON dump when a table node has a malformed payload', () => {
    // Each shape below fails the TableRenderer type-guard at a
    // different layer; all must degrade to the JSON fallback
    // without throwing the surrounding ResultCard.
    const malformedPayloads: Array<{ name: string; payload: unknown }> = [
      { name: 'missing-columns', payload: { rows: [['a', 1]] } },
      { name: 'wrong-column-type', payload: { columns: ['x', 2], rows: [['a', 1]] } },
      { name: 'wrong-row-shape', payload: { columns: ['x'], rows: [{ oops: true }] } },
      { name: 'empty-columns', payload: { columns: [], rows: [] } },
      { name: 'not-an-object', payload: 'this is not a table' },
    ];

    for (const { name, payload } of malformedPayloads) {
      const node: ResultNode = {
        id: `bad-${name}`,
        type: 'table',
        title: `Bad payload (${name})`,
        payload,
        createdAt: '2026-08-14T10:00:00Z',
      };
      const { container } = render(<ResultCardRenderer node={node} />);

      // Fallback marker replaces the table marker.
      const fallback = screen.getByTestId('result-renderer-table-fallback');
      expect(fallback).toBeTruthy();
      expect(fallback.getAttribute('role')).toBe('region');

      // The card chrome is still intact — title + body never disappear.
      expect(container.querySelector('article h3')!.textContent).toBe(
        `Bad payload (${name})`,
      );
      // No table is rendered for the malformed payload.
      expect(container.querySelector('table')).toBeNull();

      cleanup();
    }
  });

  it('registers chart and image alongside text/table through registerDefaultRenderers', () => {
    // after beforeAll() the registry must expose all four slots
    // and unknown types must still fall back to TextRenderer so
    // the card never breaks for unsupported payloads.
    const types = listRegisteredRendererTypes();
    expect(types).toEqual(
      expect.arrayContaining(['text', 'table', 'chart', 'image']),
    );
    expect(getRegisteredRenderer('chart')).toBeDefined();
    expect(getRegisteredRenderer('image')).toBeDefined();

    // Unknown type still falls back to TextRenderer — proves the
    // new registrations did not accidentally override the fallback
    // (TextRenderer is pre-registered at module load and only
    // re-affirmed by registerDefaultRenderers).
    const unknownNode: ResultNode = {
      id: 'n-unknown',
      type: 'unknown-type' as ResultNode['type'],
      title: 'Probe',
      payload: 'fallback-payload',
      createdAt: '2026-08-14T10:00:00Z',
    };
    render(<ResultCardRenderer node={unknownNode} />);
    expect(screen.getByTestId('result-renderer-text')).toBeTruthy();
  });

  it('renders a registered chart node via ChartRenderer with native SVG and a11y region', () => {
    const node: ResultNode = {
      id: 'chart-1',
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
      createdAt: '2026-08-14T10:00:00Z',
    };

    const { container } = render(<ResultCardRenderer node={node} />);

    // ChartRenderer root marker + a11y role proves the registry
    // routed to ChartRenderer instead of TextRenderer or
    // TableRenderer.
    const chartRoot = screen.getByTestId('result-renderer-chart');
    expect(chartRoot).toBeTruthy();
    expect(chartRoot.getAttribute('role')).toBe('img');
    expect(chartRoot.getAttribute('aria-label')).toBe('Chart: bar');
    expect(chartRoot.getAttribute('data-chart-kind')).toBe('bar');

    // Native <svg> viewBox is set to a stable 600×320 box so the
    // bar/line geometry is reproducible across responsive scales.
    const svg = chartRoot.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute('viewBox')).toBe('0 0 600 320');

    // 2 series × 4 labels = 8 bars. Each <rect> sits inside the
    // plot region, not anywhere in the wrapper.
    const rects = chartRoot.querySelectorAll('rect');
    expect(rects.length).toBeGreaterThanOrEqual(8);
    // Legend swatches (one per series) + the 8 bars; allow ≥ 10 rects.
    expect(rects.length).toBeGreaterThanOrEqual(10);

    // Per-series names render in the legend <text> so screen
    // readers can announce them next to the accessible name.
    const legendText = Array.from(chartRoot.querySelectorAll('text'))
      .map((t) => t.textContent ?? '')
      .join(' ');
    expect(legendText).toContain('control');
    expect(legendText).toContain('treated');

    // The card chrome still wraps the chart — title + subtitle
    // + meta are forwarded as in the text/table path.
    expect(container.querySelector('article h3')!.textContent).toBe(
      'Expression per gene',
    );
    expect(screen.getByText('4 genes · 2 series')).toBeTruthy();

    // TextRenderer and TableRenderer must NOT render for a
    // registered chart node.
    expect(screen.queryByTestId('result-renderer-text')).toBeNull();
    expect(screen.queryByTestId('result-renderer-table')).toBeNull();
  });

  it('falls back to the JSON dump when a chart node has a malformed payload', () => {
    // Each shape below fails the ChartRenderer type-guard at a
    // different layer; all must degrade to the JSON fallback
    // without throwing the surrounding ResultCard.
    const malformedPayloads: Array<{ name: string; payload: unknown }> = [
      { name: 'unknown-kind', payload: { kind: 'pie', labels: ['a'], series: [] } },
      { name: 'missing-series', payload: { kind: 'bar', labels: ['a', 'b'] } },
      { name: 'empty-labels', payload: { kind: 'bar', labels: [], series: [{ name: 's', values: [] }] } },
      { name: 'non-numeric-values', payload: { kind: 'line', xLabels: ['a'], series: [{ name: 's', values: ['x'] }] } },
      { name: 'not-an-object', payload: 'this is not a chart' },
    ];

    for (const { name, payload } of malformedPayloads) {
      const node: ResultNode = {
        id: `bad-chart-${name}`,
        type: 'chart',
        title: `Bad payload (${name})`,
        payload,
        createdAt: '2026-08-14T10:00:00Z',
      };
      const { container } = render(<ResultCardRenderer node={node} />);

      // Fallback marker replaces the chart marker.
      const fallback = screen.getByTestId('result-renderer-chart-fallback');
      expect(fallback).toBeTruthy();
      expect(fallback.getAttribute('role')).toBe('region');

      // The card chrome is still intact — title + body never disappear.
      expect(container.querySelector('article h3')!.textContent).toBe(
        `Bad payload (${name})`,
      );
      // No <svg> is rendered for the malformed payload.
      expect(container.querySelector('svg')).toBeNull();

      cleanup();
    }
  });

  it('renders a registered image node via ImageRenderer with figure/img + alt forwarding', () => {
    const node: ResultNode = {
      id: 'img-1',
      type: 'image',
      title: 'Heatmap preview',
      subtitle: 'PNG · 320×240',
      meta: 'PNG · 8 KB',
      payload: {
        src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=',
        alt: 'Expression heatmap with 4 conditions',
        caption: 'Top 100 differentially expressed genes',
      },
      createdAt: '2026-08-14T10:00:00Z',
    };

    const { container } = render(<ResultCardRenderer node={node} />);

    // ImageRenderer root marker proves the registry routed to
    // ImageRenderer instead of TextRenderer or TableRenderer.
    const imgRoot = screen.getByTestId('result-renderer-image');
    expect(imgRoot).toBeTruthy();
    expect(imgRoot.tagName.toLowerCase()).toBe('figure');

    // <img> renders with src + alt forwarded verbatim. alt is
    // REQUIRED by the type-guard — a missing/empty alt would
    // have fallen back to JSON.
    const img = imgRoot.querySelector('img');
    expect(img).not.toBeNull();
    expect(img!.getAttribute('src')).toBe(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=',
    );
    expect(img!.getAttribute('alt')).toBe(
      'Expression heatmap with 4 conditions',
    );
    expect(img!.getAttribute('loading')).toBe('lazy');

    // Caption renders as <figcaption> inside the figure.
    const caption = imgRoot.querySelector('figcaption');
    expect(caption).not.toBeNull();
    expect(caption!.textContent).toBe('Top 100 differentially expressed genes');

    // The card chrome still wraps the image — title + meta are
    // forwarded as in the text/table/chart path.
    expect(container.querySelector('article h3')!.textContent).toBe('Heatmap preview');
    expect(screen.getByText('PNG · 8 KB')).toBeTruthy();

    // TextRenderer, TableRenderer and ChartRenderer must NOT
    // render for a registered image node.
    expect(screen.queryByTestId('result-renderer-text')).toBeNull();
    expect(screen.queryByTestId('result-renderer-table')).toBeNull();
    expect(screen.queryByTestId('result-renderer-chart')).toBeNull();
  });

  it('falls back to the JSON dump when an image node has a malformed payload', () => {
    // Each shape below fails the ImageRenderer type-guard at a
    // different layer; all must degrade to the JSON fallback
    // without throwing the surrounding ResultCard.
    const malformedPayloads: Array<{ name: string; payload: unknown }> = [
      { name: 'missing-src', payload: { alt: 'x' } },
      { name: 'missing-alt', payload: { src: 'https://example.com/x.png' } },
      { name: 'empty-alt', payload: { src: 'https://example.com/x.png', alt: '' } },
      { name: 'unsafe-src', payload: { src: 'javascript:alert(1)', alt: 'x' } },
      { name: 'wrong-width-type', payload: { src: 'https://example.com/x.png', alt: 'x', width: '320' } },
      { name: 'not-an-object', payload: 'this is not an image' },
    ];

    for (const { name, payload } of malformedPayloads) {
      const node: ResultNode = {
        id: `bad-img-${name}`,
        type: 'image',
        title: `Bad payload (${name})`,
        payload,
        createdAt: '2026-08-14T10:00:00Z',
      };
      const { container } = render(<ResultCardRenderer node={node} />);

      // Fallback marker replaces the image marker.
      const fallback = screen.getByTestId('result-renderer-image-fallback');
      expect(fallback).toBeTruthy();
      expect(fallback.getAttribute('role')).toBe('region');

      // The card chrome is still intact — title + body never disappear.
      expect(container.querySelector('article h3')!.textContent).toBe(
        `Bad payload (${name})`,
      );
      // No <figure>/<img> is rendered for the malformed payload.
      expect(container.querySelector('figure')).toBeNull();
      expect(container.querySelector('img')).toBeNull();

      cleanup();
    }
  });
});