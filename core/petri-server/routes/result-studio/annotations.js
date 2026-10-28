'use strict';

/**
 * routes/result-studio/annotations.js — BLOCK-219 Q6 批注子域
 *
 * 端点：
 *   POST   /api/result-studio/annotations         创建一条旁路批注
 *   GET    /api/result-studio/annotations         按 scope 列出批注
 *   DELETE /api/result-studio/annotations/:id     删除一条批注
 *
 * 纪律：
 * - 批注是旁路元数据：不写原始产物文件、不建第二套 artifact/truth。
 * - scope 判定与上限计数共用 shared-backend/result-annotation-contracts.js
 *   （`annotationScopeOf` + `MAX_ANNOTATIONS_PER_SCOPE`），路由不复制词汇。
 * - 项目访问一律 `canAccessProject` fail-closed；未知项目 404、越权 403。
 * - 写路径超限返回 409 并**不落库**；校验失败 400 带可读 details。
 */

const db = require('../../db');
const sqlite = db.db;
const { canAccessProject } = require('../_helpers/validate');
const {
  ANNOTATION_SURFACES,
  MAX_ANNOTATIONS_PER_SCOPE,
  annotationScopeOf,
  isSafeRelativePath,
  normalizeAnnotationInput,
} = require('../../../shared-backend/result-annotation-contracts');
const { createResultAnnotationStore } = require('../../../shared-backend/result-annotation-store');

function readProject(req, res) {
  const projectId = String((req.query && req.query.projectId) || (req.body && req.body.projectId) || '').trim();
  if (!projectId) {
    res.status(400).json({ error: 'project_id_required' });
    return null;
  }
  const project = sqlite.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  if (!project) {
    res.status(404).json({ error: 'project_not_found' });
    return null;
  }
  if (!canAccessProject(req, project)) {
    res.status(403).json({ error: 'forbidden' });
    return null;
  }
  return project;
}

