/**
 * BLOCK-323 — 放权坡道（observe→allow 渐进放权）契约（红绿先行）。
 *
 * 钉住：
 * - schema：规则 action 枚举扩 observe/allow（非法动作仍拒）；
 * - policy：observe 命中不拦截且透出 observation；allow 命中跳层 4/5（MCP trust ask /
 *   工具策略 ask/deny）但动态防护/循环防护照走（安全地板）；工具层 observe 仅 mutating 记录；
 * - 观察存储：UPSERT 合并（同键一行 hits 累计、首见样本保留）、复盘标记、自动放行审计、
 *   规则变更留痕；
 * - 拦截器胶水：最终 allow 决策上的 observation → policy_observations 落账；
 * - saveUserRules 留痕：动作变化记 policy-change 行。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-b323-data-'));
process.env.PETRI_LOCAL_DATA_DIR = dataDir;

{
  const Database = require('better-sqlite3');
  const tempDbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-b323-db-'));
  const boot = new Database(path.join(tempDbDir, 'petri.db'));
  const migrationsDir = path.join(root, 'src', 'migrations');
  for (const f of fs.readdirSync(migrationsDir).filter((x) => x.endsWith('.sql')).sort()) {
    boot.exec(fs.readFileSync(path.join(migrationsDir, f), 'utf8'));
  }
  boot.close();
  process.env.PETRI_DB_PATH = path.join(tempDbDir, 'petri.db');
  process.on('exit', () => {
    try { fs.rmSync(tempDbDir, { recursive: true, force: true }); } catch { /* Windows */ }
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* Windows */ }
  });
}

const userRules = require(resolve(root, 'core/petri-server/helpers/agent-user-rules.js'));
const policy = require(resolve(root, 'core/petri-server/agent-tools/agent-tool-policy.js'));
const riskRules = require(resolve(root, 'core/petri-server/helpers/command-risk-rules.js'));
const interceptorMod = require(resolve(root, 'core/petri-server/agent-tools/agent-tool-interceptor.js'));

const EXEC_CONTRACT = { category: 'workspace', sideEffect: 'execution', riskTier: 'R2' };
const READ_CONTRACT = { category: 'retrieval', sideEffect: 'none', riskTier: 'R1' };

function rule(id, type, pattern, action) {
  return { id, matcher: { type, pattern }, action, scope: 'global' };
}

test('BLOCK-323 schema：observe/allow 合法、非法动作仍拒', () => {
  for (const action of ['observe', 'allow']) {
    const { item, diagnostics } = userRules.normalizeRule(rule(`r-${action}`, 'command-token', 'npm', action));
    assert.ok(item, JSON.stringify(diagnostics));
    assert.equal(item.action, action);
  }
  const bad = userRules.normalizeRule(rule('r-bad', 'command-token', 'npm', 'auto'));
  assert.ok(bad.diagnostics.some((d) => d.path === 'action'), 'auto 不是合法动作（诊断指向 action）');
});

test('BLOCK-323 policy：observe 命中不拦截且透出 observation', () => {
  const decision = policy.decideAgentToolCall({
    name: 'workspace_exec',
    args: { command: 'npm install' },
    ctx: { accessMode: 'full', userRules: [rule('r-obs', 'command-token', 'npm', 'observe')] },
    contract: EXEC_CONTRACT,
  });
  assert.equal(decision.decision, 'allow');
  assert.equal(decision.observation.kind, 'rule');
  assert.equal(decision.observation.ruleId, 'r-obs');
  assert.equal(decision.observation.guardKey, 'rule:r-obs');
  assert.ok(decision.observation.fingerprint, '指纹应在场');
});

test('BLOCK-323 policy：observe 命中破坏命令仍被动态防护拦（安全地板）', () => {
  const danger = [...riskRules.DANGEROUS_FIRST_TOKENS][0];
  const decision = policy.decideAgentToolCall({
    name: 'workspace_exec',
    args: { command: `${danger} something` },
    ctx: { accessMode: 'full', userRules: [rule('r-obs', 'command-token', danger, 'observe')] },
    contract: EXEC_CONTRACT,
  });
  assert.equal(decision.decision, 'deny');
  assert.equal(decision.reason, 'dynamic_guard');
});

