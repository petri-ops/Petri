import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// BLOCK-154 波次 3 — 行 memo 契约测试（红绿先行）。
//
// 契约（SimpleChatMessageRow.tsx 文件头「memo 契约」节）：
//   ① 相同 props 重渲染必须 bail-out——重渲染由父组件发起（如流式 tick），未变行
//      不得重新执行子树（以 CopilotMarkdown 调用次数为探针：历史行 markdown 重解析
//      正是流式期最大的每 tick 浪费）；
//   ② m 对象身份变化必须重渲染——派生链对尾消息替换/推送新对象，流式行靠它更新。
//
// 探针实现：vi.mock 掉真实的 CopilotMarkdown（markdown 解析重、与断言无关），
// 计数 mock 调用次数即可精确反映行组件是否重新执行。

vi.mock('../copilotMarkdown', () => ({
  CopilotMarkdown: vi.fn((props: { text: string }) => (
    <div data-testid="md-probe">{props.text}</div>
  )),
}));

import { CopilotMarkdown } from '../copilotMarkdown';
import { SimpleChatMessageRow } from './SimpleChatMessageRow';
import type { SimpleChatMessageRowProps } from './SimpleChatMessageRow';

const mockedCopilotMarkdown = vi.mocked(CopilotMarkdown);

function baseProps(overrides: Partial<SimpleChatMessageRowProps> = {}): SimpleChatMessageRowProps {
  return {
    m: { role: 'user', content: 'hello world' },
    messageKey: 'user-2026-01-01T00:00:00.000Z-0',
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

function renderRow(props: SimpleChatMessageRowProps) {
  return render(<SimpleChatMessageRow {...props} />);
}

afterEach(() => {
  cleanup();
  mockedCopilotMarkdown.mockClear();
});

describe('SimpleChatMessageRow memo 契约', () => {
  it('① 相同 props 重渲染 bail-out：CopilotMarkdown 不重新执行', () => {
    const props = baseProps();
    const { rerender } = renderRow(props);
    expect(mockedCopilotMarkdown).toHaveBeenCalledTimes(1);

    // 父组件重渲染（流式 tick 场景）：displayMessages 数组重建但历史行对象
    // 引用恒定 → 全部 props 身份不变 → 行必须整体跳过。
    rerender(<SimpleChatMessageRow {...props} />);
    rerender(<SimpleChatMessageRow {...props} />);
    expect(mockedCopilotMarkdown).toHaveBeenCalledTimes(1);
  });

  it('② m 对象身份变化必须重渲染（流式行更新路径）', () => {
    const props = baseProps();
    const { rerender } = renderRow(props);
    expect(mockedCopilotMarkdown).toHaveBeenCalledTimes(1);

    const streamingMessage = { role: 'user' as const, content: 'hello world v2' };
    rerender(<SimpleChatMessageRow {...baseProps({ m: streamingMessage })} />);
    expect(mockedCopilotMarkdown).toHaveBeenCalledTimes(2);
  });

  it('回调身份变化同样击穿 memo（保守语义：不稳定回调只退化为现状重渲染）', () => {
    const props = baseProps();
    const { rerender } = renderRow(props);
    expect(mockedCopilotMarkdown).toHaveBeenCalledTimes(1);

    rerender(<SimpleChatMessageRow {...baseProps({ onCopyMessage: vi.fn() })} />);
    expect(mockedCopilotMarkdown).toHaveBeenCalledTimes(2);
  });
});
