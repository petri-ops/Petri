'use strict';

/**
 * helpers/config-transfer.js — 设置全景导出 / 导入 / 按区重置（BLOCK-201 W2）。
 *
 * 三条纪律（与 BLOCK-199/200 同源，不新立第二套）：
 *  ① **不做第二实现**：每个族的读/写都委派给既有的单源 helper（feature-flags / decision-config /
 *     ai-settings / keymap / reasoning-config），本模块只负责「打包 / 校验 / 分批应用」。
 *  ② **凭据永不进导出**（runlist D-2）：本模块的族集合只含注册表 6 族，凭据、模型渠道 profiles、
 *     外观 prefs 等未注册落点显式列入 `CONFIG_TRANSFER_EXCLUDES` 并随导出信封一起回传，
 *     让「漏了什么」对用户可见，而不是静默缺。
 *  ③ **导出的是用户覆盖层，不是生效值**：env 覆盖与代码默认值都不落进导出文件——
 *     导出后再导入必须幂等，且不会把「今天的默认值」冻结成「用户的选择」。
 *
 * 读侧宽松 / 写侧拒绝的既有规矩照旧：导入先做**全量校验**（任一错误 → 整批不落盘），
 * 校验通过才逐族应用；未知族/未知键/非法值一律结构化诊断返回。
 */

const fs = require('fs');

const schema = require('../../packages/shared-config/config-schema.js');
const flags = require('./feature-flags');
const decisions = require('./decision-config');
const aiSettings = require('./ai-settings');
const keymap = require('./keymap');
const reasoningConfig = require('./reasoning-config');
const network = require('./network-config');
const runtimePolicy = require('./runtime-policy');

const CONFIG_TRANSFER_FORMAT = 'petri-config';
const CONFIG_TRANSFER_VERSION = 1;

/** 导出/导入覆盖的族：必须与 shared-config 注册表逐族相等（由 block201 基线与 drift 门双向钉）。 */
const CONFIG_TRANSFER_FAMILIES = Object.freeze([
  'feature-flags',
  'decision-points',
  'generation',
  'cost-cap',
  'keymap',
  'reasoning',
  // BLOCK-202 W3
  'network',
  'runtime',
]);

/** 显式排除清单：随信封回传，防止「以为备份了全部设置」。 */
const CONFIG_TRANSFER_EXCLUDES = Object.freeze([
  { what: 'credentials', reason: 'API Key 等凭据永不进导出（D-2）；请在设置页逐项确认后单独迁移' },
  { what: 'model-profiles', reason: '模型渠道 profiles 未进 shared-config 注册表，属 runlist W4（B1b）' },
  { what: 'appearance-and-user-prefs', reason: '外观/用户偏好仍走 user-prefs 落点，未进注册表，属 W4' },
  { what: 'compute-and-paths', reason: '计算位置与数据目录属 W4 的 data root 收敛范围' },
]);

const lookup = (family, storagePath) => schema.findEntryByPath(family, storagePath);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readDecisionOverrides() {
  try {
    const doc = JSON.parse(fs.readFileSync(decisions.configPath(), 'utf8'));
    return isPlainObject(doc) && isPlainObject(doc.points) ? doc.points : {};
  } catch {
    return {};
  }
}

function storedAiSettings() {
  const stored = aiSettings.getAiSettings();
  return isPlainObject(stored) ? stored : {};
}

function pickReasoningSection(section) {
  if (!isPlainObject(section)) return {};
  const out = {};
  if (section.defaultLevel !== undefined) out.defaultLevel = section.defaultLevel;
  if (section.anthropicHighBudgetTokens !== undefined) out.anthropicHighBudgetTokens = section.anthropicHighBudgetTokens;
  if (isPlainObject(section.mapping)) out.mapping = section.mapping;
  return out;
}

