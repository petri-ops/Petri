'use strict';

/**
 * core/packages/shared-config/config-schema.js — 配置键注册表与校验/优先级单源（BLOCK-199 P1-1）。
 *
 * 为什么放这一层（架构规则决定，不是偏好）：`.dependency-cruiser.cjs` 的 R3 禁 `core→src`、
 * R5 禁 `src→core/petri-server`，R4 注释明写 `core/packages/**` 是前后端合法共享层。配置键注册表
 * 要被后端 helper、Electron 主进程、设置 UI 三方同源消费，唯一合规落点就是这里
 * （先例：`core/packages/shared-telemetry/funnel-events.js`，BLOCK-186 同理由）。
 *
 * 三条设计约束：
 *  1. **纯函数、零 require**：不 import 后端模块，也不引第三方校验库（本仓零 zod/ajv；新依赖默认拒）。
 *     需要外部事实（如决策接点的阈值注册表）一律由调用方**注入**，避免这里长出第二份数值真相。
 *  2. **只声明形状，不复制数值**：阈值/门限的默认值与证据仍在 `decision-thresholds`，本表只声明
 *     "这个键是什么类型、能被谁改、怎么算合法"。
 *  3. **未知键语义单源**：`读不炸、写不进` —— 读侧宽松（只产 diagnostics 报告），写侧 fail-closed。
 *     这条统一掉了 P0 测绘发现的两处不一致（decision-config 读侧静默丢、写侧 throw）。
 */

/** 生效层名（高→低）。各族实际胜负由 CONFIG_FAMILIES[].precedence 决定，不假设全局同一顺序。 */
const CONFIG_LAYERS = Object.freeze(['override', 'env', 'file', 'default']);

const DIAGNOSTIC_CODES = Object.freeze({
  UNKNOWN_KEY: 'unknown-key',
  TYPE_MISMATCH: 'type-mismatch',
  OUT_OF_RANGE: 'out-of-range',
  NOT_ALLOWED: 'not-allowed',
  READ_ONLY: 'read-only',
  ALIAS_USED: 'alias-used',
});

/**
 * 族定义：precedence 是**该族自己的现有胜负关系**（逐族实码读来，见 block199-config-compat 基线），
 * 统一实现不得改写它。envTruth 区分三族语义：
 *  · 'boolean-force' —— env '1'/'true' 强制开、'0'/'false' 强制关（feature-flags）
 *  · 'one-zero'      —— 只认 '1'/'0'，别的字面量不干预（decision-config envValue 现状）
 *  · 'numeric'       —— env 是数值（generation/cost-cap），非数值即视为未设置
 * 注：decision-config 的 env='1' 在运行时**实际强制开**，与其文件头注释相反（C-32 已登记）；
 * 本表照现状记账，不在本包改胜负。
 */
const CONFIG_FAMILIES = Object.freeze({
  'feature-flags': {
    store: 'file:feature-flags.json#flags',
    precedence: ['env', 'file', 'default'],
    envTruth: 'boolean-force',
  },
  'decision-points': {
    store: 'file:decision-config.json#points',
    precedence: ['env', 'file', 'registry'],
    envTruth: 'one-zero',
  },
  'generation': {
    store: 'file:ai-settings.json#generation',
    precedence: ['env', 'file'],
    envTruth: 'numeric',
  },
  'cost-cap': {
    store: 'file:ai-settings.json#costCapCny',
    precedence: ['env', 'file'],
    envTruth: 'numeric',
  },
});

/**
 * 键注册表。字段：
 *  · `key` 全局唯一可寻址路径（族内逻辑名，不含落点方言）
 *  · `family` / `path`（该族存储内的相对路径）
 *  · `type`：boolean | number | string | object
 *  · `domain`：数值区间/枚举/取整规则（可选）
 *  · `envKeys`：真实存在的环境变量别名（契约测扫源码验不存在的幽灵别名）
 *  · `aliases`：**历史/外部**同义键名，命中即产 ALIAS_USED（不静默接受，也不双写）
 *  · `mutable`：用户可改（true）还是代码侧校准专属（false → 写侧给 READ_ONLY）
 *  · `ui`：'settings' 有设置表面 / 'none' 显式登记为不可 UI（漂移门据此判缺口）
 *  · `dropInvalid`：现状行为标记——数值域不合法时是丢键（generation）还是报错（feature-flags 类型）
 */
