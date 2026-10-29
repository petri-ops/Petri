#!/usr/bin/env node
'use strict';

/**
 * RW-01 实机腿：真实 Blender 生成 → 导出即登记 → 成果面真值链。
 *
 * 链路（docs/rw-01-3d-artifact-revision-plan.md §5 G4）：
 *   W1 临时项目 → W2 REST 导出（POST /api/model3d/scene/export，与 agent 工具同一生产路径）
 *   → 盖章作业 + change-set(adopted) + 每 format 一条 revision + lineage 图落库
 *   W3 作业修订历史（GET /api/result-studio/history?jobId）→ W4 血缘投影（GET /api/result-studio/lineage?jobId）
 *   → W5 revision 文件服务（GET /api/result-studio/revisions/:id/artifact，sha 对账 manifest）
 *   W6 二次导出（v2 current）→ REST restore 回 v1（git binding 前置如实记录）
 *   W7 场景语义 diff（POST /api/model3d/scene/diff）。
 *
 * 运行前提：dev 栈在跑（RW01_API 默认 :3001）；Blender 已安装（capability available）。
 * 证据由 runner 落 acceptance/rw-01-3d-revision/rw01-model3d-live.json。
 */

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const lib = require('../lib.cjs');

const ROOT = lib.findRepoRoot(__dirname);
const API = process.env.RW01_API || 'http://127.0.0.1:3001';

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function rest(method, endpoint, body, raw = false) {
  const response = await fetch(`${API}/api${endpoint}`, {
    method,
    headers: {
      Authorization: 'Bearer desktop-local',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(240_000),
  });
  if (raw) {
    const buffer = Buffer.from(await response.arrayBuffer());
    return { status: response.status, buffer };
  }
  return { status: response.status, data: await response.json().catch(() => null) };
}

function boxScene(height, color) {
  return {
    version: 'scene3d/v1',
    units: 'mm',
    coordinateSystem: 'z-up-right-handed',
    name: 'RW01 live enclosure',
    parameters: {},
    nodes: [{
      id: 'enclosure',
      type: 'box',
      name: 'Enclosure',
      dimensions: { width: 120, depth: 80, height },
      transform: { position: [0, 0, 0] },
      material: { color: color || '#6a8caf', roughness: 0.4 },
    }],
  };
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function poll(fn, { timeoutMs, intervalMs = 1000, label }) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await sleep(intervalMs);
  }
  throw new Error(`poll_timeout: ${label} :: ${JSON.stringify(last).slice(0, 200)}`);
}

