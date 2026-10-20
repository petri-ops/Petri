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
 *   GET    /api/mcp/tool-policy           逐工具策略 + 生效投影上限（BLOCK-204 / W5）
 *   PUT    /api/mcp/tool-policy           写策略（400 + diagnostics；unknown-tool 只拒该条以外的整批）
 */

'use strict';

const express = require('express');
const settings = require('../helpers/mcp-settings');
const manager = require('../mcp/client-manager');
const toolPolicy = require('../helpers/mcp-tool-policy');
const serverPolicy = require('../helpers/mcp-server-policy');
const projection = require('../agent-tools/mcp-projection');

function registerMcpClientRoutes(app) {
  app.get('/api/mcp/servers', (_req, res) => {
    // BLOCK-221（Q8）— 每行附服务级策略摘要：治理状态要可见（env 已由 manager 脱敏）
    const store = serverPolicy.readStore();
    const projCounts = projection.projectedCountByServer();
    const servers = manager.getStatuses().map((row) => ({
      ...row,
      policy: { ...serverPolicy.summaryFor(row.id, store), projectedToolCount: projCounts[row.id] || 0 },
    }));
    res.json({ status: 'ok', servers });
  });

  // BLOCK-221（Q8）— 服务级策略读写面（信任位/允许/阻断；本轮不改变审批默认）
  app.get('/api/mcp/servers/:id/policy', (req, res) => {
    const id = String(req.params.id || '');
    const known = new Set(settings.listMcpServers().map((s) => s.id));
    if (!known.has(id)) {
      res.status(404).json({ status: 'error', error: 'server_not_found' });
      return;
    }
    res.json({ status: 'ok', serverId: id, policy: serverPolicy.policyForServer(id) });
  });

  app.put('/api/mcp/servers/:id/policy', express.json(), (req, res) => {
    const id = String(req.params.id || '');
    const knownIds = new Set(settings.listMcpServers().map((s) => s.id));
    const tools = manager.listServerTools(id);
    const checked = serverPolicy.validatePatch(id, req.body || {}, {
      knownServerIds: knownIds,
      connectedTools: tools.ok ? tools.tools.map((t) => t && t.name).filter(Boolean) : null,
    });
    if (!checked.ok) {
      const status = checked.error === 'server_not_found' ? 404 : 400;
      res.status(status).json({ status: 'error', error: checked.error, diagnostics: checked.diagnostics });
      return;
    }
    const saved = serverPolicy.writeStore(checked.nextStore);
    if (!saved.ok) {
      res.status(400).json({ status: 'error', error: 'policy_rejected', diagnostics: [saved] });
      return;
    }
    res.json({
      status: 'ok',
      serverId: id,
      policy: checked.policy,
      diagnostics: checked.diagnostics,
    });
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

  // BLOCK-204（W5）— 逐工具策略面（v1 无设置页，API 为唯一写面；漂移门按 NO_UI_FAMILIES 登记）
  app.get('/api/mcp/tool-policy', (_req, res) => {
    const store = toolPolicy.readStore();
    res.json({
      status: 'ok',
      projectionLimit: toolPolicy.projectionLimit(store),
      defaultProjectionLimit: toolPolicy.DEFAULT_PROJECTION_LIMIT,
      defaults: { ...toolPolicy.DEFAULTS },
      policies: store.tools,
      projectedTools: projection.projectedToolNames(),
    });
  });

  app.put('/api/mcp/tool-policy', express.json(), (req, res) => {
    const patch = req.body || {};
    // unknown-tool 判定需要"当前投影"作为已知集合；已有策略条目也算已知（离线仍可改/删）
    const known = projection.projectedToolNames();
    const checked = toolPolicy.validatePatch(patch, known);
    if (!checked.ok) {
      res.status(400).json({ status: 'error', error: 'tool_policy_rejected', diagnostics: checked.diagnostics });
      return;
    }
    const saved = toolPolicy.writeStore(checked.nextStore);
    if (!saved.ok) {
      res.status(400).json({ status: 'error', error: 'tool_policy_rejected', diagnostics: saved.diagnostics });
      return;
    }
    res.json({ status: 'ok', ...saved.store });
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