const CONFIG_KEYS = Object.freeze([
  // —— feature flags（helpers/feature-flags.js:23-45；默认全 true 是 2026-09-18 裁决）——
  {
    key: 'flag.server_history_assembly', family: 'feature-flags', path: 'server_history_assembly',
    type: 'boolean', envKeys: ['PETRI_SERVER_HISTORY_ASSEMBLY'], aliases: [],
    mutable: true, ui: 'settings',
  },
  {
    key: 'flag.session_compaction', family: 'feature-flags', path: 'session_compaction',
    type: 'boolean', envKeys: ['PETRI_SESSION_COMPACTION'], aliases: [],
    mutable: true, ui: 'settings',
  },
  {
    key: 'flag.agent_resilience', family: 'feature-flags', path: 'agent_resilience',
    type: 'boolean', envKeys: ['PETRI_AGENT_RESILIENCE'], aliases: [],
    mutable: true, ui: 'settings',
  },
  // —— 决策接点运行时开关（helpers/decision-config.js RUNTIME_POINTS；阈值数值不在本表复制）——
  {
    key: 'point.topic-shift.enabled', family: 'decision-points', path: 'topic-shift.enabled',
    type: 'boolean', envKeys: ['PETRI_JEV_TOPIC_SHIFT'], aliases: [],
    mutable: true, ui: 'settings',
  },
  {
    key: 'point.knowledge-guard.enabled', family: 'decision-points', path: 'knowledge-guard.enabled',
    type: 'boolean', envKeys: ['PETRI_JEV_KNOWLEDGE_GUARD'], aliases: [],
    mutable: true, ui: 'settings',
  },
  {
    key: 'point.marker-celltype.enabled', family: 'decision-points', path: 'marker-celltype.enabled',
    type: 'boolean', envKeys: ['PETRI_JEV_MARKER_GUARD'], aliases: [],
    mutable: true, ui: 'settings',
  },
  {
    key: 'point.intent-route.enabled', family: 'decision-points', path: 'intent-route.enabled',
    type: 'boolean', envKeys: ['PETRI_JEV_INTENT_ROUTE'], aliases: [],
    mutable: true, ui: 'settings',
  },
  {
    key: 'point.tool-route.enabled', family: 'decision-points', path: 'tool-route.enabled',
    type: 'boolean', envKeys: ['PETRI_JEV_TOOL_ROUTE'], aliases: [],
    mutable: true, ui: 'settings',
  },
  {
    // 阈值数值本身受校准门约束：可改（设置页热调）但"改默认值"须先重校准 → mutable=true + 证据在注册表
    key: 'point.*.threshold', family: 'decision-points', path: '<point>.threshold',
    type: 'number', domain: { min: 0, max: 1 }, envKeys: [], aliases: [],
    mutable: true, ui: 'settings',
  },
  // —— 生成参数（helpers/ai-settings.js:315-329；env 数值覆盖文件，域外丢键）——
  {
    key: 'generation.temperature', family: 'generation', path: 'temperature',
    type: 'number', domain: { min: 0, max: 2 }, envKeys: ['PETRI_LLM_TEMPERATURE'],
    aliases: [], mutable: true, ui: 'settings', dropInvalid: 'drop-key',
  },
  {
    key: 'generation.maxTokens', family: 'generation', path: 'maxTokens',
    type: 'number', domain: { min: 256, max: 1000000, integer: 'floor' }, envKeys: ['PETRI_LLM_MAX_TOKENS'],
    aliases: [], mutable: true, ui: 'settings', dropInvalid: 'drop-key',
  },
  // —— 成本上限（helpers/cost-cap.js:14-26；>0 且两位小数）——
  {
    key: 'cost.capCny', family: 'cost-cap', path: 'costCapCny',
    type: 'number', domain: { minExclusive: 0, round: 2 }, envKeys: ['PETRI_TASK_COST_CAP_CNY'],
    aliases: [], mutable: true, ui: 'settings', dropInvalid: 'to-null',
  },
]);

const KEY_INDEX = new Map(CONFIG_KEYS.map((entry) => [entry.key, entry]));

function findKeyEntry(key) {
  return KEY_INDEX.get(key) || null;
}

