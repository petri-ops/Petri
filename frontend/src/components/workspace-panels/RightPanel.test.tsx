import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RightPanel, type RightPanelContext } from './RightPanel';

vi.mock('@/components/copilot/SimpleChat', () => ({ SimpleChat: () => <div>chat</div> }));
vi.mock('@/components/result-studio/ResultStudioSurface', () => ({
  ResultStudioInspector: ({ context }: { context?: unknown }) => (
    <div data-testid="result-inspector" data-has-context={context ? 'true' : 'false'}>inspector</div>
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
// 诚实空态，本文件断言（抽屉/检查器层级）不依赖目录内容。
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 599 } as unknown as Response)));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('P4R-3 RightPanel editing hierarchy', () => {
  it('keeps only a default-closed advanced parameter drawer; natural language lives in result focus', () => {
    const ctx = {
      width: 320,
      project: { id: 'project-1', name: 'Project' },
      projectId: 'project-1',
      activeConvId: 'conversation-1',
      openRightTabs: ['results'],
      rightTab: 'results',
      rightToolMenuOpen: false,
      activeJob: { id: 'job-1', tool_id: 'volcano-plot', status: 'done', created_at: 1 },
      activeWorkflow: null,
      activeArtifact: { jobId: 'job-1', toolId: 'volcano-plot', name: 'volcano.png', type: 'image' },
      resultContext: { status: 'ready', contextToken: 'a'.repeat(64) },
      resultEditControls: {
        controlsVersion: 1,
        groups: [{ group: 'presentation', label: '外观', parameterNames: ['point_size'] }],
        controls: [{
          name: 'point_size', controlType: 'number', impact: 'presentation', group: 'presentation',
          default: 1.8, required: false, scientificallyNeutral: true,
        }],
        diagnostics: [],
        currentValues: { point_size: 1.8 },
      },
      resultEditSubmitting: false,
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
      handleOpenRightTerminal: vi.fn(), handleOpenRightBrowser: vi.fn(), handleOpenRightFiles: vi.fn(),
      handleOpenRightChat: vi.fn(), setBrowserUrl: vi.fn(), setBrowserCanGoBack: vi.fn(),
      setBrowserCanGoForward: vi.fn(),
    } as unknown as RightPanelContext;

    const view = render(<RightPanel ctx={ctx} visible workspaceMode="result" />);
    const drawer = document.querySelector('details[aria-label="高级精细调整"]');
    expect(drawer).toBeTruthy();
    expect(drawer?.hasAttribute('open')).toBe(false);
    expect(screen.queryByText(/告诉 Agent 你想怎么改/)).toBeNull();
    expect(screen.getByTestId('result-inspector').getAttribute('data-has-context')).toBe('false');

    view.rerender(<RightPanel ctx={ctx} visible workspaceMode="code" />);
    expect(screen.getByTestId('result-inspector').getAttribute('data-has-context')).toBe('true');
  });
});
