#!/usr/bin/env node
'use strict';

/**
 * BLOCK-84 实机验收（隔离探针版）：领域包产品级一键装/卸双态循环。
 *
 * 断言：
 *   P1 幂等安装：installPack 两次 → 第二次 updated=true，记录仍为 1 条
 *   P2 已装态 boot 接线：wiring 生信包 → catalog=15 且 source=installed-plugins
 *   P3 卸载语义：uninstallPack 仅移记录（包文件仍在）+ 返回 removed
 *   P4 零态诚实：wiring 计数 0 + catalog=0（不再 500）
 *   P5 目录投影字段完整性：catalog 条目 pluginDir 非空（抓真一回归守卫）
 *   P6 D13 第二租户：中性夹具同法可装可卸
 *
 * 证据：acceptance/block-84/block84-pack-oneclick-live.json
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const packRegistry = require(path.join(root, 'core/shared-backend/pack-registry.js'));

const REAL_PACK = 'D:/1.WorkDir/petri-pack-bio';
const FIXTURE_PLUGINS = path.join(root, 'test/fixtures/neutral-plugins');
const results = [];

// D13 第二租户：用中性夹具插件在临时目录合成一个**非生信领域包**
// （夹具本身是插件目录，不是包；此处现场组装 pack.json + plugins/ 以满足包契约）
function makeSecondTenantPack() {
  const packRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'block84-tenant2-'));
  fs.mkdirSync(path.join(packRoot, 'plugins'), { recursive: true });
  fs.cpSync(FIXTURE_PLUGINS, path.join(packRoot, 'plugins'), { recursive: true });
  fs.writeFileSync(path.join(packRoot, 'pack.json'), JSON.stringify({
    packId: 'petri-pack-neutral-fixture',
    name: '中性夹具包（第二租户验收）',
    version: '0.0.1',
    kind: 'domain-pack',
    description: 'BLOCK-84 D13 第二租户证明：非生信领域包走同一条装/卸链路。',
    provides: { plugins: 'plugins/' },
  }, null, 2));
  return packRoot;
}

function assert(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail == null ? '' : String(detail).slice(0, 300) });
  console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name + (ok ? '' : ' :: ' + String(detail).slice(0, 300)));
}

// 探针：独立进程读 packs 记录 → 装配 → 投影 catalog（plugin-loader 是 require 单例，不可同进程重入两态）
function runProbe(dataDir) {
  const probe = path.join(root, 'scripts', 'tmp-block84-probe.cjs');
  const out = execFileSync(process.execPath, [probe, dataDir], { encoding: 'utf8', timeout: 90_000 });
  const line = out.split(/\r?\n/).reverse().find((l) => l.startsWith('{'));
  return line ? JSON.parse(line) : null;
}

(function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'block84-live-'));

  // ── 前置 ──
  assert('PRE_real_pack_exists', fs.existsSync(path.join(REAL_PACK, 'pack.json')), REAL_PACK);
  assert('PRE_fixture_plugins_exist', fs.existsSync(path.join(FIXTURE_PLUGINS, 'installed.json')), FIXTURE_PLUGINS);

  // ── 零态（未装任何包） ──
  const zero = runProbe(dataDir);
  assert('P4a_zero_wiring_count', zero && zero.wiring === 0, 'wiring=' + (zero && zero.wiring));
  assert('P4b_zero_catalog_honest', zero && zero.catalog === 0, 'catalog=' + (zero && zero.catalog));
  assert('P4c_zero_no_error', zero && zero.ok === true, 'ok=' + (zero && zero.ok) + ' err=' + (zero && zero.error));

  // ── P1 幂等安装 ──
  const ins1 = packRegistry.installPack(dataDir, REAL_PACK);
  const ins2 = packRegistry.installPack(dataDir, REAL_PACK);
  const recs = packRegistry.readInstalledPacks(dataDir);
  assert('P1a_install_ok', ins1 && ins1.ok === true, JSON.stringify(ins1 && ins1.packId));
  assert('P1b_idempotent_upsert', ins2 && ins2.ok === true && ins2.updated === true, JSON.stringify(ins2 && { ok: ins2.ok, updated: ins2.updated }));
  assert('P1c_single_record', recs.length === 1, 'records=' + recs.length);

  // ── P2 已装态 boot 接线 ──
  const loaded = runProbe(dataDir);
  assert('P2a_wiring_pack', loaded && loaded.wiring >= 1, 'wiring=' + (loaded && loaded.wiring));
  assert('P2b_catalog_15', loaded && loaded.catalog === 15, 'catalog=' + (loaded && loaded.catalog));
  assert('P2c_source_is_installed_plugins', loaded && loaded.source === 'installed-plugins', 'source=' + (loaded && loaded.source));
  assert('P2d_no_error', loaded && loaded.ok === true, 'ok=' + (loaded && loaded.ok) + ' err=' + (loaded && loaded.error));

  // ── P5 目录投影字段完整性（抓真一回归守卫：pluginDir 必须非空）──
  assert('P5_catalog_pluginDir_nonempty', loaded && loaded.pluginDirMissing === 0,
    'pluginDirMissing=' + (loaded && loaded.pluginDirMissing));

  // ── P3 卸载语义 ──
  const un = packRegistry.uninstallPack(dataDir, 'petri-pack-bio');
  const afterRecs = packRegistry.readInstalledPacks(dataDir);
  assert('P3a_uninstall_ok', un && un.ok === true && un.removed === 'petri-pack-bio', JSON.stringify(un));
  assert('P3b_record_removed', afterRecs.length === 0, 'records=' + afterRecs.length);
  assert('P3c_pack_files_kept', fs.existsSync(path.join(REAL_PACK, 'pack.json')), '包文件为用户资产，卸载不删');

  // ── P4 卸后零态 ──
  const zero2 = runProbe(dataDir);
  assert('P4d_zero_after_uninstall', zero2 && zero2.catalog === 0 && zero2.wiring === 0,
    'catalog=' + (zero2 && zero2.catalog) + ' wiring=' + (zero2 && zero2.wiring));

  // ── P6 D13 第二租户（非生信夹具包同法可装可卸）──
  const tenant2 = makeSecondTenantPack();
  const ins3 = packRegistry.installPack(dataDir, tenant2);
  assert('P6a_fixture_installable', ins3 && ins3.ok === true, JSON.stringify(ins3 && ins3.packId));
  const fixtureState = runProbe(dataDir);
  assert('P6b_fixture_catalog', fixtureState && fixtureState.catalog >= 1 && fixtureState.hasBio === false,
    'catalog=' + (fixtureState && fixtureState.catalog) + ' hasBio=' + (fixtureState && fixtureState.hasBio));
  const un3 = packRegistry.uninstallPack(dataDir, 'petri-pack-neutral-fixture');
  const finalState = runProbe(dataDir);
  assert('P6c_fixture_uninstallable', un3 && un3.ok === true && finalState && finalState.catalog === 0,
    'un=' + JSON.stringify(un3) + ' catalog=' + (finalState && finalState.catalog));

  const summary = {
    ok: results.every((r) => r.ok),
    total: results.length,
    passed: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  };
  console.log('\n' + (summary.ok ? 'ALL PASS' : 'HAS FAILURES') + ' — ' + summary.passed + '/' + summary.total);

  const outDir = path.join(root, 'acceptance', 'block-84');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'block84-pack-oneclick-live.json');
  fs.writeFileSync(outFile, JSON.stringify({ ...summary, capturedAt: new Date().toISOString() }, null, 2));
  console.log('evidence: ' + outFile);

  process.exit(summary.ok ? 0 : 1);
})();
