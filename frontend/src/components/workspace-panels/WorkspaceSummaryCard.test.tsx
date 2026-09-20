import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WorkspaceSummaryCard, type WorkspaceSummaryCardProps } from './WorkspaceSummaryCard';
import { listAgentTasks } from '@/components/copilot/copilotClient';
import type { AgentTaskTodoItem } from '@/components/copilot/copilotClient';
import { getBridge } from '@/lib/desktopBridge';
import type { Project, ToolJob, Dataset } from '@/lib/project-types';
import type { ConversationSummary } from '@/components/copilot/copilotConversationsClient';
import { useRuntimeResourceSnapshot, type RuntimeResourceSnapshot } from '@/hooks/useRuntimeResourceSnapshot';

vi.mock('@/hooks/useRuntimeResourceSnapshot', () => ({
  useRuntimeResourceSnapshot: vi.fn(),
}));

const useRuntimeResourceSnapshotMock = vi.mocked(useRuntimeResourceSnapshot);

function makeSnapshot(overrides: Partial<RuntimeResourceSnapshot> = {}): RuntimeResourceSnapshot {
  return {
    schemaVersion: 1,
    observedAt: '2026-09-10T09:00:00.000Z',
    expiresAt: '2026-09-10T09:00:15.000Z',
    state: 'ready',
    platform: 'linux (ssh:dell)',
    cpu: { logicalCores: 28, load1m: 0.42 },
    memory: { totalBytes: 16 * 1024 ** 3, availableBytes: 8 * 1024 ** 3, estimatedBytes: 8 * 1024 ** 3 },
    disk: { totalBytes: 200 * 1024 ** 3, availableBytes: 100 * 1024 ** 3, usePercent: 50 },
    runtime: { r: null as unknown as boolean, python: null as unknown as boolean, details: null },
    activeJobs: 0,
    ...overrides,
  };
}

vi.mock('@/components/copilot/copilotClient', () => ({
  listAgentTasks: vi.fn(),
}));

vi.mock('@/components/copilot/planApprovals', () => ({
  fetchDraftPlansForConversation: vi.fn(),
  fetchPlansWithPendingRevision: vi.fn(),
}));

vi.mock('@/components/copilot/backgroundProcesses', () => ({
  listBackgroundProcesses: vi.fn(),
}));

vi.mock('@/lib/desktopBridge', () => ({
  getBridge: vi.fn(),
}));

const listAgentTasksMock = vi.mocked(listAgentTasks);
const getBridgeMock = vi.mocked(getBridge);
const { fetchDraftPlansForConversation, fetchPlansWithPendingRevision } = await import('@/components/copilot/planApprovals');
const { listBackgroundProcesses } = await import('@/components/copilot/backgroundProcesses');

function makeJob(overrides: Partial<ToolJob> = {}): ToolJob {
  return {
    id: 'job_1',
    tool_id: 'deseq2',
    status: 'done',
    created_at: 1700000000000,
    ...overrides,
  };
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p_1',
    name: '测试项目',
    createdAt: '2026-09-10T00:00:00Z',
    updatedAt: '2026-09-10T08:00:00Z',
    ...overrides,
  };
}

function makeConversation(overrides: Partial<ConversationSummary> = {}): ConversationSummary {
  return {
    id: 'conv_1',
    title: '差异分析讨论',
    status: 'active',
    last_page: null,
    message_count: 3,
    created_at: '2026-09-10T00:00:00Z',
    updated_at: '2026-09-10T08:00:00Z',
    ...overrides,
  };
}

function makeDataset(overrides: Partial<Dataset> = {}): Dataset {
  return {
    id: 'ds_1',
    projectId: 'p_1',
    name: 'pbmc3k',
    ossUrl: 'file:///data/pbmc3k.h5ad',
    size: 3 * 1024 * 1024,
    uploadedAt: '2026-09-10T01:00:00Z',
    ...overrides,
  };
}

