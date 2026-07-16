/**
 * r-server/helpers/auth-token.js — JWT Bearer token parsing helpers.
 *
 * Used by the combinedAuth middleware in server.js to deduplicate the
 * anonymous-OK (analytics / copilot / feedback) and strict (user access)
 * Bearer verification paths.
 *
 * Lives in r-server/helpers (not shared-backend) because it requires the
 * `jsonwebtoken` package, which is installed under r-server/node_modules.
 * Moving it to shared-backend would require giving shared-backend its own
 * dependency manifest and updating deploy scripts' `npm install` paths —
 * deferred until Phase 5 when platform-server owns its own app.
 */

const jwt = require('jsonwebtoken');

/**
 * Extract a Bearer token from an Authorization header and verify it.
 * Returns the decoded payload on success, or null on any failure
 * (missing header, wrong scheme, invalid/expired token).
 *
 * Use this for anonymous-OK paths where an invalid token should silently
 * fall back to anonymous rather than 401.
 */
function tryParseBearerUser(authHeader, jwtSecret) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  try {
    return jwt.verify(authHeader.slice(7), jwtSecret);
  } catch {
    return null;
  }
}

/**
 * Strict Bearer verification. Returns {ok: true, user} on success or
 * {ok: false, error} on failure. Use this for paths that must reject
 * invalid tokens with 401.
 */
function verifyBearerUser(authHeader, jwtSecret) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return {ok: false, error: '未授权访问，请登录'};
  }
  try {
    return {ok: true, user: jwt.verify(authHeader.slice(7), jwtSecret)};
  } catch {
    return {ok: false, error: '登录已过期，请重新登录'};
  }
}

module.exports = {
  tryParseBearerUser,
  verifyBearerUser,
};
