'use strict';

/**
 * BLOCK-70 mobile-gateway — pairing tokens & device sessions.
 *
 * 一次性配对 token（内存，单次使用，短时效）→ 持久会话 token（文件制，
 * 只存 sha256；对标 packs/installed.json 文件制先例）。
 *
 * 单一真相：全部经 getStores(dataDir) 单例共享（gateway 与 mobile-admin 路由
 * 同进程同数据）；DB 零新业务表（D3 红线）。
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const PAIR_TOKEN_TTL_MS = 5 * 60 * 1000;
const SESSIONS_VERSION = 1;

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function randomToken() {
  return crypto.randomBytes(32).toString('hex');
}

const storesByDataDir = new Map();

/**
 * 进程级单例：同一 dataDir 的 gateway 与 admin 路由共享同一份内存配对表
 * 与同一个会话文件视图。
 */
function getStores(dataDir, { now = () => Date.now() } = {}) {
  const key = path.resolve(dataDir);
  let stores = storesByDataDir.get(key);
  if (!stores) {
    stores = {
      pairing: createPairingStore({ now }),
      sessions: createSessionStore({ dataDir: key, now }),
    };
    storesByDataDir.set(key, stores);
  }
  return stores;
}

function resetStoresForTest() {
  storesByDataDir.clear();
}

/**
 * 一次性配对 token：内存持有 hash，5 分钟 TTL，单次 redeem。
 */
function createPairingStore({ now = () => Date.now() } = {}) {
  const pending = new Map(); // tokenHash -> { expiresAt }

  function issue() {
    const token = randomToken();
    const expiresAt = now() + PAIR_TOKEN_TTL_MS;
    pending.set(sha256(token), { expiresAt });
    // 顺带清掉已过期项，避免长期运行内存缓涨。
    for (const [hash, entry] of pending) {
      if (entry.expiresAt <= now()) pending.delete(hash);
    }
    return { token, expiresAt };
  }

  /** 有效返回 { used:true }；无效/过期/已用返回 null。 */
  function redeem(token) {
    if (!token || typeof token !== 'string') return null;
    const hash = sha256(token);
    const entry = pending.get(hash);
    if (!entry) return null;
    pending.delete(hash); // 单次使用：无论是否过期都立即作废
    if (entry.expiresAt <= now()) return null;
    return { used: true };
  }

  function pendingCount() {
    return pending.size;
  }

  return { issue, redeem, pendingCount };
}

/**
 * 设备会话：持久化 <dataDir>/mobile/sessions.json，只存 token hash。
 */
function createSessionStore({ dataDir, now = () => Date.now(), persistDebounceMs = 30_000 } = {}) {
  const sessionsPath = path.join(dataDir, 'mobile', 'sessions.json');
  let cache = null;
  let persistTimer = null;

  function load() {
    if (cache) return cache;
    try {
      const raw = JSON.parse(fs.readFileSync(sessionsPath, 'utf8'));
      cache = {
        version: SESSIONS_VERSION,
        sessions: Array.isArray(raw.sessions) ? raw.sessions : [],
      };
    } catch {
      cache = { version: SESSIONS_VERSION, sessions: [] };
    }
    return cache;
  }

  function persist() {
    const data = load();
    fs.mkdirSync(path.dirname(sessionsPath), { recursive: true });
    const tmp = `${sessionsPath}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    fs.renameSync(tmp, sessionsPath);
  }

  /**
   * BLOCK-87 实测性能修复：authenticate 原来每个请求都 persist()——手机加载
   * 一个页面要过数百个请求（模块/资产也过会话门），每个都全量序列化 + 双同步
   * 写盘，网关事件循环被磁盘刷满（用户实测「点击频繁时刷新很慢」的根因）。
   * lastSeenAt 是装饰性元数据：内存即时更新，落盘按 debounce 合并；
   * 安全相关写（创建/吊销）仍立即同步落盘。进程退出丢窗口内的 lastSeenAt
   * 更新可接受。
   */
  function persistSoon() {
    if (persistTimer) return;
    persistTimer = setTimeout(() => {
      persistTimer = null;
      try {
        persist();
      } catch {
        // 下一次脏标记再试（装饰性元数据，fail-open）
      }
    }, persistDebounceMs);
    persistTimer.unref?.();
  }

  /**
   * 创建会话；sessionToken 只在返回值里出现一次，落盘只有 sha256。
   */
  function createSession({ name } = {}) {
    const data = load();
    const sessionToken = randomToken();
    const session = {
      id: `mdev_${crypto.randomBytes(8).toString('hex')}`,
      name: String(name || '手机设备').slice(0, 60),
      tokenHash: sha256(sessionToken),
      createdAt: new Date(now()).toISOString(),
      lastSeenAt: new Date(now()).toISOString(),
      revoked: false,
    };
    data.sessions.push(session);
    persist();
    return { sessionId: session.id, sessionToken };
  }

  /** Bearer/查询参数会话 token → 会话；无效或已吊销返回 null。 */
  function authenticate(token) {
    if (!token || typeof token !== 'string') return null;
    const hash = sha256(token);
    const session = load().sessions.find((entry) => entry.tokenHash === hash);
    if (!session || session.revoked) return null;
    session.lastSeenAt = new Date(now()).toISOString();
    persistSoon();
    return session;
  }

  function revoke(sessionId) {
    const data = load();
    const session = data.sessions.find((entry) => entry.id === sessionId);
    if (!session) return false;
    session.revoked = true;
    persist();
    return true;
  }

  /** 安全投影：绝不外泄 tokenHash。 */
  function list() {
    return load().sessions.map(({ id, name, createdAt, lastSeenAt, revoked }) => ({
      id, name, createdAt, lastSeenAt, revoked,
    }));
  }

  return { createSession, authenticate, revoke, list, sessionsPath };
}

module.exports = {
  PAIR_TOKEN_TTL_MS,
  getStores,
  resetStoresForTest,
  createPairingStore,
  createSessionStore,
  sha256,
};
