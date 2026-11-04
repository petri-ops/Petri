#!/usr/bin/env node
/**
 * scripts/block351-build-manifest.mjs — BLOCK-351 资产化 manifest 生成器（机械扫描，防手写虚标）。
 *
 * 扫描 test/**\/*.test.mjs 源码中的 acceptance/ 路径字面量（精确路径与目录前缀两种），
 * 结合 test/impact-map.json 规则匹配，生成 acceptance/block-351/assetized-manifest.json：
 *   { frozenAt, totals, entries: [{ file, assertedBy[], impactRule[] }] }
 * 口径（冻结于 docs/block-351-ear-definition.md）：
 *   assetized(file) = ∃ test 源码字面引用（路径或其目录前缀） ∧ ∃ impact-map 规则匹配
 *   分母 = acceptance/ 全部文件（排除 README* 与 .DS_Store 等杂物）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'acceptance', 'block-351', 'assetized-manifest.json');
const args = process.argv.slice(2);
const OUT_ARG = (args.find((a) => a.startsWith('--out=')) || '').split('=')[1] || '';

const walkFiles = (dir) => {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walkFiles(full));
    else out.push(full);
  }
  return out;
};

// 1) 收集 test 源码的 acceptance 引用（精确 + 目录前缀）
const testRefs = []; // { test, exact:Set, prefix:Set }
for (const f of walkFiles(path.join(ROOT, 'test'))) {
  if (!/\.test\.mjs$/.test(f)) continue;
  const src = fs.readFileSync(f, 'utf8');
  const exact = new Set();
  const prefix = new Set();
  for (const m of src.matchAll(/acceptance\/[A-Za-z0-9_\-./]+\.[A-Za-z0-9]+/g)) {
    exact.add(m[0].replace(/\/$/, ''));
  }
  for (const m of src.matchAll(/acceptance\/[A-Za-z0-9_\-]+/g)) {
    prefix.add(m[0]);
  }
  if (exact.size || prefix.size) testRefs.push({ test: path.relative(ROOT, f), exact, prefix });
}

// 2) impact-map 规则
const impact = JSON.parse(fs.readFileSync(path.join(ROOT, 'test', 'impact-map.json'), 'utf8'));
const ruleFor = (rel) => (impact.rules || [])
  .filter((r) => (r.patterns || []).some((pat) => {
    const p = String(pat).replace(/\*\*/g, '§').replace(/\*/g, '§');
    const re = new RegExp(`^${p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/§/g, '.*')}`);
    return re.test(rel);
  }))
  .map((r) => r.id);

// 3) acceptance 全量文件（分母）
const all = walkFiles(path.join(ROOT, 'acceptance'))
  .map((f) => path.relative(ROOT, f).replaceAll('\\', '/'))
  .filter((rel) => !/(^|\/)(README[^/]*|\.DS_Store)$/i.test(rel));

// 4) 逐文件判定
const entries = [];
for (const rel of all.sort()) {
  const assertedBy = [];
  let hit = false;
  for (const ref of testRefs) {
    if (ref.exact.has(rel) || [...ref.prefix].some((p) => rel.startsWith(`${p}/`))) {
      hit = true;
      assertedBy.push(ref.test);
    }
  }
  if (!hit) continue;
  const impactRule = ruleFor(rel);
  entries.push({ file: rel, assertedBy, impactRule });
}

const manifest = {
  frozenAt: new Date().toISOString(),
  definition: 'docs/block-351-ear-definition.md',
  totals: { acceptanceFiles: all.length, assetized: entries.length, earPct: Number(((entries.length / all.length) * 100).toFixed(1)) },
  entries,
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT_ARG || OUT, JSON.stringify(manifest, null, 2) + '\n');
console.log(`[block351] manifest：${entries.length}/${all.length} = ${manifest.totals.earPct}% → ${path.relative(ROOT, OUT_ARG || OUT)}`);
