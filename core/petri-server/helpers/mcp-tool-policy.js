'use strict';

/**
 * helpers/mcp-tool-policy.js — MCP 逐工具策略落点（BLOCK-204 / runlist W5）。
 *
 * 与 `mcp-settings`（连哪些 server）分开：本模块管"连上之后，每个投影工具怎么对待"——
 * 启用与否、调用超时、合同模式（只读/改写/自动）。形状真相在
 * `core/packages/shared-config/config-schema.js` 的 `mcp-tool-policy` 族。
 *
 * 三条现状纪律：
 *  ① 落点 = `<dataDir>/mcp-tool-policy.json`，目录走 `shared-backend/data-paths`（W4b 单源）；
 *  ② 读侧宽容：文件缺失/损坏/非法条目一律不抛，非法条目**只丢该条**（其余策略照常生效）；
 *  ③ 未配置的工具 = `DEFAULTS`（启用、60s、auto）——与接线前的行为逐字相同，
 *     所以"没配过任何策略"等价于零行为变化（这是本包能被安全回退的前提）。
 *
 * unknown-tool 的判定**不在注册表**：工具名来自运行时已连接的 server（动态空间），
 * 静态注册表无法枚举。故写侧由调用方传入"已知工具名"（当前投影 ∪ 已有策略条目），
 * 不在其中的**新**名字一律 400 `unknown_tool`；已有条目即使 server 断连也允许改/删，
 * 否则离线就改不了策略。
 */

const fs = require('node:fs');
const path = require('node:path');
const schema = require('../../packages/shared-config/config-schema.js');
const dataPaths = require('../../shared-backend/data-paths.js');

const FAMILY = 'mcp-tool-policy';
const FILENAME = 'mcp-tool-policy.json';
const VERSION = 1;

/** 未配置时的策略（=接线前的行为，逐字相同）。 */
const DEFAULTS = Object.freeze({ enabled: true, timeoutMs: 60_000, contractMode: 'auto' });

/** 与基线冻结值一致（agent-tools/mcp-projection.js 原 MAX_PROJECTED_TOOLS）。 */
const DEFAULT_PROJECTION_LIMIT = 40;

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function diagnostic(code, keyPath, message) {
  return { code, family: FAMILY, path: keyPath, message };
}

/** 落点文件绝对路径（目录走 W4b 的数据根单源）。 */
function policyFilePath() {
  return dataPaths.dataFile(FILENAME);
}

/** 单条策略消毒（复用集合实现：未知字段/域外值只产诊断）。 */
function sanitizeEntry(raw) {
  const { item, diagnostics } = schema.sanitizeItem(FAMILY, raw);
  return { item: item && item.tool ? item : null, diagnostics };
}

/** 读整份存储（宽容）。 */
function readStore() {
  let parsed = null;
  try {
    parsed = JSON.parse(fs.readFileSync(policyFilePath(), 'utf8'));
  } catch {
    return { version: VERSION, projectionLimit: DEFAULT_PROJECTION_LIMIT, tools: [] };
  }
  if (!isPlainObject(parsed)) return { version: VERSION, projectionLimit: DEFAULT_PROJECTION_LIMIT, tools: [] };
  const limitEntry = schema.findKeyEntry('mcpPolicy.projectionLimit');
  const limitCheck = schema.validateValue(limitEntry, parsed.projectionLimit);
  const tools = [];
  const seen = new Set();
  for (const raw of Array.isArray(parsed.tools) ? parsed.tools : []) {
    const { item } = sanitizeEntry(raw);
    if (!item || seen.has(item.tool)) continue; // 非法/重复条目丢该条（读取侧 fail-open）
    seen.add(item.tool);
    tools.push(item);
  }
  return {
    version: VERSION,
    projectionLimit: limitCheck.ok ? limitCheck.normalized : DEFAULT_PROJECTION_LIMIT,
    tools,
  };
}

