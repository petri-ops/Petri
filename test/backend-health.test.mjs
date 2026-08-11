// M1-1 后端就绪感知层测试
// 运行：cd desktop-app && node --test test/backend-health.test.mjs
import assert from 'node:assert/strict';
import {
  getBackendStatus,
  mergeRuntimeStatusWithConfiguredHomes,
} from '../src/backend-health.js';

// === 场景 0：开发态系统 Runtime 覆盖插件台账的“未安装”===
{
  const status = mergeRuntimeStatusWithConfiguredHomes(
    { r: { installed: false }, python: { installed: false } },
    { BIOF3_R_HOME: '/system/R', BIOF3_PY_HOME: '/system/Python' },
  );
  assert.strictEqual(status.r.installed, true, '已解析的系统 R 应视为可用 Runtime');
  assert.strictEqual(status.python.installed, true, '已解析的系统 Python 应视为可用 Runtime');
  console.log('✓ 场景0 开发态系统 Runtime 真相合并通过');
}

// === 场景 1：全就绪 ===
{
  const status = await getBackendStatus({
    runtimeStatus: { r: { installed: true }, python: { installed: true } },
    probeHealth: async () => true,
    probePy: async () => true,
    probePlumber: async () => true,
    procs: { rServer: { killed: false }, pyServer: { killed: false }, plumber: { killed: false } },
  });
  assert.strictEqual(status.rRuntime, true, 'rRuntime 应为 true');
  assert.strictEqual(status.pyRuntime, true, 'pyRuntime 应为 true');
  assert.strictEqual(status.rServerUp, true, 'rServerUp 应为 true');
  assert.strictEqual(status.pyServerUp, true, 'pyServerUp 应为 true');
  assert.strictEqual(status.plumberUp, true, 'plumberUp 应为 true');
  assert.strictEqual(status.isReady, true, 'isReady 应为 true');
  assert.strictEqual(status.downReason, null, 'downReason 应为 null');
  console.log('✓ 场景1 全就绪通过');
}

// === 场景 2：R 运行时未装 ===
{
  const status = await getBackendStatus({
    runtimeStatus: { r: { installed: false }, python: { installed: true } },
    probeHealth: async () => true,
    probePy: async () => true,
    procs: { rServer: null, pyServer: { killed: false }, plumber: null },
  });
  assert.strictEqual(status.rRuntime, false, 'rRuntime 应为 false');
  assert.strictEqual(status.rServerUp, false, 'rServerUp 应为 false');
  assert.strictEqual(status.isReady, false, 'isReady 应为 false');
  assert.ok(status.downReason, 'downReason 应非空');
  console.log('✓ 场景2 R 未装通过：', status.downReason);
}

// === 场景 3：R 装了但 r-server 未起（health 探测失败）===
{
  const status = await getBackendStatus({
    runtimeStatus: { r: { installed: true }, python: { installed: true } },
    probeHealth: async () => false,
    probePy: async () => true,
    procs: { rServer: { killed: false }, pyServer: { killed: false }, plumber: { killed: false } },
  });
  assert.strictEqual(status.rRuntime, true, 'rRuntime 应为 true');
  assert.strictEqual(status.rServerUp, false, 'rServerUp 应为 false（health 探测失败）');
  assert.strictEqual(status.isReady, false, 'isReady 应为 false');
  assert.ok(status.downReason, 'downReason 应非空');
  console.log('✓ 场景3 r-server 未起通过：', status.downReason);
}

// === 场景 4：r-server 进程已退出（killed=true）===
{
  const status = await getBackendStatus({
    runtimeStatus: { r: { installed: true }, python: { installed: true } },
    probeHealth: async () => true,
    probePy: async () => true,
    procs: { rServer: { killed: true }, pyServer: { killed: false }, plumber: { killed: false } },
  });
  assert.strictEqual(status.rServerUp, false, 'rServerUp 应为 false（进程 killed）');
  assert.strictEqual(status.isReady, false, 'isReady 应为 false');
  console.log('✓ 场景4 r-server killed 通过');
}

// === 场景 5：r-server 进程对象为 null（未 spawn）===
{
  const status = await getBackendStatus({
    runtimeStatus: { r: { installed: true }, python: { installed: false } },
    probeHealth: async () => true,
    probePy: async () => false,
    procs: { rServer: null, pyServer: null, plumber: null },
  });
  assert.strictEqual(status.rServerUp, false, 'rServerUp 应为 false（procs.rServer=null）');
  assert.strictEqual(status.isReady, false, 'isReady 应为 false');
  console.log('✓ 场景5 进程 null 通过');
}

// === 场景 6：py-server 不影响 isReady（按需起），plumber 同理 ===
{
  const status = await getBackendStatus({
    runtimeStatus: { r: { installed: true }, python: { installed: false } },
    probeHealth: async () => true,
    probePy: async () => false,
    procs: { rServer: { killed: false }, pyServer: null, plumber: null },
  });
  assert.strictEqual(status.rServerUp, true, 'rServerUp 应为 true');
  assert.strictEqual(status.pyServerUp, false, 'pyServerUp 应为 false');
  assert.strictEqual(status.plumberUp, false, 'plumberUp 应为 false');
  assert.strictEqual(status.isReady, true, 'isReady 应为 true（仅 r-server 是硬要求）');
  assert.strictEqual(status.downReason, null, 'downReason 应为 null');
  console.log('✓ 场景6 py/plumber 按需通过');
}

console.log('\n所有 backend-health 测试通过');