function baseProps(overrides: Partial<WorkspaceSummaryCardProps> = {}): WorkspaceSummaryCardProps {
  return {
    open: true,
    visibility: 'expanded',
    projectName: '测试项目',
    project: makeProject(),
    activeJob: null,
    workflow: null,
    recentJobs: [],
    liveJobsPreview: [],
    jobStats: { running: 0, failed: 0, done: 0, pending: 0 },
    backendStatus: { rRuntime: true, pyRuntime: true, rServerUp: true, serverUp: true, isReady: true, downReason: '', loaded: true },
    conversations: [],
    activeConversation: null,
    datasets: [],
    onOpenScheduled: vi.fn(),
    onSelectJob: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  listAgentTasksMock.mockResolvedValue([]);
  vi.mocked(fetchDraftPlansForConversation).mockResolvedValue([]);
  vi.mocked(fetchPlansWithPendingRevision).mockResolvedValue([]);
  vi.mocked(listBackgroundProcesses).mockResolvedValue([]);
  useRuntimeResourceSnapshotMock.mockReturnValue({
    snapshot: null,
    loading: false,
    error: '',
    refresh: async () => {},
  });
  // 默认零用量（成本行不渲染）；成本行用例内覆写
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ status: 'ok', calls: 0, inputTokens: 0, outputTokens: 0, estimatedCostCny: 0, costStatus: 'estimated' }),
  })));
  getBridgeMock.mockImplementation(((name: string) => {
    if (name === 'terminal') {
      return { listSessions: async () => ({ ok: true, sessions: [] }) };
    }
    return { popOut: vi.fn(async () => ({})) };
  }) as unknown as typeof getBridge);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('WorkspaceSummaryCard (BLOCK-78 P1 项目运行时投影)', () => {
  it('定位收敛：aria-label 为「项目运行摘要」（原「会话摘要」退役）', () => {
    render(<WorkspaceSummaryCard {...baseProps()} />);
    expect(screen.getByLabelText('项目运行摘要')).toBeTruthy();
    expect(screen.queryByLabelText('会话摘要')).toBeNull();
  });

  it('失败强调：failed>0 渲染警示行，点击直达最近失败任务', async () => {
    const failed = makeJob({ id: 'job_failed_1', status: 'failed', name: '火山图' });
    const onSelectJob = vi.fn();
    render(
      <WorkspaceSummaryCard
        {...baseProps({
          jobStats: { running: 0, failed: 2, done: 5, pending: 0 },
          recentJobs: [failed],
          onSelectJob,
        })}
      />
    );
    const row = await screen.findByText('2 个失败任务');
    fireEvent.click(row);
    await waitFor(() => expect(onSelectJob).toHaveBeenCalledWith('job_failed_1'));
  });

  it('基线预警：executionAllowed=false 渲染阻塞告警而非「空闲」假象', async () => {
    render(
      <WorkspaceSummaryCard
        {...baseProps({
          project: makeProject({
            g0Baseline: {
              recordVersion: 1,
              createdBaselineId: 'b1',
              createdBaselineVersion: 'v1',
              createdManifestDigest: 'm',
              createdBundleDigest: 'd',
              openedBaselineId: 'b1',
              openedBaselineVersion: 'v1',
              openedManifestDigest: 'm',
              openedBundleDigest: 'd',
              compatibilityStatus: 'blocked',
              compatibilityReason: '清单摘要不匹配',
              executionAllowed: false,
              migrationRequired: false,
            },
          }),
        })}
      />
    );
    expect(await screen.findByText(/项目基线受阻/)).toBeTruthy();
    expect(screen.getByText(/清单摘要不匹配/)).toBeTruthy();
  });

  it('执行位置标注：ssh 项目标「远程 · host」，local 无目标标「本机」', () => {
    const job = makeJob({ status: 'running' });
    const { rerender } = render(
      <WorkspaceSummaryCard
        {...baseProps({
          project: makeProject({ workspaceKind: 'ssh', sshHost: 'aliyun' }),
          activeJob: job,
        })}
      />
    );
    expect(screen.getByText(/远程 · aliyun/)).toBeTruthy();

    rerender(
      <WorkspaceSummaryCard
        {...baseProps({ project: makeProject({ workspaceKind: 'local' }), activeJob: job })}
      />
    );
    expect(screen.getByText(/本机/)).toBeTruthy();

    rerender(
      <WorkspaceSummaryCard
        {...baseProps({
          project: makeProject({ workspaceKind: 'local' }),
          activeJob: makeJob({ execution_target_id: 'target_1' }),
        })}
      />
    );
    expect(screen.getByText(/远程执行/)).toBeTruthy();
  });

  it('智能体节：listAgentTasks 按项目过滤，无内容整节不渲染', async () => {
    listAgentTasksMock.mockResolvedValue([
      {
        taskId: 'task_a',
        status: 'running',
        agentStatus: null,
        taskText: '跑一遍 QC 流程',
        conversationId: 'conv_1',
        parentTaskId: null,
        createdAt: '2026-09-10T07:00:00Z',
        finishedAt: null,
        spawnSource: null,
        error: null,
        projectId: 'p_1',
      },
      {
        taskId: 'task_b',
        status: 'completed',
        agentStatus: null,
        taskText: '别的项目的任务',
        conversationId: 'conv_x',
        parentTaskId: null,
        createdAt: '2026-09-10T07:00:00Z',
        finishedAt: null,
        spawnSource: null,
        error: null,
        projectId: 'p_other',
      },
    ]);
    const first = render(<WorkspaceSummaryCard {...baseProps()} />);
    expect(await screen.findByLabelText('智能体')).toBeTruthy();
    expect(screen.getByText(/1 运行中 · 1 个/)).toBeTruthy();
    // UI-386 — 智能体节改图标带：任务文本经 aria-label/悬停提示承载
    expect(screen.getByLabelText(/智能体 跑一遍 QC 流程/)).toBeTruthy();
    expect(screen.queryByLabelText(/智能体 别的项目的任务/)).toBeNull();

    first.unmount();
    listAgentTasksMock.mockResolvedValue([]);
    render(<WorkspaceSummaryCard {...baseProps()} />);
    await waitFor(() => expect(listAgentTasksMock).toHaveBeenCalledTimes(2));
    expect(screen.queryByLabelText('智能体')).toBeNull();
  });

  it('终端投影：listSessions 有会话则显示计数，无会话不渲染', async () => {
    getBridgeMock.mockImplementation(((name: string) => {
      if (name === 'terminal') {
        return {
          listSessions: async () => ({
            ok: true,
            sessions: [
              { sessionId: 's1', pid: 100, cwd: '/tmp', running: true },
              { sessionId: 's2', pid: 101, cwd: '/tmp', running: true },
            ],
          }),
        };
      }
      return { popOut: vi.fn(async () => ({})) };
    }) as unknown as typeof getBridge);
    render(<WorkspaceSummaryCard {...baseProps()} />);
    expect(await screen.findByText('2 个会话运行中')).toBeTruthy();

    cleanup();
    getBridgeMock.mockImplementation(((name: string) => {
      if (name === 'terminal') {
        return { listSessions: async () => ({ ok: true, sessions: [] }) };
      }
      return { popOut: vi.fn(async () => ({})) };
    }) as unknown as typeof getBridge);
    render(<WorkspaceSummaryCard {...baseProps()} />);
    await waitFor(() => expect(screen.queryByText(/个会话运行中/)).toBeNull());
  });

  it('P2-② 成本行：项目累计用量渲染（partial 口径标注；零调用不渲染）', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () => String(url).includes('usage-project')
        ? { status: 'ok', calls: 12, inputTokens: 1000, outputTokens: 2000, estimatedCostCny: 0.1234, costStatus: 'partial' }
        : { status: 'error' },
    })));
    render(<WorkspaceSummaryCard {...baseProps()} />);
    expect(await screen.findByText(/¥0\.1234/)).toBeTruthy();
    expect(screen.getByText(/3,000 tok/)).toBeTruthy();
    expect(screen.getByText(/部分估算/)).toBeTruthy();

    cleanup();
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ status: 'ok', calls: 0, inputTokens: 0, outputTokens: 0, estimatedCostCny: 0, costStatus: 'estimated' }),
    })));
    render(<WorkspaceSummaryCard {...baseProps()} />);
    await waitFor(() => expect(screen.queryByText(/成本/)).toBeNull());
  });

  it('P2-③ 结果库占用行：有产物渲染字节+作业数，无产物不渲染', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () => String(url).includes('project-storage')
        ? { ok: true, jobs: 4, bytes: 100 * 1024 * 1024, observedAt: '2026-09-10T09:00:00.000Z' }
        : { status: 'error' },
    })));
    render(<WorkspaceSummaryCard {...baseProps()} />);
    expect(await screen.findByText(/100 MB · 4 作业/)).toBeTruthy();

    cleanup();
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, jobs: 0, bytes: 0, observedAt: '2026-09-10T09:00:00.000Z' }),
    })));
    render(<WorkspaceSummaryCard {...baseProps()} />);
    await waitFor(() => expect(screen.queryByText(/结果库/)).toBeNull());
  });

  it('P2-⑤ 未读通知徽标：渲染计数、点击标记已读（POST seen）', async () => {
    const seenPost = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, marked: 3 }) }));
    vi.stubGlobal('fetch', vi.fn(async (url: string, opts?: { method?: string }) => {
      if (String(url).includes('/harness/notices') && (opts?.method || 'GET') === 'GET') {
        return { ok: true, status: 200, json: async () => ({ ok: true, unread: 3, notices: [] }) };
      }
      if (String(url).includes('/harness/notices/seen')) return seenPost();
      return { ok: true, status: 200, json: async () => ({ status: 'ok', calls: 0, inputTokens: 0, outputTokens: 0, estimatedCostCny: 0, costStatus: 'estimated' }) };
    }));
    render(<WorkspaceSummaryCard {...baseProps()} />);
    const badge = await screen.findByTestId('notices-unread-badge');
    expect(badge.textContent).toContain('3 条未读');
    fireEvent.click(badge);
    await waitFor(() => expect(seenPost).toHaveBeenCalled());
  });

  it('P1.5 环境诚实化：ssh 项目不渲染本机 R/Py 芯片，资源行标注「指挥席本机」', () => {
    render(
      <WorkspaceSummaryCard
        {...baseProps({ project: makeProject({ workspaceKind: 'ssh', sshHost: 'dell' }) })}
      />
    );
    expect(screen.getByText('远程执行 · dell')).toBeTruthy();
    expect(screen.queryByLabelText('后端运行状态')).toBeNull();
    expect(screen.getByText('资源 · 指挥席本机')).toBeTruthy();
    expect(screen.getByText(/dell 远程资源快照待接入/)).toBeTruthy();

    cleanup();
    render(
      <WorkspaceSummaryCard
        {...baseProps({ project: makeProject({ workspaceKind: 'local' }) })}
      />
    );
    expect(screen.getByLabelText('后端运行状态')).toBeTruthy();
    expect(screen.queryByText(/指挥席本机/)).toBeNull();
  });

  it('P2-① 远程资源真值：source=remote 时显示「资源 · host」读数，不再标注待接入', () => {
    useRuntimeResourceSnapshotMock.mockReturnValue({
      snapshot: makeSnapshot({ source: 'remote', host: 'dell', stale: false }),
      loading: false,
      error: '',
      refresh: async () => {},
    });
    render(
      <WorkspaceSummaryCard
        {...baseProps({ project: makeProject({ workspaceKind: 'ssh', sshHost: 'dell' }) })}
      />
    );
    expect(screen.getByText('资源 · dell')).toBeTruthy();
    expect(screen.getByText(/内存 8\.0 GB · 磁盘 100\.0 GB · 28 核/)).toBeTruthy();
    expect(screen.queryByText(/待接入/)).toBeNull();
    expect(screen.queryByText(/指挥席本机/)).toBeNull();
  });

  it('P2-① stale 降级：历史读数带「观测于」时间戳，不冒充新鲜读数', () => {
    useRuntimeResourceSnapshotMock.mockReturnValue({
      snapshot: makeSnapshot({ source: 'remote', host: 'dell', stale: true }),
      loading: false,
      error: '',
      refresh: async () => {},
    });
    render(
      <WorkspaceSummaryCard
        {...baseProps({ project: makeProject({ workspaceKind: 'ssh', sshHost: 'dell' }) })}
      />
    );
    expect(screen.getByText('资源 · dell')).toBeTruthy();
    expect(screen.getByText(/观测于/)).toBeTruthy();
  });

  it('空态指引：无数据集提示先上传数据', () => {
    render(<WorkspaceSummaryCard {...baseProps({ datasets: [] })} />);
    expect(screen.getByText(/还没有数据集/)).toBeTruthy();
  });

  it('compact 三档降级：「项目」信息节仅在 expanded 渲染', () => {
    const props = baseProps({
      conversations: [makeConversation()],
      activeConversation: makeConversation(),
      datasets: [makeDataset()],
    });
    const { rerender } = render(<WorkspaceSummaryCard {...props} visibility="expanded" />);
    expect(screen.getByLabelText('项目信息')).toBeTruthy();
    expect(screen.getByText(/差异分析讨论/)).toBeTruthy();
    expect(screen.getByText(/3 MB/)).toBeTruthy();

    rerender(<WorkspaceSummaryCard {...props} visibility="compact" />);
    expect(screen.queryByLabelText('项目信息')).toBeNull();
  });

  it('失败智能体并入「需要关注」节，点击派发右栏智能体详情事件（UI-385 独立窗退役）', async () => {
    getBridgeMock.mockImplementation(((name: string) => {
      if (name === 'windowManager') return { popOut: vi.fn(async () => ({})) };
      if (name === 'terminal') return { listSessions: async () => ({ ok: true, sessions: [] }) };
      return {};
    }) as unknown as typeof getBridge);
    const dispatched: CustomEvent[] = [];
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent').mockImplementation((ev: Event) => {
      if (ev instanceof CustomEvent && ev.type === 'gewu:agent-open-in-rail') dispatched.push(ev);
      return true;
    });
    listAgentTasksMock.mockResolvedValue([
      {
        taskId: 'task_fail',
        status: 'failed',
        agentStatus: null,
        taskText: '失败的子任务',
        conversationId: 'conv_1',
        parentTaskId: null,
        createdAt: '2026-09-10T07:00:00Z',
        finishedAt: '2026-09-10T07:01:00Z',
        spawnSource: null,
        error: 'boom',
        projectId: 'p_1',
      },
    ]);
    render(
      <WorkspaceSummaryCard
        {...baseProps({ jobStats: { running: 0, failed: 0, done: 0, pending: 0 } })}
      />
    );
    const row = await screen.findByText('1 个失败智能体');
    fireEvent.click(row);
    await waitFor(() => {
      const ev = dispatched.find((e) => (e.detail as { runId?: string })?.runId === 'task_fail');
      expect(ev).toBeTruthy();
    });
    dispatchSpy.mockRestore();
  });

  it('注意节会话信号：待确认计划与异常后台进程计数渲染，零待办不渲染', async () => {
    vi.mocked(fetchDraftPlansForConversation).mockResolvedValue([
      { id: 'plan_1', title: 'QC 计划', specMd: null, steps: [], status: 'draft', conversation_id: 'conv_1' },
    ] as never);
    vi.mocked(fetchPlansWithPendingRevision).mockResolvedValue([]);
    vi.mocked(listBackgroundProcesses).mockResolvedValue([
      {
        processId: 'proc_1',
        pid: 999,
        status: 'failed',
        command: 'python run.py',
        startedAtIso: '2026-09-10T07:00:00Z',
        durationMs: 1200,
        exitCode: 1,
      },
    ]);
    render(
      <WorkspaceSummaryCard
        {...baseProps({ activeConversation: makeConversation() })}
      />
    );
    expect(await screen.findByText('1 项计划待确认')).toBeTruthy();
    expect(await screen.findByText('1 个后台进程异常退出')).toBeTruthy();

    cleanup();
    vi.mocked(fetchDraftPlansForConversation).mockResolvedValue([]);
    vi.mocked(listBackgroundProcesses).mockResolvedValue([]);
    render(
      <WorkspaceSummaryCard
        {...baseProps({ activeConversation: makeConversation() })}
      />
    );
    await waitFor(() => expect(screen.queryByText(/项计划待确认/)).toBeNull());
    expect(screen.queryByText(/后台进程异常退出/)).toBeNull();
  });
});

