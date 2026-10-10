// MCP built-in 插件自动发现测试（方向 2）
// 验证 mcp-server 能发现 resources/built-in-plugins/ 下的工具插件（不依赖 install）
// 运行：cd desktop-app && node --test test/mcp-builtin-discovery.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = resolve(__dirname, '..', 'src', 'mcp-server.js');
// BLOCK-83 P4：核心仓内置源=中性夹具（生信插件随领域包交付）
const BUILT_IN_DIR = resolve(__dirname, 'fixtures', 'neutral-plugins');

// built-in 插件实际是否存在（开发环境应有）
const hasBuiltIn = existsSync(join(BUILT_IN_DIR, 'sample-metrics', 'plugin.json'));
const SKIP_REASON = '中性夹具插件缺失（test/fixtures/neutral-plugins/sample-metrics）——检查仓库完整性而非静默通过';

test('built-in 工具插件被自动发现（sample-metrics）', { skip: hasBuiltIn ? false : SKIP_REASON }, async () => {
  // 清空已装插件，确保 volcano-plot 来自 built-in 发现（不是 installed.json）
  // 用空 PETRI_PLUGINS_DIR 让 loadPluginsFromDisk 找不到已装插件
  const emptyDir = resolve(__dirname, '..', 'test-tmp-empty');
  const transport = new StdioClientTransport({
    command: 'node',
    args: [SERVER_PATH],
    env: { ...process.env, PETRI_PLUGINS_DIR: emptyDir, PETRI_BUILT_IN_PLUGINS_DIR: BUILT_IN_DIR },
  });
  const client = new Client({ name: 'builtin-test', version: '1.0.0' });
  await client.connect(transport);
  try {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    // built-in 工具应被发现（即使 installed.json 为空）
    assert.ok(names.includes('sample-metrics'), `应发现 built-in sample-metrics，实际: ${names.join(',')}`);
    await client.close();
  } catch (error) {
    try { await client.close(); } catch { /* already closed */ }
    throw error;
  }
});

test('built-in 与已装插件去重（已装优先）', { skip: !hasBuiltIn }, async () => {
  // 构造 installed.json 含 volcano-plot（模拟已装）
  const os = await import('node:os');
  const fs = await import('node:fs');
  const tmpDir = fs.mkdtempSync(join(os.tmpdir(), 'petri-dedup-'));
  const pluginDir = join(tmpDir, 'volcano-plot');
  fs.mkdirSync(join(pluginDir, 'scripts'), { recursive: true });
  fs.writeFileSync(join(pluginDir, 'plugin.json'), JSON.stringify({
    id: 'volcano-plot', version: '1.0.0', language: 'r',
  }));
  fs.writeFileSync(join(pluginDir, 'tool-definition.json'), JSON.stringify({
    id: 'volcano-plot', description: '已装版本（应优先）', inputs: [],
  }));
  fs.writeFileSync(join(tmpDir, 'installed.json'), JSON.stringify([{ id: 'volcano-plot' }]));

  const transport = new StdioClientTransport({
    command: 'node',
    args: [SERVER_PATH],
    env: { ...process.env, PETRI_PLUGINS_DIR: tmpDir },
  });
  const client = new Client({ name: 'dedup-test', version: '1.0.0' });
  await client.connect(transport);
  try {
    const { tools } = await client.listTools();
    const vol = tools.find((t) => t.name === 'volcano-plot');
    assert.ok(vol, 'volcano-plot 应在列表');
    // 已装版本优先：description 应是"已装版本（应优先）"而非 built-in 的
    assert.equal(vol.description, '已装版本（应优先）');
    // 列表里只有一个 volcano-plot（去重）
    const count = tools.filter((t) => t.name === 'volcano-plot').length;
    assert.equal(count, 1, 'volcano-plot 不应重复');
  } finally {
    await client.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
