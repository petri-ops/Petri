#!/usr/bin/env node
/**
 * scripts/silent-catch-ratchet.mjs — 生产路径「静默 catch」只减不增棘轮（POST-S7 H2/B-08）。
 *
 * 为什么不是「一刀禁空 catch」：仓内 400+ 处 `catch {}` 绝大多数是**清理/日志/尽力而为**
 * 的正当形态（`child.kill()` 的第二次尝试、`fs.closeSync` 收尾、`console.warn` 自身失败），
 * 一刀禁会立刻全红，等于把门禁变成噪声。真正要防的是**新增**：又一处「失败被吞掉、调用方
 * 与用户都不知道」。
 *
 * 因此本门只做两件事：
 *   1. 存量按文件冻结（基线 = 当前计数），**任何增长即红**；
 *   2. 新增文件不得引入静默 catch（0 容忍）。
 * 每修一处 `--write` 下调基线（只减不增）。
 *
 * 口径：裸 `catch {}` / `catch { }`（无语句、无注释）。带注释的 `catch { /* … *\/ }` 视为
 * 「已留痕」不计入债务——注释是给人看的，不是给工具看的，但它确实区分了「有意忽略」与
 * 「忘了处理」。
 *
 * 用法：
 *   node scripts/silent-catch-ratchet.mjs --check
 *   node scripts/silent-catch-ratchet.mjs --write
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = path.join(ROOT, 'test', 'silent-catch-baseline.json');
const SCAN_ROOTS = ['core', 'src', 'frontend/src']; // L3-4（L-18/BLOCK-407）：纳入 frontend/src（独立留因+负测见 test/block407-l3-error-semantics.test.mjs）
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git']);
const BARE_CATCH_RE = /catch\s*\{\s*\}/g;

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

export function countBareCatches(text) {
  const matches = String(text).match(BARE_CATCH_RE);
  return matches ? matches.length : 0;
}

export function scan() {
  const counts = {};
  for (const root of SCAN_ROOTS) {
    for (const file of walk(path.join(ROOT, root))) {
      const rel = path.relative(ROOT, file).split(path.sep).join('/');
      const text = fs.readFileSync(file, 'utf8');
      const count = countBareCatches(text);
      if (count) counts[rel] = count;
    }
  }
  return counts;
}

function total(counts) {
  return Object.values(counts).reduce((sum, n) => sum + n, 0);
}

function main() {
  const args = new Set(process.argv.slice(2));
  const counts = scan();
  const sum = total(counts);

  if (args.has('--write')) {
    const baseline = {
      _about: '生产路径静默 catch（裸 catch {}，无语句无注释）按文件冻结的存量棘轮；新增即红，修复后 --write 下调（只减不增）。L3-18/BLOCK-407 扩面留因：SCAN_ROOTS 纳入 frontend/src（扩面负测见 test/block407-l3-error-semantics.test.mjs；k6 门要求扩面必须伴随本留因）。',
      schemaVersion: 1,
      updatedAt: new Date().toISOString().slice(0, 10),
      total: sum,
      files: counts,
    };
    fs.writeFileSync(BASELINE, `${JSON.stringify(baseline, null, 2)}\n`);
    console.log(`[silent-catch] 基线已写入：${Object.keys(counts).length} 文件 / ${sum} 处`);
    return;
  }

  let baseline;
  try {
    baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  } catch {
    console.error('[silent-catch] FAIL 基线缺失——先跑 --write 生成（并在提交里留因）');
    process.exit(1);
  }

  const violations = [];
  for (const [file, count] of Object.entries(counts)) {
    const allowed = baseline.files[file] || 0;
    if (count > allowed) violations.push(`${file}: ${count} 处 > 基线 ${allowed}（新增静默 catch）`);
  }
  if (violations.length) {
    console.error('[silent-catch] FAIL 门禁违规（只减不增）：');
    for (const v of violations) console.error(`  - ${v}`);
    console.error('  处置三分法：真缺陷修（失败要可见）/ 化石删（代码路径已不存在）/ 误报豁免（写注释说明为何可忽略，注释即离开债务口径）');
    process.exit(1);
  }
  const shrinkCandidates = Object.entries(baseline.files)
    .filter(([file, allowed]) => (counts[file] || 0) < allowed)
    .map(([file, allowed]) => `${file} ${allowed}→${counts[file] || 0}`);
  console.log(`[silent-catch] PASS（${Object.keys(counts).length} 文件 / ${sum} 处；基线 ${baseline.total}）`);
  if (shrinkCandidates.length) {
    console.log(`[silent-catch] 可下调基线 ${shrinkCandidates.length} 处（--write 收敛）：${shrinkCandidates.slice(0, 5).join(', ')}${shrinkCandidates.length > 5 ? ' …' : ''}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main();
}
