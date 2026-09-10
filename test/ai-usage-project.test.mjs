// BLOCK-78 P2-② — 项目级用量聚合零网络测试。
// summarizeProjectUsage：conversation 归因项目（JOIN copilot_conversations）、
// user 过滤、无会话上下文行不计入、partial/estimated 成本口径。
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const tempRoot = mkdtempSync(join(tmpdir(), 'block78-usage-'));
process.env.BIOF3_DB_PATH = join(tempRoot, 'usage.db');
process.env.BIOF3_LOCAL_DATA_DIR = join(tempRoot, 'local-data');

const require = createRequire(import.meta.url);
{
  const Database = require(resolve(__dirname, '..', 'core', 'biof3-server', 'node_modules', 'better-sqlite3'));
  const boot = new Database(process.env.BIOF3_DB_PATH);
  const migDir = resolve(__dirname, '..', 'src', 'migrations');
  for (const f of require('node:fs').readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort()) {
    boot.exec(require('node:fs').readFileSync(require('node:path').resolve(migDir, f), 'utf8'));
  }
  boot.close();
}

const { recordAiUsage, summarizeProjectUsage } = require('../core/biof3-server/helpers/ai-usage.js');
// conversations helper 建 copilot_conversations 表（require 即建）
require('../core/biof3-server/helpers/conversations.js');
const db = require('../core/biof3-server/db');
const sqlite = db.getDatabase();

function insertConversation(id, projectId) {
  sqlite.prepare(`INSERT INTO copilot_conversations (id, user_id, title, status, project_id, message_count, created_at, updated_at)
    VALUES (?, 'u1', 't', 'active', ?, 0, '2026-09-10T00:00:00Z', '2026-09-10T00:00:00Z')`).run(id, projectId);
}

test('summarizeProjectUsage：conversation 归因项目 + user 过滤 + 无会话行排除', () => {
  insertConversation('conv_p1', 'proj_p1');
  insertConversation('conv_p2', 'proj_p2');

  recordAiUsage({ userId: 'u1', kind: 'chat', model: 'deepseek-chat', promptTokens: 100, completionTokens: 50, latencyMs: 900, costCny: 0.5, conversationId: 'conv_p1' });
  recordAiUsage({ userId: 'u1', kind: 'chat', model: 'deepseek-chat', promptTokens: 10, completionTokens: 5, latencyMs: 100, conversationId: 'conv_p1', cacheReadTokens: 10 });
  recordAiUsage({ userId: 'u1', kind: 'chat', model: 'm', promptTokens: 7, completionTokens: 3, latencyMs: 50, conversationId: 'conv_p2' }); // cost unknown
  recordAiUsage({ userId: 'u1', kind: 'chat', model: 'm', promptTokens: 999, completionTokens: 999, latencyMs: 50, conversationId: null }); // 无会话上下文 → 不计入任何项目

  const p1 = summarizeProjectUsage({ projectId: 'proj_p1', userId: 'u1' });
  assert.equal(p1.calls, 2);
  assert.equal(p1.inputTokens, 110);
  assert.equal(p1.outputTokens, 55);
  assert.ok(Math.abs(p1.estimatedCostCny - 0.5) < 1e-9);
  // 第二次调用未传 costCny → cost_status=unknown → 项目口径 partial（诚实降级）
  assert.equal(p1.unknownCostCalls, 1);
  assert.equal(p1.costStatus, 'partial');
  assert.ok(Math.abs(p1.cacheHitRate - 10 / 110) < 1e-9);

  const p2 = summarizeProjectUsage({ projectId: 'proj_p2', userId: 'u1' });
  assert.equal(p2.calls, 1);
  assert.equal(p2.costStatus, 'partial', '未知价格调用 → partial 口径');
  assert.equal(p2.unknownCostCalls, 1);

  const none = summarizeProjectUsage({ projectId: 'proj_none', userId: 'u1' });
  assert.equal(none.calls, 0);
  assert.equal(none.estimatedCostCny, 0);
});

test('summarizeProjectUsage：无 projectId 防御返回零形状', () => {
  const empty = summarizeProjectUsage({});
  assert.equal(empty.calls, 0);
  assert.equal(empty.costStatus, 'estimated');
});
