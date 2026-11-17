/**
 * BLOCK-414 → BLOCK-457 契约演进（拆前基线拆后对账）。
 *
 * BLOCK-414（2026-11-11）：dev 启动形态 3001 被自家 petri-server 占用时复用端口
 * （不保留口 fallback）——红证据=修复前 preload 烤错 rApiBase → CSP 全拦渲染请求。
 * BLOCK-457（2026-11-17）：复用语义从「复用端口号仍 spawn 第二进程」根治为「身份
 * 探活 attach（同 dataDir）/ fallback spawn（异源）」。本文件按新契约对账，原三种
 * 场景语义逐条保留（旧 healthProbe 形状 → 新 probeIdentity + attachExisting）。
 *
 * 事故门禁（2026-11-11 keychain 覆写事故）原样保留在本文件尾。
 */
import test from 'node:test';
import { strict as assert } from 'node:assert';
import http from 'node:http';
import { selectBackendPorts } from '../src/main/_backend-ports.js';
import { probeBackendIdentity } from '../src/main/backend-ownership.js';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const reserve = async (preferred) => (preferred === 3001 ? 58741 : preferred + 1);
const OWN = '/tmp/petri-own-data';

test('自家同源 petri-server 占 3001（dataDir 相同）→ attachExisting=true 复用 3001', async () => {
  const probeIdentity = async () => ({ petri: true, dataDir: OWN, instanceId: 'i1', pid: 1 });
  const r = await selectBackendPorts({ reserveAvailablePort: reserve, isDevMode: true, ownDataDir: OWN, probeIdentity });
  assert.equal(r.r, 3001);
  assert.equal(r.renderer, null);
  assert.equal(r.attachExisting, true, 'BLOCK-457：同源必须 attach，不再 spawn 第二进程');
});

test('外来进程占 3001（health 不可达）→ 保留口 fallback（58741）+ 不 attach', async () => {
  const probeIdentity = async () => null;
  const r = await selectBackendPorts({ reserveAvailablePort: reserve, isDevMode: true, ownDataDir: OWN, probeIdentity });
  assert.equal(r.r, 58741);
  assert.equal(r.attachExisting, false);
});

test('旧版后端占 3001（health 无 dataDir 字段）→ 不误 attach，fallback spawn', async () => {
  const probeIdentity = async () => ({ petri: true, db_ok: true, instanceId: null, dataDir: null });
  const r = await selectBackendPorts({ reserveAvailablePort: reserve, isDevMode: true, ownDataDir: OWN, probeIdentity });
  assert.equal(r.r, 58741);
  assert.equal(r.attachExisting, false, '身份无法核实（旧版）绝不认领——宁 spawn 不脑裂');
});

test('默认探针 probeBackendIdentity：对形状不符的服务返回 null，对 petri health 返回身份', async () => {
  // 形状不符（非 petri JSON）
  const foreign = http.createServer((_q, s) => { s.setHeader('content-type', 'application/json'); s.end(JSON.stringify({ hello: 'world' })); });
  await new Promise((r) => foreign.listen(0, '127.0.0.1', r));
  const foreignPort = foreign.address().port;
  try {
    assert.equal(await probeBackendIdentity(foreignPort, 1500), null, '非 petri 服务 → null');
  } finally { foreign.close(); }

  // petri 形状（含身份字段）
  const petri = http.createServer((_q, s) => {
    s.setHeader('content-type', 'application/json');
    s.end(JSON.stringify({ status: 'ok', db_ok: true, instanceId: 'inst-x', pid: 42, dataDir: OWN }));
  });
  await new Promise((r) => petri.listen(0, '127.0.0.1', r));
  const petriPort = petri.address().port;
  try {
    const id = await probeBackendIdentity(petriPort, 1500);
    assert.notEqual(id, null);
    assert.equal(id.petri, true);
    assert.equal(id.dataDir, OWN);
    assert.equal(id.pid, 42);
  } finally { petri.close(); }

  // 不可达端口
  assert.equal(await probeBackendIdentity(1, 600), null, '不可达 → null');
});

// ============================================================
// 事故门禁（2026-11-11 keychain 覆写事故——L1 stdin 单行 input 触发 security
// 双提示失配 → 静默存入空密码 → deepseek_configured:false）。转机械门禁：
// 修复后 stdin = 两行同值（password+retype），roundtrip 逐字一致才绿。
// ============================================================
import { createCredentialStore } from '../core/petri-server/helpers/credential-store.js';

// 平台护栏：该门禁探针依赖 macOS /usr/bin/security，非 darwin 平台显式跳过
// （诚实 skip，不冒充绿；macOS 上照常生效）。2026-11-17 BLOCK-457 在 Windows 机
// 上跑 test:changed 时抓到该既有红，归属=平台前提非产品缺陷。
const keychainSkip = process.platform !== 'darwin'
  ? 'macOS Keychain 门禁（/usr/bin/security 探针），非 darwin 平台跳过'
  : false;

test({ skip: keychainSkip }, '事故门禁：keychain SET/GET 往返逐字一致（stdin 双行形态；探针账户用后即清）', () => {
  const store = createCredentialStore({
    settingsDir: os.homedir() + '/Documents/Petri-Local',
    backend: 'keychain',
  });
  const probe = 'block414-incident-gate';
  try {
    store.set(probe, 'gate-secret-42');
    const back = store.get(probe);
    assert.equal(back, 'gate-secret-42', '往返失配——stdin 写入形态回归');
    assert.equal(back.trim(), back, ' stored 值含空白污染（换行残留）');
  } finally {
    try {
      execFileSync('/usr/bin/security', [
        'delete-generic-password', '-a', probe, '-s', 'com.petri.desktop.ai',
      ], { stdio: 'ignore' });
    } catch { /* 探针不在场=无残留 */ }
  }
});