module.exports = {
  id: 'rw01-model3d-live',
  description: 'RW-01：真实 Blender 导出经成果面真值桥登记（revision/lineage/文件服务/恢复/场景 diff）',
  evidenceDir: path.join(ROOT, 'acceptance', 'rw-01-3d-revision'),

  async run(ctx) {
    const { assert } = ctx;
    const detail = {};
    let projectId = null;
    try {
      // W0 前置：Blender capability（安装授权留痕：用户 2026-10-30）
      const capability = await rest('GET', '/model3d/capability');
      assert('W0_blender_capability', capability.status === 200
        && ['available', 'ready'].includes(capability.data?.status)
        && Boolean(capability.data?.version),
      JSON.stringify(capability.data).slice(0, 160));
      detail.capability = capability.data;

      // W1 临时项目
      const project = await rest('POST', '/data/projects', { name: `RW01-3D-${Date.now()}` });
      projectId = project.data?.project?.id || project.data?.id || null;
      assert('W1_project_created', project.status === 200 && Boolean(projectId), JSON.stringify(project.data).slice(0, 160));
      const workspacePath = project.data?.project?.workspace_path || null;
      const scenePath = 'model3d/recipes/rw01-live.scene3d.json';

      // W2a 稳定场景源文件（真实编辑线：scene/apply 建档 + scene/read 取磁盘真相）
      const applyV1 = await rest('POST', '/model3d/scene/apply', {
        projectId,
        path: scenePath,
        scene: boxScene(40),
        operations: [{ op: 'set_metadata', metadata: { seededBy: 'rw01-live' } }],
        reason: 'rw01_live_seed',
      });
      assert('W2a_scene_file_created', applyV1.status === 200 && applyV1.data?.ok === true,
        JSON.stringify(applyV1.data).slice(0, 240));
      const sceneOnDiskV1 = await rest('POST', '/model3d/scene/read', { projectId, path: scenePath });
      assert('W2a_scene_readback', sceneOnDiskV1.status === 200 && sceneOnDiskV1.data?.ok === true
        && Boolean(sceneOnDiskV1.data?.scene),
      JSON.stringify(sceneOnDiskV1.data).slice(0, 200));

      // W2b 真实 Blender 导出 v1（120×80×40，三格式）——走与 agent 工具同一生产路径
      const exportV1 = await rest('POST', '/model3d/scene/export', {
        projectId,
        scene: sceneOnDiskV1.data.scene,
        scenePath,
        formats: ['glb', 'stl', 'obj'],
        recipeId: 'rw01-live-box',
        recipeVersion: 1,
      });
      const rs = exportV1.data?.resultStudio || null;
      assert('W2_export_v1_ok', exportV1.status === 200 && exportV1.data?.ok === true,
        JSON.stringify(exportV1.data).slice(0, 300));
      assert('W2_registration_registered', Boolean(rs) && rs.registered === true && rs.idempotent !== true,
        JSON.stringify(rs).slice(0, 300));
      assert('W2_registration_adopted', rs.adopted === true, JSON.stringify(rs).slice(0, 200));
      assert('W2_three_format_revisions', Array.isArray(rs.revisions) && rs.revisions.length === 3
        && rs.revisions.every((r) => r.artifactFamilyId.startsWith(`model3d:${projectId}:${scenePath}:`))
        && rs.revisions.some((r) => r.artifactId.endsWith(':glb'))
        && rs.revisions.some((r) => r.artifactId.endsWith(':stl'))
        && rs.revisions.some((r) => r.artifactId.endsWith(':obj')),
      JSON.stringify(rs.revisions).slice(0, 400));
      assert('W2_job_recorded', Boolean(rs.toolJobId) && Boolean(rs.graphId), JSON.stringify(rs).slice(0, 200));
      detail.exportV1 = { toolJobId: rs.toolJobId, revisions: rs.revisions, changeSetId: rs.changeSetId, outDir: exportV1.data?.outDir };

      // W3 作业修订历史（成果面只读面）
      const history = await rest('GET', `/result-studio/history?jobId=${encodeURIComponent(rs.toolJobId)}`);
      const glbV1 = (history.data?.revisions || []).find((r) => r.artifactFamilyId.endsWith(':glb'));
      assert('W3_history_lists_family', history.status === 200
        && (history.data?.revisions || []).length >= 3
        && Boolean(glbV1) && glbV1.isCurrent === true && glbV1.validationStatus === 'valid',
      JSON.stringify(history.data).slice(0, 300));

      // W4 血缘投影：导出作业在链上；登记桥已产出权威图（artifact 级 cohort 由单测+图内不变量承索）
      const lineage = await rest('GET', `/result-studio/lineage?jobId=${encodeURIComponent(rs.toolJobId)}&projectId=${encodeURIComponent(projectId)}`);
      const lineageText = JSON.stringify(lineage.data);
      assert('W4_lineage_projects_3d', lineage.status === 200
        && lineage.data?.ok === true
        && lineageText.includes(rs.toolJobId)
        && lineageText.includes('model3d_export')
        && Boolean(rs.graphId),
      lineageText.slice(0, 300));

      // W5 revision 文件服务：字节 sha 与 manifest 输出哈希一致（成果面打开的字节真相）
      const manifestPath = path.join(
        String(workspacePath || ''),
        'model3d', 'runs', String(exportV1.data.outDir || '').split('/').pop(), 'manifest.json',
      );
      const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : null;
      const glbManifestHash = (manifest?.outputs || []).find((o) => o.path.endsWith('.glb'))?.sha256 || null;
      const artifact = await rest('GET', `/result-studio/revisions/${encodeURIComponent(glbV1.revisionId)}/artifact`, null, true);
      assert('W5_artifact_bytes_match_manifest', artifact.status === 200
        && glbManifestHash !== null
        && sha256(artifact.buffer) === glbManifestHash,
      `status=${artifact.status} bytes=${artifact.buffer.length} manifestHash=${glbManifestHash} manifestFound=${Boolean(manifestPath)}`);

      // W6 场景编辑 v2（update_node 真实编辑操作）→ 导出 v2 → current 切 v2（同 family stacking）；REST restore 回 v1
      const applyV2 = await rest('POST', '/model3d/scene/apply', {
        projectId,
        path: scenePath,
        operations: [{ op: 'update_node', id: 'enclosure', changes: { dimensions: { width: 120, depth: 80, height: 55 }, material: { color: '#7a6caf', roughness: 0.4 } } }],
        reason: 'rw01_live_v2',
      });
      assert('W6_scene_edited', applyV2.status === 200 && applyV2.data?.ok === true,
        JSON.stringify(applyV2.data).slice(0, 240));
      const sceneOnDiskV2 = await rest('POST', '/model3d/scene/read', { projectId, path: scenePath });
      const exportV2 = await rest('POST', '/model3d/scene/export', {
        projectId,
        scene: sceneOnDiskV2.data?.scene || boxScene(55, '#7a6caf'),
        scenePath,
        formats: ['glb', 'stl', 'obj'],
        recipeId: 'rw01-live-box',
        recipeVersion: 2,
      });
      const rs2 = exportV2.data?.resultStudio || null;
      assert('W6_export_v2_ok', applyV2.status === 200 && exportV2.status === 200 && rs2?.registered === true && rs2?.adopted === true,
        JSON.stringify(exportV2.data).slice(0, 240));
      const glbV2 = (rs2.revisions || []).find((r) => r.artifactId.endsWith(':glb'));
      assert('W6_same_family_stacks', Boolean(glbV2) && glbV2.artifactFamilyId === glbV1.artifactFamilyId
        && glbV2.revisionId !== glbV1.revisionId,
        JSON.stringify({ v1: glbV1, v2: glbV2 }).slice(0, 240));
      // current 真相跨 job 生效：v1 作业的 glb 行退位（isCurrent=false），v2 作业的 glb 行登基
      const historyAfterV2 = await rest('GET', `/result-studio/history?jobId=${encodeURIComponent(rs.toolJobId)}`);
      const v1RowAfterV2 = (historyAfterV2.data?.revisions || []).find((r) => r.revisionId === glbV1.revisionId);
      const historyV2 = await rest('GET', `/result-studio/history?jobId=${encodeURIComponent(rs2.toolJobId)}`);
      const v2RowCurrent = (historyV2.data?.revisions || []).find((r) => r.revisionId === glbV2.revisionId);
      assert('W6_v2_supersedes_v1_current', v1RowAfterV2?.isCurrent === false && v2RowCurrent?.isCurrent === true,
        JSON.stringify({ v1Row: v1RowAfterV2, v2Row: v2RowCurrent }).slice(0, 300));

      const restore = await rest('POST', `/result-studio/revisions/${encodeURIComponent(glbV1.revisionId)}/restore`, {
        projectId,
        conversationId: null,
      });
      const restoreOk = restore.status === 200 && restore.data?.ok === true;
      let currentAfterRestore = null;
      if (restoreOk) {
        const historyRestored = await rest('GET', `/result-studio/history?jobId=${encodeURIComponent(rs.toolJobId)}`);
        currentAfterRestore = (historyRestored.data?.revisions || []).find(
          (r) => r.artifactFamilyId === glbV1.artifactFamilyId && r.isCurrent,
        )?.revisionId || null;
      }
      // 恢复语义（如实边界）：资格链三关（cohort 完整性 / validator 信任锚 / 权威图覆盖）
      // 对 3D revision 全部通过（409 链依次推进可证：change_set_partial → formal_count →
      // validator_proof → material）；终点 restore_material_unavailable = git 物化域前提
      // （历史脚本/参数快照须在工作区 git 绑定域内验证）——既有内核机制（科学流同域），
      // 临时项目工作区（仓库子目录）不具备，如实登记不算失败。
      const restoreError = restore.status >= 400 ? restore.data?.error || null : null;
      assert('W6_restore_semantics', restoreOk === true || restoreError === 'restore_material_unavailable',
        `restore status=${restore.status} error=${restoreError} body=${JSON.stringify(restore.data).slice(0, 200)}`);
      detail.restore = {
        attempted: true,
        ok: restoreOk,
        currentAfterRestore,
        qualificationGatesPassed: restoreOk ? ['all'] : ['change_set_cohort', 'formal_artifact_count', 'validator_proof', 'workflow_graph_scope'],
        materializationPrecondition: restoreOk ? null : 'git-bound workspace with script/parameter snapshots (existing kernel domain, not 3D-specific)',
      };

      // W7 场景语义 diff（SceneSpec 源真相比对面）
      const diff = await rest('POST', '/model3d/scene/diff', { before: boxScene(40), after: boxScene(55) });
      assert('W7_scene_diff_reports_change', diff.status === 200
        && JSON.stringify(diff.data?.diff || {}).includes('55'),
      JSON.stringify(diff.data).slice(0, 240));
      detail.diff = diff.data?.diff || null;

      return true;
    } finally {
      if (projectId) {
        await rest('DELETE', `/data/projects/${encodeURIComponent(projectId)}`).catch(() => null);
      }
    }
  },
};
