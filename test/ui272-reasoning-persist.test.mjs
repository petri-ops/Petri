/**
 * UI-272 — 模型思考段（reasoning_content）随会话消息落库。
 *
 * 根因回归：agent task 链路此前只有 routes/ai-agent/chat.js（legacy 直连路径）
 * 聚合思考段；真正落库走 agent-runner → loop-orchestrator → conversation-adapter，
 * 该链路 reasoning_delta 被静默丢弃、runLoop 不返回思考段 → copilot_messages
 * meta_json 永远缺 reasoningByIteration → 历史会话无法回看工具衔接思路。
 *
 * 覆盖：
 * - 静态契约：loop-orchestrator 流式回调处理 reasoning_delta（聚合 + SSE 下发）
 *   且 runLoop 返回 reasoningByIteration；agent-runner 解构并传入落库调用；
 * - 行为：conversation-adapter.appendAssistantMessage 将 reasoningByIteration
 *   写入 copilot_messages.meta_json；空对象不写键。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import fssync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolve(...segments) {
  return path.resolve(__dirname, '..', ...segments);
}

const require = createRequire(import.meta.url);

// 内存 DB 自举（同 block34-tool-activities-persist.test.mjs）
{
  const Database = require('better-sqlite3');
  const tempDbDir = fssync.mkdtempSync(path.join(os.tmpdir(), 'biof3-ui272-reasoning-db-'));
  const db = new Database(path.join(tempDbDir, 'biof3.db'));
  const migrationsDir = resolve('src/migrations');
  for (const file of fssync.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(fssync.readFileSync(path.join(migrationsDir, file), 'utf8'));
  }
  db.close();
  process.env.BIOF3_DB_PATH = path.join(tempDbDir, 'biof3.db');
  process.on('exit', () => {
    try {
      fssync.rmSync(tempDbDir, { recursive: true, force: true });
    } catch {
      // 清理失败不影响测试结果
    }
  });
}

describe('UI-272 static contract: reasoning reaches runLoop return and message persistence', () => {
  it('loop-orchestrator aggregates reasoning_delta in the streaming callback and returns reasoningByIteration', () => {
    const src = fssync.readFileSync(resolve('core/biof3-server/loop-orchestrator.js'), 'utf8');
    assert.ok(
      src.includes("event.type === 'reasoning_delta'"),
      'streaming callback must handle reasoning_delta events',
    );
    assert.ok(
      src.includes('reasoningByIteration[key]'),
      'streaming callback must accumulate reasoning per iteration',
    );
    assert.ok(
      src.includes('delta: { reasoning_content: event.content }'),
      'reasoning deltas must be forwarded to the frontend SSE frames',
    );
    const returnIdx = src.lastIndexOf('return {');
    const returnBlock = src.slice(returnIdx);
    assert.ok(
      /(^|[\s,{])reasoningByIteration([\s,:}])/.test(returnBlock),
      'runLoop return block must include reasoningByIteration',
    );
  });

  it('agent-runner destructures reasoningByIteration and forwards it to appendAssistantMessage', () => {
    const src = fssync.readFileSync(resolve('core/biof3-server/agent-runner.js'), 'utf8');
    const destructureIdx = src.indexOf('await runLoop({');
    const head = src.slice(0, destructureIdx);
    assert.ok(
      /reasoningByIteration,/.test(head),
      'agent-runner must destructure reasoningByIteration from runLoop result',
    );
    const tail = src.slice(destructureIdx);
    assert.ok(
      tail.includes('reasoningByIteration: reasoningByIteration && Object.keys(reasoningByIteration).length'),
      'agent-runner must forward reasoningByIteration to conversation persistence',
    );
  });
});

describe('UI-272 behavior: reasoningByIteration lands in copilot_messages.meta_json', () => {
  function persistAndReadMeta(reasoningByIteration) {
    const ca = require(resolve('core/biof3-server/conversation-adapter.js'));
    const conversations = require(resolve('core/biof3-server/helpers/conversations.js'));
    const conv = conversations.getOrCreateActiveConversation('u_ui272', { title: 'ui272-reasoning', page: 'desktop-project', projectId: 'p_ui272' });
    const conversationId = conv.id || conv.conversationId;
    assert.ok(conversationId, 'conversation must be created');

    const taskId = `task_ui272_${Math.random().toString(36).slice(2, 10)}`;
    const result = ca.appendAssistantMessage({
      conversationId,
      assistantAcc: '任务已完成。',
      context: { page: 'desktop-project', projectId: 'p_ui272' },
      userId: 'u_ui272',
      turnStartedAt: Date.now() - 1000,
      assistantProgress: null,
      resultEditProgress: null,
      assistantToolActivities: null,
      reasoningByIteration,
      assistantResultCards: [],
      loopRunId: null,
      loopState: null,
      cancellationObserved: false,
      finalizationAttempts: 0,
      finalizationFailureReason: null,
      finalizationRouting: null,
      toolCallController: null,
      taskId,
      emitFn: () => {},
    });
    assert.strictEqual(result.persisted, true, 'message must persist');

    const Database = require('better-sqlite3');
    const db = new Database(process.env.BIOF3_DB_PATH, { readonly: true });
    try {
      const row = db.prepare(
        "SELECT meta_json FROM copilot_messages WHERE task_id = ? AND role = 'assistant' LIMIT 1",
      ).get(taskId);
      assert.ok(row, 'assistant message row must exist');
      return JSON.parse(row.meta_json || '{}');
    } finally {
      db.close();
    }
  }

  it('persists reasoningByIteration into message meta', () => {
    const meta = persistAndReadMeta({ 1: '先看目录结构，再定位入口文件。', 2: '修改完成后运行测试验证。' });
    assert.ok(meta.reasoningByIteration, 'meta.reasoningByIteration must exist');
    assert.strictEqual(meta.reasoningByIteration['1'], '先看目录结构，再定位入口文件。');
    assert.strictEqual(meta.reasoningByIteration['2'], '修改完成后运行测试验证。');
  });

  it('does not write the key when reasoningByIteration is empty or missing', () => {
    const metaEmpty = persistAndReadMeta({});
    assert.ok(!('reasoningByIteration' in metaEmpty), 'empty reasoning must not add the meta key');
    const metaNull = persistAndReadMeta(null);
    assert.ok(!('reasoningByIteration' in metaNull), 'null reasoning must not add the meta key');
  });
});
