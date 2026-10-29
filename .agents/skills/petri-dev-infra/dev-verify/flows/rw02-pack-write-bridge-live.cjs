#!/usr/bin/env node
'use strict';

/**
 * RW-02 B 线实机腿：pack 写桥四写面真实链（隔离 :3011 + 夹具包）。
 *
 * 前置（会话起栈）：隔离后端 :3011（PETRI_PACK_DIRS=夹具包目录 + 新数据目录）。
 * 夹具：rw02-fixture（合法 writes 声明）+ rw02-baddecl（bridgeVersion=99 非法声明）。
 *
 * 断言：
 *   W1 contributions 透传：合法声明全量在位；非法声明丢弃 + writes_decl_invalid 诊断
 *   W2 临时项目 + 真实 Blender 导出（RW-01 链）→ glb revision（写桥的 revision 对象）
 *   W3 selection-save 真实写链（宿主代理同形 body → 核心 REST）
 *   W4 annotations 真实写链（result-artifact scope：create + delete）
 *   W5 revision-restore 资格链（物化域前提如实，同 RW-01 边界）
 * 证据：acceptance/rw-02-pack-write-bridge/rw02-pack-write-bridge-live.json
 */

const path = require('node:path');
const fs = require('node:fs');
const lib = require('../lib.cjs');

const ROOT = lib.findRepoRoot(__dirname);
const API = process.env.RW02_API || 'http://127.0.0.1:3011';

