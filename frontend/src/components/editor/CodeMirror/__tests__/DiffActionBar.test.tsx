/**
 * BLOCK-22-CODEMIRROR-INLINE-DIFF — DiffActionBar test
 *
 * Task 3 验证范围：
 * - mount 不抛错
 * - inline-diff 模式 + DiffRevision 含 hunks 时，3 个按钮渲染
 * - Accept All 点击 → apiRef.current.acceptAll() 被调
 * - Reject All 点击 → apiRef.current.rejectAll() 被调
 * - Review 点击 → apiRef.current.scrollToLine({ line: hunks[0].startLine }) 被调
 * - non-inline-diff 模式时按钮组不渲染（hidden via `return null`）
 *
 * 设计要点：
 * - 使用 spy EditorApi（构造一个 mock EditorApi），不依赖 CM6 mount
 *   避免 happy-dom + CM6 副作用；测试 DiffActionBar 的纯 UI 行为
 * - 直接 `render(<DiffActionBar apiRef={...} onError={...} />)` 挂载
 *   —— 因为 CodeMirrorEditor 的 parentRef mount 会拉起完整 CM6 链
 * - spy EditorApi 的 getMode / getDiffRevision / acceptAll / rejectAll / scrollToLine
 */

import React, { useRef } from 'react';
import { cleanup, render, fireEvent, act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DiffActionBar } from '../DiffActionBar';
import type { DiffHunk, DiffRevision, EditorApi, EditorMode } from '../types';

// ===== Spy EditorApi 工厂 =====

interface SpyApiOptions {
  mode?: EditorMode;
  revision?: DiffRevision | null;
  hunks?: DiffHunk[];
}

function createSpyApi(options: SpyApiOptions = {}): {
  api: EditorApi;
  spies: {
    getValue: ReturnType<typeof vi.fn>;
    setValue: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
    setMode: ReturnType<typeof vi.fn>;
    getMode: ReturnType<typeof vi.fn>;
    setDiffRevision: ReturnType<typeof vi.fn>;
    getDiffRevision: ReturnType<typeof vi.fn>;
    scrollToLine: ReturnType<typeof vi.fn>;
    setReviewFindings: ReturnType<typeof vi.fn>;
    acceptHunk: ReturnType<typeof vi.fn>;
    rejectHunk: ReturnType<typeof vi.fn>;
    acceptAll: ReturnType<typeof vi.fn>;
    rejectAll: ReturnType<typeof vi.fn>;
    getHunk: ReturnType<typeof vi.fn>;
    dismissHunk: ReturnType<typeof vi.fn>;
  };
} {
  const getValue = vi.fn(() => 'mock-value');
  const setValue = vi.fn();
  const destroy = vi.fn();
  const setMode = vi.fn();
  const getMode = vi.fn((): EditorMode => options.mode ?? 'normal');
  const setDiffRevision = vi.fn();
  const hunks = options.hunks ?? options.revision?.hunks;
  const revision: DiffRevision | null = options.revision !== undefined
    ? options.revision
    : hunks
      ? {
          filePath: '/workspace/sample.py',
          originalText: '',
          modifiedText: '',
          hunks,
        }
      : null;
  const getDiffRevision = vi.fn((): DiffRevision | null => revision);
  const scrollToLine = vi.fn();
  const setReviewFindings = vi.fn();
  const acceptHunk = vi.fn(async () => undefined);
  const rejectHunk = vi.fn(async () => undefined);
  const acceptAll = vi.fn(async () => ({ allOk: true, succeeded: [], failed: [] }));
  const rejectAll = vi.fn(async () => undefined);
  const getHunk = vi.fn(() => null);
  const dismissHunk = vi.fn();

  const api: EditorApi = {
    getValue,
    setValue,
    destroy,
    setMode,
    getMode,
    setDiffRevision,
    getDiffRevision,
    scrollToLine,
    setReviewFindings,
    acceptHunk,
    rejectHunk,
    acceptAll,
    rejectAll,
    getHunk,
    dismissHunk,
  };

  return {
    api,
    spies: {
      setReviewFindings,
      getValue,
      setValue,
      destroy,
      setMode,
      getMode,
      setDiffRevision,
      getDiffRevision,
      scrollToLine,
      acceptHunk,
      rejectHunk,
      acceptAll,
      rejectAll,
      getHunk,
      dismissHunk,
    },
  };
}

/**
 * 包装组件：内部用 useRef 创建可变 ref，让父组件可以注入 api 引用。
 * 这避免了 `createRef<EditorApi>()` 返回 read-only RefObject 的限制。
 */
function Harness({
  api,
  onError,
}: {
  api: EditorApi | null;
  onError?: (err: unknown) => void;
}): React.ReactElement {
  const apiRef = useRef<EditorApi | null>(api);
  apiRef.current = api;
  return <DiffActionBar apiRef={apiRef} onError={onError} />;
}

afterEach(() => {
  cleanup();
});

// ===== 测试 =====

