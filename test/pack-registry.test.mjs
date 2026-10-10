// ============================================================
// BLOCK-86 P1 契约测试 — requires.runtimes + 契约推导装卸编排。
//
// 门禁对账（plan §5.1）：requires.runtimes 校验 + 卸载编排由契约推导，
// 含**无 requires.runtimes 的包卸载时不触碰运行时**的负例。
// 编排（src/pack-lifecycle.js）以依赖注入假件驱动全部分支；
// 注册表（core/shared-backend/pack-registry.js）以临时 fixture 包驱动。
// ============================================================
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packRegistry = require('../core/shared-backend/pack-registry.js');
const { createPackLifecycle } = require('../src/pack-lifecycle.js');

const SIBLING_PACK = path.resolve(root, '..', 'petri-pack-bio');

function tempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'block86-packs-'));
}

/** 造一个最小合法 fixture 包（pack.json + plugins/installed.json 可装载性硬证据）。 */
function makeFixturePack(dir, { packId, requires } = {}) {
  fs.mkdirSync(path.join(dir, 'plugins'), { recursive: true });
  const pack = { packId, name: packId, version: '0.1.0' };
  if (requires !== undefined) pack.requires = requires;
  fs.writeFileSync(path.join(dir, 'pack.json'), JSON.stringify(pack));
  fs.writeFileSync(path.join(dir, 'plugins', 'installed.json'), '[]');
  return dir;
}

function makeLifecycle(extra = {}) {
  return createPackLifecycle({
    getRuntimeStatus: () => ({ r: { installed: true }, python: { installed: false } }),
    getManifestLanguage: async (id) => (id === 'runtime-alpha' ? 'r' : id === 'runtime-beta' ? 'python' : null),
    ...extra,
  });
}

const RUNTIME_A = { pluginId: 'runtime-alpha' };
const RUNTIME_B = { pluginId: 'runtime-beta', version: '>=1.0.0' };

// ── 契约校验（requires.runtimes 形状） ──────────────────────────

test('BLOCK-86 contract: requires.runtimes 缺省归一为空数组（负例前提）', () => {
  const dir = makeFixturePack(fs.mkdtempSync(path.join(os.tmpdir(), 'block86-c0-')), { packId: 'p_none' });
  const validated = packRegistry.validatePackDir(dir);
  assert.equal(validated.ok, true, JSON.stringify(validated));
  assert.deepEqual(validated.pack.requiresRuntimes, []);
});

test('BLOCK-86 contract: 合法声明（含可选 version）被归一保留', () => {
  const dir = makeFixturePack(fs.mkdtempSync(path.join(os.tmpdir(), 'block86-c1-')), {
    packId: 'p_ok', requires: { runtimes: [RUNTIME_A, RUNTIME_B] },
  });
  const validated = packRegistry.validatePackDir(dir);
  assert.equal(validated.ok, true, JSON.stringify(validated));
  assert.deepEqual(validated.pack.requiresRuntimes, [
    { pluginId: 'runtime-alpha' },
    { pluginId: 'runtime-beta', version: '>=1.0.0' },
  ]);
});

test('BLOCK-86 contract: 非法声明逐项拒绝（非数组/缺 pluginId/空 pluginId/version 非字符串）', () => {
  const cases = [
    { runtimes: 'runtime-alpha' },
    { runtimes: ['runtime-alpha'] },
    { runtimes: [{ version: '>=1.0.0' }] },
    { runtimes: [{ pluginId: '   ' }] },
    { runtimes: [{ pluginId: 'x', version: 1 }] },
  ];
  for (const requires of cases) {
    const dir = makeFixturePack(fs.mkdtempSync(path.join(os.tmpdir(), 'block86-c2-')), {
      packId: 'p_bad', requires,
    });
    const validated = packRegistry.validatePackDir(dir);
    assert.equal(validated.ok, false, JSON.stringify(requires));
    assert.equal(validated.error, 'pack_requires_runtimes_invalid');
  }
});

test('BLOCK-86 contract: installPack 记录随存 requiresRuntimes（卸载推导不重读包源）', () => {
  const dataDir = tempDataDir();
  const dir = makeFixturePack(fs.mkdtempSync(path.join(os.tmpdir(), 'block86-c3-')), {
    packId: 'p_store', requires: { runtimes: [RUNTIME_A] },
  });
  const res = packRegistry.installPack(dataDir, dir);
  assert.equal(res.ok, true);
  const [record] = packRegistry.readInstalledPacks(dataDir);
  assert.deepEqual(record.requiresRuntimes, [{ pluginId: 'runtime-alpha' }]);
});

