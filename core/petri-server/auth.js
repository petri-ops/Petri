/**
 * Desktop local identity.
 *
 * Petri Desktop has no account/login boundary. The backend is bound to loopback
 * and every request runs as the single local administrator.
 */

const LOCAL_USER = Object.freeze({
  id: 'local-user',
  username: 'Local User',
  role: 'admin',
});

function authMiddleware(req, _res, next) {
  req.user = LOCAL_USER;
  next();
}

function setupAuthRoutes(app, _db) {
  // BLOCK-267 — standalone server 传入的 `db` 是 raw better-sqlite3 handle（无助手
  // 方法），此前 `db.getUserByIdAsync` 恒 undefined → /api/auth/me 恒 500（AUDIT-LOG
  // 🟡 存量）。改为直接 require 助手模块（与 bootstrap 其它消费同源），入参保留兼容。
  const dbHelpers = require('./db');
  const lookupById = dbHelpers.getUserByIdAsync
    ? (id) => dbHelpers.getUserByIdAsync(id)
    : (id) => Promise.resolve(dbHelpers.getUserById(id));

  app.get('/api/auth/me', authMiddleware, async (req, res) => {
    try {
      let permissions = null;
      const { effectivePermissions } = require('./helpers/permissions');
      const row = await lookupById(LOCAL_USER.id);
      if (row) permissions = effectivePermissions(row);
      res.json({ status: 'ok', user: { ...LOCAL_USER, permissions } });
    } catch (error) {
      console.error('[auth/me]', error && error.message);
      res.status(500).json({ status: 'error', error: '获取用户信息失败' });
    }
  });
}

module.exports = { authMiddleware, setupAuthRoutes, LOCAL_USER };
