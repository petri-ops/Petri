#!/usr/bin/env node
/**
 * scripts/post-s7-dependency-parity-gate.mjs — 三套依赖树机械对账（BLOCK-394 B-24）。
 *
 * 事实：根 / core/petri-server / frontend 三份 package.json 各自维护依赖，
 * 同名包版本漂移无人报警（BLOCK-105 的 knip 明确说 dependencies 不纳棘轮）。
 * 本门**不新增依赖、不升级版本、不改任何 package.json**，只做逐值 diff：
 *   ① 同名运行时依赖在三树间版本不一致 → 红（漂移）；
 *   ② 根与 core 的 better-sqlite3 必须是同一版本（native ABI 只对它一个）；
 *   ③ 三树文件必须都存在且可解析（缺树即红，防静默漏测）。
 *
 * 判据是纯函数 evaluateDependencyParity，可离线负测（植入漂移必红）。
 * 用法：node scripts/post-s7-dependency-parity-gate.mjs [--json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const PACKAGE_TREES = [
  { label: 'root', file: 'package.json' },
  { label: 'core', file: 'core/petri-server/package.json' },
  { label: 'frontend', file: 'frontend/package.json' },
];

/** 只比运行时依赖；devDependencies 允许各树独立（构建工具版本不跨树）。 */
export function collectDeps(readFile = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'))) {
  const trees = {};
  const issues = [];
  for (const t of PACKAGE_TREES) {
    let pkg;
    try { pkg = readFile(t.file); } catch (e) { issues.push(`${t.label}: unreadable (${e.message})`); continue; }
    if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) { issues.push(`${t.label}: invalid package.json`); continue; }
    trees[t.label] = pkg.dependencies || {};
  }
  return { trees, issues };
}

export function evaluateDependencyParity(readFile) {
  const { trees, issues } = collectDeps(readFile);
  if (Object.keys(trees).length !== PACKAGE_TREES.length) {
    return { ok: false, issues, sharedPackages: [], drift: [] };
  }
  const labels = Object.keys(trees);
  const allNames = new Set(labels.flatMap((l) => Object.keys(trees[l])));
  const sharedPackages = [];
  const drift = [];
  for (const name of [...allNames].sort()) {
    const present = labels.filter((l) => Object.prototype.hasOwnProperty.call(trees[l], name));
    if (present.length < 2) continue;
    sharedPackages.push({ name, trees: present });
    const versions = [...new Set(present.map((l) => trees[l][name]))];
    if (versions.length > 1) {
      drift.push({ name, byTree: Object.fromEntries(present.map((l) => [l, trees[l][name]])), versions });
      issues.push(`${name}: 版本漂移 ${present.map((l) => `${l}=${trees[l][name]}`).join(' / ')}`);
    }
  }
  // native ABI 单点：better-sqlite3 在根/core 同时声明时必须同版。
  const bs = ['root', 'core'].filter((l) => trees[l]['better-sqlite3']);
  if (bs.length === 2 && trees.root['better-sqlite3'] !== trees.core['better-sqlite3']) {
    issues.push('better-sqlite3: 根与 core 版本不一致（native ABI 风险）');
  } else if (bs.length < 2) {
    // 只有一树声明不算漂移：如实记录，不判红（零新增依赖纪律）。
    sharedPackages.push({ name: 'better-sqlite3', trees: bs, note: 'single-tree declaration' });
  }
  return { ok: issues.length === 0, issues, sharedPackages, drift };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const r = evaluateDependencyParity();
  if (process.argv.includes('--json')) console.log(JSON.stringify(r, null, 2));
  else if (r.ok) console.log(`[dependency-parity] PASS — 三树齐，${r.sharedPackages.length} 个共享包零漂移`);
  else {
    console.error('[dependency-parity] FAIL：');
    for (const i of r.issues) console.error(`  - ${i}`);
  }
  process.exitCode = r.ok ? 0 : 1;
}
