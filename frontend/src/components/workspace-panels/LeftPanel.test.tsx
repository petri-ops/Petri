import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LeftPanel, type LeftPanelContext } from './LeftPanel';
import type { WorkspaceMode } from '@/hooks/useWorkspaceRouting';

vi.mock('@/components/copilot/conversationRunStore', () => ({
  useConversationRun: () => null,
}));

vi.mock('@/components/icons/Icon', () => ({
  Icon: ({ name }: { name: string }) => <span data-icon={name} />,
}));

afterEach(cleanup);

function buildCtx(workspaceMode: WorkspaceMode): LeftPanelContext {
  return {
    width: 280,
    project: {
      id: 'project-1',
      name: 'Project One',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    workspacePath: '/tmp/project-one',
    compactWorkspacePath: '/tmp/project-one',
    visibleProjects: [],
    projectConversations: {},
    projectId: 'project-1',
    conversations: [],
    activeConvId: null,
    expandedProjects: new Set<string>(),
    creatingProject: false,
    creatingConversation: false,
    createPanel: {
      open: false, // UI-304 简化版 — 不再需要面板
      error: '',
      onOpen: vi.fn(),
      onPickExternal: vi.fn(),
    },
    createConversationForProject: vi.fn(),
    renameProject: vi.fn(async () => true),
    renameConversation: vi.fn(async () => true),
    archiveProject: vi.fn(async () => true),
    archiveConversation: vi.fn(async () => true),
    forkConversation: vi.fn(async () => null),
    workspaceMode,
    handleShowSearch: vi.fn(),
    handleShowScheduled: vi.fn(),
    handleShowPlugins: vi.fn(),
    handleShowSettings: vi.fn(),
    handleNavigateToSkills: vi.fn(),
    handleNavigateToKnowledge: vi.fn(),
    handleNavigateToBackend: vi.fn(),
    switchToProject: vi.fn(),
    handleSwitchConversation: vi.fn(),
    toggleProjectExpand: vi.fn(),
    handleOpenWorkspacePath: vi.fn(),
    showConversations: true,
  };
}

describe('BLOCK-14 LeftPanel QuickActions a11y', () => {
  it('marks search quick-action with aria-current="page" when workspaceMode is search', () => {
    const ctx = buildCtx('search');
    render(
      <MemoryRouter>
        <LeftPanel ctx={ctx} />
      </MemoryRouter>
    );
    const searchBtn = screen.getByRole('button', { name: /搜索/ });
    expect(searchBtn.getAttribute('aria-current')).toBe('page');
  });

  it('calls onOpen when the + button is clicked (UI-304 简化版 - 直接触发原生面板)', () => {
    const ctx = buildCtx('chat');
    render(
      <MemoryRouter>
        <LeftPanel ctx={ctx} />
      </MemoryRouter>
    );
    const plusBtn = screen.getByRole('button', { name: /新建项目/ });
    fireEvent.click(plusBtn);
    expect(ctx.createPanel.onOpen).toHaveBeenCalled();
  });

  it('displays error message when createPanel.error is set', () => {
    const ctx = buildCtx('chat');
    ctx.createPanel.error = '路径无效';
    render(
      <MemoryRouter>
        <LeftPanel ctx={ctx} />
      </MemoryRouter>
    );
    // UI-304 简化版 — 错误会显示在面板中
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe('路径无效');
  });

  it('renders project tree rows for visibleProjects (ProjectNode 回归)', () => {
    const ctx = buildCtx('chat');
    ctx.visibleProjects = [ctx.project];
    render(
      <MemoryRouter>
        <LeftPanel ctx={ctx} />
      </MemoryRouter>
    );
    expect(screen.getByText('Project One').textContent).toBe('Project One');
    expect(screen.getByRole('button', { name: /创建新对话/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /移入回收站/ })).toBeTruthy();
  });
});
