import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CenterPanel, type CenterPanelContext, type CenterPanelRefs } from './CenterPanel';

vi.mock('@/components/copilot/SimpleChat', () => ({
  SimpleChat: () => <div data-testid="persistent-chat">Agent conversation</div>,
}));
vi.mock('@/components/copilot/conversationRunStore', () => ({
  useConversationRun: () => null,
  useConversationTodoList: () => [],
  useConversationCitations: () => [],
  resultEditProgressForContext: () => [],
  // UI-448 — 让位测试会把悬浮面置为开态，把手呼吸灯路径首次被该测试文件踩到
  isConversationRunning: () => false,
}));
vi.mock('@/hooks/useDurableConversationLoop', () => ({
  useDurableConversationLoop: () => ({ loop: null, summary: null }),
}));
vi.mock('@/components/desktop/PluginStorePanel', () => ({ PluginStorePanel: () => <div>plugins</div> }));
vi.mock('@/components/desktop/DesktopSettingsPanel', () => ({ DesktopSettingsPanel: () => <div>settings</div> }));
vi.mock('@/components/workspace-panels/WorkspaceSummaryCard', () => ({ WorkspaceSummaryCard: () => <div>summary</div> }));
vi.mock('@/components/workspace-panels/ScheduledWorkspacePanel', () => ({ ScheduledWorkspacePanel: () => <div>task</div> }));
vi.mock('@/components/workspace-panels/ResultView', () => ({
  ResultView: ({
    mode,
    onBack,
    onModeChange,
  }: {
    mode: string;
    onBack?: () => void;
    onModeChange?: (mode: string) => void;
  }) => (
    <div data-testid="central-result-view" data-mode={mode}>
      result body
      {mode === 'result' && (
        <>
          <button type="button" onClick={onBack}>返回对话</button>
          <button type="button" onClick={() => onModeChange?.('compare')}>审查</button>
          <button type="button" onClick={() => onModeChange?.('history')}>历史</button>
        </>
      )}
    </div>
  ),
}));

afterEach(cleanup);

function context(mode: CenterPanelContext['workspaceMode']): CenterPanelContext {
  return {
    project: { id: 'project-1', name: 'Project One' },
    projectId: 'project-1',
    allProjects: [], activeConvId: 'conversation-1', conversations: [], projectConversations: {},
    workspaceMode: mode,
    // Derived exactly as production does (project-workspace.tsx:932). Hardcoding
    // this to true put the fixture in a state production cannot reach, so the
    // assertion below passed while the conversation was in fact unmounted in
    // result mode — the precise requirement this test is named for.
    showPinnedSummary: mode === 'chat' || mode === 'scheduled',
    bottomTerminalOpen: false, bottomTerminalHeight: 0, leftOpen: true, rightOpen: true, inputHeight: 120,
    summaryCardOpen: false, summaryVisibility: 'hidden', summaryOpenWidth: 0,
    sideChatOpen: false,
    activeJob: { id: 'job-1', tool_id: 'deseq2', status: 'done', created_at: 1 },
    activeWorkflow: { jobStatus: 'done', artifactTruth: { status: 'valid' } },
    activeArtifact: {
      jobId: 'job-1', toolId: 'deseq2', name: 'deg.csv', type: 'table', label: '差异表达结果',
      revisionId: 'revision-abcdef123456', artifactFamilyId: 'family-1', truthStatus: 'valid', conclusion: '发现稳定差异表达信号。',
    },
    resultContext: { status: 'ready', contextToken: 'a'.repeat(64) },
    resultEditSubmitting: false,
    resultAgentDraft: '',
    activeJobId: 'job-1', pendingArtifactName: null, recentJobs: [], liveJobsPreview: [],
    jobStats: { running: 0, failed: 0, done: 1, pending: 0 }, backendStatus: {} as CenterPanelContext['backendStatus'],
    jobs: [], datasets: [],
    updateWorkspaceMode: vi.fn(), openRightPanel: vi.fn(), switchToProject: vi.fn(), navigate: vi.fn(),
    setActiveConvId: vi.fn(), setActiveJobId: vi.fn(), setActiveArtifact: vi.fn(), setBottomTerminalOpen: vi.fn(),
    setResultAgentDraft: vi.fn(), onResultEditSubmit: vi.fn(),
    setLeftOpen: vi.fn(), setRightOpen: vi.fn(), setSummaryOpen: vi.fn(), handleShowPlugins: vi.fn(), handleOpenResult: vi.fn(),
    handleAskAgent: vi.fn(), handleOpenWorkspacePath: vi.fn(), onPendingArtifactConsumed: vi.fn(), onWorkflowChanged: vi.fn(),
    openResultBrowser: vi.fn(), openScheduledResults: vi.fn(), startColumnResize: vi.fn(),
  } as unknown as CenterPanelContext;
}


const refs: CenterPanelRefs = { centerColRef: { current: null }, sessionFrameRef: { current: null } };

