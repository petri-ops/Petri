// BLOCK-255 C17 — composer drop：会话分支、当前会话拒自引用、文件分支回落。
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ComposerContextItem } from '../contextItems';
import { CONVERSATION_DRAG_MIME, loadConversationDragItem } from '../conversationDrag';
import { useComposerDrop } from './useComposerDrop';

vi.mock('../conversationDrag', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../conversationDrag')>();
  return { ...actual, loadConversationDragItem: vi.fn() };
});

const mockedLoad = vi.mocked(loadConversationDragItem);

const item: ComposerContextItem = {
  id: 'ctx-conversation-conv_1',
  kind: 'conversation',
  group: 'reference',
  label: '上轮会话',
  source: '会话',
  lines: ['【引用会话 上轮会话】', '> conversationId：conv_1'],
  dedupeKey: 'conversation|conv_1',
  payload: { id: 'conv_1' },
};

function payloadDataTransfer(id = 'conv_1'): DataTransfer {
  const data = new Map<string, string>([
    [CONVERSATION_DRAG_MIME, JSON.stringify({ id, title: '上轮会话', messageCount: 3, updatedAt: null })],
  ]);
  return {
    types: [...data.keys()],
    getData: (type: string) => data.get(type) ?? '',
    setData: (type: string, value: string) => { data.set(type, value); },
    effectAllowed: 'copy',
    files: [],
  } as unknown as DataTransfer;
}

function dropEvent(dataTransfer: DataTransfer): {
  event: React.DragEvent;
  preventDefault: ReturnType<typeof vi.fn>;
  stopPropagation: ReturnType<typeof vi.fn>;
} {
  const preventDefault = vi.fn();
  const stopPropagation = vi.fn();
  return {
    event: { dataTransfer, preventDefault, stopPropagation } as unknown as React.DragEvent,
    preventDefault,
    stopPropagation,
  };
}

function options(over: Partial<Parameters<typeof useComposerDrop>[0]> = {}) {
  return {
    conversationId: 'conv_current',
    addItem: vi.fn(),
    setAttachments: vi.fn(),
    setIsDraggingOver: vi.fn(),
    existingCount: 0,
    onNotice: vi.fn(),
    ...over,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('useComposerDrop', () => {
  it('会话拖入：拉摘要并 addItem；成功后清提示', async () => {
    mockedLoad.mockResolvedValue({ item, digestUnavailable: false });
    const opts = options();
    const { result } = renderHook(() => useComposerDrop(opts));
    const { event, preventDefault, stopPropagation } = dropEvent(payloadDataTransfer());
    act(() => result.current.handleDrop(event));
    await vi.waitFor(() => expect(opts.addItem).toHaveBeenCalledWith(item));
    expect(preventDefault).toHaveBeenCalled();
    expect(stopPropagation).toHaveBeenCalled();
    expect(opts.setIsDraggingOver).toHaveBeenCalledWith(false);
    expect(opts.onNotice).toHaveBeenCalledWith(null);
  });

  it('当前会话拒自引用：不请求摘要、不进 composer', () => {
    const opts = options({ conversationId: 'conv_1' });
    const { result } = renderHook(() => useComposerDrop(opts));
    act(() => result.current.handleDrop(dropEvent(payloadDataTransfer('conv_1')).event));
    expect(mockedLoad).not.toHaveBeenCalled();
    expect(opts.addItem).not.toHaveBeenCalled();
    expect(opts.onNotice).toHaveBeenCalledWith('当前会话无需引用自己');
  });

  it('摘要装载失败：给可见提示，不静默', async () => {
    mockedLoad.mockResolvedValue({ item: null, digestUnavailable: true });
    const opts = options();
    const { result } = renderHook(() => useComposerDrop(opts));
    act(() => result.current.handleDrop(dropEvent(payloadDataTransfer()).event));
    await vi.waitFor(() => expect(opts.onNotice).toHaveBeenCalledWith('未能引用会话：可改用 @ 选择会话'));
  });

  it('无会话 MIME 时回落文件附件分支', () => {
    const opts = options();
    const { result } = renderHook(() => useComposerDrop(opts));
    const dataTransfer = {
      types: ['Files'],
      getData: () => '',
      files: [new File(['hello'], 'note.txt', { type: 'text/plain' })],
      items: [],
    } as unknown as DataTransfer;
    act(() => result.current.handleDrop(dropEvent(dataTransfer).event));
    expect(mockedLoad).not.toHaveBeenCalled();
    expect(opts.setAttachments).toHaveBeenCalledTimes(1);
  });

  it('handleDragOver 接受会话 MIME（composer 拖拽态可见）', () => {
    const opts = options();
    const { result } = renderHook(() => useComposerDrop(opts));
    const event = {
      dataTransfer: { types: [CONVERSATION_DRAG_MIME] },
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as React.DragEvent;
    act(() => result.current.handleDragOver(event));
    expect(opts.setIsDraggingOver).toHaveBeenCalledWith(true);
  });
});
