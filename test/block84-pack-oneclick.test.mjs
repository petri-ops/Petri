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
const toolRegistry = require('../core/petri-server/tool-registry.js');

// 真包定位：pack 仓与 desktop 仓同级（AGENTS.md/ask 事实「pack 仓在 ../petri-pack-bio」）。
// 勿硬编码机器绝对路径——block-84 原版写死 D:/<workdir>/petri-pack-bio（作者 Windows 机），
// 换机即 pack_json_missing 三连红；同级解析在原机上落点不变，跨机可移植。
const REAL_PACK = path.resolve(root, '..', 'petri-pack-bio');

function tempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'block84-packs-'));
}

test('BLOCK-84 pack validation: pack.json contract and loadability hard evidence', () => {
  // 缺 pack.json
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'block84-empty-'));
  assert.equal(packRegistry.validatePackDir(empty).error, 'pack_json_missing');
  // 坏 JSON
  fs.writeFileSync(path.join(empty, 'pack.json'), '{oops');
  assert.ok(packRegistry.validatePackDir(empty).error.startsWith('pack_json_invalid'));
  // 缺 plugins/installed.json（可装载性硬证据）
  fs.writeFileSync(path.join(empty, 'pack.json'), JSON.stringify({ packId: 'x' }));
  assert.equal(packRegistry.validatePackDir(empty).error, 'pack_plugins_index_missing');
  // 真包通过
  const real = packRegistry.validatePackDir(REAL_PACK);
  assert.equal(real.ok, true, JSON.stringify(real));
  assert.equal(real.pack.packId, 'petri-pack-bio');
});

test('BLOCK-84 install is an idempotent upsert; uninstall removes the record only', () => {
  const dataDir = tempDataDir();
  const first = packRegistry.installPack(dataDir, REAL_PACK);
  assert.equal(first.ok, true);
  assert.equal(first.pack.packId, 'petri-pack-bio');
  // 幂等：重复安装 = 更新（不产生第二条）
  const second = packRegistry.installPack(dataDir, REAL_PACK);
  assert.equal(second.ok, true);
  assert.equal(second.updated, true);
  assert.equal(packRegistry.readInstalledPacks(dataDir).length, 1);
  // 记录文件确实落在 dataDir/packs/installed.json
  assert.ok(fs.existsSync(packRegistry.packsRecordFile(dataDir)));
  // 卸载 = 只移记录（包文件不动）
  const removed = packRegistry.uninstallPack(dataDir, 'petri-pack-bio');
  assert.equal(removed.ok, true);
  assert.equal(packRegistry.readInstalledPacks(dataDir).length, 0);
  assert.ok(fs.existsSync(path.join(REAL_PACK, 'pack.json')), '包文件是用户资产，不得删除');
  // 卸载未安装的包 → 明确错误
  assert.equal(packRegistry.uninstallPack(dataDir, 'petri-pack-bio').error, 'pack_not_installed');
});

test('BLOCK-84 discovery finds the sibling pack automatically', () => {
  const available = packRegistry.discoverAvailablePacks({ projectRoot: root });
  assert.ok(available.some((p) => p.packId === 'petri-pack-bio'), JSON.stringify(available.map((p) => p.packId)));
});

test('BLOCK-84 tool-registry supports additive domain registration (dev env + pack boot share one mechanism)', () => {
  // 空表起点（核心默认态）
  assert.equal(Object.keys(toolRegistry.TOOLS).length, 0);
  // 叠加注册：同 id 覆盖、别名合并、接口语义不变
  const result = toolRegistry.registerDomainToolsFile(path.join(REAL_PACK, 'registry', 'tool-registry.json'));
  assert.equal(result.ok, true);
  // merged 数=登记文件 TOOLS 实际条目数（机械真相，勿写死——BLOCK-145 D2 退役 17 条
  // legacy 死链后 23→6；写死计数会在下次登记面编辑时再次假红）。
  const registeredEntries = Object.keys(
    JSON.parse(fs.readFileSync(path.join(REAL_PACK, 'registry', 'tool-registry.json'), 'utf8')).TOOLS,
  ).length;
  assert.equal(result.merged, registeredEntries);
  assert.equal(toolRegistry.resolveToolId('deseq2'), 'deseq2');
  // BIO-4（pack d1deb96）裁决：go-kegg 解冻走插件通道，tool-registry TOOLS/别名
  // 一并退役——desktop 侧期望 2026-10-10 随 BLOCK-156 D7 closeout 抓真补齐（存量过期断言）
  assert.equal(toolRegistry.resolveToolId('enrichment'), null);
  assert.equal(toolRegistry.getToolConfig('deseq2').lang, 'r');
  // 缺文件=诚实失败不阻塞
  assert.equal(toolRegistry.registerDomainToolsFile(path.join(os.tmpdir(), 'block84-nope.json')).error, 'registry_file_missing');
});

test('BLOCK-84 zero-pack boot wiring stays honest: record absent = no wiring', () => {
  const dataDir = tempDataDir();
  assert.deepEqual(packRegistry.readInstalledPacks(dataDir), []);
});
