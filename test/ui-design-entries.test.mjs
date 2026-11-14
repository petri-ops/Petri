/**
 * UI-D1 (BLOCK-416) — 入口↔路由双向对账门负测。
 * 契约：5 类植入必红（未登记路由 / 未登记入口 / 重复 canonical / 页头漂移 / 孤儿路由），
 * 真实源码对账在 shared.tsx 清单清理后转绿。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  verifyEntries, checkFiles, extractRoutePaths, extractEntryLiterals,
  extractStandalonePaths, stripComments, APP_PATH, SHARED_PATH,
} from '../scripts/ui-design-entry-gate.mjs';
import {
  CANONICAL_ENTRIES, ALIASES, SURFACE_ALIASES, STANDALONE_PATHS,
  ENTRY_SOURCE_FILES, MAX_TASK_CLICKS,
} from '../scripts/ui-design-entry-registry.mjs';

const sourceOf = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const realRoutePaths = extractRoutePaths(sourceOf('frontend/src/App.tsx'));
const realLiterals = [...new Set(ENTRY_SOURCE_FILES.flatMap((r) => extractEntryLiterals(sourceOf(r))))];
const base = () => ({
  routePaths: [...realRoutePaths],
  sourceLiterals: [...realLiterals],
  standalonePaths: [...STANDALONE_PATHS],
});

test('real tree passes both-direction reconciliation (gate:ui-entries)', () => {
  assert.deepEqual(checkFiles().problems, []);
});

test('stripComments removes line/block comments but keeps path strings', () => {
  const s = "const a = navigate('/projects'); // navigate('/backend')\n/* navigate('/legacy') */";
  const stripped = stripComments(s);
  assert.match(stripped, /navigate\('\/projects'\)/);
  assert.doesNotMatch(stripped, /backend|legacy/);
});

test('extractRoutePaths finds the 16 Route declarations in App.tsx', () => {
  assert.equal(realRoutePaths.length, 16);
  assert.ok(realRoutePaths.includes('/review'));
  assert.ok(realRoutePaths.includes('/window/rail'));
});

test('extractEntryLiterals finds nav literals without comment noise', () => {
  assert.ok(realLiterals.includes('/projects'));
  assert.ok(realLiterals.includes('/extensions?tab=domain-plugins'));
  assert.ok(!realLiterals.includes('/backend'));
});

test('植入未登记路由必红（路由→表）', () => {
  const p = verifyEntries({ ...base(), routePaths: [...realRoutePaths, '/rogue-page'] });
  assert.ok(p.some((x) => x.includes('路由→表缺失') && x.includes('/rogue-page')));
});

test('植入未登记入口必红（源码→表）', () => {
  const p = verifyEntries({ ...base(), sourceLiterals: [...realLiterals, '/shadow-entry'] });
  assert.ok(p.some((x) => x.includes('源码→表缺失') && x.includes('/shadow-entry')));
});

test('重复 canonical 路径必红（每功能 1 条）', () => {
  const dup = [...CANONICAL_ENTRIES, { ...CANONICAL_ENTRIES[1], id: 'projects-copy' }];
  const p = verifyEntries({ ...base(), canonicalEntries: dup });
  assert.ok(p.some((x) => x.includes('duplicate canonical path')) || p.some((x) => x.includes('表→路由缺失')));
});

test('页头清单漂移必红（含 /backend 残留）', () => {
  const p = verifyEntries({ ...base(), standalonePaths: ['/', '/backend', '/knowledge', '/skills', '/plugins', '/settings'] });
  assert.ok(p.some((x) => x.includes('页头清单漂移')));
});

test('孤儿路由 / 孤儿 alias 必红', () => {
  const p1 = verifyEntries({ ...base(), canonicalEntries: CANONICAL_ENTRIES.filter((e) => e.id !== 'review') });
  assert.ok(p1.some((x) => x.includes('路由→表缺失') && x.includes('/review')));
  const p2 = verifyEntries({ ...base(), aliases: [...ALIASES, { path: '/x', canonical: '/nowhere', reason: 'r' }] });
  assert.ok(p2.some((x) => x.includes('指向不存在的 canonical')));
});

test('点击数上限与 surfaceAlias 指向受门守护', () => {
  const entries = CANONICAL_ENTRIES.map((e) => e.id === 'projects' ? { ...e, clicks: MAX_TASK_CLICKS + 1 } : e);
  assert.ok(verifyEntries({ ...base(), canonicalEntries: entries }).some((x) => x.includes('clicks=')));
  assert.equal(SURFACE_ALIASES.length, 1);
  assert.equal(SURFACE_ALIASES[0].canonical, '/review');
});

test('shared.tsx 清单实际等于表内 standalone 集合（残留已清）', () => {
  assert.deepEqual(extractStandalonePaths(sourceOf('frontend/src/components/desktop/titlebar/shared.tsx')), [...STANDALONE_PATHS].sort());
  assert.ok(!extractStandalonePaths(sourceOf('frontend/src/components/desktop/titlebar/shared.tsx')).includes('/backend'));
  assert.equal(fs.existsSync(APP_PATH), true);
  assert.equal(fs.existsSync(SHARED_PATH), true);
});
