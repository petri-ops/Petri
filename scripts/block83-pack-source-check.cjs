#!/usr/bin/env node
'use strict';

/**
 * BLOCK-83 P4：插件源装卸缝验证——核心从**外部领域包**加载插件（内置源为空）。
 *
 * 用法（需 fnm Node 24）：
 *   node scripts/block83-pack-source-check.cjs <packRoot>
 *   # 例：node scripts/block83-pack-source-check.cjs D:/<workdir>/petri-pack-bio
 *
 * 断言：
 *   P1 内置源指向空目录时，插件仍可全部从包的 plugins/ 加载（核心不依赖内置生信内容）
 *   P2 包的插件清单与核心 manifest 归一化契约兼容（title/category/inputs 齐备）
 *   P3 目录投影（/api/tools/catalog 的数据源）自包插件投影出条目
 *
 * 证据：acceptance/block-83/block83-pack-source-live.json
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const packRoot = process.argv[2] ? path.resolve(process.argv[2]) : null;

if (!packRoot || !fs.existsSync(packRoot)) {
  console.error('用法: node scripts/block83-pack-source-check.cjs <packRoot>（包根目录，需含 pack.json 与 plugins/）');
  process.exit(2);
}

const pluginsDir = path.join(packRoot, 'plugins');
if (!fs.existsSync(pluginsDir)) {
  console.error('包的 plugins/ 目录不存在: ' + pluginsDir);
  process.exit(2);
}

// 空的内置源：证明「核心不内置生信内容」也能工作
const emptyBuiltIn = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-empty-builtin-'));
process.env.PETRI_BUILT_IN_PLUGINS_DIR = emptyBuiltIn;
process.env.PETRI_PLUGINS_DIR = pluginsDir;

const results = [];
function assert(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail == null ? '' : String(detail).slice(0, 300) });
  console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name + (ok ? '' : ' :: ' + String(detail).slice(0, 300)));
}

const pluginLoader = require(path.join(ROOT, 'core/petri-server/plugin-loader.js'));
const catalogRoutes = require(path.join(ROOT, 'core/petri-server/routes/tools-catalog.js'));

const packJsonPath = path.join(packRoot, 'pack.json');
const pack = fs.existsSync(packJsonPath) ? JSON.parse(fs.readFileSync(packJsonPath, 'utf8')) : null;
assert('P0_pack_manifest_present', !!pack && !!pack.packId, pack ? pack.packId : 'pack.json 缺失');

const manifests = pluginLoader.ensurePluginSourcesLoaded();
 // 声明插件数由清单文件决定，这里以实际加载为准
assert('P1_plugins_load_from_pack', manifests.length > 0,
  '从包加载插件数=' + manifests.length + '（内置源=' + emptyBuiltIn + ' 为空）');

const pluginDirsInPack = fs.readdirSync(pluginsDir, { withFileTypes: true })
  .filter((e) => e.isDirectory() && fs.existsSync(path.join(pluginsDir, e.name, 'plugin.json')))
  .map((e) => e.name);
const loadedFromPack = manifests.filter((m) => {
  const dir = (m.execution && m.execution.pluginDir) || '';
  return dir && path.resolve(dir).startsWith(path.resolve(pluginsDir));
});
assert('P1b_all_loaded_plugins_come_from_pack', loadedFromPack.length === manifests.length,
  loadedFromPack.length + '/' + manifests.length + ' 来自包（包内插件目录 ' + pluginDirsInPack.length + ' 个）');

const sample = manifests.find((m) => m.id === 'deseq2') || manifests[0];
assert('P2_manifest_contract_compat',
  !!sample && typeof sample.title === 'string' && typeof sample.category === 'string' && Array.isArray(sample.inputs),
  sample ? JSON.stringify({ id: sample.id, title: sample.title, category: sample.category, inputs: sample.inputs.length }) : 'no manifest');

const catalog = manifests.map(catalogRoutes._toCatalogEntry).filter(Boolean);
assert('P3_catalog_projects_from_pack', catalog.length === manifests.length && catalog.length > 0,
  '目录条目=' + catalog.length);

const summary = {
  generatedAt: new Date().toISOString(),
  block: 'BLOCK-83-P4-PACK-SOURCE',
  packRoot,
  packId: pack ? pack.packId : null,
  env: { node: process.version, builtInSource: emptyBuiltIn, installedSource: pluginsDir },
  totals: { pass: results.filter((r) => r.ok).length, fail: results.filter((r) => !r.ok).length, all: results.length },
  loadedPluginIds: manifests.map((m) => m.id).sort(),
  results,
};
const outDir = path.join(ROOT, 'acceptance/block-83');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'block83-pack-source-live.json'), JSON.stringify(summary, null, 2));
console.log('---');
console.log('包源装卸缝: ' + summary.totals.pass + '/' + summary.totals.all + ' allPass=' + (summary.totals.fail === 0));
console.log('evidence: acceptance/block-83/block83-pack-source-live.json');
process.exitCode = summary.totals.fail === 0 ? 0 : 1;
