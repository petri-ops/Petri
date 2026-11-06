/**
 * nso-w5-impact-coverage.test.mjs — BLOCK-364（NSO-W5a）影响图测试覆盖棘轮。
 *
 * 缺口（W5-4）：643 个测试文件中 147 个不被任何 impact-map 规则 `tests` 引用——
 * 相关生产代码改动时 `test:changed` 不会执行它们，缺陷只在全量分片里「仅全量暴露」。
 * 契约：
 *  - 每个 test/*.test.* 必须被某条规则的 tests 引用，或列在存量基线（unmappedTests）；
 *  - 基线条目已被规则覆盖 → 判红（要求从基线移除，棘轮只减不增）；
 *  - 基线条目文件已删除 → 判红（清理后同批移出）。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const map = JSON.parse(fs.readFileSync(path.join(ROOT, 'test', 'impact-map.json'), 'utf8'));
const baselinePath = path.join(ROOT, 'test', 'impact-map-coverage-baseline.json');
const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));

const referenced = new Set(map.rules.flatMap((rule) => rule.tests ?? []));
const actual = fs.readdirSync(path.join(ROOT, 'test'))
  .filter((f) => f.endsWith('.test.mjs') || f.endsWith('.test.cjs') || f.endsWith('.test.js'))
  .map((f) => `test/${f}`);
const actualSet = new Set(actual);

test('W5a 每个测试文件都被 impact-map 引用或在存量基线（新增测试必须挂规则）', () => {
  const orphans = actual.filter((t) => !referenced.has(t) && !baseline.unmappedTests.includes(t));
  assert.deepEqual(orphans, [],
    `新测试未挂 impact-map（把文件加进相关规则的 tests）：\n  ${orphans.join('\n  ')}`);
});

test('W5a 棘轮只减：基线里已被规则覆盖的条目必须移出', () => {
  const stale = baseline.unmappedTests.filter((t) => referenced.has(t));
  assert.deepEqual(stale, [], `以下基线条目现已被规则覆盖——从 impact-map-coverage-baseline.json 移除：\n  ${stale.join('\n  ')}`);
});

test('W5a 基线不含已删除文件', () => {
  const gone = baseline.unmappedTests.filter((t) => !actualSet.has(t));
  assert.deepEqual(gone, [], `以下基线条目文件已不存在——从基线移除：\n  ${gone.join('\n  ')}`);
});
