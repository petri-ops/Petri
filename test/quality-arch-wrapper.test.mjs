import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

// BLOCK-272 — quality:arch 包装器（消费共享 cruise 评 R1-R5）。
// 红绿先行：实现缺失时本文件红。spawn 用真实仓库（干净仓语义：规则面不依赖工作区脏净）。

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WRAPPER = pathToFileURL(path.join(ROOT, 'scripts', 'quality-arch.mjs')).href;
const { evaluateArchRules } = await import(WRAPPER);

const CACHE_DIR = path.join(ROOT, 'node_modules', '.cache', 'petri-closeout');

test('evaluateArchRules: 空违规 → ok（绿样本）', () => {
  const r = evaluateArchRules([]);
  assert.equal(r.ok, true);
  assert.equal(r.total, 0);
});

test('evaluateArchRules: R1 违规 → 不 ok 且归入 byRule（红样本）', () => {
  const r = evaluateArchRules([
    {
      rule: { name: 'R1-renderer-no-electron-direct' },
      from: { name: 'frontend/src/foo.ts' },
      to: { name: 'electron' },
    },
  ]);
  assert.equal(r.ok, false);
  assert.equal(r.total, 1);
  assert.equal(r.byRule['R1-renderer-no-electron-direct'], 1);
});

test('evaluateArchRules: 非 R 规则（如环规则）不计入本门（职责隔离）', () => {
  const r = evaluateArchRules([
    { rule: { name: 'P3-no-cycles' }, from: {}, to: {}, cycle: ['a', 'b'] },
  ]);
  assert.equal(r.ok, true);
  assert.equal(r.total, 0);
});

test('spawn 干净仓：quality-arch.mjs 退出 0 且输出 PASS', () => {
  const r = spawnSync(process.execPath, ['scripts/quality-arch.mjs'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, `exit=${r.status} stdout=${r.stdout} stderr=${r.stderr}`);
  assert.match(r.stdout, /PASS/);
});

test('同轮缓存：带 RUN_ID 首跑建缓存、复跑命中（exit 0）', () => {
  const runId = 'test-run-block272';
  const cacheFile = path.join(CACHE_DIR, `arch-cruise-${runId}.json`);
  const env = { ...process.env, PETRI_CLOSEOUT_RUN_ID: runId };
  const first = spawnSync(process.execPath, ['scripts/quality-arch.mjs'], { cwd: ROOT, encoding: 'utf8', env });
  assert.equal(first.status, 0, `first exit=${first.status} stderr=${first.stderr}`);
  assert.ok(fs.existsSync(cacheFile), '首跑应落共享 cruise 缓存');
  assert.match(first.stdout, /cruise/);
  const second = spawnSync(process.execPath, ['scripts/quality-arch.mjs'], { cwd: ROOT, encoding: 'utf8', env });
  assert.equal(second.status, 0, `second exit=${second.status} stderr=${second.stderr}`);
  assert.match(second.stdout, /缓存命中/);
});

test.after(() => {
  // 清理测试运行 ID 的缓存文件，不污染后续真实收口（其余 runId 缓存不动）。
  const cacheFile = path.join(CACHE_DIR, 'arch-cruise-test-run-block272.json');
  try { fs.rmSync(cacheFile, { force: true }); } catch { /* 尽力清理 */ }
});
