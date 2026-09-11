import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Welcome from './welcome';
import { branchApi } from '@/lib/branchBridge';
import {
  connectSshHost,
  createProject,
  listProjects,
  listSshRemoteDirs,
  listSshTargetCandidates,
  validateSshProject,
} from '@/lib/project-store';
import { dispatchGewuEvent, gewuEvents } from '@/lib/events';
import type { Project } from '@/lib/project-types';

vi.mock('@/components/backend/BackendStatusProvider', () => ({
  useBackendStatus: () => ({ serverUp: true, isReady: true, loaded: true }),
}));

// 内嵌聊天模块整体 mock：断言挂载契约（projectId / conversationId=null / ownsCopilotAsk / composerOnly）
vi.mock('@/components/copilot/SimpleChat', () => ({
  SimpleChat: (props: {
    projectId: string;
    conversationId: string | null;
    ownsCopilotAsk?: boolean;
    composerOnly?: boolean;
    onConversationChange?: (id: string) => void;
  }) => (
    <div
      data-testid="simple-chat"
      data-project={props.projectId}
      data-conv={String(props.conversationId)}
      data-owns={String(props.ownsCopilotAsk === true)}
      data-composer-only={String(props.composerOnly === true)}
    />
  ),
}));

vi.mock('@/lib/branchBridge', () => ({
  branchApi: { list: vi.fn() },
}));

vi.mock('@/lib/project-store', () => ({
  listProjects: vi.fn(),
  createProject: vi.fn(),
  listSshTargetCandidates: vi.fn(),
  validateSshProject: vi.fn(),
  connectSshHost: vi.fn(),
  listSshRemoteDirs: vi.fn(),
}));

// dispatchGewuEvent 必须是 spy；gewuEvents 常量保持真实实现（断言引用同一常量）
vi.mock('@/lib/events', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/events')>();
  return { ...actual, dispatchGewuEvent: vi.fn() };
});

// FolderPicker stub 保留 onCancel 契约，覆盖面板的取消路径
vi.mock('@/components/desktop/FolderPicker', () => ({
  FolderPicker: (props: { onCancel?: () => void }) => (
    <div data-testid="folder-picker-stub">
      folder-picker-stub
      <button type="button" onClick={() => props.onCancel?.()}>取消选择</button>
    </div>
  ),
}));

const mockListProjects = vi.mocked(listProjects);
const mockCreateProject = vi.mocked(createProject);
const mockListSshTargets = vi.mocked(listSshTargetCandidates);
const mockValidateSsh = vi.mocked(validateSshProject);
const mockConnectSshHost = vi.mocked(connectSshHost);
const mockListSshRemoteDirs = vi.mocked(listSshRemoteDirs);
const mockBranchList = vi.mocked(branchApi.list);
const mockDispatchGewuEvent = vi.mocked(dispatchGewuEvent);

const projectA: Project = {
  id: 'p_a', name: '阿尔法项目', createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-09T00:00:00Z',
};
const projectB: Project = {
  id: 'p_b', name: '贝塔项目', createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-08T00:00:00Z',
};
const projectSsh: Project = {
  id: 'p_ssh', name: 'dell · demo', createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-07T00:00:00Z',
  workspaceKind: 'ssh', sshHost: 'dell', remotePath: '/root/demo',
};
const projectNew: Project = {
  id: 'p_new', name: 'dell · demo', createdAt: '2026-09-11T00:00:00Z', updatedAt: '2026-09-11T00:00:00Z',
  workspaceKind: 'ssh', sshHost: 'dell', remotePath: '/root/demo',
};

function renderWelcome(initialSearch = '') {
  return render(
    <MemoryRouter initialEntries={[`/${initialSearch}`]}>
      <Welcome />
    </MemoryRouter>
  );
}

async function openPicker() {
  fireEvent.click(screen.getByLabelText('选择项目'));
  await screen.findByPlaceholderText('搜索工作区');
}

/** 打开远程连接面板，并等到目标别名被已注册候选回填（连接按钮随之可用）。 */
async function openSshPanelAndWaitAlias(alias = 'dell') {
  await openPicker();
  fireEvent.click(screen.getByText('远程连接'));
  const aliasInput = await screen.findByLabelText('远程目标') as HTMLInputElement;
  await waitFor(() => expect(aliasInput.value).toBe(alias));
  return aliasInput;
}

