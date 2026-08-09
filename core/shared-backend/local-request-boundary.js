const DEFAULT_RENDERER_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:3002',
  'http://127.0.0.1:3002',
];

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
    process.env.BIOF3_RENDERER_DEV_URL,
    process.env.BIOF3_RENDERER_ORIGIN,
    ...(process.env.BIOF3_TRUSTED_DESKTOP_ORIGINS || '').split(','),
  ].filter((value) => value && String(value).trim());
  const candidates = configured.length > 0 ? configured : DEFAULT_RENDERER_ORIGINS;
  return new Set(
    candidates
      .map((value) => value && normalizeHttpOrigin(value.trim()))
      .filter(Boolean)
  );
}

function isTrustedDesktopOrigin(origin) {
  if (origin === undefined || origin === null || origin === '') return true;
  if (origin === 'null') return false;
  const normalized = normalizeHttpOrigin(origin);
  return normalized !== null && trustedDesktopOrigins().has(normalized);
}

function requireTrustedDesktopOrigin(req, res, next) {
  const origin = req && req.headers ? req.headers.origin : undefined;
  if (!isTrustedDesktopOrigin(origin)) {
    return res.status(403).json({
      status: 'error',
      error: 'untrusted_origin',
      message: '该本地接口不接受来自非 BioF3 页面来源的请求。',
    });
  }
  return next();
}

function corsOrigin(origin, callback) {
  if (isTrustedDesktopOrigin(origin)) return callback(null, true);
  return callback(null, false);
}

module.exports = {
  DEFAULT_RENDERER_ORIGINS,
  isTrustedDesktopOrigin,
  normalizeHttpOrigin,
  requireTrustedDesktopOrigin,
  trustedDesktopOrigins,
  corsOrigin,
};
