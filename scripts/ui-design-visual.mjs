#!/usr/bin/env node
/**
 * UI-D3 (BLOCK-418) — 视觉语义机械门（本地可审计 / 治理透明 / 证据自证）。
 *
 * 判据：
 *  A hover 语义唯一真源：--petri-hover 明暗各 1 处物理定义，4 个别名只许 var() 指向它；
 *  B selected 专用 token 明暗成对且有真实消费点；
 *  C --petri-surface-dim 跨文件重复定义 = 0（只有 custom.css 的 :root / dark 两处）；
 *  D 裸 z-index：非 WIP CSS 里精确等于 8 档值者必须已迁移到 var(--petri-z-*)；
 *  E 非 WIP CSS 的 `;;` = 0；WIP 文件显式登记 owner、零触碰；
 *  F 颜色 fallback 快照条目 ≤ 当次现值（下调非放宽，棘轮本体在 theme-token-contract.test.ts）。
 *
 * 用法：node scripts/ui-design-visual.mjs [--check]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'frontend/src');
export const WIP_CSS = 'frontend/src/pages/project-workspace.module.css';
export const CUSTOM_CSS = 'frontend/src/styles/custom.css';
export const GLOBAL_CSS = 'frontend/src/styles/global.css';

/** 表面 hover 别名：只许 var() 指向真源；在 :root 定义一次即自动继承明暗（链继承合法）。 */
export const HOVER_ALIASES = [
  '--petri-surface-hover', '--petri-bg-hover', '--petri-bg-button-hover',
];
/** 强调色 hover 是独立语义（4 主题色 × 明暗），只许在 custom.css 单一真源内定义。 */
export const ACCENT_HOVER = '--petri-accent-hover';
export const HOVER_ROOT = '--petri-hover';
export const SELECTED_TOKENS = ['--petri-selected-bg', '--petri-selected-border', '--petri-selected-text'];
export const Z_TIER_VALUES = [10, 100, 500, 1000, 4000, 6000, 8000, 10000];
/**
 * 精确档位裸 z 的冻结清单（只减棘轮）：这 3 处所在的 CSS 文件已入 code-size 台账，
 * 替换为更长的 `var(--petri-z-*)` 会让文件字节超过「只减不增」锚点；按红线不放宽
 * 基线，故保留裸值并登记。清单只许收缩：新增任何精确档位裸 z 必红。
 */
export const Z_TIER_FROZEN = [
  { file: 'frontend/src/components/svg-editor/SvgEditorViewer.module.css', value: 10, count: 2, reason: 'code-size 字节棘轮只减不增；owner 收口后随独立切片迁移' },
  { file: 'frontend/src/components/desktop/TitleBar.module.css', value: 10000, count: 1, reason: '同上；该值精确等于 --petri-z-toast' },
];
export const WIP_OWNER = '他方在制 WIP（BLOCK-395 B-11）：128 处 ;; / 26 处裸 z / 39 处 fallback 零触碰，待 owner 收口';

/** 当次 fallback 现值（17 文件 / 190 处，报告 §1.2 记 189，按当次读数优先）。 */
export const FALLBACK_SNAPSHOT = {
  'components/copilot/ResultCard.module.css': 16,
  'components/copilot/integration/integration.module.css': 2,
  'components/copilot/renderers/ChartRenderer.module.css': 1,
  'components/copilot/simple-chat.css': 45,
  'components/desktop/DesktopSettingsPanel/sections/Federation.module.css': 1,
  'components/desktop/FolderPicker.module.css': 1,
  'components/desktop/TestInstanceBadge.module.css': 1,
  'components/desktop/WorkingTreeReview/CodeReviewDrawer.module.css': 14,
  'components/result-studio/ResultStudioChangeSetPanel.module.css': 1,
  'components/settings/ExperimentalFeaturesSection.module.css': 6,
  'components/ui/code-highlight.css': 6,
  'components/window/window-shell.module.css': 15,
  'components/workspace-panels/SshStatusDot.module.css': 3,
  'pages/home.module.css': 1,
  'pages/project-workspace.module.css': 39,
  'pages/welcome.module.css': 1,
  'pages/window/command-center.module.css': 37,
};

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

