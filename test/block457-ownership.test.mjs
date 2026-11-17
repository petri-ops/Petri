/**
 * BLOCK-457 P1 — 后端所有权决策契约（HK-01 红绿先行）。
 *
 * 缺陷史：BLOCK-414 探到「3001 是自家 petri-server」后只复用端口号、仍 spawn 第二
 * 进程 → EADDRINUSE 30s 崩溃循环（2026-11-17 实机 749 次）。契约：selectBackendPorts
 * 升级为身份判定——同 dataDir 一律 attachExisting（复用 BLOCK-100 attach 桩，不 spawn）；
 * 异源/不可达照旧端口选择，绝不因身份存疑而误 attach。
 */
import test from 'node:test';
import { strict as assert } from 'node:assert';
import { selectBackendPorts } from '../src/main/_backend-ports.js';

const OWN = '/tmp/data-own';
const OTHER = '/tmp/data-other';

/** reserve 可配置：3001 空闲 or 被占（fallback 到 58422）。 */
const makeReserve = (port3001Free) => async (preferred) => {
  if (preferred === 3001 && port3001Free) return 3001;
  return preferred === 3001 ? 58422 : preferred + 1;
};

test('3001 空闲 → spawn on 3001，探针不被调用', async () => {
  let probeCalls = 0;
  const r = await selectBackendPorts({
    reserveAvailablePort: makeReserve(true),
    isDevMode: true,
    ownDataDir: OWN,
    probeIdentity: async () => { probeCalls += 1; return { petri: true, dataDir: OWN }; },
  });
  assert.deepEqual({ r: r.r, attachExisting: r.attachExisting }, { r: 3001, attachExisting: false });
  assert.equal(probeCalls, 0, '端口空闲时无需探活');
});

test('3001 被同源 petri-server 占用（dataDir 相同）→ attachExisting=true 复用 3001', async () => {
  const r = await selectBackendPorts({
    reserveAvailablePort: makeReserve(false),
    isDevMode: true,
    ownDataDir: OWN,
    probeIdentity: async () => ({ petri: true, dataDir: OWN, instanceId: 'inst-a', pid: 111 }),
  });
  assert.equal(r.r, 3001);
  assert.equal(r.attachExisting, true, '同源后端必须 attach（不得再 spawn）');
});

test('3001 被异源 petri-server 占用（dataDir 不同）→ fallback 端口 spawn', async () => {
  const r = await selectBackendPorts({
    reserveAvailablePort: makeReserve(false),
    isDevMode: true,
    ownDataDir: OWN,
    probeIdentity: async () => ({ petri: true, dataDir: OTHER, instanceId: 'inst-b', pid: 222 }),
  });
  assert.deepEqual({ r: r.r, attachExisting: r.attachExisting }, { r: 58422, attachExisting: false },
    '跨 dataDir 绝不 attach（脑裂红线）');
});

test('3001 被旧版后端占用（无 dataDir 字段）→ 不 attach，fallback spawn', async () => {
  const r = await selectBackendPorts({
    reserveAvailablePort: makeReserve(false),
    isDevMode: true,
    ownDataDir: OWN,
    probeIdentity: async () => ({ petri: true, instanceId: 'legacy' }),
  });
  assert.equal(r.attachExisting, false, '身份无法核实（旧版缺 dataDir）不得 attach');
  assert.equal(r.r, 58422);
});

test('3001 被非 petri 进程占用（探针 null）→ fallback 端口 spawn', async () => {
  const r = await selectBackendPorts({
    reserveAvailablePort: makeReserve(false),
    isDevMode: true,
    ownDataDir: OWN,
    probeIdentity: async () => null,
  });
  assert.deepEqual({ r: r.r, attachExisting: r.attachExisting }, { r: 58422, attachExisting: false });
});

test('ownDataDir 未设（异常环境）→ 任何在场者都不 attach（宁 spawn 不误认领）', async () => {
  const r = await selectBackendPorts({
    reserveAvailablePort: makeReserve(false),
    isDevMode: true,
    ownDataDir: undefined,
    probeIdentity: async () => ({ petri: true, dataDir: '/tmp/data-own' }),
  });
  assert.equal(r.attachExisting, false);
});
