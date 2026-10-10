import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * BLOCK-152 T — tunnel publicUrl 周期自探活（红绿先行；BLOCK-149 #468 留的方向）。
 *
 * 契约：
 *  ① connected 态下周期 GET <publicUrl>/api/mobile/status（默认 60s 间隔、5s
 *     AbortController 超时）：401（网关会话门活，mobile-gateway/index.js D4 门）
 *     = 端到端通 → probeState 'ok'；非 401 / 超时 / 网络错 = 'fail'。
 *     probeState / probedAt 进 status()（'unknown' | 'ok' | 'fail'，初始无结论）。
 *  ② 调度不叠加：完成后再排下一轮的串行链 + 在途守卫，任一时刻至多一个在途
 *     probe；stop()/apply() 撤销调度；断连即作废旧证据、在途陈旧结论不回写
 *     （probe 只读公网门，不 spawn 不 kill 不碰端口——与 killStale / remotePortSweep
 *     异步清场链互不踩，plan §6 T 轨风险项）。
 *  ③ probe 计时器 unref：不吊住 event loop、不进冷启动关键路径
 *     （connecting 期零探活；未配 publicUrl 不起探活链）。
 */

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TUNNEL_PATH = path.join(ROOT, 'core/petri-server/mobile-gateway/tunnel.js');

const { createTunnelManager, writeTunnelConfig } = require(TUNNEL_PATH);

const PUBLIC_URL = 'https://gw.example.com';

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

/** 记录型假 fetch：calls 收 {url, init}；可配状态码/延迟/hang（永不 resolve，供超时用例）。 */
function recordingFetch({ status = 401, delayMs = 0, hang = false } = {}) {
  const calls = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const fetch = (url, init) => {
    calls.push({ url: String(url), init });
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        inFlight -= 1;
        if (hang) return; // 永不 resolve；abort 信号到时经下方监听 reject
        resolve({ status, arrayBuffer: async () => new ArrayBuffer(0) });
      }, delayMs);
      init?.signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        inFlight -= 1;
        reject(new Error('The operation was aborted'));
      });
    });
  };
  return { fetch, calls, inFlightCount: () => inFlight, maxInFlightCount: () => maxInFlight };
}

/**
 * enabled + publicUrl 的 manager（假进程/假清场，绝不拉真 ssh；假钟恒 1_000_000）。
 * 调用方负责：boot 链落地（await sleep(10)）→ status() 推进 → try/finally stop+rm。
 */
function buildProbeManager(root, {
  probeFetch,
  probeIntervalMs = 15,
  probeTimeoutMs = 400,
  stableConnectedMs = 0,
  backoffSteps = [60_000],
  publicUrl = PUBLIC_URL,
} = {}) {
  writeTunnelConfig(root, { enabled: true, host: 'aliyun', remotePort: 2299, localPort: 3005, publicUrl });
  const spawned = [];
  const manager = createTunnelManager({
    dataDir: root,
    now: () => 1_000_000,
    spawnProcess() {
      const proc = new EventEmitter();
      proc.pid = 51000 + spawned.length;
      spawned.push(proc);
      return proc;
    },
    killStale: async () => [],
    remoteSweep: async () => {},
    stableConnectedMs,
    backoffSteps,
    probeIntervalMs,
    probeTimeoutMs,
    probeFetch,
  });
  return { manager, spawned };
}

// ── ① 三态：401=ok / 非 401=fail / 超时=fail ─────────────────────────────

