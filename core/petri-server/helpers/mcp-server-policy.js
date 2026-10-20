'use strict';

/**
 * helpers/mcp-server-policy.js — 服务级 MCP 治理策略（BLOCK-221 / Q8 垂直切片）。
 *
 * 为什么需要它：逐工具策略（`mcp-tool-policy.js`）只能一个个关工具，回答不了
 * 「这台 server 我信多少」「这台只让我用其中 3 个工具」。本模块给每个已配置的
 * server 一层**可写、可解释、有界**的策略：
 *
 *   { trust: 'ask' | 'allow', allow: string[], block: string[] }
 *
 * 语义（求值顺序固定，便于解释与测试）：
 *   1. `block` 命中 → 不投影（永远优先，误配 also 安全侧）；
 *   2. `allow` 非空 → 只有名单内工具投影（白名单）；
 *   3. 都为空 → 全允许（默认，行为与历史一致）。
 *
 * 纪律：
 * - `trust` 本轮**只落库与展示**，不改变 D4 审批默认——降档必须与审批事件契约一起做。
 * - 读侧 fail-closed：缺失/坏 JSON/形状错 = 空策略（既不放开过滤，也不阻断连接）。
 * - 写侧 fail-closed：未知 serverId → `server_not_found`；越界（条数/长度）→ 拒绝并给 diagnostics。
 */

const fs = require('node:fs');
const path = require('node:path');
const dataPaths = require('../../shared-backend/data-paths.js');

const FILENAME = 'mcp-server-policy.json';
const VERSION = 1;
const MAX_LIST = 200;
const MAX_TOOL_NAME = 128;
const TOOL_NAME_RE = /^[A-Za-z0-9_.:-]{1,128}$/;
const TRUST_VALUES = new Set(['ask', 'allow']);
const EMPTY_POLICY = Object.freeze({ trust: 'ask', allow: [], block: [] });

