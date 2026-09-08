// M1-1 后端就绪感知层测试
// 运行：cd desktop-app && node --test test/backend-health.test.mjs
// BLOCK-30 P1: py-server HTTP 服务已摘除——probePy/pyServerUp 场景删除，
// pyRuntime 仅反映运行时安装态（Python 工具由 biof3-server 本地执行）。
// BLOCK-51 P3: plumber 空壳已摘除——probePlumber/plumberUp 场景删除，
// isReady 仅由 rServerUp 决定。
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
    procs: { rServer: { killed: false } },
  });
  assert.strictEqual(status.rRuntime, true, 'rRuntime 应为 true');
  assert.strictEqual(status.pyRuntime, true, 'pyRuntime 应为 true');
  assert.strictEqual(status.rServerUp, true, 'rServerUp 应为 true');
  assert.strictEqual(status.isReady, true, 'isReady 应为 true');
  assert.strictEqual(status.downReason, null, 'downReason 应为 null');
  assert.strictEqual('pyServerUp' in status, false, 'pyServerUp 字段应已随 BLOCK-30 P1 移除');
  assert.strictEqual('plumberUp' in status, false, 'plumberUp 字段应已随 BLOCK-51 P3 移除');
  console.log('✓ 场景1 全就绪通过');
}

// === 场景 2：R 运行时未装 ===
{
  const status = await getBackendStatus({
    runtimeStatus: { r: { installed: false }, python: { installed: true } },
    probeHealth: async () => true,
    procs: { rServer: null },
  });
  assert.strictEqual(status.rRuntime, false, 'rRuntime 应为 false');
  assert.strictEqual(status.rServerUp, false, 'rServerUp 应为 false');
  assert.strictEqual(status.isReady, false, 'isReady 应为 false');
  assert.ok(status.downReason, 'downReason 应非空');
  console.log('✓ 场景2 R 未装通过：', status.downReason);
}

// === 场景 3：R 装了但 biof3-server 未起（health 探测失败）===
{
  const status = await getBackendStatus({
    runtimeStatus: { r: { installed: true }, python: { installed: true } },
    probeHealth: async () => false,
    procs: { rServer: { killed: false } },
  });
  assert.strictEqual(status.rRuntime, true, 'rRuntime 应为 true');
  assert.strictEqual(status.rServerUp, false, 'rServerUp 应为 false（health 探测失败）');
  assert.strictEqual(status.isReady, false, 'isReady 应为 false');
  assert.ok(status.downReason, 'downReason 应非空');
  console.log('✓ 场景3 biof3-server 未起通过：', status.downReason);
}

// === 场景 4：biof3-server 进程已退出（killed=true）===
{
  const status = await getBackendStatus({
    runtimeStatus: { r: { installed: true }, python: { installed: true } },
    probeHealth: async () => true,
    procs: { rServer: { killed: true } },
  });
  assert.strictEqual(status.rServerUp, false, 'rServerUp 应为 false（进程 killed）');
  assert.strictEqual(status.isReady, false, 'isReady 应为 false');
  console.log('✓ 场景4 biof3-server killed 通过');
}

// === 场景 5：biof3-server 进程对象为 null（未 spawn）===
{
  const status = await getBackendStatus({
    runtimeStatus: { r: { installed: true }, python: { installed: false } },
    probeHealth: async () => true,
    procs: { rServer: null },
  });
  assert.strictEqual(status.rServerUp, false, 'rServerUp 应为 false（procs.rServer=null）');
  assert.strictEqual(status.isReady, false, 'isReady 应为 false');
  console.log('✓ 场景5 进程 null 通过');
}

// === 场景 6：isReady 仅由 biof3-server 决定 ===
{
  const status = await getBackendStatus({
    runtimeStatus: { r: { installed: true }, python: { installed: false } },
    probeHealth: async () => true,
    procs: { rServer: { killed: false } },
  });
  assert.strictEqual(status.rServerUp, true, 'rServerUp 应为 true');
  assert.strictEqual(status.isReady, true, 'isReady 应为 true（仅 biof3-server 是硬要求）');
  assert.strictEqual(status.downReason, null, 'downReason 应为 null');
  console.log('✓ 场景6 isReady 单轨判定通过');
}

// === 场景 7（BLOCK-66 P1）：R 缺失但 biof3-server 就绪 → isReady=true（语义解绑）===
{
  const status = await getBackendStatus({
    runtimeStatus: { r: { installed: false }, python: { installed: false } },
    probeHealth: async () => true,
    procs: { rServer: { killed: false } },
  });
  assert.strictEqual(status.rRuntime, false, 'rRuntime 应为 false（R 未装，独立表达）');
  assert.strictEqual(status.serverUp, true, 'serverUp 应为 true（BLOCK-66 新字段）');
  assert.strictEqual(status.rServerUp, true, 'rServerUp 兼容字段应与 serverUp 同值');
  assert.strictEqual(status.isReady, true, 'isReady 应为 true（与 R 解绑，应用全功能可用）');
  assert.strictEqual(status.downReason, null, 'downReason 应为 null（R 缺失不再是 down 理由）');
  console.log('✓ 场景7 BLOCK-66 R 缺失但后端就绪通过（isReady 与 R 解绑）');
}

// === 场景 8（BLOCK-66 P1）：serverUp 新字段在非就绪态也如实表达 ===
{
  const status = await getBackendStatus({
    runtimeStatus: { r: { installed: true }, python: { installed: true } },
    probeHealth: async () => false,
    procs: { rServer: { killed: false } },
  });
  assert.strictEqual(status.serverUp, false, 'serverUp 应为 false（probe 失败）');
  assert.strictEqual(status.rServerUp, false, 'rServerUp 兼容字段应与 serverUp 同值');
  console.log('✓ 场景8 serverUp 字段非就绪态通过');
}

console.log('\n所有 backend-health 测试通过');