/** 按族+族内存储路径查键声明（`point.<id>.threshold` 这类通配项参与匹配）。 */
function findEntryByPath(family, storagePath) {
  for (const entry of CONFIG_KEYS) {
    if (entry.family !== family) continue;
    if (entry.path === storagePath) return entry;
    if (entry.path.includes('<point>') && storagePath.endsWith(entry.path.slice(entry.path.lastIndexOf('.') + 1))) return entry;
  }
  return null;
}

/** 类型与数值域校验：返回归一化值或结构化诊断码（不抛错——抛不抛由调用侧语义决定）。 */
function validateValue(entry, raw) {
  if (!entry) return { ok: false, code: DIAGNOSTIC_CODES.UNKNOWN_KEY, message: '未注册的键' };
  if (entry.type === 'boolean') {
    if (typeof raw !== 'boolean') return { ok: false, code: DIAGNOSTIC_CODES.TYPE_MISMATCH, message: `${entry.key} 需要 boolean` };
    return { ok: true, normalized: raw };
  }
  if (entry.type === 'number') {
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(n)) return { ok: false, code: DIAGNOSTIC_CODES.TYPE_MISMATCH, message: `${entry.key} 需要有限数值` };
    let v = n;
    if (entry.domain && entry.domain.integer === 'floor') v = Math.floor(v);
    if (entry.domain && entry.domain.round != null) v = Math.round(v * 10 ** entry.domain.round) / 10 ** entry.domain.round;
    const d = entry.domain || {};
    if (d.min != null && v < d.min) return { ok: false, code: DIAGNOSTIC_CODES.OUT_OF_RANGE, message: `${entry.key} 需 ≥ ${d.min}` };
    if (d.max != null && v > d.max) return { ok: false, code: DIAGNOSTIC_CODES.OUT_OF_RANGE, message: `${entry.key} 需 ≤ ${d.max}` };
    if (d.minExclusive != null && v <= d.minExclusive) return { ok: false, code: DIAGNOSTIC_CODES.OUT_OF_RANGE, message: `${entry.key} 需 > ${d.minExclusive}` };
    return { ok: true, normalized: v };
  }
  if (entry.type === 'string') {
    if (typeof raw !== 'string') return { ok: false, code: DIAGNOSTIC_CODES.TYPE_MISMATCH, message: `${entry.key} 需要 string` };
    if (entry.domain && Array.isArray(entry.domain.oneOf) && !entry.domain.oneOf.includes(raw)) {
      return { ok: false, code: DIAGNOSTIC_CODES.NOT_ALLOWED, message: `${entry.key} 只接受 ${entry.domain.oneOf.join('/')}` };
    }
    return { ok: true, normalized: raw };
  }
  return { ok: false, code: DIAGNOSTIC_CODES.TYPE_MISMATCH, message: `${entry.key} 声明了未知类型 ${entry.type}` };
}

/**
 * env 文本 → 该族实际生效的三态（true/false/null=不干预）。
 * 严格照现状语义：feature-flags 认 '1'/'true'/'0'/'false'，decision-config 只认 '1'/'0'。
 */
function resolveEnvEntry(family, rawEnv) {
  if (rawEnv == null || rawEnv === '') return null;
  const truth = (CONFIG_FAMILIES[family] || {}).envTruth;
  if (truth === 'numeric') {
    const n = Number(rawEnv);
    return Number.isFinite(n) ? { layer: 'env', value: n } : null;
  }
  if (rawEnv === '1' || (truth === 'boolean-force' && rawEnv === 'true')) return { layer: 'env', value: true };
  if (rawEnv === '0' || (truth === 'boolean-force' && rawEnv === 'false')) return { layer: 'env', value: false };
  return null;
}

/**
 * 统一优先级取值：按族 precedence 找第一个"存在"的层；不改变任何族的胜负关系。
 * @param {string} family
 * @param {{env?:*, file?:*, defaults?:*}} layers 由调用方（后端适配器）提供
 */
function resolve(family, layers = {}) {
  const spec = CONFIG_FAMILIES[family];
  if (!spec) throw new Error(`config_family_unknown:${family}`);
  for (const layer of spec.precedence) {
    const value = layer === 'env' ? layers.env : layer === 'file' ? layers.file : layer === 'registry' ? layers.registry : layers.defaults;
    if (value !== undefined && value !== null) return { layer, value };
  }
  return { layer: null, value: null };
}