/** 摊平决策接点为注册表路径（`<point>.enabled` / `<point>.threshold`）。 */
function flattenDecisionPoints(points) {
  const flat = {};
  for (const [point, cfg] of Object.entries(points || {})) {
    if (!isPlainObject(cfg)) continue;
    for (const field of ['enabled', 'threshold']) {
      if (cfg[field] !== undefined) flat[`${point}.${field}`] = cfg[field];
    }
  }
  return flat;
}

/** 逐族存储覆盖层（只含用户真正落盘的值）。 */
function readFamilyOverrides() {
  const ai = storedAiSettings();
  const decisionPoints = readDecisionOverrides();
  const generation = isPlainObject(ai.generation) ? ai.generation : {};
  return {
    'feature-flags': { flags: flags.readStore() },
    'decision-points': { points: decisionPoints },
    generation: { ...generation },
    // 0/未设置都表示「无熔断」：导出统一归一为 null，否则「导出 → 导入（0）→ 再导出」不幂等
    // （这是 9223 实机腿 R7 当场抓到的漂移，单测只覆盖了已设值的路径）。
    'cost-cap': { costCapCny: typeof ai.costCapCny === 'number' && ai.costCapCny > 0 ? ai.costCapCny : null },
    keymap: { bindings: keymap.readStore() },
    reasoning: pickReasoningSection(ai.reasoning),
    network: { ...network.readStore() },
    runtime: { ...runtimePolicy.readStore() },
  };
}

/** env 遮蔽可见化：导出时点名「文件里有值但 env 正在盖住它」的键。 */
function collectEnvShadowed(families, env) {
  const pairs = [
    ['feature-flags', families['feature-flags'].flags],
    ['decision-points', flattenDecisionPoints(families['decision-points'].points)],
    ['generation', families.generation],
    ['cost-cap', families['cost-cap']],
    // runtime 的并发/深度有 env 覆盖层（PETRI_SPAWN_*），必须把遮蔽点名
    ['runtime', families.runtime],
  ];
  const out = [];
  for (const [family, obj] of pairs) {
    out.push(...schema.envShadowedKeys(family, obj, env, lookup));
  }
  return out;
}

/**
 * 全景导出：返回版本化信封。`families` 为**用户覆盖层**（不含默认值与 env 生效值）。
 * @param {{env?: NodeJS.ProcessEnv}} [options]
 */
function exportConfig(options = {}) {
  const env = options.env || process.env;
  const families = readFamilyOverrides();
  return {
    format: CONFIG_TRANSFER_FORMAT,
    version: CONFIG_TRANSFER_VERSION,
    exportedAt: new Date().toISOString(),
    families,
    excludes: CONFIG_TRANSFER_EXCLUDES.map((row) => ({ ...row })),
    envShadowed: collectEnvShadowed(families, env),
    note: '导出的是用户覆盖层（不含 API Key、不含代码默认值、不含 env 生效值）；导入为合并覆盖，不删除文件里未出现的键。',
  };
}

function diagnostic(family, pathValue, code, message) {
  return { family, path: pathValue, code, message };
}

