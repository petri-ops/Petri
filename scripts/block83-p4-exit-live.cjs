#!/usr/bin/env node
'use strict';

/**
 * BLOCK-83 P4 出口实机验收（隔离探针版）：核心零生信安装态 + D13 第二租户证明。
 *
 * 断言：
 *   Z1 零领域包态：catalog=0（诚实空态）
 *   Z3 runtime 运行时清单幸存（壳不随领域走）
 *   Z4 核心树生信文件零残留（文件级硬证据）
 *   D13-1 生信包装载：15 插件全来自包
 *   D13-2 第二租户（中性夹具）：装载 + 无生信内容混入
 *
 * 证据：acceptance/block-83/block83-p4-exit-live.json
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const results = [];
function assert(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail == null ? '' : String(detail).slice(0, 300) });
  console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name + (ok ? '' : ' :: ' + String(detail).slice(0, 300)));
}

const nodeBin = process.execPath;
const probe = path.join(root, 'scripts', 'tmp-d13-probe.cjs');

function runProbe({ builtInDir, pluginsDir }) {
  const env = {
    ...process.env,
    PETRI_BUILT_IN_PLUGINS_DIR: builtInDir,
    PETRI_PLUGINS_DIR: pluginsDir,
  };
  const out = execFileSync(nodeBin, [probe], { env, encoding: 'utf8', timeout: 90_000 });
  const line = out.split(/\r?\n/).reverse().find((l) => l.startsWith('{'));
  return line ? JSON.parse(line) : null;
}

(async () => {
  const zeroDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-zero-builtin-'));
  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-empty-plugins-'));
  const packPlugins = 'D:/1.WorkDir/petri-pack-bio/plugins';
  const fixturePlugins = path.join(root, 'test/fixtures/neutral-plugins');

  assert('PRE_pack_installed_json', fs.existsSync(path.join(packPlugins, 'installed.json')), packPlugins);
  assert('PRE_fixture_installed_json', fs.existsSync(path.join(fixturePlugins, 'installed.json')), fixturePlugins);

  // ── A：零领域包态（生信包未安装） ──
  const zero = runProbe({ builtInDir: zeroDir, pluginsDir: emptyDir });
  assert('Z1_catalog_empty_honest', zero && zero.loaded === 0 && zero.catalog === 0,
    'loaded=' + (zero && zero.loaded) + ' catalog=' + (zero && zero.catalog));

  const runtimeManifestPath = path.join(root, 'resources/runtime/manifest.json');
  const runtimeIds = fs.existsSync(runtimeManifestPath)
    ? Object.keys(JSON.parse(fs.readFileSync(runtimeManifestPath, 'utf8')).plugins || {})
    : [];
  assert('Z3_runtime_manifest_survives',
    runtimeIds.includes('petri-r-runtime') && runtimeIds.includes('petri-py-runtime'),
    'runtime=' + runtimeIds.join(','));

  const residueChecks = [
    'resources/built-in-plugins',
    'core/petri-server/tool-scripts',
    'core/petri-server/tool-demo-data',
    'core/petri-server/tool-demo-results',
    'core/petri-server/image',
  ].filter((p) => fs.existsSync(path.join(root, p)));
  assert('Z4_zero_bio_files_in_core', residueChecks.length === 0,
    residueChecks.length ? residueChecks.join(',') : 'residue=0');

  // ── B：D13 双租户 ──
  const pack = runProbe({ builtInDir: zeroDir, pluginsDir: packPlugins });
  assert('D13_1_bio_pack_loads_15', pack && pack.loaded === 15 && pack.catalog === 15,
    'loaded=' + (pack && pack.loaded) + ' catalog=' + (pack && pack.catalog));

  const fixture = runProbe({ builtInDir: zeroDir, pluginsDir: fixturePlugins });
  assert('D13_2_second_tenant_loads', fixture && fixture.loaded === 1 && fixture.hasSample,
    'loaded=' + (fixture && fixture.loaded) + ' hasSample=' + (fixture && fixture.hasSample));

  const fixtureAgain = runProbe({ builtInDir: zeroDir, pluginsDir: fixturePlugins });
  assert('D13_3_no_bio_leak_into_tenant', fixtureAgain && fixtureAgain.loaded === 1,
    'tenant loaded=' + (fixtureAgain && fixtureAgain.loaded));

  const summary = {
    generatedAt: new Date().toISOString(),
    block: 'BLOCK-83-P4-EXIT',
    env: { node: nodeBin, method: 'isolated child probes (plugin-loader 单例不可重入)' },
    totals: { pass: results.filter((r) => r.ok).length, fail: results.filter((r) => !r.ok).length, all: results.length },
    results,
  };
  const outDir = path.join(root, 'acceptance/block-83');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'block83-p4-exit-live.json'), JSON.stringify(summary, null, 2));
  console.log('---');
  console.log('P4 出口验收: ' + summary.totals.pass + '/' + summary.totals.all + ' allPass=' + (summary.totals.fail === 0));
  console.log('evidence: acceptance/block-83/block83-p4-exit-live.json');
  process.exitCode = summary.totals.fail === 0 ? 0 : 1;
})().catch((e) => { console.error('driver crashed:', e); process.exit(2); });
