'use strict';

/**
 * install-deep-link-core.js — BLOCK-242 `petri-install://` 深链安装安全核心。
 *
 * electron-free：解析、守卫、预览、确认全部可单测；安装执行以依赖注入传入
 * （真实实现复用 pack-lifecycle / mcp-settings）。
 *
 * 支持两种 kind：
 *   petri-install://pack?manifest=<https-url>   领域包（manifest 声明 archive url/sha256/size）
 *   petri-install://mcp?config=<base64url-json> MCP 配置（id/transport/command/args/url；**禁 env**）
 *
 * 安全纪律：
 * - 预览零副作用（只读 manifest / 已装清单 / MCP 清单）；
 * - 默认只允许 https + 非私网（`PETRI_INSTALL_ALLOW_PRIVATE=1` 仅测试放行私网/loopback http）；
 * - manifest/配置/归档都有大小与超时上限；重定向逐跳复验；
 * - 确认时重新取 manifest 与预览快照对账（防 TOCTOU）；归档下载后复核 sha256/size；
 * - env 值不进链接（`env_not_allowed`）。
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCHEME = 'petri-install';
const KINDS = new Set(['pack', 'mcp']);
const MAX_MCP_CONFIG_BYTES = 16 * 1024;
const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;
const MAX_MCP_SERVERS = 20;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SHA256_RE = /^[a-f0-9]{64}$/;

function allowPrivate() {
  return process.env.PETRI_INSTALL_ALLOW_PRIVATE === '1';
}

function normalizeHostname(host) {
  return String(host || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
}

function isLoopbackHostname(host) {
  const h = normalizeHostname(host);
  return h === 'localhost' || h === '::1' || h === '0.0.0.0' || h.startsWith('127.');
}

function isPrivateHostname(host) {
  const h = normalizeHostname(host);
  if (!h) return true;
  if (isLoopbackHostname(h)) return true;
  if (h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (h.startsWith('10.') || h.startsWith('192.168.') || h.startsWith('169.254.')) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  return false;
}

function err(error, message, extra = {}) {
  return { ok: false, error, message, ...extra };
}

/** 远程 URL 守卫：https 优先；测试放行 loopback http；私网默认拒。 */
function validateRemoteUrl(raw, { what = 'url' } = {}) {
  let url;
  try {
    url = new URL(String(raw || ''));
  } catch {
    return err(`${what}_invalid`, `${what} 不是合法 URL。`);
  }
  if (String(raw).length > 2048) return err(`${what}_too_long`, `${what} 过长（>2048）。`);
  if (url.username || url.password) return err(`${what}_credentials`, `${what} 不得包含凭据。`);
  const host = normalizeHostname(url.hostname);
  const https = url.protocol === 'https:';
  const loopbackHttp = url.protocol === 'http:' && isLoopbackHostname(host);
  if (!https && !(loopbackHttp && allowPrivate())) {
    return err(`${what}_scheme_blocked`, `${what} 必须是 https（本地测试可显式放行 loopback http）。`);
  }
  if (isPrivateHostname(host) && !allowPrivate()) {
    return err(`${what}_private_host_blocked`, `${what} 指向私网/loopback 主机（默认拒绝）。`);
  }
  return { ok: true, url: url.toString(), host };
}

function decodeBase64Url(value) {
  const text = String(value || '').trim();
  if (!text || text.length > MAX_MCP_CONFIG_BYTES * 2) {
    return err('mcp_config_invalid', 'config 参数为空或过长。');
  }
  let buffer;
  try {
    const normalized = text.replace(/-/g, '+').replace(/_/g, '/');
    buffer = Buffer.from(normalized, 'base64');
  } catch {
    return err('mcp_config_invalid', 'config 不是合法 base64url。');
  }
  if (buffer.length === 0 || buffer.length > MAX_MCP_CONFIG_BYTES) {
    return err('mcp_config_too_large', `config 超过 ${MAX_MCP_CONFIG_BYTES} 字节。`);
  }
  return { ok: true, text: buffer.toString('utf8') };
}

