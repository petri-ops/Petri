import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
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
    project: { id: 'project-1', name: 'Project One' },
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
    createProjectFromDirectory: vi.fn(),
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
    switchToProject: vi.fn(),
    handleSwitchConversation: vi.fn(),
    toggleProjectExpand: vi.fn(),
    handleOpenWorkspacePath: vi.fn(),
    handleChangeWorkspacePath: vi.fn(),
  } as unknown as LeftPanelContext;
}

describe('BLOCK-14 LeftPanel QuickActions a11y', () => {
  it('marks search quick-action with aria-current="page" when workspaceMode is search', () => {
    render(<LeftPanel ctx={buildCtx('search')} />);
    const searchBtn = screen.getByRole('button', { name: '搜索' });
    expect(searchBtn.getAttribute('aria-current')).toBe('page');
  });

  it('marks plugins quick-action with aria-current="page" when workspaceMode is plugins', () => {
    render(<LeftPanel ctx={buildCtx('plugins')} />);
    const pluginsBtn = screen.getByRole('button', { name: '插件' });
    expect(pluginsBtn.getAttribute('aria-current')).toBe('page');
  });

  it('marks footer settings button with aria-current="page" when workspaceMode is settings', () => {
    render(<LeftPanel ctx={buildCtx('settings')} />);
    const settingsBtn = screen.getAllByRole('button', { name: '设置' });
    expect(settingsBtn[0].getAttribute('aria-current')).toBe('page');
  });

  it('does not set aria-current="page" on inactive quick-action buttons', () => {
    render(<LeftPanel ctx={buildCtx('result')} />);
    const searchBtn = screen.getByRole('button', { name: '搜索' });
    const pluginsBtn = screen.getByRole('button', { name: '插件' });
    const skillsBtn = screen.getByRole('button', { name: 'Skills' });
    expect(searchBtn.getAttribute('aria-current')).toBeNull();
    expect(pluginsBtn.getAttribute('aria-current')).toBeNull();
    expect(skillsBtn.getAttribute('aria-current')).toBeNull();
  });

  it('preserves the natural Tab order from JSX (no tabindex on quick-action buttons)', () => {
    render(<LeftPanel ctx={buildCtx('result')} />);
    const searchBtn = screen.getByRole('button', { name: '搜索' });
    const pluginsBtn = screen.getByRole('button', { name: '插件' });
    const skillsBtn = screen.getByRole('button', { name: 'Skills' });
    expect(searchBtn.getAttribute('tabindex')).toBeNull();
    expect(pluginsBtn.getAttribute('tabindex')).toBeNull();
    expect(skillsBtn.getAttribute('tabindex')).toBeNull();
  });

  it('exposes all 4 quick-entry buttons by accessible name (3 QuickActions + 1 footer Settings)', () => {
    render(<LeftPanel ctx={buildCtx('result')} />);
    expect(screen.getByRole('button', { name: '搜索' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '插件' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Skills' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: '设置' })).toHaveLength(1);
  });
});
