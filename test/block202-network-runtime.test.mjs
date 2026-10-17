/**
 * BLOCK-202 W3 — 网络代理 / 运行时策略契约测（隔离 data dir，零网络）。
 *
 * 钉住的红线：
 *  · 代理与 CA 只在启动时写进 env；本地回环强制进 NO_PROXY；CA 文件缺失不设 env 且给诊断；
 *  · 并发/深度 env 优先 > 文件 > 历史默认（3/1），钳制沿用既有上限（8 / 3）；
 *  · 审批默认档位只在上下文缺省时兜底，默认 full（=现状）；非法已存值回落 full；
 *  · 工具黑名单只做曝光过滤，不改执行策略。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'b202-runtime-'));
process.env.PETRI_LOCAL_DATA_DIR = sandbox;

const network = require(path.join(ROOT, 'core/petri-server/helpers/network-config.js'));
const runtime = require(path.join(ROOT, 'core/petri-server/helpers/runtime-policy.js'));

test.after(() => {
  try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch { /* 清理失败不影响结论 */ }
});

test.beforeEach(() => {
  fs.rmSync(path.join(sandbox, 'network.json'), { force: true });
  fs.rmSync(path.join(sandbox, 'runtime-policy.json'), { force: true });
  network.resetAppliedSnapshotForTest();
});

test('network 默认：空配置 + 回环豁免已生效', () => {
  const snapshot = network.getNetworkSnapshot();
  assert.deepEqual(snapshot.configured, { httpProxy: '', httpsProxy: '', noProxy: '', caFile: '' });
  assert.equal(snapshot.noProxyEffective, 'localhost,127.0.0.1,::1');
  assert.equal(snapshot.restartRequired, false);
});

test('network 写侧：非法代理串/未知键一律拒绝（不静默存活）', () => {
  assert.throws(() => network.saveNetworkConfig({ httpProxy: 'socks5://x' }), (error) => {
    assert.equal(error.message, 'config_value_rejected');
    assert.ok(error.diagnostics.some((d) => d.code === 'not-allowed'));
    return true;
  });
  assert.throws(() => network.saveNetworkConfig({ nope: 'x' }), /config_value_rejected/);
});

test('network 生效：代理写进 env、NO_PROXY 强制并入回环、CA 缺失不设 env 且给诊断', () => {
  network.saveNetworkConfig({ httpProxy: 'http://127.0.0.1:7890', httpsProxy: 'http://127.0.0.1:7890', noProxy: '.corp.example' });
  const env = {};
  network.applyNetworkEnv(env);
  assert.equal(env.HTTP_PROXY, 'http://127.0.0.1:7890');
  assert.equal(env.HTTPS_PROXY, 'http://127.0.0.1:7890');
  assert.equal(env.NODE_USE_ENV_PROXY, '1');
  assert.match(env.NO_PROXY, /\.corp\.example/);
  for (const loopback of ['localhost', '127.0.0.1', '::1']) assert.ok(env.NO_PROXY.includes(loopback));
  assert.equal(env.NODE_EXTRA_CA_CERTS, undefined);

  network.saveNetworkConfig({ caFile: path.join(sandbox, 'missing-ca.pem') });
  const env2 = {};
  const result2 = network.applyNetworkEnv(env2);
  assert.equal(env2.NODE_EXTRA_CA_CERTS, undefined);
  assert.ok(result2.diagnostics.some((d) => d.code === 'ca-file-missing'));

  const caFile = path.join(sandbox, 'ca.pem');
  fs.writeFileSync(caFile, '-----BEGIN CERTIFICATE-----\n');
  network.saveNetworkConfig({ caFile });
  const env3 = {};
  network.applyNetworkEnv(env3);
  assert.equal(env3.NODE_EXTRA_CA_CERTS, caFile);
});

test('network 清空代理后必须撤掉 env（不留陈旧代理）', () => {
  network.saveNetworkConfig({ httpProxy: 'http://127.0.0.1:7890' });
  const env = {};
  network.applyNetworkEnv(env);
  assert.equal(env.HTTP_PROXY, 'http://127.0.0.1:7890');
  network.saveNetworkConfig({ httpProxy: '' });
  network.applyNetworkEnv(env);
  assert.equal(env.HTTP_PROXY, undefined);
  assert.equal(env.NODE_USE_ENV_PROXY, undefined);
});

