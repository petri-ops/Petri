/**
 * User Feedback channel — collects in-product feedback from users (logged in or anonymous)
 * and pings Feishu in realtime so the team sees issues as they happen.
 *
 * Endpoints:
 *   POST /api/feedback         (public — anonymous OK)  → submit feedback
 *   GET  /api/feedback/admin   (admin only)             → list with filters
 *   PUT  /api/feedback/admin/:id (admin only)           → update status / notes
 */

const express = require('express');
const dbMod = require('../db');
const notify = require('../notify-feishu');
const ipGeo = require('../helpers/ip-geo');
// Keep request-path feedback operations on the async database adapter.
const _dbSync = dbMod.getDatabase(); // for CREATE TABLE (runs once at startup)
const dbAsync = dbMod.getAsyncDatabase();

// ---- Schema ----
_dbSync.exec(`
  CREATE TABLE IF NOT EXISTS feedbacks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,                 -- nullable: anonymous feedback allowed
    username TEXT,                -- denormalized snapshot at submit time
    category TEXT DEFAULT 'other', -- bug | suggestion | content | other
    content TEXT NOT NULL,
    page_url TEXT,
    user_agent TEXT,
    ip TEXT,
    status TEXT DEFAULT 'new',    -- new | in_progress | resolved | dismissed
    admin_notes TEXT,
    created_at INTEGER NOT NULL,
    resolved_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_feedbacks_status ON feedbacks(status);
  CREATE INDEX IF NOT EXISTS idx_feedbacks_created ON feedbacks(created_at);
  CREATE INDEX IF NOT EXISTS idx_feedbacks_user ON feedbacks(user_id);
`);

// ---- Rate limit (per-IP, in-memory) ----
const _rateMap = new Map(); // ip -> [t1, t2, ...]
const _RATE_LIMIT = 5;       // max 5 submissions per minute per IP
const _RATE_WINDOW_MS = 60_000;

function _checkRate(ip) {
  if (!ip) return true;
  const now = Date.now();
  const arr = (_rateMap.get(ip) || []).filter(t => now - t < _RATE_WINDOW_MS);
  if (arr.length >= _RATE_LIMIT) {
    _rateMap.set(ip, arr);
    return false;
  }
  arr.push(now);
  _rateMap.set(ip, arr);
  return true;
}

function _clientIp(req) {
  return (req.headers['x-forwarded-for'] || req.ip || req.socket?.remoteAddress || '').split(',')[0].trim();
}

function _userIdFromReq(req) {
  return req.user && (req.user.id || req.user.userId) || null;
}

function _isAdmin(req) {
  return req.user && req.user.role === 'admin';
}

