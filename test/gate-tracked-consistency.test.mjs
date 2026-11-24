/**
 * BLOCK-511 S2.4 HK-01 — 已跟踪文件引用未跟踪路径即红。
 * 用 analyze() 纯函数注入夹具，不依赖真实 git 状态（夹具引用一个未跟踪文件即红）。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze } from '../scripts/gate-tracked-consistency.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const baseMap = { rules: [{ id: 'r1', tests: ['test/keep.test.mjs'], patterns: ['src/keep.js', 'src/**'] }] };
const basePkg = { scripts: { 'test:one': 'node scripts/runner.mjs --flag', 'build': 'tsc -p frontend/tsconfig.json' } };
const tracked = ['test/keep.test.mjs', 'src/keep.js', 'scripts/runner.mjs', 'frontend/tsconfig.json'];

test('夹具全部已跟踪 → 零违规', () => {
  const r = analyze({ tracked: new Set(tracked), map: baseMap, pkg: basePkg, exemptions: { items: [] } });
  assert.deepEqual(r.violations, []);
  assert.ok(r.refs >= 3);
});

test('夹具引用一个未跟踪测试文件 → 红（HK-01）', () => {
  const map = { rules: [{ id: 'r1', tests: ['test/keep.test.mjs', 'test/ghost.test.mjs'], patterns: ['src/keep.js'] }] };
  const r = analyze({ tracked: new Set(tracked), map, pkg: basePkg, exemptions: { items: [] } });
  assert.ok(r.violations.some((v) => v.path === 'test/ghost.test.mjs' && v.source === 'r1.tests'));
});

test('夹具引用一个未跟踪 pattern → 红', () => {
  const map = { rules: [{ id: 'r1', tests: [], patterns: ['src/ghost.js', 'src/**'] }] };
  const r = analyze({ tracked: new Set(tracked), map, pkg: basePkg, exemptions: { items: [] } });
  assert.ok(r.violations.some((v) => v.path === 'src/ghost.js'));
  assert.ok(!r.violations.some((v) => v.path === 'src/**'), 'glob pattern 不参与');
});

test('package.json 脚本引用未跟踪文件 → 红', () => {
  const pkg = { scripts: { 'gate:x': 'node scripts/ghost-script.mjs' } };
  const r = analyze({ tracked: new Set(tracked), map: baseMap, pkg, exemptions: { items: [] } });
  assert.ok(r.violations.some((v) => v.path === 'scripts/ghost-script.mjs' && v.source === 'package.json#gate:x'));
});

test('带 owner/date/reason 的豁免项不报红', () => {
  const map = { rules: [{ id: 'r1', tests: ['test/ghost.test.mjs'], patterns: [] }] };
  const exemptions = { items: [{ path: 'test/ghost.test.mjs', owner: 'block511', date: '2026-11-24', reason: '在制未入库' }] };
  const r = analyze({ tracked: new Set(tracked), map, pkg: {}, exemptions });
  assert.deepEqual(r.violations, []);
});

test('真实豁免基线在册且每条带 owner/date/reason（证据链不靠叙述）', () => {
  const file = 'acceptance/panoramic-remediation-2026-11-24/tracked-consistency-exemptions.json';
  const real = JSON.parse(fs.readFileSync(path.resolve(root, file), 'utf8'));
  assert.ok(Array.isArray(real.items));
  for (const item of real.items) {
    assert.ok(item.path && item.owner && item.date && item.reason, `${item.path} 缺 owner/date/reason`);
  }
});