describe('WorkspaceSummaryCard 任务清单节 (BLOCK-97 / UI-398)', () => {
  const todoItems: AgentTaskTodoItem[] = [
    { id: '1', content: '重建索引', status: 'completed' },
    { id: '2', content: '跑通冒烟测试', status: 'in_progress' },
    { id: '3', content: '写收口报告', status: 'pending' },
  ];

  it('渲染编号条目、进度计数与三态 data-status', () => {
    render(<WorkspaceSummaryCard {...baseProps({ todoList: todoItems })} />);
    const section = screen.getByLabelText('任务清单');
    expect(section).toBeTruthy();
    expect(screen.getByText('1/3')).toBeTruthy();
    const rows = section.querySelectorAll('li');
    expect(rows.length).toBe(3);
    expect(rows[0].getAttribute('data-status')).toBe('completed');
    expect(rows[1].getAttribute('data-status')).toBe('in_progress');
    expect(rows[2].getAttribute('data-status')).toBe('pending');
    expect(rows[0].textContent).toContain('1.');
    expect(rows[0].textContent).toContain('重建索引');
    expect(rows[1].textContent).toContain('跑通冒烟测试');
    expect(rows[2].textContent).toContain('写收口报告');
  });

  it('无清单（undefined / 空数组）不渲染该节', () => {
    const { container: empty } = render(
      <WorkspaceSummaryCard {...baseProps({ todoList: [] })} />
    );
    expect(empty.querySelector('[aria-label="任务清单"]')).toBeNull();
    cleanup();
    const { container: absent } = render(<WorkspaceSummaryCard {...baseProps()} />);
    expect(absent.querySelector('[aria-label="任务清单"]')).toBeNull();
  });

  it('全部完成时进度计数置 done 态', () => {
    render(
      <WorkspaceSummaryCard
        {...baseProps({ todoList: [{ id: '1', content: '唯一一步', status: 'completed' }] })}
      />
    );
    expect(screen.getByText('1/1')).toBeTruthy();
    const progress = screen.getByLabelText('任务清单').querySelector('span[data-done]');
    expect(progress?.getAttribute('data-done')).toBe('true');
  });
});
