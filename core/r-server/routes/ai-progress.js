/* USER_PROGRESS_v1 */
/**
 * routes/ai-progress.js — Phase α user_progress tracking.
 *
 * Endpoints:
 *   POST /api/ai/progress         { event: 'started'|'completed', resource: '/docs/...' }
 *   GET  /api/ai/progress/mine    → {progress: [...]}
 *   GET  /api/ai/progress/summary → {byDomain: {...}, total, recent: [...]}
 *
 * Resource id format must be one of:
 *   /docs/...    (docs path, no .md)
 *   /figcode#id  (figcode card)
 *   act://id     (registered Copilot act)
 * Anything else is rejected (400).
 *
 * Status finite-state: started → completed (later events idempotent).
 *
 * 2026-06-09: async DB (getAsyncDbForLegacyModules) — no deasync on ECS platform.
 */
const express = require('express');
const dbMod = require('../db');

const ALLOWED_EVENTS = new Set(['started', 'completed']);

function _isValidResource(s) {
  if (typeof s !== 'string' || s.length === 0 || s.length > 200) return false;
  return s.startsWith('/docs/') || s.startsWith('/figcode#') || s.startsWith('act://');
}

function _resourceType(s) {
  if (s.startsWith('/docs/')) return 'doc';
  if (s.startsWith('/figcode#')) return 'figcode';
  if (s.startsWith('act://')) return 'act';
  return 'unknown';
}

async function _ensureTable(adb) {
  try {
    await adb.exec(`
      CREATE TABLE IF NOT EXISTS user_progress (
        user_id     TEXT NOT NULL,
        resource    TEXT NOT NULL,
        type        TEXT NOT NULL,
        status      TEXT NOT NULL,
        started_at  TEXT,
        completed_at TEXT,
        updated_at  TEXT NOT NULL,
        PRIMARY KEY (user_id, resource)
      );
      CREATE INDEX IF NOT EXISTS idx_user_progress_user_updated
        ON user_progress(user_id, updated_at DESC);
    `);
  } catch {
    /* ignore */
  }
}

module.exports = async function mountProgress(app) {
  const adb = dbMod.getAsyncDbForLegacyModules();
  await _ensureTable(adb);

  // -------- POST /api/ai/progress --------
  app.post('/api/ai/progress', express.json({ limit: '4kb' }), async (req, res) => {
    const userId = req.user && req.user.id;
    if (!userId) return res.status(401).json({ status: 'error', error: '未授权' });

    const { event, resource } = req.body || {};
    if (!ALLOWED_EVENTS.has(event)) {
      return res.status(400).json({ status: 'error', error: 'invalid_event' });
    }
    if (!_isValidResource(resource)) {
      return res.status(400).json({ status: 'error', error: 'invalid_resource' });
    }

    const now = new Date().toISOString();
    const type = _resourceType(resource);
    const existing = await adb
      .prepare('SELECT * FROM user_progress WHERE user_id = $1 AND resource = $2')
      .get(userId, resource);

    if (!existing) {
      const startedAt = event === 'started' ? now : null;
      const completedAt = event === 'completed' ? now : null;
      await adb
        .prepare(
          `INSERT INTO user_progress
          (user_id, resource, type, status, started_at, completed_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7)`
        )
        .run(userId, resource, type, event, startedAt, completedAt, now);
    } else {
      let nextStatus = existing.status;
      if (existing.status !== 'completed' && event === 'completed') nextStatus = 'completed';
      else if (existing.status === 'started' && event === 'started') nextStatus = 'started';
      else if (!existing.status) nextStatus = event;
      const startedAt = existing.started_at || (event === 'started' ? now : null);
      const completedAt = existing.completed_at || (event === 'completed' ? now : null);
      await adb
        .prepare(
          `UPDATE user_progress
        SET status=$1, started_at=$2, completed_at=$3, updated_at=$4
        WHERE user_id=$5 AND resource=$6`
        )
        .run(nextStatus, startedAt, completedAt, now, userId, resource);
    }

    const row = await adb
      .prepare('SELECT * FROM user_progress WHERE user_id = $1 AND resource = $2')
      .get(userId, resource);
    res.json({ status: 'ok', progress: row });
  });

  // -------- GET /api/ai/progress/mine --------
  app.get('/api/ai/progress/mine', async (req, res) => {
    const userId = req.user && req.user.id;
    if (!userId) return res.status(401).json({ status: 'error', error: '未授权' });

    const limit = Math.max(1, Math.min(500, parseInt(req.query.limit, 10) || 200));
    const rows = await adb
      .prepare(
        `
      SELECT resource, type, status, started_at, completed_at, updated_at
      FROM user_progress WHERE user_id = $1
      ORDER BY updated_at DESC LIMIT $2
    `
      )
      .all(userId, limit);
    res.json({ status: 'ok', progress: rows || [] });
  });

  // -------- GET /api/ai/progress/summary --------
  app.get('/api/ai/progress/summary', async (req, res) => {
    const userId = req.user && req.user.id;
    if (!userId) return res.status(401).json({ status: 'error', error: '未授权' });

    const totalRow = await adb
      .prepare('SELECT COUNT(*) AS n FROM user_progress WHERE user_id = $1')
      .get(userId);
    const completedRow = await adb
      .prepare('SELECT COUNT(*) AS n FROM user_progress WHERE user_id = $1 AND status = $2')
      .get(userId, 'completed');
    const byType = await adb
      .prepare(
        `
      SELECT type, status, COUNT(*) AS n FROM user_progress
      WHERE user_id = $1 GROUP BY type, status
    `
      )
      .all(userId);
    const recent = await adb
      .prepare(
        `
      SELECT resource, type, status, updated_at FROM user_progress
      WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 10
    `
      )
      .all(userId);
    res.json({
      status: 'ok',
      total: totalRow ? totalRow.n : 0,
      completed: completedRow ? completedRow.n : 0,
      byType: byType || [],
      recent: recent || [],
    });
  });
};
