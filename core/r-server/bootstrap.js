/**
 * r-server/bootstrap.js — Shared Express middleware bootstrap.
 *
 * Extracted from server.js so that the middleware stack (CORS, JSON body,
 * request-id, auth routes, combinedAuth, module gate) can be mounted by
 * any role that builds an Express app — including a future standalone
 * platform-server — without duplicating the inline definitions.
 *
 * This module lives in r-server/ (not shared-backend/) because it depends
 * on express, cors, express-rate-limit, and uuid, which are installed
 * under r-server/node_modules. Moving it to shared-backend would require
 * giving shared-backend its own dependency manifest — deferred until
 * platform-server owns its own app and dependency tree (Phase 5 final).
 */

const cors = require('cors');
const express = require('express');
const rateLimit = require('express-rate-limit');
const {v4: uuidv4} = require('uuid');
const {tryParseBearerUser, verifyBearerUser} = require('./helpers/auth-token');
const {JWT_SECRET} = require('./auth');
const config = require('./config');

// 桌面版 localMode：跳过所有 auth 门控
const IS_LOCAL = config.localMode;

/**
 * Request-ID middleware: every request gets a unique ID for tracing.
 * Accepts client-provided X-Request-Id or generates one.
 */
function requestIdMiddleware(req, res, next) {
  const rid = req.headers['x-request-id'] || uuidv4().slice(0, 12);
  req.requestId = rid;
  res.setHeader('X-Request-Id', rid);
  next();
}

/**
 * Build the four rate limiters used by auth + task routes.
 * Returned as an object so callers can apply them selectively.
 */
function createRateLimiters() {
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5,
    message: {status: 'error', error: '登录尝试次数过多，请 15 分钟后再试'},
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true, // Successful logins don't count
  });

  const registerLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 3,
    message: {status: 'error', error: '注册次数过多，请 1 小时后再试'},
    standardHeaders: true,
  });

  const taskSubmitLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 30,
    message: {status: 'error', error: '提交任务过于频繁，请 1 小时后再试'},
    // FIX_RL_IPV6_v1 — use ipKeyGenerator for proper IPv6 /64 normalisation
    keyGenerator: (req) => req.user?.id || require('express-rate-limit').ipKeyGenerator(req),
  });

  const generalLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 200,
    message: {status: 'error', error: '请求过于频繁'},
    standardHeaders: true,
  });

  return {loginLimiter, registerLimiter, taskSubmitLimiter, generalLimiter};
}

/**
 * Build the combinedAuth middleware.
 *
 * @param {object} opts
 * @param {string} opts.apiToken   — BIOF3_API_TOKEN (legacy admin token)
 * @param {string} opts.internalToken — BIOF3_INTERNAL_TOKEN (ECS→Dell)
 * @param {string} opts.jwtSecret  — JWT_SECRET for Bearer verification
 */
function createCombinedAuth({apiToken, internalToken, jwtSecret}) {
  return function combinedAuth(req, res, next) {
    // 桌面版 localMode：所有请求都设为 admin 用户，跳过 auth
    if (IS_LOCAL) {
      req.user = { id: 'local-user', username: 'Local User', role: 'admin' };
      return next();
    }
    // Health check + auth routes don't need token
    if (req.path === '/api/health') return next();
    if (req.path.startsWith('/api/auth/')) return next();
    if (req.path === '/api/public/guest-permissions') return next();
    if (req.path === '/api/error-report' || req.path === '/api/pageview') return next();
    // TOOLS_DEMO_PUBLIC
    if (req.path.startsWith('/api/tools/demo/')) return next();
    if (req.path.startsWith('/api/tools/public-demo/')) return next();
    if (req.path.startsWith('/api/tools/public-file/')) return next();
    if (req.path.startsWith('/api/tools/demo-data/')) return next();
    // ANALYTICS_PUBLIC_v1: page-view and heartbeat accept anonymous traffic
    if (req.path === '/api/analytics/page-view' || req.path === '/api/analytics/heartbeat') {
      const user = tryParseBearerUser(req.headers['authorization'], jwtSecret);
      if (user) req.user = user;
      return next();
    }

    // COPILOT_ANON_v1: agent/chat accept anonymous; moduleGate + guest_permissions decide access.
    if (req.method === 'POST' && (req.path === '/api/ai/agent' || req.path === '/api/ai/chat')) {
      const user = tryParseBearerUser(req.headers['authorization'], jwtSecret);
      if (user) req.user = user; // invalid token → anonymous
      return next();
    }

    // FEEDBACK_PUBLIC_v1: anonymous users may submit feedback (e.g. unregistered visitors).
    if (req.method === 'POST' && req.path === '/api/feedback') {
      const user = tryParseBearerUser(req.headers['authorization'], jwtSecret);
      if (user) req.user = user;
      return next();
    }

    // Internal ECS -> Dell calls.
    const internalTokenHeader = req.headers['x-biof3-internal-token'];
    if (internalToken && internalTokenHeader === internalToken) {
      req.isInternal = true;
      req.user = {id: '__internal__', username: 'internal', role: 'admin'};
      return next();
    }

    // Legacy API token → admin access
    const apiTokenHeader = req.headers['x-api-token'] || req.query.token;
    if (apiTokenHeader === apiToken) {
      req.user = {id: '__admin__', username: 'admin', role: 'admin'};
      return next();
    }

    // JWT Bearer token → user access (header or query string)
    const authHeader = req.headers['authorization'] || (req.query.token && req.query.token !== apiToken ? 'Bearer ' + req.query.token : null);
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const result = verifyBearerUser(authHeader, jwtSecret);
      if (result.ok) {
        req.user = result.user;
        return next();
      }
      return res.status(401).json({status: 'error', error: result.error});
    }

    // Allow anonymous requests that moduleGate will judge.
    try {
      const {routeRequiresModuleGate} = require('./helpers/permissions');
      if (routeRequiresModuleGate(req)) return next();
    } catch { /* ignore */ }

    return res.status(401).json({status: 'error', error: '未授权访问，请登录'});
  };
}

/**
 * Mount the full shared middleware stack onto an Express app.
 *
 * @param {object} app — Express app instance
 * @param {object} opts
 * @param {object} opts.db — database module (passed to setupAuthRoutes)
 * @param {string} opts.apiToken — BIOF3_API_TOKEN
 * @param {string} opts.internalToken — BIOF3_INTERNAL_TOKEN
 * @returns {object} {rateLimiters} — the four rate limiter instances
 */
function setupBootstrap(app, {db, apiToken, internalToken}) {
  app.use(cors());
  app.use(express.json({limit: '200mb'}));
  app.use(requestIdMiddleware);

  // Auth routes (login / register / me)
  const {setupAuthRoutes} = require('./auth');
  setupAuthRoutes(app, db);

  // Combined auth middleware
  const combinedAuth = createCombinedAuth({apiToken, internalToken, jwtSecret: JWT_SECRET});
  app.use(combinedAuth);

  // MODULE_PERMS_v1 — per-user / guest module authorization gate
  try {
    const {moduleGate} = require('./helpers/permissions');
    app.use(moduleGate);
  } catch (e) {
    console.warn('[modules] permission gate failed to load:', e && e.message);
  }

  return {rateLimiters: createRateLimiters()};
}

module.exports = {
  requestIdMiddleware,
  createRateLimiters,
  createCombinedAuth,
  setupBootstrap,
};
