'use strict';

const db = require('../db');
const blender = require('../helpers/blender-provider');
const scene3d = require('../helpers/scene3d');
const { runModel3DReview } = require('../helpers/model3d-review');
const { sketchToTaskSpec } = require('../helpers/model3d-sketch');
const sceneStore = require('../helpers/model3d-scene-store');
const { compareGeometryReports } = require('../helpers/model3d-geometry-compare');
const { inspectMeshAsset, inspectTextureAsset } = require('../helpers/mesh-assets');
const cadExchange = require('../helpers/cad-exchange');
const assets = require('../helpers/model3d-assets');
const { createCadDrawing } = require('../helpers/model3d-cad-drawing');
const generation = require('../helpers/model3d-generation-provider');
const { buildWorkspaceArtifactUrl } = require('../helpers/model3d-artifact-projection');
const { normalizeRenderViews } = require('../helpers/model3d-views');
const { tool_model3d_export } = require('../agent-tools/model3d-tools');
const { authorizeProject } = require('../agent-tools/workspace-tools/internals');

// resolveWorkspaceTarget 的路径拒绝码 → 403（与 400「请求本身不合法」区分）。
const PATH_REJECT_ERRORS = ['sensitive_path', 'path_escape', 'symlink_escape', 'symlink_not_allowed', 'workspace_unavailable'];

/** 资产预检错误 → HTTP 语义（mesh 与贴图共用同一映射，只是错误码前缀不同）。 */
const assetErrorStatus = (error, kind) => (error === `${kind}_not_found` ? 404
  : error === `${kind}_too_large` ? 413
    : PATH_REJECT_ERRORS.includes(error) ? 403
      : 400);

function requestUserId(req) {
  return req.userId || (req.user && req.user.id) || null;
}

// 视角合法性判据取自 helpers/model3d-views 单源（本处原先自写一份清单）。
function normalizeViews(input) {
  if (!Array.isArray(input)) return undefined;
  const views = normalizeRenderViews(input);
  return views ? { views } : { error: 'invalid_views' };
}

// 本地项目授权 + ssh 拒绝：SceneSpec 编辑/渲染都发生在宿主工作区。
function loadLocalProject(req, res, projectId) {
  const userId = requestUserId(req);
  if (!userId) {
    res.status(401).json({ ok: false, error: 'unauthenticated' });
    return null;
  }
  const id = typeof projectId === 'string' ? projectId.trim() : '';
  if (!id) {
    res.status(400).json({ ok: false, error: 'project_required' });
    return null;
  }
  const project = db.getProject(id);
  if (!project || !project.workspace_path) {
    res.status(404).json({ ok: false, error: 'project_not_found' });
    return null;
  }
  try {
    authorizeProject(project, userId, db);
  } catch (error) {
    res.status(error.code === 'unauthorized' ? 401 : 403).json({ ok: false, error: error.code || 'permission_denied', message: error.message });
    return null;
  }
  if (project.workspace_kind === 'ssh') {
    res.status(400).json({
      ok: false,
      error: 'local_project_required',
      message: 'SceneSpec 编辑与渲染在本机执行，仅支持本地项目工作区。',
    });
    return null;
  }
  return { project, userId };
}

