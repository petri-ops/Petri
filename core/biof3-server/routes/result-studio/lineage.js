'use strict';

/**
 * routes/result-studio/lineage.js — lineage 子域（BLOCK-127 / G0-BIO BIO-3 P1）
 *
 * 数据真相=result_workflow_graphs（buildAuthoritativeWorkflowGraph 从
 * Job/Revision/Selection 真值投影持久化）。本端点只做只读投影：
 *   GET /api/result-studio/lineage?jobId=<toolJobId>[&projectId=<id>]
 * 找包含该 job 的最新图 → 祖先链（上游在前、当前在末尾）+ 直接下游数。
 * 无图/无节点诚实返回 lineage=null + 说明，不虚构链。
 */

const { buildLineageChain } = require('../../../shared-backend/result-studio-lineage');

module.exports = {
  register(app, options) {
    if (typeof app.get !== 'function') {
      throw new Error('result-studio/lineage register requires an Express app');
    }
    if (!options || typeof options.repo !== 'function' || !options.sqlite) {
      throw new Error('result-studio/lineage register requires options.repo / options.sqlite');
    }
    app.get('/api/result-studio/lineage', async (req, res) => {
      try {
        const jobId = String(req.query.jobId || '').trim();
        if (!jobId) return res.status(400).json({ ok: false, error: 'jobId_required' });
        let projectId = String(req.query.projectId || '').trim() || null;
        if (!projectId) {
          const row = options.sqlite.prepare('SELECT project_id FROM tool_jobs WHERE id = ?').get(jobId);
          projectId = row && row.project_id ? String(row.project_id) : null;
        }
        if (!projectId) {
          return res.json({ ok: true, lineage: null, note: '该结果没有项目归属，无血缘可投影。' });
        }
        const graphs = options.repo().listProjectWorkflowGraphs(projectId);
        for (const graph of graphs) {
          const lineage = buildLineageChain(graph, jobId);
          if (lineage) {
            return res.json({ ok: true, projectId, graphId: graph.graphId, lineage });
          }
        }
        return res.json({
          ok: true,
          projectId,
          lineage: null,
          note: '该项目暂无持久化工作流血缘（跨 Job 的选择/富集等操作执行后生成）。',
        });
      } catch (error) {
        return res.status(500).json({ ok: false, error: 'lineage_projection_failed', message: String(error && error.message || error) });
      }
    });
  },
};
