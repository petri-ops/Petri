#!/usr/bin/env node
/**
 * BLOCK-156 测试夹具 — 零依赖 MCP stdio server（newline-delimited JSON-RPC 2.0）。
 *
 * 供 client-manager 单测/路由测试/实机回环共用：工具集 = fixture_echo（确定性）。
 * 协议面 = MCP initialize / notifications/initialized / tools/list / tools/call / ping。
 */

'use strict';

const readline = require('readline');

const rl = readline.createInterface({ input: process.stdin, terminal: false });

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function result(id, payload) {
  send({ jsonrpc: '2.0', id, result: payload });
}

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let req;
  try {
    req = JSON.parse(trimmed);
  } catch {
    return;
  }
  const { id, method, params } = req;
  // 通知（无 id）不回包
  if (id === undefined || id === null) return;

  switch (method) {
    case 'initialize':
      result(id, {
        protocolVersion: params && params.protocolVersion ? params.protocolVersion : '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'gewu-fixture-mcp', version: '1.0.0' },
      });
      break;
    case 'tools/list':
      result(id, {
        tools: [
          {
            name: 'fixture_echo',
            description: '回显输入消息（BLOCK-156 连接/投影夹具）',
            inputSchema: {
              type: 'object',
              properties: { message: { type: 'string', description: '要回显的消息' } },
              required: ['message'],
            },
          },
        ],
      });
      break;
    case 'tools/call': {
      const name = params && params.name;
      const args = (params && params.arguments) || {};
      if (name === 'fixture_echo') {
        result(id, {
          content: [{ type: 'text', text: `echo: ${String(args.message ?? '')}` }],
        });
      } else {
        send({ jsonrpc: '2.0', id, error: { code: -32602, message: `unknown tool: ${name}` } });
      }
      break;
    }
    case 'ping':
      result(id, {});
      break;
    default:
      send({ jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${method}` } });
  }
});

rl.on('close', () => process.exit(0));