/** 单族校验：返回错误诊断数组（空数组=通过）。 */
function validateFamily(family, body) {
  if (!isPlainObject(body)) {
    return [diagnostic(family, '', 'type-mismatch', `${family} 的内容必须是对象`)];
  }
  if (family === 'feature-flags') {
    if (!isPlainObject(body.flags)) return [diagnostic(family, 'flags', 'type-mismatch', 'feature-flags.flags 必须是对象')];
    return schema.commitGuard('feature-flags', body.flags, lookup).diagnostics;
  }
  if (family === 'decision-points') {
    if (!isPlainObject(body.points)) return [diagnostic(family, 'points', 'type-mismatch', 'decision-points.points 必须是对象')];
    const diagnostics = [];
    const flat = {};
    for (const [point, cfg] of Object.entries(body.points)) {
      if (!decisions.RUNTIME_POINTS[point]) {
        diagnostics.push(diagnostic(family, point, 'unknown-key', `未知决策接点 ${point}（写侧拒绝）`));
        continue;
      }
      if (!isPlainObject(cfg)) {
        diagnostics.push(diagnostic(family, point, 'type-mismatch', `${point} 的内容必须是对象`));
        continue;
      }
      for (const [field, value] of Object.entries(cfg)) {
        if (field !== 'enabled' && field !== 'threshold') {
          diagnostics.push(diagnostic(family, `${point}.${field}`, 'unknown-key', `未知字段 ${field}（只认 enabled/threshold）`));
          continue;
        }
        flat[`${point}.${field}`] = value;
      }
    }
    diagnostics.push(...schema.commitGuard('decision-points', flat, lookup).diagnostics);
    return diagnostics;
  }
  if (family === 'generation') {
    return schema.commitGuard('generation', body, lookup).diagnostics;
  }
  if (family === 'cost-cap') {
    const value = body.costCapCny;
    if (value === null || value === undefined) return [];
    return schema.commitGuard('cost-cap', { costCapCny: value }, lookup).diagnostics;
  }
  if (family === 'keymap') {
    if (!isPlainObject(body.bindings)) return [diagnostic(family, 'bindings', 'type-mismatch', 'keymap.bindings 必须是对象')];
    return schema.commitGuard('keymap', body.bindings, lookup).diagnostics;
  }
  if (family === 'reasoning') {
    return reasoningConfig.validateReasoningPatch(body);
  }
  if (family === 'network' || family === 'runtime') {
    return schema.commitGuard(family, body, lookup).diagnostics;
  }
  return [diagnostic(family, '', 'unknown-family', `未登记的配置族 ${family}`)];
}

/**
 * 导入校验：信封形状 + 逐族全量校验。**不落盘**。
 * @returns {{ok:boolean, diagnostics:Array, families:object}}
 */
function validateImport(envelope) {
  const diagnostics = [];
  if (!isPlainObject(envelope)) {
    return { ok: false, families: {}, diagnostics: [diagnostic('', '', 'type-mismatch', '导入内容必须是对象')] };
  }
  if (envelope.format !== CONFIG_TRANSFER_FORMAT) {
    return {
      ok: false,
      families: {},
      diagnostics: [diagnostic('', 'format', 'not-allowed', `不是 Petri 配置文件（format 需为 ${CONFIG_TRANSFER_FORMAT}）`)],
    };
  }
  if (envelope.version !== CONFIG_TRANSFER_VERSION) {
    return {
      ok: false,
      families: {},
      diagnostics: [diagnostic('', 'version', 'not-supported', `不支持的版本 ${String(envelope.version)}（当前只认 ${CONFIG_TRANSFER_VERSION}）`)],
    };
  }
  if (!isPlainObject(envelope.families)) {
    return { ok: false, families: {}, diagnostics: [diagnostic('', 'families', 'type-mismatch', 'families 必须是对象')] };
  }
  const families = {};
  for (const [family, body] of Object.entries(envelope.families)) {
    if (!CONFIG_TRANSFER_FAMILIES.includes(family)) {
      diagnostics.push(diagnostic(family, '', 'unknown-family', `未登记的配置族 ${family}`));
      continue;
    }
    const familyDiagnostics = validateFamily(family, body);
    if (familyDiagnostics.length > 0) diagnostics.push(...familyDiagnostics);
    else families[family] = body;
  }
  return { ok: diagnostics.length === 0, families, diagnostics };
}

