import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const require = createRequire(import.meta.url);

// ── 被测模块（P2 实现面）────────────────────────────────────
const runnerMod = require('../core/petri-server/helpers/workflow-runner.js');

// workflow-runner.js 在模块加载时不依赖 db/agent-store（依赖经 deps 注入），
// 这里用注入式 mock 驱动全链，不碰真实任务面。

function makeDeps(overrides = {}) {
  const spawned = [];
  const waiting = new Map(); // agentId -> resolve
  const earlyFinish = new Map(); // agentId -> 提前送达的终态（尚未 wait 就 finish）
  let agentSeq = 0;
  const depBase = {
    // launchSubAgent 唯一执行路径的注入形态（真实实现=spawn-agent-tools.js 导出：同步返回 spawn 结果）
    launchSubAgent: ({ userContent, role, goals }) => {
      agentSeq += 1;
      const agentId = `agent-${agentSeq}`;
      spawned.push({ agentId, userContent, role, goals });
      return { ok: true, agentId, status: 'running' };
    },
    // 终态等待（真实实现=agentTaskStore 轮询 + notifyChildTerminal 唤醒）
    waitAgentTerminal: (agentId) =>
      new Promise((resolve) => {
        if (earlyFinish.has(agentId)) {
          resolve(earlyFinish.get(agentId));
          earlyFinish.delete(agentId);
          return;
        }
        waiting.set(agentId, resolve);
      }).then((result) => ({ status: 'completed', summary: 'ok', ...result })),
    requestCancellation: (agentId) => {
      cancelled.push(agentId);
      return true;
    },
    ...overrides,
  };
  return {
    spawned,
    deps: depBase,
    finishAgent(agentId, result = {}) {
      if (waiting.has(agentId)) {
        waiting.get(agentId)(result);
        waiting.delete(agentId);
      } else {
        earlyFinish.set(agentId, result); // agent 未启动到 wait 前先完成 → 缓冲
      }
    },
  };
}

const cancelled = [];

// realm 返回值转主 realm 再 deepEqual（cross-realm 原型不等）
function snap(value) {
  return JSON.parse(JSON.stringify(value === undefined ? null : value));
}

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wf-runner-'));
}

const SIMPLE_SCRIPT = `
export const meta = { name: 'simple', version: 1, budget: { maxAgents: 2 }, concurrency: 1 };
export default async function run(ctx) {
  const a = await agent({ prompt: 'review ' + ctx.file });
  log('a done', a.status);
  return { aStatus: a.status };
}
`;

test('BLOCK-262 runner — 基本链路：agent 经 launchSubAgent 启动并等待终态', async () => {
  const { deps, spawned, finishAgent } = makeDeps();
  const root = tempRoot();
  const run = runnerMod.startWorkflowRun({
    source: SIMPLE_SCRIPT,
    args: { file: 'x.ts' },
    userId: 'u1',
    deps,
    root,
  });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(spawned.length, 1);
  assert.match(spawned[0].userContent, /review x\.ts/);
  finishAgent('agent-1');
  const result = await run.promise;
  assert.equal(result.status, 'completed');
  assert.deepEqual(snap(result.returned), { aStatus: 'completed' });
  fs.rmSync(root, { recursive: true, force: true });
});

