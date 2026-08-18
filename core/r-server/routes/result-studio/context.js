'use strict';

/**
 * routes/result-studio/context.js — context 子域（PHASE 2.1b）
 *
 * 下沉的端点（来自 routes/result-studio.js 第 761-800 行）：
 *   GET /api/result-studio/context-envelope
 *
 * 共享 helper 走 `routes/_helpers/*`：
 *   - userId 来自 _helpers/validate
 *
 * 该子域只挂载 1 个 GET 端点。
 */

const db = require('../../db');
const {
  resolveResultStudioContext,
} = require('../../agent-tools/result-context-tools');
const { buildEditControlSchema } = require('../../../shared-backend/result-edit-controls');
const {
  summarizeContextForAgent,
  PUBLIC_EDIT_PHASES,
} = require('../../../shared-backend/result-studio-context');
const { canAccessProject, userId } = require('../_helpers/validate');

module.exports = {
  register(app, options) {
    if (typeof app !== 'object' || typeof app.get !== 'function') {
      throw new Error('result-studio/context register requires an Express app');
    }
    if (!options || typeof options.repo !== 'function') {
      throw new Error('result-studio/context register requires options.repo');
    }

    /**
     * G0-RS-P3 — 当前结果的 ResultStudioContextEnvelope 投影。
     *
     * 前端与 Agent 共用同一份真相：这里不接受调用方声明的 revision/selection
     * 身份，只接受"用户打开了哪个 Job 的哪个文件"这一线索，其余坐标全部从
     * SQLite / tool_jobs / 插件 descriptor 重新解析。缺少正式 Revision、
     * 归因只能到 Job 时返回 409 与可行动诊断，不伪造坐标。
     */
    app.get('/api/result-studio/context-envelope', (req, res) => {
      const projectId = String(req.query.projectId || '').trim();
      if (!projectId) return res.status(400).json({ error: 'projectId_required' });
      const project = db.getProject(projectId);
      if (!project) return res.status(404).json({ error: 'project_not_found' });
      if (!canAccessProject(req, project)) return res.status(403).json({ error: 'forbidden' });
      const resolved = resolveResultStudioContext({
        projectId,
        userId: userId(req),
        conversationId: String(req.query.conversationId || '').trim() || null,
        activeArtifact: {
          jobId: String(req.query.jobId || '').trim() || null,
          name: String(req.query.artifact || '').trim() || null,
          revisionId: String(req.query.revisionId || '').trim() || null,
        },
      }, { repository: options.repo() });
      if (!resolved.ok) {
        return res.status(409).json({
          error: resolved.diagnostics[0]?.code || 'context_unavailable',
          message: resolved.diagnostics[0]?.message || null,
          diagnostics: resolved.diagnostics,
        });
      }
      // G0-RS-P4：手动控件 schema 与 Agent 可见的可编辑参数出自同一 descriptor
      // 投影，因此前端参数面板不可能显示插件未声明的参数，也不会与 AI 看到的
      // 契约分叉。currentValues 取该 Job 真实执行过的归一化参数，不用默认值冒充。
      const controlSchema = buildEditControlSchema(resolved.descriptor);
      return res.json({
        envelope: resolved.envelope,
        agentView: summarizeContextForAgent(resolved.envelope),
        editControls: {
          controlsVersion: controlSchema.controlsVersion,
          groups: controlSchema.groups,
          controls: controlSchema.controls,
          diagnostics: controlSchema.diagnostics,
          currentValues: resolved.currentParameters || {},
        },
        publicPhases: [...PUBLIC_EDIT_PHASES],
      });
    });
  },
};
