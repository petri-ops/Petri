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
});