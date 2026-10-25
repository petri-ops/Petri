// BLOCK-255 C4 — 行内统计入口：开合、aria 状态、无 usage 诚实文案。
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';

vi.mock('../copilotMarkdown', () => ({
  CopilotMarkdown: (props: { text: string }) => <div data-testid="md-probe">{props.text}</div>,
}));
vi.mock('../gen-ui/GenUiMessageContent', () => ({
  GenUiMessageContent: (props: { content: string }) => <div data-testid="genui-probe">{props.content}</div>,
}));

import { SimpleChatMessageRow } from './SimpleChatMessageRow';
import type { SimpleChatMessageRowProps } from './SimpleChatMessageRow';
import type { SimpleMessage } from './types';

afterEach(cleanup);

function baseProps(overrides: Partial<SimpleChatMessageRowProps> = {}): SimpleChatMessageRowProps {
  return {
    m: { role: 'assistant', content: 'answer' },
    messageKey: 'assistant-1',
    isTopicShiftStart: false,
    topicShiftReason: '',
    segments: [],
    streaming: false,
    settledContext: null,
    resolveNonce: 0,
    extraRenderersFlag: false,
    conversationId: 'conv-1',
    projectId: 'proj-1',
    copiedMessageKey: null,
    forkingAtIndex: null,
    forkAbsoluteIndex: 0,
    summaryRetryState: {},
    summaryRetryErrors: {},
    summaryRetryAttempts: {},
    summaryRetryCooldownUntil: {},
    cooldownNow: 1_000,
    maxSummaryRetries: 2,
    formatError: (error) => ({
      code: 'UNKNOWN',
      userMessage: String(error),
      severity: 'error',
      showDetails: false,
    }),
    getTechnicalDetails: () => undefined,
    onFileReferenceClick: vi.fn(),
    onCopyMessage: vi.fn(),
    onRegenerate: vi.fn(),
    onForkAt: vi.fn(),
    onRetrySummary: vi.fn(),
    ...overrides,
  };
}

const assistantWithUsage: SimpleMessage = {
  role: 'assistant',
  content: 'answer',
  processingDurationMs: 2500,
  usage: {
    calls: 1,
    promptTokens: 1000,
    completionTokens: 50,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    durationMs: 900,
    models: ['deepseek-chat'],
  },
};

describe('SimpleChatMessageRow 统计面板', () => {
  it('点击统计打开面板，再点关闭；aria-expanded 同步', () => {
    const { getByTestId, queryByTestId, getByText } = render(
      <SimpleChatMessageRow {...baseProps({ m: assistantWithUsage })} />,
    );
    const button = getByTestId('msg-action-stats');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(getByTestId('msg-stats-panel')).toBeTruthy();
    expect(getByText('2.5s')).toBeTruthy();
    expect(getByText('输入 1K · 输出 50')).toBeTruthy();
    fireEvent.click(getByTestId('msg-stats-close'));
    expect(queryByTestId('msg-stats-panel')).toBeNull();
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('无 usage 时面板明确未记录，不伪造 0', () => {
    const { getByTestId } = render(
      <SimpleChatMessageRow {...baseProps({ m: { role: 'assistant', content: 'old answer' } })} />,
    );
    fireEvent.click(getByTestId('msg-action-stats'));
    expect(getByTestId('msg-stats-panel')).toBeTruthy();
    expect(getByTestId('msg-stats-note').textContent).toContain('本条未记录 token');
  });
});