function readBoundedString(value, limit, what) {
  if (typeof value !== 'string' || !value.trim()) return { ok: false, error: `${what}_required` };
  const text = value.trim();
  if (text.length > limit) return { ok: false, error: `${what}_too_long`, limit };
  return { ok: true, value: text };
}

/** MCP 配置校验/归一化（深链专用：env 一律拒绝）。 */
function validateMcpConfig(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return err('mcp_config_invalid', 'MCP 配置必须是对象。');
  }
  if (raw.env !== undefined) {
    return err('env_not_allowed', '深链安装链接不得携带 env 值（凭据请在设置中补充）。');
  }
  const id = readBoundedString(raw.id, 64, 'id');
  if (!id.ok || !ID_RE.test(id.value)) return err('id_invalid', 'MCP id 非法（字母数字开头，允许 ._-）。');
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 120) : null;
  const transport = raw.transport === 'http' ? 'http' : 'stdio';
  const server = { id: id.value, name: name || id.value, transport };
  if (transport === 'http') {
    const urlOk = validateRemoteUrl(raw.url, { what: 'mcp_url' });
    if (!urlOk.ok) return urlOk;
    server.url = urlOk.url;
  } else {
    const command = readBoundedString(raw.command, 512, 'command');
    if (!command.ok) return err('command_required', 'stdio MCP 配置必须带 command。');
    server.command = command.value;
    const args = Array.isArray(raw.args) ? raw.args : [];
    if (args.length > 20) return err('args_too_many', 'args 最多 20 条。');
    if (args.some((item) => typeof item !== 'string' || item.length > 200)) {
      return err('args_invalid', 'args 只能是最长 200 的字符串。');
    }
    server.args = args.map((item) => item);
  }
  return { ok: true, server };
}

function parseMcpConfigParam(param) {
  const decoded = decodeBase64Url(param);
  if (!decoded.ok) return decoded;
  let parsed;
  try {
    parsed = JSON.parse(decoded.text);
  } catch {
    return err('mcp_config_invalid', 'config 不是合法 JSON。');
  }
  return validateMcpConfig(parsed);
}

/** 解析 `petri-install://` 链接；不做任何网络请求。 */
function parseInstallDeepLink(raw) {
  let url;
  try {
    url = new URL(String(raw || '').trim());
  } catch {
    return err('link_invalid', '安装链接不是合法 URL。');
  }
  if (url.protocol !== `${SCHEME}:`) return err('link_scheme_blocked', `只接受 ${SCHEME}:// 链接。`);
  const kind = normalizeHostname(url.hostname || url.pathname.replace(/^\/+/, ''));
  if (!KINDS.has(kind)) return err('link_kind_unknown', '安装链接 kind 必须是 pack 或 mcp。');
  if (kind === 'pack') {
    const manifest = String(url.searchParams.get('manifest') || '').trim();
    if (!manifest) return err('manifest_required', 'pack 链接必须带 manifest 参数。');
    const valid = validateRemoteUrl(manifest, { what: 'manifest' });
    if (!valid.ok) return valid;
    return { ok: true, kind: 'pack', manifestUrl: valid.url, sourceHost: valid.host, link: String(raw).trim() };
  }
  const config = String(url.searchParams.get('config') || '');
  if (!config) return err('mcp_config_required', 'mcp 链接必须带 config 参数（base64url JSON）。');
  const server = parseMcpConfigParam(config);
  if (!server.ok) return server;
  return { ok: true, kind: 'mcp', server: server.server, link: String(raw).trim() };
}

