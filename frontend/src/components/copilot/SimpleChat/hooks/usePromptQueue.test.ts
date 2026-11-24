// BLOCK-511 S1.4 HK-01 — 排队消息挂载不清空、切换会话才清空。
import { cleanup, renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { usePromptQueue } from './usePromptQueue';

const KEY = 'petri:chat-queue:v1';

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('BLOCK-511 usePromptQueue', () => {
  it('预置 localStorage 后挂载，队列保留（修复前挂载 effect 无条件清空）', () => {
    const seeded = [{ id: 'q1', text: '排队追问', conversationId: 'c1', createdAt: 1 }];
    localStorage.setItem(KEY, JSON.stringify(seeded));
    const { result } = renderHook(({ cid, pid }) => usePromptQueue(cid, pid), {
      initialProps: { cid: 'c1', pid: 'p1' },
    });
    expect(result.current.queuedPrompts).toEqual(seeded);
    // 回写 effect 不应把预置队列清空
    expect(JSON.parse(localStorage.getItem(KEY) || '[]')).toEqual(seeded);
  });

  it('切换会话后清空队列', () => {
    const seeded = [{ id: 'q1', text: '排队追问', conversationId: 'c1', createdAt: 1 }];
    localStorage.setItem(KEY, JSON.stringify(seeded));
    const { result, rerender } = renderHook(({ cid, pid }) => usePromptQueue(cid, pid), {
      initialProps: { cid: 'c1', pid: 'p1' },
    });
    expect(result.current.queuedPrompts).toEqual(seeded);
    rerender({ cid: 'c2', pid: 'p1' });
    expect(result.current.queuedPrompts).toEqual([]);
  });

  it('切换项目后清空队列；同会话重渲染不清空', () => {
    const seeded = [{ id: 'q1', text: '排队追问', conversationId: 'c1', createdAt: 1 }];
    localStorage.setItem(KEY, JSON.stringify(seeded));
    const { result, rerender } = renderHook(({ cid, pid }) => usePromptQueue(cid, pid), {
      initialProps: { cid: 'c1', pid: 'p1' },
    });
    rerender({ cid: 'c1', pid: 'p1' });
    expect(result.current.queuedPrompts).toEqual(seeded);
    rerender({ cid: 'c1', pid: 'p2' });
    expect(result.current.queuedPrompts).toEqual([]);
  });

  it('显式 setQueuedPrompts 更新并回写', () => {
    const { result } = renderHook(() => usePromptQueue('c1', 'p1'));
    const next = [{ id: 'q2', text: '新追问', conversationId: 'c1', createdAt: 2 }];
    act(() => result.current.setQueuedPrompts(next));
    expect(result.current.queuedPrompts).toEqual(next);
    expect(JSON.parse(localStorage.getItem(KEY) || '[]')).toEqual(next);
  });
});
