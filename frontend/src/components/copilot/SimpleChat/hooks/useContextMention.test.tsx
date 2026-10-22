// BLOCK-245 P4 — `@` 菜单交互状态簇：触发/过滤/键盘导航/选中回落。
// 装载面（useContextSources）用替身：本测试只钉交互语义，不打后端。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { ComposerContextItem } from '../contextItems';
import { buildFileCandidates, type ContextSourceResult } from '../contextSources';
import { useContextMention } from './useContextMention';

const state = vi.hoisted(() => ({ sources: [] as unknown[], loading: false }));

vi.mock('./useContextSources', () => ({
  useContextSources: () => ({
    sources: state.sources,
    loading: state.loading,
    error: null,
    refresh: () => undefined,
  }),
}));

function renderMention() {
  const onPickItem = vi.fn();
  const applyText = vi.fn();
  const hook = renderHook(() => useContextMention({
    projectId: 'p1',
    conversationId: 'c1',
    onPickItem,
    applyText,
  }));
  return { ...hook, onPickItem, applyText };
}

function keyEvent(key: string) {
  return { key, preventDefault: vi.fn() };
}

describe('useContextMention（BLOCK-245 P4）', () => {
  beforeEach(() => {
    state.sources = [buildFileCandidates([
      { name: 'f0.R', type: 'file', size: 0 },
      { name: 'f1.R', type: 'file', size: 0 },
      { name: 'f2.R', type: 'file', size: 0 },
    ]) satisfies ContextSourceResult];
    state.loading = false;
  });

  it('光标不在 `@` token 内 → 菜单关闭，键盘事件不被吞', () => {
    const { result } = renderMention();
    act(() => result.current.syncInput('普通文本', 4));
    expect(result.current.open).toBe(false);
    const event = keyEvent('ArrowDown');
    expect(result.current.handleKeyDown(event)).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('`@` 触发后按 query 过滤候选，高亮落在首项', () => {
    const { result } = renderMention();
    act(() => result.current.syncInput('看下 @f1', 6));
    expect(result.current.open).toBe(true);
    expect(result.current.sources.flatMap((s) => s.candidates.map((c) => c.label))).toEqual(['f1.R']);
    expect(result.current.activeId).toBe('file:f1.R');
  });

  it('方向键移动高亮并阻止默认（正文不跟着滚动/移动光标）', () => {
    const { result } = renderMention();
    act(() => result.current.syncInput('看下 @f', 5));
    expect(result.current.activeId).toBe('file:f0.R');
    const down = keyEvent('ArrowDown');
    act(() => { result.current.handleKeyDown(down); });
    expect(down.preventDefault).toHaveBeenCalled();
    expect(result.current.activeId).toBe('file:f1.R');
    const up = keyEvent('ArrowUp');
    act(() => { result.current.handleKeyDown(up); });
    expect(result.current.activeId).toBe('file:f0.R');
    // 首项再上不越界
    act(() => { result.current.handleKeyDown(keyEvent('ArrowUp')); });
    expect(result.current.activeId).toBe('file:f0.R');
  });

  it('回车选中 → 只产 ComposerContextItem 入单列表，并摘掉 @token 回写正文', () => {
    const { result, onPickItem, applyText } = renderMention();
    act(() => result.current.syncInput('看下 @f2', 6));
    const enter = keyEvent('Enter');
    act(() => { result.current.handleKeyDown(enter); });
    expect(enter.preventDefault).toHaveBeenCalled();
    expect(onPickItem).toHaveBeenCalledTimes(1);
    const item = onPickItem.mock.calls[0][0] as ComposerContextItem;
    expect(item.kind).toBe('file');
    expect(item.group).toBe('reference');
    expect(item.lines[0]).toBe('【引用文件】');
    expect(applyText).toHaveBeenCalledWith('看下 ', 3);
    expect(result.current.open).toBe(false);
  });

  it('Esc 关掉菜单且不选任何项', () => {
    const { result, onPickItem } = renderMention();
    act(() => result.current.syncInput('@f', 2));
    act(() => { result.current.handleKeyDown(keyEvent('Escape')); });
    expect(result.current.open).toBe(false);
    expect(onPickItem).not.toHaveBeenCalled();
  });

  it('零候选时回车只关菜单（不产生无主引用）', () => {
    const { result, onPickItem } = renderMention();
    act(() => result.current.syncInput('@zzz', 4));
    expect(result.current.activeId).toBeNull();
    act(() => { result.current.handleKeyDown(keyEvent('Enter')); });
    expect(onPickItem).not.toHaveBeenCalled();
    expect(result.current.open).toBe(false);
  });
});
