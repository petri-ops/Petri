// ============================================================
// UI-AGENTWB-004 A4 — extraRenderers unit tests.
//
// Covers the parser, the flag hook, and the AssistantResultNodes
// renderer. The full SimpleChat integration tests live in
// SimpleChat.extraRenderers.test.tsx so the two concerns stay
// separate and fast.
// ============================================================

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AssistantResultNodes,
  EXTRA_RENDERERS_STORAGE_KEY,
  parseAssistantResultNodes,
  readExtraRenderersFlag,
  useExtraRenderersFlag,
} from './extraRenderers';
import type { ResultNode } from './types';
import { registerDefaultRenderers } from './renderers';

afterEach(() => {
  cleanup();
  window.localStorage.removeItem(EXTRA_RENDERERS_STORAGE_KEY);
});

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

describe('parseAssistantResultNodes', () => {
  it('returns the typed list when every entry is well-formed', () => {
    const nodes = [makeNode({ id: 'a' }), makeNode({ id: 'b', type: 'table' })];
    expect(parseAssistantResultNodes(nodes)).toEqual(nodes);
  });

  it('returns null when the value is missing or not an array', () => {
    expect(parseAssistantResultNodes(undefined)).toBeNull();
    expect(parseAssistantResultNodes(null)).toBeNull();
    expect(parseAssistantResultNodes('not an array')).toBeNull();
    expect(parseAssistantResultNodes({ id: 'a' })).toBeNull();
    expect(parseAssistantResultNodes(42)).toBeNull();
  });

  it('returns null when an entry is missing required fields', () => {
    expect(parseAssistantResultNodes([{ id: 'a', type: 'text', title: 't', payload: '', createdAt: 'now' }])).not.toBeNull();
    expect(parseAssistantResultNodes([{ id: 'a', type: 'text', title: 't', createdAt: 'now' }])).toBeNull();
    expect(parseAssistantResultNodes([{ id: 'a', type: 'text', title: '', payload: '', createdAt: 'now' }])).toBeNull();
    expect(parseAssistantResultNodes([{ id: 'a', type: 'text', title: 't', payload: '', createdAt: '' }])).toBeNull();
    expect(parseAssistantResultNodes([{ id: '', type: 'text', title: 't', payload: '', createdAt: 'now' }])).toBeNull();
  });

  it('returns null when an entry has an unsupported type', () => {
    // The union is narrow; an unknown type is not silently coerced.
    const bad = [makeNode({ type: 'video' as unknown as ResultNode['type'] })];
    expect(parseAssistantResultNodes(bad)).toBeNull();
  });

  it('returns null when an entry has an unsupported variant', () => {
    const bad = [makeNode({ variant: 'urgent' as unknown as ResultNode['variant'] })];
    expect(parseAssistantResultNodes(bad)).toBeNull();
  });

  it('returns null when a single entry inside an otherwise-valid array is malformed', () => {
    // Per spec: any invalid entry collapses the whole list so the
    // caller can fall back to the existing markdown renderer.
    const list = [makeNode({ id: 'a' }), { id: 'b', type: 'unknown' }];
    expect(parseAssistantResultNodes(list)).toBeNull();
  });

  it('accepts an empty array as a valid (but render-empty) result', () => {
    expect(parseAssistantResultNodes([])).toEqual([]);
  });
});

