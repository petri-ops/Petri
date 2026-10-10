'use strict';

/**
 * BLOCK-85 格物联邦 — 指挥席侧协作节点注册表（D2/D3/D6）。
 *
 * peers.json 落 <dataDir>/federation/peers.json：指挥席保存「对端格物」的
 * 地址与会话凭证（token 明文——指挥席是凭证保管方，等同手机保存 cookie；
 * 对端视角的 sessions.json 依旧只存 hash，两侧安全语义不变）。
 *
 * 配对流程（D2 沿用配对码零新机制）：
 *   用户在对端格物「手机连接」面板生成配对码 → 粘贴配对 URL 到指挥席
 *   协作面板 → addPeerFromPairingUrl(): POST <base>/m/api/pair 兑换会话 →
 *   GET <base>/federation/api/health 握手（D3 版本/机型）→ 落盘。
 */

const fs = require('fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { sanitizeEngineerIdentity } = require('./engineer-identity');

const PEERS_VERSION = 1;
const PROBE_TIMEOUT_MS = 4000;

function peersFile(dataDir) {
  return path.join(dataDir, 'federation', 'peers.json');
}

function loadPeers(dataDir) {
  try {
    const raw = JSON.parse(fs.readFileSync(peersFile(dataDir), 'utf8'));
    if (raw && Array.isArray(raw.peers)) {
      return { version: PEERS_VERSION, peers: raw.peers };
    }
  } catch { /* first run */ }
  return { version: PEERS_VERSION, peers: [] };
}

function persistPeers(dataDir, data) {
  fs.mkdirSync(path.dirname(peersFile(dataDir)), { recursive: true });
  const tmp = `${peersFile(dataDir)}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, peersFile(dataDir));
}

function peerId() {
  return `gpeer_${crypto.randomBytes(8).toString('hex')}`;
}

/** 解析配对 URL（http://host:port/pair?token=... 或 /m#token=...）→ {baseUrl, token} */
function parsePairingUrl(rawUrl) {
  const text = String(rawUrl || '').trim();
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    // 容忍缺协议（用户常省 http://）
    try { parsed = new URL(`http://${text}`); } catch { return null; }
  }
  let token = parsed.searchParams.get('token') || '';
  if (!token) {
    const hash = parsed.hash.replace(/^#/, '');
    if (hash && !hash.includes('=')) {
      // 旧移动页形态：/m#<裸token>
      token = hash;
    } else {
      const hashParams = new URLSearchParams(hash);
      token = hashParams.get('t') || hashParams.get('token') || '';
    }
  }
  if (!token || !/^https?:$/.test(parsed.protocol)) return null;
  const base = `${parsed.protocol}//${parsed.host}`;
  return { baseUrl: base, token };
}

async function fetchJson(url, { method = 'GET', token = null, timeoutMs = PROBE_TIMEOUT_MS, body = null } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(url, {
      method, headers, signal: controller.signal,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json().catch(() => ({}));
    return { status: response.status, data };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 从配对 URL 配对：兑换会话 → 握手 → 落盘。
 * BLOCK-88 P1（D2）：identity（本机工程师署名，displayName/device）additive
 * 随兑换请求发往对端——对端落其 gateway 会话（面板「协作成员」展示），本端
 * 存 peer.identity（面板节点行展示「以 X 署名连接」）。
 * 返回 { ok, peer } 或 { ok:false, error, message }。
 */
async function addPeerFromPairingUrl(dataDir, rawUrl, { expectedProtocol = 1, identity = null } = {}) {
  const parsed = parsePairingUrl(rawUrl);
  if (!parsed) {
    return { ok: false, error: 'pairing_url_invalid', message: '配对链接无法解析（应形如 http://192.168.x.x:3005/pair?token=…）' };
  }
  const { baseUrl, token } = parsed;
  const cleanIdentity = sanitizeEngineerIdentity(identity);

  const pair = await fetchJson(`${baseUrl}/m/api/pair`, {
    method: 'POST',
    body: cleanIdentity ? { token, identity: cleanIdentity } : { token },
  });
  if (pair.status !== 200 || !pair.data?.ok || !pair.data?.sessionToken) {
    return { ok: false, error: 'pair_rejected', message: '配对码无效或已过期，请在对端格物重新生成' };
  }
  const sessionToken = pair.data.sessionToken;

  const health = await fetchJson(`${baseUrl}/federation/api/health`, { token: sessionToken });
  if (health.status !== 200 || !health.data?.ok) {
    return { ok: false, error: 'federation_handshake_failed', message: '对端不是支持联邦协议的格物（或版本过低），请更新对端后重试' };
  }
  if ((health.data.protocol || 1) > expectedProtocol) {
    return { ok: false, error: 'protocol_mismatch', message: `对端联邦协议版本更新（${health.data.protocol} > ${expectedProtocol}），请先更新本端` };
  }

  const node = health.data.node || {};
  const data = loadPeers(dataDir);
  // 同 baseUrl 幂等 upsert（重配对直接换 token）
  const existing = data.peers.find((entry) => entry.baseUrl === baseUrl);
  const now = new Date().toISOString();
  if (existing) {
    existing.name = node.name || existing.name;
    existing.platform = node.platform || existing.platform;
    existing.arch = node.arch || existing.arch;
    existing.petriVersion = health.data.petriVersion || existing.petriVersion;
    existing.executors = health.data.executors || existing.executors;
    existing.sessionToken = sessionToken;
    if (cleanIdentity) existing.identity = cleanIdentity;
    existing.lastSeenAt = now;
    existing.lastProbe = { ok: true, at: now, latencyMs: null, error: null };
  } else {
    data.peers.push({
      peerId: peerId(),
      name: node.name || baseUrl,
      baseUrl,
      platform: node.platform || null,
      arch: node.arch || null,
      petriVersion: health.data.petriVersion || null,
      executors: health.data.executors || null,
      protocol: health.data.protocol || 1,
      sessionToken,
      ...(cleanIdentity ? { identity: cleanIdentity } : {}),
      addedAt: now,
      lastSeenAt: now,
      lastProbe: { ok: true, at: now, latencyMs: null, error: null },
    });
  }
  persistPeers(dataDir, data);
  return { ok: true, peer: sanitizePeers(dataDir).peers.find((entry) => entry.baseUrl === baseUrl) };
}

/** 探测节点在线（刷新 lastProbe）。 */
async function probePeer(dataDir, peerIdValue) {
  const data = loadPeers(dataDir);
  const peer = data.peers.find((entry) => entry.peerId === peerIdValue);
  if (!peer) return { ok: false, error: 'peer_not_found' };
  const startedAt = Date.now();
  try {
    const health = await fetchJson(`${peer.baseUrl}/federation/api/health`, { token: peer.sessionToken });
    const now = new Date().toISOString();
    if (health.status === 200 && health.data?.ok) {
      peer.lastSeenAt = now;
      peer.lastProbe = { ok: true, at: now, latencyMs: Date.now() - startedAt, error: null };
      persistPeers(dataDir, data);
      return { ok: true };
    }
    peer.lastProbe = { ok: false, at: now, latencyMs: null, error: `status_${health.status}` };
    persistPeers(dataDir, data);
    return { ok: false, error: `status_${health.status}` };
  } catch (error) {
    peer.lastProbe = { ok: false, at: new Date().toISOString(), latencyMs: null, error: error.name === 'AbortError' ? 'timeout' : (error.message || 'network') };
    persistPeers(dataDir, data);
    return { ok: false, error: peer.lastProbe.error };
  }
}

function removePeer(dataDir, peerIdValue) {
  const data = loadPeers(dataDir);
  const next = data.peers.filter((entry) => entry.peerId !== peerIdValue);
  if (next.length === data.peers.length) return false;
  data.peers = next;
  persistPeers(dataDir, data);
  return true;
}

/** 安全投影：token 不出store（调用方需要 token 打对端时走 getPeerToken）。 */
function sanitizePeers(dataDir) {
  const data = loadPeers(dataDir);
  return {
    version: data.version,
    peers: data.peers.map((entry) => {
      const projection = {
        peerId: entry.peerId,
        name: entry.name,
        baseUrl: entry.baseUrl,
        platform: entry.platform,
        arch: entry.arch,
        petriVersion: entry.petriVersion,
        executors: entry.executors,
        protocol: entry.protocol,
        addedAt: entry.addedAt,
        lastSeenAt: entry.lastSeenAt,
        lastProbe: entry.lastProbe,
      };
      if (entry.identity) projection.identity = entry.identity;
      return projection;
    }),
  };
}

function getPeerToken(dataDir, peerIdValue) {
  const peer = loadPeers(dataDir).peers.find((entry) => entry.peerId === peerIdValue);
  return peer ? peer.sessionToken : null;
}

function getPeer(dataDir, peerIdValue) {
  return loadPeers(dataDir).peers.find((entry) => entry.peerId === peerIdValue) || null;
}

module.exports = {
  loadPeers,
  parsePairingUrl,
  addPeerFromPairingUrl,
  probePeer,
  removePeer,
  sanitizePeers,
  getPeerToken,
  getPeer,
};