/** manifest 中的 pack 声明校验/归一化。 */
function validatePackManifest(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return err('manifest_invalid', 'manifest 必须是对象。');
  }
  const packRaw = raw.pack;
  if (!packRaw || typeof packRaw !== 'object' || Array.isArray(packRaw)) {
    return err('manifest_pack_missing', 'manifest 缺少 pack 对象。');
  }
  const packId = readBoundedString(packRaw.packId, 64, 'packId');
  if (!packId.ok || !ID_RE.test(packId.value)) return err('pack_id_invalid', 'packId 非法。');
  const archiveRaw = packRaw.archive;
  if (!archiveRaw || typeof archiveRaw !== 'object' || Array.isArray(archiveRaw)) {
    return err('archive_missing', 'manifest 缺少 archive（下载地址/sha256）。');
  }
  const archiveUrl = validateRemoteUrl(archiveRaw.url, { what: 'archive_url' });
  if (!archiveUrl.ok) return archiveUrl;
  const sha256 = String(archiveRaw.sha256 || '').trim().toLowerCase();
  if (!SHA256_RE.test(sha256)) return err('sha256_invalid', 'archive.sha256 必须是 64 位小写 hex。');
  let sizeBytes = null;
  if (archiveRaw.sizeBytes !== undefined && archiveRaw.sizeBytes !== null) {
    const size = Number(archiveRaw.sizeBytes);
    if (!Number.isInteger(size) || size <= 0 || size > MAX_ARCHIVE_BYTES) {
      return err('size_invalid', `archive.sizeBytes 非法（1..${MAX_ARCHIVE_BYTES}）。`);
    }
    sizeBytes = size;
  }
  const name = typeof packRaw.name === 'string' ? packRaw.name.trim().slice(0, 120) : packId.value;
  const version = typeof packRaw.version === 'string' ? packRaw.version.trim().slice(0, 40) : null;
  const description = typeof packRaw.description === 'string' ? packRaw.description.trim().slice(0, 400) : null;
  const source = typeof packRaw.source === 'string' ? packRaw.source.trim().slice(0, 2048) : null;
  let mcpServers = [];
  if (packRaw.mcpServers !== undefined) {
    if (!Array.isArray(packRaw.mcpServers)) return err('mcp_servers_invalid', 'mcpServers 必须是数组。');
    if (packRaw.mcpServers.length > MAX_MCP_SERVERS) {
      return err('mcp_servers_too_many', `mcpServers 最多 ${MAX_MCP_SERVERS} 条。`);
    }
    for (const entry of packRaw.mcpServers) {
      const checked = validateMcpConfig(entry);
      if (!checked.ok) return checked;
      mcpServers.push(checked.server);
    }
  }
  return {
    ok: true,
    pack: {
      packId: packId.value,
      name,
      version,
      description,
      source,
      archive: { url: archiveUrl.url, sizeBytes, sha256 },
      mcpServers,
    },
  };
}

async function readBodyCapped(resp, maxBytes, what) {
  if (!resp.body || typeof resp.body.getReader !== 'function') {
    const text = await resp.text();
    if (Buffer.byteLength(text, 'utf8') > maxBytes) return err(`${what}_too_large`, `${what} 超过上限 ${maxBytes} 字节。`);
    return { ok: true, text };
  }
  const reader = resp.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      try { await reader.cancel(); } catch { /* ignore */ }
      return err(`${what}_too_large`, `${what} 超过上限 ${maxBytes} 字节。`);
    }
    chunks.push(Buffer.from(value));
  }
  return { ok: true, text: Buffer.concat(chunks).toString('utf8') };
}

