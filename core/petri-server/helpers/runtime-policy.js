'use strict';

/**
 * helpers/runtime-policy.js — 全局审批默认档位 / 派生并发与深度 / 工具曝光黑名单（BLOCK-202 W3 / P0-2）。
 *
 * 三条红线：
 *  ① **审批语义零改动**：`approvalDefaultMode` 只在请求上下文**没有** accessMode 时兜底，
 *     显式传值永远优先；四档判定（read/plan/workspace-write/full）与 BLOCK-180 审批资源
 *     /指纹放行链一字未改——本模块只决定「默认值从哪来」。
 *  ② **env 仍是并发/深度的既有部署面**：PETRI_SPAWN_* 存在时 env 优先（settings 里能看到
 *     shadowed 提示），未设置才读文件，文件也没有才回落历史默认 3 / 1。
 *  ③ **工具黑名单是曝光层不是安全边界**：它只把工具从模型可见列表里摘掉；策略/审批层照常
 *     生效，直接调用仍会被既有 policy 拦。UI 文案必须这么说，不得表述为"禁用工具"。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  commitGuard,
  findEntryByPath,
} = require('../../packages/shared-config/config-schema.js');

const FAMILY = 'runtime';
const STORE_FILENAME = 'runtime-policy.json';
const DEFAULTS = Object.freeze({
  approvalDefaultMode: 'full',
  spawnConcurrency: 3,
  spawnMaxDepth: 1,
  toolAllow: '',
  toolDeny: '',
});
const APPROVAL_MODES = Object.freeze(['read', 'plan', 'workspace-write', 'full']);

function storePath() {
  const root = process.env.PETRI_LOCAL_DATA_DIR || path.join(os.homedir(), 'Documents', 'Petri-Local');
  return path.join(root, STORE_FILENAME);
}

function lookup(family, storagePath) {
  return findEntryByPath(family, storagePath);
}

function readStore() {
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath(), 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out = {};
    if (typeof parsed.approvalDefaultMode === 'string') out.approvalDefaultMode = parsed.approvalDefaultMode;
    if (typeof parsed.spawnConcurrency === 'number') out.spawnConcurrency = parsed.spawnConcurrency;
    if (typeof parsed.spawnMaxDepth === 'number') out.spawnMaxDepth = parsed.spawnMaxDepth;
    if (typeof parsed.toolAllow === 'string') out.toolAllow = parsed.toolAllow;
    if (typeof parsed.toolDeny === 'string') out.toolDeny = parsed.toolDeny;
    return out;
  } catch {
    return {};
  }
}

function writeStore(values) {
  const dir = path.dirname(storePath());
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    storePath(),
    JSON.stringify({ ...values, updatedAt: new Date().toISOString() }, null, 2) + '\n',
    'utf8',
  );
  return values;
}

function saveRuntimePolicy(patch) {
  // 整包过守卫：未知键必须 400（不得"挑已知键"式静默丢键）。
  const guard = commitGuard(FAMILY, patch && typeof patch === 'object' ? patch : {}, lookup);
  if (!guard.ok) {
    const error = new Error('config_value_rejected');
    error.diagnostics = guard.diagnostics;
    throw error;
  }
  const next = { ...readStore(), ...guard.normalized };
  writeStore(next);
  return getRuntimeSnapshot();
}

function envNumber(raw, fallback, max = 8) {
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(1, Math.floor(value)));
}

/** 并发：env 优先 > 文件 > 历史默认 3（1-8 钳制与 spawn-agent-tools 原语义一致）。 */
function getSpawnConcurrency(env = process.env) {
  const raw = env.PETRI_SPAWN_CONCURRENCY_LIMIT;
  if (raw != null && raw !== '') return envNumber(raw, DEFAULTS.spawnConcurrency);
  const stored = readStore().spawnConcurrency;
  return typeof stored === 'number' ? envNumber(stored, DEFAULTS.spawnConcurrency) : DEFAULTS.spawnConcurrency;
}

/** 深度：env 优先 > 文件 > 历史默认 1（≥1，上限 8 防失控）。 */
function getSpawnMaxDepth(env = process.env) {
  const raw = env.PETRI_SPAWN_MAX_DEPTH;
  if (raw != null && raw !== '') return envNumber(raw, DEFAULTS.spawnMaxDepth, 3);
  const stored = readStore().spawnMaxDepth;
  return typeof stored === 'number' ? envNumber(stored, DEFAULTS.spawnMaxDepth, 3) : DEFAULTS.spawnMaxDepth;
}

/** 全局审批默认档位：只给"上下文没传 accessMode"的调用兜底；非法已存值回落 full（=现状）。 */
function getDefaultApprovalMode() {
  const stored = readStore().approvalDefaultMode;
  return APPROVAL_MODES.includes(stored) ? stored : DEFAULTS.approvalDefaultMode;
}

function parseNames(raw) {
  return String(raw || '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
}

function toolAllowList() {
  return parseNames(readStore().toolAllow);
}

function toolDenyList() {
  return parseNames(readStore().toolDeny);
}

function isToolDenied(name) {
  return toolDenyList().includes(name);
}

/** 曝光层过滤：白名单（非空时）先收窄，再摘掉黑名单；其余原样返回（不排序、不改形状）。 */
function filterToolDefs(defs) {
  const allowed = new Set(toolAllowList());
  const denied = new Set(toolDenyList());
  if (allowed.size === 0 && denied.size === 0) return defs;
  return defs.filter((def) => {
    const name = def && def.function ? def.function.name : def && def.name;
    if (allowed.size > 0 && !allowed.has(name)) return false;
    return !denied.has(name);
  });
}

function getRuntimeSnapshot(env = process.env) {
  const stored = readStore();
  const envShadowed = [];
  if (env.PETRI_SPAWN_CONCURRENCY_LIMIT != null && env.PETRI_SPAWN_CONCURRENCY_LIMIT !== '') {
    envShadowed.push({ key: 'spawnConcurrency', envKey: 'PETRI_SPAWN_CONCURRENCY_LIMIT', envValue: env.PETRI_SPAWN_CONCURRENCY_LIMIT });
  }
  if (env.PETRI_SPAWN_MAX_DEPTH != null && env.PETRI_SPAWN_MAX_DEPTH !== '') {
    envShadowed.push({ key: 'spawnMaxDepth', envKey: 'PETRI_SPAWN_MAX_DEPTH', envValue: env.PETRI_SPAWN_MAX_DEPTH });
  }
  return {
    configured: { ...DEFAULTS, ...stored },
    effective: {
      approvalDefaultMode: getDefaultApprovalMode(),
      spawnConcurrency: getSpawnConcurrency(env),
      spawnMaxDepth: getSpawnMaxDepth(env),
    },
    modes: [...APPROVAL_MODES],
    envShadowed,
  };
}

module.exports = {
  FAMILY,
  STORE_FILENAME,
  DEFAULTS,
  APPROVAL_MODES,
  storePath,
  readStore,
  writeStore,
  saveRuntimePolicy,
  getSpawnConcurrency,
  getSpawnMaxDepth,
  getDefaultApprovalMode,
  toolDenyList,
  isToolDenied,
  filterToolDefs,
  toolAllowList,
  getRuntimeSnapshot,
};
