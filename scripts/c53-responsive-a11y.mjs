#!/usr/bin/env node
/**
 * scripts/c53-responsive-a11y.mjs — BLOCK-473 / C-53 P4：响应式与可访问性静态扫描。
 *
 * collectResponsiveA11y(root) 是纯函数：从 canonical 真源
 * （scripts/ui-design-a11y.mjs 真源函数 + frontend/src TSX/CSS 全源 +
 *  controls/button.module.css + nso-w3-a11y 契约语义）机械复算六组读数，
 * 不写盘、不依赖时间：
 *   - keyboardFocus   focus-visible 缺口只减棘轮（12 文件 / 16 声明）+ inert/focus-visible 语义在场
 *   - ariaStateMachine aria-busy / role=alert / role=status / aria-live 四类证据现读计数
 *   - contrast        WCAG AA 32 对（复用 ui-design-a11y 纯函数），阈值不放宽，低于阈值如实登记
 *   - breakpoints     CSS 全源 @media/@container 宽度断点计数 + 宽度档位集合 + 窄屏覆盖存在性
 *   - touchTargets    控件单源按钮基形 24/30px 现读 + 桌面形态声明，<24px 如实标注
 *   - eightStateMatrix 32 格判据/证据/终态复用 ui-design-a11y STATE_MATRIX
 * 同一批读数派生 acceptance 快照与 resources/design-context/responsive-a11y.json
 * ——模型可读、可复算，被 test/c53-responsive-a11y.test.mjs 锚定。
 *
 * 用法：node scripts/c53-responsive-a11y.mjs            # 写快照+契约+manifest
 *       node scripts/c53-responsive-a11y.mjs --check    # 只重算并与落盘 value 比对
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { deepStrictEqual } from 'node:assert/strict';
import {
  scanFocusGaps, stripCssComments, computeContrastPairs,
  FOCUS_GAP_BASELINE, STATE_MATRIX, WCAG_AA_BODY, WCAG_AA_LARGE,
} from './ui-design-a11y.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'frontend/src');

/** 冻结读数 = 设计不变量（跨工作包生命周期稳定），被消费测试逐读数深等。 */
export const READING_IDS = Object.freeze([
  'keyboardFocus', 'ariaStateMachine', 'contrast',
  'breakpoints', 'touchTargets', 'eightStateMatrix',
]);

// own-enumerable 查找（BLOCK-456 先例），避免 object-injection 告警。
const ownGet = (obj, key) => Object.entries(obj ?? {}).find(([k]) => k === key)?.[1];
const readText = (rel, root = ROOT) => fs.readFileSync(path.join(root, rel), 'utf8');

function walk(dir, exts = /\.(css|ts|tsx|js|jsx)$/) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { out.push(...walk(full, exts)); continue; }
    if (!exts.test(entry.name)) continue;
    if (/\.(test|spec)\.(ts|tsx|js|jsx)$/.test(entry.name)) continue;
    out.push(full);
  }
  return out;
}

const relOf = (file) => path.relative(SRC, file).replaceAll('\\', '/');