test('BLOCK-262 runner — journal 落盘：每步骤一行，含 stepKey/血缘/状态', async () => {
  const { deps, finishAgent } = makeDeps();
  const root = tempRoot();
  const run = runnerMod.startWorkflowRun({ source: SIMPLE_SCRIPT, args: { file: 'y.ts' }, userId: 'u1', deps, root });
  await new Promise((r) => setTimeout(r, 20));
  finishAgent('agent-1');
  await run.promise;
  const journalPath = path.join(root, run.runId, 'journal.jsonl');
  assert.ok(fs.existsSync(journalPath));
  const lines = fs.readFileSync(journalPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const agentLine = lines.find((l) => l.kind === 'agent');
  assert.ok(agentLine, '应有 agent 行');
  assert.equal(agentLine.status, 'completed');
  assert.equal(agentLine.agentId, 'agent-1');
  assert.match(agentLine.stepKey, /agent/);
  assert.ok(agentLine.scriptHash && agentLine.argsHash);
  assert.ok(typeof agentLine.seq === 'number' && agentLine.seq >= 1);
  // run.json 状态面
  const runJson = JSON.parse(fs.readFileSync(path.join(root, run.runId, 'run.json'), 'utf8'));
  assert.equal(runJson.status, 'completed');
  assert.equal(runJson.meta.name, 'simple');
  fs.rmSync(root, { recursive: true, force: true });
});

test('BLOCK-262 runner — 总代理数帽：超出后 agent() 直接 budget_exhausted 不再启动', async () => {
  const { deps, spawned, finishAgent } = makeDeps();
  const root = tempRoot();
  const script = `
export const meta = { name: 'cap', version: 1, budget: { maxAgents: 2 }, concurrency: 1 };
export default async function run() {
  const r1 = await agent({ prompt: 'one' });
  const r2 = await agent({ prompt: 'two' });
  const r3 = await agent({ prompt: 'three' });
  return { r1: r1.status, r2: r2.status, r3: r3.error };
}
`;
  const run = runnerMod.startWorkflowRun({ source: script, args: {}, userId: 'u1', deps, root });
  await new Promise((r) => setTimeout(r, 30));
  finishAgent('agent-1'); finishAgent('agent-2');
  const result = await run.promise;
  assert.equal(spawned.length, 2, '只应启动两个 agent');
  assert.deepEqual(snap(result.returned), { r1: 'completed', r2: 'completed', r3: 'budget_exhausted' });
  fs.rmSync(root, { recursive: true, force: true });
});

test('BLOCK-262 runner — maxSteps 帽：预算耗尽后新步骤拒绝，运行中不强杀', async () => {
  const { deps, spawned, finishAgent } = makeDeps();
  const root = tempRoot();
  const script = `
export const meta = { name: 'steps', version: 1, budget: { maxAgents: 4, maxSteps: 1 }, concurrency: 1 };
export default async function run() {
  const r1 = await agent({ prompt: 'one' });
  const r2 = await agent({ prompt: 'two' });
  return { r1: r1.status, r2: r2.error };
}
`;
  const run = runnerMod.startWorkflowRun({ source: script, args: {}, userId: 'u1', deps, root });
  await new Promise((r) => setTimeout(r, 30));
  finishAgent('agent-1');
  const result = await run.promise;
  assert.equal(spawned.length, 1);
  assert.deepEqual(snap(result.returned), { r1: 'completed', r2: 'budget_exhausted' });
  fs.rmSync(root, { recursive: true, force: true });
});

test('BLOCK-262 runner — parallel 并发帽：concurrency=2 时同时在跑 ≤2', async () => {
  let inFlight = 0;
  let peak = 0;
  const { deps } = makeDeps({
    launchSubAgent: ({ userContent }) => ({ ok: true, agentId: `a-${userContent}` }),
    waitAgentTerminal: async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 30));
      inFlight -= 1;
      return { status: 'completed', summary: 'ok' };
    },
  });
  const root = tempRoot();
  const script = `
export const meta = { name: 'par', version: 1, budget: { maxAgents: 4 }, concurrency: 2 };
export default async function run() {
  const rs = await parallel([
    () => agent({ prompt: '1' }),
    () => agent({ prompt: '2' }),
    () => agent({ prompt: '3' }),
    () => agent({ prompt: '4' }),
  ]);
  return { n: rs.filter((r) => r.status === 'completed').length, peakBudget: budget.startedAgents };
}
`;
  const run = runnerMod.startWorkflowRun({ source: script, args: {}, userId: 'u1', deps, root });
  const result = await run.promise;
  assert.equal(peak <= 2, true, `并发峰值 ${peak} 应 ≤2`);
  assert.deepEqual(snap(result.returned), { n: 4, peakBudget: 4 });
  fs.rmSync(root, { recursive: true, force: true });
});

