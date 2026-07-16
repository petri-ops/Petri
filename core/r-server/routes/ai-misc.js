/**
 * routes/ai-misc.js — misc small AI endpoints (settings, audit, undo,
 * docs-index, site-snapshot, health, usage-mine, act-registry).
 * Migrated from server.js as part of MODULES_BATCH2_v1.
 *
 * DB access goes through the shared desktop SQLite handle.
 */
const express = require('express');
const dbMod = require('../db');
const adb = dbMod.getAsyncDatabase();

module.exports = function mountMisc(app) {

  app.get('/api/ai/health', (req, res) => {
    res.json({status: 'ok', timestamp: new Date().toISOString()});
  });

  app.get('/api/ai/agent-audit', async (req, res) => {
    const userId = req.user && req.user.id;
    if (!userId) return res.status(401).json({status:'error', error:'未授权'});
    try {
      const rows = await adb.prepare('SELECT id, undo_token, action, args, result, ts, undone FROM agent_audit WHERE user_id=? ORDER BY ts DESC LIMIT 50').all(userId);
      res.json({status:'ok', items: rows.map(r => ({...r, args: _safeJSON(r.args), result: _safeJSON(r.result)}))});
    } catch (e) { res.status(500).json({status:'error', error: e.message}); }
  });

  app.post('/api/ai/agent-undo/:token', async (req, res) => {
    const userId = req.user && req.user.id;
    if (!userId) return res.status(401).json({status:'error', error:'未授权'});
    const undoFn = globalThis._biof3 && globalThis._biof3.undoAgentAct;
    if (!undoFn) return res.status(500).json({status:'error', error:'helper_missing'});
    const result = await undoFn(userId, req.params.token);
    res.json({status: result.ok ? 'ok' : 'error', ...result});
  });

  app.get('/api/ai/agent-settings', async (req, res) => {
    const userId = req.user && req.user.id;
    if (!userId) return res.status(401).json({status:'error', error:'未授权'});
    try {
      const row = await adb.prepare('SELECT agent_paused FROM copilot_settings WHERE user_id=?').get(userId);
      res.json({status:'ok', agentPaused: row ? !!row.agent_paused : false});
    } catch (e) { res.status(500).json({status:'error', error: e.message}); }
  });

  app.post('/api/ai/agent-settings', express.json({limit:'4kb'}), async (req, res) => {
    const userId = req.user && req.user.id;
    if (!userId) return res.status(401).json({status:'error', error:'未授权'});
    try {
      const paused = !!(req.body && req.body.agentPaused);
      const now = new Date().toISOString();
      await adb.prepare(`INSERT INTO copilot_settings(user_id, agent_paused, updated_at) VALUES (?,?,?)
                  ON CONFLICT(user_id) DO UPDATE SET agent_paused=excluded.agent_paused, updated_at=excluded.updated_at`)
        .run(userId, paused ? 1 : 0, now);
      res.json({status:'ok', agentPaused: paused});
    } catch (e) { res.status(500).json({status:'error', error: e.message}); }
  });

  app.get('/api/ai/usage-mine', async (req, res) => {
    const userId = req.user && req.user.id;
    if (!userId) return res.status(401).json({status:'error', error:'未授权'});
    const days = Math.max(1, Math.min(60, parseInt(req.query.days) || 30));
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    try {
      const total = await adb.prepare(`SELECT COUNT(*) AS calls, SUM(prompt_tokens) AS prompt_tokens, SUM(completion_tokens) AS completion_tokens, AVG(latency_ms) AS avg_latency FROM ai_usage WHERE user_id=? AND ts >= ?`).get(userId, cutoff);
      res.json({status:'ok', days, ...total});
    } catch (e) { res.status(500).json({status:'error', error: e.message}); }
  });

  app.get('/api/ai/site-snapshot', (req, res) => {
    const userId = req.user && req.user.id;
    if (!userId) return res.status(401).json({status:'error', error:'未授权'});
    const buildSnap = globalThis._biof3 && globalThis._biof3.buildSiteSnapshot;
    if (!buildSnap) return res.status(500).json({status:'error', error:'helper_missing'});
    res.json({status: 'ok', snapshot: buildSnap(userId)});
  });

  app.get('/api/ai/docs-index', (req, res) => {
    const cache = globalThis._biof3 && globalThis._biof3.docsIndexCache && globalThis._biof3.docsIndexCache();
    if (cache) return res.json({status:'ok', index: cache});
    const fetchIdx = globalThis._biof3 && globalThis._biof3.fetchDocsIndex;
    if (!fetchIdx) return res.status(500).json({status:'error', error:'helper_missing'});
    fetchIdx().then(idx => idx ? res.json({status:'ok', index: idx}) : res.status(500).json({status:'error', error:'failed_to_load'}));
  });
};

function _safeJSON(s) { try { return JSON.parse(s || '{}'); } catch { return null; } }