/** 受控 JSON 拉取：逐跳重定向复验 + 超时 + 大小上限。 */
async function fetchJsonGuarded(rawUrl, { fetchImpl, maxBytes = MAX_MANIFEST_BYTES, what = 'manifest' } = {}) {
  const first = validateRemoteUrl(rawUrl, { what });
  if (!first.ok) return first;
  let current = first.url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let resp;
    try {
      resp = await fetchImpl(current, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { accept: 'application/json' },
      });
    } catch (error) {
      clearTimeout(timer);
      return err(`${what}_fetch_failed`, `拉取失败：${error && error.message ? error.message : error}`);
    }
    clearTimeout(timer);
    if ([301, 302, 303, 307, 308].includes(resp.status)) {
      const location = resp.headers.get('location');
      if (!location) return err(`${what}_redirect_invalid`, '重定向缺少 Location。');
      const next = new URL(location, current).toString();
      const checked = validateRemoteUrl(next, { what });
      if (!checked.ok) return checked;
      current = checked.url;
      continue;
    }
    if (!resp.ok) return err(`${what}_http_${resp.status}`, `${what} HTTP ${resp.status}。`);
    const declared = Number(resp.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) {
      return err(`${what}_too_large`, `${what} 超过上限 ${maxBytes} 字节。`);
    }
    const body = await readBodyCapped(resp, maxBytes, what);
    if (!body.ok) return body;
    try {
      return { ok: true, data: JSON.parse(body.text), url: current };
    } catch {
      return err(`${what}_invalid_json`, `${what} 不是合法 JSON。`);
    }
  }
  return err(`${what}_redirects_exhausted`, '重定向次数过多。');
}

/** 归档下载：逐跳复验 + 大小上限 + 流式 sha256。 */
async function downloadGuarded(rawUrl, destPath, { fetchImpl, maxBytes = MAX_ARCHIVE_BYTES } = {}) {
  const first = validateRemoteUrl(rawUrl, { what: 'archive_url' });
  if (!first.ok) return first;
  let current = first.url;
  let resp = null;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      resp = await fetchImpl(current, { redirect: 'manual', signal: controller.signal });
    } catch (error) {
      clearTimeout(timer);
      return err('archive_fetch_failed', `下载失败：${error && error.message ? error.message : error}`);
    }
    clearTimeout(timer);
    if ([301, 302, 303, 307, 308].includes(resp.status)) {
      const location = resp.headers.get('location');
      if (!location) return err('archive_redirect_invalid', '下载重定向缺少 Location。');
      const next = new URL(location, current).toString();
      const checked = validateRemoteUrl(next, { what: 'archive_url' });
      if (!checked.ok) return checked;
      current = checked.url;
      continue;
    }
    break;
  }
  if (!resp || !resp.ok) return err(`archive_http_${resp ? resp.status : 'none'}`, '归档下载失败。');
  const declared = Number(resp.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    return err('archive_too_large', `归档超过上限 ${maxBytes} 字节。`);
  }
  const hash = crypto.createHash('sha256');
  let size = 0;
  const fd = fs.openSync(destPath, 'w');
  try {
    if (!resp.body || typeof resp.body.getReader !== 'function') {
      const buffer = Buffer.from(await resp.arrayBuffer());
      if (buffer.byteLength > maxBytes) throw Object.assign(new Error('archive_too_large'), { code: 'archive_too_large' });
      fs.writeSync(fd, buffer);
      hash.update(buffer);
      size = buffer.byteLength;
    } else {
      const reader = resp.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
          try { await reader.cancel(); } catch { /* ignore */ }
          throw Object.assign(new Error('archive_too_large'), { code: 'archive_too_large' });
        }
        const chunk = Buffer.from(value);
        fs.writeSync(fd, chunk);
        hash.update(chunk);
      }
    }
  } catch (error) {
    try { fs.closeSync(fd); } catch { /* ignore */ }
    try { fs.unlinkSync(destPath); } catch { /* ignore */ }
    const code = error && error.code === 'archive_too_large' ? 'archive_too_large' : 'archive_write_failed';
    return err(code, `归档下载失败：${error && error.message ? error.message : error}`);
  }
  fs.closeSync(fd);
  return { ok: true, size, sha256: hash.digest('hex') };
}

function riskFor({ reasons, level = 'caution' }) {
  return { level, reasons: [...new Set(reasons)] };
}

function unique(list) {
  return [...new Set((list || []).filter(Boolean))];
}

