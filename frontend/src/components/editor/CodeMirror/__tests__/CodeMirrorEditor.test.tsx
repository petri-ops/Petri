/**
 * BLOCK-22-CODEMIRROR-INLINE-DIFF — CodeMirrorEditor smoke test
 *
 * P0 范围（必须）：
 * - mount 不抛错
 * - setValue() 后 getValue() 返回新值
 * - destroy() 不抛错
 *
 * P1 范围：
 * - setMode('inline-diff') + setDiffRevision({...}) → 不抛错
 * - setMode('inline-diff') → setMode('normal') → 不抛错
 * - scrollToLine({line: N}) → 不抛错
 * - setDiffRevision 修改后 ref 状态切换
 *
 * P0 不测：
 * - 行级高亮渲染（happy-dom 对 CM6 测量不友好，verify 视觉不在单测范围）
 *
 * 注：happy-dom + CM6 unifiedMergeView 在 vitest 并发 act 下会触发
 * "Should not already be working" 嵌套 act 错误，因此每个测试独立 setup。
 */

import React, { createRef } from 'react';
import { cleanup, render, act, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CodeMirrorEditor } from '../CodeMirrorEditor';
import type { DiffHunk, DiffRevision, EditorApi } from '../types';

// Mock desktopBridge so we can intercept the BLOCK-20 IPC calls
// (applyInverseHunk / revertFile) without standing up Electron.
const mockApplyInverseHunk = vi.fn(async (_params: { patch: string }) => ({ ok: true, data: { ok: true } }));
const mockRevertFile = vi.fn(async (_params: { path: string }) => ({ ok: true, data: { reverted: [] } }));

vi.mock('../../../../lib/desktopBridge', () => ({
  getBridge: vi.fn((name: string) => {
    if (name === 'workingTreeReview') {
      return {
        applyInverseHunk: (params: { patch: string }) => mockApplyInverseHunk(params),
        revertFile: (params: { path: string }) => mockRevertFile(params),
      };
    }
    return null;
  }),
  isDesktop: () => true,
}));

// helperRevision — 含 2 个 hunk（含 oldText/newText 用于 patch 生成）
const helperRevision: DiffRevision = {
  filePath: '/workspace/sample.py',
  originalText: 'a\nb\nc\n',
  modifiedText: 'A-changed\nb\nc\nD-new\n',
  hunks: [
    {
      id: 'h1',
      startLine: 1,
      endLine: 2,
      kind: 'modify',
      oldText: 'a',
      newText: 'A-changed',
    },
    {
      id: 'h2',
      startLine: 4,
      endLine: 4,
      kind: 'insert',
      oldText: '',
      newText: 'D-new',
    },
  ],
};

const sampleRevision: DiffRevision = {
  filePath: '/workspace/foo.py',
  originalText: 'a\nb\nc\n',
  modifiedText: 'a\nB-modified\nc\nd-new\n',
};

beforeEach(() => {
  // 每个测试独立 root；React 18 act 隔离
});

afterEach(() => {
  cleanup();
});

