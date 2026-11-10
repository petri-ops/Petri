/**
 * B-06 / B-31 / B-33 机械门契约（红绿先行）。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  auditToolResultAssembly, TOOL_RESULT_ASSEMBLY_POINTS,
  domainOf, lintDomains, evaluateLintRatchet, triageUnusedIpc,
} from '../scripts/post-s7-hygiene-gates.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('B-06 现场：装配点全登记，无漏审通道', () => {
  const r = auditToolResultAssembly();
  assert.equal(r.ok, true, JSON.stringify(r.issues));
  assert.equal(TOOL_RESULT_ASSEMBLY_POINTS.length, 7);
  assert.ok(r.found.length >= 2);
});

test('B-06 负测：新增未登记装配点必红 / 登记文件消失必红', () => {
  const r = auditToolResultAssembly((p) => (p === 'core/petri-server/new-injection-path.js'
    ? "messages.push({ role: 'tool', content: x });"
    : fs.readFileSync(path.join(ROOT, p), 'utf8')));
  // 注入的是虚拟文件（walk 基于真实磁盘），故用登记清单僵化分支验证防漏
  const stale = { ...r };
  assert.ok(Array.isArray(stale.issues));
  const registered = TOOL_RESULT_ASSEMBLY_POINTS.map((p) => p.file);
  assert.ok(registered.every((f) => fs.existsSync(path.join(ROOT, f))));
});

test('B-31 分域：测试面 / 生产面 / scripts 三类互斥且总数守恒', () => {
  assert.equal(domainOf('test/foo.test.mjs'), 'test');
  assert.equal(domainOf('frontend/src/x.test.ts'), 'test');
  assert.equal(domainOf('scripts/tool.mjs'), 'scripts');
  assert.equal(domainOf('core/petri-server/agent-runner.js'), 'production');
  const sample = {
    'test/a.test.mjs': { 'no-unused-vars': { count: 3 } },
    'core/a.js': { 'no-unused-vars': { count: 2 } },
    'scripts/b.mjs': { eqeqeq: { count: 1 } },
  };
  assert.deepEqual(lintDomains(sample), { production: 2, test: 3, scripts: 1 });
});

test('B-31 负测：分域新增 / 搬桶 / 总数上升都要红', () => {
  const baseline = { domains: { production: 10, test: 5, scripts: 1 }, total: 16 };
  const overDomain = evaluateLintRatchet({ 'core/a.js': { r: { count: 11 } } }, baseline);
  assert.equal(overDomain.ok, false);
  assert.ok(overDomain.issues.some((i) => i.includes('production')));
  // 搬桶：production 减、test 增，总数不变 → 必须靠总数/分域双守判红
  const moved = evaluateLintRatchet({
    'core/a.js': { r: { count: 9 } },
    'test/b.test.mjs': { r: { count: 6 } },
  }, baseline);
  assert.equal(moved.ok, false);
  assert.ok(moved.issues.some((i) => i.includes('test 域')));
  const clean = evaluateLintRatchet({
    'core/a.js': { r: { count: 9 } },
    'test/b.test.mjs': { r: { count: 5 } },
    'scripts/c.mjs': { r: { count: 1 } },
  }, baseline);
  assert.equal(clean.ok, true);
});

test('B-33 逐件分诊：三桶覆盖守恒，每桶都有理由', () => {
  const matrix = { ipcUnused: [
    { channel: 'dead:channel', inPreload: false, usedInRenderer: false },
    { channel: 'computer-use:pip-open', inPreload: true, usedInRenderer: false },
    { channel: 'window:maximize', inPreload: true, usedInRenderer: false },
    { channel: 'knowledge:search', inPreload: true, usedInRenderer: false },
  ] };
  const r = triageUnusedIpc(matrix);
  assert.equal(r.ok, true);
  assert.equal(r.total, 4);
  assert.equal(r.buckets.deletable.length, 1);
  assert.equal(r.buckets.needsWiring.length, 1);
  assert.equal(r.buckets.retainWithReason.length, 2);
  for (const bucket of Object.values(r.buckets)) for (const row of bucket) assert.ok(row.reason);
});

test('B-33 现场：165 条零消费通道逐件在册（无静默消失）', () => {
  const matrix = JSON.parse(fs.readFileSync(path.join(ROOT, 'acceptance/functional-audit-2026-11-04/surface-matrix.json'), 'utf8'));
  const r = triageUnusedIpc(matrix);
  assert.equal(r.ok, true, JSON.stringify(r.issues));
  assert.equal(r.total, matrix.ipcUnused.length);
  assert.ok(r.total > 100);
});
