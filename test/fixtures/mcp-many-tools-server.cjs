#!/usr/bin/env node
/**
 * BLOCK-241 测试夹具 — 多工具 MCP stdio server（零依赖 JSON-RPC）。
 *
 * 工具数 > 测试阈值，用于验证“大目录只投影 catalog/call”；
 * 工具名/annotations 覆盖 blocked/disabled/readOnly/destructive/openWorld。
 */

'use strict';

const readline = require('node:readline');

const rl = readline.createInterface({ input: process.stdin, terminal: false });

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function result(id, payload) {
  send({ jsonrpc: '2.0', id, result: payload });
}

const TOOLS = [
  {
    name: 'many_echo',
    description: '回显消息',
    inputSchema: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] },
  },
  {
    name: 'many_readonly',
    description: '只读查询',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'many_destructive',
    description: '破坏性操作',
    inputSchema: { type: 'object', properties: { target: { type: 'string' } } },
    annotations: { destructiveHint: true },
  },
  {
    name: 'many_openworld',
    description: '开放世界查询',
    inputSchema: { type: 'object', properties: { url: { type: 'string' } } },
    annotations: { openWorldHint: true },
  },
  {
    name: 'many_blocked',
    description: '被服务级策略阻断',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'many_disabled',
    description: '被逐工具策略停用',
    inputSchema: { type: 'object', properties: {} },
  },
];

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let req;
  try { req = JSON.parse(trimmed); } catch { return; }
  const { id, method, params } = req;
  if (id === undefined || id === null) return;

  if (method === 'initialize') {
    result(id, {
      protocolVersion: params && params.protocolVersion ? params.protocolVersion : '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'petri-many-tools-fixture', version: '1.0.0' },
    });
    return;
  }
  if (method === 'tools/list') {
    result(id, { tools: TOOLS });
    return;
  }
  if (method === 'tools/call') {
    const name = params && params.name;
    const tool = TOOLS.find((item) => item.name === name);
    if (!tool) {
      result(id, { content: [{ type: 'text', text: `unknown tool: ${name}` }], isError: true });
      return;
    }
    const args = params && params.arguments ? params.arguments : {};
    result(id, { content: [{ type: 'text', text: `called:${name}:${JSON.stringify(args)}` }] });
    return;
  }
  result(id, {});
});
