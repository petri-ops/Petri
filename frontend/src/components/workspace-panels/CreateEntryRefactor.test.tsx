/**
 * item 26 创建入口重构 — HK-01 红绿先行契约
 * 新建任务→welcome 任务创建页（试用反馈①修正；原 item26 为点即建会话）/ 项目区➕撤销 / 🌐并入 home 统一面板 /
 * 拖拽建项目链保留 / home 明确「新建项目」唯一入口。
 */
import React from 'react';
import fs from 'node:fs';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LeftPanel, type LeftPanelContext } from './LeftPanel';
import type { Project } from '@/lib/project-types';

vi.mock('@/components/copilot/conversationRunStore', () => ({ useConversationRun: () => null }));
vi.mock('@/components/copilot/copilotConversationsClient', () => ({
  listConversations: vi.fn(() => Promise.resolve([])),
}));
vi.mock('@/components/icons/Icon', () => ({ Icon: ({ name }: { name: string }) => <span data-icon={name} /> }));

afterEach(cleanup);

function ctxWith(overrides: Partial<LeftPanelContext> = {}): LeftPanelContext {
  const project: Project = {
    id: 'p1',
    name: 'P1',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
  return {
    width: 280,
    project,
    workspacePath: '/tmp/p1',
    compactWorkspacePath: '/tmp/p1',
    visibleProjects: [],
    projectConversations: {},
    projectId: 'p1',
    conversations: [],
    activeConvId: null,
    expandedProjects: new Set<string>(),
    creatingProject: false,
    creatingConversation: false,
    createPanel: { open: false, error: '', onOpen: vi.fn(), onPickExternal: vi.fn() },
    createConversationForProject: vi.fn(),
    renameProject: vi.fn(() => Promise.resolve(true)),
    renameConversation: vi.fn(() => Promise.resolve(true)),
    archiveProject: vi.fn(() => Promise.resolve(true)),
    archiveConversation: vi.fn(() => Promise.resolve(true)),
    forkConversation: vi.fn(() => Promise.resolve(null)),
    workspaceMode: 'chat',
    sshConnectProject: vi.fn(),
    sshConnectHost: vi.fn(() => Promise.resolve({ ok: true, home: '/root' })),
    sshListDirs: vi.fn(() => Promise.resolve({ ok: true, path: '/root', dirs: [] })),
    sshRegisterHost: vi.fn(() => Promise.resolve({ ok: true, alias: 'a' })),
    sshCreateAt: vi.fn(() => Promise.resolve({ ok: true })),
    handleShowScheduled: vi.fn(),
    handleShowExtensions: vi.fn(),
    handleShowSettings: vi.fn(),
    handleNavigateToKnowledge: vi.fn(),
    handleNavigateToHome: vi.fn(),
    switchToProject: vi.fn(),
    handleSwitchConversation: vi.fn(),
    toggleProjectExpand: vi.fn(),
    handleOpenWorkspacePath: vi.fn(),
    showConversations: true,
    ...overrides,
  };
}

function LocationProbe(): React.ReactElement {
  const loc = useLocation();
  return <span data-testid="location-probe">{loc.pathname + loc.search}</span>;
}

describe('item26 创建入口重构', () => {
  it('「新建任务」按钮走 ctx.handleNavigateToHome（壳层现映射去 welcome 任务创建页，显式定项目上下文）', () => {
    const ctx = ctxWith();
    render(<MemoryRouter><LeftPanel ctx={ctx} /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: '新建任务' }));
    expect(ctx.handleNavigateToHome).toHaveBeenCalledTimes(1);
    expect(ctx.createPanel.onOpen).not.toHaveBeenCalled();
  });

  it('项目区 ➕ 建项目按钮撤销（不再有 /新建项目/ 图标按钮触发 createPanel.onOpen）', () => {
    const ctx = ctxWith();
    render(<MemoryRouter><LeftPanel ctx={ctx} /></MemoryRouter>);
    expect(screen.queryByRole('button', { name: /新建项目/ })).toBeNull();
    expect(ctx.createPanel.onOpen).not.toHaveBeenCalled();
  });

  it('🌐 SSH 入口并入 home 统一面板：点击跳 /?create=ssh，不再渲染行内向导', () => {
    const ctx = ctxWith();
    render(
      <MemoryRouter initialEntries={['/project/p1/chat']}>
        <LeftPanel ctx={ctx} />
        <LocationProbe />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: '新建 SSH 远程项目' }));
    expect(screen.getByTestId('location-probe').textContent).toBe('/?create=ssh');
    expect(screen.queryByTestId('left-ssh-create-panel')).toBeNull();
  });

  it('拖拽建项目链保留：外部路径仍走 onPickExternal（➕ 撤销不影响迁移依赖）', () => {
    const ctx = ctxWith();
    const pathForFile = vi.fn(() => '/tmp/dropped');
    const validateDirectory = vi.fn(() => Promise.resolve({ ok: true, data: { path: '/tmp/dropped' } }));
    Object.defineProperty(window, 'petriDesktop', {
      configurable: true,
      value: { files: { pathForFile, validateDirectory } },
    });
    render(<MemoryRouter><LeftPanel ctx={ctx} /></MemoryRouter>);
    const wrap = document.querySelector('[class*="leftPanelWrap"]') as HTMLElement;
    const file = new File([''], 'dropped');
    fireEvent.drop(wrap, { dataTransfer: { files: [file] } });
    expect(validateDirectory).toHaveBeenCalled();
  });
});

describe('item26 home 唯一创建入口', () => {
  it('源码：工作台创建区标题明确「新建项目」，且支持 ?create=ssh 自动展开', () => {
    // 静态取证：避免为标题文案单独启动 home 重依赖栈（功能契约由现有 home 测试守护）
    const src = fs.readFileSync('src/pages/home.tsx', 'utf-8');
    expect(src).toMatch(/创建新项目|新建项目/);
    expect(src).toMatch(/create.*ssh|create=ssh/);
  });
});
