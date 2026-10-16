/**
 * BLOCK-191 — formal-admission 门控棘轮契约测（纯函数 + 源码扫描，离线零 provider 零人眼）。
 * 口径=用户拍板「晋升=双齐+显式审计」：manifest 齐 + (fixture 在场 或 显式声明 requiresFixture:false)，
 * 且基线/快照写入只能由显式审计 flag 触发。PASS 判定语义不改（本门只管准入）。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { deriveAdmissionManifest, evalAdmission } from '../scripts/lib/evals-admission.mjs';
import { listSuites, collectSuiteTasks } from '../scripts/lib/evals-catalog.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SUITES = path.join(ROOT, 'evals', 'suites');

test('manifest 派生：tier/fixture/声明/covers 正确', () => {
  const m1 = deriveAdmissionManifest({ id: 'x', category: 'policy', criteria: [{ kind: 'task_completed' }], fixtureFiles: { 'a.md': '1' } }, 'real');
  assert.equal(m1.tier, 'real');
  assert.equal(m1.fixtureCount, 1);
  assert.equal(m1.manifestComplete, true);
  assert.match(m1.covers, /policy/);
  assert.match(m1.covers, /task_completed/);
  const m2 = deriveAdmissionManifest({ id: 'y', category: 'sanity', criteria: [{ kind: 'tool_used' }], requiresFixture: false }, 'smoke');
  assert.equal(m2.tier, 'smoke');
  assert.equal(m2.fixtureDeclaredNotNeeded, true);
});

test('双齐规则：缺 fixture 且未声明→未齐；显式声明免→齐；manifest 缺件→未齐', () => {
  const noFixture = deriveAdmissionManifest({ id: 'a', category: 'c', criteria: [{ kind: 'task_completed' }] }, 'real');
  assert.deepEqual(evalAdmission(noFixture).missing, ['fixture']);
  assert.equal(evalAdmission(noFixture).admitted, false);
  // 双齐只约束晋升目标（real 层）；冒烟层无 fixture 属正常，不判未齐
  const smokeNoFixture = deriveAdmissionManifest({ id: 's', category: 'c', criteria: [{ kind: 'task_completed' }] }, 'smoke');
  assert.equal(evalAdmission(smokeNoFixture).admitted, true, 'smoke 层不应被逼 fixture');
  const declared = deriveAdmissionManifest({ id: 'b', category: 'c', criteria: [{ kind: 'task_completed' }], requiresFixture: false }, 'real');
  assert.equal(evalAdmission(declared).admitted, true);
  const withFixture = deriveAdmissionManifest({ id: 'c', category: 'c', criteria: [{ kind: 'task_completed' }], fixtureFiles: { 'x.md': 'y' } }, 'real');
  assert.equal(evalAdmission(withFixture).admitted, true);
  const badManifest = deriveAdmissionManifest({ category: 'c', criteria: [] }, 'real');
  assert.ok(evalAdmission(badManifest).missing.includes('manifest'));
});

test('现有全部 evals 用例均达准入（棘轮：新增缺件用例即红）', () => {
  const offenders = [];
  let total = 0;
  for (const suite of listSuites(SUITES)) {
    for (const t of collectSuiteTasks(SUITES, suite)) {
      total += 1;
      const a = evalAdmission(deriveAdmissionManifest(t, suite));
      if (!a.admitted) offenders.push(`${suite}/${t.id} 缺=${a.missing.join(',')}`);
    }
  }
  assert.ok(total >= 13, `应覆盖全部套件用例，实测 ${total}`);
  assert.deepEqual(offenders, [], `存在未齐用例：${offenders.join(' | ')}`);
});

test('显式审计源码门：基线/快照写入必须由 --update/--update-snapshot 守卫', () => {
  const FLAGS = ['--update', '--update-snapshot', 'update'];
  const violations = [];
  for (const f of ['scripts/evals-gate.mjs', 'scripts/evals-run.mjs']) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const re = /writeFileSync\(\s*(baselinePath|snapshotPath|path\.join\([^)]*snapshots[^)]*\))/g;
    let m;
    while ((m = re.exec(src))) {
      const before = src.slice(Math.max(0, m.index - 500), m.index);
      if (!FLAGS.some((k) => before.includes(k))) violations.push(`${f}@${m.index}`);
    }
  }
  assert.deepEqual(violations, [], `存在非显式审计的基线写入：${violations.join(', ')}`);
});

test('门控口径不改判定语义：runGoldenTask PASS 仍=全 criteria 过', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'lib', 'evals-harness.mjs'), 'utf8');
  assert.match(src, /passed:\s*criteriaResults\.length\s*>\s*0\s*&&\s*criteriaResults\.every\(\(c\)\s*=>\s*c\.passed\)/,
    'PASS 判定必须是「有判据且全过」——formal-admission 只加准入门不动此语义');
});
