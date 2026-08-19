'use strict';

/**
 * routes/result-studio/selection.js — selection 子域（PHASE 2.1b）
 *
 * 下沉的端点（来自 routes/result-studio.js 第 610-749 行）：
 *   POST  /api/result-studio/selection
 *   GET   /api/result-studio/selection/current
 *   GET   /api/result-studio/selection/:selectionId
 *   DELETE /api/result-studio/selection/:selectionId
 *   POST  /api/result-studio/selection/query
 *   POST  /api/result-studio/selection/resolve
 *
 * 共享 helper 走 `routes/_helpers/*`：
 *   - validateSelectionContext / summarizeSelection / assessSelectionCompatibility
 *     来自 shared-backend/result-studio-contracts
 *   - bindAuthoritativeQuerySelection 来自 _helpers/workflow
 *   - buildQuerySelection / describeSelectionForAgent / resolveSelectedEntityIds
 *     来自 shared-backend/artifact-interaction
 *
 * 行为 100% 兼容：原 file 在第 615 / 686 / 700 行使用 `sqlite.prepare('SELECT * ...').get(...)`
 * 直接访问 `projects` 表，PHASE 2.1b 保留此模式。
 */

const db = require('../../db');
const sqlite = db.db;
const {
  assessSelectionCompatibility,
  validateSelectionContext,
  summarizeSelection,
} = require('../../../shared-backend/result-studio-contracts');
const {
  buildQuerySelection,
  describeSelectionForAgent,
  resolveSelectedEntityIds,
} = require('../../../shared-backend/artifact-interaction');
const { canAccessProject } = require('../_helpers/validate');
const { sendArtifactResolutionError } = require('../_helpers/format');
const { bindAuthoritativeQuerySelection } = require('../_helpers/workflow');

module.exports = {
  register(app, options) {
    if (typeof app.get !== 'function') {
      throw new Error('result-studio/selection register requires an Express app');
    }
    if (!options || typeof options.repo !== 'function') {
      throw new Error('result-studio/selection register requires options.repo');
    }

    /**
     * 持久化一个选择。大选择走 filter 权威表达，不把百万 ID 塞进库。
     */
    app.post('/api/result-studio/selection', (req, res) => {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const projectId = String(body.projectId || '').trim();
      if (!projectId) return res.status(400).json({ error: 'projectId_required' });

      const project = sqlite.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
      if (!project) return res.status(404).json({ error: 'project_not_found' });
      if (!canAccessProject(req, project)) return res.status(403).json({ error: 'forbidden' });

      let validated = validateSelectionContext({
        selectionId: body.selectionId,
        projectId,
        conversationId: body.conversationId,
        artifactId: body.artifactId,
        revisionId: body.revisionId,
        entityType: body.entityType,
        entityIds: body.entityIds,
        entityIdCount: body.entityIdCount,
        entityIdsHash: body.entityIdsHash,
        filterHash: body.filterHash,
        filterExpression: body.filterExpression,
        sort: body.sort,
        viewport: body.viewport,
        displayState: body.displayState,
      });
      if (!validated.ok) {
        return res.status(400).json({ error: 'selection_invalid', details: validated.errors });
      }

      try {
        const repository = options.repo();
        const bound = bindAuthoritativeQuerySelection({
          req,
          project,
          selection: validated.selection,
          repository,
        });
        if (bound.error) return sendArtifactResolutionError(res, bound.error);
        if (bound.authoritative) {
          validated = validateSelectionContext(bound.selection);
          if (!validated.ok) {
            return res.status(409).json({ error: 'selection_authoritative_invalid' });
          }
        }
        const saved = repository.saveSelection(validated.selection);
        return res.json({ selection: saved, summary: summarizeSelection(saved) });
      } catch (error) {
        return res.status(500).json({ error: 'selection_persist_failed', message: error && error.message });
      }
    });

    /** 按项目+会话+Artifact 恢复最后选择，并返回兼容性状态。 */
    app.get('/api/result-studio/selection/current', (req, res) => {
      const projectId = String(req.query.projectId || '').trim();
      const artifactId = String(req.query.artifactId || '').trim();
      const conversationId = String(req.query.conversationId || '').trim() || null;
      if (!projectId || !artifactId) return res.status(400).json({ error: 'project_and_artifact_required' });
      const project = sqlite.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
      if (!project) return res.status(404).json({ error: 'project_not_found' });
      if (!canAccessProject(req, project)) return res.status(403).json({ error: 'forbidden' });
      const selection = options.repo().findLatestSelection({ projectId, conversationId, artifactId });
      if (!selection) return res.status(404).json({ error: 'selection_not_found' });
      const compatibility = assessSelectionCompatibility({
        selection,
        projectId,
        artifactId,
        revisionId: String(req.query.revisionId || '').trim() || null,
        selectionDurable: String(req.query.selectionDurable || 'true') !== 'false',
      });
      return res.json({ selection, compatibility, summary: summarizeSelection(selection) });
    });

    /** 按 id 恢复选择。 */
    app.get('/api/result-studio/selection/:selectionId', (req, res) => {
      const selection = options.repo().getSelection(String(req.params.selectionId || '').trim());
      if (!selection) return res.status(404).json({ error: 'selection_not_found' });
      const project = sqlite.prepare('SELECT * FROM projects WHERE id = ?').get(selection.projectId);
      if (!canAccessProject(req, project)) return res.status(403).json({ error: 'forbidden' });
      return res.json({
        selection,
        summary: summarizeSelection(selection),
        agentView: describeSelectionForAgent(selection),
      });
    });

    /** 删除选择（用户显式清空）。 */
    app.delete('/api/result-studio/selection/:selectionId', (req, res) => {
      const selectionId = String(req.params.selectionId || '').trim();
      const selection = options.repo().getSelection(selectionId);
      if (!selection) return res.status(404).json({ error: 'selection_not_found' });
      const project = sqlite.prepare('SELECT * FROM projects WHERE id = ?').get(selection.projectId);
      if (!canAccessProject(req, project)) return res.status(403).json({ error: 'forbidden' });
      options.repo().deleteSelection(selectionId);
      return res.json({ deleted: true, selectionId });
    });

    /**
     * 用 filter 表达一个大选择，并返回权威 hash。
     *
     * 用于 10 万行级表格：ID 列表不进上下文，filter + hash 才是选择本体。
     */
    app.post('/api/result-studio/selection/query', (req, res) => {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const manifest = body.manifest;
      if (!manifest || typeof manifest !== 'object') {
        return res.status(400).json({ error: 'manifest_required' });
      }
      try {
        const selection = buildQuerySelection({
          manifest,
          filter: body.filter,
          matchedCount: body.matchedCount,
          sampleEntityIds: body.sampleEntityIds,
        });
        return res.json({ selection, agentView: describeSelectionForAgent(selection) });
      } catch (error) {
        return res.status(400).json({ error: error.code || 'query_selection_failed', message: error && error.message });
      }
    });

    /**
     * 把选中的行解析成稳定实体 ID。
     *
     * positional artifact 会返回 durable=false 与诊断，调用方不得把行号当身份。
     */
    app.post('/api/result-studio/selection/resolve', (req, res) => {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      if (!body.manifest || typeof body.manifest !== 'object') {
        return res.status(400).json({ error: 'manifest_required' });
      }
      try {
        const resolved = resolveSelectedEntityIds({
          manifest: body.manifest,
          selectedRows: Array.isArray(body.selectedRows) ? body.selectedRows : [],
        });
        return res.json(resolved);
      } catch (error) {
        return res.status(400).json({ error: error.code || 'resolve_failed', message: error && error.message });
      }
    });
  },
};
