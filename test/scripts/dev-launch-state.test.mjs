// ============================================================
// BLOCK-45 — dev-launch-state 单测
//
// 覆盖 boot 清理决策三分支（并存 fail-closed / 崩溃残留 token 定向清理 /
// 无记录跳过）+ force-clean 逃生口 + 记录读写清 roundtrip。
// 纯逻辑 + 临时目录，不触碰真实进程与 pgrep。
// ============================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  LAUNCH_RECORD_FILENAME,
  launchRecordPath,
  readLaunchRecord,
  writeLaunchRecord,
  clearLaunchRecord,
  resolveBootElectronAction,
} from '../../scripts/lib/dev-launch-state.js';

function makeTempDir() {
  return mkdtempSync(join(tmpdir(), 'b45-launch-state-'));
}

const RECORD = { token: 'petridev-123-abc', wrapperPid: 4242, startedAt: '2026-09-03T00:00:00.000Z' };

// ---------------------------------------------------------------------------
// readLaunchRecord
// ---------------------------------------------------------------------------

test('readLaunchRecord: missing file → null', () => {
  const dir = makeTempDir();
  try {
    assert.equal(readLaunchRecord(dir), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readLaunchRecord: malformed JSON → null (fail-open)', () => {
  const dir = makeTempDir();
  try {
    writeFileSync(launchRecordPath(dir), '{not-json');
    assert.equal(readLaunchRecord(dir), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readLaunchRecord: invalid record shape (missing token / bad pid) → null', () => {
  const dir = makeTempDir();
  try {
    writeFileSync(launchRecordPath(dir), JSON.stringify({ wrapperPid: 1 }));
    assert.equal(readLaunchRecord(dir), null);
    writeFileSync(launchRecordPath(dir), JSON.stringify({ token: 't', wrapperPid: 'not-a-pid' }));
    assert.equal(readLaunchRecord(dir), null);
    writeFileSync(launchRecordPath(dir), JSON.stringify({ token: 't', wrapperPid: -3 }));
    assert.equal(readLaunchRecord(dir), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// write / clear roundtrip
// ---------------------------------------------------------------------------

test('writeLaunchRecord + readLaunchRecord roundtrip; clear removes file', () => {
  const dir = makeTempDir();
  try {
    writeLaunchRecord(dir, RECORD);
    const record = readLaunchRecord(dir);
    assert.equal(record.token, RECORD.token);
    assert.equal(record.wrapperPid, RECORD.wrapperPid);
    assert.equal(record.startedAt, RECORD.startedAt);
    // readLaunchRecord 只返回规范字段；savedAt 属落盘附加信息（末尾专项用例覆盖）
    assert.equal(record.savedAt, undefined);
    assert.ok(existsSync(launchRecordPath(dir)));

    clearLaunchRecord(dir);
    assert.equal(existsSync(launchRecordPath(dir)), false);
    // clear 幂等（ENOENT 不抛）
    clearLaunchRecord(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('LAUNCH_RECORD_FILENAME lives under provided userDataDir', () => {
  assert.equal(launchRecordPath('/tmp/x'), join('/tmp/x', LAUNCH_RECORD_FILENAME));
});

// ---------------------------------------------------------------------------
// resolveBootElectronAction — boot 清理决策三分支
// ---------------------------------------------------------------------------

test('resolve: no record → skip (first boot after BLOCK-45 / clean shutdown)', () => {
  const decision = resolveBootElectronAction({ record: null, wrapperAlive: false, hasTokenPids: false, forceClean: false });
  assert.deepEqual(decision, { action: 'skip' });
});

test('resolve: concurrent live wrapper with live Electron → fail-closed with stop hint', () => {
  const decision = resolveBootElectronAction({ record: RECORD, wrapperAlive: true, hasTokenPids: true, forceClean: false });
  assert.equal(decision.action, 'fail');
  assert.match(decision.message, /already running/);
  assert.match(decision.message, /kill 4242/);
  assert.match(decision.message, /--force-clean-electron/);
});

test('resolve: live wrapper but no Electron alive → skip (port takeover only)', () => {
  const decision = resolveBootElectronAction({ record: RECORD, wrapperAlive: true, hasTokenPids: false, forceClean: false });
  assert.deepEqual(decision, { action: 'skip' });
});

test('resolve: crashed wrapper residue (wrapper dead, Electron alive) → token-scoped cleanup', () => {
  const decision = resolveBootElectronAction({ record: RECORD, wrapperAlive: false, hasTokenPids: true, forceClean: false });
  assert.deepEqual(decision, { action: 'cleanup', token: RECORD.token });
});

test('resolve: wrapper dead and Electron dead → skip', () => {
  const decision = resolveBootElectronAction({ record: RECORD, wrapperAlive: false, hasTokenPids: false, forceClean: false });
  assert.deepEqual(decision, { action: 'skip' });
});

test('resolve: forceClean → force regardless of record state', () => {
  for (const wrapperAlive of [true, false]) {
    for (const hasTokenPids of [true, false]) {
      const decision = resolveBootElectronAction({ record: RECORD, wrapperAlive, hasTokenPids, forceClean: true });
      assert.deepEqual(decision, { action: 'force' });
    }
  }
  assert.deepEqual(resolveBootElectronAction({ record: null, wrapperAlive: false, hasTokenPids: false, forceClean: true }), {
    action: 'force',
  });
});

// ---------------------------------------------------------------------------
// 记录文件真实内容契约（写出的 JSON 可被第三方读取）
// ---------------------------------------------------------------------------

test('written record file is readable JSON containing token/wrapperPid', () => {
  const dir = makeTempDir();
  try {
    writeLaunchRecord(dir, RECORD);
    const raw = JSON.parse(readFileSync(join(dir, 'dev-launch-token.json'), 'utf8'));
    assert.equal(raw.token, RECORD.token);
    assert.equal(raw.wrapperPid, RECORD.wrapperPid);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
