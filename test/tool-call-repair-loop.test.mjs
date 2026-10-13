/**
 * BLOCK-179 P1 — 正文工具块修复提升：runLoop 集成用例（mock provider 裸驱，
 * harness 同 block109-p0-baseline：内存 DB 自举 + scripted callChatProvider）。
 *
 * 钉住：
 * ① 正文退化（围栏 JSON 工具调用、无原生 tool_calls）→ tool_call_repair 透明事件
 *    → 提升为真实调用（tool_call/tool_result 事件在场）→ 下一轮正常收口。
 * ② 会话历史形态：assistant 消息保留退化原文（诚实审计）+ 修复后 tool_calls。
 * ③ 未知名正文（演示/文档形态）→ 零修复零事件，按最终回答收口（存量行为不变）。
 */
import assert from 'node:assert/strict';
import fssync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import test from 'node:test';

const __filename = fileURLToPath(import.meta.url);
const here = path.dirname(__filename);
const root = path.resolve(here, '..');
const require = createRequire(import.meta.url);

// 内存 DB 自举（同 block34/block109 先例：loop-orchestrator 依赖链顶层即 prepare）
{
  const Database = require('better-sqlite3');
  const tempDbDir = fssync.mkdtempSync(path.join(os.tmpdir(), 'petri-b179-repair-'));
  const db = new Database(path.join(tempDbDir, 'petri.db'));
  const migrationsDir = path.join(root, 'src', 'migrations');
  for (const file of fssync.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(fssync.readFileSync(path.join(migrationsDir, file), 'utf8'));
  }
  db.close();
  process.env.PETRI_DB_PATH = path.join(tempDbDir, 'petri.db');
  process.on('exit', () => {
    try { fssync.rmSync(tempDbDir, { recursive: true, force: true }); } catch { /* Windows 句柄延迟释放 */ }
  });
}

const { runLoop } = require(path.join(root, 'core', 'petri-server', 'loop-orchestrator.js'));

const DEGRADED_TEXT = [
  '我来查一下系统信息。',
  '',
  '```json',
  '{"name": "system_info", "arguments": {}}',
  '```',
].join('\n');

function baseConfig() {
  return {
    userId: 'u_b179',
    modelName: 'repair-model',
    kind: 'primary',
    contextWindow: 24000,
    executionPolicy: { allowExecution: false },
    context: {},
    // BLOCK-179 — 修复提升的可用名单口径 = config.tools（run 声明面）
    tools: [{
      type: 'function',
      function: { name: 'system_info', description: 'system probe', parameters: { type: 'object', properties: {} } },
    }],
  };
}

const baseArgs = (events) => ({
  messages: [{ role: 'user', content: '检查系统信息' }],
  toolCtx: { accessMode: 'read', userId: 'u_b179' },
  shouldAbort: () => false,
  emitToolResult: () => {},
  emitAssistant: (e) => events.push(e),
  emitDone: () => {},
  conversationState: {},
});

test('BLOCK-179 ① — 正文退化工具块 → 修复事件 + 真实执行 + 正常收口', async () => {
  const events = [];
  const roundBodies = [];
  let round = 0;
  const result = await runLoop({
    ...baseArgs(events),
    callChatProvider: async (_p, _k, reqBody, _t, onEvent) => {
      round += 1;
      roundBodies.push(reqBody);
      if (round === 1) {
        onEvent({ type: 'content_delta', content: DEGRADED_TEXT });
        return {
          choices: [{ message: { role: 'assistant', content: DEGRADED_TEXT }, finish_reason: 'stop' }],
        };
      }
      onEvent({ type: 'content_delta', content: '修复后收口：一切正常。' });
      return { choices: [{ message: { role: 'assistant', content: '修复后收口：一切正常。' }, finish_reason: 'stop' }] };
    },
    config: baseConfig(),
  });

  const repairEvent = events.find((e) => e.event === 'agent_status' && e.phase === 'tool_call_repair');
  assert.ok(repairEvent, 'tool_call_repair 透明事件在场');
  assert.equal(repairEvent.repaired, 1);
  assert.deepEqual(repairEvent.tools, ['system_info']);
  assert.ok(typeof repairEvent.message === 'string' && repairEvent.message.includes('修复'), '用户可读消息在场');

  assert.ok(events.find((e) => e.event === 'tool_call' && e.name === 'system_info'), '提升后工具真实执行（tool_call 事件）');
  assert.ok(events.find((e) => e.event === 'tool_result'), 'tool_result 事件在场');
  assert.equal(result.assistantText, '修复后收口：一切正常。', '下一轮正常收口');

  // ② 会话历史形态：第 2 轮请求里 assistant 消息 = 退化原文（诚实保留）+ 修复后 tool_calls
  const secondTurnMessages = roundBodies[1] && roundBodies[1].messages;
  const repairedAssistant = secondTurnMessages && secondTurnMessages.find(
    (m) => m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0,
  );
  assert.ok(repairedAssistant, '第 2 轮请求含带 tool_calls 的 assistant 消息');
  assert.ok(repairedAssistant.content.includes('system_info'), '退化原文保留在历史（可审计）');
  assert.equal(repairedAssistant.tool_calls[0].function.name, 'system_info');
});

test('BLOCK-179 ③ — 未知名正文（演示形态）→ 零修复，按最终回答收口（存量行为不变）', async () => {
  const events = [];
  let providerCalls = 0;
  const demoText = '调用示例：{"name": "totally_fake_tool", "arguments": {}}';
  const result = await runLoop({
    ...baseArgs(events),
    callChatProvider: async (_p, _k, _b, _t, onEvent) => {
      providerCalls += 1;
      onEvent({ type: 'content_delta', content: demoText });
      return { choices: [{ message: { role: 'assistant', content: demoText }, finish_reason: 'stop' }] };
    },
    config: baseConfig(),
  });

  assert.equal(providerCalls, 1, '未触发修复 → 单轮收口');
  assert.equal(result.assistantText, demoText, '正文原样作为最终回答（存量行为）');
  assert.ok(!events.find((e) => e.event === 'agent_status' && e.phase === 'tool_call_repair'), '零修复事件');
  assert.ok(!events.find((e) => e.event === 'tool_call'), '零工具执行');
});
