'use strict';

/**
 * helpers/mcp-oauth-store.js — BLOCK-239 MCP OAuth 凭据存储。
 *
 * 每个 server 一条记录：
 *   { clientInformation?, tokens?, codeVerifier?, pending?, updatedAt }
 *
 * 纪律：
 * - **落盘零明文**：access_token / refresh_token / client_secret / codeVerifier
 *   全部经 mcp-env-crypto（AES-256-GCM，`enc:v1:` 前缀）加密；状态面永不读取值。
 * - **fail-closed**：文件缺失/坏 JSON/形状错 = 空表；解密失败按空值降级，不崩。
 * - **pending 有界**：授权 state/verifier/URL 只在 10 分钟内有效；过期即视为无 pending。
 * - 不建第二套凭据系统：复用 CAP-2 的加密原语与数据根。
 */

const fs = require('node:fs');
const path = require('node:path');
const dataPaths = require('../../shared-backend/data-paths.js');
const { encryptSecret, decryptSecret } = require('./mcp-env-crypto');

const FILENAME = 'mcp-oauth.json';
const VERSION = 1;
const PENDING_TTL_MS = 10 * 60 * 1000;

function oauthFilePath() {
  return path.join(dataPaths.resolveDataDir(), FILENAME);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readRawStore() {
  try {
    const raw = JSON.parse(fs.readFileSync(oauthFilePath(), 'utf8'));
    if (!isPlainObject(raw) || !isPlainObject(raw.servers)) return { version: VERSION, servers: {} };
    return { version: VERSION, servers: raw.servers };
  } catch {
    return { version: VERSION, servers: {} };
  }
}

function decryptOrEmpty(value) {
  if (typeof value !== 'string' || !value) return '';
  return decryptSecret(value);
}

function normalizePending(raw) {
  if (!isPlainObject(raw)) return null;
  const state = typeof raw.state === 'string' ? raw.state : '';
  const redirectBase = typeof raw.redirectBase === 'string' ? raw.redirectBase : '';
  const createdAt = Number(raw.createdAt);
  if (!state || !redirectBase || !Number.isFinite(createdAt)) return null;
  if (Date.now() - createdAt > PENDING_TTL_MS) return null;
  return {
    state,
    redirectBase,
    authorizationUrl: typeof raw.authorizationUrl === 'string' ? raw.authorizationUrl : null,
    createdAt,
  };
}

/** 读取并解密单条 server 记录（无记录=空对象，不 throw）。 */
function readEntry(serverId) {
  const id = String(serverId || '');
  if (!id) return {};
  const raw = readRawStore().servers[id];
  if (!isPlainObject(raw)) return {};
  const clientInformation = isPlainObject(raw.clientInformation)
    ? {
      ...raw.clientInformation,
      ...(typeof raw.clientInformation.client_secret === 'string'
        ? { client_secret: decryptOrEmpty(raw.clientInformation.client_secret) }
        : {}),
    }
    : null;
  const tokens = isPlainObject(raw.tokens)
    ? {
      ...raw.tokens,
      access_token: decryptOrEmpty(raw.tokens.access_token),
      ...(typeof raw.tokens.refresh_token === 'string'
        ? { refresh_token: decryptOrEmpty(raw.tokens.refresh_token) }
        : {}),
    }
    : null;
  return {
    clientInformation: clientInformation && clientInformation.client_id ? clientInformation : null,
    tokens: tokens && tokens.access_token ? tokens : null,
    codeVerifier: typeof raw.codeVerifier === 'string' ? decryptOrEmpty(raw.codeVerifier) : null,
    pending: normalizePending(raw.pending),
    updatedAt: Number(raw.updatedAt) || null,
  };
}

function encryptClientInformation(info) {
  if (!isPlainObject(info)) return null;
  return {
    ...info,
    ...(typeof info.client_secret === 'string' && info.client_secret
      ? { client_secret: encryptSecret(info.client_secret) }
      : {}),
  };
}

function encryptTokens(tokens) {
  if (!isPlainObject(tokens) || !tokens.access_token) return null;
  return {
    ...tokens,
    access_token: encryptSecret(tokens.access_token),
    ...(typeof tokens.refresh_token === 'string' && tokens.refresh_token
      ? { refresh_token: encryptSecret(tokens.refresh_token) }
      : {}),
  };
}

/** 覆盖写单条记录（值先加密；同步 IO 与 mcp-settings 一致）。 */
function writeEntry(serverId, entry) {
  const id = String(serverId || '');
  if (!id) return { ok: false, error: 'server_id_required' };
  const store = readRawStore();
  const next = {
    ...(entry.clientInformation ? { clientInformation: encryptClientInformation(entry.clientInformation) } : {}),
    ...(entry.tokens ? { tokens: encryptTokens(entry.tokens) } : {}),
    ...(entry.codeVerifier ? { codeVerifier: encryptSecret(entry.codeVerifier) } : {}),
    ...(entry.pending ? { pending: entry.pending } : {}),
    updatedAt: Date.now(),
  };
  store.servers[id] = next;
  try {
    const file = oauthFilePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ version: VERSION, servers: store.servers }, null, 2), 'utf8');
    return { ok: true, entry: readEntry(id) };
  } catch (error) {
    return { ok: false, error: 'write_failed', message: String(error && error.message) };
  }
}

/** 读-改-写；updater 收到解密后的 entry，返回新的 entry。 */
function updateEntry(serverId, updater) {
  const current = readEntry(serverId);
  const next = updater(current) || current;
  return writeEntry(serverId, next);
}

function pendingFor(serverId) {
  return readEntry(serverId).pending;
}

function hasTokens(serverId) {
  return Boolean(readEntry(serverId).tokens);
}

function clearPending(serverId) {
  return updateEntry(serverId, (current) => {
    const next = { ...current };
    delete next.pending;
    return next;
  });
}

function removeServer(serverId) {
  const id = String(serverId || '');
  if (!id) return { ok: false, error: 'server_id_required' };
  const store = readRawStore();
  if (!store.servers[id]) return { ok: true, removed: false };
  delete store.servers[id];
  try {
    const file = oauthFilePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ version: VERSION, servers: store.servers }, null, 2), 'utf8');
    return { ok: true, removed: true };
  } catch (error) {
    return { ok: false, error: 'write_failed', message: String(error && error.message) };
  }
}

module.exports = {
  readEntry,
  updateEntry,
  pendingFor,
  hasTokens,
  clearPending,
  removeServer,
};