const WRITERS = {
  'feature-flags'(body) {
    for (const [key, value] of Object.entries(body.flags)) flags.setFlag(key, value);
  },
  'decision-points'(body) {
    for (const [point, cfg] of Object.entries(body.points)) {
      const patch = {};
      if (cfg.enabled !== undefined) patch.enabled = cfg.enabled;
      if (cfg.threshold !== undefined) patch.threshold = cfg.threshold;
      decisions.setPointConfig(point, patch);
    }
  },
  generation(body) {
    aiSettings.saveGenerationDefaults(body);
  },
  'cost-cap'(body) {
    const stored = storedAiSettings();
    const next = body.costCapCny === null || body.costCapCny === undefined ? 0 : body.costCapCny;
    aiSettings.saveAiSettings({ ...stored, costCapCny: next });
  },
  keymap(body) {
    keymap.setKeymapBindings(body.bindings);
  },
  reasoning(body) {
    reasoningConfig.saveReasoning(body);
  },
  network(body) {
    network.saveNetworkConfig(body);
  },
  runtime(body) {
    runtimePolicy.saveRuntimePolicy(body);
  },
};

/**
 * 导入：先全量校验，通过后逐族应用。任一校验错误 → 零写入。
 * @returns {{ok:boolean, applied:string[], diagnostics:Array}}
 */
function importConfig(envelope) {
  const validation = validateImport(envelope);
  if (!validation.ok) return { ok: false, applied: [], diagnostics: validation.diagnostics };
  const applied = [];
  try {
    for (const family of CONFIG_TRANSFER_FAMILIES) {
      if (!Object.prototype.hasOwnProperty.call(validation.families, family)) continue;
      WRITERS[family](validation.families[family]);
      applied.push(family);
    }
    return { ok: true, applied, diagnostics: [] };
  } catch (error) {
    const diagnostics = Array.isArray(error && error.diagnostics)
      ? error.diagnostics
      : [diagnostic(applied[applied.length - 1] || '', '', 'write-failed', (error && error.message) || String(error))];
    return { ok: false, applied, diagnostics };
  }
}

const RESETTERS = {
  'feature-flags'() { flags.writeStore({}); },
  'decision-points'() { decisions.clearPointOverrides(); },
  generation() { aiSettings.saveGenerationDefaults({ temperature: null, maxTokens: null }); },
  'cost-cap'() {
    const stored = storedAiSettings();
    aiSettings.saveAiSettings({ ...stored, costCapCny: 0 });
  },
  keymap() { keymap.writeStore({}); },
  reasoning() { aiSettings.saveReasoningSection({}); },
  network() { network.writeStore({}); },
  runtime() { runtimePolicy.writeStore({}); },
};

/**
 * 按区重置：只接收注册表族名；逐族清除用户覆盖层 → 回落代码默认。
 * 语义=「恢复默认」，不删除任何用户数据（对话/项目/结果/凭据一概不碰）。
 * @returns {{ok:boolean, reset:string[], diagnostics:Array}}
 */
function resetConfigFamilies(families) {
  const list = Array.isArray(families) ? families : [];
  if (list.length === 0) {
    return { ok: false, reset: [], diagnostics: [diagnostic('', 'families', 'type-mismatch', 'families 必须是非空数组')] };
  }
  const unknown = list.filter((family) => !CONFIG_TRANSFER_FAMILIES.includes(family));
  if (unknown.length > 0) {
    return {
      ok: false,
      reset: [],
      diagnostics: unknown.map((family) => diagnostic(family, '', 'unknown-family', `未登记的配置族 ${family}`)),
    };
  }
  const reset = [];
  try {
    for (const family of list) {
      RESETTERS[family]();
      reset.push(family);
    }
    return { ok: true, reset, diagnostics: [] };
  } catch (error) {
    return {
      ok: false,
      reset,
      diagnostics: [diagnostic(reset[reset.length - 1] || '', '', 'write-failed', (error && error.message) || String(error))],
    };
  }
}

module.exports = {
  CONFIG_TRANSFER_FORMAT,
  CONFIG_TRANSFER_VERSION,
  CONFIG_TRANSFER_FAMILIES,
  CONFIG_TRANSFER_EXCLUDES,
  exportConfig,
  validateImport,
  importConfig,
  resetConfigFamilies,
  // 供测试构造/诊断（不构成第二真相：读的仍是既有 helper）
  readFamilyOverrides,
};
