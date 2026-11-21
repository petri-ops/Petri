#!/usr/bin/env node
/**
 * UI-D2 (BLOCK-417) — 响应式断点单一真源机械对账门。
 *
 * CSS `@media` 不支持 `var()`，单源只能靠「TS 常量 + 机械对账」。
 * 本门把 frontend/src/lib/uiBreakpoints.ts（JS 侧唯一真源）与 CSS 里
 * **@media/@container 条件**的阈值锁在一起（普通 `max-width: 320px` 属性
 * 不是断点，不计）：新增未登记阈值即红；JS 出现裸 `matchMedia('...px')` 即红；
 * 767 残留（应与 CSS 768 对齐）即红。
 *
 * WIP 文件（frontend/src/pages/project-workspace.module.css）是他方在制面，
 * 只读呈现其阈值并显式登记 owner，不由本门替 owner 设约束。
 *
 * 用法：node scripts/ui-design-breakpoints.mjs [--check]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const WIP_CSS = 'frontend/src/pages/project-workspace.module.css'; // 历史常量保留（B-11 并档后无 WIP 阈值）
export const BREAKPOINTS_TS = 'frontend/src/lib/uiBreakpoints.ts';
export const MOBILE_ALIGNED_PX = 768;
export const COMPACT_ALIGNED_PX = 960;

/**
 * 冻结登记表：@media/@container 条件里的阈值当次读数（12 档，含 WIP 面）。只减棘轮。
 * U-04 档位收敛（R2 清偿批 S6b，2026-11-21）：视口档位收敛至 4 档单源
 * 520（窄）/768（手机，JS 单源 MOBILE）/960（紧凑，JS 单源 COMPACT）/1200（宽），
 * 由 2026-11-21 现读聚类推导（簇={520,560,577}/{640..760,768}/{820,996,997,960}/{1120,1146,1380,1200}，
 * 锚点=簇内众数与既有 JS 单源常量）；560/577/680/760/820/996/997/1120/1380 九档移除。
 * 96/420/679/720/1146 为 @container 元素级查询（非视口档位，不参与 4 档收敛）；
 * 640/700/860 属 WIP 文件（BLOCK-395 B-11，owner 收口）。
 */
/**
 * U-04 收敛完成（2026-11-21 B-11 并档票）：BLOCK-395 已 completed（registry 在案），其 WIP 面
 * 三阈值并档（700→768 / 860→960；520/960 为锚）——WIP 例外退役，全部阈值并入常规只减表。
 * 登记表现读 8 档：96/420/520/679/720（@container 元素级）+ 768/960/1200（视口四档锚）。
 */
export const REGISTERED_THRESHOLDS = [
  96, 420, 520, 679, 720, 768, 960, 1146, 1200,
];

export const JS_SCAN_ROOTS = ['frontend/src/hooks', 'frontend/src/components', 'frontend/src/pages', 'frontend/src/lib'];
export const JS_SCAN_EXEMPT = new Set([BREAKPOINTS_TS]);

function walk(dir, ext, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, ext, out);
    else if (ext.test(name)) out.push(full);
  }
  return out;
}

/** 只从 @media / @container 声明行取 (max|min)-width: Npx。 */
export function extractCssThresholds(source) {
  const out = new Set();
  const lines = source.split('\n');
  for (const line of lines) {
    if (!/@(media|container)\b/.test(line)) continue;
    const re = /\((?:max|min)-width:\s*(\d+)px\)/g;
    let m;
    while ((m = re.exec(line)) !== null) out.add(Number(m[1]));
  }
  return [...out].sort((a, b) => a - b);
}

export function extractJsBareThresholds(source) {
  const out = [];
  const re = /matchMedia\(\s*['"`]\s*\((?:max|min)-width:\s*(\d+)px\)/g;
  let m;
  while ((m = re.exec(source)) !== null) out.push(Number(m[1]));
  return out;
}

export function readAllThresholds() {
  const byFile = new Map();
  for (const f of walk(path.join(ROOT, 'frontend/src'), /\.css$/)) {
    const rel = path.relative(ROOT, f).split(path.sep).join('/');
    byFile.set(rel, extractCssThresholds(fs.readFileSync(f, 'utf8')));
  }
  const jsBare = [];
  for (const root of JS_SCAN_ROOTS) {
    for (const f of walk(path.join(ROOT, root), /\.(?:ts|tsx)$/)) {
      const rel = path.relative(ROOT, f).split(path.sep).join('/');
      if (JS_SCAN_EXEMPT.has(rel)) continue;
      for (const px of extractJsBareThresholds(fs.readFileSync(f, 'utf8'))) jsBare.push({ file: rel, px });
    }
  }
  return { byFile, jsBare };
}

export function verifyBreakpoints({
  byFile,
  jsBare,
  registered = REGISTERED_THRESHOLDS,
  wipFile = WIP_CSS,
  mobileAligned = MOBILE_ALIGNED_PX,
  compactAligned = COMPACT_ALIGNED_PX,
  tsSource = '',
}) {
  const problems = [];
  const known = new Set(registered);
  for (const [file, values] of byFile) {
    if (file === wipFile) continue; // W 归属：只读登记，不替 owner 设约束
    for (const v of values) {
      if (!known.has(v)) problems.push(`未登记 CSS 阈值 ${v}px @ ${file}（植入必红）`);
    }
  }
  for (const { file, px } of jsBare) {
    problems.push(`JS 裸阈值 ${px}px @ ${file}：必须引用 @/lib/uiBreakpoints 常量`);
  }
  if (registered.includes(767)) problems.push('767px 残留：JS/CSS 应对齐到 768（U-04 只做对齐不改档位数）');
  if (!registered.includes(mobileAligned)) problems.push(`对齐阈值 ${mobileAligned} 不在登记表`);
  if (!registered.includes(compactAligned)) problems.push(`对齐阈值 ${compactAligned} 不在登记表`);
  const mobile = /MOBILE_BREAKPOINT_PX\s*=\s*(\d+)/.exec(tsSource);
  const compact = /COMPACT_BREAKPOINT_PX\s*=\s*(\d+)/.exec(tsSource);
  if (!mobile || Number(mobile[1]) !== mobileAligned) problems.push('uiBreakpoints.ts MOBILE_BREAKPOINT_PX 与对齐值不一致');
  if (!compact || Number(compact[1]) !== compactAligned) problems.push('uiBreakpoints.ts COMPACT_BREAKPOINT_PX 与对齐值不一致');
  return problems;
}

export function checkFiles() {
  const { byFile, jsBare } = readAllThresholds();
  const tsSource = fs.readFileSync(path.join(ROOT, BREAKPOINTS_TS), 'utf8');
  return {
    problems: verifyBreakpoints({ byFile, jsBare, tsSource }),
    stats: {
      cssFiles: byFile.size,
      nonWipThresholds: [...new Set([...byFile].filter(([f]) => f !== WIP_CSS).flatMap(([, v]) => v))].sort((a, b) => a - b),
      wipThresholds: byFile.get(WIP_CSS) ?? [],
      jsBare: jsBare.length,
    },
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { problems, stats } = checkFiles();
  if (problems.length > 0) {
    console.error(`[ui-breakpoints] FAIL — ${problems.length} 项：`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`[ui-breakpoints] PASS — ${stats.cssFiles} CSS 文件；非 WIP 阈值 ${stats.nonWipThresholds.length} 档全部在册（登记表 ${REGISTERED_THRESHOLDS.length} 档只减）；JS 裸阈值 ${stats.jsBare}；767→768 对齐；WIP 阈值 ${stats.wipThresholds.length} 档显式登记 owner（零触碰）`);
}
