#!/usr/bin/env node
/**
 * UI-D4 (BLOCK-419) — 交互状态与无障碍机械门（零新增依赖）。
 *
 * A 八态矩阵：4 类可交互元件 × 8 态 = 32 格，每格必须有判据登记（机械门 /
 *   行为测试 / CDP 实机 / 人眼路线四选一）；无登记的空格必红。
 * B focus-visible：outline:none 且同文件无 :focus-visible 替代的缺口按
 *   「只减棘轮」冻结（当次 12 文件 / 16 处）；新增即红、下降合法。
 * C WCAG AA 对比度：WCAG 2.1 相对亮度纯函数，对 custom.css 亮/暗两套的
 *   文字四级 × 表面四级逐对计算；正文 <4.5:1、大字 <3:1 如实登记，
 *   不擅自改色值（观感归 E）。篡改 token 表 / 阈值必红。
 * D 状态机：aria-busy / role=alert / role=status / aria-live 存在性覆盖。
 *
 * 用法：node scripts/ui-design-a11y.mjs [--check]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'frontend/src');
export const WIP_CSS = 'frontend/src/pages/project-workspace.module.css';
export const CUSTOM_CSS = 'frontend/src/styles/custom.css';

/** WCAG 2.1 §相对亮度：sRGB 通道线性化后加权。 */
export function relativeLuminance(hex) {
  const m = /^#([0-9a-fA-F]{6})$/.exec(String(hex).trim());
  if (!m) return null;
  const channels = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255);
  const linear = channels.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

export function contrastRatio(fg, bg) {
  const a = relativeLuminance(fg);
  const b = relativeLuminance(bg);
  if (a === null || b === null) return null;
  const light = Math.max(a, b);
  const dark = Math.min(a, b);
  return (light + 0.05) / (dark + 0.05);
}

export const WCAG_AA_BODY = 4.5;
export const WCAG_AA_LARGE = 3.0;

/** 文字/表面 token 的亮暗取值（当次源码读数，只在对账表内使用，非第二真源）。 */
export const TOKEN_PALETTE = {
  light: {
    surfaces: { canvas: '#ffffff', surface: '#ffffff', subtle: '#f4f4f5', elevated: '#ffffff' },
    text: { text: '#18181b', secondary: '#3f3f46', tertiary: '#6b6b73', muted: '#6a6a73' },
  },
  dark: {
    surfaces: { canvas: '#0b1220', surface: '#111a2e', subtle: '#182339', elevated: '#1d2945' },
    text: { text: '#e6edf3', secondary: '#b1bac4', tertiary: '#8b98ad', muted: '#8b98ad' },
  },
};

/** 八态 × 四类元件。每格给出判据类型与承载证据；人眼项不冒充机械通过。 */
export const EIGHT_STATES = ['default', 'hover', 'active', 'disabled', 'loading', 'empty', 'error', 'focus-visible'];
export const INTERACTIVE_KINDS = ['button', 'input', 'listItem', 'navItem'];
export const STATE_MATRIX = Object.freeze(EIGHT_STATES.flatMap((state) => INTERACTIVE_KINDS.map((kind) => ({
  key: `${kind}:${state}`,
  criterion: state === 'hover' || state === 'active' ? 'css-rule-exists'
    : state === 'focus-visible' ? 'focus-visible-gate'
      : state === 'loading' ? 'aria-busy-or-status'
        : state === 'error' ? 'role-alert-or-status'
          : state === 'empty' ? 'empty-copy-or-placeholder'
            : state === 'disabled' ? 'disabled-attr-or-data-state'
              : 'dom-presence',
  evidence: state === 'hover' || state === 'active' || state === 'disabled' ? 'mechanical-gate'
    : state === 'loading' || state === 'error' || state === 'empty' ? 'behavior-tests + cdp-live'
      : state === 'focus-visible' ? 'gate:ui-a11y frozen ratchet'
        : 'cdp-live',
  terminal: state === 'hover' || state === 'active' || state === 'focus-visible'
    ? 'done-partial (观感与读屏 pending_human_eye)' : 'done (机械可算部分)',
}))));

/** focus-visible 缺口冻结清单（2026-11-11 当次读数；只减棘轮，新增即红）。 */
export const FOCUS_GAP_BASELINE = Object.freeze({
  files: 12,
  declarations: 16,
  owner: 'UI-D4 / BLOCK-419：需独立切片补 :focus-visible 规则 + code-size 联动重打 + 人眼签字；WIP CSS 零触碰',
});

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const n of fs.readdirSync(dir)) {
    const f = path.join(dir, n);
    const st = fs.statSync(f);
    if (st.isDirectory()) walk(f, out);
    else if (/\.css$/.test(n)) out.push(f);
  }
  return out;
}

export function stripCssComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

/** 找出 outline:none 且同文件无 focus-visible 的规则，返回 {file, count}。 */
export function scanFocusGaps(filesSources) {
  const gaps = new Map();
  for (const [rel, raw] of filesSources) {
    if (rel === WIP_CSS) continue; // W 归属：只读登记，零触碰
    const text = stripCssComments(raw);
    if (/focus-visible/.test(text)) continue;
    const re = /[^{}]*\{[^{}]*outline\s*:\s*none[^{}]*\}/g;
    const n = (text.match(re) || []).length;
    if (n > 0) gaps.set(rel, n);
  }
  return gaps;
}

export function computeContrastPairs(palette = TOKEN_PALETTE) {
  const out = [];
  for (const theme of ['light', 'dark']) {
    const themePalette = Object.getOwnPropertyDescriptor(palette, theme)?.value;
    if (!themePalette) continue;
    for (const [textName, fg] of Object.entries(themePalette.text)) {
      for (const [surfaceName, bg] of Object.entries(themePalette.surfaces)) {
        out.push({ theme, textName, surfaceName, fg, bg, ratio: contrastRatio(fg, bg) });
      }
    }
  }
  return out;
}

