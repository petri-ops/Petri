/**
 * AccessMode 功能自动化测试
 * 
 * 测试目标：
 * 1. 完全访问模式下，破坏性工具应该被允许
 * 2. 只读模式下，破坏性工具应该被拒绝
 */

import test from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// 测试策略层逻辑
test('agent-tool-policy accessMode validation', async (t) => {
  const { decideAgentToolCall } = require('../core/petri-server/agent-tools/agent-tool-policy.js');

  await t.test('should allow mutating tools in full access mode', () => {
    const decision = decideAgentToolCall({
      name: 'workspace_write',
      args: { path: 'test.txt', content: 'test' },
      ctx: { accessMode: 'full' },
      contract: { sideEffect: 'workspace-write', riskTier: 'R2' },
    });
    
    assert.strictEqual(decision.decision, 'allow', 'workspace_write should be allowed in full mode');
  });

  await t.test('should deny mutating tools in read-only mode', () => {
    const decision = decideAgentToolCall({
      name: 'workspace_write',
      args: { path: 'test.txt', content: 'test' },
      ctx: { accessMode: 'read' },
      contract: { sideEffect: 'workspace-write', riskTier: 'R2' },
    });
    
    assert.strictEqual(decision.decision, 'deny', 'workspace_write should be denied in read mode');
    assert.strictEqual(decision.reason, 'read_only', 'denial reason should be read_only');
    assert.strictEqual(decision.error, 'access_mode_read_only', 'error should be access_mode_read_only');
  });

  await t.test('should deny workspace_exec in read-only mode', () => {
    const decision = decideAgentToolCall({
      name: 'workspace_exec',
      args: { command: 'ls -la' },
      ctx: { accessMode: 'read' },
      contract: { sideEffect: 'execution', riskTier: 'R2' },
    });
    
    assert.strictEqual(decision.decision, 'deny', 'workspace_exec should be denied in read mode');
  });

  await t.test('should allow read-only tools in read-only mode', () => {
    const decision = decideAgentToolCall({
      name: 'workspace_read',
      args: { path: 'test.txt' },
      ctx: { accessMode: 'read' },
      contract: { sideEffect: 'none', riskTier: 'R1' },
    });

    assert.strictEqual(decision.decision, 'allow', 'workspace_read should be allowed in read mode');
  });
});

// BLOCK-56 P2 — 三档矩阵：read / workspace-write / full
test('BLOCK-56 P2 accessMode workspace-write 三档矩阵', async (t) => {
  const { decideAgentToolCall } = require('../core/petri-server/agent-tools/agent-tool-policy.js');
  const { ACCESS_MODES, normalizeScientificTaskSpec } = require('../core/shared-backend/scientific-task-spec.js');

  const decide = (name, sideEffect, accessMode, args = {}, extra = {}) => decideAgentToolCall({
    name,
    args,
    ctx: { accessMode, ...extra },
    contract: { sideEffect, riskTier: 'R2' },
  });

  await t.test('枚举：ACCESS_MODES 为三档且 read/full 原值不变（additive）', () => {
    assert.deepStrictEqual([...ACCESS_MODES], ['read', 'workspace-write', 'full']);
  });

  await t.test('归一化：workspace-write 透传，未知值回落 read', () => {
    const base = {
      schemaVersion: 1,
      taskId: 't1', projectId: 'p1', conversationId: 'c1',
      originalRequest: 'r',
      question: { domain: 'd', analysisUnit: 'a', questionType: 'exploratory' },
      method: { category: 'qc' },
      inputs: [{ relativePath: 'data.csv', sizeBytes: 1, sha256: null }],
    };
    const ww = normalizeScientificTaskSpec({ ...base, execution: { accessMode: 'workspace-write' } });
    assert.strictEqual(ww.execution.accessMode, 'workspace-write');
    const bogus = normalizeScientificTaskSpec({ ...base, execution: { accessMode: 'yolo' } });
    assert.strictEqual(bogus.execution.accessMode, 'read');
  });

  await t.test('workspace-write：放行项目内文件写与前台命令', () => {
    assert.strictEqual(decide('workspace_write', 'workspace-write', 'workspace-write').decision, 'allow');
    assert.strictEqual(decide('workspace_replace', 'workspace-write', 'workspace-write').decision, 'allow');
    assert.strictEqual(decide('workspace_exec', 'execution', 'workspace-write').decision, 'allow');
  });

  await t.test('workspace-write：拒绝后台进程/进程停止/插件委托/系统写面', () => {
    for (const [name, sideEffect] of [
      ['workspace_exec_background', 'execution'],
      ['process_stop', 'execution'],
      ['run_tool', 'execution'],
      ['act', 'execution'],
      ['plan', 'state-write'],
      ['result_changeset_adopt', 'state-write'],
    ]) {
      const decision = decide(name, sideEffect, 'workspace-write');
      assert.strictEqual(decision.decision, 'deny', `${name} 应在 workspace-write 档拒绝`);
      assert.strictEqual(decision.error, 'access_mode_workspace_write', `${name} 拒绝错误码应为 access_mode_workspace_write`);
    }
  });

  await t.test('workspace-write：只读工具照常放行', () => {
    assert.strictEqual(decide('workspace_read', 'none', 'workspace-write').decision, 'allow');
    assert.strictEqual(decide('workspace_list', 'none', 'workspace-write').decision, 'allow');
  });

  await t.test('零回归：read 拒绝一切 mutating；full 放行一切', () => {
    for (const [name, sideEffect] of [
      ['workspace_write', 'workspace-write'],
      ['workspace_exec', 'execution'],
      ['workspace_exec_background', 'execution'],
      ['run_tool', 'execution'],
      ['plan', 'state-write'],
    ]) {
      assert.strictEqual(decide(name, sideEffect, 'read').decision, 'deny', `${name} 应在 read 档拒绝`);
      assert.strictEqual(decide(name, sideEffect, 'full').decision, 'allow', `${name} 应在 full 档放行`);
    }
  });

  await t.test('零回归：read 档拒绝错误码维持 access_mode_read_only', () => {
    const decision = decide('workspace_write', 'workspace-write', 'read');
    assert.strictEqual(decision.error, 'access_mode_read_only');
  });

  await t.test('inferExecutionPolicy：workspace-write 允许执行且 reason 可追溯', () => {
    const { inferExecutionPolicy } = require('../core/petri-server/helpers/agent-execution-policy.js');
    assert.deepStrictEqual(inferExecutionPolicy([], { accessMode: 'workspace-write' }), {
      allowExecution: true,
      reason: 'explicit_workspace_write_access_mode',
    });
    assert.strictEqual(inferExecutionPolicy([], { accessMode: 'read' }).allowExecution, false);
    assert.strictEqual(inferExecutionPolicy([], { accessMode: 'full' }).allowExecution, true);
  });
});

