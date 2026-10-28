import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
import { dispatchPetriEvent, petriEvents } from '@/lib/events';
import type { Project } from '@/lib/project-types';

vi.mock('@/components/backend/BackendStatusProvider', () => ({
  useBackendStatus: () => ({ serverUp: true, isReady: true, loaded: true }),
}));

// 内嵌聊天模块整体 mock：断言挂载契约（projectId / conversationId=null / ownsCopilotAsk / composerOnly / sendGuard）
vi.mock('@/components/copilot/SimpleChat', () => ({
  SimpleChat: (props: {
    projectId: string;
    conversationId: string | null;
    ownsCopilotAsk?: boolean;
    composerOnly?: boolean;
    sendGuard?: () => string | null;
    onConversationChange?: (id: string) => void;
  }) => (
    <div
      data-testid="simple-chat"
      data-project={props.projectId}
      data-conv={String(props.conversationId)}
      data-owns={String(props.ownsCopilotAsk === true)}
      data-composer-only={String(props.composerOnly === true)}
      data-send-guard={String(typeof props.sendGuard === 'function')}
    >
      {/* 模拟 composer 发送路径：宿主守卫的侧效应（展开选择器/提示）由此触发 */}
      <button type="button" onClick={() => { props.sendGuard?.(); }}>模拟发送</button>
    </div>
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

// dispatchPetriEvent 必须是 spy；petriEvents 常量保持真实实现（断言引用同一常量）
vi.mock('@/lib/events', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/events')>();
  return { ...actual, dispatchPetriEvent: vi.fn() };
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
const mockDispatchPetriEvent = vi.mocked(dispatchPetriEvent);

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
  const aliasInput = await screen.findByLabelText<HTMLInputElement>('远程目标');
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

describe('Welcome（BLOCK-80 欢迎页 + UI-341 内嵌聊天模块 + UI-373 不预选常驻 composer）', () => {
  it('冷启动不预选工作区：选择器「选择项目」、composer 常驻挂载且守卫在位；面板各元素就位', async () => {
    renderWelcome();
    expect(screen.getByLabelText('欢迎页')).toBeTruthy();
    // UI-373 — 输入框常驻：未选项目（projectId=''）也挂载，sendGuard 在位
    const chat = await screen.findByTestId('simple-chat');
    expect(chat.getAttribute('data-project')).toBe('');
    expect(chat.getAttribute('data-conv')).toBe('null');
    expect(chat.getAttribute('data-owns')).toBe('true');
    expect(chat.getAttribute('data-composer-only')).toBe('true');
    expect(chat.getAttribute('data-send-guard')).toBe('true');
    // 冷启动不自动选中最近项目（用户裁决「不应该确定的工作区」）：无分支徽标
    await waitFor(() => expect(screen.getByLabelText('选择项目').textContent).toContain('选择项目'));
    expect(screen.queryByText(/main/)).toBeNull();
    await openPicker();
    expect(screen.getByText('阿尔法项目')).toBeTruthy();
    expect(screen.getByText('贝塔项目')).toBeTruthy();
    expect(screen.getByText('打开文件夹')).toBeTruthy();
    expect(screen.getByText('远程连接')).toBeTruthy();
    // UI-424 — 顶部「← 返回」按钮退役：断言其不再渲染（防回归复活）
    expect(screen.queryByText('返回')).toBeNull();
  });

  it('选中项目后：分支徽标出现、守卫撤下（?project= 显式预选路径不受影响）', async () => {
    renderWelcome('?project=p_a');
    // 显式查询参数预选：加载完成即选中 p_a（分支徽标 main 出现）。
    // 注意 key 换挂载会替换 DOM 节点，须在 waitFor 内重查而非持有旧引用。
    await waitFor(() => expect(screen.getByTestId('simple-chat').getAttribute('data-project')).toBe('p_a'));
    expect(screen.getByTestId('simple-chat').getAttribute('data-send-guard')).toBe('false');
    await waitFor(() => expect(screen.getByText(/main/)).toBeTruthy());
    await openPicker();
    // 触发器显示所选项目名 + 列表行 → 同名出现两次
    expect(screen.getAllByText('阿尔法项目').length).toBe(2);
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

  it('未选项目时发送被守卫拦截：展开选择器并给出提示（Enter/copilotAsk 两路径共用守卫）', async () => {
    renderWelcome();
    await screen.findByTestId('simple-chat');
    // mock 内「模拟发送」按钮 = 调用宿主 sendGuard，覆盖 composer Enter 与
    // 快捷 chips copilotAsk 直发两条路径的同一拦截点
    fireEvent.click(screen.getByText('模拟发送'));
    expect(await screen.findByPlaceholderText('搜索工作区')).toBeTruthy();
    expect(screen.getByText(/先选择一个项目/)).toBeTruthy();
  });

  it('未选项目态键入的草稿随选中迁移（key 换挂载不丢字）', async () => {
    window.localStorage.setItem('petri:composer-draft::new', '未发送的草稿文本');
    renderWelcome();
    await openPicker();
    fireEvent.click(screen.getByText('贝塔项目'));
    await waitFor(() => expect(screen.queryByPlaceholderText('搜索工作区')).toBeNull());
    // 迁移目标键 (p_b, new) 有文本、来源空项目键已清
    expect(window.localStorage.getItem('petri:composer-draft:p_b:new')).toBe('未发送的草稿文本');
    expect(window.localStorage.getItem('petri:composer-draft::new')).toBeNull();
    window.localStorage.clear();
  });

  it('选择项目行 → 关闭面板；SimpleChat 随选中项目切换', async () => {
    renderWelcome();
    await openPicker();
    fireEvent.click(screen.getByText('贝塔项目'));
    await waitFor(() => expect(screen.queryByPlaceholderText('搜索工作区')).toBeNull());
    const chat = screen.getByTestId('simple-chat');
    expect(chat.getAttribute('data-project')).toBe('p_b');
    expect(chat.getAttribute('data-send-guard')).toBe('false');
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

  it('快捷 chip 一键直发 starter prompt（copilotAsk 事件；UI-597 通用 agent 文案）', () => {
    renderWelcome();
    fireEvent.click(screen.getByText('整理笔记'));
    expect(mockDispatchPetriEvent).toHaveBeenCalledWith(
      petriEvents.copilotAsk,
      expect.objectContaining({ prompt: expect.stringContaining('工作笔记') })
    );
  });
});

describe('Welcome 首载退避重试（UI-373 · UI-369 同族：dev 栈重启竞态）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    vi.clearAllMocks();
  });

  it('首载 listProjects 失败 → 退避期如实显示「项目加载中…」，第二次尝试成功即就位', async () => {
    mockListProjects
      .mockRejectedValueOnce(new Error('backend not ready yet'))
      .mockResolvedValueOnce([projectA, projectB]);

    renderWelcome();
    // 第一次尝试（t=0）失败：不给出假空态，保持「项目加载中…」
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(mockListProjects).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('选择项目').textContent).toContain('项目加载中');

    // 跨过第一段退避（2s）→ 第二次成功 → 选择器就位、列表可开
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(mockListProjects).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText('选择项目').textContent).toContain('选择项目');
    fireEvent.click(screen.getByLabelText('选择项目'));
    expect(screen.getByText('阿尔法项目')).toBeTruthy();
    expect(screen.getByText('贝塔项目')).toBeTruthy();
  });

  it('首载成功后不再重试', async () => {
    renderWelcome();
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(screen.getByLabelText('选择项目').textContent).toContain('选择项目');
    const calls = mockListProjects.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(mockListProjects.mock.calls.length).toBe(calls);
  });
});
