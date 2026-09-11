import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CenterPanel, type CenterPanelContext } from './CenterPanel';

vi.mock('@/components/copilot/SimpleChat', () => ({
  SimpleChat: () => <div data-testid="persistent-chat">Agent conversation</div>,
}));
vi.mock('@/components/copilot/conversationRunStore', () => ({
  useConversationRun: () => null,
  resultEditProgressForContext: () => [],
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
    centerColRef: { current: null }, sessionFrameRef: { current: null },
    bottomTerminalOpen: false, bottomTerminalHeight: 0, leftOpen: true, rightOpen: true, inputHeight: 120,
    summaryCardOpen: false, summaryVisibility: 'hidden', summaryOpenWidth: 0,
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

describe('G0-RS-P1 CenterPanel projection', () => {
  it('keeps the Agent conversation mounted while the result owns the visible center', () => {
    const ctx = context('result');
    render(<CenterPanel ctx={ctx} />);
    expect(screen.getByTestId('persistent-chat')).toBeTruthy();
    expect(screen.getByTestId('persistent-chat').closest('[data-projection="conversation"]')?.getAttribute('aria-hidden')).toBe('true');
    expect(screen.getAllByTestId('central-result-view')).toHaveLength(1);
    expect(screen.queryByText('发现稳定差异表达信号。')).toBeNull();
    const composer = screen.getByRole('region', { name: '用 Agent 修改当前结果' });
    expect(composer.closest('[aria-label="结果主画布"]')).toBeTruthy();
  });

  it('returns to the same conversation projection through the visible context action', () => {
    const ctx = context('result');
    render(<CenterPanel ctx={ctx} />);
    fireEvent.click(screen.getByRole('button', { name: '返回对话' }));
    expect(ctx.updateWorkspaceMode).toHaveBeenCalledWith('chat');
  });

  it.each(['code', 'compare', 'history'] as const)('renders %s as a distinct central mode without the edit Composer', (mode) => {
    const ctx = context(mode);
    render(<CenterPanel ctx={ctx} />);
    expect(screen.getByTestId('central-result-view').getAttribute('data-mode')).toBe(mode);
    expect(screen.queryByRole('region', { name: '用 Agent 修改当前结果' })).toBeNull();
    expect(screen.getByRole('region', { name: '结果主画布' }).getAttribute('data-mode')).toBe(mode);
  });

  it('routes the visible review and history actions through the workspace state owner', () => {
    const ctx = context('result');
    render(<CenterPanel ctx={ctx} />);
    fireEvent.click(screen.getByRole('button', { name: '审查' }));
    fireEvent.click(screen.getByRole('button', { name: '历史' }));
    expect(ctx.updateWorkspaceMode).toHaveBeenCalledWith('compare', true, 'job-1');
    expect(ctx.updateWorkspaceMode).toHaveBeenCalledWith('history', true, 'job-1');
  });
});
