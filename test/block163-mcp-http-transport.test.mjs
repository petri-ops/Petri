/**
 * BLOCK-163 W3 P3（CAP-3）— MCP client 多传输（streamable HTTP）+ 健康面契约测试。
 *
 * 钉住：①transport='http' + url 配置经 StreamableHTTPClientTransport 连接
 * （走本地 HTTP 夹具）；②stdio 缺省语义零变化；③健康面（statuses 透出
 * transport/lastErrorAt/最近错误）；④配置校验：http 缺 url 拒绝。
 * HTTP 夹具=零依赖 node:http JSON-RPC 端点（initialize/tools/list 最小集）。
 */

import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve('.');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'b163-mcp-http-'));
process.env.PETRI_LOCAL_DATA_DIR = tmpDir;

const settings = require(path.join(ROOT, 'core/petri-server/helpers/mcp-settings'));
const manager = require(path.join(ROOT, 'core/petri-server/mcp/client-manager'));

// ── 最小 MCP-over-HTTP 夹具：initialize + tools/list ──
const httpServer = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    let msg = {};
    try { msg = JSON.parse(body); } catch {}
    const headers = { 'content-type': 'application/json' };
    if (msg.method === 'initialize') {
      res.writeHead(200, headers);
      res.end(JSON.stringify({
        jsonrpc: '2.0', id: msg.id,
        result: {
          protocolVersion: (msg.params && msg.params.protocolVersion) || '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'petri-http-fixture', version: '1.0.0' },
        },
      }));
      return;
    }
    if (msg.method && msg.id !== undefined) {
      // notifications 已被客户端吞掉；这里只剩 tools/list 等请求
      res.writeHead(200, headers);
      if (msg.method === 'tools/list') {
        res.end(JSON.stringify({
          jsonrpc: '2.0', id: msg.id,
          result: { tools: [{ name: 'http_ping', description: 'http fixture tool', inputSchema: { type: 'object', properties: {} } }] },
        }));
      } else {
        res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: {} }));
      }
      return;
    }
    // 通知（initialized 等）→ 202 空
    res.writeHead(202);
    res.end();
  });
});

let fixturePort = null;
test.before(async () => {
  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  fixturePort = httpServer.address().port;
});

test('BLOCK-160 CAP-3 配置校验：http 传输缺 url 拒绝保存', () => {
  const bad = settings.upsertMcpServer({ id: 'http-bad', command: 'ignored', transport: 'http' });
  assert.equal(bad.error, 'http_url_required', JSON.stringify(bad));
});

test('BLOCK-160 CAP-3 streamable HTTP：连接+工具清单+健康面透出', async () => {
  const port = fixturePort;
  const saved = settings.upsertMcpServer({
    id: 'http-fixture',
    command: 'ignored',
    transport: 'http',
    url: `http://127.0.0.1:${port}/mcp`,
  });
  assert.equal(saved.error, undefined, JSON.stringify(saved));

  const conn = await manager.connectServer('http-fixture');
  assert.equal(conn.ok, true, JSON.stringify(conn));
  assert.equal(conn.toolCount, 1);

  const statuses = manager.getStatuses();
  const row = statuses.find((x) => x.id === 'http-fixture');
  assert.equal(row.status, 'connected');
  assert.equal(row.transport, 'http');
  assert.ok(row.connectedAt > 0, '健康面：connectedAt 透出');
  assert.equal(row.toolCount, 1);

  await manager.disconnectServer('http-fixture');
});

test('BLOCK-160 CAP-3 健康面：连接失败记 lastErrorAt（stdio 坏命令）', async () => {
  settings.upsertMcpServer({ id: 'std-bad', command: 'definitely-not-a-real-cmd-xyz', args: [] });
  const r = await manager.connectServer('std-bad');
  assert.equal(r.ok, false);
  const row = manager.getStatuses().find((x) => x.id === 'std-bad');
  assert.equal(row.status, 'error');
  assert.ok(row.lastErrorAt > 0, '健康面：lastErrorAt 透出');
  assert.ok(row.error, '错误信息透出');
});

test.after(async () => {
  await manager.closeAll().catch(() => {});
  httpServer.close();
});
