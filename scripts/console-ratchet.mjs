#!/usr/bin/env node
/**
 * scripts/console-ratchet.mjs — A2 console 债务「只减不增」棘轮（harness 隐形体验优化队列 7 第一波）。
 *
 * 为什么需要：core/ 自有代码 console 调用在放大（319:59 → 196:138 的本波真值），
 * 但一刀禁 console 不现实（子进程源码字符串、注释、默认值、error-log 桥接都需要保留）。
 * 本门沿用 scripts/silent-catch-ratchet.mjs 的既有棘轮机制：按文件冻结存量计数，
 * 任何增长或新文件即红；确属治理收敛后用 --write 下调基线（只减不增）。
 *
 * 口径：生产代码里的 `console.<method>(...)` 调用字面量（含子进程源码字符串里的同形文本，
 * 因为那也是一处 console 写法，留基线统一计数）。扫描 core/ + src/ 自有代码，
 * 排除 node_modules / dist / build / .git / frontend（前端不属本波口径）。
 *
 * 用法：
 *   node scripts/console-ratchet.mjs --check
 *   node scripts/console-ratchet.mjs --write
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = path.join(ROOT, 'test', 'console-baseline.json');
const SCAN_ROOTS = ['core', 'src'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git']);
const CONSOLE_RE = /console\.(?:log|error|warn|info|debug|trace|dir|table|time|timeEnd|timeLog|assert|group|groupCollapsed|groupEnd|count|countReset|clear|profile|profileEnd)/g;

function walk(dir, out = []) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(full, out); continue; }
    if (!/\.(js|mjs|cjs|ts|tsx)$/.test(entry.name)) continue;
    out.push(full);
  }
  return out;
}

export function countConsole(text) {
  return (String(text).match(CONSOLE_RE) || []).length;
}

export function scan() {
  const counts = {};
  for (const root of SCAN_ROOTS) {
    for (const file of walk(path.join(ROOT, root))) {
      const rel = path.relative(ROOT, file).split(path.sep).join('/');
      const n = countConsole(fs.readFileSync(file, 'utf8'));
      if (n) counts[rel] = n;
    }
  }
  return counts;
}

export function checkCounts(counts, baseline) {
  const violations = [];
  for (const [file, count] of Object.entries(counts)) {
    const allowed = (baseline.files && baseline.files[file]) || 0;
    if (count > allowed) violations.push(`${file}: ${count} 处 > 基线 ${allowed}（新增 console）`);
  }
  return violations;
}

export function shrinkCandidates(counts, baseline) {
  return Object.entries(baseline.files || {})
    .filter(([file, allowed]) => (counts[file] || 0) < allowed)
    .map(([file, allowed]) => `${file} ${allowed}→${counts[file] || 0}`);
}

function main() {
  const args = new Set(process.argv.slice(2));
  const counts = scan();
  const sum = Object.values(counts).reduce((a, b) => a + b, 0);

  if (args.has('--write')) {
    const baseline = {
      _about: 'A2 console 债务按文件冻结的存量棘轮（只减不增）：新增 console 即红，治理收敛后 --write 下调基线。口径=core/+src/ 自有代码 console.<method> 调用字面量（含子进程源码字符串），排除 node_modules/dist/build/.git/frontend。',
      schemaVersion: 1,
      updatedAt: new Date().toISOString().slice(0, 10),
      total: sum,
      files: counts,
    };
    fs.writeFileSync(BASELINE, `${JSON.stringify(baseline, null, 2)}\n`);
    console.log(`[console-ratchet] 基线已写入：${Object.keys(counts).length} 文件 / ${sum} 处`);
    return;
  }

  let baseline;
  try {
    baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  } catch {
    console.error('[console-ratchet] FAIL 基线缺失——先跑 --write 生成（并在提交里留因）');
    process.exit(1);
  }
  const violations = checkCounts(counts, baseline);
  if (violations.length) {
    console.error('[console-ratchet] FAIL 门禁违规（只减不增）：');
    for (const v of violations) console.error(`  - ${v}`);
    process.exit(1);
  }
  const shrinks = shrinkCandidates(counts, baseline);
  console.log(`[console-ratchet] PASS（${Object.keys(counts).length} 文件 / ${sum} 处；基线 ${baseline.total}）`);
  if (shrinks.length) {
    console.log(`[console-ratchet] 可下调基线 ${shrinks.length} 处（--write 收敛）：${shrinks.slice(0, 5).join(', ')}${shrinks.length > 5 ? ' …' : ''}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main();
}
