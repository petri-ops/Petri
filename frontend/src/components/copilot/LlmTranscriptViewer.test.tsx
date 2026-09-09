import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LlmTranscriptViewer } from './LlmTranscriptViewer';
import type {
  LlmTranscriptIndexEntry,
  LlmTranscriptRecord,
} from './llmTranscripts';

const { listLlmTranscriptsMock, fetchLlmTranscriptRecordMock } = vi.hoisted(() => ({
  listLlmTranscriptsMock: vi.fn(),
  fetchLlmTranscriptRecordMock: vi.fn(),
}));

vi.mock('./llmTranscripts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./llmTranscripts')>();
  return {
    ...actual,
    listLlmTranscripts: listLlmTranscriptsMock,
    fetchLlmTranscriptRecord: fetchLlmTranscriptRecordMock,
  };
});

/** 与组件 formatTime 同逻辑的本地时间格式（测试时区无关）。 */
function fmt(ts: string): string {
  const date = new Date(ts);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function makeEntry(overrides: Partial<LlmTranscriptIndexEntry> = {}): LlmTranscriptIndexEntry {
  return {
    id: 'rt_1',
    ts: '2026-09-02T10:00:00.000Z',
    conversationId: 'conv-1',
    kind: 'agent_iter',
    role: 'agent',
    traceId: undefined,
    provider: 'deepseek',
    profileId: 'deepseek-chat',
    model: 'deepseek-chat',
    attemptIndex: 0,
    durationMs: 150,
    finishReason: 'stop',
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    messagesCount: 2,
    framesCount: 3,
    framesTruncated: false,
    truncated: false,
    messagesTruncated: 0,
    error: null,
    sizeBytes: 2048,
    ...overrides,
  };
}

function makeRecord(overrides: Partial<LlmTranscriptRecord> = {}): LlmTranscriptRecord {
  return {
    id: 'rt_1',
    ts: '2026-09-02T10:00:00.000Z',
    conversationId: 'conv-1',
    kind: 'agent_iter',
    role: 'agent',
    attemptIndex: 0,
    model: 'deepseek-chat',
    durationMs: 150,
    request: {
      messages: [
        { role: 'system', content: 'you are helpful' },
        { role: 'user', content: '帮我分析这批单细胞数据' },
      ],
      params: '{"model":"deepseek-chat"}',
    },
    response: {
      content: '好的，我来分析。',
      reasoningContent: '用户想要单细胞分析…',
      toolCalls: undefined,
      finishReason: 'stop',
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    },
    error: null,
    frames: [{ type: 'content_delta', content: '好的' }],
    framesCount: 3,
    framesTruncated: false,
    truncated: false,
    messagesTruncated: 0,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('LlmTranscriptViewer (BLOCK-37 P3 / UI-274; BLOCK-68 dock 形态)', () => {
  it('renders honest empty state when no conversation is active', () => {
    render(<LlmTranscriptViewer conversationId={null} />);
    expect(screen.getByText('当前无会话')).toBeTruthy();
    expect(listLlmTranscriptsMock).not.toHaveBeenCalled();
  });

  it('renders empty state when no records', async () => {
    listLlmTranscriptsMock.mockResolvedValue([]);
    render(<LlmTranscriptViewer conversationId="conv-1" />);
    expect(await screen.findByText('本会话暂无模型调用记录')).toBeTruthy();
  });

  it('renders index rows newest-first without loading detail by default', async () => {
    const oldTs = '2026-09-02T09:00:00.000Z';
    const newTs = '2026-09-02T10:30:00.000Z';
    listLlmTranscriptsMock.mockResolvedValue([
      makeEntry({ id: 'rt_old', ts: oldTs }),
      makeEntry({ id: 'rt_new', ts: newTs, error: 'rate_limit' }),
    ]);
    render(<LlmTranscriptViewer conversationId="conv-1" />);
    await waitFor(() => expect(listLlmTranscriptsMock).toHaveBeenCalledWith('conv-1'));

    const times = await screen.findAllByText(/09-02/);
    // 最新在前：10:30 的行先于 09:00
    expect(times[0].textContent).toBe(fmt(newTs));
    expect(times[1].textContent).toBe(fmt(oldTs));
    // 错误标记出现
    expect(screen.getAllByTitle('rate_limit').length).toBeGreaterThan(0);
    // 默认不拉详情
    expect(fetchLlmTranscriptRecordMock).not.toHaveBeenCalled();
  });

  it('expands a record on click and shows request/response with role chips', async () => {
    listLlmTranscriptsMock.mockResolvedValue([makeEntry()]);
    fetchLlmTranscriptRecordMock.mockResolvedValue(makeRecord());
    render(<LlmTranscriptViewer conversationId="conv-1" />);

    const row = await screen.findByRole('button', { name: /deepseek-chat/ });
    fireEvent.click(row);

    await waitFor(() => expect(fetchLlmTranscriptRecordMock).toHaveBeenCalledWith('conv-1', 'rt_1'));
    expect(await screen.findByText('请求 · messages（2）')).toBeTruthy();
    expect(screen.getByText('好的，我来分析。')).toBeTruthy();
    expect(screen.getByText('用户想要单细胞分析…')).toBeTruthy();
    // 角色标签
    expect(screen.getAllByText('system').length).toBeGreaterThan(0);
    expect(screen.getAllByText('user').length).toBeGreaterThan(0);
  });

  it('shows honest truncation markers (record truncated + messages truncated)', async () => {
    listLlmTranscriptsMock.mockResolvedValue([
      makeEntry({ truncated: true, messagesTruncated: 12, framesTruncated: true }),
    ]);
    fetchLlmTranscriptRecordMock.mockResolvedValue(
      makeRecord({ truncated: true, messagesTruncated: 12 })
    );
    render(<LlmTranscriptViewer conversationId="conv-1" />);

    const row = await screen.findByRole('button', { name: /deepseek-chat/ });
    // 索引行上的「截断」chip
    expect(screen.getByText('截断')).toBeTruthy();
    fireEvent.click(row);

    expect(await screen.findByText(/中段 12 条消息因超限未存盘/)).toBeTruthy();
    expect(screen.getAllByText(/超过 8MB 落盘上限被截断/).length).toBeGreaterThan(0);
    // 帧超限标记（帧：3+（超限未存））
    expect(screen.getAllByText(/超限未存/).length).toBeGreaterThan(0);
  });

  it('shows error banner when listing fails', async () => {
    listLlmTranscriptsMock.mockRejectedValue(new Error('HTTP 500'));
    render(<LlmTranscriptViewer conversationId="conv-1" />);
    expect(await screen.findByText(/加载失败：HTTP 500/)).toBeTruthy();
  });
});