/** 抽出 token 定义 {name, value, light|dark}（按文件内块位置粗略分主题）。 */
export function extractTokenDefinitions(source) {
  const clean = stripCssComments(source);
  const out = [];
  const darkAt = clean.indexOf("html[data-theme='dark']");
  const re = /(--petri-[A-Za-z0-9-]+)\s*:\s*([^;]+);/g;
  let m;
  while ((m = re.exec(clean)) !== null) {
    out.push({ name: m[1], value: m[2].trim(), theme: darkAt >= 0 && m.index > darkAt ? 'dark' : 'light' });
  }
  return out;
}

export function countFallbacks(source) {
  return (stripCssComments(source).match(/var\(--petri-[A-Za-z0-9-]+\s*,\s*(?:#[0-9a-fA-F]{3,8}|rgba?\()/g) || []).length;
}

export function readVisualState() {
  const cssFiles = walk(SRC).map((f) => path.relative(ROOT, f).split(path.sep).join('/'));
  const definitions = new Map();
  const fallbacks = new Map();
  const doubleSemis = new Map();
  const bareZTiers = [];
  for (const rel of cssFiles) {
    const source = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    definitions.set(rel, extractTokenDefinitions(source));
    fallbacks.set(rel, countFallbacks(source));
    if (rel === WIP_CSS) continue; // W 归属：零触碰，不计入门禁判据
    doubleSemis.set(rel, (stripCssComments(source).match(/;;/g) || []).length);
    const clean = stripCssComments(source);
    const zRe = /\bz-index\s*:\s*(\d+)\s*;/g;
    let z;
    while ((z = zRe.exec(clean)) !== null) {
      if (Z_TIER_VALUES.includes(Number(z[1]))) bareZTiers.push({ file: rel, value: Number(z[1]) });
    }
  }
  // 消费点必须排除「定义语句」（--petri-selected-x: ...）只数 var() 使用
  const selectedConsumers = cssFiles.filter((rel) => /var\(--petri-selected-(?:bg|border|text)/.test(stripCssComments(fs.readFileSync(path.join(ROOT, rel), 'utf8')))
    && !/--petri-selected-(?:bg|border|text)\s*:/.test(stripCssComments(fs.readFileSync(path.join(ROOT, rel), 'utf8'))));
  return { cssFiles, definitions, fallbacks, doubleSemis, bareZTiers, selectedConsumers };
}

export function verifyVisual({
  definitions, fallbacks, doubleSemis, bareZTiers, selectedConsumers,
  hoverAliases = HOVER_ALIASES, hoverRoot = HOVER_ROOT,
  selectedTokens = SELECTED_TOKENS, customCss = CUSTOM_CSS,
  wipFile = WIP_CSS, snapshot = FALLBACK_SNAPSHOT,
  zFrozen = Z_TIER_FROZEN,
}) {
  const problems = [];
  // token 定义域 = styles/ 下所有文件（selected 真源在 global.css，hover 在 custom.css）
  const styleDefs = [...definitions].filter(([f]) => f.startsWith('frontend/src/styles/')).flatMap(([, defs]) => defs);
  const custom = styleDefs;
  const rootDefs = custom.filter((d) => d.name === hoverRoot);
  if (rootDefs.length !== 2) problems.push(`hover 真源 ${hoverRoot} 应有明暗各 1 处定义，实际 ${rootDefs.length}`);
  for (const alias of hoverAliases) {
    const defs = custom.filter((d) => d.name === alias);
    if (defs.length < 1 || defs.length > 2) problems.push(`hover 别名 ${alias} 定义 ${defs.length} 处（应 1 处链继承或明暗各 1）`);
    for (const d of defs) {
      if (!d.value.startsWith('var(')) problems.push(`hover 别名 ${alias} (${d.theme}) 自带颜色字面量 ${d.value}：必须 var() 指向 ${hoverRoot}`);
    }
  }
  // accent-hover 独立语义：不得外溢到组件 CSS，也不得混入表面 hover 别名集合
  if (hoverAliases.includes(ACCENT_HOVER)) problems.push('accent-hover 被误列为表面 hover 别名');
  for (const [file, defs] of definitions) {
    if (file !== customCss && defs.some((d) => d.name === ACCENT_HOVER)) {
      problems.push(`${ACCENT_HOVER} 外溢到 ${file}（应只在 custom.css 单一真源）`);
    }
  }
  for (const t of selectedTokens) {
    const defs = custom.filter((d) => d.name === t);
    if (defs.length !== 2) problems.push(`selected token ${t} 未明暗成对（实际 ${defs.length} 处）`);
  }
  if (!selectedConsumers.length) problems.push('selected token 无真实消费点（空声明）');
  // 跨文件重复定义：同一 token 在 >1 个文件里定义即红（明暗两处同文件允许）
  const owners = new Map();
  for (const [file, defs] of definitions) {
    for (const d of defs) {
      if (!owners.has(d.name)) owners.set(d.name, new Set());
      owners.get(d.name).add(file);
    }
  }
  for (const name of [...selectedTokens, '--petri-surface-dim']) {
    const files = owners.get(name) || new Set();
    if (files.size > 1) problems.push(`跨文件重复定义 ${name}: ${[...files].join(', ')}`);
  }
  const dimDefs = custom.filter((d) => d.name === '--petri-surface-dim');
  if (dimDefs.length !== 2) problems.push(`--petri-surface-dim 应有明暗各 1 处，实际 ${dimDefs.length}`);
  for (const [file, n] of doubleSemis) if (n > 0) problems.push(`非 WIP 文件 ${file} 残留 ${n} 处 ;;（应为 0）`);
  // 裸 z 只减棘轮：冻结清单内按文件+值计数不得超过登记值；清单外新增即红。
  const frozenBudget = new Map();
  for (const e of zFrozen) frozenBudget.set(`${e.file}::${e.value}`, e.count);
  const seenFrozen = new Map();
  for (const { file, value } of bareZTiers) {
    const key = `${file}::${value}`;
    if (!frozenBudget.has(key)) { problems.push(`裸 z-index ${value} @ ${file} 未在冻结清单登记（新增即红）`); continue; }
    seenFrozen.set(key, (seenFrozen.get(key) || 0) + 1);
  }
  for (const [key, allowed] of frozenBudget) {
    const found = seenFrozen.get(key) || 0;
    if (found > allowed) problems.push(`裸 z 冻结清单 ${key} 由 ${allowed} 增至 ${found}（只减棘轮）`);
  }
  for (const [file, allowed] of Object.entries(snapshot)) {
    const actual = fallbacks.get(`frontend/src/${file}`) ?? 0;
    if (actual > allowed) problems.push(`fallback 快照 ${file}: 现值 ${actual} > 冻结 ${allowed}`);
  }
  if (definitions.has(wipFile) && !Object.keys(snapshot).some((k) => wipFile.endsWith(k))) {
    problems.push('WIP 文件未显式登记 fallback 归属');
  }
  return problems;
}

export function checkFiles() {
  const state = readVisualState();
  return { problems: verifyVisual(state), stats: state };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { problems, stats } = checkFiles();
  if (problems.length > 0) {
    console.error(`[ui-visual] FAIL — ${problems.length} 项：`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`[ui-visual] PASS — ${stats.cssFiles.length} CSS 文件；hover 单源 / selected 成对且有消费 / surface-dim 跨文件重复 0 / 精确档位裸 z 冻结清单 ${Z_TIER_FROZEN.length} 组只减 / 非 WIP ;; 0 / fallback 快照 17 文件 190 处（下调）；WIP ${WIP_CSS} 显式登记 owner 零触碰`);
}
