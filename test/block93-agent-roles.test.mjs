'use strict';

/**
 * BLOCK-93 P1 — 子智能体角色注册表 + spawn role 参数契约测试。
 *
 * 覆盖：注册表完整性（十角色）/ renderRoleDirective / tool-defs role 枚举对齐 /
 * spawn_agent role 落库与 roleDirective 注入 / 未知 role fail-closed /
 * 无 role additive 红线（params 无 role + 零注入）/ followup 继承与显式覆盖 /
 * list_agents role 透出。
 *
 * agent-runner 以 require-cache 假件注入（不触真实模型，记录 roleDirective）；
 * DB 为临时自举库（block49-phase2 同款 harness）。
 */

import assert from 'node:assert/strict';
import { test, describe, before } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R_SERVER = path.resolve(__dirname, '..', 'core', 'petri-server');
const require = createRequire(import.meta.url);

// 临时 DB 自举（须在 require db.js 前生效）
{
  const Database = require(path.join(R_SERVER, 'node_modules', 'better-sqlite3'));
  const tempDbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-block93-db-'));
  const boot = new Database(path.join(tempDbDir, 'petri.db'));
  const migrationsDir = path.resolve(__dirname, '..', 'src', 'migrations');
  for (const f of fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    boot.exec(fs.readFileSync(path.join(migrationsDir, f), 'utf8'));
  }
  boot.close();
  process.env.PETRI_DB_PATH = path.join(tempDbDir, 'petri.db');
  process.on('exit', () => {
    try { fs.rmSync(tempDbDir, { recursive: true, force: true }); } catch {}
  });
}

// ── agent-runner 假件注入（记录 roleDirective；不触真实模型）────────
const runnerPath = require.resolve(path.join(R_SERVER, 'agent-runner.js'));
const fakeRunnerState = { launches: [] };
require.cache[runnerPath] = {
  id: runnerPath,
  filename: runnerPath,
  loaded: true,
  exports: {
    runAgentLoop: async (opts) => {
      fakeRunnerState.launches.push({
        taskId: opts.taskId,
        kind: opts.kind,
        roleDirective: opts.roleDirective ?? null,
      });
      // 真实 loop 终态会释放并发槽——fake 同语义，避免测试内 user 槽位被攒满
      try { aiTaskConcurrencyRelease(opts.userId, opts.taskId); } catch {}
      return { assistantText: 'fake-ok' };
    },
  },
};

const { aiTaskConcurrencyRelease } = require(path.join(R_SERVER, 'helpers', 'runtime.js'));
const agentTaskStore = require(path.join(R_SERVER, 'agent-task-store.js'));
const agentRoles = require(path.join(R_SERVER, 'agent-tools', 'agent-roles.js'));
const spawnTools = require(path.join(R_SERVER, 'agent-tools', 'spawn-agent-tools.js'));
const { getToolRegistry } = require(path.join(R_SERVER, 'agent-tools', 'registry.js'));

const USER = 'u_block93';
let PARENT_ID = null;
const ctx = () => ({ taskId: PARENT_ID, userId: USER, accessMode: 'full' });

/** launchSubAgent 经 setImmediate 启动 loop——断言启动参数前先排空宏任务。 */
const drainTicks = () => new Promise((resolve) => setImmediate(() => setImmediate(resolve)));

before(() => {
  PARENT_ID = agentTaskStore.createAgentTask({
    status: 'running',
    agentStatus: 'running',
    userId: USER,
    params: {
      messages: [{ role: 'user', content: '父任务' }],
      context: { accessMode: 'full' },
      kind: 'primary',
    },
  }).taskId;
});

// ── 注册表本体 ──────────────────────────────────────────────────

describe('BLOCK-93 角色注册表', () => {
  test('十一角色完整性：key 唯一 + label/description/directive 非空', () => {
    assert.equal(agentRoles.AGENT_ROLES.length, 11);
    const keys = new Set(agentRoles.AGENT_ROLE_KEYS);
    assert.equal(keys.size, 11, 'key 无重复');
    for (const role of agentRoles.AGENT_ROLES) {
      assert.ok(role.label, `${role.key} label 缺失`);
      assert.ok(role.description, `${role.key} description 缺失`);
      assert.ok(role.directive && role.directive.length >= 20, `${role.key} directive 过短`);
    }
    // 六基础对齐前端 agentCategories + 四扩展
    for (const key of ['search', 'collect', 'organize', 'read', 'analysis', 'general', 'test', 'write', 'plan', 'fix']) {
      assert.ok(agentRoles.isValidAgentRole(key), `缺角色 ${key}`);
    }
  });

  test('renderRoleDirective：含角色名与指令；未知/空 key → null（零注入）', () => {
    const d = agentRoles.renderRoleDirective('search');
    assert.ok(d.includes('检索') && d.includes('workspace_search'));
    assert.equal(agentRoles.renderRoleDirective('nope'), null);
    assert.equal(agentRoles.renderRoleDirective(''), null);
    assert.equal(agentRoles.renderRoleDirective(null), null);
  });

  test('resolveRoleOrError：空=通用缺省；未知=fail-closed 且列出可用角色', () => {
    const empty = agentRoles.resolveRoleOrError('');
    assert.equal(empty.ok, true);
    assert.equal(empty.role, null);
    const bad = agentRoles.resolveRoleOrError('hacker');
    assert.equal(bad.ok, false);
    assert.equal(bad.fail.error, 'invalid_arguments');
    assert.ok(bad.fail.message.includes('search'), 'fail 消息列出可用角色');
    const good = agentRoles.resolveRoleOrError(' fix ');
    assert.equal(good.ok, true);
    assert.equal(good.role, 'fix');
  });

  test('tool-defs spawn_agent role 枚举与注册表对齐', () => {
    const entry = getToolRegistry().find((item) => item.definition?.function?.name === 'spawn_agent');
    assert.ok(entry, 'spawn_agent 未注册');
    const roleProp = entry.definition.function.parameters.properties.role;
    assert.ok(roleProp, 'spawn_agent schema 缺 role 参数');
    assert.deepEqual([...roleProp.enum].sort(), [...agentRoles.AGENT_ROLE_KEYS].sort());
  });
});