// ── 卸载移除计划（契约推导 + 共享保留 + 负例） ────────────────────

test('BLOCK-86 removal plan: 本包声明且无共享 → 全部 removable；被其他包共享 → retained', () => {
  const dataDir = tempDataDir();
  const dirA = makeFixturePack(fs.mkdtempSync(path.join(os.tmpdir(), 'block86-pa-')), {
    packId: 'p_a', requires: { runtimes: [RUNTIME_A] },
  });
  const dirB = makeFixturePack(fs.mkdtempSync(path.join(os.tmpdir(), 'block86-pb-')), {
    packId: 'p_b', requires: { runtimes: [RUNTIME_A, RUNTIME_B] },
  });
  packRegistry.installPack(dataDir, dirA);
  packRegistry.installPack(dataDir, dirB);

  // p_b 卸载：runtime-alpha 被 p_a 共享 → retained；runtime-beta 仅 p_b 声明 → removable
  const planB = packRegistry.computeRuntimeRemovalPlan(dataDir, 'p_b');
  assert.equal(planB.ok, true);
  assert.deepEqual(planB.removable, ['runtime-beta']);
  assert.deepEqual(planB.retained, [{ pluginId: 'runtime-alpha', requiredBy: ['p_a'] }]);

  // p_a 卸载：runtime-alpha 仍被 p_b 共享 → retained；无 removable
  const planA = packRegistry.computeRuntimeRemovalPlan(dataDir, 'p_a');
  assert.deepEqual(planA.removable, []);
  assert.deepEqual(planA.retained, [{ pluginId: 'runtime-alpha', requiredBy: ['p_b'] }]);

  // 先卸 p_a 再看 p_b：alpha 不再被共享 → removable
  packRegistry.uninstallPack(dataDir, 'p_a');
  const planB2 = packRegistry.computeRuntimeRemovalPlan(dataDir, 'p_b');
  assert.deepEqual(planB2.removable, ['runtime-alpha', 'runtime-beta']);
  assert.deepEqual(planB2.retained, []);
});

test('BLOCK-86 removal plan 负例：无 requires.runtimes 的包 → removable 恒空（绝不触碰运行时）', () => {
  const dataDir = tempDataDir();
  const dir = makeFixturePack(fs.mkdtempSync(path.join(os.tmpdir(), 'block86-n1-')), { packId: 'p_plain' });
  packRegistry.installPack(dataDir, dir);
  const plan = packRegistry.computeRuntimeRemovalPlan(dataDir, 'p_plain');
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.removable, []);
  assert.deepEqual(plan.retained, []);
});

test('BLOCK-86 removal plan 负例：旧版记录（无 requiresRuntimes 字段）同样恒空（向后兼容）', () => {
  const dataDir = tempDataDir();
  packRegistry.writeInstalledPacks(dataDir, [
    { packId: 'p_legacy', packRoot: '/ somewhere/legacy', version: '0.0.1', installedAt: '2026-09-14T00:00:00Z' },
  ]);
  const plan = packRegistry.computeRuntimeRemovalPlan(dataDir, 'p_legacy');
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.removable, []);
});

test('BLOCK-86 removal plan: 未安装 → pack_not_installed', () => {
  const plan = packRegistry.computeRuntimeRemovalPlan(tempDataDir(), 'p_ghost');
  assert.equal(plan.ok, false);
  assert.equal(plan.error, 'pack_not_installed');
});

// ── 编排（src/pack-lifecycle.js，假件驱动） ──────────────────────

function fakeInstalled(ids) {
  return ids.map((id) => ({ id, language: 'r' }));
}

