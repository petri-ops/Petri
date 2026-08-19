'use strict';

/**
 * routes/result-studio/workspace.js — workspace 子域（PHASE 2.1b）
 *
 * 下沉的端点（来自 routes/result-studio.js 第 995-1049 行）：
 *   GET  /api/result-studio/workspace/status
 *   POST /api/result-studio/workspace/recover
 *
 * 跨子文件依赖：
 *   - projectContext 通过 options.projectContext
 *   - workspaceInspectionWork（recover + status 共享 dedup runner）通过 options.workspaceInspectionWork
 *   - getResultStudioRuntimeLease 来自 shared-backend/result-studio-runtime-lease
 *   - publicResultStudioErrorMessage 来自 _helpers/format
 */

const { getResultStudioRuntimeLease } = require('../../../shared-backend/result-studio-runtime-lease');
const { publicResultStudioErrorMessage } = require('../_helpers/format');

module.exports = {
  register(app, options) {
    if (typeof app.get !== 'function') {
      throw new Error('result-studio/workspace register requires an Express app');
    }
    if (!options || typeof options.projectContext !== 'function'
      || !options.workspaceInspectionWork || typeof options.workspaceInspectionWork.run !== 'function'
      || !('databasePath' in options)) {
      throw new Error('result-studio/workspace register requires options.projectContext / workspaceInspectionWork / databasePath');
    }

    app.get('/api/result-studio/workspace/status', async (req, res) => {
      const projectId = String(req.query.projectId || '').trim();
      if (!projectId) return res.status(400).json({ error: 'projectId_required' });
      // Validate identity/project ownership on the request thread, but move Git
      // binding, full-history hashing and private-storage walking off it.
      const context = options.projectContext(req, projectId, { git: false });
      if (context.error) return res.status(context.error.status).json({ error: context.error.code });
      try {
        const conversationId = String(req.query.conversationId || '').trim() || null;
        const inspectionKey = `${projectId}\0${conversationId || ''}`;
        const result = await options.workspaceInspectionWork.run(
          inspectionKey,
          'inspect-workspace',
          {
            databasePath: options.databasePath,
            projectId,
            workspaceRoot: context.project.workspace_path,
            conversationId,
            runtimeLease: getResultStudioRuntimeLease(),
          },
        );
        return res.json(result);
      } catch (error) {
        return res.status(409).json({
          error: error.code || 'workspace_inspection_failed',
          message: publicResultStudioErrorMessage(error, 'Result Studio workspace inspection failed.'),
        });
      }
    });

    app.post('/api/result-studio/workspace/recover', async (req, res) => {
      const projectId = String(req.body?.projectId || '').trim();
      const context = options.projectContext(req, projectId, { git: false });
      if (context.error) return res.status(context.error.status).json({ error: context.error.code });
      try {
        const conversationId = String(req.body?.conversationId || '').trim() || null;
        const result = await options.workspaceInspectionWork.run(
          `recover\0${projectId}\0${conversationId || ''}`,
          'recover-workspace',
          {
            databasePath: options.databasePath,
            projectId,
            workspaceRoot: context.project.workspace_path,
            conversationId,
            runtimeLease: getResultStudioRuntimeLease(),
          },
        );
        return res.status(result.after.status === 'blocked' ? 409 : 200).json({ ok: result.after.status !== 'blocked', ...result });
      } catch (error) {
        return res.status(409).json({
          error: error.code || 'workspace_recovery_failed',
          message: publicResultStudioErrorMessage(error, 'Result Studio workspace recovery failed.'),
        });
      }
    });
  },
};