beforeEach(() => {
  mockListProjects.mockResolvedValue([projectA, projectB]);
  mockBranchList.mockResolvedValue([
    { id: 'br_main', name: 'main', isActive: true },
  ] as never);
  mockListSshTargets.mockResolvedValue([{ alias: 'dell', label: 'dell', registered: true }]);
  mockValidateSsh.mockResolvedValue({ ok: true });
  mockConnectSshHost.mockResolvedValue({ ok: true, home: '/root' });
  mockListSshRemoteDirs.mockResolvedValue({
    ok: true, path: '/root',
    dirs: [
      { name: 'demo', path: '/root/demo' },
      { name: 'jobs', path: '/root/jobs' },
    ],
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Welcome（BLOCK-80 欢迎页 + UI-341 内嵌聊天模块）', () => {
  it('渲染问候语 + 触发器 + 分支徽标 + SimpleChat + 退出按钮 + 面板各元素', async () => {
    renderWelcome();
    expect(screen.getByLabelText('欢迎页')).toBeTruthy();
    await waitFor(() => expect(screen.getByText(/main/)).toBeTruthy());
    await openPicker();
    expect(screen.getAllByText('阿尔法项目').length).toBe(2);
    expect(screen.getByText('贝塔项目')).toBeTruthy();
    expect(screen.getByText('打开文件夹')).toBeTruthy();
    expect(screen.getByText('远程连接')).toBeTruthy();
    expect(screen.getByText('返回')).toBeTruthy();
  });

  it('搜索过滤工作区清单', async () => {
    renderWelcome();
    await openPicker();
    fireEvent.change(screen.getByPlaceholderText('搜索工作区'), { target: { value: '贝塔' } });
    expect(screen.getByText('贝塔项目')).toBeTruthy();
    const listEl = document.querySelector('[class*="projectList"]');
    expect(listEl?.textContent).toContain('贝塔项目');
    expect(listEl?.textContent).not.toContain('阿尔法项目');
  });

  it('SimpleChat 内嵌：projectId 正确、conversationId=null、ownsCopilotAsk、composerOnly', async () => {
    renderWelcome();
    const chat = await screen.findByTestId('simple-chat');
    expect(chat.getAttribute('data-project')).toBe('p_a');
    expect(chat.getAttribute('data-conv')).toBe('null');
    expect(chat.getAttribute('data-owns')).toBe('true');
    // UI-341 加映 — 欢迎页只保留 composer（无消息流/空态/建议卡）
    expect(chat.getAttribute('data-composer-only')).toBe('true');
  });

  it('选择项目行 → 关闭面板；SimpleChat 随选中项目切换', async () => {
    renderWelcome();
    await openPicker();
    fireEvent.click(screen.getByText('贝塔项目'));
    await waitFor(() => expect(screen.queryByPlaceholderText('搜索工作区')).toBeNull());
    const chat = screen.getByTestId('simple-chat');
    expect(chat.getAttribute('data-project')).toBe('p_b');
  });

  it('打开文件夹：无桥环境回落应用内 FolderPicker，取消则收起面板', async () => {
    renderWelcome();
    await openPicker();
    fireEvent.click(screen.getByText('打开文件夹'));
    expect(await screen.findByTestId('folder-picker-stub')).toBeTruthy();
    fireEvent.click(screen.getByText('取消选择'));
    await waitFor(() => expect(screen.queryByTestId('folder-picker-stub')).toBeNull());
  });

  it('远程连接：去重命中既有同服务器+同路径项目 → 不校验不创建，切换选中并提示', async () => {
    mockListProjects.mockResolvedValue([projectSsh, projectA]);
    renderWelcome();
    await openSshPanelAndWaitAlias();
    fireEvent.change(screen.getByLabelText('远程路径'), { target: { value: '/root/demo' } });
    fireEvent.click(screen.getByText('校验并创建'));

    // 去重先于校验：命中既有项目即短路，不再打远端校验/创建
    await waitFor(() => expect(screen.queryByPlaceholderText('搜索工作区')).toBeNull());
    expect(mockValidateSsh).not.toHaveBeenCalled();
    expect(mockCreateProject).not.toHaveBeenCalled();
    // 切换选中到既有项目 + UI-340 去重提示可见（此前提示无承载被吞）
    expect(screen.getByTestId('simple-chat').getAttribute('data-project')).toBe('p_ssh');
    expect(screen.getByText(/已存在指向同一工作区的项目/)).toBeTruthy();
  });

  it('远程连接：去重未命中 → 校验通过后创建 ssh 项目并切到新项目', async () => {
    mockListProjects.mockResolvedValueOnce([projectA]).mockResolvedValueOnce([projectNew, projectA]);
    mockCreateProject.mockResolvedValue(projectNew);
    renderWelcome();
    await openSshPanelAndWaitAlias();
    fireEvent.change(screen.getByLabelText('远程路径'), { target: { value: '/root/demo' } });
    fireEvent.click(screen.getByText('校验并创建'));

    await waitFor(() => expect(mockValidateSsh).toHaveBeenCalledWith({ alias: 'dell', remotePath: '/root/demo' }));
    expect(mockCreateProject).toHaveBeenCalledWith({
      name: 'dell · demo',
      modality: 'general',
      workspaceKind: 'ssh',
      sshHost: 'dell',
      remotePath: '/root/demo',
    });
    await waitFor(() => expect(screen.queryByPlaceholderText('搜索工作区')).toBeNull());
    expect(screen.getByTestId('simple-chat').getAttribute('data-project')).toBe('p_new');
  });

  it('远程连接：连接失败 → 错误可见（role=alert 反馈行）', async () => {
    mockConnectSshHost.mockResolvedValue({ ok: false, error: '目标别名不可达' });
    renderWelcome();
    await openSshPanelAndWaitAlias();
    fireEvent.click(screen.getByText('连接'));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('目标别名不可达');
  });

  it('快捷 chip 一键直发 starter prompt（copilotAsk 事件）', async () => {
    renderWelcome();
    fireEvent.click(screen.getByText('差异分析'));
    expect(mockDispatchGewuEvent).toHaveBeenCalledWith(
      gewuEvents.copilotAsk,
      expect.objectContaining({ prompt: expect.stringContaining('DESeq2') })
    );
  });
});
