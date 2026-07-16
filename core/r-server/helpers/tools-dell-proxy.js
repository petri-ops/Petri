const {Readable} = require('stream');
const {pipeline} = require('stream/promises');
const {injectReportTheme, normalizeReportTheme, shouldThemeUpstream} = require('./report-theme');

function copyUpstreamHeaders(upstream, res) {
  for (const h of ['content-type', 'content-length', 'content-disposition', 'cache-control', 'etag', 'last-modified']) {
    const v = upstream.headers.get(h);
    if (v) res.setHeader(h, v);
  }
}

function createToolsDellProxy({
  internalToken,
  dellInternalApiBase,
  getUserId,
}) {
  const token = internalToken || '';
  const base = (dellInternalApiBase || 'http://127.0.0.1:3001/api').replace(/\/+$/, '');

  async function proxyDellToolRun(req, res, timeoutMs = 120000) {
    if (!token) {
      return res.status(503).json({error: 'internal_token_not_configured'});
    }
    const uid = getUserId(req);
    if (!uid) return res.status(401).json({error: 'login_required'});
    const target = `${base}/internal/tools/run`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const headers = {
      'Content-Type': 'application/json',
      'X-BioF3-Internal-Token': token,
      'X-Request-Id': req.requestId || '',
      'X-BioF3-User-Id': String(uid),
      'X-BioF3-User-Role': String((req.user && req.user.role) || ''),
      'X-BioF3-User-Name': String((req.user && req.user.username) || ''),
    };
    const smokeToken = req.headers['x-biof3-smoke-test'];
    if (typeof smokeToken === 'string') headers['X-BioF3-Smoke-Test'] = smokeToken;
    try {
      const upstream = await fetch(target, {
        method: 'POST',
        headers,
        body: JSON.stringify(req.body || {}),
        signal: ctrl.signal,
      });
      const text = await upstream.text();
      res.status(upstream.status);
      const contentType = upstream.headers.get('content-type');
      if (contentType) res.setHeader('Content-Type', contentType);
      return res.send(text);
    } catch (e) {
      const msg = e?.name === 'AbortError' ? 'dell_run_proxy_timeout' : e.message;
      return res.status(502).json({error: msg});
    } finally {
      clearTimeout(timer);
    }
  }

  async function proxyDellToolAsset(req, res, suffix, timeoutMs = 120000) {
    if (!token) {
      return res.status(503).json({error: 'internal_token_not_configured'});
    }
    const target = `${base}/internal/tools/${String(suffix || '').replace(/^\/+/, '')}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const upstream = await fetch(target, {
        method: req.method === 'HEAD' ? 'HEAD' : 'GET',
        headers: {
          'X-BioF3-Internal-Token': token,
          'X-Request-Id': req.requestId || '',
        },
        signal: ctrl.signal,
      });
      res.status(upstream.status);
      copyUpstreamHeaders(upstream, res);
      if (!upstream.body) return res.end();
      if (req.method === 'HEAD') return res.end();
      await pipeline(Readable.fromWeb(upstream.body), res);
    } catch (e) {
      const msg = e?.name === 'AbortError' ? 'dell_asset_proxy_timeout' : e.message;
      if (res.headersSent) return res.destroy(e);
      return res.status(502).json({error: msg});
    } finally {
      clearTimeout(timer);
    }
  }

  async function proxyDellPrivateFile(req, res, job, timeoutMs = 120000) {
    if (!token) {
      return res.status(503).json({error: 'internal_token_not_configured'});
    }
    const reportTheme = normalizeReportTheme(req.query?.theme);
    const themeQuery = reportTheme ? `?theme=${reportTheme}` : '';
    const target = `${base}/internal/tools/file/${encodeURIComponent(req.params.jobId)}/${encodeURIComponent(req.params.filename)}${themeQuery}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const headers = {
      'X-BioF3-Internal-Token': token,
      'X-Request-Id': req.requestId || '',
      'X-BioF3-Tool-Id': job.tool_id || '',
    };
    const contentType = req.headers['content-type'];
    if (contentType) headers['Content-Type'] = contentType;
    try {
      const upstream = await fetch(target, {
        method: req.method,
        headers,
        body: req.method === 'PUT' ? (req.body || Buffer.alloc(0)) : undefined,
        signal: ctrl.signal,
      });
      res.status(upstream.status);
      if (shouldThemeUpstream(req, upstream) && req.method !== 'HEAD') {
        const html = await upstream.text();
        return res.type('html').set('Cache-Control', 'private, no-store').send(
          injectReportTheme(html, reportTheme),
        );
      }
      copyUpstreamHeaders(upstream, res);
      if (!upstream.body || req.method === 'HEAD') return res.end();
      await pipeline(Readable.fromWeb(upstream.body), res);
    } catch (e) {
      const msg = e?.name === 'AbortError' ? 'dell_file_proxy_timeout' : e.message;
      if (res.headersSent) return res.destroy(e);
      return res.status(502).json({error: msg});
    } finally {
      clearTimeout(timer);
    }
  }

  async function proxyDellGenerateReport(req, res, job, timeoutMs = 120000) {
    if (!token) return res.status(503).json({error: 'internal_token_not_configured'});
    const target = `${base}/internal/tools/report/${encodeURIComponent(job.id)}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const upstream = await fetch(target, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-BioF3-Internal-Token': token,
          'X-Request-Id': req.requestId || '',
          'X-BioF3-Tool-Id': job.tool_id || '',
        },
        body: JSON.stringify(req.body || {}),
        signal: ctrl.signal,
      });
      const text = await upstream.text();
      res.status(upstream.status);
      res.type(upstream.headers.get('content-type') || 'application/json');
      return res.send(text);
    } catch (error) {
      return res.status(502).json({error: error?.name === 'AbortError' ? 'dell_report_proxy_timeout' : error.message});
    } finally {
      clearTimeout(timer);
    }
  }

  async function proxyDellToolCancel(req, res, job, timeoutMs = 30000) {
    if (!token) {
      return res.json({ok: true, status: 'cancelled', dell: {ok: false, error: 'internal_token_not_configured'}});
    }
    const target = `${base}/internal/tools/cancel/${encodeURIComponent(req.params.id)}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const upstream = await fetch(target, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-BioF3-Internal-Token': token,
          'X-Request-Id': req.requestId || '',
          'X-BioF3-Tool-Id': job.tool_id || '',
        },
        body: JSON.stringify({jobId: job.id}),
        signal: ctrl.signal,
      });
      const text = await upstream.text();
      let dell = null;
      try { dell = JSON.parse(text); } catch { dell = {ok: upstream.ok, body: text.slice(0, 200)}; }
      if (!upstream.ok) dell.ok = false;
      return res.json({ok: true, status: 'cancelled', dell});
    } catch (e) {
      const msg = e?.name === 'AbortError' ? 'dell_cancel_proxy_timeout' : e.message;
      return res.json({ok: true, status: 'cancelled', dell: {ok: false, error: msg}});
    } finally {
      clearTimeout(timer);
    }
  }

  async function proxyDellToolDelete(req, job, timeoutMs = 30000) {
    if (!token) {
      return {ok: false, error: 'internal_token_not_configured'};
    }
    const target = `${base}/internal/tools/job/${encodeURIComponent(req.params.id)}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const upstream = await fetch(target, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'X-BioF3-Internal-Token': token,
          'X-Request-Id': req.requestId || '',
          'X-BioF3-Tool-Id': job.tool_id || '',
        },
        body: JSON.stringify({jobId: job.id}),
        signal: ctrl.signal,
      });
      const text = await upstream.text();
      let data = null;
      try { data = JSON.parse(text); } catch { data = {ok: upstream.ok, body: text.slice(0, 200)}; }
      if (!upstream.ok) data.ok = false;
      return data;
    } catch (e) {
      return {ok: false, error: e?.name === 'AbortError' ? 'dell_delete_proxy_timeout' : e.message};
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    proxyDellToolRun,
    proxyDellToolAsset,
    proxyDellPrivateFile,
    proxyDellGenerateReport,
    proxyDellToolCancel,
    proxyDellToolDelete,
  };
}

module.exports = {
  createToolsDellProxy,
};
