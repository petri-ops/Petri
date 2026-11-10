#!/usr/bin/env node
/**
 * scripts/post-k7-source-scan-ratchet.mjs — L0-7（蓝图 L-43）：全库源码扫描断言第二棘轮。
 *
 * 背景：k4 源码扫描棘轮只冻结 4 个测试文件（SCAN_CONTRACT_FILES）；实测全库
 * test 目录（递归 *.test.mjs）中「源码变量 .includes(」式断言 ~129 处 / 44 文件（口径 A），
 * 其余 41+ 文件新增扫描断言不受约束。本棘轮把口径扩到全库测试文件：
 *   - 计数式：剥注释后统计 src/source 变量上的 .includes(（源码内容断言特征）；
 *   - 只增即红：任一测试文件该计数超过冻结基线 → 红（新增源码扫描断言须显式 --write
 *     并在 diff 留痕，行为断言优先于源码字面量断言）；
 *   - 只减不锁：文件清零/消失 = 改进（提示 --update 下调基线，不拦）。
 *
 * 用法：node scripts/post-k7-source-scan-ratchet.mjs [--write]
 * 退出码：--check 0 PASS / 1 新增即红。纯函数 countSourceVarIncludes /
 * adjudicateSourceScanRatchet 供负测契约直接喂数据。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = path.join(ROOT, 'test', 'source-scan-asserts-baseline.json');
const TEST_DIR = path.join(ROOT, 'test');

/** 剥注释后统计源码变量 .includes( 断言数（口径 A：变量名含 src/source）。 */
export function countSourceVarIncludes(text) {
  const stripped = String(text).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
  return (stripped.match(/\b[A-Za-z_$]*(?:[Ss]rc|[Ss]ource)[A-Za-z_$]*\.includes\(/g) || []).length;
}

/** 纯函数裁决：current(rel→count) vs baseline(rel→count)。新增即红；清零=改进。 */
export function adjudicateSourceScanRatchet(current, baseline) {
  const issues = [];
  const improvements = [];
  const base = baseline?.files || {};
  for (const [rel, count] of current) {
    const frozen = Number(base[rel]);
    if (!Number.isFinite(frozen)) {
      // 0 命中文件不入基线也不拦——只拦「带源码扫描断言的新文件」（count > 0）。
      if (count > 0) issues.push(`${rel}: ${count} 处源码扫描断言不在冻结基线（新增扫描文件即红——--write 留痕或换行为断言）`);
      continue;
    }
    if (count > frozen) issues.push(`${rel}: ${count} > 冻结 ${frozen}（新增源码扫描断言即红——L-43 第二棘轮）`);
    else if (count < frozen) improvements.push(`${rel}: ${frozen} → ${count}（--write 可下调基线）`);
  }
  for (const rel of Object.keys(base)) {
    if (!current.has(rel)) improvements.push(`${rel}: 文件已消失（--write 可下调基线）`);
  }
  return { ok: issues.length === 0, issues, improvements };
}

function collectCurrent() {
  const current = new Map();
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) { walk(path.join(dir, e.name)); continue; }
      if (!/\.test\.(mjs|cjs|js)$/.test(e.name)) continue;
      const rel = path.relative(ROOT, path.join(dir, e.name)).replaceAll('\\', '/');
      current.set(rel, countSourceVarIncludes(fs.readFileSync(path.join(dir, e.name), 'utf8')));
    }
  };
  walk(TEST_DIR);
  return current;
}

function main() {
  const current = collectCurrent();
  const total = [...current.values()].reduce((a, b) => a + b, 0);
  if (process.argv.includes('--write')) {
    const files = Object.fromEntries([...current].sort(([a], [b]) => a.localeCompare(b)).filter(([, c]) => c > 0));
    const fresh = {
      _about: 'L0-7（L-43）全库源码扫描断言第二棘轮基线；只减不增——新增 src/source 变量 .includes( 断言即红，行为断言优先',
      schemaVersion: 1,
      total: Object.values(files).reduce((a, b) => a + b, 0),
      files,
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(BASELINE, JSON.stringify(fresh, null, 2) + '\n');
    console.log(`[source-scan-ratchet] 基线写入 ${path.relative(ROOT, BASELINE)}（${Object.keys(files).length} 文件 / ${fresh.total} 处）`);
    return;
  }
  let baseline = null;
  try { baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8')); } catch { /* fail-closed below */ }
  if (!baseline) {
    console.error(`[source-scan-ratchet] FAIL 基线缺席 ${path.relative(ROOT, BASELINE)}——先 --write 首打`);
    process.exitCode = 1;
    return;
  }
  const { ok, issues, improvements } = adjudicateSourceScanRatchet(current, baseline);
  console.log(`[source-scan-ratchet] 当次 ${[...current.values()].filter(Boolean).length} 文件 / ${total} 处（基线 ${baseline.total} 处）`);
  for (const i of improvements) console.log(`  ↓ ${i}`);
  if (!ok) {
    console.error('[source-scan-ratchet] FAIL（新增源码扫描断言即红）：');
    for (const i of issues) console.error(`  ✖ ${i}`);
    process.exitCode = 1;
  } else {
    console.log('[source-scan-ratchet] PASS（全库源码扫描断言未新增）');
  }
}

if (isDirectInvocation()) main();

function isDirectInvocation() {
  try {
    return import.meta.url === pathToFileURL(process.argv[1] || '').href;
  } catch {
    return false;
  }
}