test('BLOCK-262 runner — pipeline 顺序传值', async () => {
  const { deps } = makeDeps({
    waitAgentTerminal: async () => ({ status: 'completed', summary: 'ok' }),
  });
  const root = tempRoot();
  const script = `
export const meta = { name: 'pipe', version: 1, budget: { maxAgents: 4 }, concurrency: 1 };
export default async function run() {
  const out = await pipeline([
    () => 'a',
    (prev) => prev + 'b',
    (prev) => prev + 'c',
  ]);
  return { out };
}
`;
  const run = runnerMod.startWorkflowRun({ source: script, args: {}, userId: 'u1', deps, root });
  const result = await run.promise;
  assert.deepEqual(snap(result.returned), { out: 'abc' });
  fs.rmSync(root, { recursive: true, force: true });
});

test('BLOCK-262 runner — phase 分段标记进 journal', async () => {
  const { deps } = makeDeps({
    waitAgentTerminal: async () => ({ status: 'completed', summary: 'ok' }),
  });
  const root = tempRoot();
  const script = `
export const meta = { name: 'phased', version: 1, budget: { maxAgents: 2 }, concurrency: 1 };
export default async function run() {
  await phase('scan', async () => { await agent({ prompt: 'x' }); });
  await phase('report', async () => { log('done'); });
  return 1;
}
`;
  const run = runnerMod.startWorkflowRun({ source: script, args: {}, userId: 'u1', deps, root });
  await run.promise;
  const lines = fs.readFileSync(path.join(root, run.runId, 'journal.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const phaseKeys = lines.filter((l) => l.kind === 'phase').map((l) => l.label);
  assert.deepEqual(phaseKeys, ['scan', 'report']);
  // agent 行的血缘应带 phase 前缀
  const agentLine = lines.find((l) => l.kind === 'agent');
  assert.match(agentLine.stepKey, /scan/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('BLOCK-262 runner — resume：前缀命中复用，mismatch 后重跑', async () => {
  // 第一次 run：两个 agent 全跑（agentId 由 prompt 派生，summary 同步记录）
  const mkResumeDeps = (prefix, spawnCounter) => {
    const prompts = new Map();
    return makeDeps({
      launchSubAgent: ({ userContent }) => {
        prompts.set(`${prefix}-${userContent}`, userContent);
        return { ok: true, agentId: `${prefix}-${userContent}` };
      },
      waitAgentTerminal: async (agentId) => ({
        status: 'completed',
        summary: `${prefix[0]}-${prompts.get(agentId) || agentId}`,
      }),
      ...(spawnCounter ? { launchSubAgent: ({ userContent }) => { spawnCounter.n += 1; prompts.set(`${prefix}-${userContent}`, userContent); return { ok: true, agentId: `${prefix}-${userContent}-${spawnCounter.n}` }; } } : {}),
    });
  };
  const root = tempRoot();
  const script = `
export const meta = { name: 'resume', version: 1, budget: { maxAgents: 4 }, concurrency: 1 };
export default async function run() {
  const a = await agent({ prompt: 'first' });
  const b = await agent({ prompt: 'second' });
  return { a: a.summary, b: b.summary };
}
`;
  const d1 = mkResumeDeps('s1');
  const run1 = runnerMod.startWorkflowRun({ source: script, args: {}, userId: 'u1', deps: d1.deps, root });
  const r1 = await run1.promise;
  assert.deepEqual(snap(r1.returned), { a: 's-first', b: 's-second' });

  // 第二次 run（同 script+args）：resumeFromRunId=run1 → 全部复用，零新 agent
  const spawnCounter = { n: 0 };
  const d2 = mkResumeDeps('n', spawnCounter);
  const run2 = runnerMod.startWorkflowRun({ source: script, args: {}, userId: 'u1', deps: d2.deps, root, resumeFromRunId: run1.runId });
  const r2 = await run2.promise;
  assert.equal(spawnCounter.n, 0, '前缀命中不应再启动 agent');
  assert.deepEqual(snap(r2.returned), { a: 's-first', b: 's-second' }, '复用应返回原结果');

  // 第三次 run：改 args（argsHash 变）→ mismatch → 全重跑
  const d3 = mkResumeDeps('f1');
  const run3 = runnerMod.startWorkflowRun({ source: script, args: { changed: true }, userId: 'u1', deps: d3.deps, root, resumeFromRunId: run1.runId });
  const r3 = await run3.promise;
  assert.deepEqual(snap(r3.returned), { a: 'f-first', b: 'f-second' }, 'args 变更应全重跑');
  fs.rmSync(root, { recursive: true, force: true });
});

test('BLOCK-262 runner — 脚本抛错：run 终态 failed 如实记录，不吞异常', async () => {
  const { deps } = makeDeps({});
  const root = tempRoot();
  const script = `
export const meta = { name: 'boom', version: 1, budget: { maxAgents: 2 }, concurrency: 1 };
export default async function run() { throw new Error('planned failure'); }
`;
  const run = runnerMod.startWorkflowRun({ source: script, args: {}, userId: 'u1', deps, root });
  const result = await run.promise;
  assert.equal(result.status, 'failed');
  assert.match(result.error, /planned failure/);
  const runJson = JSON.parse(fs.readFileSync(path.join(root, run.runId, 'run.json'), 'utf8'));
  assert.equal(runJson.status, 'failed');
  fs.rmSync(root, { recursive: true, force: true });
});

test('BLOCK-262 runner — cancel：不再启动新步骤，对运行中子任务发取消请求', async () => {
  const { deps, spawned, finishAgent } = makeDeps();
  const root = tempRoot();
  const script = `
export const meta = { name: 'cancel', version: 1, budget: { maxAgents: 4 }, concurrency: 1 };
export default async function run() {
  await agent({ prompt: 'long' });
  await agent({ prompt: 'never-starts' });
  return { done: true };
}
`;
  const run = runnerMod.startWorkflowRun({ source: script, args: {}, userId: 'u1', deps, root });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(spawned.length, 1);
  cancelled.length = 0;
  await run.cancel();
  finishAgent('agent-1', { status: 'cancelled', summary: '' });
  const result = await run.promise;
  assert.equal(spawned.length, 1, '取消后不应启动第二个 agent');
  assert.deepEqual(cancelled, ['agent-1'], '应对运行中子任务发取消请求');
  assert.equal(result.status, 'cancelled');
  fs.rmSync(root, { recursive: true, force: true });
});

test('BLOCK-262 runner — budget 只读视图随执行推进', async () => {
  const { deps, finishAgent } = makeDeps();
  const root = tempRoot();
  const script = `
export const meta = { name: 'budgetview', version: 1, budget: { maxAgents: 3 }, concurrency: 1 };
export default async function run() {
  const before = budget.startedAgents;
  await agent({ prompt: 'x' });
  const after = budget.startedAgents;
  return { before, after, maxAgents: budget.maxAgents };
}
`;
  const run = runnerMod.startWorkflowRun({ source: script, args: {}, userId: 'u1', deps, root });
  await new Promise((r) => setTimeout(r, 20));
  finishAgent('agent-1');
  const result = await run.promise;
  assert.deepEqual(snap(result.returned), { before: 0, after: 1, maxAgents: 3 });
  fs.rmSync(root, { recursive: true, force: true });
});

test('BLOCK-262 runner — prompt 超长拒绝（16KB 上限，fail-closed）', async () => {
  const { deps } = makeDeps({});
  const root = tempRoot();
  const bigPrompt = 'x'.repeat(17 * 1024);
  const script = `
export const meta = { name: 'bigp', version: 1, budget: { maxAgents: 2 }, concurrency: 1 };
export default async function run() {
  const r = await agent({ prompt: ${JSON.stringify(bigPrompt)} });
  return { e: r.error };
}
`;
  const run = runnerMod.startWorkflowRun({ source: script, args: {}, userId: 'u1', deps, root });
  const result = await run.promise;
  assert.equal(result.returned.e, 'prompt_too_long');
  fs.rmSync(root, { recursive: true, force: true });
});
