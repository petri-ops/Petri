// MCP server 插件自动加载端到端测试（Task 5a）
// 验证 mcp-server 子进程启动时自动 loadPluginsFromDisk，tools/list 含已装插件
// 运行：cd desktop-app && node --test test/mcp-server-autoload.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = resolve(__dirname, '..', 'src', 'mcp-server.js');

test('mcp-server 子进程启动后 tools/list 含自动加载的插件', async () => {
  // 构造临时 pluginsDir
  const pluginsDir = mkdtempSync(join(tmpdir(), 'biof3-mcp-e2e-'));
  const pluginDir = join(pluginsDir, 'e2e-tool');
  mkdirSync(join(pluginDir, 'scripts'), { recursive: true });
  writeFileSync(join(pluginDir, 'plugin.json'), JSON.stringify({
    id: 'e2e-tool', title: 'E2E 工具', version: '1.0.0', language: 'r',
  }));
  writeFileSync(join(pluginDir, 'tool-definition.json'), JSON.stringify({
    id: 'e2e-tool',
    description: '端到端自动加载测试',
    inputs: [{ id: 'val', type: 'number', required: true }],
    outputs: [],
  }));
  writeFileSync(join(pluginsDir, 'installed.json'), JSON.stringify([{ id: 'e2e-tool' }]));

  const transport = new StdioClientTransport({
    command: 'node',
    args: [SERVER_PATH],
    env: { ...process.env, BIOF3_PLUGINS_DIR: pluginsDir },
  });
  const client = new Client({ name: 'biof3-mcp-test', version: '1.0.0' });
  await client.connect(transport);
  try {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    assert.ok(names.includes('e2e-tool'), `应含自动加载的 e2e-tool，实际: ${names.join(',')}`);
    // 10 个单细胞步骤也应在
    assert.ok(names.includes('scrna-standard'));
    const t = tools.find((x) => x.name === 'e2e-tool');
    assert.equal(t.inputSchema.required[0], 'val');
  } finally {
    await client.close();
    rmSync(pluginsDir, { recursive: true, force: true });
  }
});
