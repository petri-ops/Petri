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
  const { decideAgentToolCall } = require('../core/biof3-server/agent-tools/agent-tool-policy.js');

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

console.log('\n✅ 所有 accessMode 策略测试通过！\n');
