// MCP server 骨架测试（Task 1）
// 运行：cd desktop-app && npm test -- mcp-server
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = resolve(__dirname, '..', 'src', 'mcp-server.js');

test('MCP server tools/list 返回单细胞步骤（至少 10 个）', async () => {
  const transport = new StdioClientTransport({
    command: 'node',
    args: [SERVER_PATH],
  });
  const client = new Client({ name: 'biof3-mcp-test', version: '1.0.0' });
  await client.connect(transport);
  try {
    const { tools } = await client.listTools();
    // 即使没装任何插件，单细胞 10 步也应在列表里
    assert.ok(tools.length >= 10, `tools/list 应至少返回 10 个单细胞步骤，实际 ${tools.length}`);
    const names = tools.map((t) => t.name);
    assert.ok(names.includes('scrna-standard'));
    assert.ok(names.includes('deg'));
  } finally {
    await client.close();
  }
});

test('MCP server tools/call 对未实现工具返回 isError（Task 2 阶段）', async () => {
  const transport = new StdioClientTransport({
    command: 'node',
    args: [SERVER_PATH],
  });
  const client = new Client({ name: 'biof3-mcp-test', version: '1.0.0' });
  await client.connect(transport);
  try {
    const result = await client.callTool({ name: 'volcano-plot', arguments: {} });
    // Task 2 阶段 callTool 是 stub，返回 isError + not_implemented 文案
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /not_implemented|未实现/i);
  } finally {
    await client.close();
  }
});