/** 纯函数：CSS 全源断点扫描。sourcesOverride 为 {rel:text} 映射（测试注入用）。 */
export function scanBreakpoints(sourcesOverride = null) {
  const sources = new Map();
  if (sourcesOverride) {
    for (const [rel, text] of Object.entries(sourcesOverride)) sources.set(rel, stripCssComments(String(text)));
  } else {
    for (const file of walk(path.join(ROOT, 'frontend/src'), /\.css$/)) {
      sources.set(relOf(file), stripCssComments(fs.readFileSync(file, 'utf8')));
    }
  }
  let media = 0, container = 0;
  const widths = new Set();
  const perFileEntries = [];
  for (const [rel, text] of sources) {
    let n = 0;
    for (const m of text.matchAll(/@media[^{]*?\(([^)]*width[^)]*)\)/g)) {
      media++; n++;
      for (const w of m[1].matchAll(/(\d+)px/g)) widths.add(Number(w[1]));
    }
    for (const m of text.matchAll(/@container[^{]*?\(([^)]*width[^)]*)\)/g)) {
      container++; n++;
      for (const w of m[1].matchAll(/(\d+)px/g)) widths.add(Number(w[1]));
    }
    if (n) perFileEntries.push([rel, n]);
  }
  const sorted = [...widths].sort((a, b) => a - b);
  // 窄屏覆盖存在性：存在 ≤700px 的断点（当前现读 520/560/640/680/700 等）。
  const narrowCoverage = sorted.some((w) => w > 0 && w <= 700);
  return {
    media,
    container,
    total: media + container,
    widthSteps: sorted,
    widthStepCount: sorted.length,
    narrowCoverage,
    perFile: Object.fromEntries(perFileEntries.sort(([a], [b]) => a.localeCompare(b))),
  };
}

/**
 * 冻结断点 ratchet 下限（只减必红，新增合法）：立项现读 26 media / 10 container / 20 档位。
 * widthStepCount 20→12（2026-11-21 R2 清偿批 S6b/U-04 契约演进）：视口档位收敛 17→4（520/768/960/1200，
 * 用户预授权 breaking；@container 元素级 5 档 + WIP 面 5 档仍在 = 12 实测）——覆盖意图由
 * narrowCoverage + media/container 下限继续守护，distinct 档位数下限随收敛下调；
 * B-11 owner 收口后并档可再降（trail 本行）。
 */
export const BREAKPOINT_FLOOR = Object.freeze({
  media: 26,
  container: 10,
  widthStepCount: 12,
  narrowCoverageRequired: true,
  owner: 'BLOCK-473 / C-53 P4：立项现读 2026-11-18；新增断点合法，删除至低于下限或丢失窄屏覆盖必红；观感归 E',
});

/**
 * 纯函数：触摸目标尺寸现读（控件单源 button.module.css）。
 * 从 .iconBase / .base 主定义取 width/height/height 字面 px；桌面形态声明，不擅自改 CSS。
 */
export function scanTouchTargets(buttonCss) {
  const clean = stripCssComments(String(buttonCss || ''));
  const blockOf = (sel) => {
    const m = new RegExp(`\\.${sel}\\s*\\{([^}]*)\\}`).exec(clean);
    return m ? m[1] : '';
  };
  const pxOf = (block, prop) => {
    const m = new RegExp(`${prop}\\s*:\\s*(\\d+(?:\\.\\d+)?)px`).exec(block);
    return m ? Number(m[1]) : null;
  };
  const icon = blockOf('iconBase');
  const base = blockOf('base');
  const iconSize = pxOf(icon, 'width') ?? pxOf(icon, 'height');
  const baseHeight = pxOf(base, 'height');
  const WCAG_TARGET_MIN = 24; // WCAG 2.2 SC 2.5.8 Target Size (Minimum) AA
  return {
    iconBasePx: iconSize,
    standardBaseHeightPx: baseHeight,
    wcagTargetMinPx: WCAG_TARGET_MIN,
    iconMeetsMinimum: iconSize !== null && iconSize >= WCAG_TARGET_MIN,
    standardMeetsMinimum: baseHeight !== null && baseHeight >= WCAG_TARGET_MIN,
    desktopFormFactor: true,
    note: '桌面 Electron 形态；图标按钮 24px 达标、标准按钮 30px 达标；<24px 项（如 status min-height 20px）为信息行非点击目标，如实登记不改 CSS（观感归 E）。',
  };
}

/**
 * 纯函数：ARIA 状态机四类证据计数。sourcesOverride 为 {rel:text} 映射（测试注入用）。
 * 缺省从 root 的 TSX 全源（排除测试）现读。
 */
