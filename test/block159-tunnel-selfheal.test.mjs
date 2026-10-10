'use strict';

/**
 * BLOCK-159 P0-2/P0-5 — 隧道探活自愈与重连链降本契约。
 *
 * 诊断（plan §1）：probe fail 此前只记证据不自愈（半开隧道挂到 ServerAlive
 * 判死为止）；重连清场链串行（15-35s 固有开销）；退避无抖动（多端同步重连）。
 *
 * 契约：
 *  ① 探活连续 2 次 fail → 自愈重连（杀 tracked + 退避后新 spawn）；单次 fail
 *     不触发；ok 清零连败计数。
 *  ② ServerAliveInterval=10（判死窗口 45s→30s）；jitteredDelay ±30% 有界。
 *  ③ 清场并行：killStale 与 remotePortSweep 并发启动（顺序串行下本测试死锁
 *     ——killStale 等 sweep 启动信号，并行性成为唯一放行路径）；两者都完成才
 *     spawn（清场完成前绝不 spawn 不变量保持）。
 *  ④ exit 事件不覆盖已排程的重连 timer（自愈路径已接管时 exit 不双排程，
 *     spawn 计数恰好 +1）。
 */

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TUNNEL_PATH = path.join(ROOT, 'core/petri-server/mobile-gateway/tunnel.js');

const {
  createTunnelManager,
  writeTunnelConfig,
  buildSshArgs,
  jitteredDelay,
  PROBE_FAIL_RECONNECT_THRESHOLD,
  BACKOFF_JITTER_RATIO,
} = require(TUNNEL_PATH);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`waitFor timeout (${timeoutMs}ms)`);
    await sleep(5);
  }
}

/** 可杀假进程：kill() 异步 emit exit（镜像真实 async 语义）。 */
function makeKillableProc(pid, spawned) {
  const proc = new EventEmitter();
  proc.pid = pid;
  proc.kill = () => {
    queueMicrotask(() => proc.emit('exit', 143));
  };
  spawned.push(proc);
  return proc;
}

const PUBLIC_URL = 'https://gw.example.com';

function buildSelfhealManager(root, { probeFetch, probeIntervalMs = 5, backoffSteps = [20] } = {}) {
  writeTunnelConfig(root, { enabled: true, host: 'aliyun', remotePort: 2299, localPort: 3005, publicUrl: PUBLIC_URL });
  const spawned = [];
  const manager = createTunnelManager({
    dataDir: root,
    now: () => 1_000_000,
    spawnProcess() {
      return makeKillableProc(61000 + spawned.length, spawned);
    },
    killStale: async () => [],
    remoteSweep: async () => {},
    stableConnectedMs: 0,
    backoffSteps,
    probeIntervalMs,
    probeTimeoutMs: 400,
    probeFetch,
  });
  return { manager, spawned };
}

function probeResponse(status) {
  return async () => ({ status, arrayBuffer: async () => new ArrayBuffer(0) });
}

// ── ① 连败自愈 ───────────────────────────────────────────────────────────

test('BLOCK-159 ① 探活连续 2 次 fail → 自愈重连（新 spawn）；单次 fail 不触发；ok 清零', async () => {
  assert.equal(PROBE_FAIL_RECONNECT_THRESHOLD, 2, '阈值钉住：2（单次抖动给复测机会）');
  const root = mkdtempSync(path.join(tmpdir(), 'petri-tunnel-selfheal-'));
  let manager = null;
  try {
    // a. 连续 fail ×2 → 自愈：spawn 计数涨到 2
    {
      const { manager: m, spawned } = buildSelfhealManager(root, { probeFetch: probeResponse(502) });
      manager = m;
      await sleep(10); // boot 链（清场→spawn #1）
      manager.status(); // 晋升 connected + 起探活链
      await waitFor(() => spawned.length >= 2, 2000);
      assert.equal(spawned.length, 2, `连续 fail 达阈值必须自愈重连（实际 ${spawned.length}）`);
      manager.stop();
    }
    // b. 单次 fail 后恢复 ok：不触发重连，连败计数清零
    {
      let calls = 0;
      const fetchOnceFail = async () => {
        calls += 1;
        return calls === 1 ? { status: 502, arrayBuffer: async () => new ArrayBuffer(0) } : { status: 401, arrayBuffer: async () => new ArrayBuffer(0) };
      };
      const { manager: m, spawned } = buildSelfhealManager(root, { probeFetch: fetchOnceFail });
      manager = m;
      await sleep(10);
      manager.status();
      await waitFor(() => calls >= 3, 2000); // 跑满 ≥3 轮
      await sleep(30); // 给任何误触发的重连链留窗口
      assert.equal(spawned.length, 1, '单次 fail 不触发自愈');
      assert.equal(manager.status().state, 'connected', '恢复 ok 后保持 connected');
      manager.stop();
    }
  } finally {
    try { if (manager) manager.stop(); } catch { /* noop */ }
    rmSync(root, { recursive: true, force: true });
  }
});

