/**
 * BLOCK-189 — 出站归一化断言/哨兵防作弊 + 禁 sleep 门 契约单测（纯函数 + 源码/套件扫描，离线无后端）。
 * 守：①outbound_contains 命中/未命中/无上下文 fail-closed 三态；②哨兵防作弊可证伪
 *     （伪造成功事件但无真实出站→红，真实出站含哨兵→绿）；③「禁 sleep」从口头转机械门
 *     （evaluateCriterion 不读时钟/不睡眠 + 套件判据 kind ∈ 确定性白名单）。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { evaluateCriterion } from '../scripts/lib/evals-harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('outbound_contains：命中/未命中/无上下文 fail-closed 三态', () => {
  const outbound = [
    { model: 'm', messages: [{ role: 'system', content: '[项目] evals-golden-first-success (id=p_aaaaaaaa_bbbb)' }, { role: 'user', content: 'hi' }] },
  ];
  assert.equal(evaluateCriterion({ kind: 'outbound_contains', value: 'evals-golden-first-success' }, { outbound }).passed, true);
  assert.equal(evaluateCriterion({ kind: 'outbound_contains', value: 'NOPE-xyz-99' }, { outbound }).passed, false);
  assert.equal(evaluateCriterion({ kind: 'outbound_contains', value: 'evals-golden-first-success', minTimes: 2 }, { outbound }).passed, false);
  assert.equal(evaluateCriterion({ kind: 'outbound_contains', value: 'x' }, {}).passed, false, '无 ctx.outbound 必须 fail-closed 红');
});

test('哨兵防作弊可证伪：伪造 completed 事件但无真实出站 → 哨兵缺席 → 红', () => {
  const fabricated = { completed: true, outbound: [] };
  assert.equal(evaluateCriterion({ kind: 'outbound_contains', value: 'SENTINEL_ABC123' }, fabricated).passed, false);
  const genuine = { completed: true, outbound: [{ messages: [{ role: 'system', content: '... 上下文含 SENTINEL_ABC123 ...' }] }] };
  assert.equal(evaluateCriterion({ kind: 'outbound_contains', value: 'SENTINEL_ABC123' }, genuine).passed, true);
});

test('哨兵防作弊：易变值归一化后哨兵仍锚定（复用 normalizeContextString 同一清单）', () => {
  const outbound = [{ messages: [{ role: 'system', content: '项目 evals-SENTINEL 路径 C:\\Users\\bob\\T\\petri-evals-r4nd0m\\projects\\evals-SENTINEL-x9z8\\.petri\\gen-ui\\conv_deadbeef-11 id=p_aaaaaaaa_bbbb' }] }];
  assert.equal(evaluateCriterion({ kind: 'outbound_contains', value: 'evals-SENTINEL' }, { outbound, tmpRoot: '/tmp' }).passed, true, '易变 path/id 被归一但项目名哨兵保留');
});

// ── 禁 sleep 机械门 ──────────────────────────────
test('禁 sleep 门：evaluateCriterion 函数体内不读时钟/不睡眠', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'lib', 'evals-harness.mjs'), 'utf8');
  const start = src.indexOf('export function evaluateCriterion');
  assert.ok(start >= 0, 'evaluateCriterion 须存在');
  const end = src.indexOf('export function', start + 10);
  const body = src.slice(start, end > start ? end : undefined);
  assert.doesNotMatch(body, /Date\.now\(\)/, '判据评估不得读 Date.now 作 PASS 条件');
  assert.doesNotMatch(body, /setTimeout|sleep/, '判据评估不得睡眠');
});

test('禁 sleep 门：全部套件判据 kind ∈ 确定性白名单（无时钟/睡眠类 kind）', () => {
  const ALLOWED = new Set([
    'task_completed', 'final_answer_contains', 'tool_used', 'tool_not_used', 'policy_denied',
    'no_policy_denial', 'event_present', 'file_contains', 'tool_succeeded', 'deny_after_success',
    'tool_error', 'no_successful_exec', 'subagent_completed', 'task_terminal_status',
    'genui_fragment_resolves', 'funnel_event_present', 'ttfs_computable', 'outbound_contains',
  ]);
  const suitesDir = path.join(ROOT, 'evals', 'suites');
  const seen = new Set();
  for (const suite of fs.readdirSync(suitesDir)) {
    const dir = path.join(suitesDir, suite);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      const task = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      for (const c of task.criteria || []) {
        seen.add(c.kind);
        assert.ok(ALLOWED.has(c.kind), `套件 ${suite}/${f} 判据 kind「${c.kind}」不在确定性白名单（禁新增时钟/睡眠类判据）`);
        assert.doesNotMatch(c.kind, /sleep|wait|delay|timer|clock/i, `kind「${c.kind}」疑似依赖时钟/睡眠`);
      }
    }
  }
  assert.ok(seen.has('outbound_contains'), 'golden 套件应已启用 outbound_contains（防作弊第三腿在册）');
});
