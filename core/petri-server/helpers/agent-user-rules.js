'use strict';

/**
 * helpers/agent-user-rules.js — 用户 Agent 规则层（BLOCK-160 W2 P2/ORC-1）。
 *
 * 规则文件：$PETRI_LOCAL_DATA_DIR/agent-rules.json
 *   { version: 1, rules: [{ id, matcher: { type: 'path-glob'|'command-token', pattern },
 *                           action: 'deny'|'require-ack', scope: 'global', note?, createdAt? }] }
 *
 * 语义（预裁决缺省）：first-match 先到先判（与领域确认 hook 同语义）；
 * deny = 直接拦截；require-ack = 拦截并要求确认（ctx.dynamicGuardAcks 含
 * `rule:<id>` 键时放行——与 ORC-2 动态防护共用统一确认通道）。
 * 读缓存 fail-soft：文件缺失/损坏 = 空规则（零规则零行为，绝不因规则层故障阻断调用）。
 */

const fs = require('fs');
const path = require('path');
const schema = require('../../packages/shared-config/config-schema.js');
const dataPaths = require('../../shared-backend/data-paths.js');

const RULES_VERSION = 1;
const FAMILY = 'agent-rules';

/** 条目必填字段（形状/枚举真相在注册表；这里只表达"必填"这一关系）。 */
const REQUIRED_FIELDS = ['id', 'matcher.type', 'matcher.pattern', 'action'];

/**
 * BLOCK-203 W4a P4：错误码保持 BLOCK-160 契约不变（前端与既有测试都认这几个码），
 * 但判定来源改为注册表诊断 —— 一个校验器，两种出口（新诊断 + 旧错误码）。
 */
function legacyErrorFor(diagnostics) {
  const has = (p) => diagnostics.some((d) => d.path === p);
  if (has('id')) return 'rule_id_required';
  if (has('matcher.type')) return 'rule_matcher_type_invalid';
  if (has('matcher.pattern')) return 'rule_pattern_required';
  if (has('action')) return 'rule_action_invalid';
  if (diagnostics.some((d) => d.code === schema.DIAGNOSTIC_CODES.UNKNOWN_KEY)) return 'rule_field_unknown';
  return 'rule_invalid';
}

/** 单条规则消毒 + 必填检查（读侧只用 item，写侧看 diagnostics）。 */
function normalizeRule(raw) {
  const { item, diagnostics } = schema.sanitizeItem(FAMILY, raw);
  if (!item) {
    return { item: null, diagnostics: diagnostics.length ? diagnostics : [{ code: 'type-mismatch', path: '', family: FAMILY, message: '规则必须是对象' }] };
  }
  for (const field of REQUIRED_FIELDS) {
    const value = field.split('.').reduce((acc, key) => (acc && typeof acc === 'object' ? acc[key] : undefined), item);
    if (value === undefined) {
      diagnostics.push({ code: schema.DIAGNOSTIC_CODES.TYPE_MISMATCH, path: field, family: FAMILY, message: `缺少必填字段 ${field}` });
    }
  }
  return { item, diagnostics };
}
const CACHE_TTL_MS = 3000;

let _cache = { rules: [], loadedAt: 0, key: '' };

function rulesFile(dataDir) {
  return path.join(dataDir, 'agent-rules.json');
}

/** BLOCK-203 W4b P1 — 目录由 `shared-backend/data-paths` 统一解析（原为手写第三条链）。 */
function dataDir() {
  return dataPaths.resolveDataDir();
}

/** 读取规则（mtime 键缓存 + fail-soft）。 */
function loadUserRules() {
  const file = rulesFile(dataDir());
  let key = '';
  try {
    key = `${file}:${fs.statSync(file).mtimeMs}`;
  } catch {
    key = `${file}:missing`;
  }
  const now = Date.now();
  if (_cache.key === key && now - _cache.loadedAt < CACHE_TTL_MS) {
    return _cache.rules;
  }
  let rules = [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed && Array.isArray(parsed.rules)) {
      // 读侧宽容，但**分级**：
      //  · 未注册字段 = 忽略该字段，规则本身仍然有效（否则加个字段就把用户的规则弄失效）；
      //  · 值非法/缺必填 = 丢该条（不让一条脏规则废掉整层拦截）。
      rules = parsed.rules
        .map((rule) => normalizeRule(rule))
        .filter(({ item, diagnostics }) => item && !diagnostics.some((d) => d.code !== schema.DIAGNOSTIC_CODES.UNKNOWN_KEY))
        .map(({ item }) => item);
    }
  } catch {
    rules = [];
  }
  _cache = { rules, loadedAt: now, key };
  return rules;
}

