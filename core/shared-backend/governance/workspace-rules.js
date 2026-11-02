'use strict';

/**
 * shared-backend/governance/workspace-rules.js — BLOCK-337 P0 工作区治理规则引擎。
 *
 * 职责边界（本包红线）：**引擎零业务词汇**。
 * 这里只有「谓词求值 + 包装载 + 规则投影」三类机制；「什么样的仓库算哪一类」
 * 「某类项目该守哪些纪律」全部写在 `resources/governance-packs/*.json` 的声明式
 * detect / rules 里。新增工作类型 = 加一个包 JSON，不改引擎（P7 ① 契约测扫描本文件）。
 *
 * 谓词（包 JSON 可用，全部对 workspacePath 求值）：
 *   { pathExists: 'a/b' }        文件或目录存在
 *   { globExists: '*.ext' }      递归匹配（深度受限，跳过 .git/node_modules）
 *   { gitRepo: true }            存在 .git 且是仓库
 *   { all: [...] } / { any: [...] } / { not: {...} }
 *
 * 装载优先级：包 JSON 里的 `priority` 降序；未匹配任何包 = `blank`（零规则，放权坡道兜底，
 * 这是合法默认而不是错误——新场景先能用，规则后置沉淀）。
 */

const fs = require('node:fs');
const path = require('node:path');
const { parseOpenAuditItems, clip } = require('./audit-open-items');
const { statusFromEntry } = require('./rule-lifecycle');

const PACK_DIRNAME = path.join('resources', 'governance-packs');
const MAX_SCAN_DEPTH = 3;
const MAX_SCAN_ENTRIES = 4000;
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '.venv', '__pycache__']);

function repoRoot() {
  return path.resolve(__dirname, '..', '..', '..');
}

function packDir() {
  return path.join(repoRoot(), PACK_DIRNAME);
}

/** 读取全部规则包（形状非法即跳过并记 diagnostic，绝不抛错阻断工作区打开）。 */
function loadGovernancePacks(dir = packDir()) {
  const packs = [];
  const diagnostics = [];
  let entries = [];
  try {
    entries = fs.readdirSync(dir).filter((name) => name.endsWith('.json')).sort();
  } catch (error) {
    return { packs, diagnostics: [{ code: 'pack_dir_unreadable', detail: error.message }] };
  }
  for (const name of entries) {
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
      if (!parsed || typeof parsed.id !== 'string' || !parsed.id.trim()) {
        diagnostics.push({ code: 'pack_missing_id', file: name });
        continue;
      }
      if (!parsed.detect || typeof parsed.detect !== 'object') {
        diagnostics.push({ code: 'pack_missing_detect', file: name });
        continue;
      }
      packs.push({
        id: parsed.id.trim(),
        version: Number(parsed.version) || 1,
        title: typeof parsed.title === 'string' ? parsed.title : parsed.id,
        priority: Number(parsed.priority) || 0,
        detect: parsed.detect,
        rules: Array.isArray(parsed.rules) ? parsed.rules : [],
        // BLOCK-337 P2 — 审计台路径由包声明（引擎零业务词）；未声明则不注入审计前置
        auditSource: typeof parsed.auditSource === 'string' && parsed.auditSource ? parsed.auditSource : undefined,
        file: name,
      });
    } catch (error) {
      diagnostics.push({ code: 'pack_parse_failed', file: name, detail: error.message });
    }
  }
  return { packs, diagnostics };
}

function safeStat(target) {
  try {
    return fs.statSync(target);
  } catch {
    return null;
  }
}

function pathExists(workspacePath, relPath) {
  if (typeof relPath !== 'string' || !relPath || relPath.includes('..')) return false;
  return Boolean(safeStat(path.join(workspacePath, relPath)));
}

/** 受限递归 glob：只支持 `*.ext` / `**\/*.ext` 形态，深度与条目数双上限。 */
function globExists(workspacePath, pattern) {
  if (typeof pattern !== 'string' || !pattern || pattern.includes('..')) return false;
  const normalized = pattern.replace(/^\*\*\//, '');
  const suffix = normalized.startsWith('*.') ? normalized.slice(1) : null;
  if (!suffix) return false;
  let visited = 0;
  const walk = (dir, depth) => {
    if (depth > MAX_SCAN_DEPTH || visited > MAX_SCAN_ENTRIES) return false;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return false;
    }
    for (const entry of entries) {
      visited += 1;
      if (visited > MAX_SCAN_ENTRIES) return false;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        if (walk(path.join(dir, entry.name), depth + 1)) return true;
        continue;
      }
      if (entry.name.toLowerCase().endsWith(suffix.toLowerCase())) return true;
    }
    return false;
  };
  return walk(workspacePath, 0);
}

function isGitRepo(workspacePath) {
  return pathExists(workspacePath, '.git');
}

