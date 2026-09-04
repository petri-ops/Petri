/**
 * BLOCK-56 P3 — 上下文保鲜（context freshness）定向测试。
 *
 * 三态：
 * - 新文件（首次读取）→ 只附 fingerprint，无 unchanged/changedSinceLastRead
 * - 同文件未变（重复读取同 hash）→ 附 unchanged: true
 * - 同文件已变（重复读取不同 hash）→ 附 changedSinceLastRead: true
 *
 * 另覆盖 applyFreshnessMark 的零副作用边界（not ok / 缺 sha256 / 缺 path 原样返回）
 * 与真实 workspace_read 的集成三态（createWorkspaceTools + 临时 workspace）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import fssync from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const {
  createFreshnessTracker,
  applyFreshnessMark,
  fingerprintOf,
} = require('../core/biof3-server/helpers/context-freshness.js');
const { createWorkspaceTools } = require('../core/biof3-server/agent-tools/workspace-tools.js');

// ---------- 纯函数：fingerprintOf ----------

test('fingerprintOf: sha256 前 8 位切片', () => {
  assert.equal(fingerprintOf('abcdef1234567890'), 'abcdef12');
  assert.equal(fingerprintOf(''), null);
  assert.equal(fingerprintOf(null), null);
});

// ---------- 纯函数：tracker 三态 ----------

test('BLOCK-56 P3 tracker 三态：新文件/未变/已变', () => {
  const tracker = createFreshnessTracker();

  // 新文件：只附 fingerprint
  const first = tracker.observe('data/counts.csv', 'a'.repeat(64), 1);
  assert.deepEqual(first, { fingerprint: 'aaaaaaaa' });
  assert.equal(first.unchanged, undefined);
  assert.equal(first.changedSinceLastRead, undefined);

  // 同文件未变：unchanged
  const second = tracker.observe('data/counts.csv', 'a'.repeat(64), 3);
  assert.deepEqual(second, { fingerprint: 'aaaaaaaa', unchanged: true });

  // 同文件已变：changedSinceLastRead
  const third = tracker.observe('data/counts.csv', 'b'.repeat(64), 4);
  assert.deepEqual(third, { fingerprint: 'bbbbbbbb', changedSinceLastRead: true });

  // 再读同版本 → unchanged 恢复
  const fourth = tracker.observe('data/counts.csv', 'b'.repeat(64), 5);
  assert.deepEqual(fourth, { fingerprint: 'bbbbbbbb', unchanged: true });

  assert.equal(tracker.size(), 1, '多路径共享同一 map，单路径只存一条');
});

test('tracker: 多文件隔离 + 迭代号/时间戳记录', () => {
  const tracker = createFreshnessTracker();
  const t0 = Date.now();
  tracker.observe('a.csv', '1'.repeat(64), 2);
  const firstB = tracker.observe('b.csv', '2'.repeat(64), 2);
  assert.deepEqual(firstB, { fingerprint: '22222222' }, '另一文件首次读取不因同迭代而误标');
  // 内部记录断言：再读 a.csv 未变 → unchanged（证明 a 的基线还在）
  const reread = tracker.observe('a.csv', '1'.repeat(64), 3);
  assert.equal(reread.unchanged, true);
  assert.ok(t0 <= Date.now());
});

test('tracker: 缺 path/hash 时返回空标记不崩溃', () => {
  const tracker = createFreshnessTracker();
  assert.deepEqual(tracker.observe('', 'a'.repeat(64), 1), {});
  assert.deepEqual(tracker.observe('x.csv', '', 1), {});
});

// ---------- applyFreshnessMark 边界 ----------

test('applyFreshnessMark: 非 ok / 缺 sha256 / 缺 path 原样返回零副作用', () => {
  const tracker = createFreshnessTracker();
  const notOk = { ok: false, error: 'file_too_large' };
  assert.equal(applyFreshnessMark(notOk, tracker, 1), notOk);
  const noHash = { ok: true, path: 'a.csv', content: 'x' };
  assert.equal(applyFreshnessMark(noHash, tracker, 1), noHash);
  const noPath = { ok: true, sha256: 'a'.repeat(64), content: 'x' };
  assert.equal(applyFreshnessMark(noPath, tracker, 1), noPath);
});

test('applyFreshnessMark: ok 结果增强且不改变原对象', () => {
  const tracker = createFreshnessTracker();
  const original = { ok: true, path: 'a.csv', sha256: 'a'.repeat(64), content: 'v1' };
  const first = applyFreshnessMark(original, tracker, 1);
  assert.equal(first.fingerprint, 'aaaaaaaa');
  assert.equal(first.unchanged, undefined);
  assert.deepEqual(Object.keys(original).sort(), ['content', 'ok', 'path', 'sha256'], '原对象不被就地修改');

  const second = applyFreshnessMark({ ...original }, tracker, 2);
  assert.equal(second.unchanged, true);
});

// ---------- 集成：真实 workspace_read 三态 ----------

test('BLOCK-56 P3 集成：workspace_read 真实读取的三态标记', async () => {
  const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'biof3-block56-p3-'));
  const workspaceRoot = path.join(sandboxRoot, 'workspace');
  await fs.mkdir(workspaceRoot, { recursive: true });
  const filePath = path.join(workspaceRoot, 'notes.csv');
  await fs.writeFile(filePath, 'sample,condition\ns1,control\n', 'utf8');

  const fakeDb = {
    getProject(projectId) {
      if (projectId !== 'p_fresh') return null;
      return { id: projectId, user_id: 'u_fresh', status: 'active', workspace_path: workspaceRoot };
    },
    getUserById(userId) {
      return { id: userId, role: 'user' };
    },
  };
  const tools = createWorkspaceTools({ dbProvider: () => fakeDb });
  const ctx = { userId: 'u_fresh', projectId: 'p_fresh', accessMode: 'full' };
  const tracker = createFreshnessTracker();

  try {
    // 新文件
    const read1 = await tools.readFile({ path: 'notes.csv' }, ctx);
    assert.equal(read1.ok, true);
    const marked1 = applyFreshnessMark(read1, tracker, 1);
    assert.equal(marked1.fingerprint, read1.sha256.slice(0, 8));
    assert.equal(marked1.unchanged, undefined);
    assert.equal(marked1.changedSinceLastRead, undefined);

    // 同文件未变
    const read2 = await tools.readFile({ path: 'notes.csv' }, ctx);
    const marked2 = applyFreshnessMark(read2, tracker, 2);
    assert.equal(marked2.unchanged, true);
    assert.equal(marked2.sha256, read1.sha256);

    // 磁盘内容变化 → changedSinceLastRead
    await fs.writeFile(filePath, 'sample,condition\ns1,treated\ns2,treated\n', 'utf8');
    const read3 = await tools.readFile({ path: 'notes.csv' }, ctx);
    const marked3 = applyFreshnessMark(read3, tracker, 3);
    assert.equal(marked3.changedSinceLastRead, true);
    assert.notEqual(marked3.sha256, read1.sha256);
    assert.equal(marked3.fingerprint, marked3.sha256.slice(0, 8));
  } finally {
    try { fssync.rmSync(sandboxRoot, { recursive: true, force: true }); } catch {}
  }
});