/** 保存规则（整单替换；CRUD 路由的持久化底座）。 */
function saveUserRules(rules) {
  if (!Array.isArray(rules)) return { ok: false, error: 'rules_must_be_array' };
  const normalized = [];
  for (const raw of rules) {
    const { item, diagnostics } = normalizeRule(raw);
    if (!item || diagnostics.length > 0) {
      // 未知字段同样是"写不进"：此前它们会被原样 JSON.stringify 进盘并永久存活
      return { ok: false, error: legacyErrorFor(diagnostics), diagnostics };
    }
    normalized.push(item);
  }
  try {
    const file = rulesFile(dataDir());
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ version: RULES_VERSION, rules: normalized }, null, 2));
    _cache = { rules: normalized, loadedAt: Date.now(), key: `${file}:${fs.statSync(file).mtimeMs}` };
    return { ok: true, count: normalized.length };
  } catch (e) {
    return { ok: false, error: e.message, diagnostics: [] };
  }
}

/** 极简 glob（零依赖）：** 跨段、* 单段、? 单字符；大小写不敏感、路径分隔符归一。 */
function globToRegExp(pattern) {
  const normalized = pattern.replaceAll('\\', '/');
  let re = '';
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    if (ch === '*') {
      if (normalized[i + 1] === '*') {
        re += '.*';
        i++;
      } else {
        re += '[^/]*';
      }
    } else if (ch === '?') {
      re += '[^/]';
    } else {
      re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`, 'i');
}

function firstToken(command) {
  const raw = String(command || '').trim().split(/\s+/)[0]?.toLowerCase() || '';
  const base = raw.replace(/\.(exe|com|cmd|bat)$/, '');
  return base.includes('.') ? base.split('.')[0] : base;
}

/** 与 ORC-2 同源的提取口径：exec 工具取 command 全文，显式 path 字段取值。 */
const PATH_ARG_FIELDS = {
  workspace_write: ['path'],
  workspace_replace: ['path'],
  workspace_exec: ['cwd'],
  workspace_exec_background: ['cwd'],
};

function extractTargets(name, args = {}) {
  const targets = [];
  if (name === 'workspace_exec' || name === 'workspace_exec_background') {
    targets.push({ kind: 'command', value: String(args.command || '') });
  }
  const fields = PATH_ARG_FIELDS[name];
  if (fields) {
    for (const field of fields) {
      if (typeof args[field] === 'string' && args[field]) {
        targets.push({ kind: 'path', value: args[field] });
      }
    }
  }
  return targets;
}

/**
 * first-match 规则评估（纯函数；policy 判定序第二层）。命中返回
 * { rule, guardKey }；未命中 null。guardKey = `rule:<id>`（ack 通道键）。
 */
function evaluateUserRules(name, args, rules) {
  const list = Array.isArray(rules) ? rules : [];
  if (list.length === 0) return null;
  const targets = extractTargets(name, args);
  if (targets.length === 0) return null;
  for (const rule of list) {
    const { type, pattern } = rule.matcher || {};
    for (const target of targets) {
      let hit = false;
      if (type === 'command-token') {
        hit = target.kind === 'command' && firstToken(target.value) === pattern.trim().toLowerCase();
      } else if (type === 'path-glob') {
        // 锚定 + unanchored 双试：'secrets/**' 惯例上匹配任意层级的 secrets 目录
        const normalized = target.value.replaceAll('\\', '/');
        hit = globToRegExp(pattern).test(normalized)
          || globToRegExp('**/' + pattern).test(normalized);
      }
      if (hit) return { rule, guardKey: `rule:${rule.id}` };
    }
  }
  return null;
}

module.exports = {
  dataDir,
  loadUserRules,
  normalizeRule,
  saveUserRules,
  evaluateUserRules,
  rulesFile,
};
