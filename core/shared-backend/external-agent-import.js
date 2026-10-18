'use strict';

/**
 * shared-backend/external-agent-import.js — 外部 Agent 配置的只读解析与映射（BLOCK-209 / W7d）。
 *
 * 定位：**预览器**，不是导入器。它把 Codex（TOML 子集）/ ZCode（JSON）的配置读成三张清单：
 *   ① `patch`               —— 能映射到 Petri 注册表键的值（键路径与 `shared-config` 对账）；
 *   ② `credentialsDetected` —— 命中凭据特征的键名（**值一律不进 patch**，D-2）；
 *   ③ `unsupported`         —— 本仓没有等价物的键（如实列出，不静默吞）。
 *
 * 三条纪律（也是本包的验收条款）：
 *  · **零写入零网络**：本模块只接字符串、只返对象；不 require fs/网络/任何 SDK；
 *  · **零依赖**：TOML 只支持 `key = value` / `[section]` / 注释 / 引号 / 布尔 / 数字这个子集，
 *    需要完整 TOML 语义时返回 `unsupported` 而不是"尽力猜"；
 *  · **不拷贝外部实现**：只按公开的配置键名做映射，仓内不含 Codex/ZCode 源码。
 */

const SOURCES = Object.freeze(['codex', 'zcode']);

/** 凭据特征：键名命中即拒绝自动导入（只记名不记值）。 */
const CREDENTIAL_KEY_RE = /(api[_-]?key|apikey|token|secret|password|passwd|credential)/i;

/** Codex `approval_policy` → Petri 四档（保守方向：不往宽里映射）。 */
const CODEX_APPROVAL_MAP = Object.freeze({
  untrusted: 'read',
  'on-failure': 'workspace-write',
  'on-request': 'workspace-write',
  never: 'full',
});

/** Codex `sandbox_mode` → Petri 四档（当 approval_policy 缺席时的次选）。 */
const CODEX_SANDBOX_MAP = Object.freeze({
  'read-only': 'read',
  'workspace-write': 'workspace-write',
  'danger-full-access': 'full',
});

/** Codex 已知键 → Petri 注册表键路径（值转换在 mapCodex 里做）。 */
const CODEX_KNOWN = Object.freeze([
  'model',
  'model_provider',
  'openai_base_url',
  'chatgpt_base_url',
  'approval_policy',
  'sandbox_mode',
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** 去掉 TOML 行内注释（引号内的 # 不算注释）。 */
function stripComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '#') return line.slice(0, i);
  }
  return line;
}

function parseTomlScalar(raw) {
  const value = String(raw).trim();
  if (!value) return '';
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  if (value.startsWith('[') || value.startsWith('{')) return { __unsupportedComplex: value };
  return value;
}

/**
 * Codex 配置解析（TOML 子集）。不认识的**结构**（嵌套表、数组表、多行字符串、内联表）
 * 会进 `unsupported`，不猜。
 * @returns {{values: object, unsupported: string[], diagnostics: Array}}
 */
function parseCodexConfig(text) {
  const values = {};
  const unsupported = [];
  const diagnostics = [];
  let section = '';
  const lines = String(text ?? '').split(/\r?\n/);
  lines.forEach((rawLine, index) => {
    const line = stripComment(rawLine).trim();
    if (!line) return;
    if (line.startsWith('[[')) {
      unsupported.push(`${line}（数组表不在 v1 支持范围）`);
      section = '';
      return;
    }
    if (line.startsWith('[') && line.endsWith(']')) {
      section = line.slice(1, -1).trim();
      return;
    }
    const eq = line.indexOf('=');
    if (eq <= 0) {
      diagnostics.push({ code: 'parse-error', path: `line:${index + 1}`, message: `无法解析的行：${line.slice(0, 60)}` });
      return;
    }
    const key = line.slice(0, eq).trim();
    const parsed = parseTomlScalar(line.slice(eq + 1));
    const fullKey = section ? `${section}.${key}` : key;
    if (isPlainObject(parsed) && parsed.__unsupportedComplex) {
      unsupported.push(`${fullKey}（复杂值不在 v1 支持范围）`);
      return;
    }
    values[fullKey] = parsed;
  });
  return { values, unsupported, diagnostics };
}

