#!/usr/bin/env node
/**
 * UI-D1 (BLOCK-416) — 入口↔路由双向对账静态门。
 *
 * 方向 A（表 → 路由）：表内 page/redirect/internal 路径必须在 App.tsx 有 <Route path>。
 * 方向 B（路由 → 表）：App.tsx 每条 <Route path> 必须在表内登记。
 * 方向 C（源码 → 表）：导航源码里的路径字面量必须命中已登记集合（植入未登记入口必红）。
 * 方向 D（页头）：shared.tsx 的 isStandalonePagePath 清单必须等于表内 standalone 集合。
 * 另查：canonical 路径唯一、点击数上限、alias 必须指向存在的 canonical。
 *
 * 用法：node scripts/ui-design-entry-gate.mjs [--check]
 * 纯函数 verifyEntries / extract* 供 test/ui-design-entries.test.mjs 做 5 类植入必红负测。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CANONICAL_ENTRIES, ALIASES, SURFACE_ALIASES, STANDALONE_PATHS,
  ENTRY_LITERALS, ENTRY_SOURCE_FILES, MAX_TASK_CLICKS,
} from './ui-design-entry-registry.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const APP_PATH = path.join(ROOT, 'frontend/src/App.tsx');
export const SHARED_PATH = path.join(ROOT, 'frontend/src/components/desktop/titlebar/shared.tsx');

/**
 * 去注释的状态机（避免把 `/project/:projectId/*` 里的 `/*` 误判为块注释起始，
 * 也避免把字符串里的 `//` 误判为行注释）。只删除注释字符，保留其余字符与换行。
 */
export function stripComments(source) {
  let out = '';
  let state = 'code';
  let quote = '';
  for (let i = 0; i < source.length; i += 1) {
    const c = source.charAt(i);
    const n = source.charAt(i + 1);
    if (state === 'code') {
      if (c === '/' && n === '/') { state = 'line'; i += 1; out += '  '; continue; }
      if (c === '/' && n === '*') { state = 'block'; i += 1; out += '  '; continue; }
      if (c === "'" || c === '"' || c === '`') { state = 'string'; quote = c; out += c; continue; }
      out += c; continue;
    }
    if (state === 'string') {
      out += c;
      if (c === '\\' && n !== undefined) { i += 1; out += n; continue; }
      if (c === quote) { state = 'code'; quote = ''; }
      continue;
    }
    if (state === 'line') {
      if (c === '\n') { state = 'code'; out += c; }
      else out += ' ';
      continue;
    }
    // block
    if (c === '*' && n === '/') { state = 'code'; i += 1; out += '  '; continue; }
    out += c === '\n' ? '\n' : ' ';
  }
  return out;
}

