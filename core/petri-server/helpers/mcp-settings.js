/**
 * helpers/mcp-settings.js — MCP server 清单本地存储（桌面版）
 *
 * BLOCK-156 P2（D5 裁决）：独立 mcp-servers.json，复刻 ai-settings.json 的
 * 数据目录解析（PETRI_LOCAL_DATA_DIR 优先，回退 ~/Documents/Petri-Local）。
 *
 * 与 ai-settings 分文件的理由（D5）：结构异构（servers 数组 vs 扁平设置）、
 * 生命周期独立（连接状态是运行时态，不回写用户设置文件）。
 *
 * 文件形状：{ version: 1, servers: [{ id, command, args, env?, autoConnect? }] }
 * 注意：env 是明文透传给被连进程的环境变量（v1 不做密钥分离，登记在案）。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const schema = require('../../packages/shared-config/config-schema.js');
// BLOCK-160 W2 P4（CAP-2）— env 落盘加密（磁盘密文/内存明文；存量明文迁移）
const envCrypto = require('./mcp-env-crypto');

const SETTINGS_DIR = process.env.PETRI_LOCAL_DATA_DIR ||
  path.join(os.homedir(), 'Documents', 'Petri-Local');
const SETTINGS_FILE = path.join(SETTINGS_DIR, 'mcp-servers.json');

/**
 * BLOCK-203 W4a P5 — 形状与上限的真相在 shared-config 注册表（`mcp-servers` 族）：
 *  · 集合级上限（条目数）= 族声明 `maxItems`；
 *  · 条目级上限（args 条数）= 字段 `domain.maxItems`。
 * 本模块只保留"落点 + 语义关系（http 必带 url、env 密文"。
 */
const FAMILY = 'mcp-servers';
const MAX_SERVERS = schema.CONFIG_FAMILIES[FAMILY].maxItems;
const ARGS_ENTRY = schema.findItemFieldEntry(FAMILY, 'args');
const MAX_ARGS = ARGS_ENTRY.domain.maxItems;

/** 诊断 → BLOCK-156/160 既有错误码（路由与前端都认这些码，不换契约）。 */
function legacyErrorFor(diagnostics) {
  const has = (field) => diagnostics.some((d) => d.path === field);
  if (has('id')) return 'invalid_id';
  if (has('command')) return 'missing_command';
  if (has('args')) return 'too_many_args';
  if (diagnostics.some((d) => d.code === schema.DIAGNOSTIC_CODES.UNKNOWN_KEY)) return 'unknown_field';
  return 'invalid_entry';
}

function _ensureDir() {
  try {
    fs.mkdirSync(SETTINGS_DIR, { recursive: true });
  } catch {}
}

/** 校验并规范化单条 server 配置；非法返回 { error }（形状真相在注册表，语义关系留在这里）。 */
function normalizeServerEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return { error: 'server_entry_not_object' };
  // 先做现状就有的"清洗"（trim / 过滤空 arg / 只留字符串 env），再走注册表校验——
  // 顺序不能反：现状语义是"先清洗再判空"，反过来会把 `"  "` 判成 missing_command 而不是 trim 后通过。
  const source = {
    ...entry,
    ...(typeof entry.id === 'string' ? { id: entry.id.trim() } : {}),
    ...(typeof entry.command === 'string' ? { command: entry.command.trim() } : {}),
    ...(typeof entry.url === 'string' ? { url: entry.url.trim() } : {}),
    ...(entry.args !== undefined
      ? { args: Array.isArray(entry.args) ? entry.args.filter((a) => typeof a === 'string' && a.length > 0) : entry.args }
      : {}),
    ...(entry.env !== undefined
      ? {
          env: entry.env && typeof entry.env === 'object' && !Array.isArray(entry.env)
            ? Object.fromEntries(
                Object.entries(entry.env)
                  .filter(([, v]) => typeof v === 'string')
                  .map(([k, v]) => [String(k), String(v)]),
              )
            : entry.env,
        }
      : {}),
  };
  const { item, diagnostics } = schema.sanitizeItem(FAMILY, source);
  if (!item) return { error: 'server_entry_not_object' };
  if (diagnostics.length > 0) return { error: legacyErrorFor(diagnostics), diagnostics };
  // 必填关系（形状校验只校验"出现了的字段"，"必须出现"是关系，登记表表达不了）
  const missing = [];
  if (!item.id) missing.push({ code: schema.DIAGNOSTIC_CODES.TYPE_MISMATCH, path: 'id', family: FAMILY, message: '缺少必填字段 id' });
  if (!item.command) missing.push({ code: schema.DIAGNOSTIC_CODES.TYPE_MISMATCH, path: 'command', family: FAMILY, message: '缺少必填字段 command' });
  if (missing.length > 0) return { error: legacyErrorFor(missing), diagnostics: missing };
  // BLOCK-163 W3 P3（CAP-3）— 双传输：transport 缺省 stdio（零变化）；http 必带 url
  const transport = item.transport === 'http' ? 'http' : 'stdio';
  if (transport === 'http' && !item.url) return { error: 'http_url_required' };
  return {
    server: {
      id: item.id,
      command: item.command,
      args: item.args || [],
      env: item.env || {},
      autoConnect: item.autoConnect !== false,
      transport,
      ...(transport === 'http' ? { url: item.url } : {}),
    },
  };
}

