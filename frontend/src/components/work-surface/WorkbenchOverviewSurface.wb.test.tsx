// item 88 第三波 HK-01——WorkbenchOverviewSurface wb 五态投影接线：
// mock /api/wb/overview 数据源 → 目标树出目标根 + 5 任务节点（五态色/依赖关系经
// projectOrchestration 边）；无 wb 数据时回退 loop 快照形状（诚实空态）。
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ overview: null as null | import('@/lib/wbOverviewClient').WbOverview }));

vi.mock('@/lib/wbOverviewClient', () => ({
  fetchWbOverview: vi.fn(() => Promise.resolve(state.overview)),
}));

// TraceSurface 拉轨迹（fetchTrajectory）——本测试只钉 wb 树/图，mock 掉避免环境依赖
vi.mock('./TraceSurface', () => ({
  TraceSurface: () => <div data-testid="trace-stub" />,
}));

import { WorkbenchOverviewSurface } from './WorkbenchOverviewSurface';
import type { OrchestrationTask } from '@/components/workspace-panels/OrchestrationGraph';

const WB_OVERVIEW = {
  ok: true,
  projectId: 'demo_proj_workbench',
  goals: [
    {
      id: 'demo_wb_goal_1',
      description: '演示数据，可一键清除——产品宣传素材包',
      budgetCny: 12.5,
      status: 'active',
      acceptance: { 验收标准: ['x'] },
      tasks: [
        { id: 'demo_wb_task_1', status: 'accepted', priority: 10, spec: { 产物类型: 'PNG 海报 ×3' }, dependencies: [], createdAt: '2026-11-27T00:00:00Z' },
        { id: 'demo_wb_task_2', status: 'running', priority: 20, spec: { 产物类型: 'MP4 15s' }, dependencies: [], createdAt: '2026-11-27T00:00:00Z' },
        { id: 'demo_wb_task_3', status: 'blocked', priority: 30, spec: { 产物类型: '文案 JSON' }, dependencies: ['demo_wb_task_1'], createdAt: '2026-11-27T00:00:00Z' },
        { id: 'demo_wb_task_4', status: 'needs-user', priority: 40, spec: { 产物类型: '口播稿' }, dependencies: [], createdAt: '2026-11-27T00:00:00Z' },
        { id: 'demo_wb_task_5', status: 'queued', priority: 50, spec: { 产物类型: 'ZIP 素材包' }, dependencies: [], createdAt: '2026-11-27T00:00:00Z' },
      ],
    },
  ],
};

const LOOP_TASKS: OrchestrationTask[] = [
  { taskId: 'demo_agent_demo_wb_task_2', status: 'running', userContent: '恢复后台任务' },
];

afterEach(() => {
  cleanup();
  state.overview = null;
});

describe('WorkbenchOverviewSurface wb 五态投影（item 88 第三波）', () => {
  it('HK-88w-5：wb 数据驱动目标树——根+5 任务六节点、五态色类在 DOM、去重合并 loop 快照', async () => {
    state.overview = WB_OVERVIEW;
    render(
      <WorkbenchOverviewSurface
        tasks={LOOP_TASKS}
        rootTaskId="conv_demo_wb88"
        conversationId="conv_demo_wb88"
        projectId="demo_proj_workbench"
      />,
    );
    expect(screen.getByTestId('workbench-overview')).toBeTruthy();
    await waitFor(() => {
      expect(document.querySelectorAll('.react-flow__node').length).toBeGreaterThanOrEqual(6);
    });
    // wb 节点（goal + 5 任务）+ loop 快照去重（demo_agent_demo_wb_task_2 与 wb task_2 id 不同 → 保留）
    const nodes = [...document.querySelectorAll('.react-flow__node')];
    const ids = nodes.map((n) => n.getAttribute('data-id'));
    expect(ids).toContain('demo_wb_goal_1');
    for (const id of ['demo_wb_task_1', 'demo_wb_task_2', 'demo_wb_task_3', 'demo_wb_task_4', 'demo_wb_task_5']) {
      expect(ids).toContain(id);
    }
    expect(ids).toContain('demo_agent_demo_wb_task_2');
    // 五态色：节点边框色含五态的 var（§4.4）
    const html = nodes.map((n) => n.getAttribute('style') || '').join(' ');
    for (const colorVar of ['--petri-status-success', '--petri-info', '--petri-danger', '--petri-warning', '--petri-text-muted']) {
      expect(html).toContain(colorVar);
    }
  });

  it('HK-88w-6：无 wb 数据 → 诚实回退 loop 快照形状（节点=loop 数）', () => {
    state.overview = { ok: true, projectId: 'p', goals: [] };
    render(
      <WorkbenchOverviewSurface
        tasks={LOOP_TASKS as never}
        rootTaskId="conv_demo_wb88"
        conversationId="conv_demo_wb88"
        projectId="demo_proj_workbench"
      />,
    );
    expect(screen.getByTestId('workbench-overview')).toBeTruthy();
    expect(document.querySelectorAll('.react-flow__node').length).toBeGreaterThan(0);
    expect(screen.getByTestId('wb-overview-goal-tree').textContent).not.toContain('wb 五态投影');
  });
});
