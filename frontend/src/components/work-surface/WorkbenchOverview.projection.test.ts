// item 88 HK-01——总览投影钉：演示 seed 的 resume 形状快照经真 projectOrchestration
// 出 6 节点（root+5）5 连线；状态渲染齐全（running 色 map 命中）。
import { describe, expect, it } from 'vitest';
import { projectOrchestration, type OrchestrationTask } from '../workspace-panels/OrchestrationGraph';

// 与 seed 脚本（scripts/item88-workbench-demo-seed.mjs）loop_runs 行对应的 resume 形状：
// resumeSubAgentTasks 只恢复 running subagent；快照 parentTaskId 来自 parentLoopRunId
// （seed 置空 → undefined），RightPanel 传 rootTaskId=activeConvId → 走 root 兜底连线。
const SNAPSHOTS: OrchestrationTask[] = [
  { taskId: 'demo_agent_demo_wb_task_1', status: 'running', userContent: '①主视觉海报' },
  { taskId: 'demo_agent_demo_wb_task_2', status: 'running', userContent: '②宣传短视频剪辑' },
  { taskId: 'demo_agent_demo_wb_task_3', status: 'running', userContent: '③落地页文案（依赖①）' },
  { taskId: 'demo_agent_demo_wb_task_4', status: 'running', userContent: '④品牌口播稿（等你拍板）' },
  { taskId: 'demo_agent_demo_wb_task_5', status: 'running', userContent: '⑤素材包打包上传' },
];
const DEMO_CONV_ID = 'conv_demo_wb88';

describe('workbench overview projection (item 88 demo)', () => {
  it('HK-88d-4：root+5 节点、5 条父→子连线', () => {
    const projection = projectOrchestration(SNAPSHOTS, DEMO_CONV_ID);
    expect(projection.nodes.length).toBe(6);
    expect(projection.edges.length).toBe(5);
    const childIds = projection.edges.map((edge) => edge.target);
    for (const task of SNAPSHOTS) {
      expect(childIds).toContain(task.taskId);
    }
  });

  it('HK-88d-5：空输入诚实空投影（无节点无边）', () => {
    const projection = projectOrchestration([], null);
    expect(projection.nodes.length).toBe(0);
    expect(projection.edges.length).toBe(0);
  });
});
