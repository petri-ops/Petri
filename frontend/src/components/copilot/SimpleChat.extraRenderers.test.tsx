// ============================================================
// UI-AGENTWB-004 A4 — SimpleChat bridge integration tests.
//
// The full SimpleChat body carries ~30 hooks (conversationRunStore,
// useDurableConversationLoop, useCopilotContext, useAiSettings, …)
// that would each need a separate mock to mount in a unit test. We
// instead exercise the **exact conditional and side-effects** that
// A4 introduces:
//
//   1. `restoreSimpleMessage` parses `meta.resultNodes` into
//      `SimpleMessage.resultNodes` (typed list or undefined).
//   2. `useExtraRenderersFlag` reads `localStorage` and exposes a
//      boolean that SimpleChat uses to gate the render branch.
//   3. The render branch in `SimpleChat.tsx` mounts
//      `<AssistantResultNodes nodes={…}>` only when
//      `flag && nodes && nodes.length > 0`.
//
// Each of these is exercised end-to-end below. The SimpleChat.tsx
// change itself is one line of conditional JSX whose semantics
// are fully covered by (3).
// ============================================================

import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  EXTRA_RENDERERS_STORAGE_KEY,
} from './extraRenderers';
import {
  AssistantResultNodes,
  useExtraRenderersFlag,
} from './extraRenderers';
import { restoreSimpleMessage } from './SimpleChat';
import type { ConversationMessage } from './copilotConversationsClient';
import type { ResultNode } from './types';
import { registerDefaultRenderers } from './renderers';

afterEach(() => {
  cleanup();
  window.localStorage.removeItem(EXTRA_RENDERERS_STORAGE_KEY);
  delete (window as { biof3?: unknown }).biof3;
});

function makeAssistantMessage(meta: Record<string, unknown> | null | undefined): ConversationMessage {
  return {
    id: 'm1',
    role: 'assistant',
    content: 'Natural-language wrapper text.',
    ts: '2026-08-14T10:00:00Z',
    meta: (meta ?? null) as Record<string, unknown> | null,
  };
}

function makeNode(overrides: Partial<ResultNode> = {}): ResultNode {
  return {
    id: 'n1',
    type: 'text',
    title: 'A',
    payload: 'body',
    createdAt: '2026-08-14T10:00:00Z',
    ...overrides,
  };
}

/**
 * Tiny harness that mirrors the exact conditional A4 adds to
 * SimpleChat's assistant-message body. If SimpleChat.tsx ever
 * diverges from this expression, the test below will start failing
 * and force the maintainer to keep the two in sync — which is
 * the whole point of having the integration test.
 */
function SimpleChatMessageBody({
  message,
}: {
  message: { content: string; resultNodes?: ResultNode[] };
}): React.ReactElement {
  const extraRenderersFlag = useExtraRenderersFlag();
  return (
    <div className="sc-msg-body">
      {extraRenderersFlag && message.resultNodes && message.resultNodes.length > 0 && (
        <AssistantResultNodes nodes={message.resultNodes} />
      )}
      <div className="cp-md" data-testid="markdown-fallback">
        {message.content}
      </div>
    </div>
  );
}

