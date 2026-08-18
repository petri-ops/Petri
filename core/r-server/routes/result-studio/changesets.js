'use strict';

/**
 * routes/result-studio/changesets.js — changesets 子域（PHASE 2.1b）
 *
 * 下沉的端点（来自 routes/result-studio.js 多处）：
 *   GET  /api/result-studio/changesets                       （第 802-829 行）
 *   GET  /api/result-studio/changesets/:changeSetId/compare  （第 974-991 行）
 *   POST /api/result-studio/changesets/:changeSetId/adopt    （第 1140-1158 行）
 *   POST /api/result-studio/changesets/:changeSetId/revert   （第 1160-1177 行）
 *
 * 关键跨子文件依赖：`projectContext` / `changeSetContext` 由 `result-studio/index.js`
 * 通过 `options.projectContext` 工厂函数提供（避免子文件各自重复实现 + 与主
 * 文件闭包变量绑定）。
 *
 * `changeSetContext(req, changeSetId, options)` 内部先查 changeSet，再调
 * projectContext（传 write 选项时开启 git binding 写路径）。
 */

const db = require('../../db');
const {
  compareResultChangeSet,
  adoptResultChangeSet,
  revertResultChangeSet,
} = require('../../../shared-backend/result-compare-service');

module.exports = {
  register(app, options) {
    if (typeof app !== 'object' || typeof app.get !== 'function') {
      throw new Error('result-studio/changesets register requires an Express app');
    }
    if (!options || typeof options.repo !== 'function'
      || typeof options.projectContext !== 'function'
      || typeof options.changeSetContext !== 'function') {
      throw new Error('result-studio/changesets register requires options.repo / projectContext / changeSetContext');
    }

    app.get('/api/result-studio/changesets', (req, res) => {
      const projectId = String(req.query.projectId || '').trim();
      if (!projectId) return res.status(400).json({ error: 'projectId_required' });
      const context = options.projectContext(req, projectId, { git: false });
      if (context.error) return res.status(context.error.status).json({ error: context.error.code });
      const artifactFamilyId = String(req.query.artifactFamilyId || '').trim() || null;
      const revisionOffset = Math.max(0, Number.parseInt(String(req.query.revisionOffset || '0'), 10) || 0);
      const revisionLimit = Math.min(200, Math.max(1, Number.parseInt(String(req.query.revisionLimit || '100'), 10) || 100));
      const changeSets = artifactFamilyId
        ? context.repository.listChangeSetsByArtifactFamily({ projectId, artifactFamilyId, limit: 200 })
        : context.repository.listChangeSets({ projectId, limit: 200 });
      const revisionPage = artifactFamilyId
        ? context.repository.listRevisions({
            artifactFamilyId,
            projectId,
            limit: revisionLimit + 1,
            offset: revisionOffset,
            order: 'desc',
          })
        : [];
      const hasMoreRevisions = revisionPage.length > revisionLimit;
      return res.json({
        changeSets,
        currentRevision: artifactFamilyId ? context.repository.getCurrentRevision(artifactFamilyId, projectId) : null,
        revisions: revisionPage.slice(0, revisionLimit),
        nextRevisionOffset: hasMoreRevisions ? revisionOffset + revisionLimit : null,
      });
    });

    app.get('/api/result-studio/changesets/:changeSetId/compare', (req, res) => {
      const context = options.changeSetContext(req, String(req.params.changeSetId || '').trim());
      if (context.error) return res.status(context.error.status).json({ error: context.error.code });
      try {
        return res.json(compareResultChangeSet({
          projectId: context.project.id,
          workspaceRoot: context.project.workspace_path,
          changeSetId: context.changeSet.changeSetId,
        }, {
          repository: context.repository,
          adapter: context.binding.adapter,
          gitPathPrefix: context.gitPathPrefix,
          getToolJob: db.getToolJob,
        }));
      } catch (error) {
        return res.status(409).json({ error: error.code || 'compare_failed', message: error.message, detail: error.detail || null });
      }
    });

    app.post('/api/result-studio/changesets/:changeSetId/adopt', (req, res) => {
      const context = options.changeSetContext(req, String(req.params.changeSetId || '').trim(), { write: true });
      if (context.error) return res.status(context.error.status).json({ error: context.error.code, bindingStatus: context.error.bindingStatus });
      try {
        const result = adoptResultChangeSet({
          projectId: context.project.id,
          workspaceRoot: context.project.workspace_path,
          changeSetId: context.changeSet.changeSetId,
        }, {
          repository: context.repository,
          adapter: context.binding.adapter,
          gitPathPrefix: context.gitPathPrefix,
          getToolJob: db.getToolJob,
        });
        return res.json({ ok: true, ...result });
      } catch (error) {
        return res.status(409).json({ error: error.code || 'adopt_failed', message: error.message, detail: error.detail || null });
      }
    });

    app.post('/api/result-studio/changesets/:changeSetId/revert', (req, res) => {
      const context = options.changeSetContext(req, String(req.params.changeSetId || '').trim(), { write: true });
      if (context.error) return res.status(context.error.status).json({ error: context.error.code, bindingStatus: context.error.bindingStatus });
      try {
        const result = revertResultChangeSet({
          projectId: context.project.id,
          workspaceRoot: context.project.workspace_path,
          changeSetId: context.changeSet.changeSetId,
          reason: req.body?.reason || 'user_reverted',
        }, {
          repository: context.repository,
          adapter: context.binding.adapter,
        });
        return res.json({ ok: true, ...result });
      } catch (error) {
        return res.status(409).json({ error: error.code || 'revert_failed', message: error.message, detail: error.detail || null });
      }
    });
  },
};
