/**
 * item88 第一波 HK-01：迁移/flag、状态机全轮转、隔离互踩、任务书 schema、文档链+计量。
 * 权威设计：petri-workbench-design-v1.md §3.3/§4.2①/§4.4/§4.5/§9/§10。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'item88-db-'));
const dbPath = path.join(temp, 'petri.db');
process.env.PETRI_DB_PATH = dbPath;
process.env.PETRI_DECISION_CONFIG_PATH = path.join(temp, 'decision.json');
const { runMigrations } = require_(path.join(ROOT, 'src', 'migration-runner.js'));
await runMigrations(dbPath, path.join(ROOT, 'src', 'migrations'));
process.on('exit', () => { try { fs.rmSync(temp, { recursive: true, force: true }); } catch {} });

const Database = require_(path.join(ROOT, 'core', 'petri-server', 'node_modules', 'better-sqlite3'));
const db = new Database(dbPath, { readonly: true });

test('HK-01 迁移025四表在册且幂等；workbench flag 默认 off', async () => {
  await runMigrations(dbPath, path.join(ROOT, 'src', 'migrations'));
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
  for (const table of ['wb_goals', 'wb_tasks', 'wb_documents', 'wb_changes']) {
    assert.ok(names.includes(table), `${table} 应在册`);
  }
  const { getPointRuntime } = require_(path.join(ROOT, 'core', 'petri-server', 'helpers', 'decision-config.js'));
  assert.equal(getPointRuntime('workbench').enabled, false, 'workbench.enabled 默认 off');
});

test('HK-01 状态机全轮转、任意态可取消、非法跳转拒绝', () => {
  const { STATES, transitionRun } = require_(path.join(ROOT, 'core', 'petri-server', 'helpers', 'workbench-state-machine.js'));
  const events = ['confirm', 'queue', 'start', 'submit_review', 'accept'];
  let state = 'draft';
  for (const event of events) {
    const next = transitionRun(state, event);
    assert.equal(next.ok, true, `${state} --${event}--> ?`);
    state = next.state;
  }
  assert.equal(state, 'accepted');
  assert.ok(STATES.includes('needs-user') && STATES.includes('approval') && STATES.includes('rework'));
  assert.equal(transitionRun('draft', 'cancel').state, 'cancelled');
  assert.equal(transitionRun('running', 'cancel').state, 'cancelled');
  assert.equal(transitionRun('accepted', 'start').ok, false, '终态不可再启动');
});

test('HK-01 隔离互踩：两子任务工作区不同，同写一文件互不可见，重复 attach 被拒', () => {
  const { deriveTaskWorktree, checkTaskWorktreeConflict } = require_(path.join(ROOT, 'core', 'petri-server', 'helpers', 'workbench-isolation.js'));
  const a = deriveTaskWorktree({ dataDir: temp, taskId: 'task-a' });
  const b = deriveTaskWorktree({ dataDir: temp, taskId: 'task-b' });
  assert.notEqual(a.root, b.root);
  assert.notEqual(a.branch, b.branch);
  fs.mkdirSync(a.root, { recursive: true });
  fs.mkdirSync(b.root, { recursive: true });
  fs.writeFileSync(path.join(a.root, 'shared.ts'), 'from A');
  assert.equal(fs.existsSync(path.join(b.root, 'shared.ts')), false);
  assert.ok(checkTaskWorktreeConflict([a, b], b).length > 0, '重复 attach 应被契约拒绝');
});

test('HK-01 任务书 schema 缺验收标准即红（requireAcceptanceCriteria）', () => {
  const { validateScientificTaskSpec } = require_(path.join(ROOT, 'core', 'shared-backend', 'scientific-task-spec.js'));
  const hash = 'a'.repeat(64);
  const base = {
    schemaVersion: 1, taskId: 'wb_t1', projectId: 'p_demo', conversationId: 'c_demo',
    originalRequest: '比较 KO 与 WT 的差异表达',
    question: { domain: 'transcriptomics', analysisUnit: 'biological_sample', questionType: 'differential_expression' },
    inputs: [{ id: 'counts', role: 'counts', relativePath: 'data/counts.csv', sha256: hash, sizeBytes: 120, schemaSummary: { columns: 8 } }],
    method: { category: 'differential_expression', candidateToolIds: ['deseq2'], selectionReason: 'counts' },
    requestedDeliverables: ['deg_table'], requiresUserDecision: [],
    clarification: { questionsAsked: [], confidence: 'high', userDecisions: [] },
    execution: { accessMode: 'read', automationMode: 'guided', decisionPolicyVersion: 1, resourcePolicyVersion: 1, resourceSnapshotRef: null },
    presentation: { language: 'zh-CN', explanationLevel: 'guided' },
    status: 'ready_for_confirmation',
  };
  const bad = { ...base };
  delete bad.acceptanceCriteria;
  const badResult = validateScientificTaskSpec(bad, { requireAcceptanceCriteria: true });
  assert.equal(badResult.ok, false);
  assert.ok(badResult.issues.some((i) => i.code === 'acceptance_criteria_required'));
  const good = validateScientificTaskSpec({ ...base, acceptanceCriteria: ['AC-1 产物存在'] }, { requireAcceptanceCriteria: true });
  assert.equal(good.ok, true);
});

test('HK-01 文档链 append-only + 计量按 taskId 聚合', () => {
  const { appendWorkbenchDoc, verifyWorkbenchDocChain } = require_(path.join(ROOT, 'core', 'petri-server', 'helpers', 'workbench-docs.js'));
  const writer = new Database(dbPath);
  const docs = [
    appendWorkbenchDoc(writer, { id: 'doc-1', type: 'task-book', version: 1, content: { goal: 'g' } }),
    appendWorkbenchDoc(writer, { id: 'doc-2', type: 'acceptance', version: 1, content: { ac: 'AC-1' } }),
  ];
  assert.equal(verifyWorkbenchDocChain(docs).ok, true);
  const tampered = docs.map((d, i) => (i === 1 ? { ...d, content: { ac: 'tampered' } } : d));
  assert.equal(verifyWorkbenchDocChain(tampered).ok, false);
  const src = read('core/petri-server/helpers/workbench-docs.js');
  assert.doesNotMatch(src, /UPDATE\s+wb_documents|DELETE\s+FROM\s+wb_documents/);

  const { recordAiUsage, summarizeTaskUsage } = require_(path.join(ROOT, 'core', 'petri-server', 'helpers', 'ai-usage.js'));
  recordAiUsage({ userId: 'u1', taskId: 'task-a', kind: 'chat', model: 'deepseek-flash', promptTokens: 100, completionTokens: 50, latencyMs: 200, costCny: 0.01, costStatus: 'estimated' });
  const usage = summarizeTaskUsage({ taskId: 'task-a' });
  assert.equal(usage.calls, 1);
  assert.ok(usage.totalTokens >= 150);
  writer.close();
});