describe('CodeMirrorEditor (P0 smoke)', () => {
  it('mounts without throwing', () => {
    const { container } = render(<CodeMirrorEditor value="hello world" readonly />);
    const root = container.querySelector('[data-block-22-codemirror]');
    expect(root).not.toBeNull();
    expect(root?.getAttribute('data-readonly')).toBe('true');
  });

  it('reflects aria-readonly from readonly prop', () => {
    const { container } = render(<CodeMirrorEditor value="abc" readonly={false} />);
    const root = container.querySelector('[data-block-22-codemirror]');
    expect(root?.getAttribute('aria-readonly')).toBe('false');
    expect(root?.getAttribute('data-readonly')).toBe('false');
  });

  it('exposes EditorApi via ref and getValue returns initial value', () => {
    const ref = createRef<EditorApi>();
    render(<CodeMirrorEditor ref={ref} value="initial line" readonly />);
    expect(ref.current).not.toBeNull();
    expect(ref.current?.getValue()).toBe('initial line');
  });

  it('setValue updates the document and getValue returns new value', () => {
    const ref = createRef<EditorApi>();
    render(<CodeMirrorEditor ref={ref} value="v1" readonly />);
    act(() => {
      ref.current?.setValue('v2');
    });
    expect(ref.current?.getValue()).toBe('v2');
  });

  it('setValue with same content is a no-op (no error)', () => {
    const ref = createRef<EditorApi>();
    render(<CodeMirrorEditor ref={ref} value="same" readonly />);
    expect(() => ref.current?.setValue('same')).not.toThrow();
    expect(ref.current?.getValue()).toBe('same');
  });

  it('value prop change flows through setValue', () => {
    const ref = createRef<EditorApi>();
    const { rerender } = render(<CodeMirrorEditor ref={ref} value="a" readonly />);
    expect(ref.current?.getValue()).toBe('a');
    rerender(<CodeMirrorEditor ref={ref} value="b" readonly />);
    expect(ref.current?.getValue()).toBe('b');
  });

  it('destroy does not throw', () => {
    const ref = createRef<EditorApi>();
    const { unmount } = render(<CodeMirrorEditor ref={ref} value="x" readonly />);
    expect(() => ref.current?.destroy()).not.toThrow();
    expect(ref.current?.getValue()).toBe('');
    unmount();
  });

  it('unmount destroys the underlying view (no DOM leak)', () => {
    const ref = createRef<EditorApi>();
    const { container, unmount } = render(<CodeMirrorEditor ref={ref} value="y" readonly />);
    const root = container.querySelector('[data-block-22-codemirror]');
    expect(root?.querySelector('.cm-editor')).not.toBeNull();
    unmount();
    expect(container.querySelector('.cm-editor')).toBeNull();
  });

  it('appends className without dropping base styles', () => {
    const { container } = render(<CodeMirrorEditor value="z" className="extra-cls" readonly />);
    const root = container.querySelector('[data-block-22-codemirror]');
    expect(root?.className).toContain('extra-cls');
    expect(root?.className).toContain('cmEditor');
  });
});

