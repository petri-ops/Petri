/**
 * jwt-auth.js (W2-A, 2026-05-28)
 *
 * JWT verification for py-server's user-scoped tools API.
 * Shares the same JWT_SECRET as r-server (read from /etc/biof3.env via env var).
 *
 * Usage:
 *   const {jwtAuthRequired} = require('./jwt-auth');
 *   app.post('/api/tools/run', jwtAuthRequired, (req, res) => {
 *     // req.user = { id, username, role }
 *   });
 */

const jwt = require('jsonwebtoken');
const logger = require('./logger');
const config = require('./config');

const JWT_SECRET = process.env.JWT_SECRET;
const IS_LOCAL = config.localMode;

if (!JWT_SECRET && !IS_LOCAL) {
  logger.warn('[jwt-auth] JWT_SECRET not set — user-scoped tools API will reject all requests');
} else if (JWT_SECRET && JWT_SECRET.length < 32 && !IS_LOCAL) {
  logger.warn(`[jwt-auth] JWT_SECRET too short (${JWT_SECRET.length} chars, expected >= 32)`);
}

// 桌面版固定用户
const LOCAL_USER = { id: 'local-user', username: 'Local User', role: 'admin' };

/**
 * Strict JWT auth: 401 if no/invalid token. Sets req.user on success.
 * 桌面版（localMode）跳过验证，返回固定 local-user。
 */
function jwtAuthRequired(req, res, next) {
  if (IS_LOCAL) {
    req.user = LOCAL_USER;
    return next();
  }
  if (!JWT_SECRET) {
    return res
      .status(500)
      .json({ ok: false, error: 'auth_not_configured', message: '服务未配置 JWT 验证' });
  }
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ ok: false, error: 'login_required', message: '请先登录' });
  }
  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch {
    return res
      .status(401)
      .json({ ok: false, error: 'invalid_token', message: '登录已过期，请重新登录' });
  }
}

/**
 * Optional JWT — sets req.user if valid token present, otherwise leaves it undefined.
 * Used for endpoints like public-demo that work for both anonymous and logged-in users.
 * 桌面版直接返回 local-user。
 */
function jwtAuthOptional(req, res, next) {
  if (IS_LOCAL) {
    req.user = LOCAL_USER;
    return next();
  }
  if (!JWT_SECRET) return next();
  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    try {
      req.user = jwt.verify(authHeader.slice(7), JWT_SECRET);
    } catch {
      // ignore — anonymous
    }
  }
  next();
}

module.exports = { jwtAuthRequired, jwtAuthOptional, JWT_SECRET };
