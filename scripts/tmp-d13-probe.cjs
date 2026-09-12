#!/usr/bin/env node
'use strict';

/**
 * D13 第二租户探针（独立进程——plugin-loader 是 require 单例，不可在同进程重入两态）。
 *
 * 前置 env（由调用方设置）：
 *   BIOF3_BUILT_IN_PLUGINS_DIR = 空目录
 *   BIOF3_PLUGINS_DIR          = 领域包/夹具的 plugins 目录
 *
 * 输出：单行 JSON { loaded, catalog, hasSample }
 */

const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const pluginLoader = require(path.join(ROOT, 'core/biof3-server/plugin-loader.js'));
const catalogRoutes = require(path.join(ROOT, 'core/biof3-server/routes/tools-catalog.js'));

const manifests = pluginLoader.ensurePluginSourcesLoaded();
const catalog = manifests.map(catalogRoutes._toCatalogEntry).filter(Boolean);
console.log(JSON.stringify({
  loaded: manifests.length,
  catalog: catalog.length,
  hasSample: catalog.some((c) => c.id === 'sample-metrics'),
  sources: [...new Set(catalog.map((c) => (c.execution && c.execution.pluginDir) || ''))].slice(0, 3),
}));
