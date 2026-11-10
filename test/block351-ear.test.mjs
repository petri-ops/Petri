import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateManifest } from '../scripts/block351-ear.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = path.join(ROOT, 'acceptance', 'block-351', 'assetized-manifest.json');
const DEFINITION = path.join(ROOT, 'docs', 'block351-ear-definition.md');

const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));

const baseCurrent = () => ({
  entries: manifest.entries.map((e) => ({ file: e.file, assertedBy: [...e.assertedBy], impactRule: [...e.impactRule] })),
  totalFiles: manifest.totals.acceptanceFiles,
});

test('block351 口径：定义文档落盘且带时间戳与分母口径', () => {
  const text = fs.readFileSync(DEFINITION, 'utf8');
  assert.match(text, /冻结时间戳：\d{4}-\d{2}-\d{2}T/);
  assert.match(text, /分母/);
  assert.match(text, /禁止靠缩分母达标/);
  assert.match(text, /40%/);
});

test('block351 口径：manifest 完整（每条 entry 都有 test 引用与 impact 规则）', () => {
  assert.ok(manifest.entries.length >= 800, `entries=${manifest.entries.length}`);
  for (const e of manifest.entries) {
    assert.ok(e.assertedBy.length >= 1, `${e.file} 无 test 引用`);
    assert.ok(e.impactRule.length >= 1, `${e.file} 无 impact-map 规则`);
  }
  assert.ok(manifest.totals.earPct >= 40, `EAR ${manifest.totals.earPct}% < 40%`);
});

test('block351 负测：删一条 impact-map 引用 → 漂移判红（ok=false）', () => {
  const current = baseCurrent();
  const victim = current.entries.find((e) => e.impactRule.length >= 1);
  victim.impactRule = [];
  const { ok, issues } = validateManifest(manifest, current);
  assert.equal(ok, false);
  assert.ok(issues.some((i) => i.includes('impact-map 引用丢失') && i.includes(victim.file)));
});

test('block351 负测：删一条 test 引用 → 漂移判红', () => {
  const current = baseCurrent();
  const victim = current.entries.find((e) => e.assertedBy.length >= 1);
  victim.assertedBy = [];
  const { ok, issues } = validateManifest(manifest, current);
  assert.equal(ok, false);
  assert.ok(issues.some((i) => i.includes('test 引用丢失') && i.includes(victim.file)));
});

test('block351 负测：entry 整体消失（文件被移出资产化）→ 判红', () => {
  const current = baseCurrent();
  current.entries = current.entries.slice(1);
  const { ok } = validateManifest(manifest, current);
  assert.equal(ok, false);
});

test('block351 负测：EAR 跌破 40% → 棘轮下限判红（缩分母不行）', () => {
  const current = baseCurrent();
  current.totalFiles = manifest.totals.acceptanceFiles * 3; // 分母虚增 → EAR 降到 ~14%
  const { ok, issues } = validateManifest(manifest, current);
  assert.equal(ok, false);
  assert.ok(issues.some((i) => i.includes('棘轮下限')));
});

test('block351 负测 L0-3：EAR 降至 41%（低于 manifest 记录 43.3）→ 真棘轮判红', () => {
  const current = baseCurrent();
  current.entries = current.entries.slice(0, 825); // 825/2013 = 41.0%
  const { ok, issues } = validateManifest(manifest, current);
  assert.equal(ok, false);
  assert.ok(issues.some((i) => i.includes('棘轮只进不退') && i.includes('41') ), issues.join(' / '));
});

test('block351 L0-3：分子真实增长（EAR 高于记录值）→ 不判红（棘轮只进不退的反向允许）', () => {
  const current = baseCurrent();
  for (let i = 0; i < 10; i++) {
    current.entries.push({ file: `acceptance/post-k7-2026-11-10/l0/new-asset-${i}.json`, assertedBy: ['test/block351-ear.test.mjs'], impactRule: ['test-infrastructure'] });
  }
  const { ok, earNow, issues } = validateManifest(manifest, current);
  assert.equal(ok, true, issues.join(' / '));
  assert.ok(earNow > manifest.totals.earPct, `earNow=${earNow} 应高于记录 ${manifest.totals.earPct}`);
});

test('block351 假探针拦截：manifest 无「零 test 引用」条目（builder 机械扫描的结果性质）', () => {
  // 口径机制：assertedBy 由 *.test.mjs 源码扫描机械生成——手工/脚本冒称的「探针」
  //（无 test 断言引用）不可能出现在 manifest。固化该结果性质：
  for (const e of manifest.entries) {
    assert.ok(e.assertedBy.length >= 1, `${e.file} 零 test 引用=假探针漏网`);
  }
  // 且 builder 只扫 test/**.test.mjs（源码事实）
  const builder = fs.readFileSync(path.join(ROOT, 'scripts', 'block351-build-manifest.mjs'), 'utf8');
  assert.match(builder, /test'/);
  assert.doesNotMatch(builder, /scan\(path\.join\(ROOT, 'scripts'\)\)/);
});

test('block351: 恢复后判绿（完整 current → ok=true）', () => {
  const { ok } = validateManifest(manifest, baseCurrent());
  assert.equal(ok, true);
});