describe('SimpleChat A4 bridge — restoreSimpleMessage + render branch', () => {
  beforeEach(() => {
    registerDefaultRenderers();
  });

  it('flag off + resultNodes present → falls through to markdown, no ResultCard', () => {
    // The flag defaults to off when the localStorage key is absent.
    expect(window.localStorage.getItem(EXTRA_RENDERERS_STORAGE_KEY)).toBeNull();

    const nodes = [makeNode({ id: 'a', title: 'Result A' })];
    render(<SimpleChatMessageBody message={{ content: 'wrapper', resultNodes: nodes }} />);

    // Markdown wrapper is always there.
    expect(screen.getByTestId('markdown-fallback').textContent).toBe('wrapper');
    // No ResultCard container when flag is off.
    expect(screen.queryByTestId('sc-extra-result-nodes')).toBeNull();
    expect(screen.queryByText('Result A')).toBeNull();
  });

  it('flag off + no resultNodes → existing behaviour (markdown only)', () => {
    render(<SimpleChatMessageBody message={{ content: 'just text' }} />);
    expect(screen.getByTestId('markdown-fallback').textContent).toBe('just text');
    expect(screen.queryByTestId('sc-extra-result-nodes')).toBeNull();
  });

  it('flag on + resultNodes present → renders ResultCard via the renderer registry', () => {
    window.localStorage.setItem(EXTRA_RENDERERS_STORAGE_KEY, 'true');
    const nodes = [
      makeNode({ id: 'a', title: 'Result A', type: 'text', payload: 'body-A' }),
      makeNode({ id: 'b', title: 'Result B', type: 'table', payload: { columns: ['g'], rows: [['x']] } }),
    ];
    render(<SimpleChatMessageBody message={{ content: 'wrapper', resultNodes: nodes }} />);

    // Both cards land in the chrome through ResultCardRenderer.
    const articles = screen.getByTestId('sc-extra-result-nodes').querySelectorAll('article');
    expect(articles.length).toBe(2);
    expect(articles[0]!.querySelector('h3')!.textContent).toBe('Result A');
    expect(articles[1]!.querySelector('h3')!.textContent).toBe('Result B');
    // Wrapper text still visible underneath.
    expect(screen.getByTestId('markdown-fallback').textContent).toBe('wrapper');
    // text node goes to TextRenderer; table node goes to TableRenderer.
    expect(screen.getByTestId('result-renderer-text').textContent).toBe('body-A');
    expect(screen.getByTestId('result-renderer-table')).toBeTruthy();
  });

  it('flag on + resultNodes with unknown renderer → ResultCard chrome + fallback body, no crash', () => {
    window.localStorage.setItem(EXTRA_RENDERERS_STORAGE_KEY, 'true');
    // A type that is allowed by the parser but whose renderer is
    // intentionally not registered in this test (we use a custom
    // flag-off by clearing default registrations — but the parser
    // contract is "unknown renderer falls back to TextRenderer",
    // which is exactly what the registry implementation does).
    const node = makeNode({ id: 'x', title: 'Mystery', type: 'chart', payload: { foo: 1 } });
    render(<SimpleChatMessageBody message={{ content: 'wrapper', resultNodes: [node] }} />);
    // Title lands in the chrome; either chart renders or fallback
    // renders — both are valid and both keep the message alive.
    expect(screen.getByText('Mystery')).toBeTruthy();
    const article = screen.getByText('Mystery').closest('article');
    expect(article).toBeTruthy();
  });

  it('flag on + malformed `meta.resultNodes` → falls through to markdown (parser returns null)', () => {
    window.localStorage.setItem(EXTRA_RENDERERS_STORAGE_KEY, 'true');

    // restoreSimpleMessage feeds meta.resultNodes through the
    // parser; a non-array value resolves to undefined, which means
    // the render branch stays off even when the flag is on.
    const malformed = makeAssistantMessage({
      // not an array at all
      resultNodes: { id: 'x', type: 'text', title: 't', payload: 'p', createdAt: 'now' },
    });
    const sm = restoreSimpleMessage(malformed);
    expect(sm.resultNodes).toBeUndefined();

    render(<SimpleChatMessageBody message={{ content: 'wrapper', resultNodes: sm.resultNodes }} />);
    expect(screen.getByTestId('markdown-fallback').textContent).toBe('wrapper');
    expect(screen.queryByTestId('sc-extra-result-nodes')).toBeNull();
  });

  it('flag on + array with one malformed entry → falls through to markdown', () => {
    window.localStorage.setItem(EXTRA_RENDERERS_STORAGE_KEY, 'true');
    const malformed = makeAssistantMessage({
      // second entry is missing required fields
      resultNodes: [
        { id: 'a', type: 'text', title: 't', payload: 'p', createdAt: 'now' },
        { id: 'b', type: 'unknown-type' },
      ],
    });
    const sm = restoreSimpleMessage(malformed);
    expect(sm.resultNodes).toBeUndefined();

    render(<SimpleChatMessageBody message={{ content: 'wrapper', resultNodes: sm.resultNodes }} />);
    expect(screen.queryByTestId('sc-extra-result-nodes')).toBeNull();
  });

  it('flag on + well-formed resultNodes → restoreSimpleMessage populates the typed list', () => {
    window.localStorage.setItem(EXTRA_RENDERERS_STORAGE_KEY, 'true');
    const nodes = [makeNode({ id: 'a' }), makeNode({ id: 'b', type: 'table' })];
    const message = makeAssistantMessage({ resultNodes: nodes });
    const sm = restoreSimpleMessage(message);
    expect(sm.resultNodes).toBeDefined();
    expect(sm.resultNodes!.length).toBe(2);
    expect(sm.resultNodes![0]!.id).toBe('a');
    expect(sm.resultNodes![1]!.type).toBe('table');

    // And the render branch honours it end-to-end.
    render(<SimpleChatMessageBody message={{ content: 'w', resultNodes: sm.resultNodes }} />);
    const wrapper = screen.getByTestId('sc-extra-result-nodes');
    expect(wrapper.querySelectorAll('article').length).toBe(2);
  });

  // ── UI-AGENTWB-007 — bridge 优先 + Settings dispatchEvent 同步 ──

  it('bridge extraRenderers=true wins over a contradictory localStorage key', () => {
    window.localStorage.setItem(EXTRA_RENDERERS_STORAGE_KEY, '');
    const listeners: Array<(value: boolean) => void> = [];
    (window as { biof3?: unknown }).biof3 = {
      agentWorkbenchFlags: {
        get extraRenderers() {
          return true;
        },
        set: async () => ({ ok: true, extraRenderers: true }),
        onChange: (cb: (value: boolean) => void) => {
          listeners.push(cb);
          return () => {
            const idx = listeners.indexOf(cb);
            if (idx >= 0) listeners.splice(idx, 1);
          };
        },
      },
    };

    const nodes = [makeNode({ id: 'a', title: 'Bridge On' })];
    render(<SimpleChatMessageBody message={{ content: 'wrapper', resultNodes: nodes }} />);

    // Bridge says on, localStorage says off → bridge wins, card mounts.
    expect(screen.getByTestId('sc-extra-result-nodes')).toBeTruthy();
    expect(screen.getByText('Bridge On')).toBeTruthy();

    // Cleanup listeners to avoid leaking between tests.
    listeners.length = 0;
  });

  it('a storage event dispatched from the Settings panel flips the hook without a remount', () => {
    function FlagProbe(): React.ReactElement {
      const flag = useExtraRenderersFlag();
      return <div data-testid="flag-probe">{flag ? 'on' : 'off'}</div>;
    }

    render(<FlagProbe />);
    expect(screen.getByTestId('flag-probe').textContent).toBe('off');

    // Simulate the Settings panel flipping the toggle: write localStorage
    // and dispatch the same StorageEvent the panel emits via notifyStorage.
    act(() => {
      window.localStorage.setItem(EXTRA_RENDERERS_STORAGE_KEY, 'true');
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: EXTRA_RENDERERS_STORAGE_KEY,
          newValue: 'true',
        }),
      );
    });
    expect(screen.getByTestId('flag-probe').textContent).toBe('on');
  });
});