/**
 * 预览（零副作用）：只读 manifest/已装包/MCP 清单。
 * @returns {Promise<{ok:true, preview:object}|{ok:false,error:string,message:string}>}
 */
async function previewFromLink(raw, { fetchImpl, listInstalledPacks, listMcpServers } = {}) {
  const parsed = parseInstallDeepLink(raw);
  if (!parsed.ok) return parsed;
  const installedPacks = typeof listInstalledPacks === 'function' ? (await listInstalledPacks()) || [] : [];
  const installedIds = new Set(installedPacks.map((pack) => pack.packId));
  const mcpIds = new Set(
    (typeof listMcpServers === 'function' ? (await listMcpServers()) || [] : []).map((server) => server.id),
  );

  if (parsed.kind === 'mcp') {
    const replacesMcp = mcpIds.has(parsed.server.id);
    const reasons = unique([
      'unverified_source',
      replacesMcp ? `replaces_mcp:${parsed.server.id}` : null,
    ]);
    return {
      ok: true,
      preview: {
        kind: 'mcp',
        link: parsed.link,
        server: parsed.server,
        source: { host: null, url: null },
        risk: riskFor({ reasons }),
        requiresReplace: { pack: false, mcp: replacesMcp ? [parsed.server.id] : [] },
      },
    };
  }

  const fetched = await fetchJsonGuarded(parsed.manifestUrl, { fetchImpl, maxBytes: MAX_MANIFEST_BYTES, what: 'manifest' });
  if (!fetched.ok) return fetched;
  const manifest = validatePackManifest(fetched.data);
  if (!manifest.ok) return manifest;
  const pack = manifest.pack;
  const replacesPack = installedIds.has(pack.packId);
  const mcpCollisions = pack.mcpServers.map((server) => server.id).filter((id) => mcpIds.has(id));
  const reasons = unique([
    'unverified_source',
    pack.archive.sizeBytes ? null : 'no_size_declared',
    pack.mcpServers.length > 0 ? 'installs_mcp_servers' : null,
    replacesPack ? `replaces_pack:${pack.packId}` : null,
    ...mcpCollisions.map((id) => `replaces_mcp:${id}`),
    isLoopbackHostname(parsed.sourceHost) ? 'test_loopback_source' : null,
  ]);
  return {
    ok: true,
    preview: {
      kind: 'pack',
      link: parsed.link,
      source: { host: parsed.sourceHost, url: parsed.manifestUrl },
      pack,
      risk: riskFor({ reasons }),
      requiresReplace: { pack: replacesPack, mcp: mcpCollisions },
    },
  };
}

/**
 * 确认安装：重取 manifest 对账 → 下载校验 → 解压 → 注入式安装 → MCP upsert。
 * @param {object} deps { fetchImpl, extractZip, installPackDir, upsertMcpServer, listMcpServers, tempRoot }
 */
