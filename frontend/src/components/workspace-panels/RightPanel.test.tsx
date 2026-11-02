import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RightPanel, type RightPanelContext } from './RightPanel';

vi.mock('@/components/copilot/SimpleChat', () => ({ SimpleChat: () => <div>chat</div> }));
// BLOCK-334 — 右栏「结果」tab 的唯一宿主是 ResultsSurface；桩成记录 props 的探针，
// 本文件只断言 RightPanel 的接线（谁在 results tab、active 何时为真），不复测宿主内部。
vi.mock('@/components/work-surface/ResultsSurface', () => ({
  ResultsSurface: ({ active, ctx }: { active: boolean; ctx: Record<string, unknown> }) => (
    <div
      data-testid="results-surface"
      data-active={active ? 'true' : 'false'}
      data-has-context={ctx.resultContext ? 'true' : 'false'}
      data-job={String((ctx.activeJob as { id?: string } | null)?.id ?? '')}
    >
      results-surface
    </div>
  ),
}));
vi.mock('@/pages/project-workspace', () => ({
  EmptyResult: () => <div>empty</div>,
  readLastPanel: () => null,
  writeLastPanel: () => undefined,
  RightFileTree: () => <div>files</div>,
  TerminalPanel: () => <div>terminal</div>,
  BrowserPanel: () => <div>browser</div>,
}));
// RightPanel 渲染树内 useWorkspaceLayout 依赖 WorkspacePanelsContext 非 null
vi.mock('@/components/desktop/WorkspacePanelsContext', () => ({
  useWorkspacePanelsContext: () => ({}),
}));

// RightPanel 渲染树内 useToolCatalog 装载即拉 /api/tools/catalog——无 fetch 桩时
// 真实连接 http://localhost:3001（getApiPrefix 缺省值），后端不在场则向门禁日志
// 泄漏 AggregateError(ECONNREFUSED) 异步栈（BLOCK-148 把本文件经 vitest related
// 拉进 test:changed 影响面后实测）。桩死网络面：目录拉取失败 → 组件回落空目录
// 诚实空态，本文件断言不依赖目录内容。
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 599 } as unknown as Response)));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function makeCtx(overrides: Partial<RightPanelContext> = {}): RightPanelContext {
  return {
    width: 320,
    project: { id: 'project-1', name: 'Project' },
    projectId: 'project-1',
    activeConvId: 'conversation-1',
    openRightTabs: ['results', 'files'],
    rightTab: 'results',
    rightToolMenuOpen: false,
    activeJob: { id: 'job-1', tool_id: 'volcano-plot', status: 'done', created_at: 1 },
    activeWorkflow: null,
    activeArtifact: { jobId: 'job-1', toolId: 'volcano-plot', name: 'volcano.png', type: 'image' },
    jobs: [],
    packResultSurfaces: [],
    resultContext: { status: 'ready', contextToken: 'a'.repeat(64) },
    resultEditControls: null,
    resultEditSubmitting: false,
    resultAgentDraft: '',
    setResultAgentDraft: vi.fn(),
    onResultEditSubmit: vi.fn(),
    openWorkspaceFiles: [],
    activeWorkspaceFile: null,
    pendingArtifactName: null,
    backendStatus: {},
    browserUrl: 'about:blank',
    setRightTab: vi.fn(), setRightToolMenuOpen: vi.fn(), openRightPanel: vi.fn(), closeRightPanelTab: vi.fn(),
    onWorkflowChanged: vi.fn(), setActiveArtifact: vi.fn(), setActiveWorkspaceFile: vi.fn(),
    onPendingArtifactConsumed: vi.fn(), setBottomTerminalOpen: vi.fn(), setRightOpen: vi.fn(),
    setActiveConvId: vi.fn(), handleAskAgent: vi.fn(), handleOpenWorkspaceFile: vi.fn(),
    handleActivateWorkspaceFile: vi.fn(), handleCloseWorkspaceFiles: vi.fn(),
    handleReorderWorkspaceFiles: vi.fn(), handleRenameWorkspaceFile: vi.fn(),
    handleReopenWorkspaceFile: vi.fn(), hasReopenableWorkspaceFile: false,
    handleWorkspaceFileDirtyMapChange: vi.fn(),
    handleOpenResult: vi.fn(), handleOpenRightResults: vi.fn(),
    handleOpenRightBrowser: vi.fn(), handleOpenRightFiles: vi.fn(),
    handleOpenRightChat: vi.fn(), setBrowserUrl: vi.fn(), setBrowserCanGoBack: vi.fn(),
    setBrowserCanGoForward: vi.fn(),
    openRevisionWorkspaceFile: vi.fn(), openResultBrowser: vi.fn(),
    ...overrides,
  } as unknown as RightPanelContext;
}

describe('BLOCK-334 RightPanel results host', () => {
  it('hosts ResultsSurface as the sole results-tab content (Inspector retired)', () => {
    render(<RightPanel ctx={makeCtx()} visible workspaceMode="chat" />);
    const surface = screen.getByTestId('results-surface');
    expect(surface.getAttribute('data-active')).toBe('true');
    expect(surface.getAttribute('data-has-context')).toBe('true');
    expect(surface.getAttribute('data-job')).toBe('job-1');
    expect(screen.queryByText('inspector')).toBeNull();
    expect(screen.queryByText('当前结果')).toBeNull();
  });

  it('keeps the results surface mounted but inactive when another tab is current (WebGL gating input)', () => {
    render(<RightPanel ctx={makeCtx({ rightTab: 'files' })} visible workspaceMode="chat" />);
    const surface = screen.getByTestId('results-surface');
    expect(surface.getAttribute('data-active')).toBe('false');
    expect(screen.getByText('files')).toBeTruthy();
  });
});
