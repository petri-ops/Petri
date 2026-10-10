'use strict';

/**
 * BLOCK-85 格物联邦 — 指挥席侧协作节点管理 REST（挂主后端，本机 127.0.0.1）。
 *
 * GET    /api/federation/peers          节点列表（安全投影，token 不出）
 * POST   /api/federation/peers/pair     {url, identity?} 粘贴对端配对链接 → 兑换+握手+落盘
 * POST   /api/federation/peers/:id/probe 在线探测
 * DELETE /api/federation/peers/:id      移除节点（本端删除；对端可在其面板吊销会话）
 * GET    /api/federation/members        协作成员（本机会话中带工程师声明身份的访客，BLOCK-88 P1）
 * GET    /api/federation/grants         项目授权清单（含项目名，BLOCK-88 P3）
 * POST   /api/federation/grants         {engineer, projectId} 授权（幂等）
 * DELETE /api/federation/grants?engineer=&projectId=  吊销
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
  loadPeers,
} = require('../../shared-backend/federation-peers');
const { getStores } = require('../mobile-gateway/pairing');
const grants = require('../../shared-backend/federation-grants');

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
  return process.env.PETRI_LOCAL_DATA_DIR
    || process.env.LOCAL_DATA_DIR
    || path.join(process.cwd(), 'data');
}

// BLOCK-164 W2 — 委托历史聚合：委托方视角的「我委托过什么」。真值 = 本机 task_events
// 中 delegate_to_petri_node 的 tool_call/tool_result 对（receipt.toolResult.data 即回执）。
// 只读聚合，无写面；limit 有界（默认 50）。
const DELEGATIONS_DEFAULT_LIMIT = 50;

function collectDelegations(db, userId, { limit = DELEGATIONS_DEFAULT_LIMIT } = {}) {
  const calls = db.prepare(`
    SELECT e.task_id AS taskId, e.seq AS callSeq, e.payload AS callPayload, e.created_at AS createdAt,
           t.params AS taskParams, t.agent_status AS taskAgentStatus
    FROM task_events e JOIN tasks t ON t.id = e.task_id
    WHERE e.event_type = 'tool_call' AND t.user_id = ?
      AND json_valid(e.payload) AND json_extract(e.payload, '$.name') = 'delegate_to_petri_node'
    ORDER BY e.created_at DESC LIMIT ?
  `).all(userId, limit);
  const resultStmt = db.prepare(`
    SELECT payload FROM task_events
    WHERE task_id = ? AND event_type = 'tool_result' AND seq > ?
      AND json_valid(payload) AND json_extract(payload, '$.name') = 'delegate_to_petri_node'
    ORDER BY seq LIMIT 1
  `);
  return calls.map((row) => {
    let call = {};
    try { call = JSON.parse(row.callPayload || '{}'); } catch { /* 坏帧诚实降级 */ }
    const args = call.args || {};
    let params = {};
    try { params = JSON.parse(row.taskParams || '{}'); } catch { /* 同上 */ }
    let receipt = null;
    try {
      const r = resultStmt.get(row.taskId, row.callSeq);
      if (r) {
        const parsed = JSON.parse(r.payload);
        receipt = parsed && parsed.toolResult ? parsed.toolResult.data : null;
      }
    } catch { /* 结果帧缺失=未知态 */ }
    return {
      taskId: row.taskId,
      createdAt: row.createdAt,
      task: String(args.task || '').slice(0, 300),
      peerId: String(args.peerId || ''),
      peerName: (receipt && receipt.peerName) || null,
      projectId: params.projectId || null,
      conversationId: params.conversationId || null,
      status: receipt
        ? (receipt.ok ? 'done' : (receipt.error || 'failed'))
        : (String(row.taskAgentStatus || '') === 'running' ? 'running' : 'unknown'),
      replyHead: receipt && typeof receipt.reply === 'string' ? receipt.reply.slice(0, 240) : null,
    };
  });
}

// BLOCK-164 W3 — 节点在线态自动化：60s 定时探活（unref，不吊事件循环；跳过空清单；
// 单 peer 失败静默——在线点降级为「陈旧」，绝不刷错误风暴）。PETRI_FED_HEARTBEAT_MS=0 关闭。
const PEER_HEARTBEAT_MS_DEFAULT = 60_000;

