import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RightPanel, type RightPanelContext } from './RightPanel';

vi.mock('@/components/copilot/SimpleChat', () => ({ SimpleChat: () => <div>chat</div> }));
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
    openRightTabs: ['files'],
    rightTab: 'files',
    rightToolMenuOpen: false,
    openWorkspaceFiles: [],
    activeWorkspaceFile: null,
    backendStatus: {},
    browserUrl: 'about:blank',
    setRightTab: vi.fn(), setRightToolMenuOpen: vi.fn(), openRightPanel: vi.fn(), closeRightPanelTab: vi.fn(),
    setActiveWorkspaceFile: vi.fn(),
    setBottomTerminalOpen: vi.fn(), setRightOpen: vi.fn(),
    setActiveConvId: vi.fn(), handleAskAgent: vi.fn(), handleOpenWorkspaceFile: vi.fn(),
    handleActivateWorkspaceFile: vi.fn(), handleCloseWorkspaceFiles: vi.fn(),
    handleReorderWorkspaceFiles: vi.fn(), handleRenameWorkspaceFile: vi.fn(),
    handleReopenWorkspaceFile: vi.fn(), hasReopenableWorkspaceFile: false,
    handleWorkspaceFileDirtyMapChange: vi.fn(),
    handleOpenRightBrowser: vi.fn(), handleOpenRightFiles: vi.fn(),
    handleOpenRightChat: vi.fn(), setBrowserUrl: vi.fn(), setBrowserCanGoBack: vi.fn(),
    setBrowserCanGoForward: vi.fn(),
    ...overrides,
  } as unknown as RightPanelContext;
}

describe('item 90 phase 2 RightPanel RS retirement', () => {
  it('never mounts ResultsSurface or EvidenceSurface even if legacy results tab id is present', () => {
    render(<RightPanel ctx={makeCtx({ openRightTabs: ['results', 'files'], rightTab: 'results' })} visible workspaceMode="chat" />);
    expect(screen.queryByTestId('results-surface')).toBeNull();
    expect(screen.queryByTestId('results-surface-off')).toBeNull();
    expect(screen.queryByTestId('evidence-surface')).toBeNull();
    expect(screen.queryByTestId('evidence-surface-off')).toBeNull();
    expect(screen.getByText('files')).toBeTruthy();
  });

  it('keeps overview and files panels functioning normally', () => {
    render(<RightPanel ctx={makeCtx({ rightTab: 'files' })} visible workspaceMode="chat" />);
    expect(screen.getByText('files')).toBeTruthy();
  });
});
