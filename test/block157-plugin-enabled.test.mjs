/**
 * BLOCK-157 P4 + BLOCK-158 — 插件目录解析与拓扑收敛契约。
 *
 * BLOCK-158 商店面退役后，本文件收敛为两件仍长期承重的契约：
 * ① installed 目录解析单源（resolveInstalledPluginsDir：PETRI_PLUGINS_DIR >
 *    $PETRI_LOCAL_DATA_DIR/plugins > 旧默认——BLOCK-125 拓扑脑裂家族修复）；
 * ② installed.json 读写的指纹漂移检测形态（runtime 条目不带指纹计算）。
 * 商店卡片启停（setPluginEnabled/加载器 enabled 门）已随商店面退役；
 * 插件启停 = 领域包整包启停（pack-registry.setPackEnabled，见 block157-pack-enabled）。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve('.');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'b157-plugin-enabled-'));
process.env.PETRI_LOCAL_DATA_DIR = tmpDir; // src/plugin/paths.js 纯 Node 加载前提（app.getPath 兜底规避）
const pluginsDir = path.join(tmpDir, 'plugins');
fs.mkdirSync(path.join(pluginsDir, 'p-on', 'scripts'), { recursive: true });
for (const id of ['p-on']) {
  fs.writeFileSync(
    path.join(pluginsDir, id, 'plugin.json'),
    JSON.stringify({ id, title: id, version: '1.0.0', language: 'r' })
  );
  fs.writeFileSync(path.join(pluginsDir, id, 'scripts', 'main.R'), '# fixture script\n');
}
fs.writeFileSync(
  path.join(pluginsDir, 'installed.json'),
  JSON.stringify([
    { id: 'p-on', title: 'p-on', version: '1.0.0', type: 'analysis-plugin' },
    { id: 'petri-r-runtime', title: 'R 运行时', version: '1.0.0', type: 'runtime', language: 'r' },
  ])
);

const installed = require(path.join(ROOT, 'src/plugin/installed.js'));
const pluginLoader = require(path.join(ROOT, 'core/petri-server/plugin-loader.js'));

test('BLOCK-158 installed.json 读面：runtime 条目不参与指纹计算，分析插件带指纹对账字段', () => {
  const rows = installed.getInstalledPlugins();
  const runtime = rows.find((r) => r.id === 'petri-r-runtime');
  const plugin = rows.find((r) => r.id === 'p-on');
  assert.equal(runtime.currentFingerprint, null, 'runtime 条目不做指纹计算');
  assert.equal(runtime.manifestDrift, false);
  assert.ok(plugin.installedFingerprint === null || typeof plugin.installedFingerprint === 'string');
});

test('BLOCK-158 拓扑收敛：installed 目录缺省解析优先 PETRI_LOCAL_DATA_DIR（BLOCK-125 脑裂家族修复）', () => {
  const prev = process.env.PETRI_PLUGINS_DIR;
  delete process.env.PETRI_PLUGINS_DIR;
  try {
    assert.equal(
      pluginLoader.resolveInstalledPluginsDir(),
      pluginsDir,
      'PETRI_PLUGINS_DIR 缺省时应回落 $PETRI_LOCAL_DATA_DIR/plugins'
    );
    loaderScan();
    function loaderScan() {
      pluginLoader.loadPluginsFromDisk();
    }
    assert.ok(pluginLoader.getPlugin('p-on'), '无参装载应从 LOCAL_DATA_DIR/plugins 读到已装件');
  } finally {
    if (prev !== undefined) process.env.PETRI_PLUGINS_DIR = prev;
  }
});

test('BLOCK-158 商店面退役：setPluginEnabled 与加载器 enabled 门不再存在（防复活登记）', () => {
  assert.equal(installed.setPluginEnabled, undefined, 'installed.js 不应再导出 setPluginEnabled');
  const src = fs.readFileSync(path.join(ROOT, 'core/petri-server/plugin-loader.js'), 'utf8');
  assert.ok(!/enabled === false/.test(src), 'loadPluginsFromDisk 不应再保留商店 enabled 门');
  const channels = fs.readFileSync(path.join(ROOT, 'src/ipc/channels.js'), 'utf8');
  assert.ok(!/plugin:install'/.test(channels), 'plugin:install 通道应已退役');
  assert.ok(!/plugin:check-updates/.test(channels), 'plugin:check-updates 通道应已退役');
});
