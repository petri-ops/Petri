// MCP bin 入口端到端验收（Task 5b）
// 验证 biof3-mcp 全局命令能被外部 agent 配置 command 连上
// 运行：cd desktop-app && node --test test/mcp-bin-e2e.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { execFileSync } from 'node:child_process';

// biof3-mcp 须已 npm link（开发验收前置）
function binAvailable() {
  try {
    execFileSync('which', ['biof3-mcp'], { encoding: 'utf8', timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

const BIN_OK = binAvailable();

test('biof3-mcp 全局命令可被 MCP client 连上并 tools/list', { skip: !BIN_OK }, async () => {
  // 模拟外部 agent 的配置：command: 'biof3-mcp'，无 args
  const transport = new StdioClientTransport({
    command: 'biof3-mcp',
    args: [],
  });
  const client = new Client({ name: 'external-agent-test', version: '1.0.0' });
  await client.connect(transport);
  try {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    assert.ok(Array.isArray(names));
    assert.equal(names.includes('scrna-standard'), false);
  } finally {
    await client.close();
  }
});

test('biof3-mcp tools/call 对未知工具返回 isError', { skip: !BIN_OK }, async () => {
  const transport = new StdioClientTransport({
    command: 'biof3-mcp',
    args: [],
  });
  const client = new Client({ name: 'external-agent-test', version: '1.0.0' });
  await client.connect(transport);
  try {
    const result = await client.callTool({ name: 'no_such_tool', arguments: {} });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /unknown_tool/i);
  } finally {
    await client.close();
  }
});
