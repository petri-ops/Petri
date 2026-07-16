const {logError, readRecentErrors} = require('../helpers/error-log');

function isAdmin(req) {
  return req.isInternal || req.user?.role === 'admin';
}

function normalizeFrontendError(req) {
  const body = req.body || {};
  const message = body.message || body.msg || '';
  const stack = body.stack;
  const source = body.source || 'frontend';
  const url = body.url;
  const userAgent = body.userAgent || body.ua || req.headers['user-agent'];
  const line = body.line;
  const ts = body.ts;

  return {
    source,
    error: {message, stack},
    meta: {
      url,
      userAgent,
      line,
      ts,
      ip: req.ip,
    },
  };
}

module.exports = function registerObservabilityRoutes(app) {
  // Frontend error reporting is fire-and-forget and intentionally public.
  app.post('/api/error-report', (req, res) => {
    const {source, error, meta} = normalizeFrontendError(req);
    if (error.message) {
      logError(source, error, meta);
    }
    res.status(204).end();
  });

  // Simple pageview tracking (logs to stdout, can be parsed later).
  app.post('/api/pageview', (req, res) => {
    const {path, ts} = req.body || {};
    if (path) {
      console.log('[PV]', ts || new Date().toISOString(), '|', path);
    }
    res.status(204).end();
  });

  // Admin: view recent errors (last 200 lines).
  app.get('/api/admin/errors', async (req, res) => {
    if (!isAdmin(req)) {
      return res.status(403).json({status: 'error', error: '无权访问'});
    }
    try {
      const errors = await readRecentErrors(200);
      res.json({status: 'ok', errors});
    } catch (e) {
      res.json({status: 'error', error: e.message});
    }
  });
};
