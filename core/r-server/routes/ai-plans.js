/**
 * routes/ai-plans.js — plan list / get / status / delete.
 * Migrated from server.js as part of MODULES_BATCH2_v1.
 *
 * Uses the Promise facade over desktop SQLite.
 */
const express = require('express');
const dbMod = require('../db');
const adb = dbMod.getAsyncDatabase();

module.exports = function mountPlans(app) {
  app.get('/api/ai/plans', async (req, res) => {
    const userId = req.user && req.user.id;
    if (!userId) return res.status(401).json({status:'error', error:'未授权'});
    try {
      const rows = await adb.prepare(`SELECT id, title, goal, status, created_at, updated_at, chat_context_excerpt,
        (SELECT COUNT(*) FROM copilot_plan_steps WHERE plan_id=copilot_plans.id) AS total_steps,
        (SELECT COUNT(*) FROM copilot_plan_steps WHERE plan_id=copilot_plans.id AND status='done') AS done_steps
        FROM copilot_plans WHERE user_id=? ORDER BY updated_at DESC LIMIT 50`).all(userId);
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
