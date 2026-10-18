'use strict';

const fs = require('node:fs');
const path = require('node:path');
const thresholds = require('./decision-thresholds');
// BLOCK-199 P2 — 启用档优先级取配置 schema 单源（阈值/gates 的数值与证据仍归 decision-thresholds）。
const { resolve: resolveConfigLayers, resolveEnvEntry } = require('../../packages/shared-config/config-schema.js');

const POINT_FAMILY = 'decision-points';

const NEWLINE = String.fromCharCode(10);

/**
 * helpers/decision-config.js — BLOCK-116 P4 决策配置中心（运行时真相，持久化 data 目录）。
 *
 * 契约（plan §P4）：
 *  - 五个运行时接点：enabled/threshold 可经配置文件调整；校准默认来自 decision-thresholds。
 *  - 优先级（BLOCK-211 C-32 清偿后，与实现一致）：`env='0'` 强制关（杀开关，最高，永不违逆）
 *    > 文件 `enabled` > **`env='1'` 仅作首载种子**（文件没有该键时才生效）> 注册表默认。
 *    也就是说 **设置页显式关掉的接点，不会被残留的 `PETRI_JEV_*=1` 重新打开**——
 *    此前实现是 `env 优先`，与这段注释相反（C-32），现已按注释语义修正。
 *  - 读不落盘（缺文件返回内存种子）；只有 setPointConfig 落盘——测试/只读路径零副作用。
 *  - 只覆盖五个运行时接点；failure-triage/test-suggest 为 CLI 工具不参与。
 */

const RUNTIME_POINTS = {
  'topic-shift': { label: '话题漂移判断', enabledDefault: true, envKey: 'PETRI_JEV_TOPIC_SHIFT' },
  'knowledge-guard': { label: '知识库二跳守卫', enabledDefault: false, envKey: 'PETRI_JEV_KNOWLEDGE_GUARD' },
  'marker-celltype': { label: 'marker→细胞类型判别', enabledDefault: false, envKey: 'PETRI_JEV_MARKER_GUARD' },
  'intent-route': { label: 'copilot 意图路由', enabledDefault: false, envKey: 'PETRI_JEV_INTENT_ROUTE' },
  // BLOCK-173 CP-10 — 转正：defaultOn=true（无 stored/env 配置时默认启用）。
  // env '0' 杀开关与设置页显式关仍最高优先。
  'tool-route': { label: '工具两跳预路由', enabledDefault: false, defaultOn: true, envKey: 'PETRI_JEV_TOOL_ROUTE' },
  // BLOCK-199 P4② — report-guard 此前是注册表外的隐藏开关（只能靠 env 且设置页不可见不可持久化）。
  // 纳入后语义不变：enabledDefault=false（默认零出站零行为变化），env 0/1 照旧，多出的能力是设置页可显式开并落盘。
  'report-guard': { label: '子智能体汇报门（P2 试点）', enabledDefault: false, envKey: 'PETRI_JEV_REPORT_GUARD' },
};

function configPath() {
  const base = process.env.PETRI_DECISION_CONFIG_PATH
    || path.join(process.env.PETRI_LOCAL_DATA_DIR || process.env.LOCAL_DATA_DIR || path.join(process.cwd(), 'data'), 'decision-config.json');
  return base;
}

function envValue(envKey) {
  const v = process.env[envKey];
  if (v === '0') return 'off';
  if (v === '1') return 'on';
  return undefined;
}

/** 内存种子（env='1' 沿用现状；否则校准默认）。读路径不落盘。 */
function seedDoc() {
  const points = {};
  for (const [point, meta] of Object.entries(RUNTIME_POINTS)) {
    points[point] = {
      // BLOCK-173 CP-10 — seedDoc 同样尊重 defaultOn（内存种子与解析口径一致）
      enabled: envValue(meta.envKey) === 'on' ? true : (meta.defaultOn === true || meta.enabledDefault === true),
      ...(thresholds[point]?.threshold != null ? { threshold: thresholds[point].threshold } : {}),
    };
  }
  return { version: 1, points };
}

function readDoc() {
  try {
    const doc = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
    if (doc && typeof doc === 'object' && doc.points) return doc;
  } catch { /* 缺文件/损坏 → 内存种子 */ }
  return seedDoc();
}

/** gates 部分覆盖合并：只接受注册表既有键、有限数值；registry 缺失/输入非法=原样返回默认。 */
function mergeGates(registryGates, storedGates) {
  if (!registryGates) return null;
  const merged = { ...registryGates };
  if (storedGates && typeof storedGates === 'object' && !Array.isArray(storedGates)) {
    for (const [key, value] of Object.entries(storedGates)) {
      if (key in registryGates && typeof value === 'number' && Number.isFinite(value)) {
        merged[key] = value;
      }
    }
  }
  return merged;
}

