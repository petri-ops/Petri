'use strict';

/**
 * helpers/web-search-config.js — 联网检索授权与预算（BLOCK-247 / Q2b）。
 *
 * 与 `network-config` 的分工（刻意的，别合并）：
 *  · network 族是**往进程 env 写代理/CA 的源头**，只在启动时被 Node 读取，因此有
 *    "需重启才生效"的语义（`applyNetworkEnv` + `restartRequired`）。
 *  · 本族是**能力授权 + 预算**：开关、检索后端、超时、字节上限、域名黑白名单。
 *    这些全部**即时生效**（每次调用现读），所以没有 env 层、没有"需重启"话术——
 *    混进 network 族会造出"设置页说要重启、其实早生效"的第二套真相。
 *
 * 三条诚实边界：
 *  1. **默认关**：没有显式开启时，`web_search`/`web_fetch` 返回结构化拒绝
 *     （`web_access_disabled`），不静默失败、也不偷偷出网。
 *  2. **未配置检索后端 ≠ 不可用**：`provider=none` 或空 baseUrl 时，检索工具回
 *     `web_search_not_configured`；抓取工具不依赖它，仍可用。
 *  3. **不存凭据**：SearXNG 自建实例无需 key；若将来要 key，走凭据族，不进本文件。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  commitGuard,
  findEntryByPath,
} = require('../../packages/shared-config/config-schema.js');

const FAMILY = 'web-search';
const STORE_FILENAME = 'web-search.json';

const DEFAULTS = Object.freeze({
  enabled: false,
  provider: 'none',
  searxngBaseUrl: '',
  maxResults: 5,
  timeoutMs: 10000,
  fetchMaxBytes: 1048576,
  allowedHosts: '',
  blockedHosts: '',
});

const FIELD_ORDER = Object.keys(DEFAULTS);

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
    for (const key of FIELD_ORDER) {
      const value = parsed[key];
      if (typeof DEFAULTS[key] === 'boolean') {
        if (typeof value === 'boolean') out[key] = value;
      } else if (typeof DEFAULTS[key] === 'number') {
        if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
      } else if (typeof value === 'string') {
        out[key] = value;
      }
    }
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

function normalize(values) {
  const source = values && typeof values === 'object' ? values : {};
  return {
    enabled: source.enabled === true,
    provider: typeof source.provider === 'string' ? source.provider.trim() : DEFAULTS.provider,
    searxngBaseUrl: typeof source.searxngBaseUrl === 'string' ? source.searxngBaseUrl.trim() : '',
    maxResults: Number.isFinite(source.maxResults) ? source.maxResults : DEFAULTS.maxResults,
    timeoutMs: Number.isFinite(source.timeoutMs) ? source.timeoutMs : DEFAULTS.timeoutMs,
    fetchMaxBytes: Number.isFinite(source.fetchMaxBytes) ? source.fetchMaxBytes : DEFAULTS.fetchMaxBytes,
    allowedHosts: typeof source.allowedHosts === 'string' ? source.allowedHosts.trim() : '',
    blockedHosts: typeof source.blockedHosts === 'string' ? source.blockedHosts.trim() : '',
  };
}

/** 生效配置 = 默认值 ⊕ 落盘值（读侧宽松：坏形状回默认，不炸）。 */
function getEffectiveConfig() {
  return normalize({ ...DEFAULTS, ...readStore() });
}

/** 写侧：逐项过共享注册表守卫；未知键/非法形状 → 抛 config_value_rejected（路由映射 400）。 */
function saveWebSearchConfig(patch) {
  const guard = commitGuard(FAMILY, patch && typeof patch === 'object' ? patch : {}, lookup);
  if (!guard.ok) {
    const error = new Error('config_value_rejected');
    error.diagnostics = guard.diagnostics;
    throw error;
  }
  const current = readStore();
  const next = { ...current, ...guard.normalized };
  writeStore(next);
  return getSnapshot();
}

/** 逗号分隔域名列表 → 小写去空数组（含前导点归一，便于子域匹配）。 */
function parseHostList(raw) {
  return String(raw || '')
    .split(',')
    .map((item) => item.trim().toLowerCase().replace(/^\.+/, ''))
    .filter(Boolean);
}

function getSnapshot() {
  const effective = getEffectiveConfig();
  const allowed = parseHostList(effective.allowedHosts);
  const blocked = parseHostList(effective.blockedHosts);
  const diagnostics = [];
  if (effective.enabled && effective.provider === 'searxng' && !effective.searxngBaseUrl) {
    diagnostics.push({
      code: 'searxng-base-url-missing',
      family: FAMILY,
      path: 'searxngBaseUrl',
      message: '已选 SearXNG 检索后端但未填实例地址：检索会返回「未配置」而不是空结果。',
    });
  }
  return {
    effective,
    stored: readStore(),
    allowedHosts: allowed,
    blockedHosts: blocked,
    /** 能力可用性（前端直接照此显示，不自行推导） */
    capabilities: {
      search: effective.enabled && effective.provider === 'searxng' && Boolean(effective.searxngBaseUrl),
      fetch: effective.enabled,
    },
    diagnostics,
  };
}

module.exports = {
  FAMILY,
  STORE_FILENAME,
  DEFAULTS,
  storePath,
  readStore,
  writeStore,
  getEffectiveConfig,
  saveWebSearchConfig,
  getSnapshot,
  parseHostList,
};
