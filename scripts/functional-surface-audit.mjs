#!/usr/bin/env node
/**
 * scripts/functional-surface-audit.mjs — 功能面全量核对矩阵（2026-11-04）
 *
 * 形态：专项 / 归因（只读报表，不改产品代码）。
 * 目的：把「能力写完但用户用不到」从抽样变穷举——工具 / IPC / 路由 / 设置键
 * 四类面逐点判定，输出机器可读 JSON + 人可读 Markdown。
 *
 * 基线口径（重要）：源码一律取 `git show HEAD:<path>`，不读工作区。
 * 原因=并行会话在制时工作区可能处于语法中间态，读工作区会让矩阵不可复现。
 * 工作区脏文件单独列出并标注「在制」，不计入判定。
 *
 * 用法：
 *   node scripts/functional-surface-audit.mjs          # 全量 + 写 JSON/MD
 *   node scripts/functional-surface-audit.mjs --check  # P1>0 → exit 1（可作门禁）
 *   node scripts/functional-surface-audit.mjs --verbose # 追加 IPC 未消费明细
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const ARGV = new Set(process.argv.slice(2));
const VERBOSE = ARGV.has('--verbose');

const OUT_JSON = path.join(ROOT, 'acceptance', 'functional-audit-2026-11-04', 'surface-matrix.json');
const OUT_MD = path.join(ROOT, 'docs', 'functional-surface-matrix-2026-11-04.md');

const DEFS_FACADE = 'core/petri-server/agent-tools/tool-defs.js';
const REGISTRY = 'core/petri-server/agent-tools/registry.js';
const METADATA = 'core/petri-server/agent-tools/tool-metadata.js';

// ── 基础 ──────────────────────────────────────────────────────

function sh(args) {
  return execFileSync(args[0], args.slice(1), { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

/** 默认取 HEAD 保证可复现；--worktree 时读工作区（开发中验证未提交修复用）。 */
const USE_WORKTREE = ARGV.has('--worktree');

function src(rel) {
  const abs = path.join(ROOT, rel);
  if (USE_WORKTREE && fs.existsSync(abs)) return fs.readFileSync(abs, 'utf8');
  try { return sh(['git', 'show', `HEAD:${rel}`]); } catch {
    return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
  }
}

function listFiles(dirRel, ext = '.js') {
  const abs = path.join(ROOT, dirRel);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs).filter((f) => f.endsWith(ext)).map((f) => path.posix.join(dirRel, f));
}

/** 从 startIdx 起找第一个 '{' 并配平，返回块内文本。 */
function braceBlock(text, startIdx) {
  const i = text.indexOf('{', startIdx);
  if (i < 0) return null;
  let depth = 0; let inStr = null;
  for (let p = i; p < text.length; p += 1) {
    const ch = text[p]; const prev = text[p - 1];
    if (inStr) { if (ch === inStr && prev !== '\\') inStr = null; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}') { depth -= 1; if (depth === 0) return text.slice(i + 1, p); }
  }
  return null;
}

function objectBlock(text, name) {
  const re = new RegExp(`const\\s+${name}\\s*=\\s*\\{`);
  const m = re.exec(text);
  return m ? braceBlock(text, m.index) : null;
}

function topLevelKeys(block) {
  if (!block) return [];
  const keys = [];
  let depth = 0; let inStr = null; let lineStart = 0;
  for (let p = 0; p <= block.length; p += 1) {
    const ch = block[p] ?? '\n'; const prev = block[p - 1];
    if (inStr) { if (ch === inStr && prev !== '\\') inStr = null; if (ch === '\n') lineStart = p + 1; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue; }
    if (ch === '{' || ch === '[' || ch === '(') depth += 1;
    else if (ch === '}' || ch === ']' || ch === ')') depth -= 1;
    else if (ch === '\n') {
      if (depth === 0) {
        const line = block.slice(lineStart, p).trim();
        const m = /^([A-Za-z_$][\w$]*)\s*:/.exec(line);
        if (m) keys.push(m[1]);
      }
      lineStart = p + 1;
    }
  }
  return keys;
}

