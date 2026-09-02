/**
 * BLOCK-34 P1 — 工具活动快照随会话消息落库。
 *
 * 根因回归：task 链路 agent-runner 此前对 appendAssistantMessage 显式传
 * `assistantToolActivities: null` → meta_json 不含工具记录 → 任务完成后前端
 * re-conciliation 用持久化消息覆盖内存快照时工具记录消失。
 *
 * 覆盖：
 * - 静态契约：runLoop 返回 assistantToolActivities；agent-runner 解构并传入
 *   落库调用（不得再传 null 字面量）
 * - 行为：createToolActivityRecorder 记录 call/result 后经 conversation-adapter
 *   落库，copilot_messages 的 meta_json 携带 toolActivities 快照
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
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

// 内存 DB 自举（同 agent-workspace-exec-background.test.mjs）
{
  const Database = require('better-sqlite3');
  const tempDbDir = fssync.mkdtempSync(path.join(os.tmpdir(), 'biof3-block34-p1-db-'));
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

describe('BLOCK-34 P1 static contract: tool activities recorder reaches message persistence', () => {
  it('runLoop return includes assistantToolActivities', async () => {
    const src = fs.readFileSync(resolve('core/biof3-server/loop-orchestrator.js'), 'utf8');
    const returnIdx = src.lastIndexOf('return {');
    const returnBlock = src.slice(returnIdx);
    assert.ok(
      /(^|[\s,{])assistantToolActivities([\s,:}])/.test(returnBlock),
      'runLoop return block must include assistantToolActivities',
    );
  });

  it('agent-runner destructures the recorder and no longer passes null to appendAssistantMessage', () => {
    const src = fs.readFileSync(resolve('core/biof3-server/agent-runner.js'), 'utf8');
    const destructureIdx = src.indexOf('await runLoop({');
    const head = src.slice(0, destructureIdx);
    assert.ok(
      /assistantToolActivities,/.test(head),
      'agent-runner must destructure assistantToolActivities from runLoop result',
    );
    const tail = src.slice(destructureIdx);
    assert.ok(
      tail.includes('assistantToolActivities: assistantToolActivities || null'),
      'agent-runner must forward the recorder to conversation persistence',
    );
    assert.ok(
      !tail.includes('assistantToolActivities: null'),
      'agent-runner must not pass a null literal for assistantToolActivities (BLOCK-34 root cause)',
    );
  });
});

describe('BLOCK-34 P1 behavior: recorder snapshot lands in copilot_messages.meta_json', () => {
  it('appendAssistantMessage persists toolActivities snapshot into message meta', () => {
    const { createToolActivityRecorder } = require(resolve('core/biof3-server/agent-tools'));
    const ca = require(resolve('core/biof3-server/conversation-adapter.js'));

    // 建会话（appendAssistantMessage 需要 conversationId 存在）
    const conversations = require(resolve('core/biof3-server/helpers/conversations.js'));
    const conv = conversations.getOrCreateActiveConversation('u_block34', { title: 'block34-p1', page: 'desktop-project', projectId: 'p_block34' });
    const conversationId = conv.id || conv.conversationId;
    assert.ok(conversationId, 'conversation must be created');

    const recorder = createToolActivityRecorder();
    recorder.recordCall({ name: 'workspace_exec', args: { command: 'echo hi' }, traceId: 'tr1', callId: 'call_1', iteration: 1 });
    recorder.recordResult({
      toolResult: { tool: 'workspace_exec', callId: 'call_1', status: 'success', durationMs: 42 },
      summary: '执行 echo hi',
    });

    const result = ca.appendAssistantMessage({
      conversationId,
      assistantAcc: '任务已完成。',
      context: { page: 'desktop-project', projectId: 'p_block34' },
      userId: 'u_block34',
      turnStartedAt: Date.now() - 1000,
      assistantProgress: null,
      resultEditProgress: null,
      assistantToolActivities: recorder,
      assistantResultCards: [],
      loopRunId: null,
      loopState: null,
      cancellationObserved: false,
      finalizationAttempts: 0,
      finalizationFailureReason: null,
      finalizationRouting: null,
      toolCallController: null,
      taskId: 'task_block34_p1',
      emitFn: () => {},
    });
    assert.strictEqual(result.persisted, true, 'message must persist');

    const Database = require('better-sqlite3');
    const db = new Database(process.env.BIOF3_DB_PATH, { readonly: true });
    try {
      const row = db.prepare(
        "SELECT meta_json FROM copilot_messages WHERE conversation_id = ? AND role = 'assistant' ORDER BY id DESC LIMIT 1",
      ).get(conversationId);
      assert.ok(row, 'assistant message row must exist');
      const meta = JSON.parse(row.meta_json || '{}');
      assert.ok(Array.isArray(meta.toolActivities), 'meta.toolActivities must be an array');
      assert.strictEqual(meta.toolActivities.length, 1);
      assert.strictEqual(meta.toolActivities[0].name, 'workspace_exec');
      assert.strictEqual(meta.toolActivities[0].status, 'success');
      assert.strictEqual(meta.toolActivities[0].durationMs, 42);
    } finally {
      db.close();
    }
  });

  it('UI-273: buildToolResultEvent and recorder snapshot carry changeDiff for write ops', () => {
    const { createToolActivityRecorder } = require(resolve('core/biof3-server/agent-tools'));
    const { buildToolResultEvent } = require(resolve('core/biof3-server/agent-tools/tool-events'));

    const changeDiff = {
      added: 2,
      removed: 1,
      truncated: false,
      hunks: [{
        oldStart: 1,
        newStart: 1,
        lines: [
          { type: 'ctx', text: 'alpha' },
          { type: 'del', text: 'beta' },
          { type: 'add', text: 'beta2' },
          { type: 'add', text: 'gamma' },
        ],
      }],
    };

    // changeDiff 挂 toolResult 顶层（独立于 data）
    const evt = buildToolResultEvent({
      contractVersion: '1', traceId: 'tr', callId: 'call_d', tool: 'workspace_write',
      status: 'success', durationMs: 5, data: { ok: true, path: 'a.txt', created: true, changeDiff },
    });
    assert.ok(evt.toolResult.changeDiff, 'changeDiff must be present at toolResult level');
    assert.strictEqual(evt.toolResult.changeDiff.added, 2);
    assert.strictEqual(evt.toolResult.changeDiff.hunks.length, 1);

    // data 超限被 publicData 截断时 changeDiff 仍存活
    const evt2 = buildToolResultEvent({
      contractVersion: '1', traceId: 'tr', callId: 'call_e', tool: 'workspace_write',
      status: 'success', durationMs: 5,
      data: { ok: true, path: 'a.txt', changeDiff, filler: 'x'.repeat(3000) },
    });
    assert.strictEqual(evt2.toolResult.previewTruncated, true);
    assert.ok(evt2.toolResult.changeDiff, 'changeDiff must survive publicData truncation');

    // recorder 快照：recordResult 提取 changeDiff 随消息落库
    const recorder = createToolActivityRecorder();
    recorder.recordCall({ name: 'workspace_write', args: { path: 'a.txt' }, traceId: 'tr', callId: 'call_e', iteration: 1 });
    recorder.recordResult({ ...evt2, iteration: 1 });
    const snap = recorder.snapshot();
    assert.ok(snap[0].changeDiff, 'persisted activity must include changeDiff');
    assert.strictEqual(snap[0].changeDiff.added, 2);
    assert.strictEqual(snap[0].changeDiff.hunks.length, 1);

    // 只读工具不产生 changeDiff
    const evtRead = buildToolResultEvent({
      contractVersion: '1', traceId: 'tr', callId: 'call_r', tool: 'workspace_read',
      status: 'success', durationMs: 5, data: { ok: true, path: 'a.txt' },
    });
    assert.strictEqual(evtRead.toolResult.changeDiff, undefined);
  });
});