module.exports = function registerFeedback(app) {
  // ---- Public: submit feedback (anonymous allowed) ----
  // Use the async adapter so inserts do not block concurrent requests.
  app.post('/api/feedback', express.json({limit: '32kb'}), async (req, res) => {
    const ip = _clientIp(req);
    if (!_checkRate(ip)) {
      return res.status(429).json({status: 'error', error: '提交过于频繁，请稍后再试（1 分钟 5 条上限）'});
    }

    const {content, category, pageUrl} = req.body || {};
    if (!content || typeof content !== 'string') {
      return res.status(400).json({status: 'error', error: '请填写反馈内容'});
    }
    const trimmed = content.trim();
    if (trimmed.length < 5) {
      return res.status(400).json({status: 'error', error: '反馈内容太短（至少 5 个字）'});
    }
    if (trimmed.length > 4000) {
      return res.status(400).json({status: 'error', error: '反馈内容过长（最多 4000 字）'});
    }

    const validCategories = ['bug', 'suggestion', 'content', 'other'];
    const cat = validCategories.includes(category) ? category : 'other';

    const userId = _userIdFromReq(req);
    let username = null;
    if (userId) {
      try {
        const u = _dbSync.prepare('SELECT username FROM users WHERE id=?').get(userId);
        username = u && u.username;
      } catch {}
    }

    const userAgent = String(req.headers['user-agent'] || '').slice(0, 500);
    const url = String(pageUrl || req.headers['referer'] || '').slice(0, 500);

    // Insert through the async adapter used by request-path feedback operations.
    let feedbackId = null;
    try {
      const insertResult = await dbAsync.prepare(
        'INSERT INTO feedbacks (user_id, username, category, content, page_url, user_agent, ip, created_at) VALUES (?,?,?,?,?,?,?,?) RETURNING id'
      ).run(userId, username, cat, trimmed, url, userAgent, ip, Date.now());
      feedbackId = insertResult && insertResult.rows && insertResult.rows[0] && insertResult.rows[0].id;
    } catch (e) {
      console.error('[feedback] insert failed:', e.message);
      return res.status(500).json({status: 'error', error: '提交失败，请稍后再试'});
    }

    // Realtime Feishu notification (best-effort; never blocks the response)
    try {
      const categoryLabel = {bug: '🐛 Bug', suggestion: '💡 建议', content: '📝 内容', other: '💬 其他'}[cat] || cat;
      const userLabel = username ? `**${username}**` : '*<匿名访客>*';
      const preview = trimmed.length > 280 ? trimmed.slice(0, 280) + '...' : trimmed;
      notify.custom({
        title: `${categoryLabel} 用户反馈 #${feedbackId}`,
        template: cat === 'bug' ? 'orange' : 'blue',
        // No dedupe — every feedback should be seen
        lines: [
          `${userLabel} · 来自 \`${url || '<未提供>'}\``,
          '',
          preview,
        ],
        button: {
          label: '管理后台',
          type: 'primary',
          url: (process.env.BIOF3_SITE_URL || 'https://biof3.com') + '/admin#feedbacks',
        },
      });
    } catch (e) {
      console.warn('[feedback] notify failed:', e.message);
    }

    res.json({status: 'ok', id: feedbackId});
  });

  // ---- Admin: list feedbacks with filters ----
  // Async SQLite facade keeps concurrent requests from blocking the event loop.
  app.get('/api/feedback/admin', async (req, res) => {
    if (!_isAdmin(req)) return res.status(403).json({status: 'error', error: 'admin_only'});
    const status = req.query.status || '';
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
    let sql = 'SELECT * FROM feedbacks';
    const args = [];
    if (status) { sql += ' WHERE status = ?'; args.push(status); }
    sql += ' ORDER BY created_at DESC LIMIT ?';
    args.push(limit);
    let rows;
    try {
      rows = await dbAsync.prepare(sql).all(...args);
    } catch (e) {
      console.error('[feedback/admin] list failed:', e.message);
      return res.status(500).json({status: 'error', error: '查询失败'});
    }
    // Enrich each feedback with IP geolocation. Best-effort — ip-geo caches 7d.
    try {
      rows = await ipGeo.attachGeoToRows(rows, 'ip');
    } catch (e) {
      console.warn('[feedback] geo enrich failed:', e.message);
    }
    let counts = {};
    try {
      const countRows = await dbAsync.prepare(
        'SELECT status, COUNT(*) AS n FROM feedbacks GROUP BY status'
      ).all();
      counts = countRows.reduce((acc, r) => { acc[r.status] = r.n; return acc; }, {});
    } catch (e) {
      console.warn('[feedback] counts query failed:', e.message);
    }
    res.json({status: 'ok', items: rows, counts});
  });

  // ---- Admin: update status / notes ----
  app.put('/api/feedback/admin/:id', express.json({limit: '8kb'}), async (req, res) => {
    if (!_isAdmin(req)) return res.status(403).json({status: 'error', error: 'admin_only'});
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({status: 'error', error: 'bad_id'});
    const {status, adminNotes} = req.body || {};
    const validStatuses = ['new', 'in_progress', 'resolved', 'dismissed'];
    const fields = [];
    const args = [];
    if (status && validStatuses.includes(status)) {
      fields.push('status = ?');
      args.push(status);
      if (status === 'resolved' || status === 'dismissed') {
        fields.push('resolved_at = ?');
        args.push(Date.now());
      }
    }
    if (typeof adminNotes === 'string') {
      fields.push('admin_notes = ?');
      args.push(adminNotes.slice(0, 2000));
    }
    if (!fields.length) return res.status(400).json({status: 'error', error: 'nothing_to_update'});
    args.push(id);
    let r;
    try {
      r = await dbAsync.prepare(`UPDATE feedbacks SET ${fields.join(', ')} WHERE id = ?`).run(...args);
    } catch (e) {
      console.error('[feedback/admin] update failed:', e.message);
      return res.status(500).json({status: 'error', error: '更新失败'});
    }
    if (r.changes === 0) return res.status(404).json({status: 'error', error: 'not_found'});
    res.json({status: 'ok'});
  });
};