/** 读取全部 server 配置（文件缺失/损坏=空清单，不抛）。 */
function listMcpServers() {
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    const servers = Array.isArray(raw.servers) ? raw.servers : [];
    const seen = new Set();
    const out = [];
    for (const entry of servers) {
      const { server } = normalizeServerEntry(entry);
      if (!server || seen.has(server.id)) continue; // 损坏/重复条目静默跳过（读取侧 fail-open）
      seen.add(server.id);
      // CAP-2 — env 密文还原明文（enc:v1: 前缀解密；明文透传=存量迁移）
      out.push({
        ...server,
        env: Object.fromEntries(
          Object.entries(server.env).map(([k, v]) => [k, envCrypto.decryptSecret(v)]),
        ),
      });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * 导出用清单：**主动剥离 env**。
 * 理由=D-2「凭据永不入快照/导出」——env 里装的就是第三方 MCP server 的 token；
 * 落盘时它已是密文，但把密文搬进"可分享的配置文件"仍是把用户凭据带出边界。
 * 导入侧按 id 保留原 env（见 config-transfer 的 writer），所以剥离不影响往返可用性。
 */
function listMcpServersForExport() {
  return listMcpServers().map(({ env: _env, ...rest }) => rest);
}

/** 整表保存（UI 侧编辑后整体回写）；任一条目非法=拒绝写入。 */
function saveMcpServers(servers) {
  if (!Array.isArray(servers)) return { error: 'servers_not_array' };
  if (servers.length > MAX_SERVERS) return { error: 'too_many_servers' };
  const seen = new Set();
  const normalized = [];
  for (const entry of servers) {
    const { server, error } = normalizeServerEntry(entry);
    if (error) return { error: `${error}:${entry && entry.id}` };
    if (seen.has(server.id)) return { error: `duplicate_id:${server.id}` };
    seen.add(server.id);
    normalized.push(server);
  }
  _ensureDir();
  // CAP-2 — env 落盘加密（normalized 的内存副本保持明文返回给调用方）
  const persisted = normalized.map((server) => ({
    ...server,
    env: Object.fromEntries(
      Object.entries(server.env).map(([k, v]) => [k, envCrypto.encryptSecret(v)]),
    ),
  }));
  const payload = { version: 1, savedAt: new Date().toISOString(), servers: persisted };
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  return { servers: normalized };
}

/** 单条新增/更新（按 id 覆盖）。 */
function upsertMcpServer(entry) {
  const { server, error } = normalizeServerEntry(entry);
  if (error) return { error };
  const next = listMcpServers().filter((s) => s.id !== server.id);
  next.push(server);
  const saved = saveMcpServers(next);
  return saved.error ? saved : { server };
}

/** 按 id 删除。 */
function removeMcpServer(id) {
  const before = listMcpServers();
  const next = before.filter((s) => s.id !== id);
  if (next.length === before.length) return { error: 'server_not_found' };
  const saved = saveMcpServers(next);
  return saved.error ? saved : { removed: id };
}

function getMcpServer(id) {
  return listMcpServers().find((s) => s.id === id) || null;
}

/** 测试钩子：重置模块态（无缓存态，占位以保持 API 对称）。 */
function _resetForTests() {
  // 无内存缓存（每次读盘）；保留钩子便于未来加缓存时测试复用
}

module.exports = {
  SETTINGS_FILE,
  MAX_SERVERS,
  MAX_ARGS,
  listMcpServers,
  listMcpServersForExport,
  saveMcpServers,
  upsertMcpServer,
  removeMcpServer,
  getMcpServer,
  normalizeServerEntry,
  _resetForTests,
};