/**
 * BLOCK-199 P2 — 接点启用档的优先级解析接 shared-config 单源。
 * 三态胜负照现状逐字保真（由拆前基线 test/block199-config-compat.test.mjs 冻结）：
 * ① env '1'/'0' 命中即定（其它字面量不干预）；② 文件里有 `enabled` 键就按它（非 true 一律视为关）；
 * ③ 都没有时只认注册表 `defaultOn`（`enabledDefault` 走 seedDoc，不在这里二次生效）。
 * threshold/gates **不走通用层**：它们的默认值与证据绑在 decision-thresholds（改值须先重校准），
 * 通用 schema 只声明形状，不裁决校准数值——这是有意的边界，不是没做完。
 */
/**
 * 接点启用解析（BLOCK-211 C-32）：`env='0'` 杀开关 > 文件 > `env='1'` 种子 > 注册表默认。
 *
 * 为什么不能直接用通用的 `resolveConfigLayers`：通用模型只有 env/file/default 三层，
 * 而这里 `env` 有两种语义（kill / seed）。硬塞进去就得给 schema 加层类型，代价是
 * 让所有族都背上一个只有本族用得到的形状——所以在**本族**显式表达，并由
 * `test/block211-c32-env-seed.test.mjs` 的真相表钉住。
 */
function resolvePointEnabled(meta, stored, envRaw) {
  const envHit = resolveEnvEntry(POINT_FAMILY, envRaw);
  const hasStored = Object.prototype.hasOwnProperty.call(stored, 'enabled');
  // ① 杀开关：env='0' 永不违逆
  if (envHit && envHit.value === false) return false;
  // ② 文件（用户显式选择）优先于种子
  if (hasStored) return stored.enabled === true;
  // ③ env='1' 仅作首载种子
  if (envHit && envHit.value === true) return true;
  // ④ 注册表默认
  return resolveConfigLayers(POINT_FAMILY, { registry: meta.defaultOn === true }).value;
}

/** 生效配置（env='0' 强制关最高；env='1' 在 envOverride 如实暴露但不强制——以配置文件为准）。 */
function getPointRuntime(point) {
  const meta = RUNTIME_POINTS[point];
  if (!meta) return null;
  const doc = readDoc();
  const stored = doc.points[point] || {};
  const env = envValue(meta.envKey);
  const registry = thresholds[point] || {};
  return {
    point,
    label: meta.label,
    // BLOCK-173 CP-10 — defaultOn 接点（tool-route）无 stored/env 配置时默认启用；
    // 其余接点维持「显式存储才启用」不变。BLOCK-199 起该三态判定由 resolvePointEnabled 单源解析。
    enabled: resolvePointEnabled(meta, stored, process.env[meta.envKey]),
    envOverride: env || null,
    threshold: typeof stored.threshold === 'number' ? stored.threshold : registry.threshold,
    defaultThreshold: registry.threshold ?? null,
    // BK-05 阈值热调：gates 支持配置文件部分覆盖（stored.gates 键级 patch 叠在
    // 校准默认之上）；defaultGates 恒暴露校准原值供 UI/审计对照。
    gates: mergeGates(registry.gates || null, stored.gates),
    defaultGates: registry.gates ? { ...registry.gates } : null,
    evidence: registry.evidence || null,
  };
}

function getAllPointConfigs() {
  return Object.keys(RUNTIME_POINTS).map((point) => {
    const runtime = getPointRuntime(point);
    return {
      ...runtime,
      enabledDefault: RUNTIME_POINTS[point].enabledDefault,
      envKey: RUNTIME_POINTS[point].envKey,
    };
  });
}

/** gates 接点级不变量（合并默认+已存覆盖+新 patch 后校验；违反=拒绝写入）。 */
const GATES_INVARIANTS = {
  'topic-shift': [
    { describe: 'yes（判切换下界）必须大于 no（判未切换上界）', ok: (g) => !(g.yes <= g.no) },
  ],
  'output-judge': [
    { describe: 'fitRetry（RETRY 区下界）必须 ≤ fitPass（PASS 区下界）', ok: (g) => !(g.fitRetry > g.fitPass) },
  ],
};

