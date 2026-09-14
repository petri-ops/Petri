import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const {
  buildSshArgs,
  normalizeTunnelConfig,
  readTunnelConfig,
  writeTunnelConfig,
  getTunnelManager,
  resetTunnelManagersForTest,
} = require(path.join(ROOT, 'core/biof3-server/mobile-gateway/tunnel.js'));

function tmpRoot() {
  return mkdtempSync(path.join(tmpdir(), 'gewu-tunnel-test-'));
}

/** 假 ssh 进程：EventEmitter + pid + kill()，供注入。 */
function fakeProcessFactory(spawned) {
  return function spawnFake() {
    const proc = new EventEmitter();
    proc.pid = 40000 + spawned.length + 1;
    spawned.push(proc);
    return proc;
  };
}

// ── 配置：默认关闭 / 校验 / 落盘 ────────────────────────────────────────

test('BLOCK-70 P3 tunnel config defaults and validation', () => {
  const root = tmpRoot();
  try {
    assert.deepEqual(readTunnelConfig(root), { enabled: false, host: '', remotePort: 2233, localPort: 3005, publicUrl: '', profiles: [] });
    const next = writeTunnelConfig(root, { enabled: true, host: 'aliyun', remotePort: 2210, publicUrl: 'https://112.120.48.126' });
    assert.equal(next.enabled, true);
    assert.equal(next.host, 'aliyun');
    assert.equal(next.remotePort, 2210);
    assert.equal(next.publicUrl, 'https://112.120.48.126');
    // 非法值被归一（不落盘崩溃）：坏 host 清空、坏端口回默认、非 https 公网地址丢弃
    const bad = writeTunnelConfig(root, { host: 'bad host;rm -rf', remotePort: 99999, publicUrl: 'http://evil.example' });
    assert.equal(bad.host, '', 'host with illegal chars must be rejected');
    assert.equal(bad.remotePort, 2233);
    assert.equal(bad.publicUrl, '', 'non-https publicUrl must be rejected');
    assert.equal(normalizeTunnelConfig({ host: 'a'.repeat(200) }).host, '', 'over-long host must be rejected');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ── ssh 参数契约：钉回环 / key-only / 转发失败即退 ───────────────────────

test('BLOCK-70 P3 ssh args pin the remote loopback and fail closed', () => {
  const args = buildSshArgs({ host: 'aliyun', remotePort: 2210, localPort: 3005 });
  assert.ok(args.includes('-N') && args.includes('-T'), 'no remote command, forwarding only');
  assert.ok(args.includes('BatchMode=yes'), 'key-only: password prompts must fail fast');
  assert.ok(args.includes('ExitOnForwardFailure=yes'), 'forward failure must kill the tunnel, not fake online');
  const reverse = args.find((arg) => arg.startsWith('127.0.0.1:'));
  assert.equal(reverse, '127.0.0.1:2210:127.0.0.1:3005', 'reverse forward must pin the remote loopback');
  assert.equal(args.at(-1), 'aliyun');
});

// ── 状态机：connecting → connected → exit → reconnecting（退避）→ stop ──

test('BLOCK-70 P3 tunnel state machine connects, reconnects with backoff, stops clean', async () => {
  const root = tmpRoot();
  resetTunnelManagersForTest();
  try {
    let clock = 1_000_000;
    const spawned = [];
    const spawnProcess = fakeProcessFactory(spawned);
    writeTunnelConfig(root, { enabled: true, host: 'aliyun', remotePort: 2210, localPort: 3005, publicUrl: 'https://112.120.48.126' });
    const manager = getTunnelManager(root, {
      now: () => clock,
      spawnProcess,
      killStale: () => [],
      backoffSteps: [10, 20],
      stableConnectedMs: 100,
    });

    // 启动即 connecting；存活过 stable 阈值 → connected
    assert.equal(manager.status().state, 'connecting');
    clock += 200;
    assert.equal(manager.status().state, 'connected');
    assert.equal(spawned.length, 1);

    // 进程退出 → reconnecting → 真实退避（10ms）后重拉
    spawned[0].emit('exit', 255);
    assert.equal(manager.status().state, 'reconnecting');
    await sleep(40);
    assert.ok(spawned.length >= 2, 'must respawn after the first backoff step');
    assert.equal(manager.status().state, 'connecting');

    // 再次存活 → connected（退避索引复位）
    clock += 200;
    assert.equal(manager.status().state, 'connected');

    // apply 停用 → disabled，且不复活
    manager.apply({ enabled: false });
    assert.equal(manager.status().state, 'disabled');
    const countAtStop = spawned.length;
    await sleep(40);
    assert.equal(spawned.length, countAtStop, 'disabled tunnel must not respawn');

    // 重新启用 → connecting → connected
    manager.apply({ enabled: true, host: 'aliyun' });
    clock += 200;
    assert.equal(manager.status().state, 'connected');
    manager.stop();
  } finally {
    resetTunnelManagersForTest();
    rmSync(root, { recursive: true, force: true });
  }
});

// ── admin REST 与 manager 共享单例（同 dataDir 同真值）──────────────────

test('BLOCK-70 P3 admin REST round-trips tunnel config through the shared manager', async () => {
  const root = tmpRoot();
  resetTunnelManagersForTest();
  try {
    let clock = 1_000_000;
    const spawned = [];
    // 先注入假 spawn 的 manager（admin 路由随后复用同一单例，不会拉真 ssh）
    const seeded = getTunnelManager(root, {
      now: () => clock,
      spawnProcess: fakeProcessFactory(spawned),
      killStale: () => [],
      backoffSteps: [10],
      stableConnectedMs: 50,
    });

    const express = require('express');
    const adminApp = express();
    // 不加 app 级 express.json：mobile-admin 的路由级中间件自带解析
    // （根目录与 core/biof3-server 各有一份 express 依赖时双重解析会报 stream not readable）。
    require(path.join(ROOT, 'core/biof3-server/routes/mobile-admin.js'))(adminApp, { dataDir: root });
    const server = await new Promise((resolve) => {
      const listening = adminApp.listen(0, '127.0.0.1', () => resolve(listening));
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    async function json(url, options) {
      const res = await fetch(url, options);
      return res.json();
    }

    const initial = await json(`${base}/api/mobile/tunnel`);
    assert.equal(initial.ok, true);
    assert.equal(initial.tunnel.state, 'disabled');

    const saved = await json(`${base}/api/mobile/tunnel/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true, host: 'aliyun', remotePort: 2210, publicUrl: 'https://112.120.48.126' }),
    });
    assert.equal(saved.ok, true);
    assert.equal(saved.tunnel.state, 'connecting');
    assert.ok(spawned.length >= 1, 'enabling must spawn the ssh tunnel');

    clock += 100;
    const connected = await json(`${base}/api/mobile/tunnel`);
    assert.equal(connected.tunnel.state, 'connected', 'seeded manager and admin must share one truth');

    // 主 status 也带隧道块（弹层一次拉全）
    const status = await json(`${base}/api/mobile/status`);
    assert.equal(status.tunnel.publicUrl, 'https://112.120.48.126');

    // 坏 host → 400
    const bad = await fetch(`${base}/api/mobile/tunnel/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true, host: 'bad host;rm' }),
    });
    assert.equal(bad.status, 400);

    seeded.stop();
    await new Promise((resolve) => server.close(resolve));
    server.closeAllConnections?.();
  } finally {
    resetTunnelManagersForTest();
    rmSync(root, { recursive: true, force: true });
  }
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}


// ── P3 清场纯函数：按签名挑孤儿、豁免在册孩子 ──────────────────────────
const { selectStaleSshPids } = require(path.join(ROOT, 'core/biof3-server/mobile-gateway/tunnel.js'));

test('BLOCK-70 P3 stale ssh selection matches signature exactly and honours exclusions', () => {
  const entries = [
    { pid: 100, commandline: 'ssh -N -R 127.0.0.1:2233:127.0.0.1:3005 aliyun' },
    { pid: 101, commandline: 'ssh -N -R 127.0.0.1:9999:127.0.0.1:3005 aliyun' },
    { pid: 102, commandline: 'ssh root@aliyun' },
    { pid: 103, commandline: 'ssh -N -R 127.0.0.1:22330:127.0.0.1:30050 aliyun' },
  ];
  assert.deepEqual(selectStaleSshPids(entries, '127.0.0.1:2233:127.0.0.1:3005'), [100],
    'only the exact tunnel signature is stale; prefix-similar and unrelated ssh must not match');
  assert.deepEqual(
    selectStaleSshPids(entries, '127.0.0.1:2233:127.0.0.1:3005', [100]), [],
    'excluded (current manager child) must never be selected');
  assert.deepEqual(selectStaleSshPids([], 'x'), []);
  assert.deepEqual(selectStaleSshPids([{ pid: 1 }, { pid: 2, commandline: 42 }], 'x'), []);
});
