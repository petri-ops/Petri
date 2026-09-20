#!/usr/bin/env node
/**
 * desktop-app/src/mcp-server.js — Gewu 桌面版 MCP stdio server
 *
 * 把已注册的 Gewu 插件工具暴露成 agent 可调用的 MCP 工具层。
 * 本文件只负责 stdio 协议，工具发现与执行统一由 core MCP registry 处理。
 *
 * SDK (@modelcontextprotocol/sdk) 是 ESM-only，desktop-app/src 是 CJS，
 * 故用动态 import() 加载。
 */

async function startMcpServer() {
  const { Server } = await import('@modelcontextprotocol/sdk/server/index.js');
  await import('@modelcontextprotocol/sdk/server/stdio.js');
  const { ListToolsRequestSchema, CallToolRequestSchema } =
    await import('@modelcontextprotocol/sdk/types.js');
  // 去 submodule 后：core 内嵌在 desktop 仓根 core/ 下。
  // mcp-server 是 stdio 子进程（被 gewu-mcp bin spawn），不经 Electron 主进程，
  // 自己解析 core 路径：dev = ../core（从 src/ 出发），pack = process.resourcesPath/core
  // 注意：本文件是 CJS（有 require/module.exports），用 __dirname 全局，不用 ESM 的 import.meta.url
  const path = require('node:path');
  const fs = require('node:fs');
  const devCorePath = path.resolve(__dirname, '..', 'core');
  const coreRoot = fs.existsSync(devCorePath)
    ? devCorePath
    : path.join(process.resourcesPath || '', 'core');
  const { listTools, callTool } = require(path.join(coreRoot, 'biof3-server', 'mcp', 'registry'));

  const server = new Server(
    { name: 'gewu-mcp', version: '0.1.0' },
    { capabilities: { tools: {} } }
  );

  // tools/list：返回当前注册的插件工具
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: await listTools() }));

  // tools/call：进入统一 registry 执行通道
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req?.params?.name ?? '<unknown>';
    const args = req?.params?.arguments ?? {};
    try {
      return await callTool(name, args);
    } catch (e) {
      const log = require(path.join(coreRoot, 'shared-backend', 'logger'));
      const code = e?.code || 'unknown';
      const message = e?.message || String(e);
      log.error('mcp_tool_error', { event: 'mcp_tool_error', tool: name, code, message });
      // MCP 约定：工具错误返回 isError 内容，而非抛异常
      return {
        content: [{ type: 'text', text: `Error: ${message}` }],
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
    console.error('[gewu-mcp] fatal:', e);
    process.exit(1);
  });
}

module.exports = { startMcpServer };
