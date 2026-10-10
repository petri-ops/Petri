/**
 * mcp/client-manager.js — MCP 客户端连接管理器（stdio）
 *
 * BLOCK-156 P2（D3 裁决：v1 仅 stdio）。应用作为 MCP client 连接第三方
 * MCP server（本地子进程），工具发现/调用供 P3 投影进 agent 工具集。
 *
 * 进程归属（架构裁决）：本管理器住在 biof3-server 后端进程——MCP 连接必须
 * 与 agent 工具执行同进程（P3 callTool 进程内直达，零跨进程通道）。
 *
 * SDK ESM-only：CJS 侧动态 import()（先例 src/mcp-server.js:13-16）。
 * 全部 API 返回 { ok, error? } 形状不抛异常（R1 护栏：连接失败降级为
 * 状态错误，绝不阻塞内建工具注册或后端其它路径）。
 */

'use strict';

const settings = require('../helpers/mcp-settings');

const CONNECT_TIMEOUT_MS = 20_000;
const LIST_TOOLS_TIMEOUT_MS = 10_000;
const CALL_TOOL_TIMEOUT_MS = 60_000;

/** @type {Map<string, {
 *   status: 'connecting'|'connected'|'disconnected'|'error',
 *   tools: Array<object>, error: string|null, client: object|null, connectedAt: number|null
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
      return { Client, StdioClientTransport };
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
  try {
    const { Client, StdioClientTransport } = await _loadSdk();
    const client = new Client({ name: 'gewu-desktop', version: '0.1.0' }, {
      capabilities: {},
    });
    const transport = new StdioClientTransport({
      command: cfg.command,
      args: cfg.args || [],
      env: { ...process.env, ...(cfg.env || {}) },
    });
    await _withTimeout(client.connect(transport), CONNECT_TIMEOUT_MS, 'connect');
    sess.client = client;
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
    sess.status = 'error';
    sess.error = e && e.message ? String(e.message) : String(e);
    sess.client = null;
    return { ok: false, error: sess.error };
  }
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
  return { ok: true };
}

/** 调用某 server 的工具（P3 投影 handler 的执行通道）。 */
async function callServerTool(id, toolName, args = {}) {
  const sess = _sessions.get(id);
  if (!sess || sess.status !== 'connected' || !sess.client) {
    return { ok: false, error: 'server_not_connected' };
  }
  try {
    const result = await _withTimeout(
      sess.client.callTool({ name: toolName, arguments: args ?? {} }),
      CALL_TOOL_TIMEOUT_MS,
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
    return {
      ...cfg,
      status: sess ? sess.status : 'disconnected',
      error: sess ? sess.error : null,
      toolCount: sess ? sess.tools.length : 0,
      connectedAt: sess ? sess.connectedAt : null,
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
  disconnectServer,
  callServerTool,
  listServerTools,
  getStatuses,
  autoConnectConfigured,
  closeAll,
  _resetForTests,
};
