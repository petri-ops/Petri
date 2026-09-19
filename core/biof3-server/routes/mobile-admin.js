'use strict';

/**
 * BLOCK-70 mobile-gateway — 桌面端管理面 REST（挂主后端，本机 127.0.0.1）。
 *
 * GET  /api/mobile/status                  三态：未启用 / 已启用未配对 / 已连接
 * POST /api/mobile/config                  {enabled?, port?} 写配置（重启生效，诚实提示）
 * POST /api/mobile/pairing/token           生成一次性配对 token + QR URL 列表
 * GET  /api/mobile/devices                 设备列表（安全投影）
 * POST /api/mobile/devices/:id/revoke      吊销会话（即时失效）
 *
 * 与 gateway 共享 getStores(dataDir) 单例——吊销即刻对移动面生效。
 */

const express = require('express');
const path = require('node:path');
const qrcode = require('qrcode-generator');

const { getStores } = require('../mobile-gateway/pairing');
const { writeTunnelConfig, readTunnelConfig, getTunnelManager } = require('../mobile-gateway/tunnel');
const { writeConfig, lanAddresses, resolveEnabled, resolvePort } = require('../mobile-gateway/config');

function resolveDataDir() {
  return process.env.BIOF3_LOCAL_DATA_DIR
    || process.env.LOCAL_DATA_DIR
    || path.join(process.cwd(), 'data');
}

