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

test('MCP server tools/list 返回空数组（骨架阶段）', async () => {
  const transport = new StdioClientTransport({
    command: 'node',
    args: [SERVER_PATH],
  });
  const client = new Client({ name: 'biof3-mcp-test', version: '1.0.0' });
  await client.connect(transport);
  try {
    const { tools } = await client.listTools();
    assert.equal(tools.length, 0, '骨架阶段应无注册工具');
  } finally {
    await client.close();
  }
});

test('MCP server tools/call 对未知工具抛错', async () => {
  const transport = new StdioClientTransport({
    command: 'node',
    args: [SERVER_PATH],
  });
  const client = new Client({ name: 'biof3-mcp-test', version: '1.0.0' });
  await client.connect(transport);
  try {
    await assert.rejects(
      () => client.callTool({ name: 'nonexistent_tool', arguments: {} }),
      (err) => /unknown_tool|not found|nonexistent_tool|method not found/i.test(err.message ?? String(err)),
    );
  } finally {
    await client.close();
  }
});
