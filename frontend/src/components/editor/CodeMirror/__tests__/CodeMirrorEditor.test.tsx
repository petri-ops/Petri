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
import { cleanup, render, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CodeMirrorEditor } from '../CodeMirrorEditor';
import type { DiffRevision, EditorApi } from '../types';

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
