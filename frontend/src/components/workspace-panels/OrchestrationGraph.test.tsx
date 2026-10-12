// BLOCK-173 CP-9 — 编排 DAG 投影契约（节点/边/父子链/标签截断/防御过滤）。
import { afterEach, describe, expect, it } from 'vitest';
import { projectOrchestration, OrchestrationGraph } from './OrchestrationGraph';
import { render, cleanup } from '@testing-library/react';

afterEach(cleanup);

const tasks = [
  { taskId: 'root', status: 'running', userContent: '主任务：分析 PBMC 数据集' },
  { taskId: 'child-1', parentTaskId: 'root', status: 'running', userContent: '子任务：QC 过滤（长标题'.repeat(6) },
  { taskId: 'child-2', parentTaskId: 'root', status: 'done', userContent: '子任务：聚类' },
  { taskId: 'grand-1', parentTaskId: 'child-1', status: 'done', userContent: '孙任务：线粒体过滤' },
  { taskId: undefined as unknown as string, status: 'done', userContent: '无 id 快照（防御过滤）' },
];

describe('OrchestrationGraph 投影（BLOCK-173 CP-9）', () => {
  it('节点=主任务+全部有 id 任务；边=父子链；无 id 快照被防御过滤', () => {
    const { nodes, edges } = projectOrchestration(tasks as never, 'root');
    const ids = nodes.map((n) => n.id);
    expect(ids).toContain('root');
    expect(ids).toContain('child-1');
    expect(ids).toContain('grand-1');
    expect(ids).not.toContain(undefined);
    expect(edges.some((e) => e.id === 'e:root->child-1')).toBe(true);
    expect(edges.some((e) => e.id === 'e:child-1->grand-1')).toBe(true);
    expect(edges.some((e) => e.id === 'e:root->child-2')).toBe(true);
  });

  it('运行中边带 animated；完成边不带', () => {
    const { edges } = projectOrchestration(tasks as never, 'root');
    const runningEdge = edges.find((e) => e.id === 'e:root->child-1');
    const doneEdge = edges.find((e) => e.id === 'e:child-2->' + '');
    expect(runningEdge?.animated).toBe(true);
    const doneToChild2 = edges.find((e) => e.id === 'e:root->child-2');
    expect(doneToChild2?.animated).toBeFalsy();
    void doneEdge;
  });

  it('无子任务时组件不渲染（null）', () => {
    const { container } = render(<OrchestrationGraph tasks={[]} rootTaskId="root" />);
    expect(container.querySelector('[data-testid="orchestration-graph"]')).toBeNull();
  });

  it('组件渲染画布与图例', () => {
    const { container, getByText } = render(
      <OrchestrationGraph
        tasks={tasks.filter((t) => t.taskId) as never}
        rootTaskId="root"
      />
    );
    expect(container.querySelector('[data-testid="orchestration-graph"]')).toBeTruthy();
    expect(getByText(/运行中/)).toBeTruthy();
  });
});
