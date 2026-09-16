'use strict';

/**
 * BLOCK-93 P3 — 角色指令注入实机级验证（真实 agent-runner + mock 上游）。
 *
 * 不 fake runAgentLoop：spawn_agent 走真实 launchSubAgent → 真实 runAgentLoop →
 * 真实 system prompt 组装；模型上游为本地 mock OpenAI 兼容 SSE 端点（捕获请求体）。
 *
 * 断言：
 *   1) spawn role=search → 子 loop 实发 system prompt 含「【角色：检索】」指令片段
 *   2) 无 role → system prompt 不含角色块（additive 红线）
 *   3) 两轮子 agent 均经真实链路跑到终态（completed）
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R_SERVER = path.resolve(__dirname, '..', 'core', 'biof3-server');
const require = createRequire(import.meta.url);

// 临时 DB 自举（须在 require db.js 前生效）
{
  const Database = require(path.join(R_SERVER, 'node_modules', 'better-sqlite3'));
  const tempDbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-block93-live-db-'));
  const boot = new Database(path.join(tempDbDir, 'biof3.db'));
  const migrationsDir = path.resolve(__dirname, '..', 'src', 'migrations');
  for (const f of fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    boot.exec(fs.readFileSync(path.join(migrationsDir, f), 'utf8'));
  }
  boot.close();
  process.env.BIOF3_DB_PATH = path.join(tempDbDir, 'biof3.db');
}

// ── mock OpenAI 兼容上游：捕获请求体 + 回最小 SSE 收敛 ──────────
const captured = [];
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    try {
      const parsed = JSON.parse(body);
      captured.push({
        system: String(parsed.messages?.find((m) => m.role === 'system')?.content || ''),
        model: parsed.model,
      });
    } catch {}
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: {"id":"mock-1","choices":[{"delta":{"role":"assistant","content":"好的，已完成。"},"finish_reason":null}]}\n\n');
    res.write('data: {"id":"mock-1","choices":[{"delta":{},"finish_reason":"stop"}]}\n\n');
    res.write('data: [DONE]\n\n');
    res.end();
  });
});
const baseUrl = await new Promise((resolve) => {
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    resolve(`http://127.0.0.1:${port}`);
  });
});

const agentTaskStore = require(path.join(R_SERVER, 'agent-task-store.js'));
const { saveAiSettings } = require(path.join(R_SERVER, 'helpers', 'ai-settings.js'));
const spawnTools = require(path.join(R_SERVER, 'agent-tools', 'spawn-agent-tools.js'));

const USER = 'u_block93_live';
let PARENT_ID = null;

before(() => {
  // mock 上游不校验鉴权——env 提供占位 key 满足网关前置校验
  process.env.DEEPSEEK_API_KEY = 'mock-key-block93';
  // seed 模型配置：profile/preset 同指 mock 上游（gateway 按 profileId 解析）
  saveAiSettings({
    model_profiles: [{ id: 'deepseek', provider: 'deepseek', model: 'mock-model', baseUrl }],
    chat_model_presets: [{ id: 'deepseek', provider: 'deepseek', model: 'mock-model', label: 'mock', baseUrl }],
    active_chat_model_id: 'deepseek',
  });
  // 父任务参数带 provider/baseUrl/modelName → spawn 继承链合成 preset 指向 mock 上游
  PARENT_ID = agentTaskStore.createAgentTask({
    status: 'running',
    agentStatus: 'running',
    userId: USER,
    params: {
      messages: [{ role: 'user', content: '父任务' }],
      context: { accessMode: 'full' },
      kind: 'primary',
      providerName: 'deepseek',
      modelName: 'mock-model',
      baseUrl,
    },
  }).taskId;
});

const ctx = () => ({ taskId: PARENT_ID, userId: USER, accessMode: 'full' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitTerminal(agentId, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const task = agentTaskStore.getAgentTask(agentId);
    if (task && ['completed', 'failed', 'cancelled'].includes(task.status)) return task;
    if (Date.now() > deadline) return task;
    await sleep(200);
  }
}

describe('BLOCK-93 P3 — 角色指令注入（真实 agent-runner 链路）', () => {
  test('spawn role=search：子 loop 实发 system prompt 含角色指令片段，且跑到终态', async () => {
    const res = await spawnTools.spawn_agent({ task: '检索相关代码', role: 'search' }, ctx());
    assert.equal(res.ok, true);
    const task = await waitTerminal(res.agentId);
    if (task && task.status !== 'completed') console.log('CHILD ERROR:', task.error);
    assert.equal(task && task.status, 'completed', `子 agent 未收敛：${task && task.status} ${task && task.error}`);
    const hit = captured.find((c) => c.system.includes('【角色：检索】'));
    assert.ok(hit, `system prompt 未含角色片段：${captured.map((c) => c.system.slice(0, 80)).join(' | ')}`);
    assert.ok(hit.system.includes('workspace_search'), '指令片段含检索工具引导');
  });

  test('无 role：system prompt 不含角色块（additive 红线），链路照常收敛', async () => {
    const before = captured.length;
    const res = await spawnTools.spawn_agent({ task: '普通任务' }, ctx());
    assert.equal(res.ok, true);
    const task = await waitTerminal(res.agentId);
    assert.equal(task && task.status, 'completed');
    const mine = captured.slice(before);
    assert.ok(mine.length >= 1, '至少一次上游请求');
    for (const c of mine) {
      assert.ok(!c.system.includes('子智能体角色专职约束'), '无 role 时零注入');
    }
  });
});