/** ZCode 配置解析（JSON）。 */
function parseZCodeConfig(text) {
  try {
    const parsed = JSON.parse(String(text ?? ''));
    if (!isPlainObject(parsed)) {
      return { values: {}, unsupported: [], diagnostics: [{ code: 'parse-error', path: '', message: 'ZCode 配置必须是 JSON 对象' }] };
    }
    return { values: parsed, unsupported: [], diagnostics: [] };
  } catch (error) {
    return { values: {}, unsupported: [], diagnostics: [{ code: 'parse-error', path: '', message: `JSON 解析失败：${error.message}` }] };
  }
}

/** 按内容特征判断来源（显式 source 优先，其次自动判断）。 */
function detectFormat(content, explicitSource) {
  if (explicitSource && SOURCES.includes(explicitSource)) return explicitSource;
  const trimmed = String(content ?? '').trim();
  if (trimmed.startsWith('{')) return 'zcode';
  if (/^\s*(\[[^\]]+\]|[A-Za-z_][\w.-]*\s*=)/m.test(trimmed)) return 'codex';
  return null;
}

function flattenKeys(obj, prefix = '', out = []) {
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(value)) flattenKeys(value, path, out);
    else out.push(path);
  }
  return out;
}

function valueAt(obj, path) {
  return path.split('.').reduce((acc, key) => (isPlainObject(acc) ? acc[key] : undefined), obj);
}

/** 校验 patch 里的每个键都能在注册表里找到（防"映射出一个不存在的配置"）。 */
function assertKnownPatchKeys(patch, schema) {
  const diagnostics = [];
  for (const key of Object.keys(patch)) {
    const [family, ...rest] = key.split('::');
    if (!family || !rest.length) {
      diagnostics.push({ code: 'bad-key-shape', path: key, message: `patch 键必须是 "family::path"：${key}` });
      continue;
    }
    if (!schema.findEntryByPath(family, rest.join('::'))) {
      diagnostics.push({ code: 'unknown-key', path: key, message: `注册表里没有 ${family}::${rest.join('::')}（映射表与 schema 漂移）` });
    }
  }
  return diagnostics;
}

/**
 * 映射为 Petri 视角。
 * @param {{source:'codex'|'zcode', content:string, schema:object}} input
 * @returns {{ok:boolean, source:string|null, patch:object, credentialsDetected:Array, unsupported:Array, notes:Array, diagnostics:Array}}
 */
