import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalog = require('../core/petri-server/routes/tools-catalog');
const pluginLoader = require('../core/petri-server/plugin-loader');
// BLOCK-83 P4：核心仓零内置插件——测试装载中性夹具源
pluginLoader.loadPluginsFromSources({ builtInDir: path.resolve(root, 'test/fixtures/neutral-plugins') });

test('BLOCK-83 D4 catalog projection maps installed plugin manifests to catalog entries', () => {
  const manifests = pluginLoader.ensurePluginSourcesLoaded();
  assert.ok(manifests.length > 0, 'expected built-in plugins to be discoverable');
  const entries = manifests.map(catalog._toCatalogEntry).filter(Boolean);
  assert.equal(entries.length, manifests.length);

  const fixture = entries.find((entry) => entry.id === 'sample-metrics');
  assert.ok(fixture, 'sample-metrics should be part of the projection');
  // 表现层字段：目录投影必须带 color/category/minutes，UI 方可零静态清单渲染。
  assert.equal(typeof fixture.title, 'string');
  assert.equal(typeof fixture.category, 'string');
  assert.equal(fixture.color, '#64748b');
  assert.equal(fixture.language, 'r');
  assert.ok(Array.isArray(fixture.inputs) && fixture.inputs.length > 0);
  assert.ok(Array.isArray(fixture.outputs) && fixture.outputs.length > 0);
  assert.equal(fixture.resultStudioAvailable, true);
});

test('BLOCK-83 D4 catalog projection is empty for zero installed plugins (honest empty state)', () => {
  const entries = [].map(catalog._toCatalogEntry).filter(Boolean);
  assert.deepEqual(entries, []);
});

test('BLOCK-83 D4 catalog entry defaults are honest when a manifest omits optional fields', () => {
  const entry = catalog._toCatalogEntry({ id: 'bare-tool' });
  assert.equal(entry.id, 'bare-tool');
  assert.equal(entry.title, 'bare-tool');
  assert.equal(entry.category, 'analysis');
  assert.equal(entry.color, null);
  assert.equal(entry.estimatedMinutes, null);
  assert.equal(entry.comingSoon, false);
  assert.equal(entry.resultStudioAvailable, false);
  assert.deepEqual(entry.inputs, []);
  // 非对象 / 无 id 的 manifest 不产生条目（fail-closed 投影）。
  assert.equal(catalog._toCatalogEntry(null), null);
  assert.equal(catalog._toCatalogEntry({}), null);
});

test('BLOCK-83 D4 catalog route registers a GET endpoint and reports its source', () => {
  const routes = [];
  const app = { get: (route) => routes.push(route) };
  catalog.createToolsCatalogRoutes()(app);
  // BLOCK-160 P3 起同路由族挂 workflow-templates（斜杠菜单双来源）——期望随契约对齐
  assert.deepEqual(routes, ['/api/tools/catalog', '/api/tools/workflow-templates']);
});
