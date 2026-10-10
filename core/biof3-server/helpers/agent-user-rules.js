'use strict';

/**
 * helpers/agent-user-rules.js — 用户 Agent 规则层（BLOCK-160 W2 P2/ORC-1）。
 *
 * 规则文件：$BIOF3_LOCAL_DATA_DIR/agent-rules.json
 *   { version: 1, rules: [{ id, matcher: { type: 'path-glob'|'command-token', pattern },
 *                           action: 'deny'|'require-ack', scope: 'global', note?, createdAt? }] }
 *
 * 语义（预裁决缺省）：first-match 先到先判（与领域确认 hook 同语义）；
 * deny = 直接拦截；require-ack = 拦截并要求确认（ctx.dynamicGuardAcks 含
 * `rule:<id>` 键时放行——与 ORC-2 动态防护共用统一确认通道）。
 * 读缓存 fail-soft：文件缺失/损坏 = 空规则（零规则零行为，绝不因规则层故障阻断调用）。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const RULES_VERSION = 1;
const CACHE_TTL_MS = 3000;

let _cache = { rules: [], loadedAt: 0, key: '' };

function rulesFile(dataDir) {
  return path.join(dataDir, 'agent-rules.json');
}

function dataDir() {
  return process.env.BIOF3_LOCAL_DATA_DIR
    || process.env.BIOF3_USER_DATA_DIR
    || path.join(os.homedir(), 'Documents', 'Gewu-Local');
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
      rules = parsed.rules.filter(
        (r) => r && typeof r.id === 'string' && r.id
          && r.matcher && typeof r.matcher.pattern === 'string'
          && (r.action === 'deny' || r.action === 'require-ack')
      );
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
  for (const r of rules) {
    if (!r || typeof r.id !== 'string' || !r.id) return { ok: false, error: 'rule_id_required' };
    if (!r.matcher || (r.matcher.type !== 'path-glob' && r.matcher.type !== 'command-token')) {
      return { ok: false, error: 'rule_matcher_type_invalid' };
    }
    if (typeof r.matcher.pattern !== 'string' || !r.matcher.pattern.trim()) {
      return { ok: false, error: 'rule_pattern_required' };
    }
    if (r.action !== 'deny' && r.action !== 'require-ack') {
      return { ok: false, error: 'rule_action_invalid' };
    }
  }
  try {
    const file = rulesFile(dataDir());
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ version: RULES_VERSION, rules }, null, 2));
    _cache = { rules: loadNormalized(rules), loadedAt: Date.now(), key: `${file}:${fs.statSync(file).mtimeMs}` };
    return { ok: true, count: rules.length };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function loadNormalized(rules) {
  // 保存后立即以同口径回填缓存（避免 mtime 粒度内读到旧值）
  return rules.filter(
    (r) => r && typeof r.id === 'string' && r.id
      && r.matcher && typeof r.matcher.pattern === 'string'
      && (r.action === 'deny' || r.action === 'require-ack')
  );
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
  loadUserRules,
  saveUserRules,
  evaluateUserRules,
  rulesFile,
};