function mapToPetri({ source, content, schema }) {
  const format = detectFormat(content, source);
  if (!format) {
    return {
      ok: false, source: null, patch: {}, credentialsDetected: [], unsupported: [], notes: [],
      diagnostics: [{ code: 'unknown-format', path: '', message: '无法识别配置格式（请显式指定 source=codex|zcode）' }],
    };
  }
  const parsed = format === 'codex' ? parseCodexConfig(content) : parseZCodeConfig(content);
  const patch = {};
  const notes = [];
  const unsupported = [...parsed.unsupported];
  const credentialsDetected = [];
  const diagnostics = [...parsed.diagnostics];

  if (format === 'codex') {
    const values = parsed.values;
    const model = values.model;
    const provider = values.model_provider;
    const baseUrl = values.openai_base_url || values.chatgpt_base_url;
    if (typeof model === 'string' && model) {
      // Petri 的模型选择落在 chat_model_presets / llm_provider：预览里只表达"建议值"，
      // 由上层决定写进哪个 preset（本包不写盘）。
      notes.push({ what: 'model', value: model, hint: '可写入 chat_model_presets[].model' });
    }
    if (typeof provider === 'string' && provider) notes.push({ what: 'model_provider', value: provider, hint: '对应 Petri llm_provider' });
    if (typeof baseUrl === 'string' && baseUrl) notes.push({ what: 'base_url', value: baseUrl, hint: '对应渠道 baseUrl（需人工确认协议）' });
    const approval = CODEX_APPROVAL_MAP[String(values.approval_policy || '')];
    const sandbox = CODEX_SANDBOX_MAP[String(values.sandbox_mode || '')];
    const mappedApproval = approval || sandbox;
    if (mappedApproval) {
      // 只预览"更严"的映射结果：approval/sandbox 都在时取更严的一档（不向宽里合并）
      if (approval && sandbox && approval !== sandbox) {
        const order = ['read', 'plan', 'workspace-write', 'full'];
        patch['runtime::approvalDefaultMode'] = order[Math.min(order.indexOf(approval), order.indexOf(sandbox))];
        notes.push({ what: 'approvalDefaultMode', value: patch['runtime::approvalDefaultMode'], hint: 'approval_policy 与 sandbox_mode 取更严者' });
      } else {
        patch['runtime::approvalDefaultMode'] = mappedApproval;
        notes.push({ what: 'approvalDefaultMode', value: mappedApproval, hint: approval ? '由 approval_policy 映射' : '由 sandbox_mode 映射' });
      }
    }
    if (values.history || values.tui || values.profile) {
      const structureKeys = Object.keys(values).filter((k) => CODEX_KNOWN.indexOf(k) === -1);
      for (const key of structureKeys) unsupported.push(`${key}（Petri 无等价物）`);
    }
  } else {
    // ZCode：只映射"最小可核对集"，其余如实列出（ZCode ≈150 项全量映射属 reopen）
    const flat = flattenKeys(parsed.values);
    for (const key of flat) {
      const value = valueAt(parsed.values, key);
      if (CREDENTIAL_KEY_RE.test(key)) {
        credentialsDetected.push({ path: key, reason: 'D-2：凭据永不自动导入' });
        continue;
      }
      if (/(^|\.)(model|defaultModel)$/i.test(key) && typeof value === 'string' && value) {
        notes.push({ what: 'model', value, hint: '可写入 chat_model_presets[].model' });
        continue;
      }
      if (/(^|\.)(baseUrl|base_url)$/i.test(key) && typeof value === 'string' && value) {
        notes.push({ what: 'base_url', value, hint: '对应渠道 baseUrl' });
        continue;
      }
      if (/(^|\.)(approvalPolicy|approval_policy|approvalMode)$/i.test(key) && typeof value === 'string') {
        const mapped = CODEX_APPROVAL_MAP[value] || CODEX_SANDBOX_MAP[value];
        if (mapped) {
          patch['runtime::approvalDefaultMode'] = mapped;
          notes.push({ what: 'approvalDefaultMode', value: mapped, hint: '由 ZCode 审批档映射' });
        } else {
          unsupported.push(`${key}=${value}（无法映射到 Petri 四档）`);
        }
        continue;
      }
      unsupported.push(`${key}（Petri 无等价物）`);
    }
    if (credentialsDetected.length === 0) {
      for (const key of flat) {
        const value = valueAt(parsed.values, key);
        if (typeof value === 'string' && /^sk-[A-Za-z0-9_-]{8,}$/.test(value)) {
          credentialsDetected.push({ path: key, reason: 'D-2：值形似 API Key，已拒绝自动导入' });
        }
      }
    }
  }

  // Codex 走同名凭据检测（键名 + 值形态双查，且值不进 patch）
  for (const [key, value] of Object.entries(parsed.values)) {
    if (CREDENTIAL_KEY_RE.test(key)) credentialsDetected.push({ path: key, reason: 'D-2：凭据永不自动导入' });
    else if (typeof value === 'string' && /^sk-[A-Za-z0-9_-]{8,}$/.test(value)) {
      credentialsDetected.push({ path: key, reason: 'D-2：值形似 API Key，已拒绝自动导入' });
    }
  }

  if (credentialsDetected.length > 0) {
    notes.push({
      what: 'credentials',
      value: credentialsDetected.length,
      hint: '检测到凭据：本预览不会导入它们；请到设置面手工填写（走凭据库，D-2）',
    });
  }

  const keyDiagnostics = assertKnownPatchKeys(patch, schema);
  diagnostics.push(...keyDiagnostics);
  return {
    ok: diagnostics.length === 0,
    source: format,
    patch,
    credentialsDetected,
    unsupported: [...new Set(unsupported)],
    notes,
    diagnostics,
  };
}

module.exports = {
  SOURCES,
  CREDENTIAL_KEY_RE,
  CODEX_APPROVAL_MAP,
  CODEX_SANDBOX_MAP,
  parseCodexConfig,
  parseZCodeConfig,
  detectFormat,
  mapToPetri,
};