// ── ② ServerAlive 收紧 + 抖动有界 ────────────────────────────────────────

test('BLOCK-159 ② buildSshArgs ServerAlive 15→10；jitteredDelay ±30% 有界且下限 250ms', () => {
  const args = buildSshArgs({ remotePort: 2233, localPort: 3005, host: 'aliyun' });
  const i = args.indexOf('ServerAliveInterval=10');
  assert.ok(i > 0, 'ServerAliveInterval=10（判死窗口 45s→30s）');
  assert.ok(args.includes('ServerAliveCountMax=3'), 'CountMax=3 保持');
  assert.ok(!args.includes('ServerAliveInterval=15'), '旧 15s 档退役');

  assert.equal(jitteredDelay(1000, () => 0.5), 1000, 'rng=0.5 → 无抖动');
  assert.equal(jitteredDelay(1000, () => 0), 700, 'rng=0 → -30%');
  assert.equal(jitteredDelay(1000, () => 1), 1300, 'rng=1 → +30%');
  assert.equal(jitteredDelay(1, () => 0), 1, '下限 1ms 防归零（注入测试小档退避语义不变）');
  assert.equal(BACKOFF_JITTER_RATIO, 0.3, '抖动比例钉住');
});

// ── ③ 清场并行（顺序串行下本用例死锁=红）─────────────────────────────────

test('BLOCK-159 ③ 清场链并行：killStale 与 remotePortSweep 并发启动，都完成才 spawn', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'petri-tunnel-parallel-'));
  let manager = null;
  try {
    writeTunnelConfig(root, { enabled: true, host: 'aliyun', remotePort: 2299, localPort: 3005 });
    const spawned = [];
    let sweepStarted = false;
    const sweepOrder = [];
    const manager2 = createTunnelManager({
      dataDir: root,
      now: () => 1_000_000,
      spawnProcess() { return makeKillableProc(62000 + spawned.length, spawned); },
      // 顺序串行下本用例死锁：killStale 等 sweep 启动信号才放行——并行是唯一通过路径
      killStale: async () => {
        sweepOrder.push('killStale-wait');
        while (!sweepStarted) await sleep(2);
        sweepOrder.push('killStale-done');
        return [];
      },
      remoteSweep: async () => {
        sweepOrder.push('sweep-start');
        sweepStarted = true;
      },
      backoffSteps: [20],
    });
    manager = manager2;
    await waitFor(() => spawned.length >= 1, 2000);
    assert.ok(sweepStarted, 'remotePortSweep 必须已启动（并行证据）');
    assert.ok(sweepOrder.includes('killStale-done'), 'killStale 完成');
    assert.equal(spawned.length, 1, '两者都完成后恰好 spawn 一次（清场完成前绝不 spawn）');
  } finally {
    try { if (manager) manager.stop(); } catch { /* noop */ }
    rmSync(root, { recursive: true, force: true });
  }
});

// ── ④ exit 不覆盖已排程重连 ──────────────────────────────────────────────

test('BLOCK-159 ④ 自愈重连排程后 exit 事件不双排程（spawn 恰好 +1）', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'petri-tunnel-exitguard-'));
  let manager = null;
  try {
    const { manager: m, spawned } = buildSelfhealManager(root, { probeFetch: probeResponse(502) });
    manager = m;
    await sleep(10);
    manager.status(); // connected + probe
    await waitFor(() => spawned.length >= 2, 2000); // 自愈触发
    await sleep(120); // 重连链与任何迟到 exit 全部落地
    assert.equal(spawned.length, 2, `exit 事件不得叠加排程（实际 ${spawned.length}）`);
    assert.equal(manager.status().state, 'connected', '重连后恢复 connected');
  } finally {
    try { if (manager) manager.stop(); } catch { /* noop */ }
    rmSync(root, { recursive: true, force: true });
  }
});
