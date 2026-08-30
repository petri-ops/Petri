'use strict';

/**
 * routes/result-studio/preview-budget.js — preview-budget 子域（PHASE 2.1b）
 *
 * 下沉的端点（来自 routes/result-studio.js 第 1106-1119 行）：
 *   GET /api/result-studio/preview-budget
 *
 * 跨子文件依赖：
 *   - projectContext 通过 options.projectContext
 *   - buildContextBoundPreviewBudget 来自 _helpers/context
 *   - fs.statfsSync 用于读取磁盘信息
 */

const fs = require('fs');
const { buildContextBoundPreviewBudget } = require('../_helpers/context');

module.exports = {
  register(app, options) {
    if (typeof app.get !== 'function') {
      throw new Error('result-studio/preview-budget register requires an Express app');
    }
    if (!options || typeof options.projectContext !== 'function' || typeof options.repo !== 'function') {
      throw new Error('result-studio/preview-budget register requires options.projectContext / repo');
    }

    app.get('/api/result-studio/preview-budget', (req, res) => {
      const projectId = String(req.query.projectId || '').trim();
      const context = options.projectContext(req, projectId);
      if (context.error) return res.status(context.error.status).json({ error: context.error.code });
      let disk = null;
      try {
        if (typeof fs.statfsSync === 'function') {
          const stat = fs.statfsSync(context.project.workspace_path);
          disk = { availableBytes: Number(stat.bavail) * Number(stat.bsize), totalBytes: Number(stat.blocks) * Number(stat.bsize) };
        }
      } catch { /* snapshot reports unknown disk */ }
      const activePreviewJobs = context.repository.listChangeSets({ projectId, status: 'running', limit: 500 }).length;
      return res.json(buildContextBoundPreviewBudget({ disk, activePreviewJobs }));
    });
  },
};