test('BLOCK-86 orchestration install: 记录落库 + 契约推导逐个装运行时（含进度回调透传）', async () => {
  const dataDir = tempDataDir();
  const dir = makeFixturePack(fs.mkdtempSync(path.join(os.tmpdir(), 'block86-o1-')), {
    packId: 'p_live', requires: { runtimes: [RUNTIME_A, RUNTIME_B] },
  });
  const installedRuntimeIds = [];
  const progressCalls = [];
  const lifecycle = makeLifecycle({
    getInstalledPlugins: () => [],
    getRuntimeStatus: () => ({ r: { installed: false }, python: { installed: false } }),
    getManifestLanguage: async (id) => (id === 'runtime-alpha' ? 'r' : 'python'),
    installPlugin: async (pluginId, onProgress) => {
      installedRuntimeIds.push(pluginId);
      if (onProgress) onProgress({ percent: 50 });
    },
  });
  const res = await lifecycle.installPackWithRuntimes(dataDir, dir, {
    onRuntimeProgress: (pluginId, progress) => progressCalls.push([pluginId, progress]),
  });
  assert.equal(res.ok, true);
  assert.deepEqual(installedRuntimeIds, ['runtime-alpha', 'runtime-beta']);
  assert.ok(res.requiresRestart, '装了运行时必须提示重启生效');
  assert.equal(progressCalls.length, 2);
  assert.deepEqual(progressCalls[0], ['runtime-alpha', { percent: 50 }]);
  assert.equal(packRegistry.readInstalledPacks(dataDir).length, 1);
});

test('BLOCK-86 orchestration install: 链外供给的运行时（无安装记录但在位）→ skip runtime_present 不重装', async () => {
  const dataDir = tempDataDir();
  const dir = makeFixturePack(fs.mkdtempSync(path.join(os.tmpdir(), 'block86-o8-')), {
    packId: 'p_ext', requires: { runtimes: [RUNTIME_A] },
  });
  const installCalls = [];
  const lifecycle = makeLifecycle({
    getInstalledPlugins: () => [], // 安装记录里没有——本机 R 由链外供给的实机形态
    getRuntimeStatus: () => ({ r: { installed: true }, python: { installed: false } }),
    getManifestLanguage: async (pluginId) => (pluginId === 'runtime-alpha' ? 'r' : 'python'),
    installPlugin: async (pluginId) => { installCalls.push(pluginId); },
  });
  const res = await lifecycle.installPackWithRuntimes(dataDir, dir);
  assert.equal(res.ok, true);
  assert.deepEqual(res.runtimes, [{ pluginId: 'runtime-alpha', ok: true, skipped: 'runtime_present' }]);
  assert.deepEqual(installCalls, [], '在位运行时绝不重装（防 657MB 误下载）');
});

test('BLOCK-86 orchestration install: 已装运行时 skip 不重装；运行时失败不回滚记录、如实上报', async () => {
  const dataDir = tempDataDir();
  const dir = makeFixturePack(fs.mkdtempSync(path.join(os.tmpdir(), 'block86-o2-')), {
    packId: 'p_mixed', requires: { runtimes: [RUNTIME_A, RUNTIME_B] },
  });
  const installCalls = [];
  const lifecycle = makeLifecycle({
    getInstalledPlugins: () => fakeInstalled(['runtime-alpha']),
    installPlugin: async (pluginId) => {
      installCalls.push(pluginId);
      if (pluginId === 'runtime-beta') throw new Error('network down');
    },
  });
  const res = await lifecycle.installPackWithRuntimes(dataDir, dir);
  assert.equal(res.ok, true, '记录安装不受运行时失败影响');
  assert.deepEqual(installCalls, ['runtime-beta'], '已装的 skip，只尝试缺的');
  assert.deepEqual(res.runtimes.find((r) => r.pluginId === 'runtime-alpha'), { pluginId: 'runtime-alpha', ok: true, skipped: 'already_installed' });
  assert.equal(res.runtimes.find((r) => r.pluginId === 'runtime-beta').ok, false);
  assert.equal(res.runtimes.find((r) => r.pluginId === 'runtime-beta').error, 'network down');
  assert.equal(res.requiresRestart, false, '没有成功安装任何运行时不得提示重启');
  assert.equal(packRegistry.readInstalledPacks(dataDir).length, 1);
});

