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
            message: `同一产物/文件最多 ${MAX_ANNOTATIONS_PER_SCOPE} 条批注，请先删除不再需要的批注。`,
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