describe('DiffActionBar (Task 3)', () => {
  it('mounts without throwing', () => {
    const { api } = createSpyApi({ mode: 'inline-diff' });
    expect(() => render(<Harness api={api} />)).not.toThrow();
  });

  it('renders 3 action buttons when mode === inline-diff and apiRef has a current api', () => {
    const { api } = createSpyApi({ mode: 'inline-diff' });
    const { container } = render(<Harness api={api} />);
    const bar = container.querySelector('[data-block-22-diff-action-bar]');
    expect(bar).not.toBeNull();
    const buttons = container.querySelectorAll('button');
    expect(buttons.length).toBe(3);
    expect(buttons[0]?.getAttribute('data-action')).toBe('accept-all');
    expect(buttons[1]?.getAttribute('data-action')).toBe('reject-all');
    expect(buttons[2]?.getAttribute('data-action')).toBe('review');
  });

  it('renders nothing when mode === normal (disabled = true → return null)', () => {
    const { api } = createSpyApi({ mode: 'normal' });
    const { container } = render(<Harness api={api} />);
    const bar = container.querySelector('[data-block-22-diff-action-bar]');
    expect(bar).toBeNull();
    expect(container.querySelectorAll('button').length).toBe(0);
  });

  it('renders nothing when apiRef.current is null', () => {
    const { container } = render(<Harness api={null} />);
    expect(container.querySelector('[data-block-22-diff-action-bar]')).toBeNull();
    expect(container.querySelectorAll('button').length).toBe(0);
  });

  it('Accept All click calls apiRef.current.acceptAll()', async () => {
    const { api, spies } = createSpyApi({ mode: 'inline-diff' });
    const { container } = render(<Harness api={api} />);
    const acceptBtn = container.querySelector('button[data-action="accept-all"]') as HTMLButtonElement;
    expect(acceptBtn).not.toBeNull();
    await act(async () => {
      fireEvent.click(acceptBtn);
      // 让 async handler 完成
      await Promise.resolve();
    });
    expect(spies.acceptAll).toHaveBeenCalledTimes(1);
  });

  it('Reject All click calls apiRef.current.rejectAll()', async () => {
    const { api, spies } = createSpyApi({ mode: 'inline-diff' });
    const { container } = render(<Harness api={api} />);
    const rejectBtn = container.querySelector('button[data-action="reject-all"]') as HTMLButtonElement;
    expect(rejectBtn).not.toBeNull();
    await act(async () => {
      fireEvent.click(rejectBtn);
      await Promise.resolve();
    });
    expect(spies.rejectAll).toHaveBeenCalledTimes(1);
  });

  it('Review click calls apiRef.current.scrollToLine({ line: hunks[0].startLine })', () => {
    const hunks: DiffHunk[] = [
      { id: 'h1', startLine: 1, endLine: 2, kind: 'modify', oldText: 'a', newText: 'A-changed' },
      { id: 'h2', startLine: 4, endLine: 4, kind: 'insert', oldText: '', newText: 'D-new' },
    ];
    const { api, spies } = createSpyApi({ mode: 'inline-diff', hunks });
    const { container } = render(<Harness api={api} />);
    const reviewBtn = container.querySelector('button[data-action="review"]') as HTMLButtonElement;
    expect(reviewBtn).not.toBeNull();
    fireEvent.click(reviewBtn);
    expect(spies.scrollToLine).toHaveBeenCalledTimes(1);
    expect(spies.scrollToLine).toHaveBeenCalledWith({ line: 1 });
  });

  it('Review click with no hunks does not call scrollToLine', () => {
    const { api, spies } = createSpyApi({ mode: 'inline-diff', hunks: [] });
    const { container } = render(<Harness api={api} />);
    const reviewBtn = container.querySelector('button[data-action="review"]') as HTMLButtonElement;
    fireEvent.click(reviewBtn);
    expect(spies.scrollToLine).not.toHaveBeenCalled();
  });

  it('Review click uses the first hunk startLine (single hunk case)', () => {
    const hunks: DiffHunk[] = [
      { id: 'only-hunk', startLine: 7, endLine: 8, kind: 'insert', oldText: '', newText: 'D-new' },
    ];
    const { api, spies } = createSpyApi({ mode: 'inline-diff', hunks });
    const { container } = render(<Harness api={api} />);
    const reviewBtn = container.querySelector('button[data-action="review"]') as HTMLButtonElement;
    fireEvent.click(reviewBtn);
    expect(spies.scrollToLine).toHaveBeenCalledWith({ line: 7 });
  });

  it('Accept All IPC failure routes to onError prop', async () => {
    const failureError = new Error('acceptAll boom');
    const acceptAll = vi.fn(async () => {
      throw failureError;
    });
    const api: EditorApi = {
      getValue: () => '',
      setValue: () => undefined,
      destroy: () => undefined,
      setMode: () => undefined,
      getMode: (): EditorMode => 'inline-diff',
      setDiffRevision: () => undefined,
      getDiffRevision: () => null,
      scrollToLine: () => undefined,
      setReviewFindings: () => undefined,
      acceptHunk: async () => undefined,
      rejectHunk: async () => undefined,
      acceptAll,
      rejectAll: async () => undefined,
      getHunk: () => null,
      dismissHunk: () => undefined,
    };
    const onError = vi.fn();
    const { container } = render(<Harness api={api} onError={onError} />);
    const acceptBtn = container.querySelector('button[data-action="accept-all"]') as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(acceptBtn);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(acceptAll).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toBe(failureError);
  });

  it('Reject All IPC failure routes to onError prop', async () => {
    const failureError = new Error('rejectAll boom');
    const rejectAll = vi.fn(async () => {
      throw failureError;
    });
    const api: EditorApi = {
      getValue: () => '',
      setValue: () => undefined,
      destroy: () => undefined,
      setMode: () => undefined,
      getMode: (): EditorMode => 'inline-diff',
      setDiffRevision: () => undefined,
      getDiffRevision: () => null,
      scrollToLine: () => undefined,
      setReviewFindings: () => undefined,
      acceptHunk: async () => undefined,
      rejectHunk: async () => undefined,
      acceptAll: async () => ({ allOk: true, succeeded: [], failed: [] }),
      rejectAll,
      getHunk: () => null,
      dismissHunk: () => undefined,
    };
    const onError = vi.fn();
    const { container } = render(<Harness api={api} onError={onError} />);
    const rejectBtn = container.querySelector('button[data-action="reject-all"]') as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(rejectBtn);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(rejectAll).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toBe(failureError);
  });
});
