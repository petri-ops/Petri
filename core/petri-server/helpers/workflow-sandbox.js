'use strict';

/**
 * helpers/workflow-sandbox.js — BLOCK-262（Q4b）工作流脚本沙箱。
 *
 * 定位：确定性 JS 沙箱执行 `export const meta` + `export default` 两形态的工作流脚本。
 * 双层防线（plan §2.1）：
 *   1. 静态扫描 fail-closed——禁词（require/import/process/真时钟/真随机/fs/net/eval…）命中即拒；
 *   2. realm 加固——vm 独立 realm 内摘除 Date、替换 Math（无 random）；宿主全局（process/require/定时器）天然不在场。
 * 确定性：时间经 now()（虚拟单调时钟）、随机经 random()（mulberry32 seeded）。
 * 红线：不建第二执行器（agent 原语由宿主经 host 桥接注入）；零新依赖（node:vm 内建）。
 */

const vm = require('node:vm');
const { validateWorkflowMeta } = require('./workflow-script');

// ── 静态扫描 ────────────────────────────────────────────────
// 顺序即诊断优先级；命中即拒（fail-closed），不做白名单外放行。

const FORBIDDEN_PATTERNS = [
  { id: 'require', regex: /\brequire\s*\(/ },
  { id: 'import', regex: /\bimport\b/ },
  { id: 'process', regex: /\bprocess\b\s*\./ },
  { id: 'date-now', regex: /\bDate\s*\.\s*now\b/ },
  { id: 'new-date', regex: /\bnew\s+Date\b/ },
  { id: 'math-random', regex: /\bMath\s*\.\s*random\b/ },
  { id: 'fetch', regex: /\bfetch\s*\(/ },
  { id: 'node-builtin', regex: /\bnode:/ },
  { id: 'eval', regex: /\beval\s*\(/ },
  { id: 'function-ctor', regex: /\bFunction\s*\(/ },
  { id: 'global-this', regex: /\bglobalThis\b/ },
  { id: 'websocket', regex: /\bWebSocket\b/ },
  { id: 'timers', regex: /\b(?:setTimeout|setInterval|setImmediate)\s*\(/ },
];

function scanWorkflowSource(source) {
  const text = String(source || '');
  for (const { id, regex } of FORBIDDEN_PATTERNS) {
    const match = regex.exec(text);
    if (match) {
      return {
        ok: false,
        error: 'script_forbidden_syntax',
        pattern: id,
        index: match.index,
        message: `脚本含禁用语法（${id}）：位置 ${match.index} 起的「${text.slice(match.index, match.index + 24)}」`,
      };
    }
  }
  return { ok: true, source: text };
}

// ── ESM 子集：export 形态白名单 ──────────────────────────────
// 仅两种：`export const meta =` 与 `export default`；按行首识别（行中出现
// "export" 字样不误伤；行首才构成语句）。其余 export 形态一律拒绝。

const EXPORT_CONST_META = /^\s*export\s+const\s+meta\s*=/;
const EXPORT_DEFAULT = /^\s*export\s+default\b/;

function validateExportForms(source) {
  const lines = String(source).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/^\s*export\b/.test(line)) continue;
    if (EXPORT_CONST_META.test(line) || EXPORT_DEFAULT.test(line)) continue;
    return {
      ok: false,
      error: 'export_form_rejected',
      line: i + 1,
      message: `第 ${i + 1} 行的 export 形态不受支持（仅允许「export const meta =」与「export default」）：${line.trim().slice(0, 60)}`,
    };
  }
  return { ok: true };
}

function transpileWorkflowSource(source) {
  return String(source)
    .split(/\r?\n/)
    .map((line) => {
      if (EXPORT_CONST_META.test(line)) {
        return line.replace(/^\s*export\s+const\s+meta\s*=/, '__exports.meta =');
      }
      if (EXPORT_DEFAULT.test(line)) {
        return line.replace(/^\s*export\s+default\b/, '__exports.default =');
      }
      return line;
    })
    .join('\n');
}

// ── 确定性原语：虚拟时钟与 seeded PRNG ──────────────────────

function makeVirtualClock(start = 0) {
  let tick = start;
  return () => {
    tick += 1;
    return tick;
  };
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildDeterminism(seed = 0) {
  return { now: makeVirtualClock(), random: mulberry32(seed) };
}

// ── realm 加固前奏：摘除真时钟与真随机 ─────────────────────
// 静态扫描是第一道防线；此处是第二道（防文本变体绕过后的运行时兜底）。

const REALM_PRELUDE = `'use strict';
(function () {
  var g = globalThis;
  // Date → 不可达（脚本要时间只能用宿主注入的 now()）
  try { Object.defineProperty(g, 'Date', { value: undefined, configurable: false, writable: false }); } catch (e) {}
  // Math → 无 random 副本（其余方法保留）
  try {
    var safe = {};
    var names = Object.getOwnPropertyNames(Math);
    for (var i = 0; i < names.length; i++) {
      if (names[i] !== 'random') safe[names[i]] = Math[names[i]];
    }
    Object.defineProperty(g, 'Math', { value: safe, configurable: false, writable: false });
  } catch (e) {}
})();
`;

// ── 模块装载 ────────────────────────────────────────────────

/**
 * 装载工作流脚本：扫描 → export 形态校验 → 转译 → realm 执行 → meta/run 校验。
 * @param {string} source 脚本源码（ESM 子集）
 * @param {{ host?: object, seed?: number }} options
 *   host：宿主原语（agent/parallel/pipeline/phase/log/budget/console…，由 runner 注入），
 *   以 realm 全局形式暴露（脚本内裸调用 now()/agent()/log()）；
 *   seed：确定性种子（now/random 缺省由此派生，宿主显式注入者优先）。
 * @returns {{ ok: true, meta: object, run: Function } | { ok: false, error: string, ... }}
 */
function loadWorkflowModule(source, { host = {}, seed = 0 } = {}) {
  const scanned = scanWorkflowSource(source);
  if (!scanned.ok) return scanned;

  const exportCheck = validateExportForms(scanned.source);
  if (!exportCheck.ok) return exportCheck;

  const wrapperSource = `(function (__exports) {\n${transpileWorkflowSource(scanned.source)}\nreturn __exports;\n})`;

  const effectiveHost = { ...buildDeterminism(seed), ...host };
  let wrapperFn;
  try {
    // 宿主原语作为 realm 全局注入（脚本内裸调用）；realm 自带的全局在此对象之外，
    // 由 REALM_PRELUDE 摘除真 Date / 真 Math.random。
    const context = vm.createContext({ ...effectiveHost });
    vm.runInContext(REALM_PRELUDE, context, { filename: 'workflow-realm-prelude.js' });
    wrapperFn = new vm.Script(wrapperSource, { filename: 'workflow-script.js' }).runInContext(context);
  } catch (e) {
    return { ok: false, error: 'syntax_invalid', message: e && e.message ? e.message : String(e) };
  }

  const exports_ = {};
  try {
    wrapperFn(exports_);
  } catch (e) {
    return { ok: false, error: 'script_evaluation_failed', message: e && e.message ? e.message : String(e) };
  }

  const metaRes = validateWorkflowMeta(exports_.meta);
  if (!metaRes.ok) {
    return { ok: false, error: 'meta_invalid', diagnostics: metaRes.diagnostics };
  }
  if (exports_.default === undefined) {
    return { ok: false, error: 'default_missing', message: '脚本缺少 export default function run(...)' };
  }
  if (typeof exports_.default !== 'function') {
    return { ok: false, error: 'default_invalid', message: 'export default 必须是函数' };
  }

  return { ok: true, meta: metaRes.meta, run: exports_.default };
}

module.exports = {
  FORBIDDEN_PATTERNS,
  scanWorkflowSource,
  validateExportForms,
  transpileWorkflowSource,
  buildDeterminism,
  makeVirtualClock,
  mulberry32,
  loadWorkflowModule,
};
