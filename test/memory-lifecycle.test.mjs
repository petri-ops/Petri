/**
 * BLOCK-182-MEMORY-LIFECYCLE — 记忆生命周期单源测试（隔离 DB，红绿先行）。
 * 覆盖：惰性衰减（TTL/pinned/manual 豁免）/纠错替代链/矛盾消解合并/全链审计/
 * 注入面仅 active + policy memory 维度审批门。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-memory-lifecycle-'));
process.env.PETRI_DB_PATH = path.join(tempDir, 'memory-lifecycle.db');

const require = createRequire(import.meta.url);
const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));

const { runMigrations } = require('../src/migration-runner');
await runMigrations(process.env.PETRI_DB_PATH, path.join(TEST_DIR, '../src/migrations'));

const lifecycle = require('../core/petri-server/helpers/memory-lifecycle');
const userFacts = require('../core/petri-server/helpers/user-facts');
const dbMod = require('../core/petri-server/db');
const policy = require('../core/petri-server/agent-tools/agent-tool-policy');

const sqlite = dbMod.getDatabase();
const USER = 'user-ml';

// 先触发 user_facts 懒建表（迁移不含该表——运行时 _ensureTable 建）。
await userFacts.listUserFactsAsync(USER, 10);

function insertFact({ id, content, category = 'preference', source = 'auto', pinned = 0, ageDays = 0, status = 'active' }) {
  const ts = new Date(Date.now() - ageDays * 86400_000).toISOString();
  sqlite.prepare(
    `INSERT INTO user_facts(id, user_id, category, content, pinned, source, project_id, status, last_confirmed_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?)`
  ).run(id, USER, category, content, pinned, source, status, ts, ts);
}

test('惰性衰减：TTL 未确认 auto 事实转 decayed，pinned/manual/近期豁免', () => {
  insertFact({ id: 'f_old_auto', content: '用户在做 DEG 分析', ageDays: 120 });
  insertFact({ id: 'f_old_pinned', content: '用户的核心方向是免疫组库', pinned: 1, ageDays: 400 });
  insertFact({ id: 'f_old_manual', content: '用户偏好 PyMC', source: 'manual', ageDays: 400 });
  insertFact({ id: 'f_recent', content: '用户正在学 scVI', ageDays: 3 });

  const decayed = lifecycle.lazyDecayFacts(sqlite, USER);
  const statusOf = (id) => sqlite.prepare('SELECT status FROM user_facts WHERE id=?').get(id).status;
  assert.ok(decayed >= 1, '至少衰减 TTL 超期 auto 事实');
  assert.equal(statusOf('f_old_auto'), 'decayed', 'TTL 超期 auto → decayed');
  assert.equal(statusOf('f_old_pinned'), 'active', 'pinned 永不衰减');
  assert.equal(statusOf('f_old_manual'), 'active', 'manual 永不衰减');
  assert.equal(statusOf('f_recent'), 'active', '未到 TTL 不衰减');
  const audit = lifecycle.listAudit(sqlite, USER, 50).filter((e) => e.action === 'decay');
  assert.ok(audit.some((e) => e.factId === 'f_old_auto'), '衰减动作入审计');
});

test('用户纠错流（免费直生效）：旧事实 superseded 替代链+修正行 active+双审计', () => {
  insertFact({ id: 'f_wrong', content: '用户使用 Stan 做贝叶斯建模' });
  const newId = lifecycle.supersedeWithCorrection(sqlite, {
    userId: USER, oldFactId: 'f_wrong', category: 'preference', content: '用户使用 PyMC 做贝叶斯建模',
  });
  assert.notEqual(newId, 'f_wrong');
  const oldRow = sqlite.prepare('SELECT status, superseded_by FROM user_facts WHERE id=?').get('f_wrong');
  assert.equal(oldRow.status, 'superseded');
  assert.equal(oldRow.superseded_by, newId);
  const newRow = sqlite.prepare('SELECT status, source, content FROM user_facts WHERE id=?').get(newId);
  assert.equal(newRow.status, 'active');
  assert.equal(newRow.source, 'manual');
  assert.match(newRow.content, /PyMC/);
  const actions = lifecycle.listAudit(sqlite, USER, 50).map((e) => e.action);
  assert.ok(actions.includes('correction') && actions.includes('supersede'));
});

test('矛盾消解（合并语义）：规范化等值命中刷新确认+审计 merge；不等值不误合', () => {
  insertFact({ id: 'f_dup', content: '用户偏好 SCTransform 预处理' });
  const hit = lifecycle.findMergeableFact(sqlite, USER, 'preference', '用户偏好  sctransform 预处理');
  assert.ok(hit && hit.id === 'f_dup', '大小写/空白规范化等值命中');
  lifecycle.markConfirmed(sqlite, { userId: USER, factId: hit.id, detail: { via: 'extract' } });
  const row = sqlite.prepare('SELECT last_confirmed_at FROM user_facts WHERE id=?').get('f_dup');
  assert.ok(row.last_confirmed_at, '合并刷新 last_confirmed_at');
  const miss = lifecycle.findMergeableFact(sqlite, USER, 'preference', '用户偏好 Seurat 预处理');
  assert.ok(!miss, '不等值不误合');
  const actions = lifecycle.listAudit(sqlite, USER, 50).map((e) => e.action);
  assert.ok(actions.includes('merge'));
});

test('注入面过滤：buildFactsBlock 只含 active，superseded/decayed 不进 prompt', () => {
  insertFact({ id: 'f_live', content: '用户的研究方向是空间转录组' });
  insertFact({ id: 'f_dead', content: '用户的研究方向是单细胞注释', status: 'superseded' });
  insertFact({ id: 'f_rot', content: '用户的研究方向是聚类', status: 'decayed' });
  const block = userFacts.buildFactsBlock(USER, 1200);
  assert.match(block, /空间转录组/);
  assert.doesNotMatch(block, /单细胞注释/);
  assert.doesNotMatch(block, /用户的研究方向是聚类/);
});

test('policy memory 维度：workspace_write 命中 MEMORY.md → require-ack 审批门', () => {
  const hit = policy.evaluateDynamicGuards('workspace_write', { path: '.petri/MEMORY.md', content: 'x' });
  assert.equal(hit.flagged, true);
  assert.equal(hit.dimension, 'memory');
  assert.ok(hit.guardKey.startsWith('memory:'));
  const backslash = policy.evaluateDynamicGuards('workspace_replace', { path: '.petri\\MEMORY.md', content: 'x' });
  assert.equal(backslash.flagged, true, 'Windows 反斜杠路径同判');
  const miss = policy.evaluateDynamicGuards('workspace_write', { path: 'notes/normal.md', content: 'x' });
  assert.equal(miss.flagged, false, '普通写入不拦');
  const readSide = policy.evaluateDynamicGuards('workspace_read', { path: '.petri/MEMORY.md' });
  assert.equal(readSide.flagged, false, '读不拦（审批门只限写通道）');
});

test('policy 全链：MEMORY.md 写入 deny 信封 require-ack→ack 放行', () => {
  const { getToolContract } = require('../core/petri-server/agent-tools/registry');
  const contract = getToolContract('workspace_write');
  assert.ok(contract, 'workspace_write 契约在册');
  const guardKey = policy.evaluateDynamicGuards('workspace_write', { path: '.petri/MEMORY.md' }).guardKey;
  const denied = policy.decideAgentToolCall({
    name: 'workspace_write',
    args: { path: '.petri/MEMORY.md', content: 'x' },
    contract,
    ctx: { accessMode: 'full', dynamicGuardAcks: new Set() },
    preflight: { ok: true, exists: false, relativePath: '.petri/MEMORY.md' },
  });
  assert.equal(denied.decision, 'deny', '未 ack 拦截');
  assert.equal(denied.error, 'dynamic_guard_triggered');
  assert.ok(String(denied.message || '').includes('memory:'), 'deny 信封带 memory guardKey');
  const allowed = policy.decideAgentToolCall({
    name: 'workspace_write',
    args: { path: '.petri/MEMORY.md', content: 'x' },
    contract,
    ctx: { accessMode: 'full', dynamicGuardAcks: new Set([guardKey]) },
    preflight: { ok: true, exists: false, relativePath: '.petri/MEMORY.md' },
  });
  assert.notEqual(allowed.decision, 'deny', '维度级 ack 放行');
});
