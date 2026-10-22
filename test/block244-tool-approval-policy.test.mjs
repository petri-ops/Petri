/**
 * BLOCK-244 — Q1-REM 审批控制面收尾（红绿先行）。
 *
 * 钉住：
 * - 工具审批策略 store：逐工具 allow/ask/deny，默认 allow，写侧 fail-closed；
 * - policy：ask 走 guardKey=tool:<name> 审批通道，deny 直接拦截，ack/指纹放行复用；
 * - 循环防护：mutating 同参连续 N 次 → loop_guard，read-only 豁免，不同参数重置；
 * - 意图/侧边任务：审批信封携 intent，子代理来源 source=side-task。
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

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-b244-data-'));
process.env.PETRI_LOCAL_DATA_DIR = dataDir;

{
  const Database = require('better-sqlite3');
  const tempDbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-b244-db-'));
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

const approvalStore = require(resolve(root, 'core/petri-server/helpers/approval-request-store.js'));
const toolPolicy = require(resolve(root, 'core/petri-server/helpers/tool-approval-policy.js'));
const policy = require(resolve(root, 'core/petri-server/agent-tools/agent-tool-policy.js'));

const EXEC_CONTRACT = { category: 'workspace', sideEffect: 'execution', riskTier: 'R2' };
const READ_CONTRACT = { category: 'retrieval', sideEffect: 'none', riskTier: 'R1' };
const ARGS = { command: 'echo hello' };

function resetPolicy() {
  toolPolicy.writeStore({ version: 1, tools: {} });
}

test('BLOCK-244 工具策略 store：默认 allow、ask/deny 落盘、非法写拒绝', () => {
  resetPolicy();
  assert.equal(toolPolicy.modeFor('workspace_exec'), 'allow');
  const ok = toolPolicy.writeStore({ version: 1, tools: { workspace_exec: 'ask', workspace_write: 'deny' } });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(toolPolicy.modeFor('workspace_exec'), 'ask');
  assert.equal(toolPolicy.modeFor('workspace_write'), 'deny');
  assert.equal(toolPolicy.modeFor('unknown_tool'), 'allow');

  const bad = toolPolicy.validateModes([{ name: 'workspace_exec', mode: 'yolo' }]);
  assert.equal(bad.ok, false);
  assert.ok(bad.diagnostics.some((d) => d.code === 'mode_invalid'));

  fs.writeFileSync(toolPolicy.policyFilePath(), '{not json', 'utf8');
  assert.equal(toolPolicy.modeFor('workspace_exec'), 'allow', '坏文件 fail-soft 到默认 allow');
  resetPolicy();
});

test('BLOCK-244 policy：ask 走 tool:<name> 审批通道；ack/指纹放行', () => {
  const ask = policy.decideAgentToolCall({
    name: 'workspace_exec', args: ARGS, contract: EXEC_CONTRACT,
    ctx: { accessMode: 'full', toolApprovalMode: 'ask' },
  });
  assert.equal(ask.decision, 'deny');
  assert.equal(ask.error, 'tool_approval_required');
  assert.equal(ask.guardKey, 'tool:workspace_exec');
  assert.equal(ask.dimension, 'tool-approval');
  assert.equal(ask.approvalVariant, 'warning');
  assert.match(ask.explanation, /工具审批策略/);

  const acked = policy.decideAgentToolCall({
    name: 'workspace_exec', args: ARGS, contract: EXEC_CONTRACT,
    ctx: { accessMode: 'full', toolApprovalMode: 'ask', dynamicGuardAcks: new Set(['tool:workspace_exec']) },
  });
  assert.equal(acked.decision, 'allow');

  const fingerprint = approvalStore.callFingerprint('workspace_exec', ARGS);
  const fp = policy.decideAgentToolCall({
    name: 'workspace_exec', args: ARGS, contract: EXEC_CONTRACT,
    ctx: { accessMode: 'full', toolApprovalMode: 'ask', approvedFingerprints: new Set([fingerprint]) },
  });
  assert.equal(fp.decision, 'allow');
  assert.equal(fp.fingerprintConsumable, fingerprint);
});

test('BLOCK-244 policy：deny 工具直接拦截，ask 不影响其他工具', () => {
  const denied = policy.decideAgentToolCall({
    name: 'workspace_write', args: { path: 'a.txt', content: 'x' },
    ctx: { accessMode: 'full', toolApprovalMode: 'deny' },
    contract: { category: 'workspace', sideEffect: 'workspace-write', riskTier: 'R2' },
  });
  assert.equal(denied.decision, 'deny');
  assert.equal(denied.error, 'tool_denied_by_policy');

  const other = policy.decideAgentToolCall({ name: 'workspace_read', args: { path: 'a.txt' }, ctx: { accessMode: 'read' }, contract: READ_CONTRACT });
  assert.equal(other.decision, 'allow');
});

test('BLOCK-244 循环防护：mutating 同参连续 3 次 → loop_guard；ack 放行；read-only 豁免；不同参数重置', () => {
  resetPolicy();
  const store = approvalStore.createApprovalRequests('b244-loop');
  const ctx = { accessMode: 'full', approvalRequests: store, dynamicGuardAcks: new Set() };
  for (let i = 0; i < 3; i += 1) approvalStore.recordToolCall(ctx, 'workspace_exec', ARGS);
  const guarded = policy.decideAgentToolCall({ name: 'workspace_exec', args: ARGS, ctx, contract: EXEC_CONTRACT });
  assert.equal(guarded.decision, 'deny');
  assert.equal(guarded.error, 'loop_guard');
  assert.match(guarded.guardKey, /^loop:/);
  assert.equal(guarded.dimension, 'loop');
  assert.match(guarded.explanation, /连续 3 次/);

  ctx.dynamicGuardAcks.add(guarded.guardKey);
  const acked = policy.decideAgentToolCall({ name: 'workspace_exec', args: ARGS, ctx, contract: EXEC_CONTRACT });
  assert.equal(acked.decision, 'allow');

  const readCtx = { accessMode: 'read', approvalRequests: store };
  for (let i = 0; i < 4; i += 1) approvalStore.recordToolCall(readCtx, 'workspace_read', { path: 'a.txt' });
  const readOk = policy.decideAgentToolCall({ name: 'workspace_read', args: { path: 'a.txt' }, ctx: readCtx, contract: READ_CONTRACT });
  assert.equal(readOk.decision, 'allow', 'read-only 不触发循环防护');

  approvalStore.recordToolCall(ctx, 'workspace_exec', { command: 'echo other' });
  const reset = policy.decideAgentToolCall({ name: 'workspace_exec', args: ARGS, ctx, contract: EXEC_CONTRACT });
  assert.equal(reset.decision, 'allow', '不同参数重置连续计数');
  approvalStore.releaseApprovalRequests('b244-loop');
});

test('BLOCK-244 循环防护阈值可用 env 覆盖', () => {  resetPolicy();
  process.env.PETRI_LOOP_GUARD_THRESHOLD = '4';
  try {
    const store = approvalStore.createApprovalRequests('b244-loop-env');
    const ctx = { accessMode: 'full', approvalRequests: store };
    for (let i = 0; i < 3; i += 1) approvalStore.recordToolCall(ctx, 'workspace_exec', ARGS);
    const three = policy.decideAgentToolCall({ name: 'workspace_exec', args: ARGS, ctx, contract: EXEC_CONTRACT });
    assert.equal(three.decision, 'allow', '阈值 4 时 3 次不触发');
    approvalStore.recordToolCall(ctx, 'workspace_exec', ARGS);
    const four = policy.decideAgentToolCall({ name: 'workspace_exec', args: ARGS, ctx, contract: EXEC_CONTRACT });
    assert.equal(four.error, 'loop_guard');
    approvalStore.releaseApprovalRequests('b244-loop-env');
  } finally {
    delete process.env.PETRI_LOOP_GUARD_THRESHOLD;
  }
});

test('BLOCK-244 同参重复归属：有审批通道时交给 loop_guard，无审批通道保持硬停', () => {
  const { createAgentToolCallController } = require(resolve(root, 'core/petri-server', 'agent-tools', 'agent-loop-control.js'));
  const rawCall = (id) => ({ id, type: 'function', function: { name: 'workspace_exec', arguments: '{"command":"echo hi"}' } });

  const unattended = createAgentToolCallController();
  let hard;
  for (let i = 0; i < 3; i += 1) hard = unattended.parse(rawCall(`u_${i}`), `u_${i}`);
  assert.equal(hard.error, 'repeated_tool_call', '无人值守仍硬停');
  assert.equal(unattended.anomalyHit(), true);

  const interactive = createAgentToolCallController({ canAskApproval: () => true });
  let passed;
  for (let i = 0; i < 4; i += 1) passed = interactive.parse(rawCall(`i_${i}`), `i_${i}`);
  assert.equal(passed.ok, true, '交互运行的第 3+ 次同参调用交给审批层，而不是硬停');
  assert.equal(interactive.anomalyHit(), false);
});

test('BLOCK-244 归属交接：审批通道在位时同参重复交给 loop_guard，无人值守仍硬停', () => {
  const { createAgentToolCallController } = require(resolve(root, 'core/petri-server', 'agent-tools', 'agent-loop-control.js'));
  const rawCall = (index, prefix) => ({
    id: `${prefix}_${index}`,
    type: 'function',
    function: { name: 'workspace_exec', arguments: JSON.stringify(ARGS) },
  });

  const unattended = createAgentToolCallController();
  let hard;
  for (let i = 0; i < 3; i += 1) hard = unattended.parse(rawCall(i, 'ua'), `ua_${i}`);
  assert.equal(hard.error, 'repeated_tool_call', '无审批通道保持硬停');
  assert.equal(unattended.anomalyHit(), true);

  const interactive = createAgentToolCallController({ canAskApproval: () => true });
  let passed;
  for (let i = 0; i < 4; i += 1) passed = interactive.parse(rawCall(i, 'ia'), `ia_${i}`);
  assert.equal(passed.ok, true, '交互运行的同参重复必须落到审批层，而不是被静默硬停');
  assert.equal(interactive.anomalyHit(), false);

  // 落到审批层后必须真的有人可确认（否则会静默放行）。
  const store = approvalStore.createApprovalRequests('b244-handoff');
  const ctx = { accessMode: 'full', approvalRequests: store };
  for (let i = 0; i < 3; i += 1) approvalStore.recordToolCall(ctx, 'workspace_exec', ARGS);
  const loopDeny = policy.decideAgentToolCall({ name: 'workspace_exec', args: ARGS, ctx, contract: EXEC_CONTRACT });
  assert.equal(loopDeny.error, 'loop_guard');
  assert.match(loopDeny.explanation, /连续 3 次/);
  approvalStore.releaseApprovalRequests('b244-handoff');
});

test('BLOCK-244 意图/侧边任务：审批信封携 intent 与 source=side-task', async () => {
  resetPolicy();
  toolPolicy.writeStore({ version: 1, tools: { workspace_exec: 'ask' } });
  const entry = {
    contract: EXEC_CONTRACT,
    definition: {
      function: {
        name: 'workspace_exec',
        description: '在项目工作区执行命令',
        parameters: { type: 'object', properties: { command: { type: 'string' } } },
      },
    },
    handler: async () => ({ ok: true }),
  };
  const { createAgentToolInterceptor } = require(resolve(root, 'core/petri-server/agent-tools/agent-tool-interceptor.js'));
  const intercept = createAgentToolInterceptor({
    getToolEntry: () => entry,
    preflightWorkspaceTool: async () => ({ ok: true }),
  });
  const store = approvalStore.createApprovalRequests('b244-intent');
  const denied = await intercept('workspace_exec', ARGS, {
    accessMode: 'full',
    taskKind: 'subagent',
    approvalRequests: store,
    approvedFingerprints: store.approvedFingerprints,
  });
  assert.equal(denied.error, 'tool_approval_required');
  assert.equal(denied.intent.action, '在项目工作区执行命令');
  assert.equal(denied.intent.impact, '执行本地命令/外部操作');
  assert.equal(denied.intent.reversible, '可能不可逆');
  assert.equal(denied.source, 'side-task');
  assert.equal(denied.approvalVariant, 'warning');
  // 实机抓真：审批载荷必须经 tool_result 事件顶层 approval 透出（intent/source
  // 曾漏在 APPROVAL_FIELDS 白名单外，前端意图块恒空）。
  const { buildToolResultEvent } = require(resolve(root, 'core/petri-server', 'agent-tools', 'tool-events.js'));
  const evt = buildToolResultEvent(
    { contractVersion: '1', traceId: 't_b244', callId: 'c_b244', tool: 'workspace_exec', status: 'denied', data: denied },
    ARGS,
    { iteration: 1 },
  );
  assert.equal(evt.toolResult.approval.intent.action, '在项目工作区执行命令');
  assert.equal(evt.toolResult.approval.source, 'side-task');
  approvalStore.releaseApprovalRequests('b244-intent');
  resetPolicy();
});
