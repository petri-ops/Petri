#!/usr/bin/env node
/**
 * scripts/block351-ear.mjs — EAR 复算与 quality:ear 门（BLOCK-351）。
 *
 * 复算：按冻结口径（docs/block351-ear-definition.md）现场重算 assetized 集合，
 * 输出 EAR、分子分母明细、未资产化 Top 列表；与 manifest（棘轮台账）对比漂移。
 *
 * 门模式（--gate）：manifest 完整性棘轮——
 *   ① manifest 每条 entry 仍满足「test 引用 ∧ impact-map 匹配」（删引用→漂移→红）
 *   ② EAR ≥ manifest.totals.earPct 记录的达标值不下降（棘轮只进不退）
 * 纯函数 validateManifest(manifest, current) 供负测契约直接喂数据。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = path.join(ROOT, 'acceptance', 'block-351', 'assetized-manifest.json');
const EAR_THRESHOLD = 40; // 冻结达标线（计划 §4），棘轮只进不退

/** 纯函数：manifest 完整性校验（负测直接喂数据）。 */
export function validateManifest(manifest, current) {
  const issues = [];
  for (const entry of manifest.entries || []) {
    const now = current.entries.find((e) => e.file === entry.file);
    if (!now) {
      issues.push(`entry 漂移（不再是 assetized）：${entry.file}`);
      continue;
    }
    for (const t of entry.assertedBy) {
      if (!now.assertedBy.includes(t)) issues.push(`test 引用丢失：${entry.file} ← ${t}`);
    }
    for (const r of entry.impactRule) {
      if (!now.impactRule.includes(r)) issues.push(`impact-map 引用丢失：${entry.file} ← ${r}`);
    }
  }
  const earNow = Number(((current.entries.length / Math.max(1, current.totalFiles)) * 100).toFixed(1));
  if (earNow < EAR_THRESHOLD) issues.push(`EAR ${earNow}% < ${EAR_THRESHOLD}%（棘轮下限）`);
  // L0-3（蓝图 L-29）：真棘轮——EAR 低于 manifest 记录值即红（此前记录值只打印不参与判定）。
  // 再生 manifest（build-manifest）会重置记录值，故受 frozenAt 与 K-26 静态矩阵双锚约束。
  const recorded = Number(manifest?.totals?.earPct);
  if (Number.isFinite(recorded) && earNow < recorded) {
    issues.push(`EAR ${earNow}% < manifest 记录 ${recorded}%（棘轮只进不退，分子真实增长才提升）`);
  }
  return { issues, earNow, ok: issues.length === 0 };
}

async function main() {
  const gate = process.argv.includes('--gate');
  // 现场复算（与 build-manifest 同一扫描逻辑的只读版）
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
  const testRefs = [];
  for (const f of walkFiles(path.join(ROOT, 'test'))) {
    if (!/\.test\.mjs$/.test(f)) continue;
    const src = fs.readFileSync(f, 'utf8');
    const exact = new Set([...src.matchAll(/acceptance\/[A-Za-z0-9_./-]+\.[A-Za-z0-9]+/g)].map((m) => m[0]));
    const prefix = new Set([...src.matchAll(/acceptance\/[A-Za-z0-9_-]+/g)].map((m) => m[0]));
    if (exact.size || prefix.size) testRefs.push({ test: path.relative(ROOT, f), exact, prefix });
  }
  const impact = JSON.parse(fs.readFileSync(path.join(ROOT, 'test', 'impact-map.json'), 'utf8'));
  const ruleFor = (rel) => (impact.rules || [])
    .filter((r) => (r.patterns || []).some((pat) => {
      const p2 = String(pat).replace(/\*\*/g, '§').replace(/\*/g, '§');
      const re = new RegExp(`^${p2.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/§/g, '.*')}`);
      return re.test(rel);
    }))
    .map((r) => r.id);
  const all = walkFiles(path.join(ROOT, 'acceptance'))
    .map((f) => path.relative(ROOT, f).replaceAll('\\', '/'))
    .filter((rel) => !/(^|\/)(README[^/]*|\.DS_Store)$/i.test(rel));
  const entries = [];
  for (const rel of all.sort()) {
    const assertedBy = testRefs.filter((ref) => ref.exact.has(rel) || [...ref.prefix].some((p2) => rel.startsWith(`${p2}/`))).map((ref) => ref.test);
    if (!assertedBy.length) continue;
    const impactRule = ruleFor(rel);
    entries.push({ file: rel, assertedBy, impactRule });
  }
  const current = { entries, totalFiles: all.length };
  const earPct = Number(((entries.length / all.length) * 100).toFixed(1));
  const unmatched = all.filter((rel) => !entries.find((e) => e.file === rel));
  console.log(`[block351] EAR = ${entries.length}/${all.length} = ${earPct}%（阈值 ${EAR_THRESHOLD}%）`);
  if (!gate) {
    fs.mkdirSync(path.join(ROOT, 'acceptance', 'block-351'), { recursive: true });
    fs.writeFileSync(path.join(ROOT, 'acceptance', 'block-351', 'ear-snapshot.json'), JSON.stringify({ at: new Date().toISOString(), earPct, assetized: entries.length, total: all.length, unmatchedTop: unmatched.slice(0, 60) }, null, 2) + '\n');
    console.log(`[block351] 明细落盘 acceptance/block-351/ear-snapshot.json（未资产化 Top ${Math.min(60, unmatched.length)} 条）`);
    process.exit(0);
  }
  // --gate：manifest 棘轮
  if (!fs.existsSync(MANIFEST)) {
    console.error('[quality:ear] manifest 缺失——先跑 scripts/block351-build-manifest.mjs');
    process.exit(2);
  }
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const { issues, earNow, ok } = validateManifest(manifest, current);
  for (const issue of issues.slice(0, 20)) console.error(`[quality:ear] ✖ ${issue}`);
  console.log(`[quality:ear] EAR 现在=${earNow}%（分子 ${current.entries.length} / 分母 ${current.totalFiles}）/ manifest 记录=${manifest.totals.earPct}% → ${ok ? 'PASS' : 'FAIL'}`);
  process.exitCode = ok ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