// ── spawn / followup 角色流 ─────────────────────────────────────

describe('spawn_agent role 参数', () => {
  test('合法 role：params.role 落库 + runAgentLoop 收到 roleDirective + 返回回显', async () => {
    const res = await spawnTools.spawn_agent({ task: '检索相关代码', role: 'search' }, ctx());
    assert.equal(res.ok, true);
    assert.equal(res.role, 'search');
    const task = agentTaskStore.getAgentTask(res.agentId);
    assert.equal(task.params.role, 'search');
    await drainTicks();
    const launch = fakeRunnerState.launches.find((l) => l.taskId === res.agentId);
    assert.ok(launch, 'runAgentLoop 已启动');
    assert.ok(launch.roleDirective.includes('检索'), 'roleDirective 注入');
    // BLOCK-109 P2 — 并行度上限（活跃子任务 ≥3 软拒）落地后，测试内派发的子任务
    // 需即用即收，否则共享父 id 的后续用例会被上限拦截。
    agentTaskStore.markAgentTaskDone(res.agentId, null);
  });

  test('未知 role → invalid_arguments fail-closed，不创建任务', async () => {
    const before = agentTaskStore.listChildAgentTasks(PARENT_ID).length;
    const res = await spawnTools.spawn_agent({ task: '越权任务', role: 'hacker' }, ctx());
    assert.equal(res.ok, false);
    assert.equal(res.error, 'invalid_arguments');
    assert.ok(res.message.includes('可用角色'));
    assert.equal(agentTaskStore.listChildAgentTasks(PARENT_ID).length, before, '未建任务');
    assert.equal(fakeRunnerState.launches.filter((l) => l.roleDirective && l.roleDirective.includes('hacker')).length, 0, '零注入');
  });

  test('无 role：params 无 role 字段 + roleDirective null（additive 红线）', async () => {
    const res = await spawnTools.spawn_agent({ task: '普通任务' }, ctx());
    assert.equal(res.ok, true);
    assert.equal(res.role, undefined);
    const task = agentTaskStore.getAgentTask(res.agentId);
    assert.equal(task.params.role, undefined, 'params 不带 role 键');
    await drainTicks();
    const launch = fakeRunnerState.launches.find((l) => l.taskId === res.agentId);
    assert.equal(launch.roleDirective, null);
    agentTaskStore.markAgentTaskDone(res.agentId, null);
  });

  test('followup_task 继承原子 agent 角色；显式 role 可覆盖', async () => {
    const sp = await spawnTools.spawn_agent({ task: '读取原始文件', role: 'read' }, ctx());
    agentTaskStore.markAgentTaskDone(sp.agentId, null);

    const inherited = await spawnTools.followup_task({ agentId: sp.agentId, task: '继续读下一批' }, ctx());
    assert.equal(inherited.ok, true);
    assert.equal(inherited.role, 'read', '缺省继承原角色');
    await drainTicks();
    const inheritedLaunch = fakeRunnerState.launches.find((l) => l.taskId === inherited.agentId);
    assert.ok(inheritedLaunch.roleDirective.includes('读取'));

    agentTaskStore.markAgentTaskDone(inherited.agentId, null);
    const overridden = await spawnTools.followup_task({ agentId: sp.agentId, task: '改做修复', role: 'fix' }, ctx());
    assert.equal(overridden.ok, true);
    assert.equal(overridden.role, 'fix', '显式 role 覆盖继承');
    await drainTicks();
    const overriddenLaunch = fakeRunnerState.launches.find((l) => l.taskId === overridden.agentId);
    assert.ok(overriddenLaunch.roleDirective.includes('修复'));
    agentTaskStore.markAgentTaskDone(inherited.agentId, null);
    agentTaskStore.markAgentTaskDone(overridden.agentId, null);
  });

  test('followup_task 未知 role → fail-closed', async () => {
    const sp = await spawnTools.spawn_agent({ task: '普通' }, ctx());
    agentTaskStore.markAgentTaskDone(sp.agentId, null);
    const res = await spawnTools.followup_task({ agentId: sp.agentId, task: '续派', role: 'nope' }, ctx());
    assert.equal(res.ok, false);
    assert.equal(res.error, 'invalid_arguments');
  });

  test('list_agents 透出 role（未指定角色的历史任务不带此字段）', async () => {
    const res = await spawnTools.list_agents({}, ctx());
    assert.equal(res.ok, true);
    const withRole = res.agents.find((a) => a.role === 'search');
    assert.ok(withRole, '带角色子 agent 透出 role');
    const bare = res.agents.find((a) => !a.role);
    assert.ok(bare, '无角色子 agent 不带 role 键');
  });

  test('wait_agent 终态摘要随附 role（父上下文可感知专职面）', async () => {
    const sp = await spawnTools.spawn_agent({ task: '分析数据', role: 'analysis' }, ctx());
    agentTaskStore.markAgentTaskDone(sp.agentId, null);
    const res = await spawnTools.wait_agent({ agentId: sp.agentId, timeout: 3000 }, ctx());
    assert.equal(res.ok, true);
    assert.equal(res.summary.role, 'analysis');
  });
});