/** 写整份存储（先消毒再落盘）。返回 {ok, store, diagnostics}。 */
function writeStore(next) {
  const diagnostics = [];
  const limitEntry = schema.findKeyEntry('mcpPolicy.projectionLimit');
  // 不传上限 = 沿用当前值（不是"非法"）：partial 写入是常态（只改某几个工具的策略）
  const limitRaw = next && next.projectionLimit !== undefined ? next.projectionLimit : readStore().projectionLimit;
  const limitCheck = schema.validateValue(limitEntry, limitRaw);
  if (!limitCheck.ok) diagnostics.push(diagnostic(limitCheck.code, 'projectionLimit', limitCheck.message));
  const tools = [];
  const seen = new Set();
  for (const raw of Array.isArray(next && next.tools) ? next.tools : []) {
    const { item, diagnostics: entryDiagnostics } = sanitizeEntry(raw);
    if (!item) {
      diagnostics.push(...(entryDiagnostics.length ? entryDiagnostics : [diagnostic('type-mismatch', '', '策略条目必须是带 tool 的对象')]));
      continue;
    }
    if (seen.has(item.tool)) {
      diagnostics.push(diagnostic('not-allowed', item.tool, `重复的策略条目 ${item.tool}`));
      continue;
    }
    seen.add(item.tool);
    tools.push(item);
  }
  if (diagnostics.some((d) => d.code !== schema.DIAGNOSTIC_CODES.UNKNOWN_KEY)) {
    return { ok: false, store: readStore(), diagnostics };
  }
  const store = { version: VERSION, projectionLimit: limitCheck.normalized, tools };
  fs.mkdirSync(path.dirname(policyFilePath()), { recursive: true });
  fs.writeFileSync(policyFilePath(), `${JSON.stringify(store, null, 2)}\n`, 'utf8');
  return { ok: true, store, diagnostics };
}

/** 某工具的生效策略（未配置 → DEFAULTS）。 */
function policyFor(toolName, store = readStore()) {
  const hit = store.tools.find((entry) => entry.tool === toolName);
  if (!hit) return { ...DEFAULTS };
  return {
    enabled: hit.enabled === undefined ? DEFAULTS.enabled : hit.enabled,
    timeoutMs: hit.timeoutMs === undefined ? DEFAULTS.timeoutMs : hit.timeoutMs,
    contractMode: hit.contractMode === undefined ? DEFAULTS.contractMode : hit.contractMode,
  };
}

/** 投影上限（可配；默认 40）。 */
function projectionLimit(store = readStore()) {
  return store.projectionLimit;
}

/**
 * 写侧校验：把 patch（`{projectionLimit?, tools?}`）与"已知工具名"对账。
 * 只对**新**工具名做 unknown-tool 拒绝；既有条目允许改/删（离线可用）。
 * @returns {{ok:boolean, diagnostics:Array, nextStore:object}}
 */
function validatePatch(patch, knownToolNames) {
  const current = readStore();
  if (!isPlainObject(patch)) {
    return { ok: false, diagnostics: [diagnostic('type-mismatch', '', '补丁必须是对象')], nextStore: current };
  }
  const known = new Set([...knownToolNames || [], ...current.tools.map((entry) => entry.tool)]);
  const diagnostics = [];
  const tools = Array.isArray(patch.tools) ? patch.tools : current.tools;
  for (const raw of tools) {
    const toolName = raw && typeof raw === 'object' ? raw.tool : null;
    if (typeof toolName !== 'string' || !toolName) {
      diagnostics.push(diagnostic('type-mismatch', '', '每条策略必须带 tool 字段'));
      continue;
    }
    if (!known.has(toolName)) {
      diagnostics.push(diagnostic('not-allowed', toolName, `未知的 MCP 工具 ${toolName}（不在当前投影，也不在已有策略里）`));
    }
  }
  const nextStore = {
    projectionLimit: patch.projectionLimit === undefined ? current.projectionLimit : patch.projectionLimit,
    tools,
  };
  return { ok: diagnostics.length === 0, diagnostics, nextStore };
}

/** 按区重置（config-transfer 用）：清策略与上限，回落默认。 */
function resetToolPolicies() {
  return writeStore({ projectionLimit: DEFAULT_PROJECTION_LIMIT, tools: [] });
}

module.exports = {
  FAMILY,
  DEFAULTS,
  DEFAULT_PROJECTION_LIMIT,
  policyFilePath,
  readStore,
  writeStore,
  policyFor,
  projectionLimit,
  validatePatch,
  resetToolPolicies,
};