test('network restartRequired：应用后再改配置即为 true（面板据此提示重启）', () => {
  network.saveNetworkConfig({ httpProxy: 'http://127.0.0.1:7890' });
  network.applyNetworkEnv({});
  assert.equal(network.getNetworkSnapshot().restartRequired, false);
  network.saveNetworkConfig({ httpsProxy: 'http://127.0.0.1:7891' });
  assert.equal(network.getNetworkSnapshot().restartRequired, true);
});

test('runtime 默认：full / 3 / 1 / 空黑名单（= 现状）', () => {
  const snapshot = runtime.getRuntimeSnapshot({});
  assert.deepEqual(snapshot.effective, { approvalDefaultMode: 'full', spawnConcurrency: 3, spawnMaxDepth: 1 });
  assert.deepEqual(runtime.toolDenyList(), []);
  assert.deepEqual(runtime.toolAllowList(), []);
});

test('runtime 写侧：档位/并发/深度越界与未知键一律拒绝', () => {
  assert.throws(() => runtime.saveRuntimePolicy({ approvalDefaultMode: 'yolo' }), /config_value_rejected/);
  assert.throws(() => runtime.saveRuntimePolicy({ spawnConcurrency: 9 }), /config_value_rejected/);
  assert.throws(() => runtime.saveRuntimePolicy({ spawnMaxDepth: 4 }), /config_value_rejected/);
  assert.throws(() => runtime.saveRuntimePolicy({ nope: 1 }), /config_value_rejected/);
});

test('runtime 取值优先级：env > 文件 > 默认，且钳制沿用既有上限', () => {
  runtime.saveRuntimePolicy({ spawnConcurrency: 5, spawnMaxDepth: 2 });
  assert.equal(runtime.getSpawnConcurrency({}), 5);
  assert.equal(runtime.getSpawnMaxDepth({}), 2);
  assert.equal(runtime.getSpawnConcurrency({ PETRI_SPAWN_CONCURRENCY_LIMIT: '7' }), 7);
  assert.equal(runtime.getSpawnMaxDepth({ PETRI_SPAWN_MAX_DEPTH: '3' }), 3);
  assert.equal(runtime.getSpawnConcurrency({ PETRI_SPAWN_CONCURRENCY_LIMIT: '99' }), 8);
  assert.equal(runtime.getSpawnMaxDepth({ PETRI_SPAWN_MAX_DEPTH: '99' }), 3);
});

test('runtime 审批默认档位：仅作缺省兜底，非法已存值回落 full', () => {
  assert.equal(runtime.getDefaultApprovalMode(), 'full');
  runtime.saveRuntimePolicy({ approvalDefaultMode: 'read' });
  assert.equal(runtime.getDefaultApprovalMode(), 'read');
  fs.writeFileSync(path.join(sandbox, 'runtime-policy.json'), JSON.stringify({ approvalDefaultMode: 'nope' }));
  assert.equal(runtime.getDefaultApprovalMode(), 'full');
});

test('runtime 工具黑名单：只摘曝光面，其余工具原样保留', () => {
  const defs = [
    { type: 'function', function: { name: 'workspace_exec' } },
    { type: 'function', function: { name: 'workspace_read' } },
    { type: 'function', function: { name: 'computer_click' } },
  ];
  runtime.saveRuntimePolicy({ toolDeny: 'workspace_exec, computer_click' });
  const filtered = runtime.filterToolDefs(defs);
  assert.deepEqual(filtered.map((def) => def.function.name), ['workspace_read']);
  assert.equal(runtime.isToolDenied('workspace_exec'), true);
  runtime.saveRuntimePolicy({ toolDeny: '' });
  assert.equal(runtime.filterToolDefs(defs).length, 3);
  // 白名单非空时先收窄，再受黑名单二次约束
  runtime.saveRuntimePolicy({ toolAllow: 'workspace_exec,workspace_read', toolDeny: 'workspace_exec' });
  assert.deepEqual(runtime.filterToolDefs(defs).map((def) => def.function.name), ['workspace_read']);
  runtime.saveRuntimePolicy({ toolAllow: '', toolDeny: '' });
});

test('runtime env 遮蔽在快照里点名（并发/深度）', () => {
  runtime.saveRuntimePolicy({ spawnConcurrency: 4 });
  const snapshot = runtime.getRuntimeSnapshot({ PETRI_SPAWN_CONCURRENCY_LIMIT: '6' });
  assert.equal(snapshot.effective.spawnConcurrency, 6);
  assert.ok(snapshot.envShadowed.some((row) => row.key === 'spawnConcurrency'));
});
