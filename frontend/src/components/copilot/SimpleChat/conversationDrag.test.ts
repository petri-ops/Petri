// BLOCK-255 C17 — 会话拖拽载荷/条目构造/摘要装载契约。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getConversationMessages } from '../copilotConversationsClient';
import {
  buildConversationDragItem,
  conversationDragPayload,
  loadConversationDragItem,
  readConversationDragData,
  setConversationDragData,
  CONVERSATION_DRAG_MIME,
} from './conversationDrag';

vi.mock('../copilotConversationsClient', () => ({
  getConversationMessages: vi.fn(),
}));

const mockedGetMessages = vi.mocked(getConversationMessages);

const conversation = {
  id: 'conv_1',
  title: '空间转录组讨论',
  status: 'active' as const,
  last_page: null,
  message_count: 12,
  created_at: '2026-10-20T00:00:00.000Z',
  updated_at: '2026-10-25T00:00:00.000Z',
};

function dataTransfer(initial: Record<string, string> = {}): DataTransfer {
  const data = new Map(Object.entries(initial));
  return {
    get types() { return [...data.keys()]; },
    getData: (type: string) => data.get(type) ?? '',
    setData: (type: string, value: string) => { data.set(type, value); },
    effectAllowed: 'copy',
  } as unknown as DataTransfer;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('conversationDrag 载荷', () => {
  it('setConversationDragData 写自定义 MIME + 纯文本标题', () => {
    const dt = dataTransfer();
    setConversationDragData(dt, conversation);
    expect(dt.types).toContain(CONVERSATION_DRAG_MIME);
    const payload = readConversationDragData(dt);
    expect(payload).toEqual({
      id: 'conv_1',
      title: '空间转录组讨论',
      messageCount: 12,
      updatedAt: '2026-10-25T00:00:00.000Z',
    });
  });

  it('非法/缺失载荷返回 null（不产半截条目）', () => {
    expect(readConversationDragData(dataTransfer())).toBeNull();
    expect(readConversationDragData(dataTransfer({ [CONVERSATION_DRAG_MIME]: 'not-json' }))).toBeNull();
    expect(readConversationDragData(dataTransfer({ [CONVERSATION_DRAG_MIME]: JSON.stringify({ title: 'x' }) }))).toBeNull();
  });

  it('conversationDragPayload 对空标题/非数字消息数做诚实归一', () => {
    expect(conversationDragPayload({
      ...conversation,
      title: '',
      message_count: Number.NaN,
      updated_at: '',
    })).toEqual({
      id: 'conv_1',
      title: '未命名对话',
      messageCount: 0,
      updatedAt: null,
    });
  });
});

describe('buildConversationDragItem', () => {
  it('产唯一 conversation ContextItem，带标题/id/消息数与摘要', () => {
    const payload = conversationDragPayload(conversation);
    const item = buildConversationDragItem(payload, ['> 用户：上轮问题', '> 助手：上轮回答'], null)!;
    expect(item.kind).toBe('conversation');
    expect(item.group).toBe('reference');
    expect(item.id).toBe('ctx-conversation-conv_1');
    expect(item.lines.join('\n')).toContain('conversationId：conv_1');
    expect(item.lines.join('\n')).toContain('> 用户：上轮问题');
  });

  it('当前会话拒自引用', () => {
    expect(buildConversationDragItem(conversationDragPayload(conversation), [], 'conv_1')).toBeNull();
  });
});

describe('loadConversationDragItem', () => {
  it('拉最近 12 条消息生成有界摘要', async () => {
    mockedGetMessages.mockResolvedValue([
      { id: 'm1', role: 'user', content: '上轮问题', ts: '2026-10-25T00:00:00.000Z' },
      { id: 'm2', role: 'assistant', content: '上轮回答', ts: '2026-10-25T00:00:01.000Z' },
    ]);
    const { item, digestUnavailable } = await loadConversationDragItem(conversationDragPayload(conversation), 'conv_current');
    expect(mockedGetMessages).toHaveBeenCalledWith('conv_1', 12);
    expect(digestUnavailable).toBe(false);
    expect(item?.lines.join('\n')).toContain('> 用户：上轮问题');
  });

  it('摘要拉取失败仍引用标题/元数据，并如实注明', async () => {
    mockedGetMessages.mockRejectedValue(new Error('network'));
    const { item, digestUnavailable } = await loadConversationDragItem(conversationDragPayload(conversation), null);
    expect(digestUnavailable).toBe(true);
    expect(item?.lines.join('\n')).toContain('摘要：未能载入');
    expect(item?.lines.join('\n')).toContain('conversationId：conv_1');
  });

  it('当前会话不请求消息接口', async () => {
    const result = await loadConversationDragItem(conversationDragPayload(conversation), 'conv_1');
    expect(result.item).toBeNull();
    expect(mockedGetMessages).not.toHaveBeenCalled();
  });
});
