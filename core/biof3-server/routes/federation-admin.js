'use strict';

/**
 * BLOCK-85 格物联邦 — 指挥席侧协作节点管理 REST（挂主后端，本机 127.0.0.1）。
 *
 * GET    /api/federation/peers          节点列表（安全投影，token 不出）
 * POST   /api/federation/peers/pair     {url} 粘贴对端配对链接 → 兑换+握手+落盘
 * POST   /api/federation/peers/:id/probe 在线探测
 * DELETE /api/federation/peers/:id      移除节点（本端删除；对端可在其面板吊销会话）
 */

const express = require('express');
const path = require('node:path');

const {
  addPeerFromPairingUrl,
  probePeer,
  removePeer,
  sanitizePeers,
} = require('../../shared-backend/federation-peers');

function resolveDataDir() {
  return process.env.BIOF3_LOCAL_DATA_DIR
    || process.env.LOCAL_DATA_DIR
    || path.join(process.cwd(), 'data');
}

module.exports = function registerFederationAdmin(app, { dataDir } = {}) {
  const dir = dataDir || resolveDataDir();

  app.get('/api/federation/peers', (_req, res) => {
    res.json({ ok: true, ...sanitizePeers(dir) });
  });

  app.post('/api/federation/peers/pair', express.json({ limit: '4kb' }), async (req, res) => {
    const url = typeof req.body?.url === 'string' ? req.body.url : '';
    if (!url.trim()) {
      res.status(400).json({ ok: false, error: 'url_required', message: '请粘贴对端格物的配对链接' });
      return;
    }
    try {
      const result = await addPeerFromPairingUrl(dir, url);
      res.status(result.ok ? 200 : 400).json(result);
    } catch (error) {
      res.status(500).json({ ok: false, error: 'pair_failed', message: error.message || '配对失败' });
    }
  });

  app.post('/api/federation/peers/:id/probe', async (req, res) => {
    try {
      const result = await probePeer(dir, req.params.id);
      res.json({ ok: true, probe: result, peer: sanitizePeers(dir).peers.find((entry) => entry.peerId === req.params.id) });
    } catch (error) {
      res.status(500).json({ ok: false, error: 'probe_failed', message: error.message });
    }
  });

  app.delete('/api/federation/peers/:id', (req, res) => {
    const removed = removePeer(dir, req.params.id);
    if (!removed) {
      res.status(404).json({ ok: false, error: 'peer_not_found' });
      return;
    }
    res.json({ ok: true, removed: req.params.id });
  });
};
