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
const { corsOrigin, isTrustedDesktopOrigin } = require('./helpers/local-request-boundary');

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
 * BLOCK-434 W2（M5 接线）— 全局 Origin 门。
 *
 * 现状：`requireTrustedDesktopOrigin` 只挂在 files 域若干路由上，settings / memory /
 * pack / session 等写面对浏览器跨源请求没有统一拒绝。
 * 本中间件只拦「**带了 Origin 但不可信**」的请求：
 *   - 无 Origin（curl / 本地脚本 / 既有 Node 测试）→ 保持原语义放行，不引入新前置条件；
 *   - 可信桌面 Origin（回环端口白名单，单源在 local-request-boundary）→ 放行；
 *   - 其它 Origin → 403 + 结构化错误（不暴露内部细节）。
 * 已挂 `requireTrustedDesktopOrigin` 的路由语义不变（更严格，含无 Origin 的 token 校验）。
 */
function isBrowserHttpOrigin(origin) {
  try {
    const parsed = new URL(String(origin));
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function rejectUntrustedOrigin(req, res, next) {
  const origin = req && req.headers ? req.headers.origin : undefined;
  const absent = origin === undefined || origin === null || origin === '';
  if (absent) return next();
  // 只拦真实 http(s) 页面来源：'null' / file:// 等不透明来源由各路由的 token 门
  // 自行裁决（既有 BLOCK-67 拖出下载语义：Origin:null + 正确 token → 放行）。
  if (!isBrowserHttpOrigin(origin)) return next();
  if (isTrustedDesktopOrigin(origin)) return next();
  return res.status(403).json({
    status: 'error',
    error: 'untrusted_origin',
    message: '该本地接口不接受来自非 Petri 页面来源的请求。',
  });
}

/**
 * Time each request for the Result Studio performance work. Only mounted when
 * PETRI_PERF_PROBE=1; the probe stores a route template, never the real path.
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
  // BLOCK-434 W2（M5 接线）：全局 Origin 门——必须在业务路由之前挂载。
  app.use(rejectUntrustedOrigin);
  if (require('./helpers/perf-probe').envEnabled()) app.use(requestTimingMiddleware);

  setupAuthRoutes(app, db);
  app.use(localIdentityMiddleware);

  try {
    const { moduleGate } = require('./helpers/permissions');
    app.use(moduleGate);
  } catch (error) {
    // BLOCK-102 P1 — fail-open must be LOUD: without the gate, module
    // permission requests are auto-approved with zero enforcement.
    // L3-5（蓝图 L-22）：仅 LOUD 不够——进程级 degraded 标记 + 健康面可见
    //（不静默回落「自动批准一切」；恢复须重启后重载成功）。
    process.env.PETRI_PERMISSION_GATE_DEGRADED = '1';
    console.error('[modules] permission gate FAILED TO LOAD — DEGRADED（权限门未生效，健康面可见）:', error && error.message);
  }
}

module.exports = {
  requestIdMiddleware,
  localIdentityMiddleware,
  requestTimingMiddleware,
  rejectUntrustedOrigin,
  setupBootstrap,
};
