'use strict';

/**
 * routes/result-studio/repository.js — repository 子域（PHASE 2.1b）
 *
 * 下沉的端点（来自 routes/result-studio.js 第 302-350 行）：
 *   GET  /api/result-studio/repository-binding
 *   POST /api/result-studio/repository-binding/consent
 *
 * 行为 100% 兼容：每个端点的鉴权顺序、try/catch、错误响应 shape 保持一致。
 * `options.repo()` 闭包由 `result-studio/index.js` 初始化时创建。
 */

const db = require('../../db');
const {
  bindProjectRepository,
  inspectExistingRepositoryDirty,
  inspectWorkspaceGit,
} = require('../../../shared-backend/git-repository-binding');
const { canAccessProject } = require('../_helpers/validate');
const { attachExistingRepositoryWithExplicitConsent } = require('../_helpers/workflow');

module.exports = {
  /**
   * PHASE 2.1b 注册函数。`options.repo()` 是共享闭包工厂，首次请求时创建。
   */
  register(app, options) {
    if (typeof app.get !== 'function') {
      throw new Error('result-studio/repository register requires an Express app');
    }
    if (!options || typeof options.repo !== 'function') {
      throw new Error('result-studio/repository register requires options.repo');
    }

    app.get('/api/result-studio/repository-binding', (req, res) => {
      const projectId = String(req.query.projectId || '').trim();
      const project = db.getProject(projectId);
      if (!project) return res.status(404).json({ error: 'project_not_found' });
      if (!canAccessProject(req, project)) return res.status(403).json({ error: 'forbidden' });
      try {
        const inspection = inspectWorkspaceGit({ workspaceRoot: project.workspace_path });
        const repository = options.repo();
        const consent = repository.getExistingRepositoryConsent(projectId);
        const binding = repository.getRepositoryBinding(projectId);
        const existingRepositoryDirty = inspection.existing
          ? inspectExistingRepositoryDirty({ inspection })
          : false;
        return res.json({
          ok: true,
          projectId,
          existingRepositoryDetected: !!inspection.existing,
          existingRepositoryDirty,
          managedRepositoryExists: inspection.managed.exists,
          decisionRequired: !!inspection.existing && !inspection.managed.exists && !consent,
          existingRepositoryConsent: consent
            ? { allowExistingRepository: consent.allowExistingRepository, decisionSource: consent.decisionSource }
            : null,
          binding: binding ? { mode: binding.mode, status: binding.status, reason: binding.reason } : null,
        });
      } catch (error) {
        return res.status(409).json({ error: error.code || 'repository_inspection_failed' });
      }
    });

    app.post('/api/result-studio/repository-binding/consent', (req, res) => {
      const projectId = String(req.body?.projectId || '').trim();
      const project = db.getProject(projectId);
      if (!project) return res.status(404).json({ error: 'project_not_found' });
      if (!canAccessProject(req, project)) return res.status(403).json({ error: 'forbidden' });
      const result = attachExistingRepositoryWithExplicitConsent({
        projectId,
        workspaceRoot: project.workspace_path,
        allowExistingRepository: req.body?.allowExistingRepository,
      }, {
        repository: options.repo(),
        bindProjectRepository,
      });
      if (!result.ok) return res.status(result.status).json({
        error: result.code,
        bindingStatus: result.bindingStatus || null,
      });
      return res.json(result);
    });
  },
};
