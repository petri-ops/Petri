// BLOCK-259 C14 — 行内「润色 / 建议追问」只填输入框，不自动发送。
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
import { FOLLOWUP_PROMPTS } from './messageActions';

afterEach(cleanup);

function baseProps(overrides: Partial<SimpleChatMessageRowProps> = {}): SimpleChatMessageRowProps {
  return {
    m: { role: 'assistant', content: '这是上一条回复' },
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
    formatError: (error) => ({ code: 'UNKNOWN', userMessage: String(error), severity: 'error', showDetails: false }),
    getTechnicalDetails: () => undefined,
    onFileReferenceClick: vi.fn(),
    onCopyMessage: vi.fn(),
    onRegenerate: vi.fn(),
    onForkAt: vi.fn(),
    onRetrySummary: vi.fn(),
    ...overrides,
  };
}

describe('SimpleChatMessageRow 润色/追问（BLOCK-259 C14）', () => {
  it('润色把要求填入输入框（含原回复），不自动发送', () => {
    const insert = vi.fn();
    const { getByTestId } = render(<SimpleChatMessageRow {...baseProps({ onInsertComposerText: insert })} />);
    fireEvent.click(getByTestId('msg-action-polish'));
    expect(insert).toHaveBeenCalledTimes(1);
    expect(String(insert.mock.calls[0][0])).toContain('请润色上一条助手回复');
    expect(String(insert.mock.calls[0][0])).toContain('这是上一条回复');
  });

  it('建议追问展开三条模板，点击填入并收起；aria-expanded 同步', () => {
    const insert = vi.fn();
    const { getByTestId, queryByTestId } = render(
      <SimpleChatMessageRow {...baseProps({ onInsertComposerText: insert })} />,
    );
    const button = getByTestId('msg-action-suggest-followups');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(getByTestId('msg-followups')).toBeTruthy();
    expect(getByTestId('msg-followup-0').textContent).toBe(FOLLOWUP_PROMPTS[0].label);

    fireEvent.click(getByTestId('msg-followup-1'));
    expect(insert).toHaveBeenCalledWith(FOLLOWUP_PROMPTS[1].prompt);
    expect(queryByTestId('msg-followups')).toBeNull();
  });

  it('宿主未提供插入回调时不渲染死按钮', () => {
    const { queryByTestId } = render(<SimpleChatMessageRow {...baseProps()} />);
    expect(queryByTestId('msg-action-polish')).toBeNull();
    expect(queryByTestId('msg-action-suggest-followups')).toBeNull();
  });
});
