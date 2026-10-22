/**
 * mcp/client-manager.js — MCP 客户端连接管理器（stdio）
 *
 * BLOCK-156 P2（D3 裁决：v1 仅 stdio）。应用作为 MCP client 连接第三方
 * MCP server（本地子进程），工具发现/调用供 P3 投影进 agent 工具集。
 *
 * 进程归属（架构裁决）：本管理器住在 petri-server 后端进程——MCP 连接必须
 * 与 agent 工具执行同进程（P3 callTool 进程内直达，零跨进程通道）。
 *
 * SDK ESM-only：CJS 侧动态 import()（先例 src/mcp-server.js:13-16）。
 * 全部 API 返回 { ok, error? } 形状不抛异常（R1 护栏：连接失败降级为
 * 状态错误，绝不阻塞内建工具注册或后端其它路径）。
 */

'use strict';

const crypto = require('node:crypto');
const settings = require('../helpers/mcp-settings');
const oauthProvider = require('./oauth-provider');
const oauthStore = require('../helpers/mcp-oauth-store');

const CONNECT_TIMEOUT_MS = 20_000;
const LIST_TOOLS_TIMEOUT_MS = 10_000;
const CALL_TOOL_TIMEOUT_MS = 60_000;

/** @type {Map<string, {
 *   status: 'connecting'|'connected'|'disconnected'|'error',
 *   tools: Array<object>, error: string|null, client: object|null, connectedAt: number|null,
 *   transport: 'stdio'|'http', lastErrorAt: number|null
 * }>} */
const _sessions = new Map();

