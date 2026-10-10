/**
 * BLOCK-113 W1-3 — 工具两跳预路由契约（分类接点 + 域收窄器 + 恒等红线）。
 *
 * 契约红线（plan docs/block-113-tool-prerouting-plan.md §1.1/§5）：
 *  - guard 关（PETRI_JEV_TOOL_ROUTE=1 显式开）＝零出站零行为变化；
 *  - 任何决策失败形态（缺 key/超时/校验失败）＝route=false 回退全量，永不 throw；
 *  - 采纳（argmax≠all 且 conf ≥ θ=0.80）→ 收窄=路由域 ∪ session 基础件；
 *  - 71 工具集合恒等：⋃ DOMAIN_TOOL_DEFS 与 TOOL_DEFS 逐引用一致（BLOCK-109 P2 红线）。
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import test from 'node:test';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const require = createRequire(import.meta.url);

const {
  TOOL_ROUTE_THRESHOLD,
  TOOL_FAMILIES,
  BASELINE_DOMAIN,
  buildToolRouteDecisionRequest,
  narrowToolDefsByFamily,
  resolveToolRoute,
} = require(path.join(root, 'core', 'petri-server', 'helpers', 'tool-router.js'));
const { TOOL_DEFS, DOMAIN_TOOL_DEFS } = require(path.join(root, 'core', 'petri-server', 'agent-tools', 'tool-defs.js'));

const NO_SLEEP = async () => {};
const GUARD_ON = { PETRI_JEV_TOOL_ROUTE: '1' };
const API_KEY_OVERRIDE = { apiKey: 'test-key-do-not-call-real-api' };

function useEnv(t, env) {
  const saved = {};
  for (const key of Object.keys(env)) {
    saved[key] = process.env[key];
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
  t.after(() => {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });
}

function okFetch(answer) {
  let calls = 0;
  const impl = async () => {
    calls++;
    return { ok: true, status: 200, json: async () => ({ model: 'jev-1.13.0', answers: { family: answer } }) };
  };
  return { impl, count: () => calls };
}

function errorFetch(name) {
  let calls = 0;
  const impl = async () => {
    calls++;
    const err = new Error(name);
    err.name = name;
    throw err;
  };
  return { impl, count: () => calls };
}

test('恒等红线：⋃ DOMAIN_TOOL_DEFS 与 TOOL_DEFS 逐引用一致（71 工具零变化）', () => {
  const union = Object.values(DOMAIN_TOOL_DEFS).flat();
  assert.equal(union.length, TOOL_DEFS.length);
  const b = new Set(union);
  assert.ok(TOOL_DEFS.every((t) => b.has(t)), '每个 TOOL_DEFS 成员都来自某域模块（同引用）');
  assert.deepEqual(Object.keys(DOMAIN_TOOL_DEFS).sort(),
    ['agent-orchestration', 'browser', 'computer', 'knowledge', 'remote', 'resident', 'result-studio', 'session', 'skill', 'workspace']);
});

test('D-1/D-3 定版契约：九域+all 类目集、session 底座、θ=0.80', () => {
  assert.deepEqual(Object.keys(TOOL_FAMILIES).sort(),
    ['agent-orchestration', 'all', 'browser', 'computer', 'knowledge', 'remote', 'resident', 'result-studio', 'session', 'workspace'].sort());
  assert.equal(BASELINE_DOMAIN, 'session');
  assert.equal(TOOL_ROUTE_THRESHOLD, 0.8, 'P0 校准 θ 定版（调整须先重校准）');
});

test('buildToolRouteDecisionRequest：state 截 600 字 + criteria 与类目集一致（校准同形）', () => {
  const { state, questions } = buildToolRouteDecisionRequest('画一个火山图');
  assert.match(state, /火山图/);
  assert.equal(questions.family.type, 'choice');
  assert.deepEqual(Object.keys(questions.family.criteria), Object.keys(TOOL_FAMILIES));
  assert.match(questions.family.instructions, /all/);
});

test('guard 默认关：零出站零行为变化（D-4）', async (t) => {
  useEnv(t, { PETRI_JEV_TOOL_ROUTE: undefined });
  const spy = errorFetch('TimeoutError');
  const r = await resolveToolRoute('画一个火山图', { ...API_KEY_OVERRIDE, fetchImpl: spy.impl, sleep: NO_SLEEP });
  assert.equal(r.route, false);
  assert.equal(r.reason, 'guard_disabled');
  assert.equal(spy.count(), 0, 'guard 关必须零出站');
});

test('guard 开 + 缺 key：no_key 回退全量', async (t) => {
  useEnv(t, { ...GUARD_ON, TYPESAFE_API_KEY: undefined });
  const r = await resolveToolRoute('画一个火山图', {});
  assert.equal(r.route, false);
  assert.equal(r.reason, 'no_key');
});

test('guard 开 + 超时：timeout 回退全量', async (t) => {
  useEnv(t, GUARD_ON);
  const spy = errorFetch('TimeoutError');
  const r = await resolveToolRoute('画一个火山图', { ...API_KEY_OVERRIDE, fetchImpl: spy.impl, sleep: NO_SLEEP });
  assert.equal(r.reason, 'timeout');
  assert.equal(r.route, false);
});

test('红线：choice 不在类目集内必拒（伪造域）', async (t) => {
  useEnv(t, GUARD_ON);
  const probs = {};
  for (const k of Object.keys(TOOL_FAMILIES)) probs[k] = 0.1;
  const spy = okFetch({ choice: '虚构域', probabilities: probs, confidence: 0.99 });
  const r = await resolveToolRoute('画一个火山图', { ...API_KEY_OVERRIDE, fetchImpl: spy.impl, sleep: NO_SLEEP });
  assert.equal(r.reason, 'invalid_response', '伪造域须被 wrapper 响应校验拒收');
  assert.equal(r.route, false);
});

test('弃权：family=all 高置信 → 不收窄（安全阀）', async (t) => {
  useEnv(t, GUARD_ON);
  const probs = { all: 1 };
  for (const k of Object.keys(TOOL_FAMILIES)) if (k !== 'all') probs[k] = 0;
  const spy = okFetch({ choice: 'all', probabilities: probs, confidence: 0.99 });
  const r = await resolveToolRoute('把整个项目分析一遍', { ...API_KEY_OVERRIDE, fetchImpl: spy.impl, sleep: NO_SLEEP });
  assert.equal(r.route, false);
  assert.equal(r.reason, 'family_all');
});

test('低置信：workspace + conf < 0.80 → 回退全量', async (t) => {
  useEnv(t, GUARD_ON);
  const probs = { workspace: 1 };
  for (const k of Object.keys(TOOL_FAMILIES)) if (k !== 'workspace') probs[k] = 0;
  const spy = okFetch({ choice: 'workspace', probabilities: probs, confidence: 0.55 });
  const r = await resolveToolRoute('帮我读一下 counts.csv', { ...API_KEY_OVERRIDE, fetchImpl: spy.impl, sleep: NO_SLEEP });
  assert.equal(r.route, false);
  assert.equal(r.reason, 'below_threshold');
});

test('采纳：workspace + conf ≥ 0.80 → route true', async (t) => {
  useEnv(t, GUARD_ON);
  const probs = { workspace: 0.9, knowledge: 0.02, 'result-studio': 0.02, browser: 0.02, computer: 0.01, 'agent-orchestration': 0.01, remote: 0.01, resident: 0.01, session: 0.0, all: 0.0 };
  const spy = okFetch({ choice: 'workspace', probabilities: probs, confidence: 0.9 });
  const r = await resolveToolRoute('帮我读一下 counts.csv', { ...API_KEY_OVERRIDE, fetchImpl: spy.impl, sleep: NO_SLEEP });
  assert.equal(r.route, true);
  assert.equal(r.family, 'workspace');
});

test('收窄器：workspace 路由 = workspace ∪ session（保序、无名 schema 保守保留）', () => {
  const narrowed = narrowToolDefsByFamily(TOOL_DEFS, 'workspace', DOMAIN_TOOL_DEFS);
  const names = narrowed.map((t) => t.function && t.function.name);
  assert.ok(names.includes('workspace_read'), '路由域工具在');
  assert.ok(names.includes('todo_write'), 'session 底座在');
  assert.ok(!names.includes('computer_click'), '他域工具被剔除');
  // 保序：narrowed 是 TOOL_DEFS 的子序列
  let pi = 0;
  for (const t of TOOL_DEFS) {
    if (pi < narrowed.length && t === narrowed[pi]) pi++;
  }
  assert.equal(pi, narrowed.length, '相对顺序保持');
  // 无名 schema 防御保留
  assert.equal(narrowToolDefsByFamily([{ type: 'function' }], 'workspace', DOMAIN_TOOL_DEFS).length, 1);
});

test('收窄器：未知域/缺映射 → 原样全量（保守）', () => {
  assert.equal(narrowToolDefsByFamily(TOOL_DEFS, '不存在域', DOMAIN_TOOL_DEFS), TOOL_DEFS);
  assert.equal(narrowToolDefsByFamily(TOOL_DEFS, 'workspace', undefined), TOOL_DEFS);
});

test('BLOCK-121 回归钉：任何域收窄下 run_tool（分析执行入口）恒在场', () => {
  // 实机抓真（2026-09-26，block121-result-loop flow）：run_tool 原归属 remote 域，
  // 「请运行 DESeq2 差异分析」被 tool_route 以 conf 0.86 判 workspace → 执行入口被
  // 整轮剔除，模型退化 shell 探测/手写脚本绕过插件系统。修复=run_tool 迁入
  // session 基线（跨域底座）；本钉保证任何域的收窄结果都含执行入口。
  for (const family of Object.keys(DOMAIN_TOOL_DEFS)) {
    const narrowed = narrowToolDefsByFamily(TOOL_DEFS, family, DOMAIN_TOOL_DEFS);
    const names = new Set(
      narrowed.filter((t) => t.function && t.function.name).map((t) => t.function.name),
    );
    assert.ok(names.has('run_tool'), `family=${family} 收窄后 run_tool 缺席——分析执行入口不得被路由剔除`);
  }
});
