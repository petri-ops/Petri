// BLOCK-78 P2-③ — 结果库占用纯逻辑零网络测试。
// walkSize（递归求和/限深限文件截断/符号链接跳过/缺失目录诚实降级）+
// parseDuOutput（du -sb 首列解析）+ createStorageCache（fresh/stale TTL）。
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { walkSize, parseDuOutput, createStorageCache } = require('../core/petri-server/helpers/project-storage.js');

test('walkSize：递归求和 + 限文件数截断诚实降级', async () => {
  const root = mkdtempSync(join(tmpdir(), 'b78-walk-'));
  try {
    mkdirSync(join(root, 'output', 'sub'), { recursive: true });
    writeFileSync(join(root, 'output', 'a.csv'), 'x'.repeat(100));
    writeFileSync(join(root, 'output', 'sub', 'b.png'), 'y'.repeat(1000));
    writeFileSync(join(root, 'params.json'), 'z'.repeat(10));
    const r = await walkSize(join(root, 'output'));
    assert.equal(r.bytes, 1100);
    assert.equal(r.truncated, false);

    const capped = await walkSize(root, { maxFiles: 2 });
    assert.equal(capped.truncated, true);
    assert.ok(capped.bytes > 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('walkSize：缺失目录返回 0 + truncated（诚实降级）', async () => {
  const r = await walkSize(join(tmpdir(), `b78-missing-${Date.now()}`));
  assert.equal(r.bytes, 0);
  assert.equal(r.truncated, true);
});

test('parseDuOutput：du -sb 首列字节解析，异常输出回落 0', () => {
  assert.equal(parseDuOutput('12345\t/srv/proj/results/jobs\n'), 12345);
  assert.equal(parseDuOutput('0\t/x\n'), 0);
  assert.equal(parseDuOutput('garbage'), 0);
  assert.equal(parseDuOutput(''), 0);
});

test('createStorageCache：fresh 命中 / 超 TTL stale / 无历史 null', () => {
  let clock = 0;
  const cache = createStorageCache({ ttlMs: 60000, now: () => clock });
  const payload = { jobs: 3, bytes: 42, observedAt: '2026-09-10T00:00:00.000Z' };
  cache.put('p1', payload);
  assert.equal(cache.getFresh('p1'), payload);
  clock += 60000;
  assert.equal(cache.getFresh('p1'), null);
  assert.equal(cache.getStale('p1'), payload);
  assert.equal(cache.getStale('p_none'), null);
});
