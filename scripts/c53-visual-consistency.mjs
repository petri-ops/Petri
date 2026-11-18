#!/usr/bin/env node
/**
 * scripts/c53-visual-consistency.mjs — BLOCK-472 / C-53 P3：视觉一致性 token 落地静态扫描。
 *
 * collectVisualConsistency(root) 是纯函数：从 canonical 真源
 * （frontend/src/styles/custom.css 暗色块 + 全源 + design-charter.md +
 * theme-token-contract.test.ts）机械复算四组读数，不写盘、不依赖时间：
 *   - navyLadder    海军蓝暗色阶梯四档取值 + 相对明度 + 严格单调递增断言
 *   - slateFamily   广谱 slate 家族逐文件命中 + 冻结 ratchet（新增即红）
 *   - colorBudget   accent 引用现读总数/逐文件 + 终态目标对账（未达如实标注）
 *   - undefinedTokens  var(--color-*) 零残留 + var(--petri-*) 引用 ⊆ 定义
 * 同一批读数派生 acceptance 快照与 resources/design-context/visual-consistency.json
 * ——模型可读、可复算，被 test/c53-visual-consistency.test.mjs 锚定。
 *
 * 用法：node scripts/c53-visual-consistency.mjs            # 写快照+契约+manifest
 *       node scripts/c53-visual-consistency.mjs --check    # 只重算并与落盘 value 比对
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { deepStrictEqual } from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'frontend', 'src');

/** 冻结读数 = 设计不变量（跨工作包生命周期稳定），被消费测试逐读数深等。 */
export const READING_IDS = Object.freeze([
  'navyLadder', 'slateFamily', 'colorBudget', 'undefinedTokens',
]);

/** 海军蓝暗色阶梯规范值（petri-css-theme §1 / custom.css dark 块；canvas→elevated 由深到浅）。 */
export const NAVY_LADDER_SPEC = Object.freeze([
  '#0b1220', '#111a2e', '#182339', '#1d2945',
]);
const NAVY_TIER_KEYS = Object.freeze(['canvas', 'surface', 'subtle', 'elevated']);