describe('G0-RS-P1 CenterPanel projection', () => {
  it('keeps the Agent conversation mounted while the result owns the visible center', () => {
    const ctx = context('result');
    render(<CenterPanel ctx={ctx} refs={refs} />);
    expect(screen.getByTestId('persistent-chat')).toBeTruthy();
    expect(screen.getByTestId('persistent-chat').closest('[data-projection="conversation"]')?.getAttribute('aria-hidden')).toBe('true');
    expect(screen.getAllByTestId('central-result-view')).toHaveLength(1);
    expect(screen.queryByText('发现稳定差异表达信号。')).toBeNull();
    const composer = screen.getByRole('region', { name: '用 Agent 修改当前结果' });
    expect(composer.closest('[aria-label="结果主画布"]')).toBeTruthy();
  });

  it('returns to the same conversation projection through the visible context action', () => {
    const ctx = context('result');
    render(<CenterPanel ctx={ctx} refs={refs} />);
    fireEvent.click(screen.getByRole('button', { name: '返回对话' }));
    expect(ctx.updateWorkspaceMode).toHaveBeenCalledWith('chat');
  });

  it.each(['code', 'compare', 'history'] as const)('renders %s as a distinct central mode without the edit Composer', (mode) => {
    const ctx = context(mode);
    render(<CenterPanel ctx={ctx} refs={refs} />);
    expect(screen.getByTestId('central-result-view').getAttribute('data-mode')).toBe(mode);
    expect(screen.queryByRole('region', { name: '用 Agent 修改当前结果' })).toBeNull();
    expect(screen.getByRole('region', { name: '结果主画布' }).getAttribute('data-mode')).toBe(mode);
  });

  it('routes the visible review and history actions through the workspace state owner', () => {
    const ctx = context('result');
    render(<CenterPanel ctx={ctx} refs={refs} />);
    fireEvent.click(screen.getByRole('button', { name: '审查' }));
    fireEvent.click(screen.getByRole('button', { name: '历史' }));
    expect(ctx.updateWorkspaceMode).toHaveBeenCalledWith('compare', true, 'job-1');
    expect(ctx.updateWorkspaceMode).toHaveBeenCalledWith('history', true, 'job-1');
  });

  // BIO-6（BIO-D4 裁决 b：单一真相）— 询问 Agent 的解读 prompt 必须锚定任务
  // 与产物坐标，并强制 Agent 先经 result_summary 读有界真值，不接遗留模板。
  it('询问 Agent prompt 锚定任务与产物坐标并强制 result_summary 真值（BIO-6）', () => {
    const ctx = context('compare');
    render(<CenterPanel ctx={ctx} refs={refs} />);
    fireEvent.click(screen.getByRole('button', { name: '询问 Agent' }));
    expect(ctx.handleAskAgent).toHaveBeenCalledTimes(1);
    const prompt = String((ctx.handleAskAgent as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(prompt).toContain('result_summary');
    expect(prompt).toContain('job-1');
    expect(prompt).toContain('deg.csv');
    expect(prompt).toContain('不得编造');
    // 遗留模板措辞退役：解读真相只剩 Agent + result_summary 链一条
    expect(prompt).not.toContain('请解释当前结果');
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
    const openCtx = context('chat');
    openCtx.sideChatOpen = true;
    const { unmount } = render(<CenterPanel ctx={openCtx} refs={refs} />);
    expect(document.querySelector('[class*="agentMainSideChatYield"]')).toBeNull();
    unmount();
    const ctx = context('chat');
    render(<CenterPanel ctx={ctx} refs={refs} />);
    expect(document.querySelector('[class*="agentMainSideChatYield"]')).toBeNull();
  });

  // UI-448 加映 v9 — 会话面板开启时布局挂常驻类（摘要悬浮封顶上半，两卡不叠加）
  it('marks the session layout while the side chat dock is open (UI-448 加映 v9)', () => {
    const openCtx = context('chat');
    openCtx.sideChatOpen = true;
    const { unmount } = render(<CenterPanel ctx={openCtx} refs={refs} />);
    expect(document.querySelector('[class*="workspaceSessionLayoutSideChatOpen"]')).toBeTruthy();
    unmount();
    const ctx = context('chat');
    render(<CenterPanel ctx={ctx} refs={refs} />);
    expect(document.querySelector('[class*="workspaceSessionLayoutSideChatOpen"]')).toBeNull();
  });

  // UI-448 加映 v23 — 让位退役后的恒定不变式：摘要钉住列形态同样不推挤
  // （原 v11「钉住列跳过让位/浮层保留让位」两个分叉用例随机制一并退役）。
  it('keeps full-width content in every summary form while the side chat is open (v23)', () => {
    for (const visibility of ['expanded', 'float'] as const) {
      const ctx = context('chat');
      ctx.sideChatOpen = true;
      ctx.summaryCardOpen = true;
      ctx.summaryVisibility = visibility;
      const { unmount } = render(<CenterPanel ctx={ctx} refs={refs} />);
      expect(document.querySelector('[class*="agentMainSideChatYield"]')).toBeNull();
      unmount();
    }
  });

  // UI-448 加映 v10 — 面板与摘要卡同定位基准：dock 挂载于 session layout 内部
  it('mounts the dock inside the session layout (UI-448 加映 v10 summary-parity)', () => {
    const ctx = context('chat');
    render(<CenterPanel ctx={ctx} refs={refs} />);
    const dock = document.querySelector("[data-testid='side-chat-dock']");
    const layout = document.querySelector("[class*='workspaceSessionLayout']");
    expect(dock).toBeTruthy();
    expect(layout?.contains(dock ?? null)).toBe(true);
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