/**
 * 未知键/别名诊断：读侧只报告不拒（旧文件里有未知键不得炸启动），写侧据 ok=false 拒绝落盘。
 * @param {Array<{path:string}>|undefined} knownPaths 族内允许的存储路径（由适配器按实际形状给出）
 */
function diagnoseObject(family, obj, lookup) {
  const diagnostics = [];
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return diagnostics;
  for (const [path, value] of Object.entries(obj)) {
    const entry = lookup(family, path);
    if (!entry) {
      diagnostics.push({ code: DIAGNOSTIC_CODES.UNKNOWN_KEY, path, family, message: `未注册的配置键 ${path}（读侧忽略，写侧拒绝）` });
      continue;
    }
    for (const alias of entry.aliases || []) {
      if (alias === path) diagnostics.push({ code: DIAGNOSTIC_CODES.ALIAS_USED, path, family, message: `${path} 是 ${entry.key} 的历史别名` });
    }
    if (!entry.mutable) diagnostics.push({ code: DIAGNOSTIC_CODES.READ_ONLY, path, family, message: `${entry.key} 由代码侧校准专属，用户不可写` });
    const check = validateValue(entry, value);
    if (!check.ok) diagnostics.push({ code: check.code, path, family, message: check.message });
  }
  return diagnostics;
}

/**
 * 写侧守卫（BLOCK-199 P3）：注册表内键的补丁必须**逐项可校验**——未知键/类型不符/越界/只读键
 * 一律拒绝并回结构化诊断（"写不进"）。与读侧的宽松（`diagnoseObject` 只报告）配对成一条规则。
 * `null` 值=清键（既有语义，透传不误拒）；未出现的键不校验不改写。
 */
function commitGuard(family, patch, lookup, options = {}) {
  const diagnostics = [];
  const normalized = {};
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return { ok: false, normalized, diagnostics: [{ code: DIAGNOSTIC_CODES.TYPE_MISMATCH, family, path: '', message: '写入补丁必须是对象' }] };
  }
  for (const [path, value] of Object.entries(patch)) {
    if (value === null && !options.rejectNull) continue; // 清键语义：放行且不写值
    const entry = lookup(family, path);
    if (!entry) {
      diagnostics.push({ code: DIAGNOSTIC_CODES.UNKNOWN_KEY, family, path, message: `未注册的配置键 ${path}，拒绝写入（不再静默存活）` });
      continue;
    }
    if (!entry.mutable) {
      diagnostics.push({ code: DIAGNOSTIC_CODES.READ_ONLY, family, path, message: `${entry.key} 属代码侧校准专属，用户不可写` });
      continue;
    }
    const check = validateValue(entry, value);
    if (!check.ok) {
      diagnostics.push({ code: check.code, family, path, message: check.message });
      continue;
    }
    normalized[path] = check.normalized;
  }
  return { ok: diagnostics.length === 0, normalized, diagnostics };
}

/**
 * env 遮蔽可见化：列出"文件里写了值，但同时有 env 变量正在盖住它"的键——
 * 这类遮蔽是"设置页改了却看不到效果"的根因（BLOCK-199 P0 缺陷族），必须可诊断而非静默。
 */
function envShadowedKeys(family, fileObj, env, lookup) {
  const out = [];
  if (!fileObj || typeof fileObj !== 'object') return out;
  const spec = CONFIG_FAMILIES[family];
  if (!spec || spec.precedence[0] !== 'env') return out;
  for (const [path, value] of Object.entries(fileObj)) {
    const entry = lookup(family, path);
    if (!entry || !entry.envKeys || entry.envKeys.length === 0) continue;
    const hit = entry.envKeys.find((k) => env && env[k] != null && env[k] !== '');
    if (!hit) continue;
    const envResolved = resolveEnvEntry(family, env[hit]);
    if (!envResolved) continue; // env 值不被该族承认（例如非 1/0/true/false 字面量）→ 不构成遮蔽
    out.push({ family, path, envKey: hit, envValue: env[hit], fileValue: value, overrides: envResolved.value !== value });
  }
  return out;
}

module.exports = {
  CONFIG_LAYERS,
  CONFIG_FAMILIES,
  CONFIG_KEYS,
  DIAGNOSTIC_CODES,
  findKeyEntry,
  findEntryByPath,
  validateValue,
  resolveEnvEntry,
  resolve,
  diagnoseObject,
  commitGuard,
  envShadowedKeys,
};
