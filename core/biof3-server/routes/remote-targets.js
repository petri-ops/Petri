/**
 * BLOCK-57 — 执行目标 REST 路由（挂载在 /api/remote-targets）
 *
 * 设置页目标管理数据面：列表（注册 + ssh-config 发现）/ 注册 / 探测 / 移除。
 * 认证复用 tools-platform 同款 getUserId；写操作要求已登录。
 */

const { createTargetRegistry } = require('../helpers/remote-execution/target-registry');

function createRemoteTargetRoutes({ db, getUserId }) {
  const registry = createTargetRegistry({ db });

  function serialize(row) {
    if (!row) return row;
    let lastProbe = null;
    try { lastProbe = row.last_probe_json ? JSON.parse(row.last_probe_json) : null; } catch { lastProbe = null; }
    return {
      id: row.id,
      alias: row.alias,
      label: row.label || '',
      status: row.status || 'unprobed',
      lastProbeAt: row.last_probe_at || null,
      lastProbe,
    };
  }

  function registerRemoteTargets(app) {
    app.get('/api/remote-targets', async (req, res) => {
      const uid = getUserId(req);
      if (!uid) return res.status(401).json({ error: 'login_required' });
      const { registered, discovered } = await registry.listWithDiscovery();
      res.json({
        ok: true,
        registered: registered.map(serialize),
        discovered,
      });
    });

    app.post('/api/remote-targets', requireJson(), async (req, res) => {
      const uid = getUserId(req);
      if (!uid) return res.status(401).json({ error: 'login_required' });
      const { alias, label } = req.body || {};
      const result = registry.register({ alias, label });
      if (!result.ok) {
        return res.status(result.error === 'invalid_alias' ? 400 : 409).json({ ok: false, error: result.error });
      }
      res.json({ ok: true, id: result.id, alias: result.alias });
    });

    app.post('/api/remote-targets/:id/probe', async (req, res) => {
      const uid = getUserId(req);
      if (!uid) return res.status(401).json({ error: 'login_required' });
      const probe = await registry.probe({ id: req.params.id });
      if (!probe.ok) {
        return res.status(502).json({ ok: false, error: probe.error, detail: probe.detail || '' });
      }
      res.json({ ok: true, targetId: probe.targetId, alias: probe.alias, info: probe.info });
    });

    app.delete('/api/remote-targets/:id', async (req, res) => {
      const uid = getUserId(req);
      if (!uid) return res.status(401).json({ error: 'login_required' });
      const result = registry.remove({ id: req.params.id });
      if (!result.ok) return res.status(404).json({ ok: false, error: 'target_not_found' });
      res.json({ ok: true });
    });
  }

  return { registerRemoteTargets, registry };
}

function requireJson() {
  // 局部引用，避免 routes 顶层对 express 的额外依赖形态
  return require('express').json();
}

module.exports = { createRemoteTargetRoutes };
