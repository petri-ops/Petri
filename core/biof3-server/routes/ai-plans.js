/**
 * routes/ai-plans.js — plan list / get / status / delete.
 * Migrated from server.js as part of MODULES_BATCH2_v1.
 *
 * Uses the Promise facade over desktop SQLite.
 */
const express = require('express');
const dbMod = require('../db');
const adb = dbMod.getAsyncDatabase();
const { approvePlanDraft, applyPlanRevision } = require('../helpers/plan-lifecycle');

module.exports = function mountPlans(app) {
  app.get('/api/ai/plans', async (req, res) => {
    const userId = req.user && req.user.id;
    if (!userId) return res.status(401).json({status:'error', error:'未授权'});
    try {
      // BLOCK-55 P1 — additive 过滤：conversationId / status（前端批准卡按会话拉 draft 计划）
      const clauses = ['user_id=?'];
      const params = [userId];
      if (req.query.conversationId) {
        clauses.push('conversation_id=?');
        params.push(String(req.query.conversationId));
      }
      if (req.query.status) {
        clauses.push('status=?');
        params.push(String(req.query.status));
      }
      const rows = await adb.prepare(`SELECT id, title, goal, status, created_at, updated_at, chat_context_excerpt, spec_md, conversation_id,
        (SELECT COUNT(*) FROM copilot_plan_steps WHERE plan_id=copilot_plans.id) AS total_steps,
        (SELECT COUNT(*) FROM copilot_plan_steps WHERE plan_id=copilot_plans.id AND status='done') AS done_steps,
        (SELECT MAX(rev_no) FROM copilot_plan_revisions WHERE plan_id=copilot_plans.id AND status='proposed') AS pending_revision_no
        FROM copilot_plans WHERE ${clauses.join(' AND ')} ORDER BY updated_at DESC LIMIT 50`).all(...params);
      // BLOCK-55 P1 — 批准卡需要步骤表：批量附 steps（spec_md 保留 snake_case，由前端映射 specMd）
      if (rows.length > 0) {
        const ids = rows.map((r) => r.id);
        const stepRows = await adb.prepare(
          `SELECT plan_id, n, title, hint, assignee, status FROM copilot_plan_steps
           WHERE plan_id IN (${ids.map(() => '?').join(',')}) ORDER BY plan_id, n ASC`
        ).all(...ids);
        const byPlan = new Map();
        for (const s of stepRows) {
          if (!byPlan.has(s.plan_id)) byPlan.set(s.plan_id, []);
          byPlan.get(s.plan_id).push({ n: s.n, title: s.title, hint: s.hint, assignee: s.assignee, status: s.status });
        }
        for (const r of rows) r.steps = byPlan.get(r.id) || [];
      }
      res.json({status:'ok', plans: rows});
    } catch (e) { res.status(500).json({status:'error', error: e.message}); }
  });

  app.get('/api/ai/plans/:id', async (req, res) => {
    const userId = req.user && req.user.id;
    if (!userId) return res.status(401).json({status:'error', error:'未授权'});
    try {
      const plan = await adb.prepare('SELECT * FROM copilot_plans WHERE id=? AND user_id=?').get(req.params.id, userId);
      if (!plan) return res.status(404).json({status:'error', error:'not_found'});
      const steps = await adb.prepare('SELECT * FROM copilot_plan_steps WHERE plan_id=? ORDER BY n ASC').all(plan.id);
      res.json({status:'ok', plan: {...plan, steps}});
    } catch (e) { res.status(500).json({status:'error', error: e.message}); }
  });

  // BLOCK-55 P1 — 批准三选一：execute / execute-fresh / keep-planning
  app.post('/api/ai/plans/:id/approve', express.json({limit:'4kb'}), async (req, res) => {
    const userId = req.user && req.user.id;
    if (!userId) return res.status(401).json({status:'error', error:'未授权'});
    try {
      const action = req.body && req.body.action;
      const result = await approvePlanDraft(adb, userId, req.params.id, action);
      if (!result.ok) {
        return res.status(result.error === 'plan_not_found' ? 404 : 400).json({status:'error', error: result.error, message: result.message});
      }
      res.json({status:'ok', action: result.action, plan: result.plan});
    } catch (e) { res.status(500).json({status:'error', error: e.message}); }
  });

  // BLOCK-55 P3 — 修订历史
  app.get('/api/ai/plans/:id/revisions', async (req, res) => {
    const userId = req.user && req.user.id;
    if (!userId) return res.status(401).json({status:'error', error:'未授权'});
    try {
      const plan = await adb.prepare('SELECT id FROM copilot_plans WHERE id=? AND user_id=?').get(req.params.id, userId);
      if (!plan) return res.status(404).json({status:'error', error:'not_found'});
      const revisions = await adb.prepare(
        'SELECT id, rev_no, reason, status, proposed_json, created_at, applied_at FROM copilot_plan_revisions WHERE plan_id=? ORDER BY rev_no DESC'
      ).all(plan.id);
      res.json({status:'ok', revisions});
    } catch (e) { res.status(500).json({status:'error', error: e.message}); }
  });

  // BLOCK-55 P3 — 应用修订案（proposed → 替换步骤表 + 标记 applied）
  app.post('/api/ai/plans/:id/revisions/:revNo/approve', async (req, res) => {
    const userId = req.user && req.user.id;
    if (!userId) return res.status(401).json({status:'error', error:'未授权'});
    try {
      const revNo = Number.parseInt(req.params.revNo, 10);
      if (!Number.isFinite(revNo)) return res.status(400).json({status:'error', error:'invalid_rev_no'});
      const result = await applyPlanRevision(adb, userId, req.params.id, revNo);
      if (!result.ok) {
        return res.status(result.error === 'plan_not_found' || result.error === 'revision_not_found' ? 404 : 400).json({status:'error', error: result.error, message: result.message});
      }
      res.json({status:'ok', revNo: result.revNo, plan: result.plan});
    } catch (e) { res.status(500).json({status:'error', error: e.message}); }
  });

  app.patch('/api/ai/plans/:id', express.json({limit:'8kb'}), async (req, res) => {
    const userId = req.user && req.user.id;
    if (!userId) return res.status(401).json({status:'error', error:'未授权'});
    try {
      const allowed = ['active', 'paused', 'completed', 'cancelled'];
      const status = (req.body && req.body.status);
      if (!allowed.includes(status)) return res.status(400).json({status:'error', error:'invalid_status'});
      const r = await adb.prepare('UPDATE copilot_plans SET status=?, updated_at=? WHERE id=? AND user_id=?')
        .run(status, new Date().toISOString(), req.params.id, userId);
      if (r.changes === 0) return res.status(404).json({status:'error', error:'not_found'});
      res.json({status:'ok'});
    } catch (e) { res.status(500).json({status:'error', error: e.message}); }
  });

  app.delete('/api/ai/plans/:id', async (req, res) => {
    const userId = req.user && req.user.id;
    if (!userId) return res.status(401).json({status:'error', error:'未授权'});
    try {
      const r = await adb.prepare('DELETE FROM copilot_plans WHERE id=? AND user_id=?').run(req.params.id, userId);
      await adb.prepare('DELETE FROM copilot_plan_steps WHERE plan_id NOT IN (SELECT id FROM copilot_plans)').run();
      if (r.changes === 0) return res.status(404).json({status:'error', error:'not_found'});
      res.json({status:'ok'});
    } catch (e) { res.status(500).json({status:'error', error: e.message}); }
  });
};