async function rest(method, endpoint, body) {
  const response = await fetch(`${API}/api${endpoint}`, {
    method,
    headers: {
      Authorization: 'Bearer desktop-local',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(240_000),
  });
  return { status: response.status, data: await response.json().catch(() => null) };
}

function boxScene(height) {
  return {
    version: 'scene3d/v1',
    units: 'mm',
    coordinateSystem: 'z-up-right-handed',
    name: 'RW02 write bridge probe',
    parameters: {},
    nodes: [{
      id: 'enclosure',
      type: 'box',
      name: 'Enclosure',
      dimensions: { width: 90, depth: 60, height },
      transform: { position: [0, 0, 0] },
      material: { color: '#6a8caf', roughness: 0.4 },
    }],
  };
}

module.exports = {
  id: 'rw02-pack-write-bridge-live',
  description: 'RW-02：pack 写桥四写面真实链（contribution 透传 / selection / annotations / restore 资格）',
  evidenceDir: path.join(ROOT, 'acceptance', 'rw-02-pack-write-bridge'),

  async run(ctx) {
    const { assert } = ctx;
    let projectId = null;
    try {
      // W1 contributions 透传（合法在位 / 非法丢弃+诊断）
      const contributions = await rest('GET', '/packs/contributions');
      const packs = contributions.data?.packs || [];
      const fixture = packs.find((p) => p.packId === 'rw02-fixture');
      const baddecl = packs.find((p) => p.packId === 'rw02-baddecl');
      const fixtureSurface = (fixture?.resultSurfaces || []).find((s) => s.id === 'write-probe') || null;
      const diagnostics = contributions.data?.diagnostics || [];
      assert('W1_fixture_writes_passthrough', contributions.status === 200
        && fixtureSurface && fixtureSurface.writes?.bridgeVersion === 1
        && fixtureSurface.writes?.selection?.write === true
        && fixtureSurface.writes?.revisions?.restore === true,
      JSON.stringify(fixtureSurface).slice(0, 240));
      assert('W1_baddecl_dropped_with_diagnostic', baddecl
        && (baddecl.resultSurfaces || []).every((s) => !s.writes)
        && diagnostics.some((d) => d.packId === 'rw02-baddecl' && String(d.code || '').startsWith('writes_decl_invalid')),
      JSON.stringify(diagnostics).slice(0, 240));

      // W2 临时项目 + 真实 Blender 导出（产生 revision 对象供写桥操作）
      const project = await rest('POST', '/data/projects', { name: `RW02-BRIDGE-${Date.now()}` });
      projectId = project.data?.project?.id || null;
      assert('W2_project_created', project.status === 200 && Boolean(projectId), JSON.stringify(project.data).slice(0, 160));
      // 夹具准备：临时工作区补 git 仓（change-set baseCommit 锚定 HEAD；/tmp 下无父仓）
      const workspacePath = project.data?.project?.workspace_path || null;
      if (workspacePath) {
        const { execSync } = require('node:child_process');
        execSync('git init -q && git config user.email t@petri.local && git config user.name t && git commit -qm init --allow-empty',
          { cwd: workspacePath, stdio: 'ignore' });
      }
      const sceneApply = await rest('POST', '/model3d/scene/apply', {
        projectId,
        path: 'model3d/recipes/rw02-bridge.scene3d.json',
        scene: boxScene(45),
        operations: [{ op: 'set_metadata', metadata: { seededBy: 'rw02-live' } }],
        reason: 'rw02_live_seed',
      });
      assert('W2_scene_seeded', sceneApply.status === 200 && sceneApply.data?.ok === true,
        JSON.stringify(sceneApply.data).slice(0, 200));
      const sceneRead = await rest('POST', '/model3d/scene/read', { projectId, path: 'model3d/recipes/rw02-bridge.scene3d.json' });
      const exportV1 = await rest('POST', '/model3d/scene/export', {
        projectId,
        scene: sceneRead.data?.scene,
        scenePath: 'model3d/recipes/rw02-bridge.scene3d.json',
        formats: ['glb'],
        recipeId: 'rw02-bridge',
        recipeVersion: 1,
      });
      const rs = exportV1.data?.resultStudio || null;
      const glb = (rs?.revisions || []).find((r) => r.artifactId.endsWith(':glb')) || null;
      assert('W2_export_revision_ready', exportV1.status === 200 && rs?.registered === true && Boolean(glb),
        JSON.stringify(exportV1.data).slice(0, 260));

      // W3 selection-save 真实写链（宿主代理同形 body：平铺 + entityIdsHash=sha256(stableStringify(sorted ids))）
      const crypto = require('node:crypto');
      const entityIds = [glb.artifactId].sort();
      const entityIdsHash = crypto.createHash('sha256').update(JSON.stringify(entityIds)).digest('hex');
      const selectionSave = await rest('POST', '/result-studio/selection', {
        selectionId: `sel_rw02_${Date.now().toString(36)}`,
        projectId,
        conversationId: null,
        artifactId: glb.artifactId,
        revisionId: glb.revisionId,
        entityType: 'model3d_artifact',
        entityIds,
        entityIdCount: 1,
        entityIdsHash,
      });
      assert('W3_selection_save_chain', selectionSave.status === 200 && selectionSave.data?.selection,
        `status=${selectionSave.status} body=${JSON.stringify(selectionSave.data).slice(0, 240)}`);

      // W4 annotations 真实写链（result-artifact scope：create → delete）
      const annotationCreate = await rest('POST', '/result-studio/annotations', {
        projectId,
        surface: 'result-artifact',
        artifactId: glb.artifactId,
        revisionId: glb.revisionId,
        conversationId: null,
        kind: 'region',
        comment: 'RW02 写桥探针批注',
        color: 'amber',
        rect: [0.1, 0.1, 0.4, 0.4],
      });
      const annotationId = annotationCreate.data?.annotation?.annotationId || annotationCreate.data?.annotation?.id || null;
      assert('W4_annotation_create_chain', annotationCreate.status === 200 && Boolean(annotationId),
        `status=${annotationCreate.status} body=${JSON.stringify(annotationCreate.data).slice(0, 240)}`);
      if (annotationId) {
        const annotationDelete = await rest('DELETE', `/result-studio/annotations/${encodeURIComponent(annotationId)}?projectId=${encodeURIComponent(projectId)}`);
        assert('W4_annotation_delete_chain', annotationDelete.status === 200 || annotationDelete.status === 204,
          `status=${annotationDelete.status} body=${JSON.stringify(annotationDelete.data).slice(0, 160)}`);
      }

      // W5 revision-restore 资格链（物化域前提如实——同 RW-01 边界：临时项目工作区非 git 绑定域）
      const restore = await rest('POST', `/result-studio/revisions/${encodeURIComponent(glb.revisionId)}/restore`, {
        projectId,
        conversationId: null,
      });
      const restoreError = restore.status >= 400 ? restore.data?.error || null : null;
      assert('W5_restore_qualification_chain', restore.status === 200
        || ['restore_material_unavailable'].includes(restoreError),
        `status=${restore.status} error=${restoreError} body=${JSON.stringify(restore.data).slice(0, 200)}`);

      return true;
    } finally {
      if (projectId) {
        await rest('DELETE', `/data/projects/${encodeURIComponent(projectId)}`).catch(() => null);
      }
    }
  },
};
