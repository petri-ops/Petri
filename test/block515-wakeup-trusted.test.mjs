'use strict';

/**
 * BLOCK-515 — agent 唤醒 B 档：per-schedule 预授权白名单（HK-01 红绿先行）。
 *
 * 契约（plan §1；裁决=owner 三项「行的 你来吧 用最合理的方式推进」第三项 B，约束逐条）：
 *   1. store additive 三列：auto_mode（guided|trusted）/ auto_tool_allowlist（JSON 工具名数组）/
 *      auto_budget_checked。trusted 必须 ①非空白名单 ②白名单每个工具名都在 registry 声明面
 *      （未知拒绝 fail-closed）③绑定带预算的 active goal（预算硬顶=既有 goalGate 机制）。
 *      撤回=清空白名单/auto_mode 回 guided（显式可审计可撤回）。
 *   2. runner：trusted schedule 提交带 context.automationMode='trusted' + autoToolAllowlist；
 *      guided（默认）提交逐字不变。
 *   3. interceptor：任务 ctx 带 autoToolAllowlist 时，白名单外工具调用硬拒绝
 *      （auto_allowlist_denied，不进审批队列=比 guided 更严）；白名单内放行进正常决策；
 *      无 autoToolAllowlist 的任务零变化。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'block515-'));
const dbPath = path.join(tempRoot, 'petri.db');
process.env.PETRI_DB_PATH = dbPath;
process.env.PETRI_LOCAL_DATA_DIR = path.join(tempRoot, 'data');
fs.mkdirSync(process.env.PETRI_LOCAL_DATA_DIR, { recursive: true });

const { runMigrations } = require('../src/migration-runner');
await runMigrations(dbPath, path.join(REPO_ROOT, 'src', 'migrations'));

const store = require('../core/petri-server/helpers/automation-store.js');
const runner = require('../core/petri-server/helpers/automation-runner.js');

// 注册表声明面（同步内置名单；校验用已知存在的工具名）
const { listBuiltinToolNames } = require('../core/petri-server/agent-tools/registry.js');
const knownTools = listBuiltinToolNames();
assert.ok(Array.isArray(knownTools) && knownTools.length >= 2, `registry 内置名单应非空：${knownTools.length}`);
const KNOWN_TOOL = knownTools[0];
const ANOTHER_KNOWN_TOOL = knownTools[1];

function makeBudgetedGoal(conversationId) {
  const goal = store.createGoal({ projectId: 'proj_b515', conversationId, title: '唤醒预算门' });
  assert.equal(goal.ok, true, JSON.stringify(goal));
  return goal.goal;
}

test('store 校验矩阵：trusted 无白名单/未知工具/无预算 goal 一律拒绝', () => {
  const noAllowlist = store.createSchedule({
    projectId: 'proj_b515', title: 'x', prompt: 'y', kind: 'task', intervalMinutes: 30,
    autoMode: 'trusted',
  });
  assert.equal(noAllowlist.ok, false, JSON.stringify(noAllowlist));
  assert.match(String(noAllowlist.error), /auto_allowlist|allowlist/);

  const unknownTool = store.createSchedule({
    projectId: 'proj_b515', title: 'x', prompt: 'y', kind: 'task', intervalMinutes: 30,
    autoMode: 'trusted', autoToolAllowlist: ['totally_made_up_tool'],
  });
  assert.equal(unknownTool.ok, false, JSON.stringify(unknownTool));
  assert.match(String(unknownTool.error), /unknown_tool|allowlist/);

  const noBudget = store.createSchedule({
    projectId: 'proj_b515', title: 'x', prompt: 'y', kind: 'task', intervalMinutes: 30,
    autoMode: 'trusted', autoToolAllowlist: [KNOWN_TOOL],
  });
  assert.equal(noBudget.ok, false, JSON.stringify(noBudget));
  assert.match(String(noBudget.error), /budget|goal/, 'trusted 必须绑定带预算的 active goal（保守预算硬顶）');
});

test('store 授予+撤回：合法 trusted 授予成功、清空白名单即回 guided', () => {
  const goal = makeBudgetedGoal('conv_b515_grant');
  const created = store.createSchedule({
    projectId: 'proj_b515', title: '唤醒 trusted', prompt: 'wakeup', kind: 'task', intervalMinutes: 30,
    autoMode: 'trusted', autoToolAllowlist: [KNOWN_TOOL], goalId: goal.id,
  });
  assert.equal(created.ok, true, JSON.stringify(created));
  const row = store.getSchedule(created.schedule.id);
  assert.equal(row.auto_mode, 'trusted');
  assert.deepEqual(JSON.parse(row.auto_tool_allowlist), [KNOWN_TOOL]);
  assert.equal(row.auto_budget_checked, 1);

  // 撤回：清空白名单 + 回 guided（显式可审计可撤回）
  const revoked = store.setScheduleAuto({ id: created.schedule.id, autoMode: 'guided', autoToolAllowlist: [] });
  assert.equal(revoked.ok, true, JSON.stringify(revoked));
  const after = store.getSchedule(created.schedule.id);
  assert.equal(after.auto_mode, 'guided');
  assert.equal(after.auto_tool_allowlist, null);
});

test('runner：trusted schedule 提交带 automationMode=trusted + autoToolAllowlist；guided 逐字不变', async () => {
  const goal = makeBudgetedGoal('conv_b515_runner');
  const created = store.createSchedule({
    projectId: 'proj_b515', title: 'trusted 提交', prompt: 'wakeup run', kind: 'task', intervalMinutes: 30,
    autoMode: 'trusted', autoToolAllowlist: [KNOWN_TOOL, ANOTHER_KNOWN_TOOL], goalId: goal.id,
  });
  const schedule = store.getSchedule(created.schedule.id);

  const captured = [];
  const fetchImpl = async (url, options = {}) => {
    captured.push({ url: String(url), body: options.body ? JSON.parse(options.body) : null });
    return {
      ok: true, status: 200,
      json: async () => ({ conversation: { id: 'conv_x' }, taskId: 'task_x' }),
    };
  };
  const result = await runner.executeSchedule(schedule, {
    fetchImpl,
    baseUrl: 'http://127.0.0.1:9',
    now: new Date(Date.UTC(2026, 2, 10, 0, 0, 0)),
  });
  assert.equal(result.status, 'running', JSON.stringify(result));
  const agentPost = captured.find((c) => c.url.includes('/api/ai/agent'));
  assert.ok(agentPost, 'agent 提交在场');
  assert.equal(agentPost.body.context.automationMode, 'trusted', JSON.stringify(agentPost.body.context));
  assert.deepEqual(agentPost.body.autoToolAllowlist, [KNOWN_TOOL, ANOTHER_KNOWN_TOOL]);

  // guided（默认）对照：不携带档位与白名单
  const plain = store.createSchedule({
    projectId: 'proj_b515', title: 'guided 对照', prompt: 'plain', kind: 'task', intervalMinutes: 30,
  });
  const schedule2 = store.getSchedule(plain.schedule.id);
  const captured2 = [];
  await runner.executeSchedule(schedule2, {
    fetchImpl: async (url, options = {}) => {
      captured2.push({ url: String(url), body: options.body ? JSON.parse(options.body) : null });
      return { ok: true, status: 200, json: async () => ({ conversation: { id: 'conv_y' }, taskId: 'task_y' }) };
    },
    baseUrl: 'http://127.0.0.1:9',
    now: new Date(Date.UTC(2026, 2, 10, 0, 0, 0)),
  });
  const agentPost2 = captured2.find((c) => c.url.includes('/api/ai/agent'));
  assert.equal(agentPost2.body.context.automationMode, undefined, 'guided 提交不带档位（逐字不变）');
  assert.equal(agentPost2.body.autoToolAllowlist, undefined, 'guided 提交不带白名单');
});

test('interceptor：白名单外硬拒绝（不进审批队列）；白名单内放行进正常决策；无白名单零变化', async () => {
  const { createAgentToolInterceptor } = require('../core/petri-server/agent-tools/agent-tool-interceptor.js');
  const entryFor = (name) => ({
    contract: { category: 'read', sideEffect: 'none' },
    definition: { function: { name, parameters: { type: 'object', properties: {} } } },
    handler: async () => ({ ok: true, result: 'handled:' + name }),
  });
  const seen = [];
  const interceptor = createAgentToolInterceptor({
    getToolEntry: (name) => entryFor(name),
    decideAgentToolCall: (input) => { seen.push(input.name); return { decision: 'allow' }; },
  });

  // 白名单外：硬拒绝 auto_allowlist_denied，不触策略决策（不进审批队列）
  const denied = await interceptor('some_tool', {}, { autoToolAllowlist: [KNOWN_TOOL] });
  assert.equal(denied.ok, false, JSON.stringify(denied));
  assert.equal(denied.error, 'auto_allowlist_denied', JSON.stringify(denied));
  assert.deepEqual(seen, [], '白名单外不得触达策略决策');

  // 白名单内：放行进正常决策（interceptor 初始+最终两遍决策，既有设计）
  const allowed = await interceptor(KNOWN_TOOL, {}, { autoToolAllowlist: [KNOWN_TOOL] });
  assert.equal(allowed.ok, true, JSON.stringify(allowed));
  assert.ok(seen.length >= 1 && seen.every((n) => n === KNOWN_TOOL), `seen=${JSON.stringify(seen)}`);

  // 无白名单：零变化（决策照常触达）
  seen.length = 0;
  const plain = await interceptor(KNOWN_TOOL, {}, {});
  assert.equal(plain.ok, true, JSON.stringify(plain));
  assert.ok(seen.length >= 1 && seen.every((n) => n === KNOWN_TOOL), `seen=${JSON.stringify(seen)}`);
});

test.after(() => {
  try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch { /* ignore */ }
});