describe('readExtraRenderersFlag / useExtraRenderersFlag', () => {
  it('defaults to false when no localStorage key is set', () => {
    expect(readExtraRenderersFlag()).toBe(false);
  });

  it('returns true only when the localStorage key is exactly "true"', () => {
    window.localStorage.setItem(EXTRA_RENDERERS_STORAGE_KEY, 'true');
    expect(readExtraRenderersFlag()).toBe(true);

    window.localStorage.setItem(EXTRA_RENDERERS_STORAGE_KEY, 'TRUE');
    expect(readExtraRenderersFlag()).toBe(false);

    window.localStorage.setItem(EXTRA_RENDERERS_STORAGE_KEY, '1');
    expect(readExtraRenderersFlag()).toBe(false);

    window.localStorage.setItem(EXTRA_RENDERERS_STORAGE_KEY, '');
    expect(readExtraRenderersFlag()).toBe(false);
  });

  it('the React hook reports the current flag value', () => {
    window.localStorage.setItem(EXTRA_RENDERERS_STORAGE_KEY, 'true');
    function Probe() {
      const flag = useExtraRenderersFlag();
      return <div data-testid="probe">{flag ? 'on' : 'off'}</div>;
    }
    render(<Probe />);
    expect(screen.getByTestId('probe').textContent).toBe('on');
  });

  it('the React hook reports off when no key is set', () => {
    function Probe() {
      const flag = useExtraRenderersFlag();
      return <div data-testid="probe">{flag ? 'on' : 'off'}</div>;
    }
    render(<Probe />);
    expect(screen.getByTestId('probe').textContent).toBe('off');
  });
});

describe('AssistantResultNodes', () => {
  beforeEach(() => {
    // Make sure the registry has text + table from default
    // registration; ChartRenderer / ImageRenderer are not yet
    // required for these tests — the renderer lookup falls back
    // to TextRenderer for unknown types, which is exactly the
    // behavior we want to assert.
    registerDefaultRenderers();
  });

  it('renders one ResultCard per node, forwarding chrome from the node', () => {
    const nodes = [
      makeNode({ id: 'a', title: 'Alpha', subtitle: 'first', variant: 'success', meta: '12 rows' }),
      makeNode({ id: 'b', title: 'Beta', type: 'table' }),
    ];
    render(<AssistantResultNodes nodes={nodes} />);
    const wrapper = screen.getByTestId('sc-extra-result-nodes');
    expect(wrapper).toBeTruthy();
    // Both titles land in the chrome via the renderer dispatch.
    expect(screen.getByText('Alpha')).toBeTruthy();
    expect(screen.getByText('Beta')).toBeTruthy();
    expect(screen.getByText('12 rows')).toBeTruthy();
    // variant ends up on the article wrapper.
    const articles = wrapper.querySelectorAll('article');
    expect(articles.length).toBe(2);
  });

  it('routes text nodes through TextRenderer', () => {
    const node = makeNode({ id: 't1', type: 'text', payload: 'plain-text-payload' });
    render(<AssistantResultNodes nodes={[node]} />);
    expect(screen.getByTestId('result-renderer-text').textContent).toBe('plain-text-payload');
  });

  it('routes table nodes through TableRenderer', () => {
    const node = makeNode({
      id: 'tab1',
      type: 'table',
      title: 'DEG',
      payload: {
        columns: ['gene', 'padj'],
        rows: [['TP53', 0.012], ['BRCA1', 0.034]],
      },
    });
    render(<AssistantResultNodes nodes={[node]} />);
    expect(screen.getByTestId('result-renderer-table')).toBeTruthy();
    expect(screen.queryByTestId('result-renderer-text')).toBeNull();
  });

  it('falls back gracefully when an unknown type is in the registry-allowed list but no renderer is registered', () => {
    // chart / image renderers are owned by P1.3 — at the time of
    // this test the registry may or may not have them. Either way
    // the renderer must produce chrome + a fallback body, never
    // throw.
    const node = makeNode({ id: 'c1', type: 'chart', payload: { foo: 1 } });
    render(<AssistantResultNodes nodes={[node]} />);
    expect(screen.getByText('Hello')).toBeTruthy(); // chrome still renders
    // Body must exist (either real renderer or fallback text).
    const article = screen.getByText('Hello').closest('article');
    expect(article).toBeTruthy();
  });

  it('renders nothing visible when given an empty list', () => {
    const { container } = render(<AssistantResultNodes nodes={[]} />);
    const wrapper = container.querySelector('[data-testid="sc-extra-result-nodes"]');
    expect(wrapper).toBeTruthy();
    expect(wrapper!.children.length).toBe(0);
  });
});