function splitTopLevel(text) {
  const parts = []; let depth = 0; let cur = ''; let inStr = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]; const prev = text[i - 1];
    if (inStr) { cur += ch; if (ch === inStr && prev !== '\\') inStr = null; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; cur += ch; continue; }
    if (ch === '[' || ch === '(' || ch === '{') depth += 1;
    if (ch === ']' || ch === ')' || ch === '}') depth -= 1;
    if (ch === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

function parenBody(text, openIdx) {
  let depth = 0; let inStr = null;
  for (let p = openIdx; p < text.length; p += 1) {
    const ch = text[p]; const prev = text[p - 1];
    if (inStr) { if (ch === inStr && prev !== '\\') inStr = null; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue; }
    if (ch === '(') depth += 1;
    else if (ch === ')') { depth -= 1; if (depth === 0) return text.slice(openIdx + 1, p); }
  }
  return '';
}

const uniq = (arr) => [...new Set(arr)];

/**
 * 域文件里的常量 require 桩：既可调用、又可迭代、任意属性返回自身。
 * 目的=让 `...require('./x')` / `[...RENDER_VIEWS]` / `RENDER_VIEWS.map(...)` 都不抛错，
 * 从而把域文件求值成真实数组（而非降级文本提取）。
 * 不触真实 IO（桩不读文件系统）。
 */
function makeStub() {
  const fn = function stubFn() { return proxy; };
  const proxy = new Proxy(fn, {
    get(_t, prop) {
      if (prop === Symbol.iterator) return function* emptyIter() { /* 空迭代 */ };
      if (prop === 'length') return 0;
      if (prop === 'then') return undefined;
      if (prop === Symbol.toPrimitive) return () => '';
      return proxy;
    },
    apply() { return proxy; },
    construct() { return proxy; },
  });
  return proxy;
}

// ── 1. 工具面 ─────────────────────────────────────────────────

function collectToolDefs() {
  const facade = src(DEFS_FACADE) ?? '';
  const domains = uniq([...facade.matchAll(/require\(['"]\.\/tool-defs\/([\w-]+)(?:\.js)?['"]\)/g)].map((m) => m[1]));
  const tools = [];
  const notes = [];
  for (const domain of domains) {
    const rel = `core/petri-server/agent-tools/tool-defs/${domain}.js`;
    const text = src(rel);
    if (!text) continue;
    let arr = null;
    try {
      const fn = new Function('module', 'exports', 'require', `${text}\n;return module.exports;`);
      const mod = { exports: {} };
      // 域文件内部的相对 require（如 agent-orchestration 的 `...require('./goals')`）
      // 必须真实解析，否则会把「已汇编」误判成「未汇编」。
      const domainRequire = createRequire(path.join(ROOT, rel));
      const localRequire = (id) => {
        try { return domainRequire(id); } catch { return makeStub(); }
      };
      arr = fn(mod, mod.exports, localRequire) || mod.exports;
    } catch (e) {
      // 降级：文本提取（工具名可靠，schema 缺省 → 漂移判定自动跳过）
      const names = uniq([...text.matchAll(/["']?name["']?\s*:\s*['"]([A-Za-z_$][\w$]*)['"]/g)].map((m) => m[1]));
      arr = names.map((n) => ({ type: 'function', function: { name: n, description: '', parameters: null } }));
      notes.push({ domain, mode: 'text-fallback', reason: String(e.message || e).slice(0, 100), extracted: names.length });
    }
    for (const def of Array.isArray(arr) ? arr : []) {
      const fnDef = def && def.function;
      if (!fnDef || !fnDef.name) continue;
      const hasParameters = Boolean(fnDef.parameters);
      const props = fnDef.parameters && fnDef.parameters.properties
        ? Object.keys(fnDef.parameters.properties) : [];
      const required = (fnDef.parameters && fnDef.parameters.required) || [];
      tools.push({ name: fnDef.name, domain, props, required, hasParameters });
    }
  }
  return { tools, domains, notes };
}

function collectContracts() {
  const text = src(REGISTRY) ?? '';
  const start = text.search(/const\s+CONTRACTS\s*=\s*\{/);
  const block = start < 0 ? '' : (braceBlock(text, start) ?? '');
  const out = new Map();
  const re = /(^|\n)\s{2}([A-Za-z_$][\w$]*)\s*:\s*contract\(/g;
  for (const m of block.matchAll(re)) {
    const openIdx = block.indexOf('(', m.index + m[0].length - 'contract'.length);
    const body = parenBody(block, openIdx);
    if (!body) continue;
    const parts = splitTopLevel(body);
    out.set(m[2], {
      category: (parts[0] || '').replace(/['"]/g, ''),
      sideEffect: (parts[1] || '').replace(/['"]/g, ''),
      riskTier: (parts[2] || '').replace(/['"]/g, ''),
      durationMs: parts[4] || '',
    });
  }
  return out;
}

function collectHandlers() {
  const text = src(REGISTRY) ?? '';
  const block = objectBlock(text, 'HANDLERS') ?? '';
  const keys = new Set(topLevelKeys(block));
  // shorthand 属性（`  spawn_agent,`）也要算
  for (const m of block.matchAll(/(^|\n)\s{2}([A-Za-z_$][\w$]*)\s*,?\s*(?=\n)/g)) keys.add(m[2]);
  return { set: keys, hasSpread: /(^|\n)\s*\.\.\./.test(block) };
}

function collectMetadata() {
  const text = src(METADATA) ?? '';
  const block = objectBlock(text, 'TOOL_METADATA') ?? '';
  const out = new Map();
  const re = /(^|\n)\s*([A-Za-z_$][\w$]*)\s*:\s*\{([^{}]*)\}/g;
  for (const m of block.matchAll(re)) {
    const body = m[3];
    out.set(m[2], {
      readOnly: /readOnly:\s*true/.test(body),
      destructive: /destructive:\s*true/.test(body),
      concurrentSafe: /concurrentSafe:\s*true/.test(body),
      needsApproval: /needsApproval:\s*true/.test(body),
      riskLevel: (/riskLevel:\s*'([^']+)'/.exec(body) || [])[1] || null,
    });
  }
  return out;
}

/** 实现函数体内读到的 args 键。 */
function collectArgsUsage() {
  const usage = new Map();
  for (const rel of listFiles('core/petri-server/agent-tools', '.js')) {
    const text = src(rel);
    if (!text) continue;
    const chunks = text.split(/\n(?:async\s+)?function\s+/);
    for (const chunk of chunks) {
      const head = /^([\w$]+)/.exec(chunk);
      if (!head) continue;
      const toolName = head[1].startsWith('tool_') ? head[1].slice(5) : head[1];
      const keys = uniq([
        ...[...chunk.matchAll(/\bargs\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]),
        ...[...chunk.matchAll(/\bargs\[['"]([^'"]+)['"]\]/g)].map((m) => m[1]),
      ]);
      if (keys.length === 0) continue;
      usage.set(toolName, uniq([...(usage.get(toolName) || []), ...keys]));
    }
  }
  return usage;
}

function policyReachability(tools, contracts) {
  let policy = null;
  try { policy = require(path.join(ROOT, 'core/petri-server/agent-tools/agent-tool-policy.js')); } catch { return null; }
  const rows = [];
  for (const tool of tools) {
    const c = contracts.get(tool.name);
    if (!c) continue;
    const contract = { category: c.category, sideEffect: c.sideEffect, riskTier: c.riskTier };
    const row = { name: tool.name };
    for (const mode of ['read', 'workspace-write', 'full']) {
      try { row[mode] = policy.decideAgentToolCall({ name: tool.name, args: {}, ctx: { accessMode: mode }, contract }).decision; }
      catch { row[mode] = 'error'; }
    }
    try {
      row.planMode = policy.decideAgentToolCall({ name: tool.name, args: {}, ctx: { accessMode: 'full', planMode: true }, contract }).decision;
    } catch { row.planMode = 'error'; }
    rows.push(row);
  }
  return rows;
}

// ── 2. IPC 面 ─────────────────────────────────────────────────

function collectChannels() {
  let mod = null;
  try { mod = require(path.join(ROOT, 'src/ipc/channels.js')); } catch { return []; }
  const out = [];
  const walk = (obj) => { for (const v of Object.values(obj)) { if (typeof v === 'string') out.push(v); else if (v && typeof v === 'object') walk(v); } };
  walk(mod);
  return uniq(out);
}

function collectPreloadChannels() {
  const text = src('src/preload.js') ?? '';
  const out = [
    ...[...text.matchAll(/ipcRenderer\.(?:invoke|send)\(\s*'([^']+)'/g)].map((m) => m[1]),
    ...[...text.matchAll(/ipcRenderer\.on\(\s*'([^']+)'/g)].map((m) => m[1]),
  ];
  // 常量形式：preload 自包含字面量常量（如 AGENT_WORKBENCH_FLAG_CHANNEL = 'petri:agent-workbench-flags'）
  // + `ipcRenderer.invoke(CONST)`。不解析会导致「有包装」被误判为漏包装。
  const consts = new Map();
  for (const m of text.matchAll(/const\s+([A-Z_][A-Z0-9_]*)\s*=\s*'([^']+)'/g)) consts.set(m[1], m[2]);
  for (const m of text.matchAll(/ipcRenderer\.(?:invoke|send)\(\s*([A-Z_][A-Z0-9_]*)\s*[,)]/g)) {
    const ch = consts.get(m[1]);
    if (ch) out.push(ch);
  }
  return uniq(out);
}

function collectRendererStrings() {
  const hits = new Set();
  const walk = (rel) => {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) return;
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const child = path.posix.join(rel, entry.name);
      if (entry.isDirectory()) { if (!entry.name.startsWith('.') && entry.name !== 'node_modules') walk(child); continue; }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      const text = fs.readFileSync(path.join(ROOT, child), 'utf8');
      for (const m of text.matchAll(/['"]([a-z][a-z0-9-]*:[a-z0-9:-]+)['"]/g)) hits.add(m[1]);
    }
  };
  walk('frontend/src');
  return hits;
}

// ── 3. 路由面 ─────────────────────────────────────────────────

function collectRoutes() {
  const indexText = src('core/petri-server/routes/index.js') ?? '';
  const mounted = uniq([...indexText.matchAll(/require\('\.\/([\w-]+)'\)/g)].map((m) => m[1]));
  const files = listFiles('core/petri-server/routes', '.js')
    .filter((f) => !f.endsWith('/index.js'))
    .map((f) => path.posix.basename(f, '.js'));
  const endpoints = [];
  const collect = (rel, moduleName, isMounted) => {
    const text = src(rel);
    if (!text) return;
    for (const m of text.matchAll(/app\.(get|post|put|patch|delete)\(\s*'([^']+)'/g)) {
      endpoints.push({ module: moduleName, method: m[1].toUpperCase(), route: m[2], mounted: isMounted });
    }
  };
  for (const name of files) collect(`core/petri-server/routes/${name}.js`, name, mounted.includes(name));
  for (const rel of listFiles('core/petri-server/routes/harness', '.js')) {
    collect(rel, `harness/${path.posix.basename(rel, '.js')}`, mounted.includes('harness'));
  }
  return { mounted, files, endpoints };
}

// ── 4. 设置键面 ───────────────────────────────────────────────

function collectStorage() {
  const pairs = [];
  const brandLiterals = [];
  const walk = (rel) => {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) return;
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const child = path.posix.join(rel, entry.name);
      if (entry.isDirectory()) { if (!entry.name.startsWith('.') && entry.name !== 'node_modules') walk(child); continue; }
      if (!/\.(ts|tsx)$/.test(entry.name) || /\.test\./.test(entry.name)) continue;
      // 与工具面同基线（默认 HEAD / --worktree 工作区），避免两面取数不一致
      const text = src(child);
      if (!text) continue;
      // 常量表：`const X = '...'`（写入常用常量而非字面量，不解析会误判「读无写」）
      const consts = new Map();
      for (const m of text.matchAll(/const\s+([A-Za-z_$][\w$]*)\s*(?::\s*string)?\s*=\s*'([^']+)'/g)) consts.set(m[1], m[2]);
      const argKey = (literal, ident) => (literal || consts.get(ident) || null);

      for (const m of text.matchAll(/localStorage\.(getItem|setItem|removeItem)\(\s*(?:'([^']+)'|([A-Za-z_$][\w$]*))/g)) {
        const key = argKey(m[2], m[3]);
        if (key) pairs.push({ file: child, op: m[1], key });
      }
      // brand 封装统一折算为物理键 `petri-<key>`，与直接 localStorage 键同一坐标系
      for (const m of text.matchAll(/(read|write|remove)BrandStorage\(\s*(?:'([^']+)'|([A-Za-z_$][\w$]*))/g)) {
        const key = argKey(m[2], m[3]);
        if (!key) continue;
        pairs.push({ file: child, op: m[1] === 'read' ? 'getItem' : 'setItem', key: `petri-${key}` });
      }
      // 字面量形态的 brand 点号键（含常量声明里的）；记录所在行以判定是否为迁移用途
      for (const m of text.matchAll(/['"](petri\.[A-Za-z_$][\w$.]*)['"]/g)) {
        const lineStart = text.lastIndexOf('\n', m.index) + 1;
        const lineEnd = text.indexOf('\n', m.index);
        const line = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd);
        brandLiterals.push({ file: child, key: m[1], line: line.trim() });
      }
    }
  };
  walk('frontend/src');

  const byKey = new Map();
  for (const p of pairs) byKey.set(p.key, [...(byKey.get(p.key) || []), p]);

  const dangling = [];
  for (const [key, list] of byKey) {
    const writes = list.filter((x) => x.op === 'setItem' || x.op === 'removeItem');
    const reads = list.filter((x) => x.op === 'getItem' || x.op === 'readBrandStorage');
    if (writes.length > 0 && reads.length === 0) dangling.push({ key, kind: 'written_never_read', sites: list.map((s) => `${s.op}@${s.file}`) });
    if (reads.length > 0 && writes.length === 0) dangling.push({ key, kind: 'read_never_written', sites: list.map((s) => `${s.op}@${s.file}`) });
  }

  // 点号键 vs readBrandStorage 裸键：同一语义两套前缀 = 读写不通
  const brandMismatch = [];
  const bareReaders = new Map(pairs.filter((p) => p.op === 'readBrandStorage').map((p) => [p.key, p.file]));
  const seen = new Set();
  for (const b of brandLiterals) {
    const bare = b.key.slice('petri.'.length);
    const reader = bareReaders.get(bare);
    if (!reader) continue;
    // 迁移用途豁免：显式 LEGACY_* 常量 / removeItem 清理 / 注释写明迁移
    if (/LEGACY|legacy|removeItem|迁移|兼容/.test(b.line)) continue;
    const sig = `${b.key}->${bare}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    brandMismatch.push({ dottedKey: b.key, bareKey: bare, literalAt: b.file, readerAt: reader });
  }

  return { pairs, dangling, brandMismatch, brandLiterals };
}

// ── 5. 判定 ───────────────────────────────────────────────────

function build() {
  const { tools, domains, notes: defNotes } = collectToolDefs();
  const contracts = collectContracts();
  const handlerInfo = collectHandlers();
  const metadata = collectMetadata();
  const argsUsage = collectArgsUsage();
  const reachRows = policyReachability(tools, contracts) || [];
  const reachByName = new Map(reachRows.map((r) => [r.name, r]));

  const findings = [];
  const add = (sev, kind, subject, detail) => findings.push({ sev, kind, subject, detail });

  const toolNames = new Set(tools.map((t) => t.name));
  const toolRows = [];
  for (const tool of tools) {
    const c = contracts.get(tool.name);
    const h = handlerInfo.set.has(tool.name);
    const m = metadata.get(tool.name);
    const args = argsUsage.get(tool.name) || [];
    const undeclared = tool.hasParameters ? args.filter((k) => !tool.props.includes(k)) : [];
    const r = reachByName.get(tool.name);
    const reachable = r ? ['read', 'workspace-write', 'full'].some((k) => r[k] === 'allow') : null;

    toolRows.push({
      name: tool.name,
      domain: tool.domain,
      hasContract: Boolean(c),
      hasHandler: h,
      handlerStatic: handlerInfo.hasSpread ? 'spread-unknown' : (h ? 'yes' : 'no'),
      hasMetadata: Boolean(m),
      riskTier: c ? c.riskTier : null,
      sideEffect: c ? c.sideEffect : null,
      needsApprovalMeta: m ? m.needsApproval : null,
      reachable,
      reach: r || null,
      undeclaredArgs: undeclared,
      schemaProps: tool.props.length,
    });

    if (!c) add('P1', 'tool_without_contract', tool.name, '有定义无契约（policy 无法判定）');
    if (!h) {
      if (handlerInfo.hasSpread) add('P3', 'tool_handler_spread_unknown', tool.name, 'HANDLERS 含 spread，静态不可判');
      else add('P1', 'tool_without_handler', tool.name, '有定义无 handler');
    }
    if (!m) add('P3', 'tool_without_metadata', tool.name, '缺调度元数据');
    if (c && m && m.needsApproval && !['execution', 'state-write', 'external-request', 'workspace-write'].includes(c.sideEffect)) {
      add('P2', 'approval_meta_contract_conflict', tool.name, `metadata 需审批但契约 sideEffect=${c.sideEffect}`);
    }
    if (undeclared.length > 0) add('P2', 'schema_undeclared_args', tool.name, `实现读未声明键：${undeclared.join(',')}`);
    if (reachable === false) add('P1', 'unreachable_in_all_modes', tool.name, '三档全 deny（死工具：能力在但任何通道都用不到）');
  }

  // 反向：契约声明了但工具定义没进 TOOL_DEFS
  const defsDir = path.join(ROOT, 'core/petri-server/agent-tools/tool-defs');
  const defsFiles = fs.existsSync(defsDir) ? fs.readdirSync(defsDir).filter((f) => f.endsWith('.js')).map((f) => path.basename(f, '.js')) : [];
  for (const name of contracts.keys()) {
    if (toolNames.has(name)) continue;
    let owner = null;
    for (const domain of defsFiles) {
      const t = src(`core/petri-server/agent-tools/tool-defs/${domain}.js`) || '';
      if (t.includes(`"${name}"`) || t.includes(`'${name}'`)) { owner = domain; break; }
    }
    if (owner) {
      add('P1', 'defs_not_assembled', name, `定义存在于 tool-defs/${owner}.js，但未汇编进 tool-defs.js 的 domainModules → 模型看不到该工具（handler/契约在，能力不可达）`);
    } else {
      add('P2', 'dead_contract', name, '契约存在但无对应工具定义文件');
    }
  }
  for (const n of defNotes) add('P3', 'defs_text_fallback', n.domain, `${n.reason}（提取 ${n.extracted} 个工具）`);

  // IPC
  const channels = collectChannels();
  const preload = collectPreloadChannels();
  const rendererStrings = collectRendererStrings();
  const ipcRows = channels.map((ch) => ({
    channel: ch,
    inPreload: preload.includes(ch),
    usedInRenderer: rendererStrings.has(ch),
  }));
  // MAIN_ONLY 通道（独立 preload，主窗不暴露）设计如此，不计缺陷
  const MAIN_ONLY = new Set([
    'computer-use:pip-open', 'computer-use:pip-close',
    'computer-use:pip-frame', 'computer-use:pip-status',
  ]);
  const missingPreload = ipcRows.filter((x) => !x.inPreload && !MAIN_ONLY.has(x.channel));
  // 分诊：有前端消费=真断链（P2，渲染侧够不着）；无任何消费=死通道（P3，卫生债，删或接线待裁决）
  const missingWithConsumer = missingPreload.filter((x) => x.usedInRenderer);
  const missingDead = missingPreload.filter((x) => !x.usedInRenderer);
  if (missingWithConsumer.length > 0) {
    add('P2', 'ipc_channels_without_preload', `${missingWithConsumer.length} 个通道`,
      `前端仍在消费但 preload 无包装（渲染侧不可达）：${missingWithConsumer.map((x) => x.channel).join(', ')}`);
  }
  if (missingDead.length > 0) {
    add('P3', 'ipc_dead_channels', `${missingDead.length} 个通道`,
      `登记有主进程 handler 但 preload 无包装且前端零消费（死通道：删或接线待裁决）：${missingDead.map((x) => x.channel).join(', ')}`);
  }
  const ipcUnused = ipcRows.filter((r) => !r.usedInRenderer);

  // 路由
  const routes = collectRoutes();
  const secondary = new Set();
  for (const f of routes.files) {
    const t = src(`core/petri-server/routes/${f}.js`) || '';
    for (const m of t.matchAll(/require\('\.\/(?:harness\/)?([\w-]+)'\)/g)) secondary.add(m[1]);
  }
  const unmounted = routes.files.filter((f) => !routes.mounted.includes(f) && f !== 'index' && !secondary.has(f));
  for (const f of unmounted) add('P2', 'route_module_unmounted', f, '路由文件既未在 routes/index.js 挂载、也未被其他路由模块 require');

  // 设置键
  const storage = collectStorage();
  // 读无写多为「默认值读取」或「写点走 IPC/后端」，非缺陷；仅作卫生登记
  for (const d of storage.dangling) add('P3', `storage_${d.kind}`, d.key, `${d.sites.length} 处：${d.sites.join(' , ')}`);
  for (const b of storage.brandMismatch) {
    add('P1', 'storage_prefix_mismatch', b.dottedKey, `点号键写入 @${b.literalAt}，但读取走 readBrandStorage('${b.bareKey}') @${b.readerAt}`);
  }

  // 在制面
  const dirty = [];
  for (const dir of ['core/petri-server', 'frontend/src', 'src']) {
    try {
      const out = sh(['git', 'status', '--porcelain', '--', dir]).trim();
      if (out) dirty.push(...out.split('\n').map((l) => l.trim()));
    } catch { /* ignore */ }
  }

  const summary = {
    baseline: 'HEAD',
    tools: toolRows.length,
    toolDomains: domains.length,
    contracts: contracts.size,
    metadata: metadata.size,
    ipcChannels: ipcRows.length,
    ipcMissingPreload: ipcRows.filter((x) => !x.inPreload).length,
    ipcUnusedInRenderer: ipcUnused.length,
    routes: routes.endpoints.length,
    routeModules: routes.files.length,
    routeModulesUnmounted: unmounted.length,
    storageKeys: new Set(storage.pairs.map((p) => p.key)).size,
    findingsBySeverity: {
      P1: findings.filter((f) => f.sev === 'P1').length,
      P2: findings.filter((f) => f.sev === 'P2').length,
      P3: findings.filter((f) => f.sev === 'P3').length,
    },
    dirtyFiles: dirty.length,
    defsFallbacks: defNotes.length,
  };

  return { generatedAt: new Date().toISOString(), summary, findings, toolRows, ipcRows, ipcUnused, routeRows: routes.endpoints, storage: { dangling: storage.dangling, brandMismatch: storage.brandMismatch }, dirty, defNotes };
}

// ── 6. 输出 ───────────────────────────────────────────────────

function toMarkdown(result) {
  const s = result.summary;
  const L = [];
  L.push('# 功能面全量核对矩阵（generated）');
  L.push('');
  L.push('> 本文件由 `scripts/functional-surface-audit.mjs` 生成，勿手改；复跑即刷新。');
  L.push(`> 基线：\`${s.baseline}\`（工作区在制文件 ${s.dirtyFiles} 个不计入判定）。生成时间：${result.generatedAt}`);
  L.push('');
  L.push('## 0. 覆盖汇总');
  L.push('');
  L.push('| 面 | 数量 |');
  L.push('| --- | --- |');
  L.push(`| 工具定义 | ${s.tools}（${s.toolDomains} 域；文本降级 ${s.defsFallbacks} 域） |`);
  L.push(`| 工具契约 | ${s.contracts} |`);
  L.push(`| 调度元数据 | ${s.metadata} |`);
  L.push(`| IPC 通道 | ${s.ipcChannels}（preload 缺包装 ${s.ipcMissingPreload}；前端零消费 ${s.ipcUnusedInRenderer}） |`);
  L.push(`| 路由端点 | ${s.routes}（${s.routeModules} 模块；未挂载 ${s.routeModulesUnmounted}） |`);
  L.push(`| 设置存储键 | ${s.storageKeys} |`);
  L.push(`| 判定 P1 / P2 / P3 | **${s.findingsBySeverity.P1} / ${s.findingsBySeverity.P2} / ${s.findingsBySeverity.P3}** |`);
  L.push('');
  L.push('## 1. P1 明细（能力在、用户用不到）');
  L.push('');
  if (s.findingsBySeverity.P1 === 0) L.push('（无）');
  else {
    L.push('| 类别 | 对象 | 说明 |');
    L.push('| --- | --- | --- |');
    for (const f of result.findings.filter((x) => x.sev === 'P1')) L.push(`| ${f.kind} | \`${f.subject}\` | ${f.detail} |`);
  }
  L.push('');
  L.push('## 2. P2 明细（契约不一致 / 半接线）');
  L.push('');
  const p2 = result.findings.filter((x) => x.sev === 'P2');
  if (p2.length === 0) L.push('（无）');
  else {
    L.push('| 类别 | 对象 | 说明 |');
    L.push('| --- | --- | --- |');
    for (const f of p2) L.push(`| ${f.kind} | \`${f.subject}\` | ${f.detail} |`);
  }
  L.push('');
  L.push('## 3. P3 明细（卫生；最多列 60 条）');
  L.push('');
  const p3 = result.findings.filter((x) => x.sev === 'P3');
  if (p3.length === 0) L.push('（无）');
  else {
    L.push('| 类别 | 对象 | 说明 |');
    L.push('| --- | --- | --- |');
    for (const f of p3.slice(0, 60)) L.push(`| ${f.kind} | \`${f.subject}\` | ${f.detail} |`);
    if (p3.length > 60) L.push(`| … | 其余 ${p3.length - 60} 条 | 见 JSON |`);
  }
  L.push('');
  L.push('## 4. 工具全量矩阵');
  L.push('');
  L.push('| 工具 | 域 | 契约 | handler | 元数据 | risk | sideEffect | 审批声明 | 三档可达 | 未声明参数 |');
  L.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const t of result.toolRows) {
    L.push(`| \`${t.name}\` | ${t.domain} | ${t.hasContract ? '✓' : '✗'} | ${t.handlerStatic === 'yes' ? '✓' : (t.handlerStatic === 'spread-unknown' ? '?' : '✗')} | ${t.hasMetadata ? '✓' : '✗'} | ${t.riskTier ?? '-'} | ${t.sideEffect ?? '-'} | ${t.needsApprovalMeta ? 'yes' : 'no'} | ${t.reachable === null ? '-' : (t.reachable ? 'yes' : '**NO**')} | ${t.undeclaredArgs.length ? t.undeclaredArgs.join('/') : '-'} |`);
  }
  L.push('');
  L.push('## 5. 设置键悬空与前缀不一致');
  L.push('');
  if (result.storage.dangling.length === 0 && result.storage.brandMismatch.length === 0) L.push('（无）');
  for (const d of result.storage.dangling) L.push(`- \`${d.key}\` — ${d.kind}（${d.sites.length} 处）`);
  for (const b of result.storage.brandMismatch) L.push(`- \`${b.dottedKey}\` 写入 @${b.literalAt} ↔ \`readBrandStorage('${b.bareKey}')\` @${b.readerAt} — **前缀不一致**`);
  L.push('');
  L.push('## 6. 在制文件（本轮不计入判定）');
  L.push('');
  if (result.dirty.length === 0) L.push('（无）');
  for (const d of result.dirty) L.push(`- \`${d}\``);
  L.push('');
  return L.join('\n');
}

const result = build();
fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
fs.writeFileSync(OUT_JSON, JSON.stringify(result, null, 2));
fs.writeFileSync(OUT_MD, toMarkdown(result));

// ── 基线棘轮（BLOCK-346 T7） ─────────────────────────────────
// 语义：baseline 记录「已知存量」；--check 只对**新增** P1/P2 判红（存量只许递减）。
// 复核场景（如 BLOCK-344 收口后）：跑默认模式看 diff；确认收敛后 --write-baseline。
const BASELINE = path.join(ROOT, 'test', 'functional-surface-baseline.json');

function signatureOf(finding) { return `${finding.kind}::${finding.subject}`; }

function loadBaseline() {
  try { return JSON.parse(fs.readFileSync(BASELINE, 'utf8')); } catch { return null; }
}

function currentSignatures(sev) {
  return result.findings.filter((f) => f.sev === sev).map(signatureOf).sort();
}

function diffAgainstBaseline(baseline) {
  if (!baseline) return null;
  const out = {};
  for (const sev of ['P1', 'P2', 'P3']) {
    const cur = currentSignatures(sev);
    const base = (baseline.findings && baseline.findings[sev]) || [];
    out[sev] = {
      added: cur.filter((x) => !base.includes(x)),
      removed: base.filter((x) => !cur.includes(x)),
    };
  }
  return out;
}

let headSha = null;
try { headSha = sh(['git', 'rev-parse', '--short', 'HEAD']).trim(); } catch { /* ignore */ }

if (ARGV.has('--write-baseline')) {
  const payload = {
    generatedAt: new Date().toISOString(),
    baselineSha: headSha,
    note: 'BLOCK-346 T7 棘轮基线：记录已知存量，--check 只对新增 P1/P2 判红。收敛后 --write-baseline 下调。',
    counts: result.summary.findingsBySeverity,
    findings: {
      P1: currentSignatures('P1'),
      P2: currentSignatures('P2'),
      P3: currentSignatures('P3'),
    },
  };
  fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
  fs.writeFileSync(BASELINE, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`[surface-audit] baseline written -> ${path.relative(ROOT, BASELINE)} @ ${headSha}`);
}

const baseline = loadBaseline();
const diff = diffAgainstBaseline(baseline);

const s = result.summary;
console.log(`[surface-audit] tools=${s.tools}/${s.contracts} ipc=${s.ipcChannels} routes=${s.routes} storageKeys=${s.storageKeys}`);
console.log(`[surface-audit] P1=${s.findingsBySeverity.P1} P2=${s.findingsBySeverity.P2} P3=${s.findingsBySeverity.P3} dirty=${s.dirtyFiles} fallbackDomains=${s.defsFallbacks} head=${headSha}`);
for (const f of result.findings.filter((x) => x.sev === 'P1')) console.log(`  P1 ${f.kind} :: ${f.subject} :: ${f.detail}`);
if (VERBOSE) for (const r of result.ipcUnused.slice(0, 40)) console.log(`  ipc-unused ${r.channel}`);

if (diff) {
  const addedTotal = diff.P1.added.length + diff.P2.added.length;
  const removedTotal = diff.P1.removed.length + diff.P2.removed.length;
  console.log(`[surface-audit] vs baseline(${baseline.baselineSha || '?'}) 新增 P1=${diff.P1.added.length} P2=${diff.P2.added.length} / 消失 P1=${diff.P1.removed.length} P2=${diff.P2.removed.length}`);
  for (const x of diff.P1.added) console.log(`  + NEW P1 ${x}`);
  for (const x of diff.P2.added) console.log(`  + NEW P2 ${x}`);
  for (const x of diff.P1.removed) console.log(`  - FIXED P1 ${x}`);
  if (ARGV.has('--check') && addedTotal > 0) {
    console.log('[surface-audit] FAIL：存在基线外的新增 P1/P2（棘轮门禁）');
    process.exitCode = 1;
  } else if (ARGV.has('--check')) {
    console.log(`[surface-audit] PASS：无新增（存量 P1=${s.findingsBySeverity.P1}，可收敛 ${removedTotal} 条后 --write-baseline）`);
  }
} else if (ARGV.has('--check')) {
  console.log('[surface-audit] WARN：无基线文件（test/functional-surface-baseline.json）——先跑 --write-baseline 冻结存量');
}
console.log(`[surface-audit] out=${path.relative(ROOT, OUT_JSON)} , ${path.relative(ROOT, OUT_MD)}`);