/** 广谱 slate 家族（infima/docs 时代遗产，与 navy 家族脱节；比 theme-token-contract 的 4 字面量更全）。 */
export const SLATE_PATTERNS = Object.freeze([
  Object.freeze(['slate-950', /#020617\b/gi]),
  Object.freeze(['slate-900', /#0f172a\b/gi]),
  Object.freeze(['slate-800', /#1e293b\b/gi]),
  Object.freeze(['slate-700', /#334155\b/gi]),
  Object.freeze(['slate-600', /#475569\b/gi]),
  Object.freeze(['slate-500', /#64748b\b/gi]),
  Object.freeze(['slate-400', /#94a3b8\b/gi]),
  Object.freeze(['slate-300', /#cbd5e1\b/gi]),
  Object.freeze(['slate-200', /#e2e8f0\b/gi]),
  Object.freeze(['slate900-rgba', /rgba\(\s*15\s*,\s*23\s*,\s*42/gi]),
  Object.freeze(['slate500-rgba', /rgba\(\s*148\s*,\s*163\s*,\s*184/gi]),
]);

/**
 * 广谱 slate 存量冻结基线（ratchet）：现读摸底 5 文件，逐文件逐家族计数。
 * 新增命中（超出此表或计数上涨）即红；存量不改 CSS（观感零代签），如实入册。
 * 合法存量理由：
 *  - styles/custom.css：终端/状态/气泡 token 定义值（terminal/status/user-bubble 语义，浅色面正当用色）；
 *  - themes/terminal-themes.ts：light 终端主题 ANSI 色（白底近黑，浅色面，theme-token-contract 已豁免 slate-900）；
 *  - ContextBudgetBar/PluginStorePanel/desktop.css：散落字面量，存量冻结不扩，新增即红。
 */
export const SLATE_RATCHET = Object.freeze({
  'components/copilot/ContextBudgetBar.tsx': Object.freeze({ 'slate-400': 1 }),
  'components/desktop/PluginStorePanel.tsx': Object.freeze({ 'slate900-rgba': 1 }),
  'components/desktop/desktop.css': Object.freeze({ 'slate-200': 1 }),
  'styles/custom.css': Object.freeze({ 'slate-500': 1, 'slate-400': 1, 'slate-300': 1, 'slate900-rgba': 1 }),
  'themes/terminal-themes.ts': Object.freeze({ 'slate-900': 3, 'slate-600': 1, 'slate-500': 1 }),
});

// own-enumerable 查找（BLOCK-456 先例），避免 object-injection 告警。
const ownGet = (obj, key) => Object.entries(obj ?? {}).find(([k]) => k === key)?.[1];

const readText = (rel, root) => fs.readFileSync(path.join(root, rel), 'utf8');

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { out.push(...walk(full)); continue; }
    if (!/\.(css|ts|tsx|js|jsx)$/.test(entry.name)) continue;
    if (/\.(test|spec)\.(ts|tsx|js|jsx)$/.test(entry.name)) continue;
    out.push(full);
  }
  return out;
}

function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^\S\r\n])\/\/.*$/gm, '$1');
}

/** hex → 相对明度（WCAG 线性化亮度，0–100 尺度），用于阶梯单调性判定。 */
function relativeLuminance(hex) {
  const h = String(hex).replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return NaN;
  const chan = (i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return Math.round((0.2126 * chan(0) + 0.7152 * chan(2) + 0.0722 * chan(4)) * 10000) / 100;
}

/**
 * 纯函数：从 custom.css 文本扫描 --petri-bg-{canvas,surface,subtle,elevated} 暗色块取值。
 * dark 块取最后一次定义（light :root 在前、dark 覆盖块在后）。
 */
export function scanNavyLadder(customCss) {
  const text = String(customCss || '');
  const tiers = NAVY_TIER_KEYS.map((key, i) => {
    const re = new RegExp(`--petri-bg-${key}:\\s*(#[0-9a-fA-F]{6})`, 'g');
    const hits = [...text.matchAll(re)];
    const hex = hits.length ? hits[hits.length - 1][1] : null;
    return {
      token: `--petri-bg-${key}`,
      hex,
      luminance: hex ? relativeLuminance(hex) : null,
      expected: NAVY_LADDER_SPEC[i],
    };
  });
  const specAligned = tiers.every((t) => t.hex && t.hex.toLowerCase() === String(t.expected).toLowerCase());
  const ascending = tiers.every((t) => Number.isFinite(t.luminance))
    && tiers.every((t, i) => i === 0 || t.luminance > tiers[i - 1].luminance);
  return { tiers, specAligned, ascending };
}

/**
 * 纯函数：广谱 slate 家族扫描。sources 为 {rel: text} 映射（相对 frontend/src）；
 * 缺省从 root 现读全源。injected 为额外 {rel: text}（测试篡改负测用）。
 * 返回 { hits, overRatchet, patterns }：overRatchet 非空即表示新增违规。
 */
export function scanSlateFamily(root, injected = null) {
  const sources = {};
  if (root && typeof root === 'string' && fs.existsSync(path.join(root, 'frontend', 'src'))) {
    for (const file of walk(path.join(root, 'frontend', 'src'))) {
      sources[path.relative(path.join(root, 'frontend', 'src'), file).replaceAll('\\', '/')] =
        stripComments(fs.readFileSync(file, 'utf8'));
    }
  } else if (root && typeof root === 'object' && !injected) {
    // 允许直接传 sources 映射（纯函数形态）
    for (const [rel, text] of Object.entries(root)) sources[rel] = stripComments(String(text));
  }
  for (const [rel, text] of Object.entries(injected ?? {})) sources[rel] = stripComments(String(text));

  const hits = {};
  for (const [rel, text] of Object.entries(sources)) {
    const families = {};
    for (const [name, re] of SLATE_PATTERNS) {
      const n = (text.match(new RegExp(re.source, re.flags)) || []).length;
      if (n > 0) families[name] = n;
    }
    if (Object.keys(families).length) hits[rel] = families;
  }

  // 与冻结基线对账：任一文件新增家族或计数上涨 → 红（只许收缩）。
  const overRatchet = [];
  const allFiles = new Set([...Object.keys(hits), ...Object.keys(SLATE_RATCHET)]);
  for (const file of [...allFiles].sort()) {
    const actual = ownGet(hits, file) ?? {};
    const frozen = ownGet(SLATE_RATCHET, file) ?? {};
    const families = new Set([...Object.keys(actual), ...Object.keys(frozen)]);
    for (const fam of [...families].sort()) {
      const got = ownGet(actual, fam) ?? 0;
      const allowed = ownGet(frozen, fam) ?? 0;
      if (got > allowed) overRatchet.push({ file, family: fam, found: got, allowed });
    }
  }
  return {
    hits,
    overRatchet,
    patterns: SLATE_PATTERNS.map(([name]) => name),
    ratchetFiles: Object.keys(SLATE_RATCHET).length,
  };
}

/**
 * 纯函数：accent 引用现读计数（CSS 面，口径同 theme-token-contract）。
 */
export function scanColorBudget(root, cssSources = null) {
  const sources = {};
  if (cssSources) {
    for (const [rel, text] of Object.entries(cssSources)) sources[rel] = stripComments(String(text));
  } else {
    for (const file of walk(path.join(root, 'frontend', 'src'))) {
      if (!file.endsWith('.css')) continue;
      sources[path.relative(path.join(root, 'frontend', 'src'), file).replaceAll('\\', '/')] =
        stripComments(fs.readFileSync(file, 'utf8'));
    }
  }
  const perFile = {};
  let total = 0;
  for (const [rel, text] of Object.entries(sources)) {
    const n = (text.match(/var\(--petri-accent\)/g) || []).length;
    if (n) { perFile[rel] = n; total += n; }
  }
  // 终态目标从 design-charter §2 现读（声明值，不改）
  let declaredCeiling = null;
  try {
    const charter = readText('docs/design-charter.md', root);
    const m = charter.match(/引用总量终态\s*≤(\d+)/);
    if (m) declaredCeiling = Number(m[1]);
  } catch { /* root 非仓库根时留空，由消费测试深等兜底 */ }
  return {
    total,
    perFile,
    declaredCeiling,
    targetMet: declaredCeiling === null ? null : total <= declaredCeiling,
  };
}

/** JS 运行时 setProperty 注入的 live token（无静态定义属预期，沿 theme-token-contract 白名单）。 */
const JS_INJECTED_TOKENS = new Set([
  '--petri-live-left-width', '--petri-live-left-span', '--petri-live-right-width',
  '--petri-live-right-span', '--petri-live-result-right-width',
]);

/** 纯函数：token 完整性——零 var(--color-*) 残留 + var(--petri-*) 引用 ⊆ 定义。 */
export function scanTokenIntegrity(root, sourcesOverride = null) {
  const sources = {};
  if (sourcesOverride) {
    for (const [rel, text] of Object.entries(sourcesOverride)) sources[rel] = stripComments(String(text));
  } else {
    for (const file of walk(path.join(root, 'frontend', 'src'))) {
      sources[path.relative(path.join(root, 'frontend', 'src'), file).replaceAll('\\', '/')] =
        stripComments(fs.readFileSync(file, 'utf8'));
    }
  }
  const definitions = new Set();
  const petriRefs = new Set();
  const undefinedColorRefs = [];
  for (const [rel, text] of Object.entries(sources)) {
    if (/var\(--color-/.test(text)) undefinedColorRefs.push(rel);
    for (const m of text.matchAll(/--petri-[A-Za-z0-9-]+(?=\s*:)/g)) definitions.add(m[0]);
    for (const m of text.matchAll(/var\(--(petri-[A-Za-z0-9-]+)/g)) petriRefs.add(`--${m[1]}`);
  }
  const missingPetriRefs = [...petriRefs]
    .filter((t) => !definitions.has(t) && !JS_INJECTED_TOKENS.has(t))
    .sort();
  return { undefinedColorRefs, missingPetriRefs, definitionCount: definitions.size, referenceCount: petriRefs.size };
}

/** 结构完整性 fail-closed：缺读数/缺元数据/value 含 null 子字段即红。 */
export function validateVisualConsistencyIntegrity(readings) {
  const issues = [];
  if (!readings || typeof readings !== 'object') return { ok: false, issues: ['readings 非对象'] };
  for (const id of READING_IDS) {
    const r = ownGet(readings, id);
    if (!r) { issues.push(`${id} 缺席`); continue; }
    for (const k of ['source', 'command', 'capturedAt']) {
      if (!ownGet(r, k)) issues.push(`${id} 缺 ${k}`);
    }
    if (r.value === undefined || r.value === null) { issues.push(`${id} 缺 value`); continue; }
    if (typeof r.value === 'object') {
      const nulls = Object.entries(r.value).filter(([, v]) => v === null || v === undefined).map(([k]) => k);
      if (nulls.length) issues.push(`${id}.value 含 null/undefined 子字段: ${nulls.join(',')}`);
    }
  }
  return { ok: issues.length === 0, issues };
}

/** 纯函数：机械复算全部读数。返回 { [id]: {value, source, command, capturedAt} }。 */
export function collectVisualConsistency(root = ROOT) {
  const customCss = readText('frontend/src/styles/custom.css', root);
  const capturedAt = new Date().toISOString();
  const mk = (value, source, command) => ({ value, source, command, capturedAt });
  const cmd = 'node scripts/c53-visual-consistency.mjs';

  const navyLadder = scanNavyLadder(customCss);
  const slateFamily = scanSlateFamily(root);
  const colorBudget = scanColorBudget(root);
  const undefinedTokens = scanTokenIntegrity(root);

  // fail-closed：任何契约级违例直接抛错，拒绝生成"看起来绿的"快照。
  if (!navyLadder.ascending || !navyLadder.specAligned) {
    throw new Error(`[c53:visual] 海军蓝阶梯违约: ${JSON.stringify(navyLadder.tiers)}`);
  }
  if (slateFamily.overRatchet.length) {
    throw new Error(`[c53:visual] slate ratchet 新增违规: ${JSON.stringify(slateFamily.overRatchet)}`);
  }
  if (undefinedTokens.undefinedColorRefs.length || undefinedTokens.missingPetriRefs.length) {
    throw new Error(`[c53:visual] token 完整性违约: ${JSON.stringify(undefinedTokens)}`);
  }

  return {
    navyLadder: mk(navyLadder, 'frontend/src/styles/custom.css dark 块', cmd),
    slateFamily: mk(slateFamily, 'frontend/src 全源（广谱 slate ratchet）', cmd),
    colorBudget: mk(colorBudget, 'frontend/src CSS 全源 + docs/design-charter.md §2', cmd),
    undefinedTokens: mk(undefinedTokens, 'frontend/src 全源（token 定义/引用扫描）', cmd),
  };
}

const sourceCommitOf = (root) => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();

function main(argv) {
  const readings = collectVisualConsistency(ROOT);
  const check = validateVisualConsistencyIntegrity(readings);
  if (!check.ok) {
    console.error(`[c53:visual] 读数不合格，拒绝写盘: ${check.issues.join('; ')}`);
    process.exitCode = 1;
    return;
  }
  const sourceCommit = sourceCommitOf(ROOT);
  const snapPath = path.join(ROOT, 'acceptance/block472-c53-p3-visual-consistency/visual-consistency-snapshot.json');
  const contractPath = path.join(ROOT, 'resources/design-context/visual-consistency.json');
  const manifestPath = path.join(ROOT, 'resources/design-context/manifest.json');

  if (argv.includes('--check')) {
    if (!fs.existsSync(snapPath)) { console.error('[c53:visual] 快照缺席，请先生成'); process.exitCode = 1; return; }
    const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
    for (const id of READING_IDS) {
      try { deepStrictEqual(ownGet(readings, id).value, ownGet(snap.readings, id).value); }
      catch { console.error(`[c53:visual] --check 漂移: ${id}`); process.exitCode = 1; return; }
    }
    console.log(JSON.stringify({
      ok: true,
      sourceCommit,
      readingIds: READING_IDS,
      accentTotal: ownGet(readings, 'colorBudget').value.total,
      slateRatchetFiles: ownGet(readings, 'slateFamily').value.ratchetFiles,
    }, null, 2));
    return;
  }

  const frozenReadings = Object.fromEntries(READING_IDS.map((id) => [id, ownGet(readings, id)]));
  const snapshot = {
    schemaVersion: 1,
    kind: 'c53-visual-consistency',
    capability: 'block472-c53-p3-visual-consistency',
    sourceCommit,
    platform: `${os.platform()}-${os.arch()}`,
    command: 'node scripts/c53-visual-consistency.mjs',
    generatedAt: new Date().toISOString(),
    evidenceClass: 'mechanical-gate',
    verdict: 'measured',
    humanEyeEquivalent: false,
    note: '读数=设计不变量（冻结，消费测试逐读数深等）；观感项 pending_human_eye 不代签，本包只读不改任何 token 定义/CSS。',
    readings: frozenReadings,
  };

  const contract = {
    schemaVersion: 1,
    id: 'petri-visual-consistency-contract',
    kind: 'model-readable-visual-consistency',
    generatedBy: 'node scripts/c53-visual-consistency.mjs',
    sourceCommit,
    generatedAt: new Date().toISOString(),
    derivedFrom: [
      'frontend/src/styles/custom.css',
      'frontend/src（广谱 slate / accent / token 扫描）',
      'docs/design-charter.md §2',
      '.agents/skills/petri-css-theme/SKILL.md §1',
    ],
    navyLadder: ownGet(readings, 'navyLadder').value,
    slateFamily: ownGet(readings, 'slateFamily').value,
    colorBudget: ownGet(readings, 'colorBudget').value,
    undefinedTokens: ownGet(readings, 'undefinedTokens').value,
    boundaries: {
      humanEyeSigned: false,
      readOnly: true,
      note: '观感项 pending_human_eye 保持 in_progress，Agent 不代签；本契约为只读机械扫描，不改任何 CSS/组件/token 定义。',
    },
  };

  const contractBuf = Buffer.from(`${JSON.stringify(contract, null, 2)}\n`, 'utf8');
  for (const p of [snapPath, contractPath, manifestPath]) fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(snapPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  fs.writeFileSync(contractPath, contractBuf);

  // manifest 同步（沿 P1/P2 先例）：visual-consistency 的 sha256 由生成器自身维护。
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const files = Array.isArray(manifest.files) ? manifest.files : [];
  const sha = createHash('sha256').update(contractBuf).digest('hex');
  const entry = files.find((f) => ownGet(f, 'path') === 'visual-consistency.json');
  if (entry) entry.sha256 = sha;
  else files.push({ path: 'visual-consistency.json', sha256: sha });
  manifest.files = files;
  manifest.generatedAt = new Date().toISOString();
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(JSON.stringify({
    written: [snapPath, contractPath, manifestPath].map((p) => path.relative(ROOT, p)),
    sourceCommit,
    readingIds: READING_IDS,
    accentTotal: ownGet(readings, 'colorBudget').value.total,
  }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exitCode = 1; }
}
