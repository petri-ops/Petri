/**
 * Desktop Express middleware bootstrap.
 *
 * The server is loopback-only and has one local administrator identity. Web
 * login, JWT, API-token and internal-node authentication are intentionally not
 * part of the desktop runtime.
 */

const cors = require('cors');
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { LOCAL_USER, setupAuthRoutes } = require('./auth');
const { corsOrigin } = require('./helpers/local-request-boundary');

function requestIdMiddleware(req, res, next) {
  const rid = req.headers['x-request-id'] || uuidv4().slice(0, 12);
  req.requestId = rid;
  res.setHeader('X-Request-Id', rid);
  next();
}

function localIdentityMiddleware(req, _res, next) {
  req.user = LOCAL_USER;
  next();
}

/**
 * Time each request for the Result Studio performance work. Only mounted when
 * BIOF3_PERF_PROBE=1; the probe stores a route template, never the real path.
 */
function requestTimingMiddleware(req, res, next) {
  const perfProbe = require('./helpers/perf-probe');
  const startedAt = process.hrtime.bigint();
  let ttfbMs = null;
  const elapsed = () => Number(process.hrtime.bigint() - startedAt) / 1e6;
  const originalWrite = res.write.bind(res);
  res.write = (...args) => { if (ttfbMs === null) ttfbMs = elapsed(); return originalWrite(...args); };
  res.on('finish', () => {
    if (ttfbMs === null) ttfbMs = elapsed();
    perfProbe.recordRequestTiming({
      method: req.method,
      route: req.route && req.route.path ? `${req.baseUrl || ''}${req.route.path}` : req.path,
      status: res.statusCode,
      ttfbMs,
      totalMs: elapsed(),
    });
  });
  next();
}

function setupBootstrap(app, { db }) {
  app.use(cors({ origin: corsOrigin }));
  app.use(express.json({ limit: '200mb' }));
  app.use(requestIdMiddleware);
  if (require('./helpers/perf-probe').envEnabled()) app.use(requestTimingMiddleware);

  setupAuthRoutes(app, db);
  app.use(localIdentityMiddleware);

  try {
    const { moduleGate } = require('./helpers/permissions');
    app.use(moduleGate);
  } catch (error) {
    // BLOCK-102 P1 — fail-open must be LOUD: without the gate, module
    // permission requests are auto-approved with zero enforcement.
    console.error('[modules] permission gate FAILED TO LOAD — running WITHOUT permission enforcement:', error && error.message);
  }
}

module.exports = {
  requestIdMiddleware,
  localIdentityMiddleware,
  requestTimingMiddleware,
  setupBootstrap,
};
