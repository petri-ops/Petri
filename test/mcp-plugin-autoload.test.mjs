// MCP 插件自动加载测试（Task 5a）
// 运行：cd desktop-app && node --test test/mcp-plugin-autoload.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const R_SERVER = resolve(__dirname, '..', 'core', 'r-server');

const pluginLoader = await import(R_SERVER + '/plugin-loader.js');
const { listTools } = await import(resolve(__dirname, '..', 'core', 'r-server', 'mcp', 'registry.js'));

test('loadPluginsFromDisk 从 installed.json 注册插件，listTools 含该插件', async () => {
  // 构造临时 pluginsDir：installed.json + my-tool/plugin.json + tool-definition.json
  const pluginsDir = mkdtempSync(join(tmpdir(), 'biof3-autoload-'));
  const pluginDir = join(pluginsDir, 'my-test-tool');
  mkdirSync(join(pluginDir, 'scripts'), { recursive: true });
  writeFileSync(
    join(pluginDir, 'plugin.json'),
    JSON.stringify({ id: 'my-test-tool', title: '测试工具', version: '1.0.0', language: 'r' }),
  );
  writeFileSync(
    join(pluginDir, 'tool-definition.json'),
    JSON.stringify({
      id: 'my-test-tool',
      description: '自动加载测试工具',
      inputs: [{ id: 'x', type: 'number', required: true }],
      outputs: [],
    }),
  );
  writeFileSync(join(pluginsDir, 'installed.json'), JSON.stringify([{ id: 'my-test-tool' }]));

  // 清空 + 加载
  globalThis._biof3Plugins = new Map();
  pluginLoader.loadPluginsFromDisk(pluginsDir);

  try {
    const tools = await listTools();
    const names = tools.map((t) => t.name);
    assert.ok(names.includes('my-test-tool'), `listTools 应含自动加载的 my-test-tool，实际: ${names.join(',')}`);
    const t = tools.find((x) => x.name === 'my-test-tool');
    assert.equal(t.inputSchema.required[0], 'x');
    assert.equal(t.description, '自动加载测试工具');
  } finally {
    globalThis._biof3Plugins = new Map();
    rmSync(pluginsDir, { recursive: true, force: true });
  }
});

test('loadPluginsFromDisk 无 installed.json 时不报错（返回 undefined）', () => {
  const emptyDir = mkdtempSync(join(tmpdir(), 'biof3-empty-'));
  globalThis._biof3Plugins = new Map();
  const result = pluginLoader.loadPluginsFromDisk(emptyDir);
  assert.equal(result, undefined);
  assert.equal(pluginLoader.getAllPlugins().length, 0);
  rmSync(emptyDir, { recursive: true, force: true });
});

test('loadPluginsFromDisk 跳过 runtime 类型条目（无 plugin.json）', async () => {
  const pluginsDir = mkdtempSync(join(tmpdir(), 'biof3-runtime-'));
  writeFileSync(join(pluginsDir, 'installed.json'), JSON.stringify([
    { id: 'r-runtime', type: 'runtime' },
    { id: 'real-tool' },
  ]));
  const pluginDir = join(pluginsDir, 'real-tool');
  mkdirSync(join(pluginDir, 'scripts'), { recursive: true });
  writeFileSync(join(pluginDir, 'plugin.json'), JSON.stringify({ id: 'real-tool', version: '1.0.0', language: 'r' }));
  writeFileSync(join(pluginDir, 'tool-definition.json'), JSON.stringify({ id: 'real-tool', description: '真工具', inputs: [] }));

  globalThis._biof3Plugins = new Map();
  pluginLoader.loadPluginsFromDisk(pluginsDir);
  try {
    const tools = await listTools();
    const names = tools.map((t) => t.name);
    assert.ok(names.includes('real-tool'));
    assert.ok(!names.includes('r-runtime'), 'runtime 条目不应出现在工具列表');
  } finally {
    globalThis._biof3Plugins = new Map();
    rmSync(pluginsDir, { recursive: true, force: true });
  }
});
