#!/usr/bin/env node
'use strict';

/**
 * BLOCK-84 探针（独立进程——plugin-loader 是 require 单例，不可同进程重入两态）。
 *
 * 用法：node tmp-block84-probe.cjs <dataDir>
 * 复刻 server.js boot 接线的等价装配：读 packs 记录 → 追加插件源 → 投影 catalog。
 *
 * 输出：单行 JSON { ok, wiring, loaded, catalog, source, pluginDirMissing, hasBio, error? }
 */

const path = require('path');
const os = require('os');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const dataDir = process.argv[2];

try {
  const packRegistry = require(path.join(ROOT, 'core/shared-backend', 'pack-registry.js'));
  const pluginLoader = require(path.join(ROOT, 'core/petri-server', 'plugin-loader.js'));
  const catalogRoutes = require(path.join(ROOT, 'core/petri-server', 'routes', 'tools-catalog.js'));

  const installed = packRegistry.readInstalledPacks(dataDir);
  let wiring = 0;
  // 与 server.js boot 等价：builtin + installed(兜底) + 已装包源
  const sources = [
    { type: 'builtin', root: path.join(ROOT, 'resources', 'built-in-plugins') },
    { type: 'installed', root: path.join(os.homedir(), 'Documents', 'Petri-Local', 'plugins') },
  ];
  for (const pack of installed) {
    const packPluginsDir = path.join(pack.packRoot, 'plugins');
    if (fs.existsSync(path.join(packPluginsDir, 'installed.json'))) {
      wiring += 1;
      sources.push({ type: 'installed', root: packPluginsDir, required: false });
    }
  }

  pluginLoader.loadFromSourcesArray(sources);
  const manifests = pluginLoader.getAllPluginManifests();
  const catalog = manifests.map(catalogRoutes._toCatalogEntry).filter(Boolean);
  const pluginDirMissing = catalog.filter((c) => !(c.execution && c.execution.pluginDir)).length;

  console.log(JSON.stringify({
    ok: true,
    wiring,
    loaded: manifests.length,
    catalog: catalog.length,
    source: 'installed-plugins',
    pluginDirMissing,
    hasBio: catalog.some((c) => c.id === 'deseq2'),
  }));
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: (error && error.message) || 'probe_failed' }));
}
