'use strict';

/**
 * routes/result-studio/storage.js — storage 子域（PHASE 2.1b）
 *
 * 下沉的端点（来自 routes/result-studio.js 第 1051-1104 行）：
 *   GET  /api/result-studio/storage/gc            （plan）
 *   GET  /api/result-studio/storage/deduplicate   （plan）
 *   POST /api/result-studio/storage/deduplicate   （execute）
 *   POST /api/result-studio/storage/gc            （execute）
 *
 * 跨子文件依赖：projectContext 通过 options.projectContext 提供（与 changesets /
 * revisions 共享同一工厂）。
 */

const {
  planArtifactDeduplication,
  executeArtifactDeduplication,
  planResultStudioGc,
  executeResultStudioGc,
} = require('../../../shared-backend/result-studio-lifecycle');

module.exports = {
  register(app, options) {
    if (typeof app !== 'object' || typeof app.get !== 'function') {
      throw new Error('result-studio/storage register requires an Express app');
    }
    if (!options || typeof options.projectContext !== 'function') {
      throw new Error('result-studio/storage register requires options.projectContext');
    }

    app.get('/api/result-studio/storage/gc', (req, res) => {
      const projectId = String(req.query.projectId || '').trim();
      const context = options.projectContext(req, projectId);
      if (context.error) return res.status(context.error.status).json({ error: context.error.code });
      try {
        return res.json(planResultStudioGc({
          workspaceRoot: context.project.workspace_path,
          projectId,
        }, { repository: context.repository, adapter: context.binding.adapter }));
      } catch (error) {
        return res.status(409).json({ error: error.code || 'gc_plan_failed', message: error.message });
      }
    });

    app.get('/api/result-studio/storage/deduplicate', (req, res) => {
      const projectId = String(req.query.projectId || '').trim();
      const context = options.projectContext(req, projectId);
      if (context.error) return res.status(context.error.status).json({ error: context.error.code });
      try {
        return res.json(planArtifactDeduplication({ workspaceRoot: context.project.workspace_path, projectId }, { repository: context.repository }));
      } catch (error) {
        return res.status(409).json({ error: error.code || 'dedup_plan_failed', message: error.message });
      }
    });

    app.post('/api/result-studio/storage/deduplicate', (req, res) => {
      const projectId = String(req.body?.projectId || '').trim();
      const context = options.projectContext(req, projectId, { write: true });
      if (context.error) return res.status(context.error.status).json({ error: context.error.code });
      try {
        return res.json(executeArtifactDeduplication({
          workspaceRoot: context.project.workspace_path,
          projectId,
          planToken: String(req.body?.planToken || ''),
        }, { repository: context.repository }));
      } catch (error) {
        return res.status(409).json({ error: error.code || 'dedup_execute_failed', message: error.message });
      }
    });

    app.post('/api/result-studio/storage/gc', (req, res) => {
      const projectId = String(req.body?.projectId || '').trim();
      const context = options.projectContext(req, projectId, { write: true });
      if (context.error) return res.status(context.error.status).json({ error: context.error.code });
      try {
        return res.json(executeResultStudioGc({
          workspaceRoot: context.project.workspace_path,
          projectId,
          planToken: String(req.body?.planToken || ''),
        }, { repository: context.repository, adapter: context.binding.adapter }));
      } catch (error) {
        return res.status(409).json({ error: error.code || 'gc_execute_failed', message: error.message });
      }
    });
  },
};
