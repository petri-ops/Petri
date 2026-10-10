/**
 * BLOCK-160 W2 P2（ORC-1）— 用户规则层契约测试。
 *
 * 钉住：agent-user-rules.js（rules.json 读写+读缓存+fail-soft）；policy 规则层
 * 判定（first-match 先到先判：deny / require-ack；require-ack 经
 * ctx.dynamicGuardAcks 的 rule:<id> 键放行；判定序=静态闸之后、动态维度之前）；
 * 零规则零行为（fail-soft）；拦截器注入钉（源码扫描）。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve('.');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'b160-user-rules-'));
process.env.BIOF3_LOCAL_DATA_DIR = tmpDir;

const rulesHelper = require(path.join(ROOT, 'core/biof3-server/helpers/agent-user-rules'));
const policy = require(path.join(ROOT, 'core/biof3-server/agent-tools/agent-tool-policy'));

const EXEC_CONTRACT = { sideEffect: 'execution', riskTier: 'R2' };
const WRITE_CONTRACT = { sideEffect: 'workspace-write', riskTier: 'R2' };
const FULL = { accessMode: 'full' };

test('BLOCK-160 ORC-1 helper：零文件 fail-soft=空规则；保存后带缓存读回', () => {
  assert.deepEqual(rulesHelper.loadUserRules(), [], '无文件=空规则（fail-soft）');
  const saved = rulesHelper.saveUserRules([
    { id: 'r1', matcher: { type: 'command-token', pattern: 'npm' }, action: 'require-ack', scope: 'global', note: 'npm 需确认' },
  ]);
  assert.equal(saved.ok, true, JSON.stringify(saved));
  const loaded = rulesHelper.loadUserRules();
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].id, 'r1');
  assert.equal(loaded[0].action, 'require-ack');
});

test('BLOCK-160 ORC-1 匹配器：command-token 首 token / path-glob 大小写不敏感', () => {
  const rules = [
    { id: 'rn', matcher: { type: 'command-token', pattern: 'npm' }, action: 'deny', scope: 'global' },
    { id: 'rg', matcher: { type: 'path-glob', pattern: 'secrets/**' }, action: 'deny', scope: 'global' },
  ];
  const hitCmd = policy.evaluateUserRules('workspace_exec', { command: 'npm publish' }, { userRules: rules });
  assert.equal(hitCmd && hitCmd.rule && hitCmd.rule.id, 'rn');
  assert.equal(hitCmd && hitCmd.action, undefined); // 评估结果不带 action（动作由判定层读 rule）
  const hitGlob = policy.evaluateUserRules('workspace_write', { path: 'D:/proj/SECRETS/key.pem' }, { userRules: rules });
  assert.equal(hitGlob.rule?.id, 'rg');
  const miss = policy.evaluateUserRules('workspace_exec', { command: 'node -v' }, { userRules: rules });
  assert.equal(miss, null);
});

test('BLOCK-160 ORC-1 判定：deny → user_rule_denied；require-ack → 拦截+ack 通道放行', () => {
  // deny 规则
  const denyRules = [{ id: 'rd', matcher: { type: 'command-token', pattern: 'curl' }, action: 'deny', scope: 'global' }];
  const denied = policy.decideAgentToolCall({
    name: 'workspace_exec', args: { command: 'curl evil.example' },
    ctx: { ...FULL, userRules: denyRules }, contract: EXEC_CONTRACT,
  });
  assert.equal(denied.decision, 'deny');
  assert.equal(denied.reason, 'user_rule_denied');
  assert.match(denied.message, /rd/);

  // require-ack：无 ack=拦截（reason=user_rule_require_ack）；ack 集 rule:<id>=放行
  const ackRules = [{ id: 'ra', matcher: { type: 'path-glob', pattern: 'results/**' }, action: 'require-ack', scope: 'global' }];
  const blocked = policy.decideAgentToolCall({
    name: 'workspace_write', args: { path: 'results/out.csv' },
    ctx: { ...FULL, userRules: ackRules }, contract: WRITE_CONTRACT,
  });
  assert.equal(blocked.decision, 'deny');
  assert.equal(blocked.reason, 'user_rule_require_ack');
  assert.match(blocked.message, /ra/);

  const acked = policy.decideAgentToolCall({
    name: 'workspace_write', args: { path: 'results/out.csv' },
    ctx: { ...FULL, userRules: ackRules, dynamicGuardAcks: new Set(['rule:ra']) },
    contract: WRITE_CONTRACT,
  });
  assert.equal(acked.decision, 'allow', JSON.stringify(acked));
});

test('BLOCK-160 ORC-1 first-match：两条命中取数组首条', () => {
  const rules = [
    { id: 'first-ack', matcher: { type: 'command-token', pattern: 'git' }, action: 'require-ack', scope: 'global' },
    { id: 'second-deny', matcher: { type: 'command-token', pattern: 'git' }, action: 'deny', scope: 'global' },
  ];
  const r = policy.decideAgentToolCall({
    name: 'workspace_exec', args: { command: 'git push' },
    ctx: { ...FULL, userRules: rules }, contract: EXEC_CONTRACT,
  });
  assert.equal(r.reason, 'user_rule_require_ack');
});

test('BLOCK-160 ORC-1 零规则/无 ctx：决策零扰动（fail-soft）', () => {
  const r = policy.decideAgentToolCall({
    name: 'workspace_exec', args: { command: 'npm test' }, ctx: FULL, contract: EXEC_CONTRACT,
  });
  assert.equal(r.decision, 'allow');
});

test('BLOCK-160 ORC-1 接线钉：拦截器必须注入 ctx.userRules（源码扫描守卫）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'core/biof3-server/agent-tools/agent-tool-interceptor.js'), 'utf8');
  assert.match(src, /userRules/, '拦截器应注入 ctx.userRules');
  assert.match(src, /loadUserRules/, '拦截器应调用 loadUserRules');
});
