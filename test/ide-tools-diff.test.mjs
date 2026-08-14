// test/ide-tools-diff.test.mjs
// IDE 差异比对 MCP 工具（ide_file_diff）测试
//
// 运行：node --test test/ide-tools-diff.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORE = resolve(__dirname, '..', 'core', 'r-server');

const ideTools = await import(
  pathToFileURL(resolve(CORE, 'mcp/ide-tools/index.js')).href
);
const { _rawHandlers } = ideTools;
const H = _rawHandlers;

function makeTempDir() {
  return fs.mkdtempSync(`${os.tmpdir()}/biof3-ide-diff-`);
}

function cleanup(tmp) {
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch (_e) { /* ignore */ }
}

test('ide_file_diff returns hunks with added/removed for different files', () => {
  const tmp = makeTempDir();
  const a = `${tmp}/a.txt`;
  const b = `${tmp}/b.txt`;
  fs.writeFileSync(a, 'line1\nline2\nline3\n');
  fs.writeFileSync(b, 'line1\nmodified\nline3\n');

  const res = H.ide_file_diff({ pathA: a, pathB: b });
  assert.equal(res.ok, true);
  assert.equal(res.truncated, false);
  assert.ok(Array.isArray(res.hunks));
  assert.ok(res.hunks.length >= 1, 'should have at least one hunk');
  // 默认（normal）模式下 diff 1c1：旧第 2 行被替换为新第 2 行
  const h = res.hunks[0];
  assert.equal(h.type, 'change');
  assert.equal(h.oldStart, 2);
  assert.equal(h.newStart, 2);
  assert.equal(res.summary.added, 1);
  assert.equal(res.summary.removed, 1);

  cleanup(tmp);
});

test('ide_file_diff returns empty hunks for identical files', () => {
  const tmp = makeTempDir();
  const a = `${tmp}/same.txt`;
  fs.writeFileSync(a, 'same\ncontent\n');
  const b = `${tmp}/copy.txt`;
  fs.writeFileSync(b, 'same\ncontent\n');

  const res = H.ide_file_diff({ pathA: a, pathB: b });
  assert.equal(res.ok, true);
  assert.equal(res.hunks.length, 0);
  assert.equal(res.summary.added, 0);
  assert.equal(res.summary.removed, 0);
  assert.equal(res.truncated, false);

  cleanup(tmp);
});

test('ide_file_diff rejects out-of-allowlist path', () => {
  // /etc/passwd 不在白名单内（既不是 cwd、也不是 os.tmpdir()，更不是 ~/.biof3/logs）。
  const res = H.ide_file_diff({ pathA: '/etc/passwd', pathB: '/etc/hosts' });
  assert.equal(res.ok, false);
  assert.match(res.error, /allowlist|safe|resolve under/);
});

test('ide_file_diff respects maxLines cap', () => {
  const tmp = makeTempDir();
  const a = `${tmp}/big-a.txt`;
  const b = `${tmp}/big-b.txt`;
  // 构造一个有大量行的差异
  const linesA = [];
  const linesB = [];
  for (let i = 0; i < 200; i++) {
    linesA.push(`line ${i}`);
    linesB.push(i % 10 === 0 ? `CHANGED ${i}` : `line ${i}`);
  }
  fs.writeFileSync(a, linesA.join('\n') + '\n');
  fs.writeFileSync(b, linesB.join('\n') + '\n');

  const cap = 5;
  const res = H.ide_file_diff({ pathA: a, pathB: b, maxLines: cap });
  assert.equal(res.ok, true);
  assert.equal(res.truncated, true);

  // 统计所有返回 hunk 的 lines 总数，应 <= cap
  let total = 0;
  for (const h of res.hunks) total += h.lines.length;
  assert.ok(total <= cap, `total=${total} should be <= ${cap}`);
  assert.ok(total > 0, 'should return at least some lines');

  // 验证 maxLines 上限硬封顶：maxLines=10000 应被截到 5000
  const huge = H.ide_file_diff({ pathA: a, pathB: b, maxLines: 10000 });
  assert.equal(huge.ok, true);
  let hugeTotal = 0;
  for (const h of huge.hunks) hugeTotal += h.lines.length;
  assert.ok(hugeTotal <= 5000, `hard cap: hugeTotal=${hugeTotal} should be <= 5000`);

  cleanup(tmp);
});

test('ide_file_diff unified mode produces unified hunk headers', () => {
  const tmp = makeTempDir();
  const a = `${tmp}/u-a.txt`;
  const b = `${tmp}/u-b.txt`;
  fs.writeFileSync(a, 'alpha\nbeta\ngamma\n');
  fs.writeFileSync(b, 'alpha\nBETA\ngamma\n');

  const res = H.ide_file_diff({ pathA: a, pathB: b, unified: true });
  assert.equal(res.ok, true);
  assert.ok(res.hunks.length >= 1);
  const h = res.hunks[0];
  // unified 格式应有 oldStart / newStart
  assert.equal(typeof h.oldStart, 'number');
  assert.equal(typeof h.newStart, 'number');
  assert.equal(typeof h.oldLines, 'number');
  assert.equal(typeof h.newLines, 'number');
  // 验证 lines 中包含 '-' 和 '+' 前缀
  const removed = h.lines.filter((l) => l.startsWith('-') && !l.startsWith('---'));
  const added = h.lines.filter((l) => l.startsWith('+') && !l.startsWith('+++'));
  assert.equal(removed.length, 1);
  assert.equal(added.length, 1);
  assert.equal(res.summary.added, 1);
  assert.equal(res.summary.removed, 1);
  // type 应为 'change'（混合）
  assert.equal(h.type, 'change');

  cleanup(tmp);
});