describe('CodeMirrorEditor (P1 mode / diff API)', () => {
  it('initial mode defaults to normal and getMode returns normal', () => {
    const ref = createRef<EditorApi>();
    render(<CodeMirrorEditor ref={ref} value="hello" readonly />);
    expect(ref.current?.getMode()).toBe('normal');
    expect(ref.current?.getDiffRevision()).toBeNull();
  });

  it('initial inline-diff mode mounts and getMode returns inline-diff', () => {
    const ref = createRef<EditorApi>();
    render(
      <CodeMirrorEditor
        ref={ref}
        value="ignored"
        mode="inline-diff"
        diffRevision={sampleRevision}
        readonly
      />,
    );
    expect(ref.current?.getMode()).toBe('inline-diff');
    expect(ref.current?.getDiffRevision()).toBe(sampleRevision);
  });

  it('setMode from normal to inline-diff does not throw', () => {
    const ref = createRef<EditorApi>();
    render(<CodeMirrorEditor ref={ref} value="hello" readonly />);
    expect(() => {
      act(() => {
        ref.current?.setDiffRevision(sampleRevision);
        ref.current?.setMode('inline-diff');
      });
    }).not.toThrow();
    expect(ref.current?.getMode()).toBe('inline-diff');
  });

  it('setMode from inline-diff back to normal does not throw', () => {
    const ref = createRef<EditorApi>();
    render(
      <CodeMirrorEditor
        ref={ref}
        value="hello"
        mode="inline-diff"
        diffRevision={sampleRevision}
        readonly
      />,
    );
    expect(() => {
      act(() => {
        ref.current?.setMode('normal');
      });
    }).not.toThrow();
    expect(ref.current?.getMode()).toBe('normal');
  });

  it('scrollToLine({line: 2}) does not throw', () => {
    const ref = createRef<EditorApi>();
    render(<CodeMirrorEditor ref={ref} value={'l1\nl2\nl3\nl4\nl5\n'} readonly />);
    expect(() => {
      act(() => {
        ref.current?.scrollToLine({ line: 2 });
      });
    }).not.toThrow();
  });

  it('scrollToLine({line: 1, highlight: true}) injects .cm-pulse-highlight into DOM', () => {
    const ref = createRef<EditorApi>();
    const { container } = render(
      <CodeMirrorEditor ref={ref} value={'l1\nl2\nl3\nl4\nl5\n'} readonly />,
    );
    act(() => {
      ref.current?.scrollToLine({ line: 1, highlight: true });
    });
    // happy-dom 下 CM6 Decoration 真实注入 DOM；查询 .cm-pulse-highlight
    const root = container.querySelector('[data-block-22-codemirror]');
    const highlighted = root?.querySelector('.cm-pulse-highlight');
    expect(highlighted).not.toBeNull();
  });

  it('scrollToLine with out-of-range line is a safe no-op', () => {
    const ref = createRef<EditorApi>();
    render(<CodeMirrorEditor ref={ref} value="single line" readonly />);
    expect(() => {
      act(() => {
        ref.current?.scrollToLine({ line: 999 });
        ref.current?.scrollToLine({ line: 0 });
      });
    }).not.toThrow();
  });

  it('setDiffRevision updates revision state in inline-diff mode', () => {
    const ref = createRef<EditorApi>();
    render(
      <CodeMirrorEditor
        ref={ref}
        value="init"
        mode="inline-diff"
        diffRevision={sampleRevision}
        readonly
      />,
    );
    expect(ref.current?.getDiffRevision()).toBe(sampleRevision);

    const newRev: DiffRevision = {
      filePath: '/workspace/bar.py',
      originalText: 'x\ny\n',
      modifiedText: 'X-changed\nY-changed\nZ-new\n',
    };
    act(() => {
      ref.current?.setDiffRevision(newRev);
    });
    expect(ref.current?.getDiffRevision()).toBe(newRev);
  });

  it('setDiffRevision in normal mode records but does not change mode', () => {
    const ref = createRef<EditorApi>();
    render(<CodeMirrorEditor ref={ref} value="hello" mode="normal" readonly />);
    act(() => {
      ref.current?.setDiffRevision(sampleRevision);
    });
    expect(ref.current?.getMode()).toBe('normal');
    expect(ref.current?.getDiffRevision()).toBe(sampleRevision);
  });

  it('data-cm6-mode attribute reflects mode prop on mount', () => {
    const { container } = render(
      <CodeMirrorEditor
        value="x"
        mode="inline-diff"
        diffRevision={sampleRevision}
        readonly
      />,
    );
    const root = container.querySelector('[data-block-22-codemirror]');
    expect(root?.getAttribute('data-cm6-mode')).toBe('inline-diff');
  });

  it('mode prop change updates data-cm6-mode attribute on rerender', () => {
    const { container, rerender } = render(
      <CodeMirrorEditor value="x" mode="normal" readonly />,
    );
    const root = container.querySelector('[data-block-22-codemirror]');
    expect(root?.getAttribute('data-cm6-mode')).toBe('normal');
    rerender(
      <CodeMirrorEditor
        value="x"
        mode="inline-diff"
        diffRevision={sampleRevision}
        readonly
      />,
    );
    expect(root?.getAttribute('data-cm6-mode')).toBe('inline-diff');
  });

  it('changing diffRevision prop updates getDiffRevision', () => {
    const ref = createRef<EditorApi>();
    const initial: DiffRevision = {
      filePath: '/workspace/a.py',
      originalText: 'a\nb\n',
      modifiedText: 'a-modified\nb-modified\n',
    };
    const updated: DiffRevision = {
      filePath: '/workspace/a.py',
      originalText: 'a-modified\nb-modified\n',
      modifiedText: 'a-new\nb-new\nc-new\n',
    };
    const { rerender } = render(
      <CodeMirrorEditor
        ref={ref}
        value="ignored"
        mode="inline-diff"
        diffRevision={initial}
        readonly
      />,
    );
    expect(ref.current?.getDiffRevision()).toBe(initial);
    rerender(
      <CodeMirrorEditor
        ref={ref}
        value="ignored"
        mode="inline-diff"
        diffRevision={updated}
        readonly
      />,
    );
    expect(ref.current?.getDiffRevision()).toBe(updated);
  });
});

