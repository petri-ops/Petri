const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function isTrustedDesktopOrigin(origin) {
  if (origin === undefined || origin === null || origin === '') return true;
  if (origin === 'null') return false;
  try {
    const parsed = new URL(String(origin));
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:')
      && LOOPBACK_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
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
  isTrustedDesktopOrigin,
  requireTrustedDesktopOrigin,
  corsOrigin,
};
