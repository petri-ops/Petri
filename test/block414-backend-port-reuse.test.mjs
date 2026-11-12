/**
 * BLOCK-414 附带修复：dev 启动形态 3001 被自家 petri-server 占用时复用（不保留口 fallback）。
 * 红证据：修复前 selectBackendPorts 无 probe——3001 被占一律 fallback → preload 烤错
 * rApiBase（58422/58741）→ CSP 全拦渲染请求（2026-11-11 实测抓真）。
 */
import test from 'node:test';
import { strict as assert } from 'node:assert';
import { selectBackendPorts } from '../src/main/_backend-ports.js';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const reserve = async (preferred) => (preferred === 3001 ? 58741 : preferred + 1);

test('自家 petri-server 占 3001（health ok）→ 复用 3001', async () => {
  const probe = async (port) => port === 3001;
  const r = await selectBackendPorts({ reserveAvailablePort: reserve, isDevMode: true, healthProbe: probe });
  assert.equal(r.r, 3001);
  assert.equal(r.renderer, null);
});

test('外来进程占 3001（health 否）→ 保留口 fallback（58741）', async () => {
  const probe = async () => false;
  const r = await selectBackendPorts({ reserveAvailablePort: reserve, isDevMode: true, healthProbe: probe });
  assert.equal(r.r, 58741);
});

test('未传 healthProbe（旧调用方）→ 默认探针生效：真实 petri-server 在 3001 时复用', async () => {
  // 向后兼容：不传 healthProbe 时走内建默认探针（fetch /api/health）——
  // 本机 dev 栈正跑着自家 petri-server（health ok）→ 复用 3001
  const r = await selectBackendPorts({ reserveAvailablePort: reserve, isDevMode: true });
  assert.equal(r.r, 3001);
});

// ============================================================
// 事故门禁（2026-11-11 keychain 覆写事故——L1 stdin 单行 input 触发 security
// 双提示失配 → 静默存入空密码 → deepseek_configured:false）。转机械门禁：
// 修复后 stdin = 两行同值（password+retype），roundtrip 逐字一致才绿。
// ============================================================
import { createCredentialStore } from '../core/petri-server/helpers/credential-store.js';

test('事故门禁：keychain SET/GET 往返逐字一致（stdin 双行形态；探针账户用后即清）', () => {
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
