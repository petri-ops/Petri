#!/usr/bin/env node
/**
 * UI-D2 (BLOCK-417) — 布局定义唯一性机械门（可视区布局类单源）。
 *
 * `$petri-css-theme` §5：一个可视区的布局只能有一个定义处。本门只对**可视区
 * 布局类**（LAYOUT_CLASSES）执行「定义处 = 1」判据，并守住两条边界：
 *  - 非 WIP 文件：植入同名布局类第二定义必红；
 *  - WIP 文件（他方在制）：既存同名定义显式登记 owner / 行数 / 补腿条件，
 *    零触碰、不代改、不 stage、不提交；出现**未登记的新**重复必红。
 *
 * 全仓「同类名容器规则 >3 处」是历史技术债（当次读数 804 组，见
 * acceptance/.../d2/layout-hotspots.json），不在 D2 一刀切判红或伪装收敛：
 * 由 `containerHotspots` 只减棘轮冻结总数，新增即红，下降合法。
 *
 * 用法：node scripts/ui-design-layout-gate.mjs [--check]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const WIP_CSS = 'frontend/src/pages/project-workspace.module.css';

/** 可视区布局类：报告 §2 IA-P1 与 K-16 点名的双层 layout 族。 */
export const LAYOUT_CLASSES = [
  'workspaceSessionFrame', 'workspaceSessionFrameChat', 'workspaceSessionLayout',
  'workspaceSessionInner', 'workspaceSessionInset', 'workspaceSessionSurface',
  'workspaceSessionContent',
];

/**
 * WIP 文件内既存同名定义登记表。
 *
 * BLOCK-421（用户 2026-11-11 授权接管该文件做布局重构）已把两处重复真实收敛：
 * `workspaceSessionLayout` 2→1（960 断点的 gap 改走 `--ws-layout-gap`）、
 * `workspaceSessionFrame` 3→1（960/700 两处 padding 改走 `--ws-frame-padding` /
 * `--ws-chat-frame-padding`）。清单归零＝棘轮只减，不是放宽：任何新的同名重复
 * 布局定义都会落进「WIP 文件出现未登记的新重复」分支判红（负测在册）。
 */
export const WIP_KNOWN_DUPLICATES = [];
export const WIP_OWNER_NOTE = '零触碰：不代改、不 stage、不提交；ui:audit:check 由本程序自身增量同步，不掩盖该 WIP';

/**
 * 全仓历史热点冻结值（2026-11-11 当次读数，只减棘轮）。
 * 口径 = 剥离 CSS 注释后的**单一类选择器**定义，容器级属性合计 >3 的类名组数。
 * 初版 804 是含组合选择器/注释的不同口径，已按同口径重算为 708（不缩分母、不放宽）。
 */
export const CONTAINER_HOTSPOT_BASELINE = 708;
const CONTAINER_PROPS = /^\s*(display|grid-template-\w+|flex(?:-\w+)?|position|width|height|min-width|min-height|max-width|max-height|inset|gap|padding(?:-\w+)?)\s*:/;

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.css$/.test(name)) out.push(full);
  }
  return out;
}

/** 解析 CSS 里的 `.className { ... }` 定义，返回 [{file, className, line, containerProps}]。 */
export function extractClassDefinitions(source, file = 'fixture.css') {
  // 剥离 CSS 块注释（注释里常有 `.className` 文字），只认**单一类选择器**的定义：
  // 组合选择器 `.a .b {}` 归 `.b` 的精修规则，不算 `.a` 的布局定义处。
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  const out = [];
  const re = /^\s*\.([A-Za-z0-9_-]+)\s*\{([^}]*)\}/gm;
  let m;
  while ((m = re.exec(clean)) !== null) {
    const line = clean.slice(0, m.index).split('\n').length;
    const containerProps = m[2].split(';').filter((d) => CONTAINER_PROPS.test(d.trim())).length;
    out.push({ file, className: m[1], line, containerProps });
  }
  return out;
}

export function readAllDefinitions() {
  const defs = [];
  for (const f of walk(path.join(ROOT, 'frontend/src'))) {
    const rel = path.relative(ROOT, f).split(path.sep).join('/');
    defs.push(...extractClassDefinitions(fs.readFileSync(f, 'utf8'), rel));
  }
  return defs;
}

export function countContainerHotspots(definitions) {
  const groups = new Map();
  for (const d of definitions) {
    const key = `${d.file}::${d.className}`;
    groups.set(key, (groups.get(key) || 0) + (d.containerProps || 0));
  }
  return [...groups].filter(([, n]) => n > 3).length;
}

/** 纯函数对账，供负测注入。 */
export function verifyLayoutDefinitions({
  definitions,
  wipFile = WIP_CSS,
  layoutClasses = LAYOUT_CLASSES,
  knownWipDuplicates = WIP_KNOWN_DUPLICATES,
  hotspotBaseline = CONTAINER_HOTSPOT_BASELINE,
  skipHotspotRatchet = false,
}) {
  const problems = [];
  const wanted = new Set(layoutClasses);
  const groups = new Map();
  for (const d of definitions) {
    if (!wanted.has(d.className)) continue;
    const key = `${d.file}::${d.className}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(d);
  }
  for (const [key, list] of groups) {
    const file = list[0].file;
    if (list.length > 1) {
      if (file === wipFile) {
        const known = knownWipDuplicates.find((k) => k.className === list[0].className);
        if (!known) problems.push(`WIP 文件出现未登记的新重复布局定义 ${key}（${list.length} 处）——需登记 owner 与补腿条件`);
        else if (known.definitions < list.length) problems.push(`WIP 已登记布局重复 ${key} 由 ${known.definitions} 增至 ${list.length} 处（只减棘轮）`);
      } else {
        problems.push(`布局非单源：${key} 定义 ${list.length} 处（> 1），按 $petri-css-theme §5 应抽独立 Layout 文件而非追加覆盖`);
      }
    }
  }
  for (const known of knownWipDuplicates) {
    if (!known.owner || !known.remediation) problems.push(`WIP 登记项 ${known.className} 缺 owner 或补腿条件`);
  }
  if (!skipHotspotRatchet) {
    const hotspots = countContainerHotspots(definitions);
    if (hotspots > hotspotBaseline) problems.push(`全仓容器规则 >3 处热点由 ${hotspotBaseline} 增至 ${hotspots}（只减棘轮：新增即红）`);
  }
  return problems;
}

export function checkFiles() {
  const definitions = readAllDefinitions();
  return {
    problems: verifyLayoutDefinitions({ definitions }),
    stats: { definitions: definitions.length, files: new Set(definitions.map((d) => d.file)).size, hotspots: countContainerHotspots(definitions) },
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { problems, stats } = checkFiles();
  if (problems.length > 0) {
    console.error(`[ui-layout] FAIL — ${problems.length} 项：`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`[ui-layout] PASS — ${stats.definitions} 个类名定义 / ${stats.files} CSS 文件；可视区布局类非 WIP 定义唯一；WIP 既存重复 ${WIP_KNOWN_DUPLICATES.length} 组显式登记 owner；全仓历史热点 ${stats.hotspots} ≤ 冻结 ${CONTAINER_HOTSPOT_BASELINE}（只减棘轮）`);
}