test('BLOCK-152 T① probe 三态：401=ok、非 401=fail、超时=fail（probeState/probedAt 进 status()）', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'petri-tunnel-probe-tri-'));
  const cleanups = [];
  async function outcome({ fetchOptions, expect, label, probeTimeoutMs = 400 }) {
    const fake = recordingFetch(fetchOptions);
    const { manager } = buildProbeManager(root, { probeFetch: fake.fetch, probeTimeoutMs });
    cleanups.push(() => { try { manager.stop(); } catch { /* noop */ } });
    await sleep(10); // boot 链（killStale→sweep→spawn 假件）落地
    manager.status(); // 晋升 connected + 排首轮 probe
    assert.equal(manager.status().state, 'connected', `${label}: 前置——已进 connected`);
    await waitFor(() => manager.status().probeState === expect, 2000);
    const st = manager.status();
    assert.equal(st.probeState, expect, label);
    assert.equal(st.probedAt, 1_000_000, `${label}: probedAt 必须带（假钟）`);
    assert.ok(fake.calls.length >= 1, `${label}: 必须真实发起过 probe`);
    const call = fake.calls[0];
    assert.equal(call.url, `${PUBLIC_URL}/api/mobile/status`, `${label}: 探活地址`);
    assert.equal(call.init.method, 'GET', `${label}: 探活动词`);
    assert.ok(call.init.signal instanceof AbortSignal, `${label}: 必须带 AbortController 信号`);
    return { fake, manager };
  }
  try {
    await outcome({ fetchOptions: { status: 401 }, expect: 'ok', label: '401（网关会话门）= 端到端活' });
    await outcome({ fetchOptions: { status: 200 }, expect: 'fail', label: '200（公网门后挂了别的东西）= fail' });
    await outcome({ fetchOptions: { status: 502 }, expect: 'fail', label: '502（反代坏）= fail' });
    const timeoutCase = await outcome({
      fetchOptions: { hang: true },
      expect: 'fail',
      label: '5s 级超时（AbortController 放大到 60ms）= fail',
      probeTimeoutMs: 60,
    });
    assert.equal(timeoutCase.fake.calls[0].init.signal.aborted, true, '超时必须经 AbortController 中止');
  } finally {
    for (const fn of cleanups.reverse()) fn();
    rmSync(root, { recursive: true, force: true });
  }
});

// ── ② 调度不叠加：串行链 + stop 撤销 ─────────────────────────────────────

test('BLOCK-152 T② 调度不叠加：probe 慢于间隔也绝不并发；stop 后在途收尾、绝无新调用', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'petri-tunnel-probe-stack-'));
  let manager = null;
  try {
    const fake = recordingFetch({ status: 401, delayMs: 25 }); // 单轮 25ms > 间隔 15ms
    ({ manager } = buildProbeManager(root, { probeFetch: fake.fetch, probeIntervalMs: 15 }));
    await sleep(10);
    manager.status(); // 晋升 + 首轮
    await waitFor(() => fake.calls.length >= 4, 3000); // 已跑 ≥4 轮
    assert.equal(
      fake.maxInFlightCount(),
      1,
      '串行链：probe 单轮耗时超过调度间隔时，任一时刻仍至多一个在途（完成后再排下一轮）'
    );
    await waitFor(() => fake.inFlightCount() === 1, 2000); // 捕一个在途 probe
    manager.stop();
    const atStop = fake.calls.length;
    await sleep(90); // > 单轮 25ms + 间隔 15ms：任何泄漏的调度都会新增调用
    assert.equal(fake.calls.length, atStop, 'stop 后：在途 probe 自然收尾，但绝不排新（含在途完成的再调度）');
  } finally {
    try { if (manager) manager.stop(); } catch { /* noop */ }
    rmSync(root, { recursive: true, force: true });
  }
});

// ── ③ 关键路径：connecting 期零探活；初始 unknown；未配 publicUrl 不探 ──

test('BLOCK-152 T③ 冷启动零探活：connecting 期零调用、初始 unknown；未配 publicUrl 不起探活链', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'petri-tunnel-probe-idle-'));
  let manager = null;
  let managerNoUrl = null;
  try {
    // ① stableConnectedMs 拉满：永不晋升 → connecting 期零探活
    const fake = recordingFetch({ status: 401 });
    ({ manager } = buildProbeManager(root, {
      probeFetch: fake.fetch,
      probeIntervalMs: 15,
      stableConnectedMs: 60_000,
    }));
    await sleep(60); // ≥4 个调度间隔
    assert.equal(fake.calls.length, 0, 'connecting 态不得发起探活（probe 不进冷启动关键路径）');
    const st = manager.status();
    assert.equal(st.state, 'connecting');
    assert.equal(st.probeState, 'unknown', 'status() 必须带 probeState（初始无结论）');
    assert.equal(st.probedAt, null, 'status() 必须带 probedAt（初始 null）');

    // ② 已 connected 但没配 publicUrl：没有可探的门，探活链不启动
    const fakeNoUrl = recordingFetch({ status: 401 });
    ({ manager: managerNoUrl } = buildProbeManager(root, { probeFetch: fakeNoUrl.fetch, publicUrl: '' }));
    await sleep(10);
    managerNoUrl.status(); // 晋升 connected
    assert.equal(managerNoUrl.status().state, 'connected');
    await sleep(60);
    assert.equal(fakeNoUrl.calls.length, 0, '未配 publicUrl 不得发起探活');
    assert.equal(managerNoUrl.status().probeState, 'unknown');
  } finally {
    try { if (manager) manager.stop(); } catch { /* noop */ }
    try { if (managerNoUrl) managerNoUrl.stop(); } catch { /* noop */ }
    rmSync(root, { recursive: true, force: true });
  }
});

