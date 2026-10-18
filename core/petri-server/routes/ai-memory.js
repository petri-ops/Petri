/**
 * routes/ai-memory.js — facts / summary / memories / vectors / wipe.
 * Migrated from server.js as part of MODULES_BATCH1_v1.
 *
 * Uses the Promise facade over desktop SQLite for consistent async handlers.
 */
const express = require('express');
const memoryPolicy = require('../helpers/memory-policy');
const dbMod = require('../db');
const adb = dbMod.getAsyncDatabase();
const sqlite = dbMod.getDatabase();

try { sqlite.exec('ALTER TABLE user_facts ADD COLUMN project_id TEXT'); } catch {}
try { sqlite.exec('ALTER TABLE memory_vectors ADD COLUMN project_id TEXT'); } catch {}
try { sqlite.exec('CREATE INDEX IF NOT EXISTS idx_user_facts_project ON user_facts(user_id, project_id, pinned DESC, updated_at DESC)'); } catch {}
try { sqlite.exec('CREATE INDEX IF NOT EXISTS idx_memvec_project ON memory_vectors(user_id, project_id, ts DESC)'); } catch {}
try {
  sqlite.exec(`
    UPDATE memory_vectors
    SET project_id = (
      SELECT c.project_id FROM copilot_conversations c
      WHERE c.id = memory_vectors.conversation_id
    )
    WHERE project_id IS NULL
      AND conversation_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM copilot_conversations c
        WHERE c.id = memory_vectors.conversation_id
          AND c.project_id IS NOT NULL
      )
  `);
} catch {}
try {
  sqlite.exec(`CREATE TABLE IF NOT EXISTS project_chat_summaries (
    user_id TEXT NOT NULL,
    project_id TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL,
    msg_count INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, project_id)
  )`);
} catch {}

function _projectIdFromReq(req) {
  const raw = (req.query && (req.query.project_id || req.query.projectId))
    || (req.body && (req.body.project_id || req.body.projectId));
  return typeof raw === 'string' && raw.trim() ? raw.trim().slice(0, 120) : null;
}

function _scope(projectId) {
  return projectId
    ? { clause: 'project_id=?', values: [projectId], key: projectId }
    : { clause: "COALESCE(project_id, '')=''", values: [], key: '' };
}

