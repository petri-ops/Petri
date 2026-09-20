import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
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
});
