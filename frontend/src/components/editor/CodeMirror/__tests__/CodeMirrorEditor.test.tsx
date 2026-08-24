/**
 * BLOCK-22-CODEMIRROR-INLINE-DIFF — CodeMirrorEditor smoke test
 *
 * P0 范围（必须）：
 * - mount 不抛错
 * - setValue() 后 getValue() 返回新值
 * - destroy() 不抛错
 *
 * P0 不测（明确留给 P1~P3）：
 * - diff / accept / reject / scroll 行为
 * - language 加载（happy-dom + Vite ESM 异步 import 复杂，P0 不稳定）
 * - 行级高亮渲染（happy-dom 对 CM6 测量不友好，verify 视觉不在单测范围）
 */

import React, { createRef } from 'react';
import { cleanup, render, act } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { CodeMirrorEditor } from '../CodeMirrorEditor';
import type { EditorApi } from '../types';

afterEach(cleanup);

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
    // mount 后 effect 把 api 写到 ref
    // 注：CM6 会规范化 doc（如去尾换行），所以期望值不带 '\n'
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
    // destroy 后再调用 getValue 应安全返回空串（view 已 null）
    expect(ref.current?.getValue()).toBe('');
    unmount();
  });

  it('unmount destroys the underlying view (no DOM leak)', () => {
    const ref = createRef<EditorApi>();
    const { container, unmount } = render(<CodeMirrorEditor ref={ref} value="y" readonly />);
    const root = container.querySelector('[data-block-22-codemirror]');
    // CM6 在挂载后会注入 .cm-editor 子节点
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