/** 声明式谓词求值（未知谓词 = false + 记诊断，绝不猜）。 */
function evaluateDetect(node, workspacePath, diagnostics = []) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return false;
  if (Array.isArray(node)) return node.every((child) => evaluateDetect(child, workspacePath, diagnostics));
  if (Array.isArray(node.all)) return node.all.every((child) => evaluateDetect(child, workspacePath, diagnostics));
  if (Array.isArray(node.any)) return node.any.some((child) => evaluateDetect(child, workspacePath, diagnostics));
  if (node.not !== undefined) return !evaluateDetect(node.not, workspacePath, diagnostics);
  if (node.pathExists !== undefined) return pathExists(workspacePath, node.pathExists);
  if (node.globExists !== undefined) return globExists(workspacePath, node.globExists);
  if (node.gitRepo !== undefined) return isGitRepo(workspacePath) === (node.gitRepo !== false);
  diagnostics.push({ code: 'detect_unknown_predicate', detail: JSON.stringify(node).slice(0, 120) });
  return false;
}

/**
 * 解析某个工作区应挂载的治理规则包。
 * @returns {{kind:string, pack:object|null, rules:Array, evidence:Array, diagnostics:Array}}
 */
function resolveWorkspaceGovernance(workspacePath, options = {}) {
  const diagnostics = [];
  const packs = options.packs || loadGovernancePacks(options.packDir).packs;
  const root = typeof workspacePath === 'string' ? workspacePath : '';
  if (!root || !safeStat(root) || !safeStat(root).isDirectory()) {
    return { kind: 'blank', pack: null, rules: [], evidence: [], diagnostics: [{ code: 'workspace_missing', detail: root }] };
  }
  const ordered = [...packs].sort((a, b) => b.priority - a.priority);
  for (const pack of ordered) {
    if (evaluateDetect(pack.detect, root, diagnostics)) {
      return {
        kind: pack.id,
        pack,
        rules: pack.rules,
        evidence: [{ pack: pack.id, file: pack.file, priority: pack.priority }],
        diagnostics,
      };
    }
  }
  // 未识别 = 零规则（合法默认）：agent 全功能可用，不放任何纪律，也不报错
  return { kind: 'blank', pack: null, rules: [], evidence: [], diagnostics };
}

/** 按类别过滤规则（mechanical 可机械执行 / judgment 判断标准 / boundary 价值边界）。 */
function rulesByKind(rules, kind) {
  return (rules || []).filter((rule) => rule && rule.kind === kind);
}

/**
 * BLOCK-337 P7③ — 规则生效档位：账本 entries（pack::rule → {hits, misfires}）里
 * 误拦率超阈的规则降级 observe；未装载账本/无记录 = enforce（零行为变化）。
 */
function ruleMode(pack, rule, ledgerEntries) {
  if (!ledgerEntries || typeof ledgerEntries !== 'object') return 'enforce';
  const entry = ledgerEntries[`${pack.id}::${rule.id}`];
  if (!entry || typeof entry !== 'object') return 'enforce';
  return statusFromEntry(entry).mode;
}

/**
 * BLOCK-337 P2 — 工作区治理动态段（system-prompt 注入用）。
 * 受治理仓 → 规则条目 + （包声明了 auditSource 时的）未决审计前置；blank → ''（零变化）。
 * auditSource 路径由包 JSON 声明（引擎零业务词），解析失败=空，不阻断。
 * ledgerEntries（P7③）：降级 observe 的规则按观察档渲染，不硬性要求。
 */
function renderGovernanceRuntimeSection({ workspacePath, packDir: packDirOverride, limit = 5, ledgerEntries } = {}) {
  const resolved = resolveWorkspaceGovernance(workspacePath, packDirOverride ? { packDir: packDirOverride } : undefined);
  if (resolved.kind === 'blank' || !resolved.pack) return '';
  const pack = resolved.pack;
  const mechanical = rulesByKind(resolved.rules, 'mechanical').slice(0, 10);
  const judgment = rulesByKind(resolved.rules, 'judgment').slice(0, 5);
  if (mechanical.length === 0 && judgment.length === 0) return '';

  let section = `\n\n=== 工作区治理（自动装载：${clip(pack.title, 40)}） ===`;
  for (const rule of mechanical) {
    const label = ruleMode(pack, rule, ledgerEntries) === 'observe' ? '观察·待复盘' : '必须';
    section += `\n- [${label}] ${clip(rule.statement, 100)}`;
  }
  for (const rule of judgment) section += `\n- [判断] ${clip(rule.statement, 100)}`;

  if (typeof pack.auditSource === 'string' && pack.auditSource) {
    const openItems = parseOpenAuditItems(path.join(workspacePath, pack.auditSource), { limit });
    if (openItems.length > 0) {
      section += '\n\n开工前置（审计台未决项，先处理或明确说明评估结论）：';
      for (const item of openItems) section += `\n- [${item.severity}] ${item.summary}`;
    }
  }
  return section;
}

module.exports = {
  PACK_DIRNAME,
  packDir,
  loadGovernancePacks,
  evaluateDetect,
  resolveWorkspaceGovernance,
  rulesByKind,
  renderGovernanceRuntimeSection,
};