test('BLOCK-86 orchestration uninstall 负例：缺省选项只删记录，运行时/包源分文不动', async () => {
  const dataDir = tempDataDir();
  const dir = makeFixturePack(fs.mkdtempSync(path.join(os.tmpdir(), 'block86-o3-')), {
    packId: 'p_safe', requires: { runtimes: [RUNTIME_A] },
  });
  packRegistry.installPack(dataDir, dir);
  let uninstallRuntimeCalls = 0;
  const lifecycle = makeLifecycle({
    getInstalledPlugins: () => fakeInstalled(['runtime-alpha']),
    uninstallRuntime: async () => { uninstallRuntimeCalls += 1; },
  });
  const report = await lifecycle.executeUninstall(dataDir, 'p_safe');
  assert.equal(report.ok, true);
  assert.equal(uninstallRuntimeCalls, 0, '未显式勾选不得卸运行时');
  assert.ok(fs.existsSync(path.join(dir, 'pack.json')), '包源目录是用户资产，默认保留');
  assert.equal(packRegistry.readInstalledPacks(dataDir).length, 0);
  assert.equal(report.removed.record, true);
  assert.deepEqual(report.removed.runtimes, []);
  assert.equal(report.kept.packSourceDir, dir);
  assert.equal(report.removed.packSourceDir, undefined);
});

test('BLOCK-86 orchestration uninstall: deleteRuntimes 只卸「本包声明且无共享」的运行时（契约推导）', async () => {
  const dataDir = tempDataDir();
  const dirA = makeFixturePack(fs.mkdtempSync(path.join(os.tmpdir(), 'block86-o4a-')), {
    packId: 'p_a', requires: { runtimes: [RUNTIME_A] },
  });
  const dirB = makeFixturePack(fs.mkdtempSync(path.join(os.tmpdir(), 'block86-o4b-')), {
    packId: 'p_b', requires: { runtimes: [RUNTIME_A, RUNTIME_B] },
  });
  packRegistry.installPack(dataDir, dirA);
  packRegistry.installPack(dataDir, dirB);
  const uninstalled = [];
  const lifecycle = makeLifecycle({
    getInstalledPlugins: () => fakeInstalled(['runtime-alpha', 'runtime-beta']),
    uninstallRuntime: async (pluginId) => { uninstalled.push(pluginId); },
  });
  const report = await lifecycle.executeUninstall(dataDir, 'p_b', { deleteRuntimes: true });
  assert.equal(report.ok, true);
  assert.deepEqual(uninstalled, ['runtime-beta'], '共享运行时必须保留给 p_a');
  assert.equal(report.requiresRestart, true);
  assert.equal(packRegistry.readInstalledPacks(dataDir).some((p) => p.packId === 'p_a'), true, '共享方 p_a 记录不受影响');
});

test('BLOCK-86 orchestration uninstall: deleteRuntimes 对无契约包是 no-op（负例贯彻到编排层）', async () => {
  const dataDir = tempDataDir();
  const dir = makeFixturePack(fs.mkdtempSync(path.join(os.tmpdir(), 'block86-o5-')), { packId: 'p_plain' });
  packRegistry.installPack(dataDir, dir);
  let uninstallRuntimeCalls = 0;
  const lifecycle = makeLifecycle({
    getInstalledPlugins: () => fakeInstalled(['runtime-alpha']),
    uninstallRuntime: async () => { uninstallRuntimeCalls += 1; },
  });
  const report = await lifecycle.executeUninstall(dataDir, 'p_plain', { deleteRuntimes: true });
  assert.equal(report.ok, true);
  assert.equal(uninstallRuntimeCalls, 0, '契约没声明运行时，勾了也没有可卸对象');
  assert.deepEqual(report.removed.runtimes, []);
});

test('BLOCK-86 orchestration uninstall: deletePackSource 护栏——只删含 pack.json 的记录目录', async () => {
  const dataDir = tempDataDir();
  const dir = makeFixturePack(fs.mkdtempSync(path.join(os.tmpdir(), 'block86-o6-')), { packId: 'p_src' });
  packRegistry.installPack(dataDir, dir);
  const lifecycle = makeLifecycle({ getInstalledPlugins: () => [] });

  // 护栏正例：记录指向、含 pack.json → 真删
  const ok = await lifecycle.executeUninstall(dataDir, 'p_src', { deletePackSource: true });
  assert.equal(ok.ok, true);
  assert.equal(fs.existsSync(dir), false, '显式勾选后包源目录删除');
  assert.equal(ok.removed.packSourceDir, dir);

  // 护栏负例：手工把记录指向一个不含 pack.json 的目录 → 拒删并如实报告
  const dangerous = fs.mkdtempSync(path.join(os.tmpdir(), 'block86-danger-'));
  fs.writeFileSync(path.join(dangerous, 'important.txt'), 'not a pack');
  packRegistry.writeInstalledPacks(dataDir, [
    { packId: 'p_evil', packRoot: dangerous, version: '0.0.1', requiresRuntimes: [], installedAt: 'x' },
  ]);
  const report = await lifecycle.executeUninstall(dataDir, 'p_evil', { deletePackSource: true });
  assert.equal(report.ok, true);
  assert.ok(fs.existsSync(dangerous), '护栏必须挡下非包目录');
  assert.equal(report.kept.packSourceError, 'pack_source_guard_failed');
  fs.rmSync(dangerous, { recursive: true, force: true });
});

