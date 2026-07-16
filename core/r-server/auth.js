const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

const config = require('./config');
const IS_LOCAL = config.localMode;

const JWT_SECRET = IS_LOCAL ? 'local-desktop-no-secret-needed' : process.env.JWT_SECRET;
const JWT_EXPIRES = '7d';
const INVITE_CODE = IS_LOCAL ? 'local' : process.env.INVITE_CODE;

// ---- Startup validation: required env vars must be present and reasonably secure.
// Without these, jwt.sign(payload, undefined) silently produces "fake" tokens that
// only this process can verify — a confusing failure mode. Fail loud at boot instead.
// 桌面版（localMode）跳过验证。
(function validateAuthEnv() {
  if (IS_LOCAL) {
    console.log('[auth] local mode — skipping env validation');
    return;
  }
  const errors = [];
  if (!JWT_SECRET) {
    errors.push('JWT_SECRET is missing — set it in /etc/biof3.env');
  } else if (JWT_SECRET.length < 32) {
    errors.push(`JWT_SECRET is too short (${JWT_SECRET.length} chars, need >= 32)`);
  }
  if (!INVITE_CODE) {
    errors.push('INVITE_CODE is missing — set it in /etc/biof3.env');
  }
  if (errors.length) {
    console.error('=========================================================');
    console.error('FATAL: auth env validation failed. Refusing to start.');
    for (const e of errors) console.error('  - ' + e);
    console.error('=========================================================');
    process.exit(1);
  }
})();

// ============================================================
// Auth middleware
// ============================================================

function authMiddleware(req, res, next) {
  // 桌面版（localMode）跳过 JWT 验证，返回固定 admin 用户
  if (IS_LOCAL) {
    req.user = { id: 'local-user', username: 'Local User', role: 'admin' };
    return next();
  }
  // Skip auth for login/register
  if (req.path === '/api/auth/login' || req.path === '/api/auth/register') return next();
  if (req.path === '/api/error-report' || req.path === '/api/pageview') return next();
  // Skip for health check
  if (req.path === '/api/health') return next();
  // Keep backward compat: if X-API-Token is valid, treat as admin
  const apiToken = req.headers['x-api-token'];
  if (apiToken === 'biof3-figcode-2026') {
    req.user = { id: '__admin__', username: 'admin', role: 'admin' };
    return next();
  }
  // JWT auth
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ status: 'error', error: '未登录' });
  }
  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ status: 'error', error: '登录已过期，请重新登录' });
  }
}

// ============================================================
// Auth routes
// ============================================================

function setupAuthRoutes(app, db) {
  const lookupUser = db.getUserByUsernameAsync
    ? (u) => db.getUserByUsernameAsync(u)
    : (u) => Promise.resolve(db.getUserByUsername(u));
  const lookupById = db.getUserByIdAsync
    ? (id) => db.getUserByIdAsync(id)
    : (id) => Promise.resolve(db.getUserById(id));
  const createUserAsync = db.createUserAsync
    ? (p) => db.createUserAsync(p)
    : (p) => Promise.resolve(db.createUser(p));

  // Register
  app.post('/api/auth/register', async (req, res) => {
    const { username, password, inviteCode } = req.body;
    if (!username || !password) {
      return res.status(400).json({ status: 'error', error: '用户名和密码不能为空' });
    }
    if (username.length < 2 || username.length > 20) {
      return res.status(400).json({ status: 'error', error: '用户名 2-20 个字符' });
    }
    if (password.length < 6) {
      return res.status(400).json({ status: 'error', error: '密码至少 6 位' });
    }
    if (inviteCode !== INVITE_CODE) {
      return res.status(403).json({ status: 'error', error: '邀请码无效' });
    }
    try {
      const existing = await lookupUser(username);
      if (existing) {
        return res.status(409).json({ status: 'error', error: '用户名已存在' });
      }
      const passwordHash = bcrypt.hashSync(password, 10);
      const user = await createUserAsync({
        id: 'u_' + uuidv4().slice(0, 8),
        username,
        passwordHash,
        role: 'user',
      });
      const token = jwt.sign(
        { id: user.id, username: user.username, role: user.role },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES }
      );
      res.json({
        status: 'ok',
        user: { id: user.id, username: user.username, role: user.role },
        token,
      });
    } catch (e) {
      console.error('[auth/register]', e && e.message);
      res.status(500).json({ status: 'error', error: '注册失败' });
    }
  });

  // Login
  app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ status: 'error', error: '用户名和密码不能为空' });
    }
    try {
      const user = await lookupUser(username);
      if (!user) {
        return res.status(401).json({ status: 'error', error: '用户名或密码错误' });
      }
      if (!bcrypt.compareSync(password, user.password_hash)) {
        return res.status(401).json({ status: 'error', error: '用户名或密码错误' });
      }
      const token = jwt.sign(
        { id: user.id, username: user.username, role: user.role },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES }
      );
      res.json({
        status: 'ok',
        user: { id: user.id, username: user.username, role: user.role },
        token,
      });
    } catch (e) {
      console.error('[auth/login]', e && e.message);
      res.status(500).json({ status: 'error', error: '登录失败' });
    }
  });

  // Get current user
  app.get('/api/auth/me', authMiddleware, async (req, res) => {
    try {
      let permissions = null;
      const { effectivePermissions } = require('./helpers/permissions');
      const uid = req.user && (req.user.id || req.user.userId);
      const row = uid ? await lookupById(uid) : null;
      if (row) permissions = effectivePermissions(row);
      res.json({ status: 'ok', user: { ...req.user, permissions } });
    } catch (e) {
      console.error('[auth/me]', e && e.message);
      res.status(500).json({ status: 'error', error: '获取用户信息失败' });
    }
  });
}

module.exports = { authMiddleware, setupAuthRoutes, JWT_SECRET };
