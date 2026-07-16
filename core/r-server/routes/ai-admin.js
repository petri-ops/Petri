/**
 * routes/ai-admin.js — admin governance, audit, AI usage stats.
 * Migrated from server.js as part of MODULES_BATCH2_v1.
 *
 * Uses the Promise facade over the desktop SQLite database so route handlers
 * can keep a consistent async control flow.
 */
const express = require('express');
const dbMod = require('../db');
const adb = dbMod.getAsyncDbForLegacyModules();
const {
  isAgentGloballyPausedAsync,
  setAgentGlobalPauseAsync,
} = require('../helpers/admin-gov');

function _undoneTrue(col = 'undone') {
  return `${col}=1`;
}

function _boolFromDb(v) {
  return v === true || v === 1 || v === '1' || v === 't';
}

function _requireAdmin(req, res) {
  if (!req.user || req.user.role !== 'admin') {
    res.status(403).json({status: 'error', error: '需要管理员权限'});
    return false;
  }
  return true;
}

// async scalar: first column of first row, or null
async function _scalar(sql, ...params) {
  const r = await adb.prepare(sql).get(...params);
  return r ? Object.values(r)[0] : null;
}

module.exports = function mountAdmin(app) {

  app.get('/api/ai/admin/users-overview', async (req, res) => {
    if (!_requireAdmin(req, res)) return;
    try {
      // OPT_ADMIN_OVERVIEW_v1: 11 batch COUNT queries instead of users × 11 sequential.
      const baseUsers = await adb
        .prepare('SELECT id, username, role, created_at FROM users ORDER BY created_at DESC')
        .all();

      if (baseUsers.length === 0) return res.json({status:'ok', users: [], globalPaused: false});

      // Batch 1: conversation + message counts (JOIN-safe: group before join)
      const convCounts = await adb.prepare(`
        SELECT c.user_id,
          COUNT(DISTINCT c.id) AS conv_count,
          COUNT(m.id) AS msg_count
        FROM copilot_conversations c
        LEFT JOIN copilot_messages m ON m.conversation_id = c.id
        GROUP BY c.user_id
      `).all();
      const convMap = {};
      for (const r of convCounts) convMap[r.user_id] = r;

      // Batch 2: facts + vectors + plans + active plans
      const [factCounts, vecCounts, planCounts, actCounts] = await Promise.all([
        adb.prepare('SELECT user_id, COUNT(*) AS n FROM user_facts GROUP BY user_id').all(),
        adb.prepare('SELECT user_id, COUNT(*) AS n FROM memory_vectors GROUP BY user_id').all(),
        adb.prepare('SELECT user_id, COUNT(*) AS n, SUM(CASE WHEN status=\'active\' THEN 1 ELSE 0 END) AS active_plans FROM copilot_plans GROUP BY user_id').all(),
        adb.prepare('SELECT user_id, COUNT(*) AS n, SUM(CASE WHEN undone IS TRUE THEN 1 ELSE 0 END) AS undone_n FROM agent_audit GROUP BY user_id').all(),
      ]);
      const factMap = {}; for (const r of factCounts) factMap[r.user_id] = r;
      const vecMap = {}; for (const r of vecCounts) vecMap[r.user_id] = r;
      const planMap = {}; for (const r of planCounts) planMap[r.user_id] = r;
      const actMap = {}; for (const r of actCounts) actMap[r.user_id] = r;

      // Batch 3: last_act_at + agent_paused
      const lastActMap = {};
      const pausedMap = {};
      const lastActs = await adb.prepare('SELECT user_id, MAX(ts) AS ts FROM agent_audit GROUP BY user_id').all();
      for (const r of lastActs) lastActMap[r.user_id] = r.ts;
      const settings = await adb.prepare('SELECT user_id, agent_paused FROM copilot_settings WHERE agent_paused IS NOT NULL AND agent_paused = TRUE').all();
      for (const r of settings) pausedMap[r.user_id] = r.agent_paused;

      // Last conv timestamp per user
      const lastConvMap = {};
      const lastConvs = await adb.prepare('SELECT user_id, MAX(updated_at) AS ts FROM copilot_conversations GROUP BY user_id').all();
      for (const r of lastConvs) lastConvMap[r.user_id] = r.ts;

      const rows = baseUsers.map(u => ({
        id: u.id,
        username: u.username,
        role: u.role,
        created_at: u.created_at,
        conv_count: convMap[u.id]?.conv_count || 0,
        msg_count: convMap[u.id]?.msg_count || 0,
        fact_count: factMap[u.id]?.n || 0,
        vec_count: vecMap[u.id]?.n || 0,
        plan_count: planMap[u.id]?.n || 0,
        active_plans: planMap[u.id]?.active_plans || 0,
        act_count: actMap[u.id]?.n || 0,
        undone_count: actMap[u.id]?.undone_n || 0,
        last_act_at: lastActMap[u.id] || null,
        last_conv_at: lastConvMap[u.id] || null,
        agent_paused: _boolFromDb(pausedMap[u.id]),
      }));

      rows.sort((a, b) => {
        if (!a.last_act_at && !b.last_act_at) return 0;
        if (!a.last_act_at) return 1;
        if (!b.last_act_at) return -1;
        return String(b.last_act_at).localeCompare(String(a.last_act_at));
      });

      const globalPaused = await isAgentGloballyPausedAsync();
      res.json({status:'ok', users: rows, globalPaused});
    } catch (e) { res.status(500).json({status:'error', error: e.message}); }
  });

  app.get('/api/ai/admin/audit', async (req, res) => {
    if (!_requireAdmin(req, res)) return;
    const userId = req.query.userId;
    const limit = Math.max(1, Math.min(500, parseInt(req.query.limit) || 100));
    try {
      const rows = userId
        ? await adb.prepare('SELECT id, user_id, action, args, ts, undone, undone_at, undo_token FROM agent_audit WHERE user_id=? ORDER BY ts DESC LIMIT ?').all(userId, limit)
        : await adb.prepare('SELECT id, user_id, action, args, ts, undone, undone_at, undo_token FROM agent_audit ORDER BY ts DESC LIMIT ?').all(limit);
      const items = rows.map(r => {
        let argsParsed = null;
        try { argsParsed = JSON.parse(r.args || '{}'); } catch {}
        return {
          id: r.id, user_id: r.user_id, action: r.action, ts: r.ts,
          undone: _boolFromDb(r.undone), undone_at: r.undone_at,
          argsSummary: argsParsed ? Object.keys(argsParsed).slice(0, 6).map(k => k + '=' + String(argsParsed[k]).slice(0, 30)).join(', ') : '',
        };
      });
      res.json({status:'ok', audit: items});
    } catch (e) { res.status(500).json({status:'error', error: e.message}); }
  });

  app.post('/api/ai/admin/pause-user', express.json({limit: '4kb'}), async (req, res) => {
    if (!_requireAdmin(req, res)) return;
    const {userId, paused} = req.body || {};
    if (!userId || typeof paused !== 'boolean') return res.status(400).json({status:'error', error:'需要 userId 和 paused (boolean)'});
    try {
      const now = new Date().toISOString();
      const pausedVal = paused ? 1 : 0;
      await adb.prepare(`INSERT INTO copilot_settings(user_id, agent_paused, updated_at) VALUES (?, ?, ?)
                  ON CONFLICT(user_id) DO UPDATE SET agent_paused=excluded.agent_paused, updated_at=excluded.updated_at`)
        .run(userId, pausedVal, now);
      console.log('[admin] user-pause user=' + userId + ' paused=' + paused + ' by=' + (req.user && req.user.id));
      res.json({status:'ok'});
    } catch (e) { res.status(500).json({status:'error', error: e.message}); }
  });

  app.get('/api/ai/admin/global-pause', async (req, res) => {
    if (!_requireAdmin(req, res)) return;
    try {
      res.json({status:'ok', paused: await isAgentGloballyPausedAsync()});
    } catch (e) { res.status(500).json({status:'error', error: e.message}); }
  });

  app.post('/api/ai/admin/global-pause', express.json({limit: '4kb'}), async (req, res) => {
    if (!_requireAdmin(req, res)) return;
    const {paused} = req.body || {};
    if (typeof paused !== 'boolean') return res.status(400).json({status:'error', error:'需要 paused (boolean)'});
    try {
      await setAgentGlobalPauseAsync(paused, req.user && req.user.id);
      res.json({status:'ok', paused});
    } catch (e) { res.status(500).json({status:'error', error: e.message}); }
  });

  app.get('/api/ai/admin/usage-stats', async (req, res) => {
    if (!_requireAdmin(req, res)) return;
    const days = Math.max(1, Math.min(180, parseInt(req.query.days) || 30));
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    const estimate = globalThis._biof3 && globalThis._biof3.estimateCostCNY;
    const PRICING = (globalThis._biof3 && globalThis._biof3.AI_PRICING) || {};
    if (!estimate) return res.status(500).json({status:'error', error:'helper_missing'});
    try {
      const dayExpr = 'substr(ts, 1, 10)';
      const daily = await adb.prepare(`
        SELECT ${dayExpr} AS day, kind, CAST(COUNT(*) AS INTEGER) AS calls,
               CAST(SUM(prompt_tokens) AS INTEGER) AS prompt_tokens, CAST(SUM(completion_tokens) AS INTEGER) AS completion_tokens,
               CAST(AVG(latency_ms) AS INTEGER) AS avg_latency,
               CAST(SUM(CASE WHEN error_code IS NOT NULL THEN 1 ELSE 0 END) AS INTEGER) AS errors
        FROM ai_usage WHERE ts >= ? GROUP BY ${dayExpr}, kind ORDER BY day DESC, kind
      `).all(cutoff);
      const usageByUser = await adb.prepare(`
        SELECT user_id, CAST(COUNT(*) AS INTEGER) AS calls,
               CAST(SUM(prompt_tokens) AS INTEGER) AS prompt_tokens, CAST(SUM(completion_tokens) AS INTEGER) AS completion_tokens,
               CAST(AVG(latency_ms) AS INTEGER) AS avg_latency,
               CAST(SUM(CASE WHEN error_code IS NOT NULL THEN 1 ELSE 0 END) AS INTEGER) AS errors
        FROM ai_usage WHERE ts >= ? AND user_id IS NOT NULL
        GROUP BY user_id ORDER BY (SUM(prompt_tokens) + SUM(completion_tokens)) DESC
      `).all(cutoff);
      const nameRows = await adb.prepare('SELECT id, username FROM users').all();
      const nameMap = Object.fromEntries(nameRows.map((u) => [u.id, u.username]));
      const perUser = usageByUser.map((d) => ({
        id: d.user_id,
        username: nameMap[d.user_id] || d.user_id,
        calls: d.calls,
        prompt_tokens: d.prompt_tokens,
        completion_tokens: d.completion_tokens,
        avg_latency: d.avg_latency,
        errors: d.errors,
      }));
      const dailyWithCost = daily.map(d => ({
        ...d,
        estimated_cost_cny: estimate((d.kind === 'embedding') ? 'text-embedding-v3' : 'deepseek-chat', d.prompt_tokens, d.completion_tokens),
      }));
      const perUserWithCost = perUser.map(d => ({...d, estimated_cost_cny: estimate('deepseek-chat', d.prompt_tokens, d.completion_tokens)}));
      const errorsBreakdown = await adb.prepare(`SELECT error_code, COUNT(*) AS n FROM ai_usage WHERE ts >= ? AND error_code IS NOT NULL GROUP BY error_code ORDER BY n DESC`).all(cutoff);
      const undoneCase = 'CAST(SUM(CASE WHEN undone=1 THEN 1 ELSE 0 END) AS INTEGER)';
      const topActs = await adb.prepare(`SELECT action, CAST(COUNT(*) AS INTEGER) AS n, ${undoneCase} AS undone FROM agent_audit WHERE ts >= ? GROUP BY action ORDER BY n DESC LIMIT 20`).all(cutoff);
      res.json({status:'ok', days, pricing: PRICING, daily: dailyWithCost, perUser: perUserWithCost, errors: errorsBreakdown, topActs});
    } catch (e) { res.status(500).json({status:'error', error: e.message}); }
  });

  // Aggregate per-user memory stats (kept by Phase 5 docs)
  app.get('/api/ai/admin/memory-stats', async (req, res) => {
    if (!_requireAdmin(req, res)) return;
    try {
      // OPT_ADMIN_MEMSTATS_v1: 4 batch queries instead of users × 4 sequential.
      const baseUsers = await adb.prepare('SELECT id, username FROM users').all();
      if (baseUsers.length === 0) return res.json({status: 'ok', users: []});

      const [factCounts, vecCounts, chatCounts] = await Promise.all([
        adb.prepare('SELECT user_id, COUNT(*) AS n FROM user_facts GROUP BY user_id').all(),
        adb.prepare('SELECT user_id, COUNT(*) AS n FROM memory_vectors GROUP BY user_id').all(),
        adb.prepare('SELECT user_id, COUNT(*) AS n, MAX(ts) AS last_active FROM chat_audit GROUP BY user_id').all(),
      ]);

      const factMap = {}; for (const r of factCounts) factMap[r.user_id] = r.n;
      const vecMap = {}; for (const r of vecCounts) vecMap[r.user_id] = r.n;
      const chatMap = {}; for (const r of chatCounts) { chatMap[r.user_id] = {n: r.n, last: r.last_active}; }

      const hasSummaryUsers = new Set(
        (await adb.prepare('SELECT user_id FROM chat_summaries').all()).map(r => r.user_id)
      );

      const users = baseUsers.map(u => ({
        id: u.id,
        username: u.username,
        facts: factMap[u.id] || 0,
        has_summary: hasSummaryUsers.has(u.id) || false,
        vectors: vecMap[u.id] || 0,
        chat_calls: chatMap[u.id]?.n || 0,
        last_active: chatMap[u.id]?.last || null,
      }));

      users.sort((a, b) => (b.chat_calls || 0) - (a.chat_calls || 0));
      res.json({status: 'ok', users});
    } catch (e) { res.status(500).json({status: 'error', error: e.message}); }
  });
};
