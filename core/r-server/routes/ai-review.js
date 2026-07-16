/* LEARNING_MEMORY_v1 */
/**
 * routes/ai-review.js — Phase γ review_queue REST.
 *
 * Phase B / ECS platform: DB access via `sqlite`
 * (getSqliteForLegacyModules() → sync PG shim when BIOF3_P2_PG=1).
 */
const _express = require('express');
const dbMod = require('../db');
const adb = dbMod.getAsyncDbForLegacyModules();

module.exports = function mountReview(app) {
  app.get('/api/ai/review-queue/mine', async (req, res) => {
    const userId = req.user && req.user.id;
    if (!userId) return res.status(401).json({ status: 'error', error: '未授权' });
    const includeRetired = String(req.query.includeRetired || '').toLowerCase() === 'true';
    const limit = Math.max(1, Math.min(500, parseInt(req.query.limit, 10) || 200));
    const where = includeRetired ? '' : ' AND retired_at IS NULL';
    try {
      const rows = await adb
        .prepare(
          `
        SELECT resource, concept, signal, note, created_at, updated_at, retired_at
        FROM review_queue WHERE user_id = ? ${where}
        ORDER BY CASE signal WHEN 'weak' THEN 0 WHEN 'moderate' THEN 1 ELSE 2 END,
                 updated_at DESC
        LIMIT ?
      `
        )
        .all(userId, limit);
      res.json({ status: 'ok', items: rows });
    } catch (e) {
      res.status(500).json({ status: 'error', error: e.message });
    }
  });

  app.delete('/api/ai/review-queue/:resource/:concept', async (req, res) => {
    const userId = req.user && req.user.id;
    if (!userId) return res.status(401).json({ status: 'error', error: '未授权' });
    try {
      const r = await adb
        .prepare('DELETE FROM review_queue WHERE user_id=? AND resource=? AND concept=?')
        .run(
          userId,
          decodeURIComponent(req.params.resource),
          decodeURIComponent(req.params.concept)
        );
      res.json({ status: 'ok', deleted: r.changes });
    } catch (e) {
      res.status(500).json({ status: 'error', error: e.message });
    }
  });
};