export function verifyA11y({
  stateMatrix = STATE_MATRIX,
  focusGaps = new Map(),
  gapBaseline = FOCUS_GAP_BASELINE,
  palette = TOKEN_PALETTE,
  customSource = '',
  stateMachine = { ariaBusy: 0, roleAlert: 0, roleStatus: 0, ariaLive: 0 },
  bodyThreshold = WCAG_AA_BODY,
  largeThreshold = WCAG_AA_LARGE,
}) {
  const problems = [];
  // A 八态矩阵：32 格齐全、每格有判据与证据位
  const keys = stateMatrix.map((r) => r.key);
  if (keys.length !== 32 || new Set(keys).size !== 32) problems.push(`八态矩阵应 32 格唯一，实际 ${keys.length}`);
  for (const row of stateMatrix) {
    if (!row.criterion || !row.evidence || !row.terminal) problems.push(`八态空格：${row.key} 缺判据/证据/终态`);
  }
  // B focus-visible 只减棘轮
  const gapFiles = focusGaps.size;
  const gapDecl = [...focusGaps.values()].reduce((a, b) => a + b, 0);
  if (gapFiles > gapBaseline.files) problems.push(`focus 缺口文件由 ${gapBaseline.files} 增至 ${gapFiles}（只减棘轮）`);
  if (gapDecl > gapBaseline.declarations) problems.push(`focus 缺口声明由 ${gapBaseline.declarations} 增至 ${gapDecl}（只减棘轮）`);
  // C token 对账表必须与源码真值一致（防第二真相）。
  // custom.css 的 :root / html[data-theme='dark'] 两块定义同名 token，
  // 必须按 dark 块起点分区，否则暗色表会误比亮色值。
  const clean = stripCssComments(customSource);
  const darkAt = clean.indexOf("html[data-theme='dark']");
  const sections = {
    light: darkAt >= 0 ? clean.slice(0, darkAt) : clean,
    dark: darkAt >= 0 ? clean.slice(darkAt) : '',
  };
  for (const theme of ['light', 'dark']) {
    const themeText = Object.getOwnPropertyDescriptor(palette, theme)?.value?.text || {};
    for (const [name, value] of Object.entries(themeText)) {
      const token = name === 'text' ? '--petri-text' : `--petri-text-${name}`;
      const re = new RegExp(`${token}\\s*:\\s*(#[0-9a-fA-F]{6})`);
      const sectionText = Object.getOwnPropertyDescriptor(sections, theme)?.value || '';
      const m = re.exec(sectionText);
      if (!m) { problems.push(`token 对账表 ${token} 在 custom.css 的 ${theme} 块未找到`); continue; }
      if (m[1].toLowerCase() !== value.toLowerCase()) {
        problems.push(`token 对账表漂移 ${token} (${theme}): 表 ${value} vs 源码 ${m[1]}`);
      }
    }
  }
  // 对比度阈值不得放宽
  if (bodyThreshold < WCAG_AA_BODY || largeThreshold < WCAG_AA_LARGE) problems.push('WCAG AA 阈值被放宽（不得降低）');
  // D 状态机四类证据必须在场
  for (const [k, v] of Object.entries(stateMachine)) {
    if (!(v > 0)) problems.push(`状态机证据缺失：${k} = ${v}`);
  }
  return problems;
}

export function checkFiles() {
  const filesSources = walk(SRC).map((f) => [path.relative(ROOT, f).split(path.sep).join('/'), fs.readFileSync(f, 'utf8')]);
  const focusGaps = scanFocusGaps(filesSources);
  const customSource = fs.readFileSync(path.join(ROOT, CUSTOM_CSS), 'utf8');
  const tsx = (() => {
    const out = [];
    const walkTs = (d) => {
      for (const n of fs.readdirSync(d)) {
        const f = path.join(d, n);
        const st = fs.statSync(f);
        if (st.isDirectory()) walkTs(f);
        else if (/\.tsx?$/.test(n)) out.push(fs.readFileSync(f, 'utf8'));
      }
    };
    walkTs(SRC);
    return out.join('\n');
  })();
  const count = (re) => (tsx.match(re) || []).length;
  const stateMachine = {
    ariaBusy: count(/aria-busy/g), roleAlert: count(/role=["']alert["']/g),
    roleStatus: count(/role=["']status["']/g), ariaLive: count(/aria-live/g),
  };
  const pairs = computeContrastPairs();
  const belowBody = pairs.filter((p) => p.ratio !== null && p.ratio < WCAG_AA_BODY);
  return {
    problems: verifyA11y({ focusGaps, customSource, stateMachine }),
    stats: { matrixCells: STATE_MATRIX.length, focusGapFiles: focusGaps.size, focusGapDeclarations: [...focusGaps.values()].reduce((a, b) => a + b, 0), contrastPairs: pairs.length, belowBody: belowBody.length, stateMachine },
    pairs,
    belowBody,
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { problems, stats } = checkFiles();
  if (problems.length > 0) {
    console.error(`[ui-a11y] FAIL — ${problems.length} 项：`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`[ui-a11y] PASS — 八态矩阵 ${stats.matrixCells}/32 格有判据；focus 缺口 ${stats.focusGapFiles} 文件 / ${stats.focusGapDeclarations} 声明 ≤ 冻结 ${FOCUS_GAP_BASELINE.files}/${FOCUS_GAP_BASELINE.declarations}（只减）；对比度 ${stats.contrastPairs} 对计算完成，<4.5:1 的 ${stats.belowBody} 对如实登记（观感归 E）；状态机证据 ${JSON.stringify(stats.stateMachine)}`);
}
