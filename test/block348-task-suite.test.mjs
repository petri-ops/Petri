import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TASKS_PATH = path.join(ROOT, 'acceptance/block-348/tasks.json');
const RUNNER_PATH = path.join(ROOT, 'scripts/block348-task-runner.mjs');

// harness evaluateCriterion 支持的 kind（BLOCK-181）+ BLOCK-348 自定义 kind
const HARNESS_KINDS = new Set([
  'task_completed', 'final_answer_contains', 'tool_used', 'tool_not_used', 'policy_denied',
  'tool_succeeded', 'deny_after_success', 'tool_error', 'no_successful_exec', 'no_policy_denial',
  'event_present', 'file_contains', 'subagent_completed', 'task_terminal_status',
  'genui_fragment_resolves', 'funnel_event_present', 'ttfs_computable', 'outbound_contains',
]);
const CUSTOM_KINDS = new Set([
  'tool_output_contains', 'file_unmodified', 'min_tool_calls', 'file_contains_all', 'file_min_length',
]);

const REQUIRED_FIELDS = ['id', 'title', 'domain', 'prompt', 'accessMode', 'timeoutMs', 'seedWorkspace', 'expectedArtifacts', 'criteria', 'toolSelectJudge', 'artifactJudge'];

// 判据表冻结指纹（跑前冻结，总纲 §2.5「判据表在跑之前写死并留时间戳」）：
// sha256(JSON.stringify(tasks.map(t=>({id,criteria})))).slice(0,16)。
// 改判据 = 本测试红 = 必须显式说明口径变更理由并重跑全量实测，禁止静默调口径。
const FROZEN_CRITERIA_HASH = '4b69b2d092bcae22';

function loadTasks() {
  return JSON.parse(fs.readFileSync(TASKS_PATH, 'utf8'));
}

test('block348: 任务集 8 项、id 唯一、必备字段齐全', () => {
  const doc = loadTasks();
  assert.equal(doc.tasks.length, 8, `任务数应为 8，实际 ${doc.tasks.length}`);
  const ids = doc.tasks.map((t) => t.id);
  assert.equal(new Set(ids).size, 8, '任务 id 必须唯一');
  for (const t of doc.tasks) {
    for (const f of REQUIRED_FIELDS) {
      assert.ok(t[f] !== undefined && t[f] !== null && t[f] !== '', `${t.id} 缺字段 ${f}`);
    }
    assert.ok(Array.isArray(t.criteria) && t.criteria.length >= 3, `${t.id} 判据表至少 3 条`);
    assert.ok(Array.isArray(t.toolSelectJudge) && t.toolSelectJudge.length >= 2, `${t.id} 工具选择判据至少 2 项`);
    assert.ok(Array.isArray(t.artifactJudge) && t.artifactJudge.length >= 2, `${t.id} 产物判据至少 2 项`);
  }
});

test('block348: 判据 kind 全部在白名单（harness + 自定义）', () => {
  const doc = loadTasks();
  for (const t of doc.tasks) {
    for (const c of t.criteria) {
      assert.ok(typeof c.kind === 'string' && (HARNESS_KINDS.has(c.kind) || CUSTOM_KINDS.has(c.kind)),
        `${t.id} 未知判据 kind：${c.kind}`);
    }
  }
});

test('block348: 种子路径安全（相对路径、无 ..、无绝对路径）', () => {
  const doc = loadTasks();
  for (const t of doc.tasks) {
    for (const s of t.seedWorkspace) {
      assert.ok(!path.isAbsolute(s.path), `${t.id} 种子路径必须相对：${s.path}`);
      assert.ok(!s.path.split('/').includes('..'), `${t.id} 种子路径不得越界：${s.path}`);
      assert.ok(typeof s.content === 'string', `${t.id} 种子内容必须是字符串：${s.path}`);
    }
  }
});

test('block348: 超时上限有界（60s~1h）', () => {
  const doc = loadTasks();
  for (const t of doc.tasks) {
    assert.ok(Number.isFinite(t.timeoutMs) && t.timeoutMs >= 60_000 && t.timeoutMs <= 3_600_000,
      `${t.id} timeoutMs 越界：${t.timeoutMs}`);
  }
});

test('block348: 判据表冻结时间戳在场且合法 ISO', () => {
  const doc = loadTasks();
  const at = doc.$meta && doc.$meta.criteriaFrozenAt;
  assert.ok(at, '$meta.criteriaFrozenAt 缺失（判据表必须先冻结后跑）');
  assert.ok(!Number.isNaN(Date.parse(at)), `criteriaFrozenAt 非 ISO：${at}`);
  assert.match(String(doc.$meta.frozenNote || ''), /冻结|写死/, '冻结说明在场');
});

test('block348: 判据表不可变校验（冻结指纹）', () => {
  const doc = loadTasks();
  const fp = crypto.createHash('sha256')
    .update(JSON.stringify(doc.tasks.map((t) => ({ id: t.id, criteria: t.criteria }))))
    .digest('hex').slice(0, 16);
  assert.equal(fp, FROZEN_CRITERIA_HASH,
    `判据表指纹漂移：${fp} ≠ ${FROZEN_CRITERIA_HASH}（改判据=口径变更，须显式说明并重跑全量实测）`);
});

test('block348: T7 长任务场景要素齐备（窗口覆盖 / 压缩判据 / 20 FACT / 步数下限）', () => {
  const doc = loadTasks();
  const t7 = doc.tasks.find((t) => t.id === 't7-long-haul');
  assert.ok(t7, '缺 t7-long-haul');
  assert.equal(t7.windowOverride, 20000, 'T7 必须带窗口覆盖（压缩场景确定性触发）');
  const kinds = t7.criteria.map((c) => c.kind);
  assert.ok(kinds.includes('event_present'), 'T7 须断言 context_compacted 事件在场');
  const compact = t7.criteria.find((c) => c.kind === 'event_present');
  assert.equal(compact.event, 'context_compacted');
  const all = t7.criteria.find((c) => c.kind === 'file_contains_all');
  assert.ok(all && all.values.length === 20, 'T7 须断言 20 个 FACT 标记');
  const minCalls = t7.criteria.find((c) => c.kind === 'min_tool_calls');
  assert.ok(minCalls && minCalls.min >= 35, 'T7 步数下限 ≥35');
});

test('block348: runner 语法有效且实现全部自定义判据 kind', () => {
  const src = fs.readFileSync(RUNNER_PATH, 'utf8');
  for (const kind of CUSTOM_KINDS) {
    assert.ok(src.includes(`'${kind}'`), `runner 未实现自定义判据 ${kind}`);
  }
  execFileSync(process.execPath, ['--check', RUNNER_PATH], { stdio: 'pipe' });
});

test('block348: impact-map 已登记（tasks.json / runner / 测试 / 文档）', () => {
  const map = JSON.parse(fs.readFileSync(path.join(ROOT, 'test/impact-map.json'), 'utf8'));
  const rule = (map.rules || []).find((r) => r.id === 'block348-universal-agent-eval');
  assert.ok(rule, 'impact-map 缺 block348-universal-agent-eval 规则');
  const pats = JSON.stringify(rule.patterns);
  for (const frag of ['acceptance/block-348/**', 'scripts/block348-*.mjs', 'test/block348-*.test.mjs', 'docs/block-348-*.md']) {
    assert.ok(pats.includes(frag), `impact-map 规则缺 ${frag}`);
  }
  assert.ok(rule.tests.includes('test/block348-task-suite.test.mjs'), 'impact-map 规则须挂本测试');
});
