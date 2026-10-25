import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { buildSyntheticMinidump } from './fixtures/synthetic-minidump.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve('.');
const { summarizeDumpFile } = require(path.join(ROOT, 'src/main/minidump-summary.js'));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'b260-dump-'));
function writeDump(name, buffer) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, buffer);
  return file;
}

test('BLOCK-260 K2 — 解析模块/异常/系统/进程（零上传、只读）', () => {
  const good = writeDump('good.dmp', buildSyntheticMinidump());
  const summary = summarizeDumpFile(good);
  assert.equal(summary.ok, true, JSON.stringify(summary));
  assert.equal(summary.streamCount, 4);
  assert.deepEqual(summary.streamTypes, [4, 6, 7, 12]);
  assert.equal(summary.modules.length, 1);
  assert.equal(summary.modules[0].name, 'petri.exe');
  assert.equal(summary.modules[0].size, 0x1000);
  assert.deepEqual(summary.exception, { threadId: 7, code: '0xc0000005', address: '0x140001234' });
  assert.deepEqual(summary.system, { arch: 'x64', processors: 8, osVersion: '10.0.26100' });
  assert.equal(summary.processId, 4242);
});

test('BLOCK-260 K2 — 畸形/截断/错签名 fail-closed', () => {
  assert.equal(summarizeDumpFile(writeDump('small.dmp', Buffer.alloc(8))).error, 'too_small');
  assert.equal(summarizeDumpFile(writeDump('garbage.dmp', Buffer.alloc(32, 0x41))).error, 'bad_signature');
  const truncated = buildSyntheticMinidump().subarray(0, 44);
  assert.equal(summarizeDumpFile(writeDump('truncated.dmp', truncated)).ok, false);
});

test('BLOCK-260 K2 — 文件入口：非文件/空文件拒绝，合法 dump 通过', () => {
  assert.equal(summarizeDumpFile(path.join(dir, 'missing.dmp')).ok, false);
  assert.equal(summarizeDumpFile(writeDump('empty.dmp', Buffer.alloc(0))).error, 'unreasonable_size');
  assert.equal(summarizeDumpFile(dir).error, 'not_a_file');
  assert.equal(summarizeDumpFile(writeDump('good2.dmp', buildSyntheticMinidump())).ok, true);
});

test.after(() => {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* EPERM */ }
});