test('BLOCK-323 policy：allow 命中跳工具策略 ask/deny，但动态防护/循环防护照走', () => {
  const base = { accessMode: 'full', userRules: [rule('r-allow', 'command-token', 'npm', 'allow')] };
  // 工具策略 ask 本会拦截 → 规则 allow 豁免（更具体的目标级裁决优先）
  const allowed = policy.decideAgentToolCall({
    name: 'workspace_exec', args: { command: 'npm install' },
    ctx: { ...base, toolApprovalMode: 'ask' }, contract: EXEC_CONTRACT,
  });
  assert.equal(allowed.decision, 'allow');
  assert.equal(allowed.autoAllowed.ruleId, 'r-allow');
  // 工具策略 deny 同样被更具体规则豁免
  const deniedTool = policy.decideAgentToolCall({
    name: 'workspace_exec', args: { command: 'npm install' },
    ctx: { ...base, toolApprovalMode: 'deny' }, contract: EXEC_CONTRACT,
  });
  assert.equal(deniedTool.decision, 'allow');
  // 安全地板：破坏命令仍拦
  const danger = [...riskRules.DANGEROUS_FIRST_TOKENS][0];
  const hardFloor = policy.decideAgentToolCall({
    name: 'workspace_exec', args: { command: `${danger} x` },
    ctx: { ...base, userRules: [rule('r-allow', 'command-token', danger, 'allow')] }, contract: EXEC_CONTRACT,
  });
  assert.equal(hardFloor.decision, 'deny');
  assert.equal(hardFloor.reason, 'dynamic_guard');
  // 安全地板：循环防护仍拦（同指纹连续 ≥ 阈值）
  const fingerprint = require(resolve(root, 'core/petri-server/helpers/approval-request-store.js')).callFingerprint('workspace_exec', { command: 'npm install' });
  const looped = policy.decideAgentToolCall({
    name: 'workspace_exec', args: { command: 'npm install' },
    ctx: {
      ...base,
      approvalRequests: { callHistory: Array.from({ length: 3 }, () => ({ fingerprint })) },
    },
    contract: EXEC_CONTRACT,
  });
  assert.equal(looped.decision, 'deny');
  assert.equal(looped.reason, 'loop_guard');
});

test('BLOCK-323 policy：工具层 observe 仅 mutating 记录；规则在先不重复记录', () => {
  const observedTool = policy.decideAgentToolCall({
    name: 'workspace_exec', args: { command: 'npm install' },
    ctx: { accessMode: 'full', toolApprovalMode: 'observe' }, contract: EXEC_CONTRACT,
  });
  assert.equal(observedTool.decision, 'allow');
  assert.equal(observedTool.observation.kind, 'tool');
  assert.equal(observedTool.observation.guardKey, 'tool:workspace_exec');
  // 读工具：observe 不记录（默认已放行，观察无意义）
  const readTool = policy.decideAgentToolCall({
    name: 'workspace_read', args: { path: 'a.txt' },
    ctx: { accessMode: 'full', toolApprovalMode: 'observe' }, contract: READ_CONTRACT,
  });
  assert.equal(readTool.decision, 'allow');
  assert.equal(readTool.observation, undefined);
  // 规则 observe 在先：只记规则观察，不叠加工具观察
  const bothLayers = policy.decideAgentToolCall({
    name: 'workspace_exec', args: { command: 'npm install' },
    ctx: {
      accessMode: 'full', toolApprovalMode: 'observe',
      userRules: [rule('r-obs', 'command-token', 'npm', 'observe')],
    }, contract: EXEC_CONTRACT,
  });
  assert.equal(bothLayers.observation.kind, 'rule');
});

test('BLOCK-323 观察存储：UPSERT 合并/首见样本保留/复盘/审计/留痕', async () => {
  const store = require(resolve(root, 'core/petri-server/helpers/policy-observation-store.js'));
  const first = await store.recordObservation({
    kind: 'rule-observe', ruleId: 'r-obs', toolName: 'workspace_exec',
    fingerprint: 'fp-a', guardKey: 'rule:r-obs', samplePreview: '{"command":"npm install"}',
  });
  assert.equal(first.ok, true);
  const second = await store.recordObservation({
    kind: 'rule-observe', ruleId: 'r-obs', toolName: 'workspace_exec',
    fingerprint: 'fp-a', guardKey: 'rule:r-obs', samplePreview: '{"command":"npm ci"}',
  });
  assert.equal(second.ok, true);
  assert.equal(second.hits, 2, '同键第二次命中 hits=2');

  let unreviewed = await store.listUnreviewed();
  assert.equal(unreviewed.length, 1);
  assert.equal(unreviewed[0].hits, 2);
  assert.equal(unreviewed[0].samplePreview, '{"command":"npm install"}', '首见样本保留');
  assert.equal(await store.unreviewedCount(), 1);

  const reviewed = await store.markReviewed({ ids: [unreviewed[0].id] });
  assert.equal(reviewed.ok, true);
  assert.equal(reviewed.updated, 1);
  assert.equal(await store.unreviewedCount(), 0);

  await store.recordObservation({
    kind: 'rule-auto-allow', ruleId: 'r-allow', toolName: 'workspace_exec',
    fingerprint: 'fp-b', guardKey: 'rule:r-allow', samplePreview: '{"command":"npm install"}',
  });
  await store.recordObservation({
    kind: 'rule-auto-allow', ruleId: 'r-allow', toolName: 'workspace_exec',
    fingerprint: 'fp-b', guardKey: 'rule:r-allow', samplePreview: null,
  });
  const autoAllow = await store.listAutoAllow();
  assert.equal(autoAllow.length, 1);
  assert.equal(autoAllow[0].hits, 2);

  const change = await store.recordPolicyChange(JSON.stringify({ changed: [{ id: 'r-obs', from: 'observe', to: 'allow' }] }));
  assert.equal(change.ok, true);
  const changes = await store.listPolicyChanges();
  assert.equal(changes.length, 1);
  assert.equal(changes[0].kind, 'policy-change');
  assert.ok(changes[0].samplePreview.includes('observe'), '变更摘要含动作演变');
});