/** 更新接点配置（落盘）。非法接点 null；非法值 TypeError 由端点转 400。 */
function setPointConfig(point, patch) {
  if (!RUNTIME_POINTS[point]) return null;
  if (!patch || typeof patch !== 'object') throw new TypeError('patch 必须是对象');
  if (patch.enabled !== undefined && typeof patch.enabled !== 'boolean') {
    throw new TypeError('enabled 必须是布尔');
  }
  if (patch.threshold !== undefined) {
    if (typeof patch.threshold !== 'number' || !Number.isFinite(patch.threshold) || patch.threshold < 0 || patch.threshold > 1) {
      throw new TypeError('threshold 必须是 [0,1] 内的有限数值');
    }
  }
  const doc = readDoc();
  doc.points[point] = { ...(doc.points[point] || {}) };
  if (patch.enabled !== undefined) doc.points[point].enabled = patch.enabled;
  if (patch.threshold !== undefined) doc.points[point].threshold = patch.threshold;
  // BK-05 — gates 热调（键级 patch）：键必须存在于注册表 gates；量表键（注册表值 ∈ (0,1]）
  // 限 [0,1]；写入前做接点级不变量校验（见 GATES_INVARIANTS），违反即 TypeError。
  if (patch.gates !== undefined) {
    if (!patch.gates || typeof patch.gates !== 'object' || Array.isArray(patch.gates)) {
      throw new TypeError('gates 必须是对象（键=注册表 gate 名）');
    }
    const registryGates = (thresholds[point] && thresholds[point].gates) || {};
    for (const [key, value] of Object.entries(patch.gates)) {
      if (!(key in registryGates)) {
        throw new TypeError(`gates 键 "${key}" 不在注册表（合法键：${Object.keys(registryGates).join(', ')}）`);
      }
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new TypeError(`gates.${key} 必须是有限数值`);
      }
      const regValue = registryGates[key];
      if (regValue > 0 && regValue <= 1 && (value < 0 || value > 1)) {
        throw new TypeError(`gates.${key} 为 [0,1] 量表键（注册表校准值 ${regValue}），新值必须在 [0,1] 内`);
      }
    }
    const merged = mergeGates(registryGates, { ...(doc.points[point].gates || {}), ...patch.gates });
    for (const rule of GATES_INVARIANTS[point] || []) {
      if (!rule.ok(merged)) {
        throw new TypeError(`gates 不变量违反：${rule.describe}`);
      }
    }
    doc.points[point].gates = { ...(doc.points[point].gates || {}), ...patch.gates };
  }
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(doc, null, 2) + NEWLINE, 'utf8');
  return getPointRuntime(point);
}

/** 决策模型供给（BLOCK-116 P5）：端点/Key/模型名——本地 Laya 等同类型供给改此三项即可。 */
function getProvider() {
  const doc = readDoc();
  if (doc.provider && doc.provider.apiKey) return doc.provider;
  // 一次性迁移：env 有 key 而文件未存 → 自动落盘（之后删除 jev.env 不影响）
  const envKey = process.env.TYPESAFE_API_KEY;
  if (!envKey) return null;
  const provider = {
    baseUrl: process.env.TYPESAFE_BASE_URL || 'https://api.typesafe.ai',
    apiKey: envKey,
    model: process.env.TYPESAFE_MODEL || 'jev-1.13.0',
  };
  try {
    doc.provider = provider;
    fs.mkdirSync(path.dirname(configPath()), { recursive: true });
    fs.writeFileSync(configPath(), JSON.stringify(doc, null, 2) + NEWLINE, 'utf8');
    console.log('[block116] provider migrated to', configPath());
  } catch (e) {
    console.error('[block116] provider migration write failed:', e && e.message);
  }
  return provider;
}

/** 更新模型供给（PUT）。baseUrl 必须 http(s) 开头；apiKey 必填非空。返回打码视图。 */
function setProvider(patch) {
  if (!patch || typeof patch !== 'object') throw new TypeError('patch 必须是对象');
  const doc = readDoc();
  const cur = doc.provider || {
    baseUrl: process.env.TYPESAFE_BASE_URL || 'https://api.typesafe.ai',
    apiKey: process.env.TYPESAFE_API_KEY || '',
    model: 'jev-1.13.0',
  };
  const next = {
    baseUrl: patch.baseUrl !== undefined ? String(patch.baseUrl) : cur.baseUrl,
    apiKey: patch.apiKey !== undefined ? String(patch.apiKey) : cur.apiKey,
    model: patch.model !== undefined ? String(patch.model) : cur.model,
  };
  if (!/^https?:\/\//i.test(next.baseUrl || '')) throw new TypeError('baseUrl 必须以 http(s):// 开头');
  if (!next.apiKey) throw new TypeError('apiKey 不能为空');
  if (!next.model) throw new TypeError('model 不能为空');
  doc.provider = next;
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(doc, null, 2) + NEWLINE, 'utf8');
  return { baseUrl: next.baseUrl, model: next.model, hasKey: true };
}

/** 打码视图（GET 用：永不回传 apiKey 原文）。 */
function getProviderMasked() {
  const p = getProvider();
  if (!p) return null;
  return { baseUrl: p.baseUrl, model: p.model, hasKey: Boolean(p.apiKey) };
}

/**
 * BLOCK-201 — 清空接点覆盖层（按区重置用）：只清 `points`，不动 `provider`。
 * 刻意不经过 `readDoc()`：文件缺失时它会返回 seedDoc（含默认值），拿种子回写等于把默认
 * 当成用户覆盖冻结进盘；这里直接写空覆盖层，读侧自然回落注册表默认。
 */
function clearPointOverrides() {
  const doc = { version: 1, points: {} };
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(doc, null, 2) + NEWLINE, 'utf8');
  return {};
}

module.exports = {
  RUNTIME_POINTS,
  getPointRuntime,
  getAllPointConfigs,
  setPointConfig,
  clearPointOverrides,
  configPath,
  getProvider,
  setProvider,
  getProviderMasked,
};