// UI-303 — 计划模式并入档位菜单成为第四档（read / plan / workspace-write / full）
test('UI-303 accessMode plan 第四档矩阵', async (t) => {
  const { decideAgentToolCall } = require('../core/petri-server/agent-tools/agent-tool-policy.js');
  const { ACCESS_MODES, normalizeScientificTaskSpec } = require('../core/shared-backend/scientific-task-spec.js');

  const decide = (name, sideEffect, accessMode, args = {}, extra = {}) => decideAgentToolCall({
    name,
    args,
    ctx: { accessMode, ...extra },
    contract: { sideEffect, riskTier: 'R2' },
  });

  await t.test('plan 档：mutating 一律 plan_mode_active（即使漏传 planMode 标志）', () => {
    for (const [name, sideEffect, args] of [
      ['workspace_write', 'workspace-write', { path: 'x.txt', content: 'y' }],
      ['workspace_exec', 'execution', { command: 'pwd' }],
      ['workspace_exec_background', 'execution', { command: 'sleep 1' }],
      ['run_tool', 'execution', { op: 'run' }],
      ['act', 'execution', { type: 'open' }],
    ]) {
      const decision = decide(name, sideEffect, 'plan', args);
      assert.strictEqual(decision.decision, 'deny', `${name} 应在 plan 档拒绝`);
      assert.strictEqual(decision.error, 'plan_mode_active', `${name} 拒绝错误码应为 plan_mode_active`);
    }
  });

  await t.test('plan 档：plan 工具与只读工具放行', () => {
    assert.strictEqual(decide('plan', 'state-write', 'plan', { op: 'create' }).decision, 'allow');
    assert.strictEqual(decide('workspace_read', 'none', 'plan').decision, 'allow');
    assert.strictEqual(decide('workspace_list', 'none', 'plan').decision, 'allow');
    assert.strictEqual(decide('run_tool', 'execution', 'plan', { op: 'list' }).decision, 'allow');
  });

  await t.test('inferExecutionPolicy：plan 档不允许执行', () => {
    const { inferExecutionPolicy } = require('../core/petri-server/helpers/agent-execution-policy.js');
    assert.strictEqual(inferExecutionPolicy([], { accessMode: 'plan' }).allowExecution, false);
  });

  await t.test('科学任务 spec 面：plan 未知即 fail-closed 回落 read（该面不扩档）', () => {
    const base = {
      schemaVersion: 1,
      taskId: 't1', projectId: 'p1', conversationId: 'c1',
      originalRequest: 'r',
      question: { domain: 'd', analysisUnit: 'a', questionType: 'exploratory' },
      method: { category: 'qc' },
      inputs: [{ relativePath: 'data.csv', sizeBytes: 1, sha256: null }],
    };
    const normalized = normalizeScientificTaskSpec({ ...base, execution: { accessMode: 'plan' } });
    assert.strictEqual(normalized.execution.accessMode, 'read');
    assert.ok(ACCESS_MODES.includes('read'));
  });
});

console.log('\n✅ 所有 accessMode 策略测试通过！\n');
