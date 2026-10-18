/**
 * BLOCK-205（runlist W6）— 记忆与压缩策略：**拆前基线** + 生效接线契约。
 *
 * 基线（先冻结再改实现）：九个数的默认值必须逐字等于接线前的模块常量，
 * 外加一个只读的嵌入模型 id。任何一件变了 = "未配置=零行为变化" 的承诺破了。
 *
 * 生效（改完必须真的改行为）：压缩触发/保留条数、检索参数、TTL 与批次上限都要在
 * **调用时**读到策略值——不是只把数字搬进文件。
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'b205-memory-policy-'));
process.env.PETRI_LOCAL_DATA_DIR = dir;

const policy = require(path.join(ROOT, 'core/petri-server/helpers/memory-policy.js'));
const compaction = require(path.join(ROOT, 'core/petri-server/helpers/conversation-compaction.js'));

const rows = (n, chars = 40) => Array.from({ length: n }, (_, i) => ({
  rowid: i + 1,
  role: i % 2 === 0 ? 'user' : 'assistant',
  content: 'x'.repeat(chars),
}));

test('BLOCK-205 基线 — 九个数逐字等于接线前的模块常量', () => {
  assert.deepEqual({ ...policy.DEFAULTS }, {
    compactionTriggerTokens: 12_000,
    compactionMinMessages: 24,
    compactionKeepRecent: 12,
    compactionSummaryBudgetChars: 60_000,
    memoryTopK: 3,
    memoryThreshold: 0.55,
    memoryMaxChars: 1_500,
    autoFactTtlDays: 90,
    decayBatchLimit: 200,
    embeddingModel: 'text-embedding-v3',
  });
  // 压缩模块导出的常量就是基线值（声明处引用，不是第二份真值）
  assert.equal(compaction.COMPACTION_TRIGGER_TOKENS, 12_000);
  assert.equal(compaction.MIN_MESSAGES, 24);
  assert.equal(compaction.KEEP_RECENT, 12);
});

test('BLOCK-205 基线 — 未配置时压缩判定与接线前一致（12K 阈值 / 24 条 / 保留 12）', () => {
  policy.resetMemoryPolicy();
  // 24 条 × 40 字符 ≈ 远低于 12K token ⇒ 不触发
  assert.equal(compaction.planCompaction(rows(30)).should, false);
  // 消息数不足 24 ⇒ 即便 token 超也不触发（判定顺序未变）
  const huge = rows(20, 5000);
  assert.equal(compaction.planCompaction(huge).should, false);
  // 条数与 token 都超过 ⇒ 触发，且保留恰好 12 条
  const plan = compaction.planCompaction(rows(30, 5000));
  assert.equal(plan.should, true);
  assert.equal(plan.keepRows.length, 12);
  assert.equal(plan.coveredRows.length, 18);
});

test('BLOCK-205 — 策略真的生效：改阈值/最少条数/保留条数改变折叠计划', () => {
  const saved = policy.writeStore({ compactionTriggerTokens: 2000, compactionMinMessages: 4, compactionKeepRecent: 5 });
  assert.equal(saved.ok, true, `写入应通过：${JSON.stringify(saved.diagnostics)}`);

  // 同样的 8 条小消息：默认不触发，改完触发
  const small = rows(8, 2000);
  const plan = compaction.planCompaction(small);
  assert.equal(plan.should, true);
  assert.equal(plan.keepRows.length, 5, 'keepRecent 来自策略');
  assert.equal(plan.coveredRows.length, 3);

  const snapshot = policy.effectiveSnapshot();
  assert.equal(snapshot.sources.compactionTriggerTokens, 'file');
  assert.equal(snapshot.sources.memoryTopK, 'default');
  policy.resetMemoryPolicy();
});

test('BLOCK-205 — 检索/生命周期参数按策略装配（默认与覆盖两条路）', () => {
  policy.resetMemoryPolicy();
  assert.deepEqual(policy.memorySettings(), { topK: 3, threshold: 0.55, maxChars: 1500, embeddingModel: 'text-embedding-v3' });
  assert.deepEqual(policy.lifecycleSettings(), { autoFactTtlMs: 90 * 24 * 60 * 60 * 1000, decayBatchLimit: 200 });

  assert.equal(policy.writeStore({ memoryTopK: 7, memoryThreshold: 0.8, memoryMaxChars: 800, autoFactTtlDays: 30, decayBatchLimit: 50 }).ok, true);
  const memory = policy.memorySettings();
  assert.equal(memory.topK, 7);
  assert.equal(memory.threshold, 0.8);
  assert.equal(memory.maxChars, 800);
  const lifecycle = policy.lifecycleSettings();
  assert.equal(lifecycle.autoFactTtlMs, 30 * 24 * 60 * 60 * 1000);
  assert.equal(lifecycle.decayBatchLimit, 50);
  policy.resetMemoryPolicy();
});

test('BLOCK-205 — 写侧守卫：未知键 400 语义、越界拒绝、嵌入模型只读', () => {
  assert.ok(policy.validatePatch({ nope: 1 }).some((d) => d.code === 'unknown-key'));
  assert.ok(policy.validatePatch({ memoryTopK: 99 }).some((d) => d.code === 'out-of-range'));
  const readonly = policy.validatePatch({ embeddingModel: 'text-embedding-v2' });
  assert.ok(readonly.some((d) => d.code === 'read-only'), '嵌入模型必须只读（换模型=换向量维度）');
  assert.equal(policy.writeStore({ embeddingModel: 'text-embedding-v3' }).ok, false);
  // 整批不落盘：一个非法键 ⇒ 文件不产生
  policy.resetMemoryPolicy();
  assert.equal(policy.writeStore({ memoryTopK: 5, bogus: 1 }).ok, false);
  assert.equal(fs.existsSync(policy.policyFilePath()), false, '拒绝写 = 一个字节都不落');
});

test('BLOCK-205 — 读侧宽容 + 落点走数据根单源', () => {
  assert.equal(policy.policyFilePath(), path.join(dir, 'memory-policy.json'));
  fs.writeFileSync(policy.policyFilePath(), JSON.stringify({ compactionTriggerTokens: 9000, junk: 1, memoryTopK: 999 }), 'utf8');
  const stored = policy.readStored();
  assert.deepEqual(stored.values, { compactionTriggerTokens: 9000 }, '越界/未注册键读侧丢弃，合法键保留');
  assert.ok(stored.diagnostics.some((d) => d.code === 'out-of-range'));
  assert.ok(stored.diagnostics.some((d) => d.code === 'unknown-key'));
  assert.equal(policy.compactionSettings().triggerTokens, 9000);
  assert.equal(policy.compactionSettings().keepRecent, 12, '未写的键回落默认');
  policy.resetMemoryPolicy();
});
