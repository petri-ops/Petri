const DEFAULT_RENDERER_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:3002',
  'http://127.0.0.1:3002',
];

// L1-3（蓝图 L-52）：回环 http origin 单源谓词——显式端口必需；仅精确主机名
// localhost/127.0.0.1/[::1]（*.localhost 不算回环）。src 侧消费方经
// src/main/env-coordinator.js 的 re-export 复用本谓词（R3：core 不回依赖 src）。
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

function isLoopbackHttpOrigin(value) {
  try {
    const parsed = new URL(String(value));
    if (parsed.protocol !== 'http:') return false;
    if (!parsed.port) return false;
    return LOOPBACK_HOSTNAMES.has(parsed.hostname);
  } catch {
    return false;
  }
}

function normalizeHttpOrigin(value) {
  try {
    const parsed = new URL(String(value));
    return parsed.protocol === 'http:' ? parsed.origin : null;
  } catch {
    return null;
  }
}

function trustedDesktopOrigins() {
  const configured = [
    process.env.PETRI_RENDERER_DEV_URL,
    process.env.PETRI_RENDERER_ORIGIN,
    ...(process.env.PETRI_TRUSTED_DESKTOP_ORIGINS || '').split(','),
  ].filter((value) => value && String(value).trim());
  const candidates = configured.length > 0 ? configured : DEFAULT_RENDERER_ORIGINS;
  // L1-3（L-52）：全部 env 源统一回环过滤——env 注入非回环 origin 一律丢弃
  //（默认集本身全回环，不受影响）。
  return new Set(
    candidates
      .map((value) => value && normalizeHttpOrigin(value.trim()))
      .filter((origin) => origin !== null && isLoopbackHttpOrigin(origin))
  );
}

function isTrustedDesktopOrigin(origin) {
  if (origin === undefined || origin === null || origin === '') return true;
  if (origin === 'null') return false;
  const normalized = normalizeHttpOrigin(origin);
  return normalized !== null && trustedDesktopOrigins().has(normalized);
}

// L1-3（L-52）：非浏览器（无 Origin 头）请求的变更动词需本机随机 token——
// main 在 spawn 后端时注入 PETRI_LOCAL_REQUEST_TOKEN（每 boot 随机），curl/脚本类
// 本地调用方须带 `x-petri-local-request-token` 头。env 未设时保持旧语义（测试/离线
// 后端兼容，真实栈恒有 env；server boot 在 env 在场时把 token 落 0600 文件供流读取）。
const TOKEN_MUTATING_METHODS = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);

function requireTrustedDesktopOrigin(req, res, next) {
  const origin = req && req.headers ? req.headers.origin : undefined;
  if (!isTrustedDesktopOrigin(origin)) {
    return res.status(403).json({
      status: 'error',
      error: 'untrusted_origin',
      message: '该本地接口不接受来自非 Petri 页面来源的请求。',
    });
  }
  const emptyOrigin = origin === undefined || origin === null || origin === '';
  if (emptyOrigin && TOKEN_MUTATING_METHODS.has(String(req.method || 'GET').toUpperCase())) {
    const expected = process.env.PETRI_LOCAL_REQUEST_TOKEN;
    if (expected) {
      const provided = req.headers ? req.headers['x-petri-local-request-token'] : undefined;
      if (provided !== expected) {
        return res.status(403).json({
          status: 'error',
          error: 'local_request_token_required',
          message: '无 Origin 的本地变更请求必须携带本机随机 token（x-petri-local-request-token）。',
        });
      }
    }
  }
  return next();
}

function corsOrigin(origin, callback) {
  if (isTrustedDesktopOrigin(origin)) return callback(null, true);
  return callback(null, false);
}

module.exports = {
  DEFAULT_RENDERER_ORIGINS,
  isLoopbackHttpOrigin,
  isTrustedDesktopOrigin,
  normalizeHttpOrigin,
  requireTrustedDesktopOrigin,
  trustedDesktopOrigins,
  corsOrigin,
};
