/**
 * BLOCK-322 产品洞察 — 聊天内嵌产物卡（红绿先行）。
 *
 * 产品原则（用户洞察 2026-10-30）：聊天时间线是一等交互面——agent 产出的富内容
 * 应在聊天内直接可交互，而非引导到结果面板。
 *
 * 第一片：model3d_export 完成后渲染内嵌 3D 预览（Model3DScene 复用）；
 * 第二片（P3-03 v2b 实机抓真后）：产物卡是通用能力，且必须在**所有**时间线渲染
 * 分支可达——落定折叠时节点整段不渲染，卡随节点一起消失即为接线断裂。
 *
 * 数据链：tool_result 顶层 toolJobId → ToolActivityItem.toolJobId →
 *        /api/tools/status/:jobId → result.artifacts[].url/path。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('产物卡为通用实现：有 artifacts 即渲染（3D/图像/下载分流）', () => {
  const content = read('frontend/src/components/copilot/ChatArtifactCard.tsx');
  assert.ok(content.includes('Model3DScene'), '必须复用 Model3DScene（不建第二渲染器）');
  assert.ok(content.includes('data-testid="chat-artifact-card"'), '必须有 testid');
  assert.ok(
    content.includes('workspaceFileUrlFor'),
    '产物 URL 必须走工作区文件出口（dev :3000 下 /api 相对 URL 会打到 Vite 兜底）',
  );
});

test('聊天时间线所有渲染分支都渲染产物卡（落定折叠不可吞掉产物）', () => {
  const list = read('frontend/src/components/copilot/ToolActivityList.tsx');
  assert.ok(list.includes('import { ChatArtifactCard }'), 'ToolActivityList 必须接产物卡');
  const renderedBranches = (list.match(/\{artifactCards\}/g) || []).length;
  assert.equal(
    renderedBranches,
    3,
    `产物卡必须在三个渲染分支（运行级展开 / 落定折叠 / legacy 手风琴）都出现，实际 ${renderedBranches} 处`,
  );

  const timeline = read('frontend/src/components/copilot/ConversationTimeline.tsx');
  assert.ok(timeline.includes('import { ChatArtifactCard }'), 'ConversationTimeline 落定折叠面必须接产物卡');
  assert.ok(timeline.includes('artifactJobs.map'), '折叠态必须从工具分段聚合产物 job');
  assert.ok(timeline.includes('projectId={projectId}'), 'projectId 必须传到产物卡');
});

test('UI-653 产物落地动作：结果面复用既有事件，3D 工作台走独立场景快照事件', () => {
  const card = read('frontend/src/components/copilot/ChatArtifactCard.tsx');
  assert.ok(card.includes('在结果中查看'), '产物卡必须提供「在结果中查看」');
  assert.ok(card.includes('在 3D 工作台打开'), '产物卡必须提供「在 3D 工作台打开」');
  assert.ok(card.includes('petriEvents.projectOpenArtifact'), '结果查看必须复用 projectOpenArtifact，不建第二打开链');
  assert.ok(card.includes('petriEvents.model3dOpen'), '工作台打开必须派发 model3dOpen');
  assert.ok(card.includes('sceneSnapshotPath'), '场景快照路径必须从 job 的 outDir/产物目录推导');

  const events = read('frontend/src/lib/events.ts');
  assert.ok(events.includes("model3dOpen: 'petri:model3d-open'"), '事件名必须登记在类型化事件总线');
  assert.ok(events.includes('Model3DOpenDetail'), '事件载荷必须类型化');
  assert.ok(events.includes('meshPath?: string'), '打开事件必须同时支持工作区网格来源');

  // BLOCK-375（S0）契约追新：BLOCK-334（b5a72c45）结果统一落右栏「结果」tab，
  // 原 UI-653 的中央视图 switchToResult 语义退役（useWorkspaceOpenEffects 注释在案）——
  // 打开链=projectOpenArtifact(jobId, artifactName) → 右栏结果宿主，无需视图切换。
  assert.ok(card.includes('petriEvents.projectOpenArtifact'), '打开链唯一入口不变');

  const workspace = read('frontend/src/pages/project-workspace.tsx');
  assert.ok(workspace.includes('petriEvents.model3dOpen'), '宿主必须订阅工作台打开事件');
  assert.ok(workspace.includes('model3dOpenRequest'), '宿主必须把打开请求交给右栏');

  const openEffects = read('frontend/src/pages/project-workspace/useWorkspaceOpenEffects.ts');
  // BLOCK-334 后打开链落右栏宿主；switchToResult 语义退役，断言打开效果链仍在位
  assert.ok(openEffects.includes('petriEvents.projectOpenArtifact'), '打开效果链订阅在位（右栏宿主）');

  const rightPanel = read('frontend/src/components/workspace-panels/RightPanel.tsx');
  assert.ok(rightPanel.includes('initialOpen={ctx.model3dOpenRequest'), '右栏必须把打开请求透传给工作面');

  const surface = read('frontend/src/components/work-surface/Model3DSurface.tsx');
  assert.ok(surface.includes('loadSceneFromWorkspace'), '工作面必须能按路径读取场景/快照');
  assert.ok(surface.includes('loadMeshFromWorkspace'), '工作面必须支持工作区网格预览');
  assert.ok(surface.includes('data-testid="model3d-scene-source"'), '载入来源必须可见（场景源）');
  assert.ok(surface.includes('snapshotSourceReadOnly'), '导出 run 快照必须标记只读，不作写面');
  assert.ok(surface.includes('initialScenePath={snapshotSourceReadOnly'), '快照只读时参数编辑回落项目 SceneSpec');
  assert.ok(surface.includes('readLastOpen') && surface.includes('discoverLatestScene'), 'UI-654 必须自动恢复上次/最新场景（免手动导入）');

  const editPanel = read('frontend/src/components/work-surface/Model3DEditPanel.tsx');
  assert.ok(editPanel.includes('initialScenePath'), '参数编辑面板必须接受来源路径');

  const filePreview = read('frontend/src/pages/project-workspace/WorkspaceFilePreview.tsx');
  assert.ok(filePreview.includes('workspace-preview-3d-actions'), '文件预览必须提供转 3D 模型入口');
  assert.ok(filePreview.includes('petriEvents.model3dOpen'), '文件预览必须派发打开事件');
  assert.ok(filePreview.includes('meshFormatForPath'), '网格文件预览必须被识别');

  const resultViewer = read('frontend/src/components/workspace-panels/Model3DResultViewer.tsx');
  assert.ok(resultViewer.includes('sceneSnapshotFromUrl'), '结果 3D 预览必须能反推同一 run 的快照');
  assert.ok(resultViewer.includes('petriEvents.model3dOpen'), '结果预览必须提供转 3D 工作台入口');

  // WebGL 上下文生命周期：卸载释放 + 非可见面不创建（实机抓真 Too many active WebGL contexts）
  const sceneRenderer = read('frontend/src/components/work-surface/Model3DScene.tsx');
  assert.ok(sceneRenderer.includes('forceContextLoss'), '卸载必须 forceContextLoss 释放上下文');
  assert.ok(sceneRenderer.includes('active?: boolean'), '渲染器必须支持按可见性关闭');
  assert.ok(sceneRenderer.includes('if (!active) return undefined'), '非可见面不得创建 WebGL 上下文');
  assert.ok(rightPanel.includes('active={ctx.rightTab === tab}'), '右栏非激活 tab 必须关闭 3D 渲染器');
  assert.ok(surface.includes('active={active}'), '工作面必须把可见性透传给渲染器');

  const sceneStore = read('core/petri-server/helpers/model3d-scene-store.js');
  assert.ok(sceneStore.includes('normalizeSnapshotPath'), '后端必须允许 run 快照只读读取');
  assert.ok(sceneStore.includes('normalizeRelativePath(relativePath) || normalizeSnapshotPath(relativePath)'), '读面放行快照、写面仍只认 .scene3d.json');
});

test('tool_result 顶层携带直接工具的 toolJobId（产物卡数据链单一源）', () => {
  const { buildToolResultEvent } = require('../core/petri-server/agent-tools/tool-events.js');
  const envelope = (tool, data) => ({
    tool,
    data,
    contractVersion: 'tool_result_v1',
    traceId: 'tr_1',
    callId: 'call_1',
    status: 'success',
    terminationReason: null,
    durationMs: 5,
    truncated: false,
    sideEffects: undefined,
  });

  const direct = buildToolResultEvent(envelope('model3d_export', {
    ok: true,
    toolJobId: 'tj_export_1',
    artifacts: [{ name: 'scene.glb', path: 'model3d/runs/x/scene.glb' }],
  }), {});
  assert.equal(direct.toolJobId, 'tj_export_1', '直接工具自建 job 的 toolJobId 必须提到事件顶层');

  const runTool = buildToolResultEvent(envelope('run_tool', { ok: true, toolJobId: 'tj_run_1' }), {});
  assert.equal(runTool.toolJobId, 'tj_run_1', 'run_tool 现有顶层语义不能回退');

  const noJob = buildToolResultEvent(envelope('workspace_read', { ok: true }), {});
  assert.equal(noJob.toolJobId, undefined, '无 job 的工具不得凭空携带 toolJobId');
});
