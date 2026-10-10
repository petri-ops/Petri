/**
 * helpers/mcp-settings.js — MCP server 清单本地存储（桌面版）
 *
 * BLOCK-156 P2（D5 裁决）：独立 mcp-servers.json，复刻 ai-settings.json 的
 * 数据目录解析（BIOF3_LOCAL_DATA_DIR 优先，回退 ~/Documents/BioF3-Local）。
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
// BLOCK-160 W2 P4（CAP-2）— env 落盘加密（磁盘密文/内存明文；存量明文迁移）
const envCrypto = require('./mcp-env-crypto');

const SETTINGS_DIR = process.env.BIOF3_LOCAL_DATA_DIR ||
  path.join(os.homedir(), 'Documents', 'BioF3-Local');
const SETTINGS_FILE = path.join(SETTINGS_DIR, 'mcp-servers.json');

const MAX_SERVERS = 50;
const MAX_ARGS = 64;

function _ensureDir() {
  try {
    fs.mkdirSync(SETTINGS_DIR, { recursive: true });
  } catch {}
}

/** 校验并规范化单条 server 配置；非法返回 { error }。 */
function normalizeServerEntry(entry) {
  if (!entry || typeof entry !== 'object') return { error: 'server_entry_not_object' };
  const id = typeof entry.id === 'string' ? entry.id.trim() : '';
  const command = typeof entry.command === 'string' ? entry.command.trim() : '';
  if (!id || /[\s/\\]/.test(id)) return { error: 'invalid_id' };
  if (!command) return { error: 'missing_command' };
  // BLOCK-163 W3 P3（CAP-3）— 双传输：transport 缺省 stdio（零变化）；http 必带 url
  const transport = entry.transport === 'http' ? 'http' : 'stdio';
  const url = typeof entry.url === 'string' ? entry.url.trim() : '';
  if (transport === 'http' && !/^https?:\/\//.test(url)) return { error: 'http_url_required' };
  const args = Array.isArray(entry.args)
    ? entry.args.filter((a) => typeof a === 'string' && a.length > 0)
    : [];
  if (args.length > MAX_ARGS) return { error: 'too_many_args' };
  const env = entry.env && typeof entry.env === 'object' && !Array.isArray(entry.env)
    ? Object.fromEntries(
        Object.entries(entry.env)
          .filter(([, v]) => typeof v === 'string')
          .map(([k, v]) => [String(k), String(v)]),
      )
    : {};
  const autoConnect = entry.autoConnect !== false;
  return { server: { id, command, args, env, autoConnect, transport, ...(transport === 'http' ? { url } : {}) } };
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
  listMcpServers,
  saveMcpServers,
  upsertMcpServer,
  removeMcpServer,
  getMcpServer,
  normalizeServerEntry,
  _resetForTests,
};