test('BLOCK-323 拦截器胶水：最终 allow 上的 observation 落账、deny 不落账', async () => {
  const store = require(resolve(root, 'core/petri-server/helpers/policy-observation-store.js'));
  const handlerCalls = [];
  const interceptor = interceptorMod.createAgentToolInterceptor({
    getToolEntry: (name) => ({
      contract: EXEC_CONTRACT,
      definition: { function: { name, description: 'exec', parameters: { type: 'object' } } },
      handler: async () => {
        handlerCalls.push(1);
        return { ok: true };
      },
    }),
    // 胶水测试不真跑 workspace preflight（项目工作区不在场）；放行为 ok
    preflightWorkspaceTool: async () => ({ ok: true, exists: false }),
  });
  const ctx = {
    accessMode: 'full',
    userRules: [rule('r-obs', 'command-token', 'npm', 'observe')],
  };
  const result = await interceptor('workspace_exec', { command: 'npm install' }, ctx);
  assert.equal(result.ok, true);
  assert.equal(handlerCalls.length, 1, 'observe 不拦截，handler 执行');
  // fire-and-forget 写入：让微任务排空
  await new Promise((r) => setImmediate(r));
  const unreviewed = await store.listUnreviewed();
  const recorded = unreviewed.find((row) => row.ruleId === 'r-obs');
  assert.ok(recorded, '观察行已落账');
  assert.equal(recorded.toolName, 'workspace_exec');
  // deny 路径：规则改 require-ack → 拦截且无新观察
  const denyResult = await interceptor(
    'workspace_exec',
    { command: 'curl example.com' },
    { accessMode: 'full', userRules: [rule('r-ack', 'command-token', 'curl', 'require-ack')] },
  );
  assert.equal(denyResult.ok, false);
  await new Promise((r) => setImmediate(r));
  const after = await store.listUnreviewed();
  assert.ok(!after.some((row) => row.ruleId === 'r-ack'), '被拦调用不产生坡道证据');
});

test('BLOCK-323 saveUserRules：动作变化记 policy-change 行（best-effort）', async () => {
  const store = require(resolve(root, 'core/petri-server/helpers/policy-observation-store.js'));
  const saved = userRules.saveUserRules([
    rule('r-obs', 'command-token', 'npm', 'observe'),
    rule('r-keep', 'path-glob', 'secrets/**', 'deny'),
  ]);
  assert.equal(saved.ok, true, JSON.stringify(saved));
  const upgraded = userRules.saveUserRules([
    rule('r-obs', 'command-token', 'npm', 'allow'),
    rule('r-keep', 'path-glob', 'secrets/**', 'deny'),
  ]);
  assert.equal(upgraded.ok, true);
  assert.deepEqual(userRules.diffRuleActions(
    [rule('a', 'command-token', 'npm', 'observe')],
    [rule('a', 'command-token', 'npm', 'allow'), rule('b', 'path-glob', 'x/**', 'deny')],
  ), [
    { id: 'a', from: 'observe', to: 'allow' },
    { id: 'b', from: null, to: 'deny' },
  ]);
  // fire-and-forget 留痕：让微任务排空后核对
  await new Promise((r) => setTimeout(r, 80));
  const changes = await store.listPolicyChanges();
  assert.ok(changes.length >= 1, '动作变化已留痕');
  const summary = changes[0].samplePreview || '';
  assert.ok(summary.includes('r-obs'), '摘要含变更规则 id');
  assert.ok(summary.includes('allow'), '摘要含目标动作');
});
