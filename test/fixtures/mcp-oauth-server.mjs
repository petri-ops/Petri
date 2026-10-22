/**
 * BLOCK-239 测试夹具 — 带 OAuth 的 MCP streamable HTTP server。
 *
 * 复用 SDK 自带 demo auth provider（仅测试；生产 provider 在 core 侧实现），
 * 提供：protected-resource metadata → 授权服务器 metadata → 动态注册 →
 * authorize（自动批准）→ token → Bearer 保护的 /mcp（stateless）。
 *
 * 零外部网络：全部 127.0.0.1 临时端口。先 listen 再挂路由，避免“占位端口”
 * 的两步竞态（Express 支持 listen 后继续追加中间件/路由）。
 */

import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  createOAuthMetadata,
  getOAuthProtectedResourceMetadataUrl,
  mcpAuthMetadataRouter,
  mcpAuthRouter,
} from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { DemoInMemoryAuthProvider } from '@modelcontextprotocol/sdk/examples/server/demoInMemoryOAuthProvider.js';
import * as z from 'zod/v4';

const SCOPES = ['mcp:tools'];

function createToolServer() {
  const server = new McpServer(
    { name: 'petri-oauth-fixture', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );
  server.registerTool('fixture_echo', {
    description: '回显输入消息（OAuth 夹具）',
    inputSchema: { message: z.string() },
  }, async ({ message }) => ({
    content: [{ type: 'text', text: `echo:${message}` }],
  }));
  server.registerTool('fixture_authed', {
    description: '授权后可见的第二工具（OAuth 夹具）',
    inputSchema: {},
  }, async () => ({
    content: [{ type: 'text', text: 'authorized' }],
  }));
  return server;
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

export async function startMcpOAuthServer() {
  const provider = new DemoInMemoryAuthProvider();

  const authApp = express();
  const authServer = await listen(authApp);
  const authUrl = new URL(`http://127.0.0.1:${authServer.address().port}`);
  authApp.use(express.json());
  authApp.use(express.urlencoded({ extended: false }));
  authApp.use(mcpAuthRouter({ provider, issuerUrl: authUrl, scopesSupported: SCOPES }));

  const mcpApp = express();
  const mcpServer = await listen(mcpApp);
  const mcpUrl = new URL(`http://127.0.0.1:${mcpServer.address().port}/mcp`);
  mcpApp.use(express.json());

  const oauthMetadata = createOAuthMetadata({ provider, issuerUrl: authUrl, scopesSupported: SCOPES });
  mcpApp.use(mcpAuthMetadataRouter({
    oauthMetadata,
    resourceServerUrl: mcpUrl,
    scopesSupported: SCOPES,
    resourceName: 'Petri OAuth Fixture',
  }));
  const authMiddleware = requireBearerAuth({
    verifier: { verifyAccessToken: (token) => provider.verifyAccessToken(token) },
    requiredScopes: [],
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(mcpUrl),
  });

  mcpApp.post('/mcp', authMiddleware, async (req, res) => {
    const server = createToolServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      Promise.resolve(transport.close()).catch(() => {});
      Promise.resolve(server.close()).catch(() => {});
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  mcpApp.get('/mcp', (_req, res) => {
    res.writeHead(405).end(JSON.stringify({
      jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null,
    }));
  });
  mcpApp.delete('/mcp', (_req, res) => {
    res.writeHead(405).end(JSON.stringify({
      jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null,
    }));
  });

  return {
    mcpUrl: mcpUrl.toString(),
    authUrl: authUrl.toString(),
    async close() {
      mcpServer.closeAllConnections?.();
      authServer.closeAllConnections?.();
      await new Promise((resolve) => mcpServer.close(resolve));
      await new Promise((resolve) => authServer.close(resolve));
    },
  };
}
