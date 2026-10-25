/**
 * BLOCK-258 测试夹具 — 带自定义 Header 校验的 MCP SSE server。
 *
 * 只用于契约测试：GET /sse 与 POST /messages 都要求 `x-petri-test-key`，
 * 用来证明客户端确实把配置的 headers 带到了 SSE 长连接与后续 POST 上。
 * 零外部网络：127.0.0.1 临时端口。
 */

import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import * as z from 'zod/v4';

const HEADER = 'x-petri-test-key';
const KEY = 'sse-fixture-secret';

export async function startMcpSseServer(options = {}) {
  const requiredKey = options.requiredKey === undefined ? KEY : options.requiredKey;
  const app = express();
  /** @type {Map<string, { transport: SSEServerTransport, server: McpServer }>} */
  const sessions = new Map();

  function headerOk(req) {
    if (!requiredKey) return true;
    return req.headers[HEADER] === requiredKey;
  }

  app.get('/sse', async (req, res) => {
    if (!headerOk(req)) {
      res.status(401).send('missing_or_invalid_test_header');
      return;
    }
    const transport = new SSEServerTransport('/messages', res);
    const server = new McpServer(
      { name: 'petri-sse-fixture', version: '1.0.0' },
      { capabilities: { tools: {} } },
    );
    server.registerTool('sse_ping', {
      description: 'SSE 夹具工具',
      inputSchema: { message: z.string().optional() },
    }, async ({ message }) => ({
      content: [{ type: 'text', text: `pong:${message || 'ok'}` }],
    }));
    sessions.set(transport.sessionId, { transport, server });
    res.on('close', () => {
      sessions.delete(transport.sessionId);
      server.close().catch(() => {});
    });
    await server.connect(transport);
  });

  app.post('/messages', async (req, res) => {
    if (!headerOk(req)) {
      res.status(401).send('missing_or_invalid_test_header');
      return;
    }
    const sessionId = String(req.query.sessionId || '');
    const entry = sessions.get(sessionId);
    if (!entry) {
      res.status(404).send('unknown_session');
      return;
    }
    await entry.transport.handlePostMessage(req, res);
  });

  const httpServer = await new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
  return {
    url: `http://127.0.0.1:${httpServer.address().port}/sse`,
    header: HEADER,
    key: requiredKey || '',
    close: async () => {
      for (const { server } of sessions.values()) {
        await server.close().catch(() => {});
      }
      sessions.clear();
      await new Promise((resolve) => httpServer.close(resolve));
    },
  };
}
