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

test('MCP server tools/list 不再返回单细胞步骤（已移除）', async () => {
  const transport = new StdioClientTransport({
    command: 'node',
    args: [SERVER_PATH],
  });
  const client = new Client({ name: 'biof3-mcp-test', version: '1.0.0' });
  await client.connect(transport);
  try {
    const { tools } = await client.listTools();
    // 单细胞 step 引擎已整体移除：tools/list 只返回插件工具，不含任何 step
    const names = tools.map((t) => t.name);
    assert.ok(!names.includes('scrna-standard'), '不应再暴露单细胞步骤');
    assert.ok(!names.includes('deg'), '不应再暴露单细胞步骤');
    assert.equal(tools.filter((t) => t._isStep).length, 0, '不应含单细胞步骤');
  } finally {
    await client.close();
  }
});

test('MCP server tools/call 对未注册工具返回 isError', async () => {
  const transport = new StdioClientTransport({
    command: 'node',
    args: [SERVER_PATH],
  });
  const client = new Client({ name: 'biof3-mcp-test', version: '1.0.0' });
  await client.connect(transport);
  try {
    // 用绝对不存在的工具名，走 unknown_tool 分支
    const result = await client.callTool({ name: 'nonexistent_tool_xyz', arguments: {} });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /unknown_tool/i);
  } finally {
    await client.close();
  }
});
