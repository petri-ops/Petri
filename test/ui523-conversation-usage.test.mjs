// UI-523 — 会话级用量聚合零网络测试。
// summarizeConversationUsage：conversation+user 双过滤口径、cache 命中率与
// tok/s 数学自洽、无调用/无耗时（latency=0）时「不可算」而非 0。
// 口径与 ai_usage 落库同表同源（沿用 test/ai-usage-project.test.mjs 的临时库姿势）。
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const tempRoot = mkdtempSync(join(tmpdir(), 'ui523-usage-'));
process.env.PETRI_DB_PATH = join(tempRoot, 'usage.db');
process.env.PETRI_LOCAL_DATA_DIR = join(tempRoot, 'local-data');

const require = createRequire(import.meta.url);
{
  const Database = require(resolve(__dirname, '..', 'core', 'petri-server', 'node_modules', 'better-sqlite3'));
  const boot = new Database(process.env.PETRI_DB_PATH);
  const migDir = resolve(__dirname, '..', 'src', 'migrations');
  for (const f of require('node:fs').readdirSync(migDir).filter((name) => name.endsWith('.sql')).sort()) {
    boot.exec(require('node:fs').readFileSync(resolve(migDir, f), 'utf8'));
  }
  boot.close();
}

const { recordAiUsage, summarizeConversationUsage } = require('../core/petri-server/helpers/ai-usage.js');

test('summarizeConversationUsage：会话累计 + 缓存命中率 + 端到端平均输出速率', () => {
  recordAiUsage({ userId: 'u1', kind: 'agent_iter', model: 'deepseek-chat', promptTokens: 100, completionTokens: 50, latencyMs: 900, conversationId: 'conv_a', cacheReadTokens: 10 });
  recordAiUsage({ userId: 'u1', kind: 'agent_iter', model: 'deepseek-chat', promptTokens: 200, completionTokens: 100, latencyMs: 100, conversationId: 'conv_a', cacheReadTokens: 190 });

  const usage = summarizeConversationUsage({ conversationId: 'conv_a', userId: 'u1' });
  assert.equal(usage.calls, 2);
  assert.equal(usage.inputTokens, 300);
  assert.equal(usage.outputTokens, 150);
  assert.equal(usage.cacheReadTokens, 200);
  assert.equal(usage.cacheHitRate, 200 / 300);
  assert.equal(usage.latencyMs, 1000);
  // tokensPerSecond = 150 output ÷ (1000ms ÷ 1000) = 150（端到端平均，BLOCK-79 口径）
  assert.equal(usage.tokensPerSecond, 150);
});

test('summarizeConversationUsage：user_id 双过滤即所有权（他人会话不串号）', () => {
  recordAiUsage({ userId: 'u2', kind: 'agent_iter', model: 'deepseek-chat', promptTokens: 999, completionTokens: 999, latencyMs: 10, conversationId: 'conv_a' });
  recordAiUsage({ userId: 'u1', kind: 'agent_iter', model: 'deepseek-chat', promptTokens: 10, completionTokens: 5, latencyMs: 100, conversationId: 'conv_b' });

  const mine = summarizeConversationUsage({ conversationId: 'conv_a', userId: 'u1' });
  assert.equal(mine.inputTokens, 300, '不属于 u1 的行不得计入');
  const other = summarizeConversationUsage({ conversationId: 'conv_b', userId: 'u1' });
  assert.equal(other.inputTokens, 10);
  const stranger = summarizeConversationUsage({ conversationId: 'conv_a', userId: 'u3' });
  assert.equal(stranger.calls, 0);
  assert.equal(stranger.tokensPerSecond, null, '无调用时不可算，不是 0');
});

test('summarizeConversationUsage：无会话 id / 无耗时行 ⇒ 零值 + tokensPerSecond=null', () => {
  const noId = summarizeConversationUsage({});
  assert.equal(noId.calls, 0);
  assert.equal(noId.tokensPerSecond, null);

  recordAiUsage({ userId: 'u1', kind: 'agent_iter', model: 'deepseek-chat', promptTokens: 7, completionTokens: 3, latencyMs: 0, conversationId: 'conv_zero_latency' });
  const zeroLatency = summarizeConversationUsage({ conversationId: 'conv_zero_latency', userId: 'u1' });
  assert.equal(zeroLatency.calls, 1);
  assert.equal(zeroLatency.outputTokens, 3);
  assert.equal(zeroLatency.tokensPerSecond, null, 'latency=0 不得除零伪造成 0 或 Infinity');
});

test('summarizeConversationUsage：未配置 user 也不改过滤语义（与 summarizeAiUsage 同风格）', () => {
  const allUsers = summarizeConversationUsage({ conversationId: 'conv_a' });
  assert.equal(allUsers.calls, 3, '不传 userId 时只按会话口径聚合（调用方负责传所有权过滤）');
});
