import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CenterPanel, type CenterPanelContext, type CenterPanelRefs } from './CenterPanel';

vi.mock('@/components/copilot/SimpleChat', () => ({
  SimpleChat: () => <div data-testid="persistent-chat">Agent conversation</div>,
}));
vi.mock('@/components/copilot/conversationRunStore', () => ({
  useConversationRun: () => null,
  useConversationTodoList: () => [],
  useConversationCitations: () => [],
  // UI-448 — 让位测试会把悬浮面置为开态，把手呼吸灯路径首次被该测试文件踩到
  isConversationRunning: () => false,
}));
vi.mock('@/hooks/useDurableConversationLoop', () => ({
  useDurableConversationLoop: () => ({ loop: null, summary: null }),
}));
vi.mock('@/components/workspace-panels/WorkspaceSummaryCard', () => ({ WorkspaceSummaryCard: () => <div>summary</div> }));
vi.mock('@/components/workspace-panels/ScheduledWorkspacePanel', () => ({ ScheduledWorkspacePanel: () => <div>task</div> }));

afterEach(cleanup);

// BLOCK-334 — 中央 result/code/compare/history 四态退役：结果投影、pack 接管、身份
// 水化、BIO-6 prompt 等用例迁址 work-surface/ResultsSurface.test.tsx；本文件只剩
// 会话常驻与摘要卡形态。
function context(mode: CenterPanelContext['workspaceMode']): CenterPanelContext {
  return {
    project: { id: 'project-1', name: 'Project One' },
    projectId: 'project-1',
    activeConvId: 'conversation-1', conversations: [],
    workspaceMode: mode,
    // Derived exactly as production does: pinned summary is chat/scheduled only.
    showPinnedSummary: mode === 'chat' || mode === 'scheduled',
    bottomTerminalOpen: false, bottomTerminalHeight: 0, inputHeight: 120,
    summaryCardOpen: false, summaryVisibility: 'hidden', summaryOpenWidth: 0,
    activeJob: { id: 'job-1', tool_id: 'deseq2', status: 'done', created_at: 1 },
    activeWorkflow: { jobStatus: 'done', artifactTruth: { status: 'valid' } },
    recentJobs: [], liveJobsPreview: [],
    jobStats: { running: 0, failed: 0, done: 1, pending: 0 }, backendStatus: {} as CenterPanelContext['backendStatus'],
    datasets: [],
    updateWorkspaceMode: vi.fn(), openRightPanel: vi.fn(),
    handleSwitchConversation: vi.fn(), setActiveConvId: vi.fn(), setActiveJobId: vi.fn(),
    openScheduledResults: vi.fn(),
  } as unknown as CenterPanelContext;
}

const refs: CenterPanelRefs = { centerColRef: { current: null }, sessionFrameRef: { current: null } };

describe('CenterPanel conversation projection', () => {
  it('keeps the Agent conversation mounted while the scheduled panel owns the visible center', () => {
    render(<CenterPanel ctx={context('scheduled')} refs={refs} />);
    expect(screen.getByTestId('persistent-chat')).toBeTruthy();
    expect(screen.getByText('task')).toBeTruthy();
    const conversation = document.querySelector('[data-projection="conversation"]');
    expect(conversation?.getAttribute('aria-hidden')).toBe('true');
  });

  it('never projects a result body in the center column (BLOCK-334 四态退役)', () => {
    render(<CenterPanel ctx={context('chat')} refs={refs} />);
    expect(document.querySelector('[data-projection="result"]')).toBeNull();
    expect(document.querySelector('[data-projection="conversation"]')?.getAttribute('aria-hidden')).toBe('false');
  });

  // UI-351 — 中栏过窄时摘要卡转悬浮层（绝对定位），不再占列宽也不再整体消失
  it('renders the summary card in a floating overlay when visibility is float (UI-351)', () => {
    const ctx = context('chat');
    ctx.showPinnedSummary = true;
    ctx.summaryCardOpen = true;
    ctx.summaryVisibility = 'float';
    render(<CenterPanel ctx={ctx} refs={refs} />);
    expect(document.querySelector('[class*="workspaceSummaryFloat"]')).toBeTruthy();
    expect(document.querySelector('[class*="workspaceSummaryColumn"]')).toBeNull();
  });

  it('keeps the pinned summary column for compact/expanded visibility (UI-351 回归)', () => {
    const ctx = context('chat');
    ctx.showPinnedSummary = true;
    ctx.summaryCardOpen = true;
    ctx.summaryVisibility = 'compact';
    render(<CenterPanel ctx={ctx} refs={refs} />);
    expect(document.querySelector('[class*="workspaceSummaryColumn"]')).toBeTruthy();
    expect(document.querySelector('[class*="workspaceSummaryFloat"]')).toBeNull();
  });

  // UI-448 加映 v23 — 会话浮面纯悬浮（用户双图对比裁决：摘要点击就悬浮，
  // 会话却把消息框向左推）——让位机制整体退役，开合态消息列恒全宽。
  it('never yields the conversation column for the side chat float (UI-448 加映 v23 纯悬浮)', () => {
    const { unmount } = render(<CenterPanel ctx={context('chat')} refs={refs} />);
    expect(document.querySelector('[class*="agentMainSideChatYield"]')).toBeNull();
    unmount();
    const ctx = context('chat');
    render(<CenterPanel ctx={ctx} refs={refs} />);
    expect(document.querySelector('[class*="agentMainSideChatYield"]')).toBeNull();
  });

  // UI-627（BLOCK-321）— v9/v10 侧聊 dock 挂载与让位类测试随页内悬浮面退役
  // （side-chat 升级为原生独立窗 /window/side-chat，见 SideChatWindowPage.test.tsx）。

  // UI-448 加映 v23 — 让位退役后的恒定不变式：摘要钉住列形态同样不推挤
  // （原 v11「钉住列跳过让位/浮层保留让位」两个分叉用例随机制一并退役）。
  it('keeps full-width content in every summary form (v23 不变式；UI-627 后无让位机制)', () => {
    for (const visibility of ['expanded', 'float'] as const) {
      const ctx = context('chat');
      ctx.summaryCardOpen = true;
      ctx.summaryVisibility = visibility;
      const { unmount } = render(<CenterPanel ctx={ctx} refs={refs} />);
      expect(document.querySelector('[class*="agentMainSideChatYield"]')).toBeNull();
      unmount();
    }
  });
});

// UI-448 加映 v26 — 摘要钉住列形态同样带拖宽把手（v25 只适配了悬浮形态）
it('renders the resize handle on the pinned summary column (UI-448 加映 v26)', () => {
  const ctx = context('chat');
  ctx.showPinnedSummary = true;
  ctx.summaryCardOpen = true;
  ctx.summaryVisibility = 'expanded';
  render(<CenterPanel ctx={ctx} refs={refs} />);
  const column = document.querySelector('[class*="workspaceSummaryColumn"]');
  expect(column).toBeTruthy();
  expect(column?.querySelector('[data-testid="float-card-resize-handle"]')).toBeTruthy();
});