test('BLOCK-86 uninstall plan: 预览含运行时在位状态/体积与包源信息（确认弹层数据源）', async () => {
  const dataDir = tempDataDir();
  const dir = makeFixturePack(fs.mkdtempSync(path.join(os.tmpdir(), 'block86-o7-')), {
    packId: 'p_view', requires: { runtimes: [RUNTIME_A] },
  });
  packRegistry.installPack(dataDir, dir);
  const lifecycle = makeLifecycle({
    getInstalledPlugins: () => fakeInstalled(['runtime-alpha']),
    runtimesDir: () => path.join(dataDir, 'runtimes'),
    dirSize: (d) => (d.endsWith(path.join('runtimes', 'R')) ? 657224393 : 0),
  });
  const plan = await lifecycle.buildUninstallPlan(dataDir, 'p_view');
  assert.equal(plan.ok, true);
  assert.equal(plan.runtimes.removable.length, 1);
  assert.equal(plan.runtimes.removable[0].pluginId, 'runtime-alpha');
  assert.equal(plan.runtimes.removable[0].installed, true);
  assert.equal(plan.runtimes.removable[0].sizeBytes, 657224393);
  assert.equal(plan.packSource.dir, dir);
  assert.equal(plan.packSource.exists, true);
  assert.equal(plan.userDataPolicy, 'results、项目文件与数据库不受影响');
});

// ── 内容概要（P2 商店「功能模块」行数据源） ─────────────────────

test('BLOCK-86 contents: 只读统计插件/脚本/演示数据，缺目录如实计 0', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'block86-ct-'));
  // 空目录：三项全 0
  const empty = packRegistry.describePackContents(dir);
  assert.deepEqual(
    { ...empty, plugins: empty.plugins.length },
    { pluginCount: 0, plugins: 0, pluginIds: [], scriptCount: 0, demoDataCount: 0 },
  );
  // 造齐三件：2 插件（1 R 1 Python）+ 2 脚本目录 + 1 演示数据目录 + 下划线杂项不计
  fs.mkdirSync(path.join(dir, 'plugins'));
  fs.writeFileSync(path.join(dir, 'plugins', 'installed.json'), JSON.stringify([
    { id: 'deseq2', language: 'r', version: '1.0.0' },
    { id: 'celltypist', language: 'python', version: '1.0.0' },
  ]));
  fs.mkdirSync(path.join(dir, 'scripts', 'deseq2'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'scripts', 'ml-classifier'));
  fs.writeFileSync(path.join(dir, 'scripts', '_shared.R'), 'x');
  fs.mkdirSync(path.join(dir, 'demo-data', 'counts'), { recursive: true });
  const c = packRegistry.describePackContents(dir);
  assert.equal(c.pluginCount, 2);
  assert.deepEqual(c.pluginIds, ['deseq2', 'celltypist']);
  assert.deepEqual(c.plugins, [
    { id: 'deseq2', language: 'r', version: '1.0.0' },
    { id: 'celltypist', language: 'python', version: '1.0.0' },
  ]);
  assert.equal(c.scriptCount, 2, '下划线前缀共享件不计入脚本模块');
  assert.equal(c.demoDataCount, 1);
});

// ── 真包集成（兄弟仓；环境缺失时诚实 skip） ─────────────────────

test('BLOCK-86 contract: 兄弟仓真包声明 R/Python 运行时（跨仓协调落点）', { skip: !fs.existsSync(SIBLING_PACK) && 'sibling pack repo absent' }, () => {
  const validated = packRegistry.validatePackDir(SIBLING_PACK);
  assert.equal(validated.ok, true, JSON.stringify(validated));
  const ids = validated.pack.requiresRuntimes.map((r) => r.pluginId);
  assert.ok(ids.includes('petri-r-runtime'), JSON.stringify(ids));
  assert.ok(ids.includes('petri-py-runtime'), JSON.stringify(ids));
});