function policyFilePath() {
  return path.join(dataPaths.resolveDataDir(), FILENAME);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizePolicy(raw) {
  if (!isPlainObject(raw)) return { trust: EMPTY_POLICY.trust, allow: [], block: [] };
  const trust = TRUST_VALUES.has(raw.trust) ? raw.trust : EMPTY_POLICY.trust;
  const clean = (list) =>
    Array.isArray(list)
      ? list
          .filter((name) => typeof name === 'string' && TOOL_NAME_RE.test(name))
          .slice(0, MAX_LIST)
      : [];
  return { trust, allow: clean(raw.allow), block: clean(raw.block) };
}

/** 读全部策略；文件缺失/损坏/形状错 = 空表（fail-closed 到默认全允许）。 */
function readStore() {
  try {
    const raw = JSON.parse(fs.readFileSync(policyFilePath(), 'utf8'));
    if (!isPlainObject(raw) || !isPlainObject(raw.servers)) return { version: VERSION, servers: {} };
    const servers = {};
    for (const [id, entry] of Object.entries(raw.servers)) {
      if (!isPlainObject(entry)) continue;
      servers[String(id)] = normalizePolicy(entry);
    }
    return { version: VERSION, servers };
  } catch {
    return { version: VERSION, servers: {} };
  }
}

function writeStore(nextStore) {
  const payload = { version: VERSION, servers: nextStore.servers || {} };
  try {
    const file = policyFilePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8');
    return { ok: true, store: payload };
  } catch (error) {
    return { ok: false, error: 'write_failed', message: String(error && error.message) };
  }
}

/** 单个 server 的策略（未配置 = 默认全允许）。 */
function policyForServer(serverId, store = readStore()) {
  const entry = store.servers[String(serverId)];
  return entry ? { ...entry, allow: [...entry.allow], block: [...entry.block] } : { ...EMPTY_POLICY };
}

/**
 * 服务级工具判定。返回 `{ allowed, reason }`——reason 是给人看的解释（治理可解释）。
 * @param {string} serverId
 * @param {string} toolName 原始 MCP 工具名（未投影）
 */
function evaluateTool(serverId, toolName, store = readStore()) {
  const policy = policyForServer(serverId, store);
  const name = String(toolName || '');
  if (policy.block.includes(name)) return { allowed: false, reason: 'blocked', policy };
  if (policy.allow.length > 0 && !policy.allow.includes(name)) {
    return { allowed: false, reason: 'not_in_allow_list', policy };
  }
  return { allowed: true, reason: 'allowed', policy };
}

/**
 * 校验写请求（PUT /api/mcp/servers/:id/policy）。
 * @param {string} serverId
 * @param {object} patch { trust?, allow?, block? }
 * @param {{ knownServerIds: Set<string>, connectedTools?: string[]|null }} ctx
 */
function validatePatch(serverId, patch, ctx = {}) {
  const diagnostics = [];
  const id = String(serverId || '');
  const known = ctx.knownServerIds instanceof Set ? ctx.knownServerIds : new Set();
  if (!id) return { ok: false, error: 'server_not_found', diagnostics };
  if (known.size > 0 && !known.has(id)) {
    return { ok: false, error: 'server_not_found', diagnostics };
  }
  if (!isPlainObject(patch)) {
    return { ok: false, error: 'policy_rejected', diagnostics: [{ code: 'body_not_object' }] };
  }
  const store = readStore();
  const current = policyForServer(id, store);
  const next = { ...current };

  if (patch.trust !== undefined) {
    if (!TRUST_VALUES.has(patch.trust)) {
      diagnostics.push({ code: 'trust_invalid', value: String(patch.trust) });
    } else {
      next.trust = patch.trust;
    }
  }

  const connected = Array.isArray(ctx.connectedTools) ? new Set(ctx.connectedTools) : null;
  for (const field of ['allow', 'block']) {
    if (patch[field] === undefined) continue;
    if (!Array.isArray(patch[field])) {
      diagnostics.push({ code: `${field}_not_array` });
      continue;
    }
    if (patch[field].length > MAX_LIST) {
      diagnostics.push({ code: `${field}_too_many`, limit: MAX_LIST, got: patch[field].length });
      continue;
    }
    const seen = new Set();
    const list = [];
    for (const raw of patch[field]) {
      if (typeof raw !== 'string' || !TOOL_NAME_RE.test(raw)) {
        diagnostics.push({ code: `${field}_invalid_name`, value: String(raw).slice(0, 64) });
        continue;
      }
      if (seen.has(raw)) continue;
      seen.add(raw);
      // 未知工具名只在已连接时可判定：已连接但不在清单 → 报 diagnostic 但仍收（离线可预配）
      if (connected && !connected.has(raw)) {
        diagnostics.push({ code: `${field}_unknown_tool`, value: raw });
      }
      list.push(raw);
    }
    next[field] = list;
  }

  if (diagnostics.some((d) => /_not_array|_too_many|_invalid_name|trust_invalid|body_not_object/.test(d.code))) {
    return { ok: false, error: 'policy_rejected', diagnostics };
  }
  store.servers[id] = next;
  return { ok: true, nextStore: store, policy: next, diagnostics };
}

/** 供清单面用的摘要（不泄漏工具名以外的配置）。 */
function summaryFor(serverId, store = readStore()) {
  const policy = policyForServer(serverId, store);
  return {
    trust: policy.trust,
    allowCount: policy.allow.length,
    blockCount: policy.block.length,
    allow: [...policy.allow],
    block: [...policy.block],
  };
}

function resetServerPolicies() {
  return writeStore({ version: VERSION, servers: {} });
}

module.exports = {
  FILENAME,
  VERSION,
  MAX_LIST,
  MAX_TOOL_NAME,
  policyFilePath,
  readStore,
  writeStore,
  policyForServer,
  evaluateTool,
  validatePatch,
  summaryFor,
  resetServerPolicies,
};