/** 模块级 SDK 动态加载缓存（ESM 单例）。 */
let _sdkPromise = null;
async function _loadSdk() {
  if (!_sdkPromise) {
    _sdkPromise = (async () => {
      const [{ Client }, { StdioClientTransport }] = await Promise.all([
        import('@modelcontextprotocol/sdk/client/index.js'),
        import('@modelcontextprotocol/sdk/client/stdio.js'),
      ]);
      // BLOCK-163 W3 P3（CAP-3）— streamable HTTP 传输（SDK ≥1.x 内建，零新增依赖；
      // 加载失败不拖累 stdio——仅 http 传输按需 import）
      let StreamableHTTPClientTransport = null;
      try {
        ({ StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js'));
      } catch { /* 旧 SDK 无此传输：http 配置在 connect 时诚实报错 */ }
      // BLOCK-239 — 授权需求判定用 SDK 的 UnauthorizedError（缺失时回退消息匹配）
      let UnauthorizedError = null;
      try {
        ({ UnauthorizedError } = await import('@modelcontextprotocol/sdk/client/auth.js'));
      } catch { /* 旧 SDK 无 auth 模块 */ }
      return { Client, StdioClientTransport, StreamableHTTPClientTransport, UnauthorizedError };
    })().catch((e) => {
      _sdkPromise = null; // 失败不缓存——下次重试
      throw e;
    });
  }
  return _sdkPromise;
}

function _session(id) {
  if (!_sessions.has(id)) {
    _sessions.set(id, {
      status: 'disconnected', tools: [], error: null, client: null, connectedAt: null,
      transport: 'stdio', lastErrorAt: null, authStartedAt: null,
    });
  }
  return _sessions.get(id);
}

function _withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label}_timeout_${ms}ms`)), ms)),
  ]);
}

/** 连接一个 server（按 settings 内配置）。 */
async function connectServer(id) {
  const cfg = settings.getMcpServer(id);
  if (!cfg) return { ok: false, error: 'server_not_found' };
  const sess = _session(id);
  if (sess.status === 'connected') return { ok: true, alreadyConnected: true };
  if (sess.status === 'connecting') return { ok: false, error: 'connect_in_progress' };

  // 已有半死连接先收尾
  await _closeQuietly(id);

  sess.status = 'connecting';
  sess.error = null;
  let UnauthorizedError = null;
  try {
    const sdk = await _loadSdk();
    UnauthorizedError = sdk.UnauthorizedError;
    const { Client, StdioClientTransport, StreamableHTTPClientTransport } = sdk;
    const client = new Client({ name: 'petri-desktop', version: '0.1.0' }, {
      capabilities: {},
    });
    // BLOCK-163 W3 P3（CAP-3）— 双传输：transport==='http' 走 StreamableHTTP
    //（配置 url）；缺省 stdio 子进程（语义零变化）。
    let transport;
    if (cfg.transport === 'http') {
      if (!StreamableHTTPClientTransport) {
        throw new Error('http_transport_unavailable_in_sdk');
      }
      if (!cfg.url || !/^https?:\/\//.test(cfg.url)) {
        throw new Error('http_url_required');
      }
      // BLOCK-239 — 有 token 才挂 provider（刷新/复用）；无 token 不自动生成
      // 授权 URL，避免启动 autoConnect 时为所有未授权 server 造 pending 状态。
      const useAuth = oauthStore.hasTokens(id);
      transport = new StreamableHTTPClientTransport(
        new URL(cfg.url),
        useAuth ? { authProvider: oauthProvider.createOAuthProvider(id) } : undefined,
      );
    } else {
      transport = new StdioClientTransport({
        command: cfg.command,
        args: cfg.args || [],
        env: { ...process.env, ...(cfg.env || {}) },
      });
    }
    await _withTimeout(client.connect(transport), CONNECT_TIMEOUT_MS, 'connect');
    sess.client = client;
    sess.transport = cfg.transport === 'http' ? 'http' : 'stdio';
    sess.status = 'connected';
    sess.connectedAt = Date.now();
    // 连接即拉一次工具清单（货架预览 + P3 投影数据源）
    const listResult = await _withTimeout(client.listTools(), LIST_TOOLS_TIMEOUT_MS, 'list_tools')
      .catch((e) => {
        sess.error = `list_tools_failed: ${e.message}`;
        return null;
      });
    sess.tools = Array.isArray(listResult && listResult.tools) ? listResult.tools : [];
    return { ok: true, toolCount: sess.tools.length };
  } catch (e) {
    const authRequired = isAuthRequired(e, UnauthorizedError);
    sess.status = authRequired ? 'auth_required' : 'error';
    sess.error = authRequired
      ? 'authorization_required'
      : (e && e.message ? String(e.message) : String(e));
    sess.lastErrorAt = Date.now();
    sess.client = null;
    sess.authStartedAt = null;
    return { ok: false, error: authRequired ? 'authorization_required' : sess.error };
  }
}

function isAuthRequired(error, UnauthorizedErrorClass) {
  if (UnauthorizedErrorClass && error instanceof UnauthorizedErrorClass) return true;
  if (error && error.name === 'UnauthorizedError') return true;
  const message = String((error && error.message) || error || '');
  return /unauthorized|missing authorization|invalid_token|\b401\b/i.test(message);
}

function safeStateEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

/**
 * BLOCK-239 — 开始 OAuth 授权。返回 redirect（含 authorizationUrl）或 connected。
 * 不自己打开浏览器；由路由把 URL 交给 UI。
 */
async function beginAuthorization(id, options = {}) {
  const cfg = settings.getMcpServer(id);
  if (!cfg) return { ok: false, error: 'server_not_found' };
  if (cfg.transport !== 'http') return { ok: false, error: 'oauth_requires_http' };
  const sess = _session(id);
  if (sess.status === 'connected') return { ok: true, status: 'connected', toolCount: sess.tools.length };

  await _closeQuietly(id);
  sess.status = 'authorizing';
  sess.error = null;
  sess.authStartedAt = Date.now();

  let client = null;
  let UnauthorizedError = null;
  try {
    const sdk = await _loadSdk();
    UnauthorizedError = sdk.UnauthorizedError;
    const { Client, StreamableHTTPClientTransport } = sdk;
    if (!StreamableHTTPClientTransport) throw new Error('http_transport_unavailable_in_sdk');
    const provider = oauthProvider.createOAuthProvider(id, { redirectBase: options.redirectBase });
    client = new Client({ name: 'petri-desktop', version: '0.1.0' }, { capabilities: {} });
    const transport = new StreamableHTTPClientTransport(new URL(cfg.url), { authProvider: provider });
    await _withTimeout(client.connect(transport), CONNECT_TIMEOUT_MS, 'connect');
    sess.client = client;
    sess.transport = 'http';
    sess.status = 'connected';
    sess.connectedAt = Date.now();
    sess.authStartedAt = null;
    const listResult = await _withTimeout(client.listTools(), LIST_TOOLS_TIMEOUT_MS, 'list_tools')
      .catch((e) => {
        sess.error = `list_tools_failed: ${e.message}`;
        return null;
      });
    sess.tools = Array.isArray(listResult && listResult.tools) ? listResult.tools : [];
    return { ok: true, status: 'connected', toolCount: sess.tools.length };
  } catch (e) {
    const authRequired = isAuthRequired(e, UnauthorizedError);
    const authorizationUrl = authRequired ? oauthProvider.authorizationUrlFor(id) : null;
    if (client) {
      try { await client.close(); } catch { /* 部分连接关闭失败不掩盖主错误 */ }
    }
    if (authRequired && authorizationUrl) {
      sess.status = 'authorizing';
      sess.error = null;
      sess.client = null;
      return { ok: true, status: 'redirect', authorizationUrl };
    }
    sess.status = 'error';
    sess.error = authRequired
      ? 'authorization_url_missing'
      : (e && e.message ? String(e.message) : String(e));
    sess.lastErrorAt = Date.now();
    sess.authStartedAt = null;
    return { ok: false, error: sess.error };
  }
}

/**
 * BLOCK-239 — 回调完成授权：校验 state → finishAuth（SDK 换 token 并 saveTokens）
 * → 重连。失败只返回可读错误码，不把 code/token 写日志。
 */
async function completeAuthorization(id, code, state) {
  const cfg = settings.getMcpServer(id);
  if (!cfg) return { ok: false, error: 'server_not_found' };
  const pending = oauthProvider.pendingFor(id);
  const sess = _session(id);
  if (!pending) {
    sess.status = 'error';
    sess.error = 'authorization_pending_missing';
    return { ok: false, error: sess.error };
  }
  if (!safeStateEqual(pending.state, state)) {
    sess.status = 'error';
    sess.error = 'authorization_state_invalid';
    return { ok: false, error: sess.error };
  }

  let transport = null;
  try {
    const { StreamableHTTPClientTransport } = await _loadSdk();
    if (!StreamableHTTPClientTransport) throw new Error('http_transport_unavailable_in_sdk');
    const provider = oauthProvider.createOAuthProvider(id, { redirectBase: pending.redirectBase });
    transport = new StreamableHTTPClientTransport(new URL(cfg.url), { authProvider: provider });
    await _withTimeout(transport.finishAuth(String(code)), CONNECT_TIMEOUT_MS, 'finish_auth');
  } catch {
    if (transport) {
      try { await transport.close(); } catch { /* already closed */ }
    }
    sess.status = 'error';
    sess.error = 'authorization_exchange_failed';
    sess.lastErrorAt = Date.now();
    return { ok: false, error: sess.error };
  }
  try { await transport.close(); } catch { /* already closed */ }
  oauthStore.clearPending(id);
  const conn = await connectServer(id);
  if (!conn.ok) return conn;
  return { ok: true, toolCount: conn.toolCount };
}

async function _closeQuietly(id) {
  const sess = _sessions.get(id);
  if (sess && sess.client) {
    try {
      await sess.client.close();
    } catch { /* 对端已死等场景静默 */ }
  }
  if (sess) {
    sess.client = null;
  }
}

/** 断开一个 server。 */
async function disconnectServer(id) {
  if (!_sessions.has(id)) return { ok: false, error: 'server_not_connected' };
  await _closeQuietly(id);
  const sess = _session(id);
  sess.status = 'disconnected';
  sess.tools = [];
  sess.error = null;
  sess.connectedAt = null;
  sess.authStartedAt = null;
  return { ok: true };
}

/** 调用某 server 的工具（P3 投影 handler 的执行通道）。 */
async function callServerTool(id, toolName, args = {}, options = {}) {
  const sess = _sessions.get(id);
  if (!sess || sess.status !== 'connected' || !sess.client) {
    return { ok: false, error: 'server_not_connected' };
  }
  // BLOCK-204（W5）— 逐工具超时（不传=既有 60s 常量，行为不变）
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs
    : CALL_TOOL_TIMEOUT_MS;
  try {
    const result = await _withTimeout(
      sess.client.callTool({ name: toolName, arguments: args ?? {} }),
      timeoutMs,
      'call_tool',
    );
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: e && e.message ? String(e.message) : String(e) };
  }
}

/** 已连接 server 的工具清单。 */
function listServerTools(id) {
  const sess = _sessions.get(id);
  if (!sess || sess.status !== 'connected') return { ok: false, error: 'server_not_connected', tools: [] };
  return { ok: true, tools: sess.tools };
}

/** 全量状态视图（settings ∪ 运行态；无配置引用的孤儿会话也如实透出）。 */
function getStatuses() {
  const configured = settings.listMcpServers();
  const rows = configured.map((cfg) => {
    const sess = _sessions.get(cfg.id);
    // BLOCK-221（Q8）— 凭据脱敏：env 值是第三方 server 的 token（落盘密文、读侧已还原明文），
    // 绝不随状态面出 HTTP。只透键名与数量，够前端解释「这台配了 2 个环境变量」。
    const { env, ...rest } = cfg;
    const auth = cfg.transport === 'http'
      ? (oauthStore.hasTokens(cfg.id) ? 'authorized'
        : (sess && (sess.status === 'auth_required' || sess.status === 'authorizing')) ? 'required'
          : 'unknown')
      : null;
    return {
      ...rest,
      envKeys: env ? Object.keys(env).sort() : [],
      envCount: env ? Object.keys(env).length : 0,
      status: sess ? sess.status : 'disconnected',
      error: sess ? sess.error : null,
      toolCount: sess ? sess.tools.length : 0,
      connectedAt: sess ? sess.connectedAt : null,
      // CAP-3 健康面：传输类型 + 最近错误时间戳透出。
      // BLOCK-239 — 未连接/授权失败时也要如实显示**配置的**传输；sess.transport
      // 在成功连接前仍是默认 stdio，不能拿它覆盖 http 配置。
      transport: cfg.transport === 'http' ? 'http' : (sess ? (sess.transport || 'stdio') : 'stdio'),
      lastErrorAt: sess ? sess.lastErrorAt : null,
      // BLOCK-239 — 只透授权状态，不出现 token/client_secret
      ...(auth ? { auth } : {}),
    };
  });
  return rows;
}

/** 连接全部 autoConnect=true 的 server（fire-and-forget，永不抛）。 */
async function autoConnectConfigured() {
  for (const cfg of settings.listMcpServers()) {
    if (cfg.autoConnect === false) continue;
    void connectServer(cfg.id).catch(() => { /* connectServer 自带降级 */ });
  }
}

/** 进程退出前收尾（best-effort）。 */
async function closeAll() {
  for (const id of Array.from(_sessions.keys())) {
    await _closeQuietly(id);
    _sessions.get(id).status = 'disconnected';
  }
}

/** 测试钩子。 */
function _resetForTests() {
  _sessions.clear();
  _sdkPromise = null;
}

module.exports = {
  connectServer,
  beginAuthorization,
  completeAuthorization,
  disconnectServer,
  callServerTool,
  listServerTools,
  getStatuses,
  autoConnectConfigured,
  closeAll,
  _resetForTests,
};
