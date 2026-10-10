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

function setupAuthRoutes(app, db) {
  const lookupById = db.getUserByIdAsync
    ? (id) => db.getUserByIdAsync(id)
    : (id) => Promise.resolve(db.getUserById(id));

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