function startPeerHeartbeat({ dataDir, intervalMs, probe = probePeer, listPeers = loadPeers } = {}) {
  const ms = Number.isFinite(intervalMs)
    ? intervalMs
    : (Number(process.env.PETRI_FED_HEARTBEAT_MS) || PEER_HEARTBEAT_MS_DEFAULT);
  if (ms <= 0) return { stop() {}, intervalMs: 0 };
  const timer = setInterval(() => {
    let peers = [];
    try { peers = (listPeers(dataDir) || {}).peers || []; } catch { return; }
    for (const peer of peers) {
      try {
        void Promise.resolve(probe(dataDir, peer.peerId)).catch(() => { /* 静默降级 */ });
      } catch { /* 静默降级 */ }
    }
  }, ms);
  if (timer.unref) timer.unref();
  return { stop: () => clearInterval(timer), intervalMs: ms };
}

module.exports = function registerFederationAdmin(app, { dataDir } = {}) {
  const dir = dataDir || resolveDataDir();
  const forwardJson = makeForwardJson(dir);
  // BLOCK-164 W3 — 节点在线态自动探活（60s；PETRI_FED_HEARTBEAT_MS=0 可关）
  startPeerHeartbeat({ dataDir: dir });

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
      const result = await addPeerFromPairingUrl(dir, url, { identity: req.body?.identity || null });
      res.status(result.ok ? 200 : 400).json(result);
    } catch (error) {
      res.status(500).json({ ok: false, error: 'pair_failed', message: error.message || '配对失败' });
    }
  });

  // BLOCK-88 P1（D2）：协作成员 = 本机 gateway 会话中带工程师声明身份的访客。
  // 单一真相复用 getStores(dir) 会话单例（与 gateway/mobile-admin 同进程同数据），
  // 零新存储；被访端联邦面板「协作成员」读取（在线=客户端按 lastSeenAt 判定）。
  app.get('/api/federation/members', (_req, res) => {
    const members = getStores(dir).sessions.list()
      .filter((session) => session.identity && !session.revoked)
      .map(({ id, name, createdAt, lastSeenAt, identity }) => ({ id, name, createdAt, lastSeenAt, identity }));
    res.json({ ok: true, members });
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

  // ── BLOCK-88 P3（D4）：项目授权清单（宿主桌面面管理）──
  // 授权/吊销即时落 grants.json；强制面在 agent 委托入口（chat.js）。
  function projectNameMap() {
    const rows = require('../db').getDatabase().prepare('SELECT id, name FROM projects').all();
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  app.get('/api/federation/grants', (_req, res) => {
    const names = projectNameMap();
    const items = grants.listGrants(dir).map((g) => ({ ...g, projectName: names.get(g.projectId) || null }));
    res.json({ ok: true, grants: items });
  });

  app.post('/api/federation/grants', express.json({ limit: '4kb' }), (req, res) => {
    const result = grants.grantProject(dir, req.body?.engineer, req.body?.projectId);
    if (!result.ok) {
      res.status(400).json({ ok: false, error: result.error, message: 'engineer 与 projectId 必填' });
      return;
    }
    res.json({ ok: true, grants: result.grants });
  });

  app.delete('/api/federation/grants', (req, res) => {
    const result = grants.revokeProject(dir, req.query.engineer, req.query.projectId);
    if (!result.ok) {
      res.status(result.error === 'grant_not_found' ? 404 : 400).json({ ok: false, error: result.error });
      return;
    }
    res.json({ ok: true, grants: result.grants });
  });

  // 「打开界面」：向对端索取一次性配对链接（对端 gateway 会话门内的
  // mobile/pairing 端点），浏览器打开即见对端完整桌面投影（P3.5 复用）。
  // BLOCK-164 W2 — 委托历史（委托方视角）：本机 task_events 中 delegate 工具调用聚合
  app.get('/api/federation/delegations', (req, res) => {
    try {
      const db = require('../db').getDatabase();
      const userId = require('../auth').LOCAL_USER.id;
      res.json({ ok: true, delegations: collectDelegations(db, userId) });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

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

module.exports.collectDelegations = collectDelegations;
module.exports.startPeerHeartbeat = startPeerHeartbeat;
module.exports.PEER_HEARTBEAT_MS_DEFAULT = PEER_HEARTBEAT_MS_DEFAULT;