module.exports = function mountMemory(app) {

  // -------- facts (Layer 3a) --------
  app.get('/api/ai/facts', async (req, res) => {
    const userId = req.user && req.user.id;
    if (!userId) return res.status(401).json({status:'error', error:'未授权'});
    try {
      // BLOCK-182 — 惰性衰减顺带触发（读路径顺手扫，同 BLOCK-180 TTL 模式）。
      try { require('../helpers/memory-lifecycle').lazyDecayFacts(sqlite, userId); } catch { /* 衰减失败不阻塞 */ }
      const projectId = _projectIdFromReq(req);
      const scope = _scope(projectId);
      const rows = await adb.prepare(`SELECT id, category, content, pinned, source, project_id, status, superseded_by, created_at, updated_at FROM user_facts WHERE user_id=? AND ${scope.clause} ORDER BY pinned DESC, updated_at DESC`).all(userId, ...scope.values);
      res.json({status:'ok', facts: rows.map(r => ({...r, pinned: !!r.pinned}))});
    } catch (e) { res.status(500).json({status:'error', error: e.message}); }
  });

  app.post('/api/ai/facts', express.json({limit: '8kb'}), async (req, res) => {
    const userId = req.user && req.user.id;
    if (!userId) return res.status(401).json({status:'error', error:'未授权'});
    try {
      const {v4: uuidv4} = require('uuid');
      const {category, content, pinned, source} = req.body || {};
      const projectId = _projectIdFromReq(req);
      const allowedCats = ['research_focus', 'preference', 'entity', 'task_state', 'note'];
      if (!allowedCats.includes(category)) return res.status(400).json({status:'error', error:'invalid_category'});
      if (!content || typeof content !== 'string') return res.status(400).json({status:'error', error:'missing_content'});
      const id = 'fact_' + uuidv4().slice(0, 12);
      const now = new Date().toISOString();
      await adb.prepare('INSERT INTO user_facts(id, user_id, category, content, pinned, source, project_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
        .run(id, userId, category, content.slice(0, 1000), pinned ? 1 : 0, source || 'manual', projectId, now, now);
      const fact = await adb.prepare('SELECT id, category, content, pinned, source, project_id, created_at, updated_at FROM user_facts WHERE id=?').get(id);
      res.json({status:'ok', fact: {...fact, pinned: !!fact.pinned}});
    } catch (e) { res.status(500).json({status:'error', error: e.message}); }
  });

  app.put('/api/ai/facts/:id', express.json({limit: '8kb'}), async (req, res) => {
    const userId = req.user && req.user.id;
    if (!userId) return res.status(401).json({status:'error', error:'未授权'});
    try {
      const lifecycle = require('../helpers/memory-lifecycle');
      const projectId = _projectIdFromReq(req);
      const scope = _scope(projectId);
      const row = await adb.prepare(`SELECT * FROM user_facts WHERE id=? AND user_id=? AND ${scope.clause}`).get(req.params.id, userId, ...scope.values);
      if (!row) return res.status(404).json({status:'error', error:'not_found'});
      const {content, pinned, category} = req.body || {};
      // BLOCK-182 纠错流（免费直生效）：内容变化=旧事实 superseded 替代链+修正行插入，
      // 不原地覆盖丢历史；pin/category 微调维持原地更新。
      if (typeof content === 'string' && String(row.content || '').trim() !== content.trim()) {
        if (!content.trim()) return res.status(400).json({status:'error', error:'missing_content'});
        const finalCategory = typeof category === 'string' ? category : row.category;
        const newId = lifecycle.supersedeWithCorrection(sqlite, {
          userId, oldFactId: row.id, category: finalCategory, content: content.slice(0, 1000), projectId: row.project_id,
        });
        if (typeof pinned === 'boolean' && pinned) {
          await adb.prepare('UPDATE user_facts SET pinned=1 WHERE id=?').run(newId);
        }
        const fact = await adb.prepare('SELECT id, category, content, pinned, source, project_id, status, superseded_by, created_at, updated_at FROM user_facts WHERE id=?').get(newId);
        return res.json({status:'ok', fact: {...fact, pinned: !!fact.pinned, correctedFrom: row.id}});
      }
      const sets = []; const values = [];
      if (typeof pinned === 'boolean') { sets.push('pinned=?'); values.push(pinned ? 1 : 0); }
      if (typeof category === 'string') { sets.push('category=?'); values.push(category); }
      if (sets.length === 0) return res.status(400).json({status:'error', error:'no_updates'});
      sets.push('updated_at=?'); values.push(new Date().toISOString());
      values.push(req.params.id, userId, ...scope.values);
      await adb.prepare(`UPDATE user_facts SET ${sets.join(', ')} WHERE id=? AND user_id=? AND ${scope.clause}`).run(...values);
      const fact = await adb.prepare('SELECT id, category, content, pinned, source, project_id, status, superseded_by, created_at, updated_at FROM user_facts WHERE id=?').get(req.params.id);
      res.json({status:'ok', fact: {...fact, pinned: !!fact.pinned}});
    } catch (e) { res.status(500).json({status:'error', error: e.message}); }
  });

  app.delete('/api/ai/facts/:id', async (req, res) => {
    const userId = req.user && req.user.id;
    if (!userId) return res.status(401).json({status:'error', error:'未授权'});
    try {
      const scope = _scope(_projectIdFromReq(req));
      const r = await adb.prepare(`DELETE FROM user_facts WHERE id=? AND user_id=? AND ${scope.clause}`).run(req.params.id, userId, ...scope.values);
      if (r.changes === 0) return res.status(404).json({status:'error', error:'not_found'});
      res.json({status:'ok'});
    } catch (e) { res.status(500).json({status:'error', error: e.message}); }
  });

  app.delete('/api/ai/facts', async (req, res) => {
    const userId = req.user && req.user.id;
    if (!userId) return res.status(401).json({status:'error', error:'未授权'});
    try {
      const scope = _scope(_projectIdFromReq(req));
      await adb.prepare(`DELETE FROM user_facts WHERE user_id=? AND ${scope.clause}`).run(userId, ...scope.values);
      res.json({status:'ok'});
    } catch (e) { res.status(500).json({status:'error', error: e.message}); }
  });

  // -------- BLOCK-182 记忆全链审计 --------
  app.get('/api/ai/memory-audit', async (req, res) => {
    const userId = req.user && req.user.id;
    if (!userId) return res.status(401).json({status:'error', error:'未授权'});
    try {
      const lifecycle = require('../helpers/memory-lifecycle');
      lifecycle.ensureLifecycleColumns(sqlite);
      const limit = Math.max(1, Math.min(Number(req.query.limit) || 100, 500));
      res.json({status:'ok', events: lifecycle.listAudit(sqlite, userId, limit)});
    } catch (e) { res.status(500).json({status:'error', error: e.message}); }
  });

  // -------- summary (Layer 2) --------
  app.get('/api/ai/summary', async (req, res) => {
    const userId = req.user && req.user.id;
    if (!userId) return res.status(401).json({status:'error', error:'未授权'});
    try {
      const projectId = _projectIdFromReq(req);
      const row = await adb.prepare('SELECT summary, msg_count, updated_at FROM project_chat_summaries WHERE user_id=? AND project_id=?').get(userId, _scope(projectId).key);
      res.json({status:'ok', summary: row ? row.summary : null, msgCount: row ? row.msg_count : 0, updatedAt: row ? row.updated_at : null});
    } catch (e) { res.status(500).json({status:'error', error: e.message}); }
  });

  app.delete('/api/ai/summary', async (req, res) => {
    const userId = req.user && req.user.id;
    if (!userId) return res.status(401).json({status:'error', error:'未授权'});
    try {
      const projectId = _projectIdFromReq(req);
      await adb.prepare('DELETE FROM project_chat_summaries WHERE user_id=? AND project_id=?').run(userId, _scope(projectId).key);
      res.json({status:'ok'});
    } catch (e) { res.status(500).json({status:'error', error: e.message}); }
  });

  // -------- memories (Layer 3b vector store) --------
  app.get('/api/ai/memories', async (req, res) => {
    const userId = req.user && req.user.id;
    if (!userId) return res.status(401).json({status:'error', error:'未授权'});
    try {
      const scope = _scope(_projectIdFromReq(req));
      const totalRow = await adb.prepare(`SELECT COUNT(*) AS c FROM memory_vectors WHERE user_id=? AND ${scope.clause}`).get(userId, ...scope.values);
      const rows = await adb.prepare(`SELECT id, kind, page, page_title, content, ts, ref_id, project_id FROM memory_vectors WHERE user_id=? AND ${scope.clause} ORDER BY ts DESC LIMIT 50`).all(userId, ...scope.values);
      res.json({status:'ok', memories: rows, total: totalRow.c});
    } catch (e) { res.status(500).json({status:'error', error: e.message}); }
  });

  app.post('/api/ai/memories/search', express.json({limit: '8kb'}), async (req, res) => {
    const userId = req.user && req.user.id;
    if (!userId) return res.status(401).json({status:'error', error:'未授权'});
    try {
      const q = String((req.body && req.body.q) || '').trim();
      if (q.length < 3) return res.status(400).json({status:'error', error:'query_too_short'});
      const dashscopeEmbed = globalThis._petri && globalThis._petri.dashscopeEmbed;
      const cosineSim = globalThis._petri && globalThis._petri.cosineSim;
      if (!dashscopeEmbed || !cosineSim) return res.status(500).json({status:'error', error:'helpers_missing'});
      const vecs = await dashscopeEmbed([q], {userId});
      if (!vecs || !vecs[0]) return res.json({status:'ok', hits: []});
      const queryVec = vecs[0];
      const scope = _scope(_projectIdFromReq(req));
      const rows = await adb.prepare(`SELECT id, kind, page, page_title, content, embedding, ts, ref_id FROM memory_vectors WHERE user_id=? AND ${scope.clause} ORDER BY ts DESC LIMIT 1000`).all(userId, ...scope.values);
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
      const scope = _scope(_projectIdFromReq(req));
      const r = await adb.prepare(`DELETE FROM memory_vectors WHERE id=? AND user_id=? AND ${scope.clause}`).run(req.params.id, userId, ...scope.values);
      if (r.changes === 0) return res.status(404).json({status:'error', error:'not_found'});
      res.json({status:'ok'});
    } catch (e) { res.status(500).json({status:'error', error: e.message}); }
  });

  app.delete('/api/ai/memories', async (req, res) => {
    const userId = req.user && req.user.id;
    if (!userId) return res.status(401).json({status:'error', error:'未授权'});
    try {
      const scope = _scope(_projectIdFromReq(req));
      await adb.prepare(`DELETE FROM memory_vectors WHERE user_id=? AND ${scope.clause}`).run(userId, ...scope.values);
      res.json({status:'ok'});
    } catch (e) { res.status(500).json({status:'error', error: e.message}); }
  });

  // -------- aggregate stats + wipe --------
  app.get('/api/ai/memory-stats', async (req, res) => {
    const userId = req.user && req.user.id;
    if (!userId) return res.status(401).json({status:'error', error:'未授权'});
    try {
      const projectId = _projectIdFromReq(req);
      const scope = _scope(projectId);
      const factsRow = await adb.prepare(`SELECT COUNT(*) AS c FROM user_facts WHERE user_id=? AND ${scope.clause}`).get(userId, ...scope.values);
      const hasSummary = (await adb.prepare('SELECT 1 AS x FROM project_chat_summaries WHERE user_id=? AND project_id=?').get(userId, scope.key)) ? true : false;
      const vectorsRow = await adb.prepare(`SELECT COUNT(*) AS c FROM memory_vectors WHERE user_id=? AND ${scope.clause}`).get(userId, ...scope.values);
      res.json({status:'ok', facts: factsRow.c, hasSummary, vectors: vectorsRow.c});
    } catch (e) { res.status(500).json({status:'error', error: e.message}); }
  });

  app.post('/api/ai/memory-wipe', async (req, res) => {
    const userId = req.user && req.user.id;
    if (!userId) return res.status(401).json({status:'error', error:'未授权'});
    const projectId = _projectIdFromReq(req);
    const scope = _scope(projectId);
    let removed = 0;
    try { removed += (await adb.prepare(`DELETE FROM user_facts WHERE user_id=? AND ${scope.clause}`).run(userId, ...scope.values)).changes; } catch {}
    try { removed += (await adb.prepare('DELETE FROM project_chat_summaries WHERE user_id=? AND project_id=?').run(userId, scope.key)).changes; } catch {}
    try { removed += (await adb.prepare(`DELETE FROM memory_vectors WHERE user_id=? AND ${scope.clause}`).run(userId, ...scope.values)).changes; } catch {}
    res.json({status:'ok', removed});
  });

  // BLOCK-205（W6）— 记忆与压缩策略面（v1 无设置页，API 为唯一写面；漂移门按 NO_UI_FAMILIES 登记）
  app.get('/api/ai/memory-policy', (_req, res) => {
    const snapshot = memoryPolicy.effectiveSnapshot();
    res.json({
      status: 'ok',
      path: snapshot.path,
      values: snapshot.values,
      sources: snapshot.sources,
      defaults: { ...memoryPolicy.DEFAULTS },
      readonlyKeys: ['embeddingModel'],
    });
  });

  app.put('/api/ai/memory-policy', express.json(), (req, res) => {
    const result = memoryPolicy.writeStore(req.body || {});
    if (!result.ok) {
      return res.status(400).json({ status: 'error', error: 'memory_policy_rejected', diagnostics: result.diagnostics });
    }
    const snapshot = memoryPolicy.effectiveSnapshot();
    return res.json({ status: 'ok', values: snapshot.values, sources: snapshot.sources });
  });
};