async function confirmInstall(raw, options = {}) {
  const {
    expected = null,
    allowReplaceMcp = false,
    fetchImpl,
    extractZip,
    installPackDir,
    upsertMcpServer,
    listMcpServers,
    tempRoot,
  } = options;
  const parsed = parseInstallDeepLink(raw);
  if (!parsed.ok) return parsed;

  const currentMcpIds = new Set(
    (typeof listMcpServers === 'function' ? (await listMcpServers()) || [] : []).map((server) => server.id),
  );

  if (parsed.kind === 'mcp') {
    const replaces = currentMcpIds.has(parsed.server.id);
    if (replaces && !allowReplaceMcp) {
      return err('mcp_replace_not_allowed', `已存在 MCP server ${parsed.server.id}；如需替换请显式勾选。`);
    }
    if (typeof upsertMcpServer !== 'function') return err('mcp_install_unavailable', 'MCP 安装通道不可用。');
    const saved = await upsertMcpServer(parsed.server);
    if (!saved || saved.error) {
      return err('mcp_install_failed', `MCP 安装失败：${(saved && saved.error) || 'unknown'}`);
    }
    return { ok: true, kind: 'mcp', serverId: parsed.server.id, replaced: replaces };
  }

  if (!expected || typeof expected !== 'object') {
    return err('expected_required', '确认安装必须带预览快照。');
  }
  const fetched = await fetchJsonGuarded(parsed.manifestUrl, { fetchImpl, maxBytes: MAX_MANIFEST_BYTES, what: 'manifest' });
  if (!fetched.ok) return fetched;
  const manifest = validatePackManifest(fetched.data);
  if (!manifest.ok) return manifest;
  const pack = manifest.pack;
  const expectedArchive = expected.archive || {};
  if (
    pack.archive.url !== expectedArchive.url
    || pack.archive.sha256 !== String(expectedArchive.sha256 || '').toLowerCase()
    || (expectedArchive.sizeBytes !== undefined && expectedArchive.sizeBytes !== null
      && pack.archive.sizeBytes !== expectedArchive.sizeBytes)
  ) {
    return err('manifest_changed', 'manifest 与预览时不一致（下载地址/大小/SHA-256 已变化），请重新预览。');
  }
  const mcpCollisions = pack.mcpServers.map((server) => server.id).filter((id) => currentMcpIds.has(id));
  if (mcpCollisions.length > 0 && !allowReplaceMcp) {
    return err('mcp_replace_not_allowed', `将替换已配置 MCP：${mcpCollisions.join(', ')}；如需替换请显式勾选。`);
  }

  const tmpDir = fs.mkdtempSync(path.join(tempRoot || os.tmpdir(), 'petri-install-'));
  const zipPath = path.join(tmpDir, 'pack.zip');
  const packRoot = path.join(tmpDir, 'pack');
  try {
    const downloaded = await downloadGuarded(pack.archive.url, zipPath, { fetchImpl, maxBytes: MAX_ARCHIVE_BYTES });
    if (!downloaded.ok) return downloaded;
    if (downloaded.sha256 !== pack.archive.sha256) {
      return err('checksum_mismatch', `SHA-256 不匹配（期望 ${pack.archive.sha256.slice(0, 12)}…，实际 ${downloaded.sha256.slice(0, 12)}…）。`);
    }
    if (pack.archive.sizeBytes && downloaded.size !== pack.archive.sizeBytes) {
      return err('size_mismatch', `大小不匹配（期望 ${pack.archive.sizeBytes}，实际 ${downloaded.size}）。`);
    }
    if (typeof extractZip !== 'function' || typeof installPackDir !== 'function') {
      return err('pack_install_unavailable', '包安装通道不可用。');
    }
    await extractZip(zipPath, packRoot);
    const installed = await installPackDir(packRoot);
    if (!installed || installed.ok !== true) {
      return err('pack_install_failed', `包安装失败：${(installed && (installed.error || installed.message)) || 'unknown'}`);
    }
    const mcpResults = [];
    for (const server of pack.mcpServers) {
      const saved = await upsertMcpServer(server);
      mcpResults.push({ id: server.id, ok: Boolean(saved && !saved.error), error: (saved && saved.error) || null });
    }
    const failedMcp = mcpResults.filter((item) => !item.ok);
    return {
      ok: true,
      kind: 'pack',
      packId: pack.packId,
      requiresRestart: Boolean(installed.requiresRestart),
      mcpInstalled: mcpResults.filter((item) => item.ok).map((item) => item.id),
      mcpFailed: failedMcp,
      partial: failedMcp.length > 0,
    };
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

module.exports = {
  SCHEME,
  MAX_MCP_CONFIG_BYTES,
  MAX_MANIFEST_BYTES,
  MAX_ARCHIVE_BYTES,
  allowPrivate,
  isPrivateHostname,
  isLoopbackHostname,
  validateRemoteUrl,
  validateMcpConfig,
  parseInstallDeepLink,
  validatePackManifest,
  fetchJsonGuarded,
  downloadGuarded,
  previewFromLink,
  confirmInstall,
};