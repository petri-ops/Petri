'use strict';

/**
 * helpers/config-transfer.js — 设置全景导出 / 导入 / 按区重置（BLOCK-201 W2）。
 *
 * 三条纪律（与 BLOCK-199/200 同源，不新立第二套）：
 *  ① **不做第二实现**：每个族的读/写都委派给既有的单源 helper（feature-flags / decision-config /
 *     ai-settings / keymap / reasoning-config / network-config / runtime-policy / user-prefs），
 *     本模块只负责「打包 / 校验 / 分批应用」。
 *  ② **凭据永不进导出**（runlist D-2）：族集合 == shared-config 注册表族集合（BLOCK-203 起含
 *     `user-prefs` 外观三键），凭据、模型渠道 profiles 等仍不带入注册表的落点显式列入
 *     `CONFIG_TRANSFER_EXCLUDES` 并随导出信封一起回传，让「漏了什么」对用户可见，而不是静默缺。
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
const userPrefs = require('./user-prefs');
const skillPrefs = require('../../shared-backend/skill-prefs.js');
const userRules = require('./agent-user-rules');
const mcpSettings = require('./mcp-settings');
const toolPolicy = require('./mcp-tool-policy');
const memoryPolicy = require('./memory-policy');
const subagentProfile = require('./subagent-profile');
const trustPolicy = require('./trust-policy');
const retention = require('./data-retention');
const webSearch = require('./web-search-config');
const modelAccess = require('./model-access'); // BLOCK-264（C-37）

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
  // BLOCK-203 W4a（runlist W4a 首族：BLOCK-86 的外观偏好落点收编）
  'user-prefs',
  // BLOCK-203 W4a P3（BLOCK-177 的技能治理帐本；写入面是 IPC，不是 HTTP）
  'skills-prefs',
  // BLOCK-203 W4a P4（BLOCK-160 ORC-1 的用户 Agent 规则；集合型落点）
  'agent-rules',
  // BLOCK-203 W4a P5（BLOCK-156/163 的第三方 MCP server 清单；**导出剥离 env**，D-2）
  'mcp-servers',
  // BLOCK-204（W5）逐工具策略：导出/导入形状校验，**不做 unknown-tool 判定**
  // （备份可能来自另一台机器/另一批已连接 server；名字合法性由运行时写面把关）
  'mcp-tool-policy',
  // BLOCK-205（W6）记忆与压缩策略：只导出用户真正写过的键（覆盖层语义，不含默认值）
  'memory-policy',
  'subagent-profile',
  'trust-policy',
  'data-retention',
  // BLOCK-247（Q2b）联网检索授权与预算：导出的是用户覆盖层（开关/后端/预算/黑白名单）。
  // 导出**不含**任何凭据（本族本就无凭据：SearXNG 自建实例无需 key）。
  'web-search',
  // BLOCK-264（C-37）— 模型选择器权限来源（白名单/理由账本）
  'model-access',
]);

/** 显式排除清单：随信封回传，防止「以为备份了全部设置」。 */
const CONFIG_TRANSFER_EXCLUDES = Object.freeze([
  { what: 'credentials', reason: 'API Key 等凭据永不进导出（D-2）；请在设置页逐项确认后单独迁移' },
  { what: 'model-profiles', reason: '模型渠道 profiles 未进 shared-config 注册表，属 runlist W4（B1b）' },
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
    'user-prefs': { ...userPrefs.readPrefs() },
    'skills-prefs': { ...skillPrefs.loadPrefs() },
    'agent-rules': { version: 1, rules: userRules.loadUserRules() },
    'mcp-servers': { version: 1, servers: mcpSettings.listMcpServersForExport() },
    'mcp-tool-policy': toolPolicy.readStore(),
    'memory-policy': { ...memoryPolicy.readStored().values },
    'subagent-profile': subagentProfile.readStore(),
    'trust-policy': trustPolicy.readStore(),
    'data-retention': retention.readStore(),
    'web-search': { ...webSearch.readStore() },
    // BLOCK-264（C-37）— 模型白名单覆盖层（含理由账本；无凭据面）
    'model-access': { ...modelAccess.readStore() },
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
  if (family === 'network' || family === 'runtime' || family === 'web-search') {
    return schema.commitGuard(family, body, lookup).diagnostics;
  }
  if (family === 'data-retention') {
    return retention.validatePatch(body).map((d) => ({ ...d, family }));
  }
  if (family === 'trust-policy') {
    return trustPolicy.validateStore(body).map((d) => ({ ...d, family }));
  }
  if (family === 'subagent-profile') {
    return subagentProfile.validateStore(body).map((d) => ({ ...d, family }));
  }
  if (family === 'memory-policy') {
    // 复用落点的纯校验（未知键/越界/只读键同一份规则），导入不接受部分合法
    return memoryPolicy.validatePatch(body).map((d) => ({ ...d, family }));
  }
  if (family === 'mcp-tool-policy') {
    const limitEntry = schema.findKeyEntry('mcpPolicy.projectionLimit');
    const diagnostics = [];
    if (body.projectionLimit !== undefined) {
      const check = schema.validateValue(limitEntry, body.projectionLimit);
      if (!check.ok) diagnostics.push(diagnostic(family, 'projectionLimit', check.code, check.message));
    }
    if (!Array.isArray(body.tools)) {
      diagnostics.push(diagnostic(family, 'tools', 'type-mismatch', 'mcp-tool-policy.tools 必须是数组'));
      return diagnostics;
    }
    body.tools.forEach((entry, index) => {
      const { item, diagnostics: entryDiagnostics } = schema.sanitizeItem(family, entry);
      if (!item || !item.tool) {
        diagnostics.push(diagnostic(family, `tools[${index}]`, 'type-mismatch', '每条策略必须带 tool 字段'));
        return;
      }
      for (const d of entryDiagnostics) diagnostics.push({ ...d, path: `tools[${index}].${d.path}` });
    });
    return diagnostics;
  }
  if (family === 'mcp-servers') {
    if (!Array.isArray(body.servers)) return [diagnostic(family, 'servers', 'type-mismatch', 'mcp-servers.servers 必须是数组')];
    if (body.servers.length > mcpSettings.MAX_SERVERS) {
      return [diagnostic(family, 'servers', 'out-of-range', `最多 ${mcpSettings.MAX_SERVERS} 个 server（实得 ${body.servers.length}）`)];
    }
    const diagnostics = [];
    const seen = new Set();
    body.servers.forEach((entry, index) => {
      // 导入**不接受 env/headers**：导出已剥离（D-2），带凭据的导入会把明文塞进配置迁移链
      if (entry && typeof entry === 'object' && entry.env !== undefined) {
        diagnostics.push(diagnostic(family, `servers[${index}].env`, 'not-allowed', 'MCP env 是凭据，不随配置导入/导出（按 id 自动保留原值）'));
      }
      if (entry && typeof entry === 'object' && entry.headers !== undefined) {
        diagnostics.push(diagnostic(family, `servers[${index}].headers`, 'not-allowed', 'MCP headers 是凭据，不随配置导入/导出（按 id 自动保留原值）'));
      }
      const { server, error } = mcpSettings.normalizeServerEntry(entry);
      if (error) {
        diagnostics.push(diagnostic(family, `servers[${index}]`, 'not-allowed', `${error}`));
        return;
      }
      if (seen.has(server.id)) {
        diagnostics.push(diagnostic(family, `servers[${index}].id`, 'not-allowed', `重复的 server id：${server.id}`));
        return;
      }
      seen.add(server.id);
    });
    return diagnostics;
  }
  if (family === 'agent-rules') {
    // 集合型：逐条目走同一个 sanitizeItem（未知字段/非法枚举全拒）；导入不接受"部分条目合格"
    if (!Array.isArray(body.rules)) return [diagnostic(family, 'rules', 'type-mismatch', 'agent-rules.rules 必须是数组')];
    const diagnostics = [];
    body.rules.forEach((rule, index) => {
      const result = userRules.normalizeRule(rule);
      for (const d of result.diagnostics) diagnostics.push({ ...d, path: `rules[${index}].${d.path}` });
    });
    return diagnostics;
  }
  if (family === 'model-access') {
    // BLOCK-264（C-37）— 元素级校验在落点模块（saveModelAccess 的字符串项整批拒）
    const saved = modelAccess.saveModelAccess(body);
    return saved.ok ? [] : (saved.diagnostics || []).map((d) => ({ family: 'model-access', path: d.path || '', code: d.code, message: d.message }));
  }
  if (family === 'skills-prefs') {
    // 该族有代码自写字段（version/at/sourceDir），不能走 commitGuard（会按只读键全拒）；
    // 校验职责在落点模块的纯函数里（同一个 sanitize 逻辑供读写两侧复用）。
    return skillPrefs.validatePrefs(body);
  }
  if (family === 'user-prefs') {
    // **导入比落点写更严，这是刻意的**：落点侧对越界 fontScale 是钳位（BLOCK-86 既有语义，不改），
    // 而导入是整批事务——"夹住后再落盘"会让"导出→手改坏→导入"静默变成另一个值，
    // 破坏 BLOCK-201 的往返幂等验收。故导入走 commitGuard 全量拒（越界=out-of-range 诊断）。
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
  'user-prefs'(body) {
    const result = userPrefs.writePrefs(null, body);
    if (!result.ok) {
      const error = new Error('user-prefs 写入被拒');
      error.diagnostics = result.diagnostics;
      throw error;
    }
  },
  'skills-prefs'(body) {
    // 合并覆盖（导入不删文件里未出现的键）：合并与消毒都在落点模块里，transfer 不复制形状知识
    skillPrefs.importPrefs(body);
  },
  'data-retention'(body) {
    const saved = retention.writeStore(body, { actor: 'import' });
    if (!saved.ok) {
      const error = new Error('data-retention 写入被拒');
      error.diagnostics = saved.diagnostics;
      throw error;
    }
  },
  'trust-policy'(body) {
    // 导入也可能改信任级：同样落审计（actor='import'），避免"从文件导入"绕过留痕
    const saved = trustPolicy.writeStore(body, { actor: 'import' });
    if (!saved.ok) {
      const error = new Error('trust-policy 写入被拒');
      error.diagnostics = saved.diagnostics;
      throw error;
    }
  },
  'subagent-profile'(body) {
    const saved = subagentProfile.writeStore(body);
    if (!saved.ok) {
      const error = new Error('subagent-profile 写入被拒');
      error.diagnostics = saved.diagnostics;
      throw error;
    }
  },
  'memory-policy'(body) {
    const saved = memoryPolicy.writeStore(body);
    if (!saved.ok) {
      const error = new Error('memory-policy 写入被拒');
      error.diagnostics = saved.diagnostics;
      throw error;
    }
  },
  'mcp-tool-policy'(body) {
    const saved = toolPolicy.writeStore({
      projectionLimit: body.projectionLimit,
      tools: body.tools,
    });
    if (!saved.ok) {
      const error = new Error('mcp-tool-policy 写入被拒');
      error.diagnostics = saved.diagnostics;
      throw error;
    }
  },
  'mcp-servers'(body) {
    // 按 id 保留原 env/headers（导出已剥离它们）——否则"导出→导入"会静默清空所有 MCP 凭据
    const existing = new Map(mcpSettings.listMcpServers().map((s) => [s.id, { env: s.env, headers: s.headers }]));
    const next = body.servers.map((server) => {
      const prior = existing.get(server.id);
      // headers 只对远程传输有意义：导入时把远程 server 改成 stdio 不得把旧 headers 带回去
      const remote = server.transport === 'http' || server.transport === 'sse';
      return {
        ...server,
        env: prior ? prior.env : {},
        ...(remote && prior && prior.headers ? { headers: prior.headers } : {}),
      };
    });
    const saved = mcpSettings.saveMcpServers(next);
    if (saved.error) {
      const error = new Error('mcp-servers 写入被拒');
      error.diagnostics = [diagnostic('mcp-servers', '', 'write-failed', saved.error)];
      throw error;
    }
  },
  'agent-rules'(body) {
    // 整单替换（既有契约：PUT 即全量），规则合并语义不存在——first-match 顺序本身是用户数据
    const result = userRules.saveUserRules(body.rules);
    if (!result.ok) {
      const error = new Error('agent-rules 写入被拒');
      error.diagnostics = result.diagnostics || [];
      throw error;
    }
  },
  'web-search'(body) {
    // 合并覆盖（导入不删文件里未出现的键）；拒绝走共享注册表守卫（saveWebSearchConfig 抛带 diagnostics 的错）
    webSearch.saveWebSearchConfig(body);
  },
  // BLOCK-264（C-37）— 模型白名单导入（saveModelAccess 自带元素级校验，非法整批拒）
  'model-access'(body) {
    const saved = modelAccess.saveModelAccess(body);
    if (!saved.ok) {
      const error = new Error('model-access import failed');
      error.diagnostics = saved.diagnostics || [];
      throw error;
    }
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
  'user-prefs'() { userPrefs.resetPrefs(); },
  // 重置只清 disabled（用户治理覆盖层），保留 uninstalledSources（重装指针，不是"设置"）
  'skills-prefs'() { skillPrefs.resetPrefs(); },
  'agent-rules'() { userRules.saveUserRules([]); },
  'mcp-servers'() { mcpSettings.saveMcpServers([]); },
  'mcp-tool-policy'() { toolPolicy.resetToolPolicies(); },
  'memory-policy'() { memoryPolicy.resetMemoryPolicy(); },
  'subagent-profile'() { subagentProfile.resetProfiles(); },
  'trust-policy'() { trustPolicy.writeStore({ defaultLevel: trustPolicy.DEFAULT_LEVEL, projects: [] }, { actor: 'reset' }); },
  'data-retention'() { retention.resetRetention(); },
  // 重置 = 清空覆盖层 → 回落代码默认（默认关、不用检索后端、无黑白名单）
  'web-search'() { webSearch.writeStore({}); },
  'model-access'() { modelAccess.writeStore({ allowedModels: [], reasonNotes: {} }); },
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
