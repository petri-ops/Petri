'use strict';

/**
 * routes/lesson-evidence.js — EVO-4 bugfix：harness 自进化证据只读 REST 端点。
 * 后端进程用 ABI 正确的 better-sqlite3 直读 petri.db（Electron 主进程 ABI 不匹配，故不直开库）。
 * 只读（GET）、零外发、零写入；与 data:lesson-evidence IPC 通道一一对应。
 */
module.exports = function registerLessonEvidenceRoutes(app) {
  const db = require('../db').getDatabase();

  app.get('/api/harness/lesson-evidence', (_req, res) => {
    try {
      const lessons = db.prepare(
        `SELECT id, source_fingerprint, title, scope, status, confidence,
                occurrences_before, occurrences_after, created_at, last_seen_at
         FROM lessons ORDER BY last_seen_at DESC LIMIT 200`
      ).all();
      const incidentTrend = db.prepare(
        `SELECT date(created_at) AS day, COUNT(*) AS count
         FROM incidents GROUP BY day ORDER BY day ASC`
      ).all();
      res.json({ ok: true, lessons, incidentTrend });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });
};