// ── ③ 计时器 unref：不吊住 event loop ────────────────────────────────────

test('BLOCK-152 T③ probe 计时器 unref：不吊住 event loop（进程可自然退出）', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'petri-tunnel-probe-unref-'));
  let manager = null;
  try {
    const fake = recordingFetch({ status: 401 });
    ({ manager } = buildProbeManager(root, { probeFetch: fake.fetch, probeIntervalMs: 15 }));
    await sleep(10); // boot 链先落地（在 spy 窗之外）
    const originalSetTimeout = globalThis.setTimeout;
    const handles = [];
    globalThis.setTimeout = function spiedSetTimeout(fn, ms, ...rest) {
      const handle = originalSetTimeout(fn, ms, ...rest);
      handles.push(handle);
      return handle;
    };
    try {
      manager.status(); // 晋升 connected + 排首轮 probe——本同步窗内唯一的新计时器
      assert.equal(handles.length, 1, '晋升即排首轮 probe（同步窗内恰一个新计时器）');
      assert.equal(typeof handles[0].hasRef, 'function', 'node Timeout 必须具备 hasRef');
      assert.equal(handles[0].hasRef(), false, 'probe 计时器必须 unref——不吊住 event loop、不进关键路径');
    } finally {
      globalThis.setTimeout = originalSetTimeout;
    }
  } finally {
    try { if (manager) manager.stop(); } catch { /* noop */ }
    rmSync(root, { recursive: true, force: true });
  }
});

// ── ② 断连即作废证据：exit 复位 unknown；在途陈旧结论不回写 ─────────────

test('BLOCK-152 T② 断连即作废探活证据：exit 复位 unknown；在途 probe 的陈旧结论不回写', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'petri-tunnel-probe-stale-'));
  let managerA = null;
  let managerB = null;
  try {
    // A. 已落盘的 ok 证据：ssh 退出 → 证据立即作废
    {
      const fake = recordingFetch({ status: 401 });
      let spawnedA = [];
      ({ manager: managerA, spawned: spawnedA } = buildProbeManager(root, { probeFetch: fake.fetch }));
      await sleep(10);
      managerA.status(); // 晋升
      await waitFor(() => managerA.status().probeState === 'ok', 2000);
      spawnedA[0].emit('exit', 255);
      const st = managerA.status();
      assert.equal(st.state, 'reconnecting');
      assert.equal(st.probeState, 'unknown', '断连即作废旧探活证据（证据只属于上一条转发）');
      assert.equal(st.probedAt, null);
    }
    // B. probe 在途期间断连：迟到的 401 绝不回写成 ok
    {
      const fake = recordingFetch({ status: 401, delayMs: 40 });
      let spawnedB = [];
      ({ manager: managerB, spawned: spawnedB } = buildProbeManager(root, { probeFetch: fake.fetch }));
      await sleep(10);
      managerB.status(); // 晋升 + 首轮（15ms 后发出）
      await waitFor(() => fake.inFlightCount() === 1, 2000); // probe 在途
      spawnedB[0].emit('exit', 255);
      assert.equal(managerB.status().state, 'reconnecting');
      assert.equal(managerB.status().probeState, 'unknown', '断连同步复位');
      await sleep(90); // 陈旧 401 迟到落回
      assert.equal(managerB.status().probeState, 'unknown', '在途陈旧结论绝不回写');
      assert.equal(managerB.status().probedAt, null);
    }
  } finally {
    try { if (managerA) managerA.stop(); } catch { /* noop */ }
    try { if (managerB) managerB.stop(); } catch { /* noop */ }
    rmSync(root, { recursive: true, force: true });
  }
});
