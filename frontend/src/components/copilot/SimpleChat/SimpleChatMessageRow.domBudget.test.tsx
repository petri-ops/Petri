import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// BLOCK-331（C-01 长列表虚拟化）— 先量后定形：这里是「量」的机械面。
//
// C-01 的重开条件是「用户实测卡顿」，2026-10-02 的勘察还发现 cv 与 prepend 锚定结构性冲突。
// 虚拟化是不是必要，取决于**每行真实 DOM 成本 × 真实会话长度**这两个数——不是观感。
// 本测把第一个数钉成棘轮：单行渲染出的节点数上限。跌破（行组件变重）即红，
// 避免哪天「顺手加个嵌套」让 500 条会话的节点数翻倍却没人发现。
//
// 第二个数（真实会话长度分布）本机取不到（桌面版 userData 从未落过数据），
// 因此**不据此引入依赖**（react-virtuoso 需用户裁决），只把线性外推数打出来：
// 500 条会话 ≈ 500 × 每行节点数，与 Chromium 的经验阈值（~1 万节点起明显掉帧）对账。
//
// 探针口径：`container.querySelectorAll('*').length`（不含容器自身），
// 与 DOM Inspector 的 "Total nodes" 同一量纲。

const DOM_BUDGET_PER_MESSAGE = 60;
const CHROMIUM_JANK_NODE_THRESHOLD = 10_000;

vi.mock('../copilotMarkdown', () => ({
  CopilotMarkdown: ({ text }: { text: string }) => <div data-testid="md-probe">{text}</div>,
}));

import { SimpleChatMessageRow } from './SimpleChatMessageRow';
import type { SimpleChatMessageRowProps } from './SimpleChatMessageRow';

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

function countNodes(props: SimpleChatMessageRowProps) {
  const { container, unmount } = render(<SimpleChatMessageRow {...props} />);
  const nodes = container.querySelectorAll('*').length;
  unmount();
  return nodes;
}

afterEach(cleanup);

describe('SimpleChatMessageRow DOM 成本（C-01 量级判据）', () => {
  const shapes = {
    user: baseProps({ m: { role: 'user', content: '把 analysis/ 下的 counts 表做一次校对' } }),
    assistant: baseProps({
      m: { role: 'assistant', content: '已校对：3 列 / 128 行，未发现负值。下一步建议跑 preflight。' },
      messageKey: 'assistant-2026-01-01T00:00:01.000Z-1',
    }),
  };

  it('单行节点数不超过预算（行组件变重即红）', () => {
    const measured = Object.fromEntries(
      Object.entries(shapes).map(([key, props]) => [key, countNodes(props)]),
    );
    for (const [key, nodes] of Object.entries(measured)) {
      expect(nodes, `${key} 行渲染了 ${nodes} 个节点`).toBeLessThanOrEqual(DOM_BUDGET_PER_MESSAGE);
    }
    // 打印外推（不设断言：真实会话长度本机不可测，见文件头口径说明）
    const worst = Math.max(...Object.values(measured));
    const extrapolation = [100, 500, 1000].map((n) => `${n} 条 ≈ ${n * worst} 节点`).join(' · ');
    console.log(`[C-01] 每行节点数=${JSON.stringify(measured)}（预算 ${DOM_BUDGET_PER_MESSAGE}）· 外推 ${extrapolation} · ` +
      `Chromium 经验掉帧阈值 ~${CHROMIUM_JANK_NODE_THRESHOLD}`);
  });
});