module.exports = function registerModel3DRoutes(app) {
  app.get('/api/model3d/capability', async (_req, res) => {
    const capability = await blender.probeBlender();
    const cad = await cadExchange.probeCadExchange();
    res.json({
      ok: true,
      status: capability.status,
      reason: capability.reason,
      version: capability.version,
      cad,
      generation: generation.probeGenerationProvider(),
    });
  });

  // NEXT-05 P1-1 — SceneSpec 编辑/修订/语义 diff（本地项目，白名单 operations）。
  app.post('/api/model3d/scene/read', async (req, res) => {
    const auth = loadLocalProject(req, res, req.body?.projectId);
    if (!auth) return;
    const result = await sceneStore.readSceneInput({
      workspaceRoot: auth.project.workspace_path,
      relativePath: req.body?.path,
    });
    return res.status(result.ok ? 200 : 404).json(result);
  });

  app.post('/api/model3d/scene/apply', async (req, res) => {
    const auth = loadLocalProject(req, res, req.body?.projectId);
    if (!auth) return;
    const result = await sceneStore.applyOperations({
      workspaceRoot: auth.project.workspace_path,
      relativePath: req.body?.path,
      scene: req.body?.scene,
      operations: req.body?.operations,
      expectedHash: req.body?.expectedHash || null,
      reason: req.body?.reason || 'user_edit',
    });
    if (!result.ok) {
      const status = result.error === 'scene_conflict' ? 409
        : result.error === 'scene_not_found' ? 404
          : 400;
      return res.status(status).json(result);
    }
    return res.json(result);
  });

  app.get('/api/model3d/scene/revisions', async (req, res) => {
    const auth = loadLocalProject(req, res, req.query?.projectId);
    if (!auth) return;
    const normalized = sceneStore.normalizeRelativePath(req.query?.path);
    if (!normalized) return res.status(400).json({ ok: false, error: 'scene_path_required' });
    const revisions = await sceneStore.listRevisionsForProject({
      workspaceRoot: auth.project.workspace_path,
      relativePath: normalized,
    });
    return res.json({ ok: true, path: normalized, revisions });
  });

  app.post('/api/model3d/scene/restore', async (req, res) => {
    const auth = loadLocalProject(req, res, req.body?.projectId);
    if (!auth) return;
    const result = await sceneStore.restoreRevision({
      workspaceRoot: auth.project.workspace_path,
      relativePath: req.body?.path,
      revisionId: req.body?.revisionId,
    });
    if (!result.ok) {
      const status = result.error === 'revision_not_found' ? 404 : 400;
      return res.status(status).json(result);
    }
    return res.json(result);
  });

  app.post('/api/model3d/scene/diff', (req, res) => {
    const before = req.body?.before;
    const after = req.body?.after;
    const validatedBefore = scene3d.validateSceneSpec(before);
    const validatedAfter = scene3d.validateSceneSpec(after);
    if (!validatedBefore.ok || !validatedAfter.ok) {
      return res.status(400).json({
        ok: false,
        error: 'scene_invalid',
        errors: [...(validatedBefore.errors || []), ...(validatedAfter.errors || [])],
      });
    }
    return res.json({ ok: true, diff: sceneStore.diffScenes(before, after) });
  });

  // BLOCK-322 P3-02a — 只读求值：参数引用 + 装配约束烘进 transform，与送 Blender 的同一函数
  // （resolveSceneSpec）。纯函数、不读盘不写盘、无项目前置（对标 scene/diff），不产生第二份真相。
  app.post('/api/model3d/scene/resolve', (req, res) => {
    const resolved = scene3d.resolveSceneSpec(req.body?.scene);
    if (!resolved.ok) {
      return res.status(400).json({ ok: false, error: resolved.error, errors: resolved.errors });
    }
    return res.json({
      ok: true,
      sceneHash: scene3d.hashSceneSpec(req.body.scene),
      scene: resolved.scene,
      stats: resolved.stats,
      appliedConstraints: resolved.appliedConstraints,
    });
  });

  // RW-01 — 导出即登记执行面：与 agent 工具同一生产路径（tool_model3d_export），
  // 产物落工作区 + 成果面真值桥登记（change-set/revision/lineage 图）。非第二真相。
  app.post('/api/model3d/scene/export', async (req, res) => {
    const auth = loadLocalProject(req, res, req.body?.projectId);
    if (!auth) return;
    const validated = scene3d.validateSceneSpec(req.body?.scene);
    if (!validated.ok) {
      return res.status(400).json({ ok: false, error: 'scene_invalid', errors: validated.errors });
    }
    try {
      const outcome = await tool_model3d_export(
        {
          scene: req.body.scene,
          scenePath: req.body?.scenePath ?? null,
          formats: Array.isArray(req.body?.formats) ? req.body.formats : undefined,
          turntable: req.body?.turntable ?? null,
          recipeId: req.body?.recipeId ?? null,
          recipeVersion: req.body?.recipeVersion ?? null,
          taskSpecId: req.body?.taskSpecId ?? null,
        },
        { userId: auth.userId, projectId: auth.project.id, conversationId: null },
      );
      return res.status(outcome.ok === false ? 400 : 200).json(outcome);
    } catch (error) {
      return res.status(500).json({ ok: false, error: 'model3d_export_failed', message: error.message });
    }
  });

  // BLOCK-322 P1c — 外部 mesh 资产入链预检：服务端从工作区磁盘真实计算 sha256/字节，
  // 格式与上限走 helpers/mesh-assets 单源。只读，不写文件、不产生第二份真相；
  // 之后 Blender 构建仍逐字节复验（resources/model3d/blender_scene.py）。
  app.post('/api/model3d/asset/inspect', async (req, res) => {
    const auth = loadLocalProject(req, res, req.body?.projectId);
    if (!auth) return;
    const result = await inspectMeshAsset({
      workspaceRoot: auth.project.workspace_path,
      relativePath: req.body?.path,
    });
    if (!result.ok) {
      return res.status(assetErrorStatus(result.error, 'mesh')).json(result);
    }
    return res.json(result);
  });

  // BLOCK-322 P2-03 — 贴图入链预检：与 mesh 同一内核（helpers/mesh-assets），只换格式白名单、
  // 上限与错误码前缀。只读算 sha256/字节，不写文件；Blender 构建时仍逐字节复验。
  app.post('/api/model3d/texture/inspect', async (req, res) => {
    const auth = loadLocalProject(req, res, req.body?.projectId);
    if (!auth) return;
    const result = await inspectTextureAsset({
      workspaceRoot: auth.project.workspace_path,
      relativePath: req.body?.path,
    });
    if (!result.ok) {
      return res.status(assetErrorStatus(result.error, 'texture')).json(result);
    }
    return res.json(result);
  });

  // BLOCK-322 P4-04a — STEP/IGES 源文件入链：OCCT 转派生 GLB/STL，原 CAD 留工作区。
  app.post('/api/model3d/asset/import-cad', async (req, res) => {
    const auth = loadLocalProject(req, res, req.body?.projectId);
    if (!auth) return;
    const result = await assets.importCadAsset({
      workspaceRoot: auth.project.workspace_path,
      sourcePath: req.body?.path,
      name: req.body?.name,
      provenance: req.body?.provenance,
    });
    if (!result.ok) {
      return res.status(assetErrorStatus(result.error, 'cad_source')).json(result);
    }
    return res.json(result);
  });

  // BLOCK-322 P5-02 — 外部文生 3D（默认关；未配置/未同意不发送）。
  app.post('/api/model3d/asset/generate', async (req, res) => {
    const auth = loadLocalProject(req, res, req.body?.projectId);
    if (!auth) return;
    const result = await assets.generateAndImport({
      workspaceRoot: auth.project.workspace_path,
      prompt: req.body?.prompt,
      name: req.body?.name,
    });
    if (!result.ok) {
      const status = result.error === 'generation_provider_none' || result.error === 'generation_key_missing'
        ? 503
        : /^generation_(timeout|submit_failed|poll_failed|download_failed|failed)$/.test(String(result.error)) ? 502 : 400;
      return res.status(status).json(result);
    }
    return res.json(result);
  });

  // BLOCK-322 P4-05 — STEP/IGES → HLR 多视图 SVG（只读源 + 新产物；不含尺寸链/GD&T）。
  app.post('/api/model3d/cad/drawing', async (req, res) => {
    const auth = loadLocalProject(req, res, req.body?.projectId);
    if (!auth) return;
    const result = await createCadDrawing({
      workspaceRoot: auth.project.workspace_path,
      sourcePath: req.body?.path,
      views: req.body?.views,
      width: req.body?.width,
      height: req.body?.height,
      showHidden: req.body?.showHidden,
    });
    if (!result.ok) {
      return res.status(assetErrorStatus(result.error, 'cad_source')).json(result);
    }
    return res.json({
      ...result,
      svgUrl: buildWorkspaceArtifactUrl(auth.project.id, result.svgPath),
      manifestUrl: buildWorkspaceArtifactUrl(auth.project.id, result.manifestPath),
    });
  });

  // BLOCK-322 P6-03 — 场景 diff 之上的几何差值投影：两侧都跑一次 Blender 网格报告
  // （views/formats 为空，只取 mesh/bounds），差值由纯函数计算；不写盘、不建 revision。
  app.post('/api/model3d/scene/compare-geometry', async (req, res) => {
    const auth = loadLocalProject(req, res, req.body?.projectId);
    if (!auth) return;
    const before = req.body?.before;
    const after = req.body?.after;
    const validatedBefore = scene3d.validateSceneSpec(before);
    const validatedAfter = scene3d.validateSceneSpec(after);
    if (!validatedBefore.ok || !validatedAfter.ok) {
      return res.status(400).json({ ok: false, error: 'scene_invalid', errors: [...(validatedBefore.errors || []), ...(validatedAfter.errors || [])] });
    }
    const capability = await blender.probeBlender();
    if (capability.status !== 'ready') return res.status(503).json({ ok: false, error: 'capability_unavailable', reason: capability.reason });
    const resolvedBefore = scene3d.resolveSceneSpec(before);
    const resolvedAfter = scene3d.resolveSceneSpec(after);
    if (!resolvedBefore.ok || !resolvedAfter.ok) {
      return res.status(400).json({ ok: false, error: 'scene_invalid', errors: [...(resolvedBefore.errors || []), ...(resolvedAfter.errors || [])] });
    }
    const beforeReport = await blender.runBlenderScene({ scene: resolvedBefore.scene, workspaceRoot: auth.project.workspace_path, views: [], formats: [] });
    if (!beforeReport.ok) return res.status(422).json({ ok: false, error: 'before_report_failed', report: beforeReport.report || null, message: beforeReport.message || null });
    const afterReport = await blender.runBlenderScene({ scene: resolvedAfter.scene, workspaceRoot: auth.project.workspace_path, views: [], formats: [] });
    if (!afterReport.ok) return res.status(422).json({ ok: false, error: 'after_report_failed', report: afterReport.report || null, message: afterReport.message || null });
    return res.json({ ...compareGeometryReports(beforeReport.report, afterReport.report), provider: { name: 'blender', version: capability.version } });
  });

  // NEXT-04B P3-1 — 草图 → task-spec/v1 草稿（只预览；不建场景/不执行）。
  app.post('/api/model3d/sketch-spec', async (req, res) => {
    try {
      const userId = requestUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: 'unauthenticated' });
      const result = await sketchToTaskSpec({
        imageDataUrl: req.body?.imageDataUrl,
        dimensions: req.body?.dimensions,
        notes: req.body?.notes,
        userId,
      });
      if (!result.ok) {
        const status = result.error === 'vision_unavailable' ? 503
          : ['image_required', 'image_invalid', 'image_too_large'].includes(result.error) ? 400
            : 422;
        return res.status(status).json(result);
      }
      return res.json(result);
    } catch (error) {
      return res.status(500).json({ ok: false, error: 'sketch_spec_failed', message: String(error.message || error) });
    }
  });

  // NEXT-04B — 本地 Blender 多视角渲染 + vision 角色辅助 QA。
  // 视觉输出只作为观察/疑似问题，不产生几何或尺寸通过的布尔真值；
  // vision 不可用时返回 unavailable，渲染事实与检查报告仍然有效。
  app.post('/api/model3d/review', async (req, res) => {
    try {
      const userId = requestUserId(req);
      if (!userId) return res.status(401).json({ ok: false, error: 'unauthenticated' });
      const projectId = typeof req.body?.projectId === 'string' ? req.body.projectId.trim() : '';
      if (!projectId) return res.status(400).json({ ok: false, error: 'project_required' });
      const project = db.getProject(projectId);
      if (!project || !project.workspace_path) {
        return res.status(404).json({ ok: false, error: 'project_not_found' });
      }
      try {
        authorizeProject(project, userId, db);
      } catch (error) {
        const status = error.code === 'unauthorized' ? 401 : 403;
        return res.status(status).json({ ok: false, error: error.code || 'permission_denied', message: error.message });
      }
      if (project.workspace_kind === 'ssh') {
        return res.status(400).json({
          ok: false,
          error: 'local_project_required',
          message: 'Blender 多视角渲染在本机执行，仅支持本地项目工作区。',
        });
      }
      const scene = req.body?.scene;
      if (!scene || typeof scene !== 'object' || Array.isArray(scene)) {
        return res.status(400).json({ ok: false, error: 'scene_required' });
      }
      const views = normalizeViews(req.body?.views);
      if (views && views.error) return res.status(400).json({ ok: false, error: views.error });
      const result = await runModel3DReview({
        scene,
        workspaceRoot: project.workspace_path,
        userId,
        views: views ? views.views : undefined,
      });
      if (!result.ok) {
        const status = result.error === 'capability_unavailable' ? 503 : 400;
        return res.status(status).json(result);
      }
      return res.json(result);
    } catch (error) {
      return res.status(500).json({ ok: false, error: 'review_failed', message: String(error.message || error) });
    }
  });
};
