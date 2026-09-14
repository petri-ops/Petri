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
  getPeer,
  getPeerToken,
} = require('../../shared-backend/federation-peers');

const JOB_FORWARD_TIMEOUT_MS = 120_000;      // 作业提交（含文件上传）
const STATUS_FORWARD_TIMEOUT_MS = 15_000;    // 状态查询
const FILE_FORWARD_TIMEOUT_MS = 120_000;     // 产物拉取

/** 转发 JSON 到对端（带联邦会话），返回 {status, data}。dataDir 来自闭包 dir。 */
function makeForwardJson(dir) {
  return async function forwardJson(peer, pathName, { method = 'GET', body = null, timeoutMs = STATUS_FORWARD_TIMEOUT_MS } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${peer.baseUrl}${pathName}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getPeerToken(dir, peer.peerId) || ''}`,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      const data = await response.json().catch(() => ({}));
      return { status: response.status, data };
    } finally {
      clearTimeout(timer);
    }
  };
}

function resolveDataDir() {
  return process.env.BIOF3_LOCAL_DATA_DIR
    || process.env.LOCAL_DATA_DIR
    || path.join(process.cwd(), 'data');
}

module.exports = function registerFederationAdmin(app, { dataDir } = {}) {
  const dir = dataDir || resolveDataDir();
  const forwardJson = makeForwardJson(dir);

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

  // 「打开界面」：向对端索取一次性配对链接（对端 gateway 会话门内的
  // mobile/pairing 端点），浏览器打开即见对端完整桌面投影（P3.5 复用）。
  app.post('/api/federation/peers/:id/projection-url', async (req, res) => {
    const peer = getPeer(dir, req.params.id);
    if (!peer) {
      res.status(404).json({ ok: false, error: 'peer_not_found' });
      return;
    }
    try {
      const forwarded = await forwardJson(peer, '/api/mobile/pairing/token', {
        method: 'POST',
        body: {},
        timeoutMs: 15_000,
      });
      const url = forwarded.data?.primaryUrl || forwarded.data?.urls?.[0];
      if (forwarded.status !== 200 || !url) {
        res.status(502).json({ ok: false, error: 'projection_url_failed', peerStatus: forwarded.status });
        return;
      }
      res.json({ ok: true, peerId: peer.peerId, peerName: peer.name, url });
    } catch (error) {
      res.status(504).json({ ok: false, error: error.name === 'AbortError' ? 'peer_timeout' : 'peer_unreachable' });
    }
  });

  // ── BLOCK-85 P2 作业级联邦（D3）：指挥席把作业转发给对端格物执行 ──
  // 对端以它自己的本地身份跑（POST /api/tools/run，会话门内全量路由已挂）；
  // 任务真值在对端，指挥席拿到对端 jobId 后按需查状态/拉产物。

  app.post('/api/federation/peers/:id/jobs', express.json({ limit: '200mb' }), async (req, res) => {
    const peer = getPeer(dir, req.params.id);
    if (!peer) {
      res.status(404).json({ ok: false, error: 'peer_not_found' });
      return;
    }
    const { toolId } = req.body || {};
    if (!toolId) {
      res.status(400).json({ ok: false, error: 'missing_tool_id' });
      return;
    }
    try {
      const forwarded = await forwardJson(peer, '/api/tools/run', {
        method: 'POST',
        body: req.body,
        timeoutMs: JOB_FORWARD_TIMEOUT_MS,
      });
      if (forwarded.status !== 200) {
        res.status(forwarded.status === 401 ? 401 : 502).json({
          ok: false,
          error: forwarded.status === 401 ? 'peer_session_invalid' : 'peer_run_failed',
          peerStatus: forwarded.status,
          peerError: forwarded.data,
        });
        return;
      }
      res.json({ ok: true, peerId: peer.peerId, peerName: peer.name, job: forwarded.data });
    } catch (error) {
      const offline = error.name === 'AbortError';
      res.status(504).json({
        ok: false,
        error: offline ? 'peer_timeout' : 'peer_unreachable',
        message: offline ? '对端作业提交超时' : `无法连接对端格物（${peer.name}）`,
      });
    }
  });

  app.get('/api/federation/peers/:id/jobs/:jobId', async (req, res) => {
    const peer = getPeer(dir, req.params.id);
    if (!peer) {
      res.status(404).json({ ok: false, error: 'peer_not_found' });
      return;
    }
    try {
      const forwarded = await forwardJson(peer, `/api/tools/status/${encodeURIComponent(req.params.jobId)}`);
      res.status(forwarded.status === 200 ? 200 : 502).json(
        forwarded.status === 200
          ? { ok: true, peerId: peer.peerId, job: forwarded.data }
          : { ok: false, error: 'peer_status_failed', peerStatus: forwarded.status, peerError: forwarded.data },
      );
    } catch (error) {
      res.status(504).json({ ok: false, error: error.name === 'AbortError' ? 'peer_timeout' : 'peer_unreachable' });
    }
  });

  app.get('/api/federation/peers/:id/jobs/:jobId/file/:filename', async (req, res) => {
    const peer = getPeer(dir, req.params.id);
    if (!peer) {
      res.status(404).json({ ok: false, error: 'peer_not_found' });
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FILE_FORWARD_TIMEOUT_MS);
    try {
      const token = getPeerToken(dir, peer.peerId) || '';
      const upstream = await fetch(
        `${peer.baseUrl}/api/tools/file/${encodeURIComponent(req.params.jobId)}/${encodeURIComponent(req.params.filename)}`,
        { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal },
      );
      if (!upstream.ok) {
        clearTimeout(timer);
        res.status(upstream.status === 401 ? 401 : 502).json({
          ok: false,
          error: upstream.status === 401 ? 'peer_session_invalid' : 'peer_file_failed',
          peerStatus: upstream.status,
        });
        return;
      }
      const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
      const buf = Buffer.from(await upstream.arrayBuffer());
      clearTimeout(timer);
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', String(buf.length));
      res.send(buf);
    } catch (error) {
      clearTimeout(timer);
      res.status(504).json({ ok: false, error: error.name === 'AbortError' ? 'peer_timeout' : 'peer_unreachable' });
    }
  });
};
