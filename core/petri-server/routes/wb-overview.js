'use strict';

/**
 * routes/wb-overview.js — item 88 第三波：wb 目标/任务只读投影面。
 *
 * GET /api/wb/overview?projectId=<id>
 *   → { ok, projectId, goals: [{ id, description, budgetCny, status, acceptance, tasks: [...] }] }
 *
 * 只读：不写 wb_* 任何表（写入面仍归 wave3+ 的 store/agent 工具）。
 * 形状为前端总览投影消费面（WorkbenchOverviewSurface wb 目标树）：
 * 五态 accepted/running/blocked/needs-user/queued 原样透传，spec/依赖/计量不丢。
 */

const db = require('../db').getDatabase();

function registerWbOverviewRoutes(app) {
  app.get('/api/wb/overview', (req, res) => {
    const projectId = typeof req.query.projectId === 'string' ? req.query.projectId.trim() : '';
    if (!projectId) return res.status(400).json({ ok: false, error: 'project_id_required' });

    const goals = db.prepare(
      'SELECT id, description, budget_cny, status, acceptance_json, created_at FROM wb_goals WHERE project_id = ? ORDER BY created_at DESC'
    ).all(projectId).map((goal) => {
      const tasks = db.prepare(
        'SELECT id, status, priority, spec_json, dependencies_json, created_at FROM wb_tasks WHERE goal_id = ? ORDER BY priority ASC, created_at ASC'
      ).all(goal.id).map((task) => {
        let spec = null;
        let dependencies = [];
        try { spec = task.spec_json ? JSON.parse(task.spec_json) : null; } catch { spec = null; }
        try { dependencies = task.dependencies_json ? JSON.parse(task.dependencies_json) : []; } catch { dependencies = []; }
        return {
          id: task.id,
          status: task.status,
          priority: task.priority,
          spec,
          dependencies,
          createdAt: task.created_at,
        };
      });
      let acceptance = null;
      try { acceptance = goal.acceptance_json ? JSON.parse(goal.acceptance_json) : null; } catch { acceptance = null; }
      return {
        id: goal.id,
        description: goal.description,
        budgetCny: goal.budget_cny,
        status: goal.status,
        acceptance,
        tasks,
      };
    });

    return res.json({ ok: true, projectId, goals });
  });
}

module.exports = { registerWbOverviewRoutes };
