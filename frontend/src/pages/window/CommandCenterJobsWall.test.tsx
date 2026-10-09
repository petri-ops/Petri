import React from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolJob } from '@/lib/project-types';
import { CommandCenterJobsWall } from './CommandCenterJobsWall';
import { listAllJobs } from '@/lib/project-store';

vi.mock('@/lib/project-store', () => ({
  listAllJobs: vi.fn(),
  listProjects: vi.fn(async () => [
    { id: 'p1', name: 'Project One' },
    { id: 'p2', name: 'Project Two' },
  ]),
}));

// BLOCK-150 ②——终态失效流消费（BLOCK-126 事件源的前端接线）：捕获传给
// useInvalidationStream 的 handler，测试里手动派发 invalidate 信号。
const invBag = vi.hoisted(() => ({
  handler: null as ((info: { domain: string; at: string; payload?: Record<string, unknown> }) => void) | null,
}));
vi.mock('@/hooks/useInvalidationStream', () => ({
  useInvalidationStream: (_enabled: boolean, handler: (info: { domain: string; at: string; payload?: Record<string, unknown> }) => void) => {
    // latest-ref：每次渲染覆盖，测试读到的是最新 handler
    invBag.handler = handler;
  },
}));

const now = Date.now();
const jobs = [
  {
    id: 'j1',
    name: '差异分析',
    tool_id: 'differential',
    status: 'running',
    project_id: 'p1',
    created_at: now - 5000,
  },
  {
    id: 'j2',
    name: '富集分析',
    tool_id: 'kegg',
    status: 'done',
    project_id: 'p2',
    created_at: now - 60000,
    completed_at: now - 30000,
  },
] as unknown as ToolJob[];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('CommandCenterJobsWall (UI-362)', () => {
  it('项目绑定视图只渲染该项目的瓦片', async () => {
    vi.mocked(listAllJobs).mockResolvedValue(jobs);
    render(<CommandCenterJobsWall projectId="p1" emptyText="暂无" />);

    await waitFor(() => expect(screen.queryByTestId('cc-tile-active')).toBeTruthy());
    // j1 = p1 的 running 瓦片（活跃瓦片为 div，带 testid cc-tile-active）
    expect(screen.queryByTestId('cc-tile-active')).toBeTruthy();
    // j2 属于 p2，不得出现在 p1 的项目绑定视图
    expect(screen.queryByTestId('cc-tile-history')).toBeNull();
    expect(screen.queryByText('富集分析')).toBeNull();
  });

  it('无匹配作业时展示宿主传入的空态文案', async () => {
    vi.mocked(listAllJobs).mockResolvedValue(jobs);
    render(<CommandCenterJobsWall projectId="p-missing" emptyText="本项目暂无作业" />);

    await waitFor(() => expect(screen.getByText('本项目暂无作业')).toBeTruthy());
    expect(screen.queryByTestId('cc-tile-active')).toBeNull();
    expect(screen.queryByTestId('cc-tile-history')).toBeNull();
  });

  it('全局视图（projectId=null）渲染全部项目瓦片，活跃置顶', async () => {
    vi.mocked(listAllJobs).mockResolvedValue(jobs);
    render(
      <CommandCenterJobsWall
        projectId={null}
        emptyText="暂无"
      />,
    );

    await waitFor(() => expect(screen.queryByTestId('cc-tile-active')).toBeTruthy());
    expect(screen.getByTestId('cc-tile-active').getAttribute('data-job-id')).toBe('j1');
    expect(screen.getByTestId('cc-tile-history').getAttribute('data-job-id')).toBe('j2');
  });

  // BLOCK-150 ①——队列位次（BLOCK-130 PL-3 队列化的前端消费）：
  // pending 瓦片显示「排队中 #N」（N=同用户 pending 按 created_at 升序位次）。
  it('pending 瓦片显示排队位次（排队中 #N）', async () => {
    const queuedJobs = [
      { id: 'q-late', name: '后排任务', tool_id: 'gsea', status: 'pending', project_id: 'p1', created_at: now - 1000 },
      { id: 'q-early', name: '前排任务', tool_id: 'deseq2', status: 'pending', project_id: 'p1', created_at: now - 9000 },
      { id: 'q-done', name: '已完成', tool_id: 'km', status: 'done', project_id: 'p1', created_at: now - 90000, completed_at: now - 80000 },
    ] as unknown as ToolJob[];
    vi.mocked(listAllJobs).mockResolvedValue(queuedJobs);
    render(<CommandCenterJobsWall projectId={null} emptyText="暂无" />);

    // 两个 pending 瓦片共用 cc-tile-active testid —— 断言按文本定位
    await waitFor(() => expect(screen.getAllByTestId('cc-tile-active').length).toBe(2));
    // created_at 早者位次靠前：q-early=#1、q-late=#2
    expect(screen.getByText('排队中 #1')).toBeTruthy();
    expect(screen.getByText('排队中 #2')).toBeTruthy();
  });

  // BLOCK-150 ②——终态失效流消费：invalidate(jobs) 即时刷新（低频轮询兜底不变）。
  it('收到 jobs 域失效信号立即刷新瓦片，非 jobs 域不刷新', async () => {
    vi.mocked(listAllJobs).mockResolvedValue(jobs);
    render(<CommandCenterJobsWall projectId={null} emptyText="暂无" />);
    await waitFor(() => expect(screen.queryByTestId('cc-tile-active')).toBeTruthy());
    const callsAfterMount = vi.mocked(listAllJobs).mock.calls.length;
    expect(callsAfterMount).toBeGreaterThan(0);

    const handler = invBag.handler;
    expect(handler, '任务墙必须订阅失效流（useInvalidationStream）').toBeTruthy();
    act(() => {
      handler!({ domain: 'jobs', at: new Date().toISOString(), payload: { toolJobId: 'j2', state: 'completed' } });
    });
    await waitFor(() => expect(vi.mocked(listAllJobs).mock.calls.length).toBeGreaterThan(callsAfterMount));

    const callsAfterJobs = vi.mocked(listAllJobs).mock.calls.length;
    act(() => {
      handler!({ domain: 'knowledge', at: new Date().toISOString() });
    });
    expect(vi.mocked(listAllJobs).mock.calls.length).toBe(callsAfterJobs);
  });
});
