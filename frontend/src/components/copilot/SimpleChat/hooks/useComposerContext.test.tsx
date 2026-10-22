// BLOCK-245 P5 — 上下文单列表的上限/去重信号必须变成可见 notice（C16）：
// 保留集合语义与 P1 基线一致（只留最后 N 条），变化的是"用户看得见"。
import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useComposerContext } from './useComposerContext';
import { MAX_SELECTION_REFERENCES } from '../selectionReferences';
import { selectionContextItem } from '../contextItems';
import type { SelectionReference } from '../selectionReferences';

function selectionContext(index: number) {
  const ref: SelectionReference = {
    id: `sel-${index}`,
    path: 'analysis/plots.R',
    name: 'plots.R',
    startLine: index + 1,
    endLine: index + 1,
    text: `seg-${index}`,
  };
  return selectionContextItem(ref);
}

function renderComposer() {
  return renderHook(() => useComposerContext({ projectId: 'p1', ownsEventBus: false }));
}

describe('useComposerContext（BLOCK-245 P5）', () => {
  it('未超限时零提示（正常加入不制造噪声）', () => {
    const { result } = renderComposer();
    act(() => result.current.addItem(selectionContext(0)));
    expect(result.current.items.length).toBe(1);
    expect(result.current.notice).toBeNull();
  });

  it('超上限：保留集合不变（最后 N 条），且最早那条的移出**可见**', () => {
    const { result } = renderComposer();
    act(() => {
      for (let i = 0; i <= MAX_SELECTION_REFERENCES; i += 1) result.current.addItem(selectionContext(i));
    });
    expect(result.current.items.length).toBe(MAX_SELECTION_REFERENCES);
    // 最早一条已被移出（语义不变）
    expect(result.current.items.some((item) => item.id === 'sel-0')).toBe(false);
    // 但用户看得见：文案说清上限与移出条数
    expect(result.current.notice).toContain(`最多 ${MAX_SELECTION_REFERENCES} 条`);
    expect(result.current.notice).toContain('已移出');
  });

  it('同源相邻重复：不重复计入，但给出反馈而不是静默无效果', () => {
    const { result } = renderComposer();
    act(() => result.current.addItem(selectionContext(1)));
    act(() => result.current.addItem(selectionContext(1)));
    expect(result.current.items.length).toBe(1);
    expect(result.current.notice).toContain('已经在列表里');
  });

  it('提示不粘滞：下一次正常加入即清空', () => {
    const { result } = renderComposer();
    act(() => result.current.addItem(selectionContext(0)));
    act(() => result.current.addItem(selectionContext(0)));
    expect(result.current.notice).not.toBeNull();
    act(() => result.current.addItem(selectionContext(2)));
    expect(result.current.notice).toBeNull();
  });

  it('移除一项后引用块随之变少（P6 实机反证的单测锚）', () => {
    const { result } = renderComposer();
    act(() => {
      result.current.addItem(selectionContext(0));
      result.current.addItem(selectionContext(1));
    });
    const withBoth = result.current.composeForSend('问题');
    act(() => result.current.removeItem('sel-0'));
    const withOne = result.current.composeForSend('问题');
    expect(withBoth.split('【引用').length).toBe(3);
    expect(withOne.split('【引用').length).toBe(2);
  });
});