module.exports = function registerMobileAdmin(app, { dataDir } = {}) {
  const dir = dataDir || resolveDataDir();

  app.get('/api/mobile/status', (_req, res) => {
    // 生效值（env 可覆盖配置文件）而非仅文件值，与实际运行的 gateway 一致。
    const enabled = resolveEnabled({ dataDir: dir });
    const port = resolvePort({ dataDir: dir });
    const stores = getStores(dir);
    const active = stores.sessions.list().filter((session) => !session.revoked);
    res.json({
      ok: true,
      enabled,
      port,
      restartHint: '启用/关闭在重启桌面端后生效',
      lanAddresses: lanAddresses(),
      activeDevices: active.length,
      devices: stores.sessions.list(),
      pairingPending: stores.pairing.pendingCount(),
      tunnel: getTunnelManager(dir).status(),
    });
  });

  // ── BLOCK-70 P3 — aliyun 反向隧道（A2 真远程）────────────────────
  // GET  /api/mobile/tunnel         四态：disabled/connecting/connected/reconnecting
  // POST /api/mobile/tunnel/config  {host(ssh 别名), remotePort, localPort, publicUrl, enabled}
  app.get('/api/mobile/tunnel', (_req, res) => {
    res.json({ ok: true, tunnel: getTunnelManager(dir).status(), profiles: readTunnelConfig(dir).profiles });
  });

  app.post('/api/mobile/tunnel/config', express.json({ limit: '4kb' }), (req, res) => {
    const body = req.body || {};
    const host = typeof body.host === 'string' ? body.host.trim() : '';
    if (host && !/^[A-Za-z0-9._-]{1,120}$/.test(host)) {
      res.status(400).json({ ok: false, error: 'invalid_host', message: 'SSH 主机别名必须是 ~/.ssh/config 里的 Host 名（字母数字._-）' });
      return;
    }
    if (body.enabled === true && !host && !readTunnelConfig(dir).host) {
      res.status(400).json({ ok: false, error: 'host_required', message: '启用隧道前请先填写 SSH 主机别名' });
      return;
    }
    // BLOCK-87 — 中转服务器档案：存当前为档案 / 应用档案切换。
    if (typeof body.profileSave === 'string' && body.profileSave.trim()) {
      const current = readTunnelConfig(dir);
      if (!current.host) {
        res.status(400).json({ ok: false, error: 'nothing_to_save', message: '当前没有已配置的服务器' });
        return;
      }
      const profiles = current.profiles.filter((p) => p.name !== body.profileSave.trim());
      profiles.push({
        name: body.profileSave.trim().slice(0, 40),
        host: current.host,
        publicUrl: current.publicUrl || '',
        remotePort: current.remotePort,
      });
      writeTunnelConfig(dir, { profiles });
    }
    if (typeof body.profileApply === 'string' && body.profileApply.trim()) {
      const target = readTunnelConfig(dir).profiles.find((p) => p.name === body.profileApply.trim());
      if (!target) {
        res.status(404).json({ ok: false, error: 'profile_not_found' });
        return;
      }
      // BLOCK-102 P3 — localPort 白名单：该端口经公网 nginx 反代可达，配成 3001
    // 会把未鉴权本机 API 直接发布到公网门。仅允许网关端口 3005。
    if (body.localPort !== undefined && Number(body.localPort) !== 3005) {
      res.status(400).json({ ok: false, error: 'invalid_local_port', message: 'localPort 仅允许网关端口 3005' });
      return;
    }
    const tunnel = getTunnelManager(dir).apply({
        host: target.host,
        publicUrl: target.publicUrl || '',
        remotePort: target.remotePort,
      });
      res.json({ ok: true, tunnel, applied: target.name });
      return;
    }
    if (typeof body.profileDelete === 'string' && body.profileDelete.trim()) {
      const current = readTunnelConfig(dir);
      writeTunnelConfig(dir, { profiles: current.profiles.filter((p) => p.name !== body.profileDelete.trim()) });
    }
    // BLOCK-102 P3 — localPort 白名单：该端口经公网 nginx 反代可达，配成 3001
    // 会把未鉴权本机 API 直接发布到公网门。仅允许网关端口 3005。
    if (body.localPort !== undefined && Number(body.localPort) !== 3005) {
      res.status(400).json({ ok: false, error: 'invalid_local_port', message: 'localPort 仅允许网关端口 3005' });
      return;
    }
    const tunnel = getTunnelManager(dir).apply({
      enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
      host,
      remotePort: body.remotePort,
      localPort: body.localPort,
      publicUrl: body.publicUrl,
    });
    res.json({ ok: true, tunnel });
  });

  // 配对 URL 序（P3.5 桌面投影，用户裁决「整个软件桌面原封不动的过来」）：
  // 隧道 connected + 公网地址 → 主推 /pair（兑换 cookie → 完整桌面 SPA）；
  // 配对 URL 序（P3.5 桌面投影 + BLOCK-85 跨设备配对）：
  // 优先序 = 公网（隧道 connected）> 局域网地址 > 本机回环（仅本机自用兜底）。
  // 统一 /pair?token= 形态（浏览器打开即完整界面投影；移动页 /m 在投影内可达）。
  // 修因：跨设备配对时 primary 曾是 127.0.0.1——对端拿到的是它自己的回环，
  // 根本连不上（BLOCK-85 双真机实测抓真）。
  function pairingUrlsFor(token) {
    const port = resolvePort({ dataDir: dir });
    const lan = lanAddresses().map((ip) => `http://${ip}:${port}/pair?token=${token}`);
    const loopback = `http://127.0.0.1:${port}/pair?token=${token}`;
    const tunnel = getTunnelManager(dir).status();
    if (tunnel.enabled && tunnel.state === 'connected' && tunnel.publicUrl) {
      const publicUrl = `${tunnel.publicUrl.replace(/\/+$/, '')}/pair?token=${token}`;
      return [publicUrl, ...lan, loopback];
    }
    if (lan.length > 0) return [lan[0], ...lan.slice(1), loopback];
    return [loopback];
  }

  app.post('/api/mobile/config', express.json({ limit: '4kb' }), (req, res) => {
    const next = writeConfig(dir, {
      enabled: typeof req.body?.enabled === 'boolean' ? req.body.enabled : undefined,
      port: req.body?.port,
    });
    res.json({ ok: true, config: next, restartHint: '启用/关闭在重启桌面端后生效' });
  });

  app.post('/api/mobile/pairing/token', express.json({ limit: '4kb' }), (req, res) => {
    const { token, expiresAt } = getStores(dir).pairing.issue();
    const urls = pairingUrlsFor(token);
    res.json({ ok: true, token, expiresAt, urls, primaryUrl: urls[0] });
  });

  // 配对二维码 SVG（服务端渲染，前端零新依赖）。token 无效时手机侧配对仍会被拒。
  app.get('/api/mobile/pairing/qr.svg', (req, res) => {
    const token = String(req.query.token || '').trim();
    if (!token || !/^[a-f0-9]{16,256}$/.test(token)) {
      res.status(400).type('text/plain').send('invalid pairing token');
      return;
    }
    const url = pairingUrlsFor(token)[0];
    const qr = qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    res.type('image/svg+xml').send(qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true }));
  });

  app.get('/api/mobile/devices', (_req, res) => {
    res.json({ ok: true, devices: getStores(dir).sessions.list() });
  });

  app.post('/api/mobile/devices/:id/revoke', express.json({ limit: '4kb' }), (req, res) => {
    const ok = getStores(dir).sessions.revoke(String(req.params.id || ''));
    if (!ok) {
      res.status(404).json({ ok: false, error: 'device_not_found' });
      return;
    }
    res.json({ ok: true, revoked: req.params.id });
  });
};