describe('CodeMirrorEditor (P2 accept / reject)', () => {
  beforeEach(() => {
    mockApplyInverseHunk.mockClear();
    mockRevertFile.mockClear();
  });

  it('acceptHunk("h1") calls applyInverseHunk IPC and triggers onAcceptHunk', async () => {
    const ref = createRef<EditorApi>();
    const onAcceptHunk = vi.fn();
    render(
      <CodeMirrorEditor
        ref={ref}
        value="ignored"
        mode="inline-diff"
        diffRevision={helperRevision}
        readonly
        onAcceptHunk={onAcceptHunk}
      />,
    );
    expect(ref.current?.getHunk('h1')?.id).toBe('h1');
    await act(async () => {
      await ref.current?.acceptHunk('h1');
    });
    expect(mockApplyInverseHunk).toHaveBeenCalledTimes(1);
    const [arg] = mockApplyInverseHunk.mock.calls[0];
    expect((arg as { patch: string }).patch).toContain('@@');
    expect(onAcceptHunk).toHaveBeenCalledWith('h1');
  });

  it('rejectHunk("h2") calls revertFile IPC and triggers onRejectHunk', async () => {
    const ref = createRef<EditorApi>();
    const onRejectHunk = vi.fn();
    render(
      <CodeMirrorEditor
        ref={ref}
        value="ignored"
        mode="inline-diff"
        diffRevision={helperRevision}
        readonly
        onRejectHunk={onRejectHunk}
      />,
    );
    await act(async () => {
      await ref.current?.rejectHunk('h2');
    });
    expect(mockRevertFile).toHaveBeenCalledTimes(1);
    expect(mockRevertFile.mock.calls[0][0]).toEqual({ path: '/workspace/sample.py' });
    expect(onRejectHunk).toHaveBeenCalledWith('h2');
  });

  it('acceptAll iterates every hunk and aggregates results', async () => {
    const ref = createRef<EditorApi>();
    const onAcceptHunk = vi.fn();
    render(
      <CodeMirrorEditor
        ref={ref}
        value="ignored"
        mode="inline-diff"
        diffRevision={helperRevision}
        readonly
        onAcceptHunk={onAcceptHunk}
      />,
    );
    let result: { allOk: boolean; succeeded: string[]; failed: Array<{ hunkId: string; error: string }> } | undefined;
    await act(async () => {
      result = await ref.current?.acceptAll();
    });
    expect(result?.allOk).toBe(true);
    expect(result?.succeeded.sort()).toEqual(['h1', 'h2']);
    expect(result?.failed).toEqual([]);
    expect(mockApplyInverseHunk).toHaveBeenCalledTimes(2);
    expect(onAcceptHunk).toHaveBeenCalledTimes(2);
    expect(onAcceptHunk).toHaveBeenCalledWith('h1');
    expect(onAcceptHunk).toHaveBeenCalledWith('h2');
  });

  it('rejectAll calls revertFile IPC once with the file path', async () => {
    const ref = createRef<EditorApi>();
    render(
      <CodeMirrorEditor
        ref={ref}
        value="ignored"
        mode="inline-diff"
        diffRevision={helperRevision}
        readonly
      />,
    );
    await act(async () => {
      await ref.current?.rejectAll();
    });
    expect(mockRevertFile).toHaveBeenCalledTimes(1);
    expect(mockRevertFile.mock.calls[0][0]).toEqual({ path: '/workspace/sample.py' });
  });

  it('IPC failure routes to onError callback', async () => {
    mockApplyInverseHunk.mockRejectedValueOnce(new Error('ipc boom'));
    const ref = createRef<EditorApi>();
    const onError = vi.fn();
    render(
      <CodeMirrorEditor
        ref={ref}
        value="ignored"
        mode="inline-diff"
        diffRevision={helperRevision}
        readonly
        onError={onError}
      />,
    );
    await act(async () => {
      try {
        await ref.current?.acceptHunk('h1');
      } catch {
        // swallow: api 抛出后 onError 应已触发
      }
    });
    expect(onError).toHaveBeenCalled();
    const err = onError.mock.calls[0][0];
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('ipc boom');
  });

  it('mode === "normal" makes acceptHunk / rejectHunk safe no-ops', async () => {
    const ref = createRef<EditorApi>();
    render(<CodeMirrorEditor ref={ref} value="hello" mode="normal" readonly />);
    await act(async () => {
      await ref.current?.acceptHunk('h1');
      await ref.current?.rejectHunk('h2');
      const result = await ref.current?.acceptAll();
      await ref.current?.rejectAll();
      expect(result?.allOk).toBe(true);
    });
    expect(mockApplyInverseHunk).not.toHaveBeenCalled();
    expect(mockRevertFile).not.toHaveBeenCalled();
  });

  it('clicking the inline Accept button triggers onAcceptHunk via data-accept-hunk', async () => {
    const ref = createRef<EditorApi>();
    const onAcceptHunk = vi.fn();
    const { container } = render(
      <CodeMirrorEditor
        ref={ref}
        value="ignored"
        mode="inline-diff"
        diffRevision={helperRevision}
        readonly
        onAcceptHunk={onAcceptHunk}
      />,
    );
    // 注入一个 fake accept button 到 contentDOM；扩展的 click 拦截会路由到回调
    const root = container.querySelector('[data-block-22-codemirror]') as HTMLElement;
    const editor = root.querySelector('.cm-editor');
    const contentDOM = editor?.querySelector('.cm-content') ?? editor;
    expect(contentDOM).not.toBeNull();
    const btn = document.createElement('button');
    btn.setAttribute('data-accept-hunk', 'h1');
    btn.className = 'cm-accept-button';
    (contentDOM as HTMLElement).appendChild(btn);
    await act(async () => {
      fireEvent.click(btn);
      // 让 onAccept 异步链上的 promise 完成（acceptHunk 走 IPC + onAcceptHunk）
      await Promise.resolve();
    });
    expect(mockApplyInverseHunk).toHaveBeenCalledTimes(1);
    expect(onAcceptHunk).toHaveBeenCalledWith('h1');
  });

  it('clicking the Reject button routes through revertFile IPC + onRejectHunk', async () => {
    const ref = createRef<EditorApi>();
    const onRejectHunk = vi.fn();
    const { container } = render(
      <CodeMirrorEditor
        ref={ref}
        value="ignored"
        mode="inline-diff"
        diffRevision={helperRevision}
        readonly
        onRejectHunk={onRejectHunk}
      />,
    );
    const root = container.querySelector('[data-block-22-codemirror]') as HTMLElement;
    const editor = root.querySelector('.cm-editor');
    const contentDOM = editor?.querySelector('.cm-content') ?? editor;
    const btn = document.createElement('button');
    btn.setAttribute('data-reject-hunk', 'h2');
    btn.className = 'cm-reject-button';
    (contentDOM as HTMLElement).appendChild(btn);
    await act(async () => {
      fireEvent.click(btn);
      await Promise.resolve();
    });
    expect(mockRevertFile).toHaveBeenCalledTimes(1);
    expect(onRejectHunk).toHaveBeenCalledWith('h2');
  });

  it('getHunk returns null for unknown id and the matching hunk otherwise', () => {
    const ref = createRef<EditorApi>();
    render(
      <CodeMirrorEditor
        ref={ref}
        value="ignored"
        mode="inline-diff"
        diffRevision={helperRevision}
        readonly
      />,
    );
    expect(ref.current?.getHunk('does-not-exist')).toBeNull();
    const hunk = ref.current?.getHunk('h1');
    expect(hunk?.id).toBe('h1');
    expect((hunk as DiffHunk).oldText).toBe('a');
  });

  it('acceptHunk with unknown hunkId is a safe no-op (no IPC call)', async () => {
    const ref = createRef<EditorApi>();
    render(
      <CodeMirrorEditor
        ref={ref}
        value="ignored"
        mode="inline-diff"
        diffRevision={helperRevision}
        readonly
      />,
    );
    await act(async () => {
      await ref.current?.acceptHunk('does-not-exist');
    });
    expect(mockApplyInverseHunk).not.toHaveBeenCalled();
    expect(mockRevertFile).not.toHaveBeenCalled();
  });

  it('EditorApiContext.Provider exposes the editor api to nested consumers', async () => {
    const ref = createRef<EditorApi>();
    let captured: EditorApi | null = null;
    function Consumer(): React.ReactElement | null {
      const api = useEditorApiForTest();
      captured = api;
      return null;
    }
    render(
      <CodeMirrorEditor ref={ref} value="hello" readonly>
        <Consumer />
      </CodeMirrorEditor>,
    );
    // EditorApiContext 通过 setState 在 mount effect 内同步设置；
    // Consumer 重新渲染后 captured 应非 null。waitFor 容忍 1~2 次 React commit。
    await waitFor(() => {
      expect(captured).not.toBeNull();
    });
    // waitFor 已收窄类型到非 null；断言后 captured 已 confirmed 非 null
    expect(captured).not.toBeNull();
    const api = captured as unknown as EditorApi;
    expect(api.getValue()).toBe('hello');
  });
});

/**
 * Local re-export so we don't pollute the production barrel with a test-only hook.
 * Mirrors `useEditorApi` in CodeMirrorEditor.tsx.
 */
import { useContext } from 'react';
import { EditorApiContext } from '../CodeMirrorEditor';
function useEditorApiForTest(): EditorApi | null {
  return useContext(EditorApiContext);
}
