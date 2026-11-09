/**
 * 在制用户资产零入库门（BLOCK-393）——契约测试。
 * 同类缺陷两次复发（34076352 / 932b9136）→ 机械门 + 负测：
 * 只要清单里的路径出现在 tracked 或 staged 任一侧就必须红。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { evaluateIndex, matchProtected, collectIndexState } from '../scripts/user-asset-guard.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, 'test/user-asset-guard-baseline.json'), 'utf8'));

test('路径匹配：精确文件与目录前缀', () => {
  const paths = ['docs/pelican-bicycle.html', 'assets/', 'tmp-review/'];
  assert.equal(matchProtected('docs/pelican-bicycle.html', paths), 'docs/pelican-bicycle.html');
  assert.equal(matchProtected('assets/logo.png', paths), 'assets/');
  assert.equal(matchProtected('tmp-review/a/b.txt', paths), 'tmp-review/');
  assert.equal(matchProtected('docs/other.html', paths), null);
  assert.equal(matchProtected('assets-other/x.png', paths), null);
});

test('负测：已入库 / 已暂存任一侧命中即红', () => {
  const clean = evaluateIndex({ trackedPaths: ['package.json'], stagedPaths: ['docs/README.md'], protectedPaths: baseline.paths });
  assert.equal(clean.ok, true);

  const trackedHit = evaluateIndex({ trackedPaths: ['docs/pelican-bicycle.html'], stagedPaths: [], protectedPaths: baseline.paths });
  assert.equal(trackedHit.ok, false);
  assert.equal(trackedHit.hits[0].source, 'tracked');

  const stagedHit = evaluateIndex({ trackedPaths: [], stagedPaths: ['assets/a.png'], protectedPaths: baseline.paths });
  assert.equal(stagedHit.ok, false);
  assert.equal(stagedHit.hits[0].source, 'staged');

  const both = evaluateIndex({ trackedPaths: ['tmp-review/x'], stagedPaths: ['tmp-review/x'], protectedPaths: baseline.paths });
  assert.equal(both.hits.length, 2);
});

test('现场：当前仓库索引里没有任何受保护路径', () => {
  const state = collectIndexState();
  const result = evaluateIndex({ ...state, protectedPaths: baseline.paths });
  assert.deepEqual(result.hits, [], `命中：${JSON.stringify(result.hits)}`);
  assert.equal(result.ok, true);
});

test('清单自洽：无重复、无绝对路径、两次事故均在册', () => {
  assert.equal(new Set(baseline.paths).size, baseline.paths.length);
  assert.ok(baseline.paths.every((p) => !p.startsWith('/')));
  assert.equal(baseline.incidents.length, 2);
});
