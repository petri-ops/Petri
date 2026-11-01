/**
 * BLOCK-324 — 统一结构化原因码 taxonomy 契约（红绿先行）。
 *
 * 钉住：
 * - 注册表封闭集：category 封闭、renderReason 占位渲染/缺值保留/未注册诚实回退；
 * - 源码扫描机械锁：agent-tool-policy 的 deny/allow 首参字面量 ⊆ 注册表、
 *   拦截器 permission.auto_allowed 的 reasonCode ∈ 注册表——新增未注册场景即红
 *   （dsh docs.spec 表格双向对账同型：文档/词表与代码互为契约）；
 * - BLOCK-323 事件接线：auto-allow 携注册内 reasonCode 且渲染文本含规则 id。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const registry = require(resolve(root, 'core/petri-server/helpers/reason-codes.js'));

test('BLOCK-324 注册表：封闭集/类别封闭/词表出口形状', () => {
  assert.ok(Object.isFrozen(registry.REASONS), 'REASONS 冻结（封闭集）');
  assert.ok(Object.isFrozen(registry.REASON_CATEGORIES), '类别表冻结');
  const codes = registry.listReasonCodes();
  assert.ok(codes.length >= 16, `第一批归并规模=${codes.length}`);
  for (const entry of codes) {
    assert.ok(registry.REASON_CATEGORIES.includes(entry.category), `${entry.code} 类别=${entry.category} 在封闭集内`);
    assert.equal(typeof entry.template, 'string');
    assert.ok(entry.template.length > 0);
  }
  // 治理/审批族第一批归并在场（判定序六层 + preflight 族 + 放权坡道）
  for (const code of [
    'unknown_tool', 'user_rule_denied', 'user_rule_require_ack', 'dynamic_guard',
    'mcp_trust_required', 'tool_denied_by_policy', 'tool_approval_required', 'loop_guard',
    'read_only', 'policy_denied', 'project_required', 'permission_denied', 'invalid_arguments',
    'source_data_immutable', 'expected_sha256_required', 'policy_allowed', 'delegated_approval',
    'rule_auto_allow',
  ]) {
    assert.ok(registry.isRegisteredReason(code), `${code} 应已注册`);
  }
});

test('BLOCK-324 renderReason：占位渲染/缺值保留占位/未注册诚实回退', () => {
  assert.equal(
    registry.renderReason('user_rule_denied', { ruleId: 'r-x' }),
    '用户规则「r-x」拒绝此调用。',
  );
  assert.equal(
    registry.renderReason('loop_guard', { count: 3 }),
    '循环防护：连续 3 次相同调用，可能陷入循环。',
  );
  // 缺值保留占位（不静默吞）
  assert.ok(registry.renderReason('user_rule_denied', {}).includes('{ruleId}'));
  // 多余 values 忽略
  assert.equal(
    registry.renderReason('policy_allowed', { junk: 1 }),
    '策略放行（默认档位）。',
  );
  // 未注册 code：诚实回退，不假装注册
  const fallback = registry.renderReason('not_a_code');
  assert.ok(fallback.includes('not_a_code') && fallback.includes('未注册'));
  assert.equal(registry.isRegisteredReason('not_a_code'), false);
});

test('BLOCK-324 源码扫描机械锁：policy deny/allow 首参 ⊆ 注册表', () => {
  const source = fs.readFileSync(resolve(root, 'core/petri-server/agent-tools/agent-tool-policy.js'), 'utf8');
  const literals = new Set();
  for (const match of source.matchAll(/\b(?:deny|allow)\(\s*'([a-z0-9_]+)'/g)) {
    literals.add(match[1]);
  }
  assert.ok(literals.size >= 12, `扫描到判定原因字面量=${literals.size}（${[...literals].join(',')}）`);
  const unregistered = [...literals].filter((code) => !registry.isRegisteredReason(code));
  assert.deepEqual(unregistered, [], `新增判定原因必须先在 reason-codes.js 注册：${unregistered.join(', ')}`);
});

test('BLOCK-324 源码扫描机械锁：拦截器事件 reasonCode ∈ 注册表', () => {
  const source = fs.readFileSync(resolve(root, 'core/petri-server/agent-tools/agent-tool-interceptor.js'), 'utf8');
  const literals = new Set();
  for (const match of source.matchAll(/reasonCode:\s*'([a-z0-9_]+)'/g)) {
    literals.add(match[1]);
  }
  assert.ok(literals.has('rule_auto_allow'), 'auto-allow 事件应携 rule_auto_allow 原因码');
  const unregistered = [...literals].filter((code) => !registry.isRegisteredReason(code));
  assert.deepEqual(unregistered, [], `事件原因码必须先注册：${unregistered.join(', ')}`);
});

test('BLOCK-324 BLOCK-323 接线：auto-allow 渲染文本含规则 id（reasonText 消费方契约）', () => {
  const text = registry.renderReason('rule_auto_allow', { ruleId: 'r-npm' });
  assert.equal(text, '规则「r-npm」放行档自动执行，未经逐次确认。');
});
