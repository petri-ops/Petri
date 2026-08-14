import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getRegisteredRenderer,
  listRegisteredRendererTypes,
  registerRenderer,
  ResultCardRenderer,
} from './ResultCardRenderer';
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
});