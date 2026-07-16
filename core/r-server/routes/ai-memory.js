/**
 * routes/ai-memory.js — facts / summary / memories / vectors / wipe.
 * Migrated from server.js as part of MODULES_BATCH1_v1.
 *
 * 2026-06-08: converted to ASYNC DB access (getAsyncDbForLegacyModules). The
 * old sync shim used deasync.loopWhile which is NOT reentrant — concurrent
 * Copilot/admin reads crashed V8 ("Empty MaybeLocal") and took down the
 * platform. Async path = no deasync. Works in both PG (shim→async) and
 * SQLite (Dell) modes.
 */
const express = require('express');
const dbMod = require('../db');
const adb = dbMod.getAsyncDbForLegacyModules();

module.exports = function mountMemory(app) {

  // -------- facts (Layer 3a) --------
  app.get('/api/ai/facts', async (req, res) => {
    const userId = req.user && req.user.id;
    if (!userId) return res.status(401).json({status:'error', error:'未授权'});
    try {
      const rows = await adb.prepare('SELECT id, category, content, pinned, source, created_at, updated_at FROM user_facts WHERE user_id=? ORDER BY pinned DESC, updated_at DESC').all(userId);
      res.json({status:'ok', facts: rows.map(r => ({...r, pinned: !!r.pinned}))});
    } catch (e) { res.status(500).json({status:'error', error: e.message}); }
  });

  app.post('/api/ai/facts', express.json({limit: '8kb'}), async (req, res) => {
    const userId = req.user && req.user.id;
    if (!userId) return res.status(401).json({status:'error', error:'未授权'});
    try {
      const {v4: uuidv4} = require('uuid');
      const {category, content, pinned, source} = req.body || {};
      const allowedCats = ['research_focus', 'preference', 'entity', 'task_state', 'note'];
      if (!allowedCats.includes(category)) return res.status(400).json({status:'error', error:'invalid_category'});
      if (!content || typeof content !== 'string') return res.status(400).json({status:'error', error:'missing_content'});
      const id = 'fact_' + uuidv4().slice(0, 12);
      const now = new Date().toISOString();
      await adb.prepare('INSERT INTO user_facts(id, user_id, category, content, pinned, source, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)')
        .run(id, userId, category, content.slice(0, 1000), pinned ? 1 : 0, source || 'manual', now, now);
      const fact = await adb.prepare('SELECT id, category, content, pinned, source, created_at, updated_at FROM user_facts WHERE id=?').get(id);
      res.json({status:'ok', fact: {...fact, pinned: !!fact.pinned}});
    } catch (e) { res.status(500).json({status:'error', error: e.message}); }
  });

  app.put('/api/ai/facts/:id', express.json({limit: '8kb'}), async (req, res) => {
    const userId = req.user && req.user.id;
    if (!userId) return res.status(401).json({status:'error', error:'未授权'});
    try {
      const row = await adb.prepare('SELECT id FROM user_facts WHERE id=? AND user_id=?').get(req.params.id, userId);
      if (!row) return res.status(404).json({status:'error', error:'not_found'});
      const {content, pinned, category} = req.body || {};
      const sets = []; const values = [];
      if (typeof content === 'string') { sets.push('content=?'); values.push(content.slice(0, 1000)); }
      if (typeof pinned === 'boolean') { sets.push('pinned=?'); values.push(pinned ? 1 : 0); }
      if (typeof category === 'string') { sets.push('category=?'); values.push(category); }
      if (sets.length === 0) return res.status(400).json({status:'error', error:'no_updates'});
      sets.push('updated_at=?'); values.push(new Date().toISOString());
      values.push(req.params.id, userId);
      await adb.prepare(`UPDATE user_facts SET ${sets.join(', ')} WHERE id=? AND user_id=?`).run(...values);
      const fact = await adb.prepare('SELECT id, category, content, pinned, source, created_at, updated_at FROM user_facts WHERE id=?').get(req.params.id);
      res.json({status:'ok', fact: {...fact, pinned: !!fact.pinned}});
    } catch (e) { res.status(500).json({status:'error', error: e.message}); }
  });

  app.delete('/api/ai/facts/:id', async (req, res) => {
    const userId = req.user && req.user.id;
    if (!userId) return res.status(401).json({status:'error', error:'未授权'});
    try {
      const r = await adb.prepare('DELETE FROM user_facts WHERE id=? AND user_id=?').run(req.params.id, userId);
      if (r.changes === 0) return res.status(404).json({status:'error', error:'not_found'});
      res.json({status:'ok'});
    } catch (e) { res.status(500).json({status:'error', error: e.message}); }
  });

  app.delete('/api/ai/facts', async (req, res) => {
    const userId = req.user && req.user.id;
    if (!userId) return res.status(401).json({status:'error', error:'未授权'});
    try {
      await adb.prepare('DELETE FROM user_facts WHERE user_id=?').run(userId);
      res.json({status:'ok'});
    } catch (e) { res.status(500).json({status:'error', error: e.message}); }
  });

  // -------- summary (Layer 2) --------
  app.get('/api/ai/summary', async (req, res) => {
    const userId = req.user && req.user.id;
    if (!userId) return res.status(401).json({status:'error', error:'未授权'});
    try {
      const row = await adb.prepare('SELECT summary, msg_count, updated_at FROM chat_summaries WHERE user_id=?').get(userId);
      res.json({status:'ok', summary: row ? row.summary : null, msgCount: row ? row.msg_count : 0, updatedAt: row ? row.updated_at : null});
    } catch (e) { res.status(500).json({status:'error', error: e.message}); }
  });

  app.delete('/api/ai/summary', async (req, res) => {
    const userId = req.user && req.user.id;
    if (!userId) return res.status(401).json({status:'error', error:'未授权'});
    try {
      await adb.prepare('DELETE FROM chat_summaries WHERE user_id=?').run(userId);
      res.json({status:'ok'});
    } catch (e) { res.status(500).json({status:'error', error: e.message}); }
  });

  // -------- memories (Layer 3b vector store) --------
  app.get('/api/ai/memories', async (req, res) => {
    const userId = req.user && req.user.id;
    if (!userId) return res.status(401).json({status:'error', error:'未授权'});
    try {
      const totalRow = await adb.prepare('SELECT COUNT(*) AS c FROM memory_vectors WHERE user_id=?').get(userId);
      const rows = await adb.prepare('SELECT id, kind, page, page_title, content, ts, ref_id FROM memory_vectors WHERE user_id=? ORDER BY ts DESC LIMIT 50').all(userId);
      res.json({status:'ok', memories: rows, total: totalRow.c});
    } catch (e) { res.status(500).json({status:'error', error: e.message}); }
  });

  app.post('/api/ai/memories/search', express.json({limit: '8kb'}), async (req, res) => {
    const userId = req.user && req.user.id;
    if (!userId) return res.status(401).json({status:'error', error:'未授权'});
    try {
      const q = String((req.body && req.body.q) || '').trim();
      if (q.length < 3) return res.status(400).json({status:'error', error:'query_too_short'});
      const dashscopeEmbed = globalThis._biof3 && globalThis._biof3.dashscopeEmbed;
      const cosineSim = globalThis._biof3 && globalThis._biof3.cosineSim;
      if (!dashscopeEmbed || !cosineSim) return res.status(500).json({status:'error', error:'helpers_missing'});
      const vecs = await dashscopeEmbed([q], {userId});
      if (!vecs || !vecs[0]) return res.json({status:'ok', hits: []});
      const queryVec = vecs[0];
      const rows = await adb.prepare('SELECT id, kind, page, page_title, content, embedding, ts, ref_id FROM memory_vectors WHERE user_id=? ORDER BY ts DESC LIMIT 1000').all(userId);
      const hits = [];
      for (const r of rows) {
        const v = new Float32Array(r.embedding.buffer, r.embedding.byteOffset, r.embedding.byteLength / 4);
        const sim = cosineSim(queryVec, v);
        hits.push({id: r.id, kind: r.kind, page: r.page, page_title: r.page_title, content: r.content, ts: r.ts, ref_id: r.ref_id, sim});
      }
      hits.sort((a, b) => b.sim - a.sim);
      res.json({status:'ok', hits: hits.slice(0, 30)});
    } catch (e) { res.status(500).json({status:'error', error: e.message}); }
  });

  app.delete('/api/ai/memories/:id', async (req, res) => {
    const userId = req.user && req.user.id;
    if (!userId) return res.status(401).json({status:'error', error:'未授权'});
    try {
      const r = await adb.prepare('DELETE FROM memory_vectors WHERE id=? AND user_id=?').run(req.params.id, userId);
      if (r.changes === 0) return res.status(404).json({status:'error', error:'not_found'});
      res.json({status:'ok'});
    } catch (e) { res.status(500).json({status:'error', error: e.message}); }
  });

  app.delete('/api/ai/memories', async (req, res) => {
    const userId = req.user && req.user.id;
    if (!userId) return res.status(401).json({status:'error', error:'未授权'});
    try {
      await adb.prepare('DELETE FROM memory_vectors WHERE user_id=?').run(userId);
      res.json({status:'ok'});
    } catch (e) { res.status(500).json({status:'error', error: e.message}); }
  });

  // -------- aggregate stats + wipe --------
  app.get('/api/ai/memory-stats', async (req, res) => {
    const userId = req.user && req.user.id;
    if (!userId) return res.status(401).json({status:'error', error:'未授权'});
    try {
      const factsRow = await adb.prepare('SELECT COUNT(*) AS c FROM user_facts WHERE user_id=?').get(userId);
      const hasSummary = (await adb.prepare('SELECT 1 AS x FROM chat_summaries WHERE user_id=?').get(userId)) ? true : false;
      const vectorsRow = await adb.prepare('SELECT COUNT(*) AS c FROM memory_vectors WHERE user_id=?').get(userId);
      res.json({status:'ok', facts: factsRow.c, hasSummary, vectors: vectorsRow.c});
    } catch (e) { res.status(500).json({status:'error', error: e.message}); }
  });

  app.post('/api/ai/memory-wipe', async (req, res) => {
    const userId = req.user && req.user.id;
    if (!userId) return res.status(401).json({status:'error', error:'未授权'});
    let removed = 0;
    try { removed += (await adb.prepare('DELETE FROM user_facts WHERE user_id=?').run(userId)).changes; } catch {}
    try { removed += (await adb.prepare('DELETE FROM chat_summaries WHERE user_id=?').run(userId)).changes; } catch {}
    try { removed += (await adb.prepare('DELETE FROM memory_vectors WHERE user_id=?').run(userId)).changes; } catch {}
    res.json({status:'ok', removed});
  });
};
