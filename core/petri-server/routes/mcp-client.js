/**
 * routes/mcp-client.js — MCP 客户端管理 HTTP 路由（BLOCK-156 P2）
 *
 * 扩展中心「MCP 服务」货架的数据面；同进程直达 client-manager（连接与
 * agent 工具执行同进程——P3 投影的架构前提）。
 *
 * 端点：
 *   GET    /api/mcp/servers              全量状态（配置 ∪ 运行态）
 *   POST   /api/mcp/servers              新增/更新（body: { id, command, args?, env?, autoConnect? }）
 *   DELETE /api/mcp/servers/:id          删除（先断开）
 *   POST   /api/mcp/servers/:id/connect    连接
 *   POST   /api/mcp/servers/:id/disconnect 断开
 *   GET    /api/mcp/servers/:id/tools     已连接 server 的工具清单
 */

'use strict';

const express = require('express');
const settings = require('../helpers/mcp-settings');
const manager = require('../mcp/client-manager');

function registerMcpClientRoutes(app) {
  app.get('/api/mcp/servers', (_req, res) => {
    res.json({ status: 'ok', servers: manager.getStatuses() });
  });

  app.post('/api/mcp/servers', express.json(), (req, res) => {
    const body = req.body || {};
    const { server, error } = settings.upsertMcpServer({
      id: body.id,
      command: body.command,
      args: Array.isArray(body.args) ? body.args : [],
      env: body.env && typeof body.env === 'object' ? body.env : {},
      autoConnect: body.autoConnect !== false,
    });
    if (error) {
      res.status(400).json({ status: 'error', error });
      return;
    }
    res.json({ status: 'ok', server });
  });

  app.delete('/api/mcp/servers/:id', async (req, res) => {
    const id = String(req.params.id || '');
    await manager.disconnectServer(id).catch(() => { /* 未连接时静默 */ });
    const { removed, error } = settings.removeMcpServer(id);
    if (error) {
      res.status(error === 'server_not_found' ? 404 : 400).json({ status: 'error', error });
      return;
    }
    res.json({ status: 'ok', removed });
  });

  app.post('/api/mcp/servers/:id/connect', async (req, res) => {
    const id = String(req.params.id || '');
    const result = await manager.connectServer(id);
    if (!result.ok) {
      res.status(result.error === 'server_not_found' ? 404 : 502).json({ status: 'error', error: result.error });
      return;
    }
    res.json({ status: 'ok', id, toolCount: result.toolCount ?? 0 });
  });

  app.post('/api/mcp/servers/:id/disconnect', async (req, res) => {
    const id = String(req.params.id || '');
    const result = await manager.disconnectServer(id);
    if (!result.ok) {
      res.status(409).json({ status: 'error', error: result.error });
      return;
    }
    res.json({ status: 'ok', id });
  });

  app.get('/api/mcp/servers/:id/tools', (req, res) => {
    const id = String(req.params.id || '');
    const { ok, tools, error } = manager.listServerTools(id);
    if (!ok) {
      res.status(409).json({ status: 'error', error });
      return;
    }
    res.json({ status: 'ok', tools });
  });
}

module.exports = { registerMcpClientRoutes };