/** App.tsx 中所有 <Route path="...">。 */
export function extractRoutePaths(source) {
  const out = [];
  const re = /<Route\s+path=["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(stripComments(source))) !== null) out.push(m[1]);
  return out;
}

/**
 * 导航源码里的路径字面量：navigate('...') / go(...,'/...') / <Navigate to="...">
 * / 模板字符串静态前缀（`...${...}` 取 \` 与 ${ 之间的部分）。
 */
export function extractEntryLiterals(source) {
  const text = stripComments(source);
  const out = new Set();
  const push = (v) => { if (typeof v === 'string' && v.startsWith('/')) out.add(v); };
  let m;
  const patterns = [
    /navigate\(\s*['"]([^'"`]+)['"]/g,
    /<Navigate\s+to=["']([^"']+)["']/g,
    /go\(\s*(?:'[^']*'\s*,\s*){4}['"]([^'"]+)['"]/g,
    /path=["']([^"']+)["']/g,
    /navigate\(\s*`([^`$]*)\$\{/g,
    /navigate\(\s*`([^`]*)`/g,
  ];
  for (const re of patterns) {
    while ((m = re.exec(text)) !== null) push(m[1]);
  }
  return [...out];
}

/** shared.tsx 的 isStandalonePagePath 正则里的路径集合。 */
export function extractStandalonePaths(source) {
  const text = stripComments(source);
  const m = text.match(/export function isStandalonePagePath[\s\S]*?return\s+([\s\S]*?);/);
  if (!m) return null;
  const body = m[1];
  const paths = new Set();
  if (/pathname\s*===\s*['"]\/['"]/.test(body)) paths.add('/');
  const group = body.match(/\/\^\\\/\(([^)]*)\)/);
  if (group) for (const p of group[1].split('|')) paths.add(`/${p}`);
  return [...paths].sort();
}

function isKnownLiteral(literal, known) {
  if (known.has(literal)) return true;
  // 模板字符串静态前缀 / settings 分区深链 / 货架深链
  for (const k of known) {
    if (k.endsWith('?section=') && literal.startsWith(k)) return true;
    if (k.endsWith('?tab=') && literal.startsWith(k)) return true;
    if (k.endsWith('/') && k.length > 1 && literal.startsWith(k)) return true;
  }
  return false;
}

/**
 * 纯函数对账。所有输入可注入，便于负测。返回 problems 数组（空 = PASS）。
 */
export function verifyEntries({
  routePaths,
  sourceLiterals,
  standalonePaths,
  canonicalEntries = CANONICAL_ENTRIES,
  aliases = ALIASES,
  surfaceAliases = SURFACE_ALIASES,
  entryLiterals = ENTRY_LITERALS,
  standaloneExpected = STANDALONE_PATHS,
  maxClicks = MAX_TASK_CLICKS,
}) {
  const problems = [];
  const known = new Set([
    ...entryLiterals,
    ...canonicalEntries.map((e) => e.path),
    ...aliases.map((a) => a.path),
  ]);
  const canonicalPaths = new Set(canonicalEntries.filter((e) => e.kind !== 'fallback').map((e) => e.path));

  // 唯一性：每功能 1 canonical（id 与 path 都不许重复）
  const seenIds = new Set();
  const seenPaths = new Set();
  for (const e of canonicalEntries) {
    if (seenIds.has(e.id)) problems.push(`duplicate canonical id: ${e.id}`);
    seenIds.add(e.id);
    if (e.kind !== 'fallback') {
      if (seenPaths.has(e.path)) problems.push(`duplicate canonical path: ${e.path}（重复入口）`);
      seenPaths.add(e.path);
    }
    if (typeof e.clicks === 'number' && e.clicks > maxClicks) {
      problems.push(`${e.id} clicks=${e.clicks} > ${maxClicks}`);
    }
  }

  // 方向 A：表 → 路由
  const routeSet = new Set(routePaths);
  for (const e of canonicalEntries) {
    if (!routeSet.has(e.path)) problems.push(`表→路由缺失: ${e.id} (${e.path}) 无 <Route path>`);
  }
  // 方向 B：路由 → 表（重定向别名 / 兜底 * 均属已登记）
  const registeredRoutePaths = new Set([...canonicalPaths, ...aliases.map((a) => a.path)]);
  for (const r of routePaths) {
    if (!registeredRoutePaths.has(r) && r !== '*') {
      problems.push(`路由→表缺失: <Route path="${r}"> 未登记（植入未登记路由必红）`);
    }
  }
  // 方向 C：源码 → 表
  for (const lit of sourceLiterals) {
    if (!isKnownLiteral(lit, known)) {
      problems.push(`源码→表缺失: 未登记入口字面量 "${lit}"（植入未登记入口必红）`);
    }
  }
  // 表内 standalone 字段 ↔ 唯一真源 STANDALONE_PATHS（防第二真相）
  const declaredStandalone = canonicalEntries.filter((e) => e.standalone).map((e) => e.path).sort();
  if (JSON.stringify(declaredStandalone) !== JSON.stringify([...standaloneExpected].sort())) {
    problems.push(`表内 standalone 字段与 STANDALONE_PATHS 不一致: ${JSON.stringify(declaredStandalone)}`);
  }
  // 方向 D：页头清单
  if (standalonePaths === null) {
    problems.push('页头清单: shared.tsx 未找到 isStandalonePagePath');
  } else {
    const expected = [...standaloneExpected].sort();
    const actual = [...standalonePaths].sort();
    if (JSON.stringify(expected) !== JSON.stringify(actual)) {
      problems.push(`页头清单漂移: expected ${JSON.stringify(expected)} vs actual ${JSON.stringify(actual)}`);
    }
  }
  // alias / surfaceAlias 指向必须存在
  for (const a of aliases) {
    if (!canonicalPaths.has(a.canonical)) problems.push(`alias ${a.path} 指向不存在的 canonical ${a.canonical}`);
    if (!a.reason) problems.push(`alias ${a.path} 缺少留因`);
  }
  for (const s of surfaceAliases) {
    if (!canonicalPaths.has(s.canonical)) problems.push(`surfaceAlias ${s.id} 指向不存在的 canonical ${s.canonical}`);
  }
  return problems;
}

export function checkFiles() {
  const routePaths = extractRoutePaths(fs.readFileSync(APP_PATH, 'utf8'));
  const sourceLiterals = [...new Set(ENTRY_SOURCE_FILES.flatMap((rel) =>
    extractEntryLiterals(fs.readFileSync(path.join(ROOT, rel), 'utf8'))))];
  const standalonePaths = extractStandalonePaths(fs.readFileSync(SHARED_PATH, 'utf8'));
  return {
    problems: verifyEntries({ routePaths, sourceLiterals, standalonePaths }),
    stats: { routes: routePaths.length, literals: sourceLiterals.length, standalone: standalonePaths?.length ?? 0 },
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { problems, stats } = checkFiles();
  if (problems.length > 0) {
    console.error(`[ui-entries] FAIL — ${problems.length} 项对账不一致：`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`[ui-entries] PASS — 双向对账：${stats.routes} 路由 / ${stats.literals} 入口字面量 / ${stats.standalone} 独立页；canonical 唯一、无孤儿页`);
}