module.exports = {
  register(app, options) {
    if (typeof app.get !== 'function') {
      throw new Error('result-studio/annotations register requires an Express app');
    }
    const storeOptions = options && options.ensureSchema === false ? { ensureSchema: false } : {};
    let storeInstance = null;
    function store() {
      if (!storeInstance) storeInstance = createResultAnnotationStore(sqlite, storeOptions);
      return storeInstance;
    }

    app.post('/api/result-studio/annotations', (req, res) => {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const project = readProject(req, res);
      if (!project) return undefined;

      const normalized = normalizeAnnotationInput({ ...body, projectId: project.id });
      if (!normalized.ok) {
        return res.status(400).json({ error: 'annotation_invalid', details: normalized.errors });
      }

      const annotation = normalized.annotation;
      try {
        const scope = annotationScopeOf(annotation);
        if (store().countByScope(scope) >= MAX_ANNOTATIONS_PER_SCOPE) {
          return res.status(409).json({
            error: 'annotation_limit_reached',
            limit: MAX_ANNOTATIONS_PER_SCOPE,
            message: `同一产物/文件/速记最多 ${MAX_ANNOTATIONS_PER_SCOPE} 条批注，请先删除不再需要的批注。`,
          });
        }
        const saved = store().create(annotation);
        return res.json({ annotation: saved, count: store().countByScope(scope) });
      } catch (error) {
        return res.status(500).json({ error: 'annotation_persist_failed', message: error && error.message });
      }
    });

    app.get('/api/result-studio/annotations', (req, res) => {
      const project = readProject(req, res);
      if (!project) return undefined;

      const query = req.query || {};
      const surface = String(query.surface || '').trim();
      if (!ANNOTATION_SURFACES.includes(surface)) {
        return res.status(400).json({ error: 'surface_invalid', surfaces: [...ANNOTATION_SURFACES] });
      }
      const scope = { projectId: project.id, surface };
      if (surface === 'result-artifact') {
        scope.artifactId = String(query.artifactId || '').trim();
        if (!scope.artifactId) return res.status(400).json({ error: 'artifact_id_required' });
        scope.revisionId = String(query.revisionId || '').trim() || null;
      } else if (surface === 'scratchpad-entry') {
        scope.entryId = String(query.entryId || '').trim();
        if (!scope.entryId) return res.status(400).json({ error: 'entry_id_required' });
      } else {
        scope.filePath = String(query.filePath || '').trim();
        if (!scope.filePath || !isSafeRelativePath(scope.filePath)) {
          return res.status(400).json({ error: 'file_path_invalid' });
        }
      }

      try {
        const annotations = store().listByScope(scope);
        return res.json({ annotations, count: annotations.length, limit: MAX_ANNOTATIONS_PER_SCOPE });
      } catch (error) {
        return res.status(500).json({ error: 'annotation_read_failed', message: error && error.message });
      }
    });

    // BLOCK-307 — 拖拽移动：只改几何（rect/path），不动评论/颜色/scope 身份。
    // 校验语义：rect 必须四元有限 0..1；path 每点必须 [x,y] 有限 0..1；与既有 kind 的
    // 定位方式一致（rect 族只收 rect、path 族只收 path，文本锚点批注不适用直接 400）。
    app.patch('/api/result-studio/annotations/:annotationId/geometry', (req, res) => {
      const annotationId = String((req.params && req.params.annotationId) || '').trim();
      if (!annotationId) {
        res.status(400).json({ error: 'annotation_id_required' });
        return undefined;
      }
      const project = readProject(req, res);
      if (!project) return undefined;
      const existing = store().get(annotationId);
      if (!existing || existing.projectId !== project.id) {
        res.status(404).json({ error: 'annotation_not_found' });
        return undefined;
      }
      if (existing.anchor) {
        res.status(400).json({ error: 'anchor_not_movable', message: '文本锚点批注锚在源码行上，不支持拖拽移动。' });
        return undefined;
      }

      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const finite01 = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
      let rect = existing.rect;
      let path = existing.path;
      if (body.rect !== undefined) {
        if (!Array.isArray(body.rect) || body.rect.length !== 4 || !body.rect.every(finite01)) {
          res.status(400).json({ error: 'rect_invalid', message: 'rect 必须是 0..1 的四元数组。' });
          return undefined;
        }
        rect = body.rect.map((v) => Math.round(v * 10000) / 10000);
      }
      if (body.path !== undefined) {
        if (!Array.isArray(body.path) || body.path.length < 2 || !body.path.every((p) => Array.isArray(p) && p.length === 2 && p.every(finite01))) {
          res.status(400).json({ error: 'path_invalid', message: 'path 每点必须是 0..1 的 [x,y]。' });
          return undefined;
        }
        path = body.path.map((p) => [Math.round(p[0] * 10000) / 10000, Math.round(p[1] * 10000) / 10000]);
      }
      if (body.rect === undefined && body.path === undefined) {
        res.status(400).json({ error: 'geometry_required', message: 'rect / path 至少提供一个。' });
        return undefined;
      }

      try {
        const saved = store().updateGeometry(annotationId, { rect, path });
        if (!saved) {
          res.status(404).json({ error: 'annotation_not_found' });
          return undefined;
        }
        res.json({ annotation: saved });
      } catch (error) {
        res.status(500).json({ error: 'annotation_geometry_update_failed', message: error && error.message });
      }
      return undefined;
    });

    app.delete('/api/result-studio/annotations/:annotationId', (req, res) => {
      const annotationId = String((req.params && req.params.annotationId) || '').trim();
      if (!annotationId) return res.status(400).json({ error: 'annotation_id_required' });
      const existing = store().get(annotationId);
      if (!existing) return res.status(404).json({ error: 'annotation_not_found' });

      const project = sqlite.prepare('SELECT * FROM projects WHERE id = ?').get(existing.projectId);
      if (!project) return res.status(404).json({ error: 'project_not_found' });
      if (!canAccessProject(req, project)) return res.status(403).json({ error: 'forbidden' });

      try {
        store().deleteById(annotationId);
        return res.json({ deleted: true, annotationId });
      } catch (error) {
        return res.status(500).json({ error: 'annotation_delete_failed', message: error && error.message });
      }
    });
  },
};
