// BLOCK-79 — 按供应商的 token 输出速率聚合 零网络测试。
// 锁四条契约：provider 归因落库 / 成对聚合口径（SUM÷SUM=端到端平均输出速率）/
// embedding 排除与 zero-usage 不可算 / 旧 NULL 行归「(未归因)」组。
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const tempRoot = mkdtempSync(join(tmpdir(), 'block79-provider-'));
process.env.PETRI_DB_PATH = join(tempRoot, 'provider.db');
process.env.PETRI_LOCAL_DATA_DIR = join(tempRoot, 'local-data');

const require = createRequire(import.meta.url);
{
  const Database = require(resolve(__dirname, '..', 'core', 'petri-server', 'node_modules', 'better-sqlite3'));
  const boot = new Database(process.env.PETRI_DB_PATH);
  const migDir = resolve(__dirname, '..', 'src', 'migrations');
  for (const f of require('node:fs').readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort()) {
    boot.exec(require('node:fs').readFileSync(require('node:path').resolve(migDir, f), 'utf8'));
  }
  boot.close();
}

const { recordAiUsage, summarizeProviderUsage } = require('../core/petri-server/helpers/ai-usage.js');
const db = require('../core/petri-server/db');
const sqlite = db.getDatabase();

test('recordAiUsage 落 provider 列；旧行 NULL 语义', () => {
  recordAiUsage({ userId: 'u1', kind: 'chat', model: 'deepseek-chat', provider: 'deepseek', promptTokens: 200, completionTokens: 100, latencyMs: 2000, costCny: 0.01 });
  const row = sqlite.prepare('SELECT provider, completion_tokens FROM ai_usage WHERE provider = ?').get('deepseek');
  assert.equal(row.provider, 'deepseek');
  assert.equal(row.completion_tokens, 100);
});

test('summarizeProviderUsage：成对聚合口径 + 按输出排序 + tps 计算', () => {
  // deepseek: 100 out / 2000ms；再加 300 out / 3000ms → 400/5000ms = 80 tok/s
  recordAiUsage({ userId: 'u1', kind: 'chat', model: 'deepseek-chat', provider: 'deepseek', promptTokens: 10, completionTokens: 300, latencyMs: 3000 });
  // dashscope: 50 out / 5000ms = 10 tok/s
  recordAiUsage({ userId: 'u1', kind: 'chat_turn', model: 'qwen-max', provider: 'dashscope', promptTokens: 10, completionTokens: 50, latencyMs: 5000 });
  // ollama：渠道未返回 usage → completion 0 → 不可算
  recordAiUsage({ userId: 'u1', kind: 'chat', model: 'llama3', provider: 'ollama', promptTokens: 10, completionTokens: 0, latencyMs: 900 });
  // embedding：必须被排除（不进任何分组）
  recordAiUsage({ userId: 'u1', kind: 'embedding', model: 'text-embedding-v3', provider: 'dashscope', promptTokens: 99999, completionTokens: 99999, latencyMs: 99999 });
  // 无归因旧行
  recordAiUsage({ userId: 'u1', kind: 'chat', model: 'legacy', promptTokens: 1, completionTokens: 2, latencyMs: 1000 });

  const rows = summarizeProviderUsage({ userId: 'u1' });
  const byName = Object.fromEntries(rows.map((r) => [r.provider, r]));

  const ds = byName['deepseek'];
  assert.ok(ds, 'deepseek 组存在');
  assert.equal(ds.outputTokens, 400);
  assert.equal(ds.latencyMs, 5000);
  assert.equal(ds.tokensPerSecond, 80, '400 tok / 5s = 80 tok/s');
  assert.equal(ds.measurable, true);

  const dq = byName['dashscope'];
  assert.ok(dq, 'dashscope 组存在（chat_turn 计入）');
  assert.equal(dq.tokensPerSecond, 10);

  const ol = byName['ollama'];
  assert.equal(ol.measurable, false, 'completion=0 → 不可算');
  assert.equal(ol.noUsageCalls, 1);

  const un = byName['(未归因)'];
  assert.ok(un, '旧行 provider NULL → 未归因组');

  // embedding 绝不出现在任何分组
  assert.ok(!rows.some((r) => r.provider === 'dashscope' && r.outputTokens >= 99999));
  assert.ok(rows.every((r) => r.inputTokens < 9999));
});

test('summarizeProviderUsage：since 窗口过滤', () => {
  const future = new Date(Date.now() + 3600 * 1000).toISOString();
  const rows = summarizeProviderUsage({ userId: 'u1', since: future });
  assert.equal(rows.length, 0);
});
