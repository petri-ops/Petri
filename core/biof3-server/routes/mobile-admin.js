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
    });
  });

  app.post('/api/mobile/config', express.json({ limit: '4kb' }), (req, res) => {
    const next = writeConfig(dir, {
      enabled: typeof req.body?.enabled === 'boolean' ? req.body.enabled : undefined,
      port: req.body?.port,
    });
    res.json({ ok: true, config: next, restartHint: '启用/关闭在重启桌面端后生效' });
  });

  app.post('/api/mobile/pairing/token', express.json({ limit: '4kb' }), (req, res) => {
    const port = resolvePort({ dataDir: dir });
    const { token, expiresAt } = getStores(dir).pairing.issue();
    const urls = lanAddresses().map((ip) => `http://${ip}:${port}/m#${token}`);
    if (urls.length === 0) urls.push(`http://127.0.0.1:${port}/m#${token}`);
    res.json({ ok: true, token, expiresAt, urls, primaryUrl: urls[0] });
  });

  // 配对二维码 SVG（服务端渲染，前端零新依赖）。token 无效时手机侧配对仍会被拒。
  app.get('/api/mobile/pairing/qr.svg', (req, res) => {
    const token = String(req.query.token || '').trim();
    if (!token || !/^[a-f0-9]{16,256}$/.test(token)) {
      res.status(400).type('text/plain').send('invalid pairing token');
      return;
    }
    const port = resolvePort({ dataDir: dir });
    const urls = lanAddresses().map((ip) => `http://${ip}:${port}/m#${token}`);
    const url = urls[0] || `http://127.0.0.1:${port}/m#${token}`;
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
