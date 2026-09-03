import { describe, it } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// BLOCK-51 测试基建修复（与 agent-concurrency.test.mjs 同一修复）：conversation-adapter
// 依赖链模块顶层即 prepare projects——先跑生产 migration 链再加载。
const require = createRequire(import.meta.url);
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-conv-adapter-'));
process.env.BIOF3_DB_PATH = path.join(tempDir, 'conv-adapter.db');
const { runMigrations } = require('../src/migration-runner');
await runMigrations(process.env.BIOF3_DB_PATH, path.join(__dirname, '../src/migrations'));

function resolve(...segments) {
  return path.resolve(__dirname, '..', ...segments);
}

describe('agent-runner-conversation-adapter.test.mjs (BLOCK-14 PHASE 3.1 message/conversation helpers)', () => {
  it('buildConversationMetadata normalizes guest vs user audience and tolerates null inputs', () => {
    const ca = require(resolve('core/biof3-server/conversation-adapter.js'));
    assert.strictEqual(typeof ca.buildConversationMetadata, 'function');

    // user audience with full context
    const userMeta = ca.buildConversationMetadata(
      { page: '/workspace', projectId: 'p1' },
      { id: 'c1', title: 'T1' },
      false,
    );
    assert.deepStrictEqual(userMeta, {
      conversationId: 'c1',
      page: '/workspace',
      projectId: 'p1',
      audience: 'user',
    });

    // guest audience (no DB, no project — must still produce a clean envelope)
    const guestMeta = ca.buildConversationMetadata(null, null, true);
    assert.strictEqual(guestMeta.audience, 'guest');
    assert.strictEqual(guestMeta.conversationId, null);
    assert.strictEqual(guestMeta.page, null);
    assert.strictEqual(guestMeta.projectId, null);
  });

  it('announceActiveConversation emits the conversation event with id+title and is a no-op for null conv (session-isolation guard)', () => {
    const ca = require(resolve('core/biof3-server/conversation-adapter.js'));

    // active conv present → emit {event, conversationId, title}
    const captured = [];
    ca.announceActiveConversation(
      (e) => captured.push(e),
      { id: 'c_iso', title: 'Isolated Session' },
    );
    assert.strictEqual(captured.length, 1);
    assert.strictEqual(captured[0].event, 'conversation');
    assert.strictEqual(captured[0].conversationId, 'c_iso');
    assert.strictEqual(captured[0].title, 'Isolated Session');

    // null/undefined _activeConv must NOT call emitFn (session-isolation guard:
    // a guest request without a conversation must not trigger any conversation event)
    const captured2 = [];
    ca.announceActiveConversation((e) => captured2.push(e), null);
    ca.announceActiveConversation((e) => captured2.push(e), undefined);
    assert.strictEqual(captured2.length, 0, 'no emit when _activeConv is null/undefined');

    // emitFn that throws must be swallowed (best-effort)
    ca.announceActiveConversation(() => { throw new Error('boom'); }, { id: 'c2', title: 'T2' });
  });

  it('appendAssistantMessage fail-closed envelope returns {persisted:false, shifted:false} for empty/whitespace assistantAcc, missing userId, missing conversationId', () => {
    const ca = require(resolve('core/biof3-server/conversation-adapter.js'));
    assert.strictEqual(typeof ca.appendAssistantMessage, 'function');

    // empty assistantAcc → fail-closed before any DB write
    const empty = ca.appendAssistantMessage({
      conversationId: 'c1',
      assistantAcc: '',
      userId: 'u1',
      taskId: 't1',
      context: { page: '/x' },
      turnStartedAt: 1,
    });
    assert.deepStrictEqual(empty, { persisted: false, shifted: false });

    // whitespace-only assistantAcc → fail-closed
    const ws = ca.appendAssistantMessage({
      conversationId: 'c1',
      assistantAcc: '   \n\t  ',
      userId: 'u1',
      taskId: 't1',
      context: null,
      turnStartedAt: 1,
    });
    assert.deepStrictEqual(ws, { persisted: false, shifted: false });

    // missing userId → fail-closed (auth gate before persistence)
    const noUser = ca.appendAssistantMessage({
      conversationId: 'c1',
      assistantAcc: 'real assistant text',
      userId: null,
      taskId: 't1',
      context: null,
      turnStartedAt: 1,
    });
    assert.deepStrictEqual(noUser, { persisted: false, shifted: false });

    // missing conversationId → fail-closed (session-isolation gate)
    const noConv = ca.appendAssistantMessage({
      conversationId: null,
      assistantAcc: 'real assistant text',
      userId: 'u1',
      taskId: 't1',
      context: null,
      turnStartedAt: 1,
    });
    assert.deepStrictEqual(noConv, { persisted: false, shifted: false });
  });
});
