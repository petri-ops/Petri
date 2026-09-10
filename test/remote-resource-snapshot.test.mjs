// BLOCK-78 P2-① — 远程资源快照零网络定向测试。
// 锁三面契约：buildRemoteSnapshot 归一化（同构本地快照形状 + source/host 标注
// + 三态阈值）/ createRemoteSnapshotCache TTL 三态（fresh/stale/unreachable）/
// node-agent 脚本语法与 sys_resource verb 契约（bash -n + 读数单行 JSON）。
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { buildRemoteSnapshot, createRemoteSnapshotCache } = require('../core/biof3-server/helpers/remote-resource-snapshot.js');
const { BIOF3_AGENT_SH } = require('../core/biof3-server/helpers/remote-execution/node-agent.js');

const AGENT_INFO = {
  memTotalBytes: 16 * 1024 ** 3,
  memAvailableBytes: 8 * 1024 ** 3,
  load1m: 0.42,
  cores: 28,
  disk: { path: '/srv/proj', totalBytes: 200 * 1024 ** 3, availableBytes: 100 * 1024 ** 3, usePercent: 50 },
  hostname: 'dell',
};

test('buildRemoteSnapshot：归一化为同构快照并标注 remote 来源', () => {
  const now = new Date('2026-09-10T09:00:00Z');
  const s = buildRemoteSnapshot(AGENT_INFO, { alias: 'dell', now });
  assert.equal(s.source, 'remote');
  assert.equal(s.host, 'dell');
  assert.equal(s.state, 'ready');
  assert.equal(s.platform, 'linux (ssh:dell)');
  assert.equal(s.cpu.logicalCores, 28);
  assert.equal(s.cpu.load1m, 0.42);
  assert.equal(s.memory.totalBytes, 16 * 1024 ** 3);
  assert.equal(s.memory.availableBytes, 8 * 1024 ** 3);
  assert.equal(s.disk.usePercent, 50);
  assert.equal(s.observedAt, '2026-09-10T09:00:00.000Z');
  assert.ok(new Date(s.expiresAt) > now);
});

test('buildRemoteSnapshot：阈值三态（≥90 warning / ≥97 unavailable / 空读数 unavailable）', () => {
  const warn = buildRemoteSnapshot({ ...AGENT_INFO, disk: { ...AGENT_INFO.disk, usePercent: 91 } }, { alias: 'dell' });
  assert.equal(warn.state, 'warning');
  const down = buildRemoteSnapshot({ ...AGENT_INFO, disk: { ...AGENT_INFO.disk, usePercent: 98 } }, { alias: 'dell' });
  assert.equal(down.state, 'unavailable');
  const empty = buildRemoteSnapshot({}, { alias: 'dell' });
  assert.equal(empty.state, 'unavailable');
  assert.equal(empty.cpu.logicalCores, null);
});

test('createRemoteSnapshotCache：fresh 命中 / 超时转 stale / 无历史 unreachable', () => {
  let clock = 1000;
  const cache = createRemoteSnapshotCache({ ttlMs: 3000, now: () => clock });
  const snap = buildRemoteSnapshot(AGENT_INFO, { alias: 'dell' });

  cache.put('p1', snap);
  assert.equal(cache.getFresh('p1'), snap);

  clock += 3000;
  assert.equal(cache.getFresh('p1'), null, 'TTL 过期不再 fresh');
  assert.equal(cache.getStale('p1'), snap, '过期但保留 stale 读数');

  assert.equal(cache.getFresh('p_none'), null);
  assert.equal(cache.getStale('p_none'), null);
});

test('node-agent 脚本：bash -n 语法通过且包含 sys_resource verb 分发', () => {
  assert.match(BIOF3_AGENT_SH, /sys_resource\)/);
  assert.match(BIOF3_AGENT_SH, /fs_\*\|exec\|exec_bg\|ps_pid\|kill_pid\|sys_resource\|__mux\)/);
  const tmp = path.join(os.tmpdir(), `biof3-agent-test-${process.pid}.sh`);
  fs.writeFileSync(tmp, BIOF3_AGENT_SH, 'utf8');
  try {
    execFileSync('bash', ['-n', tmp]);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
});

test('node-agent sys_resource：bash 执行输出单行合法 JSON（本机 Linux/WSL 语义面）', () => {
  if (process.platform === 'win32') {
    // Windows 指挥席无 bash 时跳过执行面（dell/aliyun 节点为 Linux，由实机验收覆盖）。
    return;
  }
  const tmp = path.join(os.tmpdir(), `biof3-agent-run-${process.pid}.sh`);
  fs.writeFileSync(tmp, BIOF3_AGENT_SH, 'utf8');
  fs.chmodSync(tmp, 0o755);
  try {
    const out = execFileSync('bash', [tmp, 'sys_resource'], { encoding: 'utf8', timeout: 15000 });
    const line = out.trim().split('\n').filter(Boolean).pop();
    const info = JSON.parse(line);
    assert.ok(info.memTotalBytes > 0);
    assert.ok(info.memAvailableBytes >= 0);
    assert.ok(info.cores >= 1);
    assert.equal(typeof info.hostname, 'string');
    assert.ok(info.disk && info.disk.totalBytes >= 0);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
});
