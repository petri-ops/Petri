#!/usr/bin/env node
/**
 * desktop-app/src/mcp-server.js — BioF3 桌面版 MCP stdio server
 *
 * 把 BioF3 沉淀的组学工作流（单细胞 10 步 + bulk 工具 + 可视化规范）
 * 暴露成 agent 可调用的 MCP 工具层。本文件是协议外壳，业务逻辑在
 * plugin-loader / task-scripts-gen / plugin-manager（内核不动）。
 *
 * 骨架阶段（Task 1）：tools/list 返回空数组、tools/call 抛 unknown_tool。
 * 后续 Task 2-6 往里填工具与执行通道。
 *
 * SDK (@modelcontextprotocol/sdk) 是 ESM-only，desktop-app/src 是 CJS，
 * 故用动态 import() 加载。
 */

async function startMcpServer() {
  const { Server } = await import('@modelcontextprotocol/sdk/server/index.js');
  const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
  const { ListToolsRequestSchema, CallToolRequestSchema } =
    await import('@modelcontextprotocol/sdk/types.js');
  const { listTools, callTool } = require('../../r-server/mcp/registry');

  const server = new Server(
    { name: 'biof3-mcp', version: '0.1.0' },
    { capabilities: { tools: {} } }
  );

  // tools/list：返回插件工具 + 单细胞步骤的合并列表
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: await listTools() }));

  // tools/call：Task 3-4 实现执行通道，当前 registry.callTool 抛 not_implemented
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req?.params?.name ?? '<unknown>';
    const args = req?.params?.arguments ?? {};
    try {
      return await callTool(name, args);
    } catch (e) {
      // MCP 约定：工具错误返回 isError 内容，而非抛异常
      return {
        content: [{ type: 'text', text: `Error: ${e.message}` }],
        isError: true,
      };
    }
  });

  return server;
}

async function main() {
  const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
  const server = await startMcpServer();
  await server.connect(new StdioServerTransport());
}

// 直接运行时启动 stdio server；被 require 时不自动启动
if (require.main === module) {
  main().catch((e) => {
    console.error('[biof3-mcp] fatal:', e);
    process.exit(1);
  });
}

module.exports = { startMcpServer };
