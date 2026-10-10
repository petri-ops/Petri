/**
 * BLOCK-160 W2 P1（ORC-2）— 动态审批粒度契约测试。
 *
 * 钉住：evaluateDynamicGuards 两维（系统破坏命令首 token + 敏感路径模式，
 * 仅 mutating 工具）；命中 → deny(dynamic_guard)+guardKey 回显；
 * ctx.dynamicGuardAcks（Set 或对象）含 guardKey → 放行（统一确认通道）；
 * 静默面（非 mutating / 非破坏命令 / 常规路径）零扰动；rm/del 等常规命令
 * 不入维度（预裁决：日常操作不拦，用户需更严走 ORC-1 规则）。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve('.');

const policy = require(path.join(ROOT, 'core/biof3-server/agent-tools/agent-tool-policy'));

const EXEC_CONTRACT = { sideEffect: 'execution', riskTier: 'R2' };
const WRITE_CONTRACT = { sideEffect: 'workspace-write', riskTier: 'R2' };
const FULL = { accessMode: 'full' };

test('BLOCK-160 ORC-2 命令维度：系统破坏命令首 token 命中（full 档也拦）', () => {
  for (const cmd of ['format D:', 'mkfs.ext4 /dev/sdb', 'dd if=/dev/zero of=/dev/sda', 'shutdown /s', 'diskpart']) {
    const g = policy.evaluateDynamicGuards('workspace_exec', { command: cmd }, FULL);
    assert.equal(g.flagged, true, `${cmd} 应命中`);
    assert.equal(g.dimension, 'command');
    assert.match(g.guardKey, /^cmd:/);
  }
});

test('BLOCK-160 ORC-2 命令维度：常规命令不拦（rm/del/npm/git 均放行）', () => {
  for (const cmd of ['rm -rf build/', 'del temp.log', 'npm install', 'git push origin main', 'node -v']) {
    const g = policy.evaluateDynamicGuards('workspace_exec', { command: cmd }, FULL);
    assert.equal(g.flagged, false, `${cmd} 不应命中`);
  }
});

test('BLOCK-160 ORC-2 路径维度：敏感系统/凭证目录命中；常规项目路径不拦', () => {
  for (const p of ['C:\\Windows\\system32\\config\\x', '/etc/passwd', '~/.ssh/id_rsa', 'C:\\Users\\a\\.gnupg\\k']) {
    const g = policy.evaluateDynamicGuards('workspace_write', { path: p }, FULL);
    assert.equal(g.flagged, true, `${p} 应命中`);
    assert.equal(g.dimension, 'path');
  }
  for (const p of ['D:/proj/results/derived.csv', 'src/index.ts', 'C:\\proj\\build\\out.js']) {
    const g = policy.evaluateDynamicGuards('workspace_write', { path: p }, FULL);
    assert.equal(g.flagged, false, `${p} 不应命中`);
  }
  // 命令字符串内嵌敏感路径（exec 全文扫描）
  const g = policy.evaluateDynamicGuards('workspace_exec', { command: 'type C:\\Windows\\system32\\config\\sam' }, FULL);
  assert.equal(g.flagged, true);
});

test('BLOCK-160 ORC-2 policy 集成：命中→deny(dynamic_guard)+guardKey 回显；ack 集→放行', () => {
  const args = { command: 'format D:' };
  const denied = policy.decideAgentToolCall({ name: 'workspace_exec', args, ctx: FULL, contract: EXEC_CONTRACT });
  assert.equal(denied.decision, 'deny');
  assert.equal(denied.reason, 'dynamic_guard');
  assert.match(denied.message, /guardKey=cmd:format/);

  const acked = policy.decideAgentToolCall({
    name: 'workspace_exec', args,
    ctx: { ...FULL, dynamicGuardAcks: new Set(['cmd:format']) },
    contract: EXEC_CONTRACT,
  });
  assert.equal(acked.decision, 'allow', JSON.stringify(acked));
});

test('BLOCK-160 ORC-2 静默面：非 mutating/未命中/plan 档既有语义零扰动', () => {
  // 非 mutating 工具（run_tool op=list）即便命令样参数也不拦
  const readOp = policy.decideAgentToolCall({
    name: 'run_tool', args: { op: 'list' }, ctx: FULL,
    contract: { sideEffect: 'none', riskTier: 'R0' },
  });
  assert.equal(readOp.decision, 'allow');
  // 未命中常规调用照常 allow
  const normal = policy.decideAgentToolCall({
    name: 'workspace_exec', args: { command: 'npm test' }, ctx: FULL, contract: EXEC_CONTRACT,
  });
  assert.equal(normal.decision, 'allow');
  // plan 档既有语义不被动态维度削弱（mutating 仍 deny，但 reason 仍为计划模式）
  const planMode = policy.decideAgentToolCall({
    name: 'workspace_exec', args: { command: 'format D:' }, ctx: { accessMode: 'plan' }, contract: EXEC_CONTRACT,
  });
  assert.equal(planMode.decision, 'deny');
  assert.equal(planMode.reason, 'read_only');
});