export function scanAriaStateMachine(root = ROOT, sourcesOverride = null) {
  const chunks = [];
  if (sourcesOverride) {
    for (const text of Object.values(sourcesOverride)) chunks.push(String(text));
  } else {
    for (const file of walk(path.join(root, 'frontend/src'), /\.tsx?$/)) {
      chunks.push(fs.readFileSync(file, 'utf8'));
    }
  }
  const src = chunks.join('\n');
  return {
    ariaBusy: (src.match(/aria-busy/g) || []).length,
    roleAlert: (src.match(/role=["']alert["']/g) || []).length,
    roleStatus: (src.match(/role=["']status["']/g) || []).length,
    ariaLive: (src.match(/aria-live/g) || []).length,
  };
}

/** 结构完整性 fail-closed：缺读数/缺元数据/value 含 null 子字段即红。 */
export function validateResponsiveA11yIntegrity(readings) {
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

/** 纯函数：机械复算全部六组读数。返回 { [id]: {value, source, command, capturedAt} }。 */
export function collectResponsiveA11y(root = ROOT) {
  const capturedAt = new Date().toISOString();
  const mk = (value, source, command) => ({ value, source, command, capturedAt });
  const cmd = 'node scripts/c53-responsive-a11y.mjs';

  // A 键盘/焦点：复用 ui-design-a11y 真源扫描器（自身排除 WIP CSS）。
  const cssSources = new Map();
  for (const file of walk(path.join(root, 'frontend/src'), /\.css$/)) {
    cssSources.set(relOf(file), fs.readFileSync(file, 'utf8'));
  }
  const gaps = scanFocusGaps(cssSources);
  const focusGaps = Object.fromEntries([...gaps.entries()].sort(([a], [b]) => a.localeCompare(b)));
  const focusGapFiles = gaps.size;
  const focusGapDeclarations = [...gaps.values()].reduce((a, b) => a + b, 0);
  // inert 语义：nso-w3-a11y 契约的 CenterPanel 隐藏投影层键盘隔离（TSX 现读 inert=）。
  let inert = 0, focusVisibleRules = 0;
  for (const [, text] of cssSources) focusVisibleRules += (stripCssComments(text).match(/:focus-visible/g) || []).length;
  for (const file of walk(path.join(root, 'frontend/src'), /\.tsx?$/)) {
    if (/\.(test|spec)\./.test(file)) continue;
    inert += (fs.readFileSync(file, 'utf8').match(/\binert(?:=|\s|>|\})/g) || []).length;
  }
  const keyboardFocus = {
    focusGapFiles,
    focusGapDeclarations,
    frozenFiles: FOCUS_GAP_BASELINE.files,
    frozenDeclarations: FOCUS_GAP_BASELINE.declarations,
    overRatchet: focusGapFiles > FOCUS_GAP_BASELINE.files || focusGapDeclarations > FOCUS_GAP_BASELINE.declarations,
    focusGaps,
    inertOccurrences: inert,
    focusVisibleRules,
    keyboardIsolationPresent: inert > 0 && focusVisibleRules > 0,
  };

  // B ARIA 状态机
  const ariaStateMachine = scanAriaStateMachine(root);
  // C 对比度（复用真源纯函数）
  const pairs = computeContrastPairs();
  const belowBody = pairs.filter((p) => p.ratio !== null && p.ratio < WCAG_AA_BODY)
    .map((p) => ({ theme: p.theme, textName: p.textName, surfaceName: p.surfaceName, ratio: p.ratio }));
  const contrast = {
    pairCount: pairs.length,
    bodyThreshold: WCAG_AA_BODY,
    largeThreshold: WCAG_AA_LARGE,
    belowBodyCount: belowBody.length,
    belowBody,
    thresholdsNotRelaxed: WCAG_AA_BODY >= 4.5 && WCAG_AA_LARGE >= 3.0,
  };
  // D 断点
  const breakpoints = scanBreakpoints();
  // E 触摸目标
  const touchTargets = scanTouchTargets(readText('frontend/src/components/ui/controls/button.module.css', root));
  // F 八态矩阵
  const eightStateMatrix = {
    cells: STATE_MATRIX.length,
    complete: STATE_MATRIX.every((r) => r.key && r.criterion && r.evidence && r.terminal),
    humanEyeCells: STATE_MATRIX.filter((r) => String(r.terminal).includes('pending_human_eye')).length,
  };

  // fail-closed：任何契约级违例直接抛错，拒绝生成"看起来绿的"快照。
  if (keyboardFocus.overRatchet || !keyboardFocus.keyboardIsolationPresent) {
    throw new Error(`[c53:a11y] 键盘/焦点违约: ${JSON.stringify({ overRatchet: keyboardFocus.overRatchet, isolation: keyboardFocus.keyboardIsolationPresent, files: focusGapFiles, declarations: focusGapDeclarations })}`);
  }
  for (const [k, v] of Object.entries(ariaStateMachine)) {
    if (!(v > 0)) throw new Error(`[c53:a11y] ARIA 状态机证据缺失: ${k} = ${v}`);
  }
  if (!contrast.thresholdsNotRelaxed) throw new Error('[c53:a11y] WCAG AA 阈值被放宽');
  if (breakpoints.media < BREAKPOINT_FLOOR.media || breakpoints.container < BREAKPOINT_FLOOR.container
      || breakpoints.widthStepCount < BREAKPOINT_FLOOR.widthStepCount || !breakpoints.narrowCoverage) {
    throw new Error(`[c53:a11y] 断点覆盖低于冻结下限: ${JSON.stringify({ media: breakpoints.media, container: breakpoints.container, steps: breakpoints.widthStepCount, narrow: breakpoints.narrowCoverage })}`);
  }
  if (!eightStateMatrix.complete || eightStateMatrix.cells !== 32) {
    throw new Error(`[c53:a11y] 八态矩阵不完整: ${JSON.stringify(eightStateMatrix)}`);
  }

  return {
    keyboardFocus: mk(keyboardFocus, 'frontend/src CSS 全源 + ui-design-a11y.mjs FOCUS_GAP_BASELINE + nso-w3-a11y inert 语义', cmd),
    ariaStateMachine: mk(ariaStateMachine, 'frontend/src TSX 全源（aria-busy/role=alert/role=status/aria-live）', cmd),
    contrast: mk(contrast, 'scripts/ui-design-a11y.mjs computeContrastPairs + custom.css token 对账表', cmd),
    breakpoints: mk(breakpoints, 'frontend/src CSS 全源（@media/@container 宽度断点）', cmd),
    touchTargets: mk(touchTargets, 'frontend/src/components/ui/controls/button.module.css', cmd),
    eightStateMatrix: mk(eightStateMatrix, 'scripts/ui-design-a11y.mjs STATE_MATRIX', cmd),
  };
}

const sourceCommitOf = (root) => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();

function main(argv) {
  const readings = collectResponsiveA11y(ROOT);
  const check = validateResponsiveA11yIntegrity(readings);
  if (!check.ok) {
    console.error(`[c53:a11y] 读数不合格，拒绝写盘: ${check.issues.join('; ')}`);
    process.exitCode = 1;
    return;
  }
  const sourceCommit = sourceCommitOf(ROOT);
  const snapPath = path.join(ROOT, 'acceptance/block473-c53-p4-responsive-a11y/responsive-a11y-snapshot.json');
  const contractPath = path.join(ROOT, 'resources/design-context/responsive-a11y.json');
  const manifestPath = path.join(ROOT, 'resources/design-context/manifest.json');

  if (argv.includes('--check')) {
    if (!fs.existsSync(snapPath)) { console.error('[c53:a11y] 快照缺席，请先生成'); process.exitCode = 1; return; }
    const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
    for (const id of READING_IDS) {
      try { deepStrictEqual(ownGet(readings, id).value, ownGet(snap.readings, id).value); }
      catch { console.error(`[c53:a11y] --check 漂移: ${id}`); process.exitCode = 1; return; }
    }
    console.log(JSON.stringify({
      ok: true,
      sourceCommit,
      readingIds: READING_IDS,
      focusGapFiles: ownGet(readings, 'keyboardFocus').value.focusGapFiles,
      stateMachine: ownGet(readings, 'ariaStateMachine').value,
      breakpointTotal: ownGet(readings, 'breakpoints').value.total,
    }, null, 2));
    return;
  }

  const frozenReadings = Object.fromEntries(READING_IDS.map((id) => [id, ownGet(readings, id)]));
  const snapshot = {
    schemaVersion: 1,
    kind: 'c53-responsive-a11y',
    capability: 'block473-c53-p4-responsive-a11y',
    sourceCommit,
    platform: `${os.platform()}-${os.arch()}`,
    command: 'node scripts/c53-responsive-a11y.mjs',
    generatedAt: new Date().toISOString(),
    evidenceClass: 'mechanical-gate',
    verdict: 'measured',
    humanEyeEquivalent: false,
    note: '读数=机械不变量（冻结，消费测试逐读数深等）；观感项 pending_human_eye 不代签，本包只读不改任何 CSS/组件/token 定义。',
    readings: frozenReadings,
  };

  const contract = {
    schemaVersion: 1,
    id: 'petri-responsive-a11y-contract',
    kind: 'model-readable-responsive-a11y',
    generatedBy: 'node scripts/c53-responsive-a11y.mjs',
    sourceCommit,
    generatedAt: new Date().toISOString(),
    derivedFrom: [
      'scripts/ui-design-a11y.mjs（focus 缺口/对比度/状态矩阵真源函数）',
      'frontend/src（TSX 状态机 / CSS 断点 / focus 语义扫描）',
      'frontend/src/components/ui/controls/button.module.css',
      'frontend/src/themes/nso-w3-a11y.test.tsx（inert 键盘隔离契约）',
    ],
    keyboardFocus: ownGet(readings, 'keyboardFocus').value,
    ariaStateMachine: ownGet(readings, 'ariaStateMachine').value,
    contrast: ownGet(readings, 'contrast').value,
    breakpoints: ownGet(readings, 'breakpoints').value,
    touchTargets: ownGet(readings, 'touchTargets').value,
    eightStateMatrix: ownGet(readings, 'eightStateMatrix').value,
    boundaries: {
      humanEyeSigned: false,
      readOnly: true,
      note: '观感项 pending_human_eye（E 类人眼 22 条 / UI-706/707/709/710）保持 in_progress，Agent 不代签；本契约为只读机械扫描，不改任何 CSS/组件/token 定义。',
    },
  };

  const contractBuf = Buffer.from(`${JSON.stringify(contract, null, 2)}\n`, 'utf8');
  for (const p of [snapPath, contractPath, manifestPath]) fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(snapPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  fs.writeFileSync(contractPath, contractBuf);

  // manifest 同步（沿 P1/P2/P3 先例）：responsive-a11y 的 sha256 由生成器自身维护。
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const files = Array.isArray(manifest.files) ? manifest.files : [];
  const sha = createHash('sha256').update(contractBuf).digest('hex');
  const entry = files.find((f) => ownGet(f, 'path') === 'responsive-a11y.json');
  if (entry) entry.sha256 = sha;
  else files.push({ path: 'responsive-a11y.json', sha256: sha });
  manifest.files = files;
  manifest.generatedAt = new Date().toISOString();
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(JSON.stringify({
    written: [snapPath, contractPath, manifestPath].map((p) => path.relative(ROOT, p)),
    sourceCommit,
    readingIds: READING_IDS,
    focusGapFiles: ownGet(readings, 'keyboardFocus').value.focusGapFiles,
    breakpointTotal: ownGet(readings, 'breakpoints').value.total,
  }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exitCode = 1; }
}
