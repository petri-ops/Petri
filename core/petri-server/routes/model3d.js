'use strict';

const db = require('../db');
const blender = require('../helpers/blender-provider');
const scene3d = require('../helpers/scene3d');
const { runModel3DReview } = require('../helpers/model3d-review');
const { sketchToTaskSpec } = require('../helpers/model3d-sketch');
const sceneStore = require('../helpers/model3d-scene-store');
const { authorizeProject } = require('../agent-tools/workspace-tools/internals');

const REVIEW_VIEWS = new Set(['front', 'top', 'side', 'iso']);

function requestUserId(req) {
  return req.userId || (req.user && req.user.id) || null;
}

function normalizeViews(input) {
  if (!Array.isArray(input)) return undefined;
  const views = [];
  for (const item of input) {
    const view = String(item || '').trim().toLowerCase();
    if (!REVIEW_VIEWS.has(view)) return { error: 'invalid_views' };
    if (!views.includes(view)) views.push(view);
  }
  return views.length > 0 ? { views } : { error: 'invalid_views' };
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
    res.json({
      ok: true,
      status: capability.status,
      reason: capability.reason,
      version: capability.version,
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
