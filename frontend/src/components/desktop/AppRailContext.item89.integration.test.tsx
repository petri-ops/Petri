/**
 * item89 attempt2：等价真实集成验证（owner 要求 CDP 或等价真实渲染路径）。
 * 用真实 AppRailProvider + 真实 LeftPanel 会话列表点击（不 mock 点击 handler），
 * 断言导航后文件面板绑定项目根切到 B 项目、activeConvId=被点会话。
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const CONV_B = 'conv-b2';
const projects = [
  { id: 'p-a', name: 'A项目', workspacePath: '/ws-a', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
  { id: 'p-b', name: 'B项目', workspacePath: '/ws-b', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
];
const convA = { id: 'conv-a1', title: 'A会话', status: 'active' as const, last_page: null, message_count: 1, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', project_id: 'p-a' };
const convB = { id: CONV_B, title: 'B会话', status: 'active' as const, last_page: null, message_count: 1, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', project_id: 'p-b' };

vi.mock('@/lib/project-store', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  listProjects: vi.fn(() => Promise.resolve(projects)),
}));

vi.mock('@/hooks/useConversations', () => ({
  useConversations: (projectId?: string) => ({
    list: projectId === 'p-b' ? [convB] : [convA],
    refresh: vi.fn(),
    loading: false,
  }),
  useOtherConversations: () => ({
    byProjectId: { 'p-a': [convA], 'p-b': [convB] },
    refresh: vi.fn(),
  }),
}));

vi.mock('@/components/common/ToastProvider', () => {
  const noop = () => '';
  return {
    useToast: () => ({ show: noop, success: noop, info: noop, warning: noop, error: noop, dismiss: noop }),
    ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

vi.mock('@/components/copilot/conversationRunStore', () => ({ useConversationRun: () => null }));
vi.mock('@/components/icons/Icon', () => ({ Icon: ({ name }: { name: string }) => <span data-icon={name} /> }));

import { AppRailProvider, useAppRail } from './AppRailContext';
import { LeftPanel, type LeftPanelContext } from '@/components/workspace-panels/LeftPanel';

function LocationProbe(): React.ReactElement {
  const loc = useLocation();
  return <span data-testid="location-probe">{loc.pathname}</span>;
}

function Harness(): React.ReactElement {
  const rail = useAppRail();
  const ctx: LeftPanelContext = {
    width: 280,
    project: projects.find((p) => p.id === rail.currentProjectId) || projects[0],
    visibleProjects: projects,
    projectConversations: { 'p-a': [convA], 'p-b': [convB] },
    projectId: rail.currentProjectId || undefined,
    conversations: rail.conversations,
    activeConvId: rail.activeConvId,
    expandedProjects: new Set(['p-a', 'p-b']),
    creatingProject: false,
    creatingConversation: false,
    createPanel: { open: false, error: '', onOpen: vi.fn(), onPickExternal: vi.fn() },
    createConversationForProject: rail.createConversationForProject,
    renameProject: vi.fn(() => Promise.resolve(true)),
    renameConversation: vi.fn(() => Promise.resolve(true)),
    archiveProject: vi.fn(() => Promise.resolve(true)),
    archiveConversation: vi.fn(() => Promise.resolve(true)),
    forkConversation: vi.fn(() => Promise.resolve(null)),
    workspaceMode: 'chat',
    sshConnectProject: vi.fn(),
    sshConnectHost: vi.fn(() => Promise.resolve({ ok: true, home: '/tmp' })),
    sshListDirs: vi.fn(() => Promise.resolve({ ok: true, path: '/tmp', dirs: [] })),
    sshRegisterHost: vi.fn(() => Promise.resolve({ ok: true, alias: 'x' })),
    sshCreateAt: vi.fn(() => Promise.resolve({ ok: true })),
    handleShowScheduled: vi.fn(),
    handleShowExtensions: vi.fn(),
    handleShowSettings: vi.fn(),
    handleNavigateToKnowledge: vi.fn(),
    handleNavigateToHome: vi.fn(),
    switchToProject: rail.switchToProject,
    handleSwitchConversation: rail.switchConversation,
    switchConversationInProject: rail.switchConversationInProject,
    toggleProjectExpand: rail.toggleProjectExpand,
    handleOpenWorkspacePath: vi.fn(),
    showConversations: true,
  } as unknown as LeftPanelContext;
  return (
    <>
      <LocationProbe />
      {/* 文件面板根目录探针：真实 provider 的 currentProject.workspacePath */}
      <div data-testid="file-root-probe">{rail.currentProject?.workspacePath || ''}</div>
      <div data-testid="active-conv-probe">{rail.activeConvId || ''}</div>
      <LeftPanel ctx={ctx} />
    </>
  );
}

afterEach(cleanup);

describe('item89 跨项目会话点击真实集成', () => {
  it('HK-01 点 B 项目会话后导航到 B、文件根切到 /ws-b、activeConvId=被点会话', async () => {
    render(
      <MemoryRouter initialEntries={['/project/p-a']}>
        <AppRailProvider><Harness /></AppRailProvider>
      </MemoryRouter>,
    );
    const row = await screen.findByText('B会话');
    fireEvent.click(row);
    await waitFor(() => {
      expect(screen.getByTestId('location-probe').textContent).toBe('/project/p-b/chat');
      expect(screen.getByTestId('file-root-probe').textContent).toBe('/ws-b');
      expect(screen.getByTestId('active-conv-probe').textContent).toBe(CONV_B);
    });
  });
});
