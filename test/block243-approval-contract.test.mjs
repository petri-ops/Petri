/**
 * BLOCK-243 — Q1 审批契约 v2 与 MCP trust 生效（红绿先行）。
 *
 * 钉住：
 * - 审批请求记录 scope / 原始+生效参数预览（脱敏有界）/ 重复 pending 计数 / 决策耗时；
 * - once=生效参数指纹、task=维度 ack、always 仅 MCP 且写 trust allow；
 * - updatedInput 决策前重新跑 schema + preflight + policy，只放行本次审批的 guardKey，
 *   新风险维度一律拒绝；缺上下文快照/工具不可用时 fail-closed；
 * - MCP trust='ask' 只对 destructive 工具要求审批，'allow' 自动放行，ack/指纹放行语义互通；
 * - permission.resolved 审计形状（原始/生效哈希、范围、耗时、脱敏输入）。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// 隔离本地数据根（MCP policy / 用户规则读取不得落到真实用户目录）
{
  const fssync = require('node:fs');
  const os = require('node:os');
  const pathmod = require('node:path');
  const dataDir = fssync.mkdtempSync(pathmod.join(os.tmpdir(), 'petri-b243-data-'));
  process.env.PETRI_LOCAL_DATA_DIR = dataDir;
  process.on('exit', () => {
    try { fssync.rmSync(dataDir, { recursive: true, force: true }); } catch { /* Windows 句柄延迟 */ }
  });
}

// 内存 DB 自举（拦截器/registry require 链拉起 db 模块；PETRI_DB_PATH 须先行）
{
  const Database = require('better-sqlite3');
  const fssync = require('node:fs');
  const os = require('node:os');
  const pathmod = require('node:path');
  const tempDbDir = fssync.mkdtempSync(pathmod.join(os.tmpdir(), 'petri-b243-'));
  const boot = new Database(pathmod.join(tempDbDir, 'petri.db'));
  const migrationsDir = pathmod.join(root, 'src', 'migrations');
  for (const f of fssync.readdirSync(migrationsDir).filter((x) => x.endsWith('.sql')).sort()) {
    boot.exec(fssync.readFileSync(pathmod.join(migrationsDir, f), 'utf8'));
  }
  boot.close();
  process.env.PETRI_DB_PATH = pathmod.join(tempDbDir, 'petri.db');
  process.on('exit', () => {
    try { fssync.rmSync(tempDbDir, { recursive: true, force: true }); } catch { /* Windows 句柄延迟 */ }
  });
}

const store = require(resolve(root, 'core/petri-server/helpers/approval-request-store.js'));
const revalidation = require(resolve(root, 'core/petri-server/helpers/approval-input-revalidation.js'));
const policy = require(resolve(root, 'core/petri-server/agent-tools/agent-tool-policy.js'));

const ARGS = { command: 'format C: /q' };
const CTX_SNAPSHOT = { accessMode: 'full', planMode: false, allowExecution: true, projectId: 'p1', userId: 'u1' };

function freshTask(taskId = 'b243-store') {
  const approvalRequests = store.createApprovalRequests(taskId);
  return { approvalRequests, cleanup: () => store.releaseApprovalRequests(taskId) };
}

function register(approvalRequests, extra = {}) {
  return store.registerApprovalRequest(approvalRequests, {
    toolName: 'workspace_exec',
    args: ARGS,
    guardKey: 'cmd:format',
    dimension: 'command',
    detail: '命中系统级破坏命令维度',
    ctxSnapshot: CTX_SNAPSHOT,
    ...extra,
  });
}

test('BLOCK-243 注册：参数预览/可编辑性/待审批计数/重复 pending 幂等', () => {
  const { approvalRequests, cleanup } = freshTask();
  const first = register(approvalRequests);
  assert.equal(first.ok, true);
  assert.equal(first.created, true);
  assert.equal(first.request.argsPreview, JSON.stringify(ARGS));
  assert.equal(first.request.inputEditable, true);
  assert.equal(first.request.argsPreviewTruncated, false);
  assert.equal(first.request.mcpServerId, null);
  assert.deepEqual(first.request.ctxSnapshot, CTX_SNAPSHOT);
  assert.equal(first.pendingCount, 1);

  const second = register(approvalRequests);
  assert.equal(second.created, false);
  assert.equal(second.request.requestId, first.request.requestId);
  assert.equal(second.duplicateOfRequestId, first.request.requestId);
  assert.equal(second.pendingCount, 1, '重复调用不新增 pending');
  cleanup();
});

test('BLOCK-243 参数预览：敏感键脱敏后不可编辑；超大有界截断', () => {
  const { approvalRequests, cleanup } = freshTask('b243-preview');
  const secret = register(approvalRequests, {
    toolName: 'mcp_demo_write',
    args: { apiKey: 'sk-live-secret', path: 'a.txt' },
    guardKey: 'mcp:demo',
  });
  assert.match(secret.request.argsPreview, /\[REDACTED\]/);
  assert.equal(secret.request.inputEditable, false, '含脱敏字段时不允许编辑回写');

  const huge = register(approvalRequests, {
    toolName: 'workspace_write',
    args: { path: 'a.txt', content: 'x'.repeat(10_000) },
    guardKey: 'path:test',
  });
  assert.equal(huge.request.argsPreviewTruncated, true);
  assert.equal(huge.request.inputEditable, false, '截断预览不可编辑');
  assert.ok(huge.request.argsPreview.length <= store.MAX_PREVIEW_CHARS + 1);
  cleanup();
});

test('BLOCK-243 once + updatedInput：登记一次性参数替换，不批原指纹', () => {
  const { approvalRequests, cleanup } = freshTask('b243-once');
  const reg = register(approvalRequests);
  const updated = { command: 'echo safe' };
  const decision = store.decideApprovalRequest({
    taskId: 'b243-once',
    requestId: reg.request.requestId,
    decision: 'approve',
    scope: 'once',
    updatedInput: updated,
  });
  assert.equal(decision.ok, true, JSON.stringify(decision));
  assert.equal(decision.scope, 'once');
  assert.equal(decision.override, true);
  assert.equal(decision.consumeOnUse, false);
  assert.equal(decision.fingerprint, null, '原指纹不进入放行集（避免执行原参数）');
  assert.equal(reg.request.updatedInput, true);
  assert.equal(reg.request.originalFingerprint, reg.request.fingerprint);
  assert.equal(reg.request.effectiveFingerprint, store.callFingerprint('workspace_exec', updated));
  assert.equal(reg.request.status, 'approved');
  assert.equal(reg.request.scope, 'once');
  assert.ok(reg.request.durationMs >= 0);

  const override = store.findInputOverride({ approvalRequests }, reg.request.fingerprint);
  assert.ok(override, '原始指纹→生效参数替换在场');
  assert.deepEqual(override.args, updated);
  assert.equal(override.requestId, reg.request.requestId);
  store.consumeInputOverride({ approvalRequests }, reg.request.fingerprint);
  assert.equal(store.findInputOverride({ approvalRequests }, reg.request.fingerprint), null);
  cleanup();
});

test('BLOCK-243 编辑参数只允许 once 范围（task/always 先按原参数建立范围）', () => {
  const { approvalRequests, cleanup } = freshTask('b243-updated-scope');
  const reg = register(approvalRequests);
  const decision = store.decideApprovalRequest({
    taskId: 'b243-updated-scope',
    requestId: reg.request.requestId,
    decision: 'approve',
    scope: 'task',
    updatedInput: { command: 'echo safe' },
    ackGuardKey: () => ({ ok: true }),
  });
  assert.equal(decision.ok, false);
  assert.equal(decision.error, 'updated_input_requires_once');
  assert.equal(reg.request.status, 'pending');
  cleanup();
});

test('BLOCK-243 编辑参数执行替换：模型重试原调用 → 处理器收到生效参数、替换一次性消费', async () => {
  const { approvalRequests, cleanup } = freshTask('b243-override');
  const seen = [];
  const entry = {
    contract: { category: 'workspace', sideEffect: 'execution', riskTier: 'R2' },
    definition: {
      function: {
        parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
      },
    },
    handler: async (args) => { seen.push(args); return { ok: true }; },
  };
  const { createAgentToolInterceptor } = require(resolve(root, 'core/petri-server/agent-tools/agent-tool-interceptor.js'));
  const intercept = createAgentToolInterceptor({
    getToolEntry: () => entry,
    preflightWorkspaceTool: async () => ({ ok: true }),
  });
  const ctx = {
    accessMode: 'full',
    approvalRequests,
    approvedFingerprints: approvalRequests.approvedFingerprints,
  };
  const denied = await intercept('workspace_exec', ARGS, ctx);
  assert.equal(denied.error, 'dynamic_guard_triggered');
  const decision = store.decideApprovalRequest({
    taskId: 'b243-override',
    requestId: denied.requestId,
    decision: 'approve',
    scope: 'once',
    updatedInput: { command: 'echo edited' },
  });
  assert.equal(decision.override, true);

  let overrideMeta = null;
  const allowed = await intercept('workspace_exec', ARGS, ctx, {
    onInputOverride: (meta) => { overrideMeta = meta; },
  });
  assert.equal(allowed.ok, true, JSON.stringify(allowed));
  assert.deepEqual(seen, [{ command: 'echo edited' }], '处理器收到用户编辑后的参数');
  assert.equal(overrideMeta.edited, true);
  assert.equal(overrideMeta.requestId, denied.requestId);
  assert.equal(overrideMeta.originalFingerprint, store.callFingerprint('workspace_exec', ARGS));
  assert.equal(overrideMeta.effectiveFingerprint, store.callFingerprint('workspace_exec', { command: 'echo edited' }));
  assert.equal(store.findInputOverride(ctx, store.callFingerprint('workspace_exec', ARGS)), null, '一次性消费');

  const again = await intercept('workspace_exec', ARGS, ctx);
  assert.equal(again.error, 'dynamic_guard_triggered', '替换消费后回到动态防护');
  cleanup();
});

test('BLOCK-243 task：写维度级 ack；legacy mode=always 映射为 task', () => {
  const { approvalRequests, cleanup } = freshTask('b243-task');
  const acked = new Set();
  const reg = register(approvalRequests);
  const decision = store.decideApprovalRequest({
    taskId: 'b243-task',
    requestId: reg.request.requestId,
    decision: 'approve',
    scope: 'task',
    ackGuardKey: (key) => { acked.add(key); return { ok: true }; },
  });
  assert.equal(decision.ok, true);
  assert.equal(decision.scope, 'task');
  assert.equal(decision.consumeOnUse, false);
  assert.ok(acked.has('cmd:format'));

  const legacy = register(approvalRequests, { args: { command: 'dd if=x' }, guardKey: 'cmd:dd' });
  const legacyDecision = store.decideApprovalRequest({
    taskId: 'b243-task',
    requestId: legacy.request.requestId,
    decision: 'approve',
    mode: 'always',
    ackGuardKey: () => ({ ok: true }),
  });
  assert.equal(legacyDecision.ok, true);
  assert.equal(legacyDecision.scope, 'task', 'mode=always 兼容映射为任务级');
  cleanup();
});

test('BLOCK-243 always：仅 MCP 请求可用；applyAlways 失败时保持 pending', () => {
  const { approvalRequests, cleanup } = freshTask('b243-always');
  const plain = register(approvalRequests);
  const rejected = store.decideApprovalRequest({
    taskId: 'b243-always',
    requestId: plain.request.requestId,
    decision: 'approve',
    scope: 'always',
    applyAlways: () => ({ ok: true }),
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error, 'always_scope_unavailable');
  assert.equal(plain.request.status, 'pending', '失败不改终态');

  const mcp = register(approvalRequests, {
    toolName: 'mcp_demo_destructive',
    args: { target: 'db' },
    guardKey: 'mcp:demo',
    mcpServerId: 'demo',
  });
  const failed = store.decideApprovalRequest({
    taskId: 'b243-always',
    requestId: mcp.request.requestId,
    decision: 'approve',
    scope: 'always',
    applyAlways: () => ({ ok: false, error: 'trust_write_failed' }),
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.error, 'trust_write_failed');
  assert.equal(mcp.request.status, 'pending', 'trust 写失败不改终态');

  const applied = store.decideApprovalRequest({
    taskId: 'b243-always',
    requestId: mcp.request.requestId,
    decision: 'approve',
    scope: 'always',
    applyAlways: () => ({ ok: true }),
  });
  assert.equal(applied.ok, true);
  assert.equal(applied.scope, 'always');
  assert.equal(mcp.request.status, 'approved');
  cleanup();
});

test('BLOCK-243 审计：permission.resolved 含原始/生效哈希、范围、耗时、脱敏输入', () => {
  const { approvalRequests, cleanup } = freshTask('b243-audit');
  const reg = register(approvalRequests);
  const decision = store.decideApprovalRequest({
    taskId: 'b243-audit',
    requestId: reg.request.requestId,
    decision: 'approve',
    scope: 'once',
    updatedInput: { command: 'echo safe' },
    reason: '用户改了命令',
  });
  const event = store.buildPermissionResolvedEvent(reg.request, decision);
  assert.equal(event.event, 'permission.resolved');
  assert.equal(event.decision, 'approve');
  assert.equal(event.behavior, 'allow');
  assert.equal(event.scope, 'once');
  assert.equal(event.reason, '用户改了命令');
  assert.equal(event.toolName, 'workspace_exec');
  assert.equal(event.guardKey, 'cmd:format');
  assert.equal(event.updatedInput, true);
  assert.equal(event.originalInputHash, reg.request.fingerprint);
  assert.equal(event.effectiveInputHash, store.callFingerprint('workspace_exec', { command: 'echo safe' }));
  assert.match(event.originalInput, /format C:/);
  assert.match(event.effectiveInput, /echo safe/);
  assert.ok(event.durationMs >= 0);
  assert.ok(event.at);
  cleanup();
});

test('BLOCK-243 重校验：schema 失败拒绝，工具不可用/快照缺失 fail-closed', async () => {
  const entry = {
    contract: { category: 'workspace', sideEffect: 'execution', riskTier: 'R2' },
    definition: {
      function: {
        parameters: {
          type: 'object',
          properties: { command: { type: 'string' } },
          required: ['command'],
        },
      },
    },
  };
  const revalidate = revalidation.createApprovalInputRevalidator({
    getToolEntry: () => entry,
    preflightWorkspaceTool: async () => ({ ok: true }),
  });
  const request = { toolName: 'workspace_exec', guardKey: 'cmd:format', ctxSnapshot: CTX_SNAPSHOT };

  const invalid = await revalidate({ request, updatedInput: { command: 42 } });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error, 'updated_input_invalid');
  assert.ok(Array.isArray(invalid.details) && invalid.details.length > 0);

  const missingTool = await revalidation.createApprovalInputRevalidator({
    getToolEntry: () => null,
    preflightWorkspaceTool: async () => ({ ok: true }),
  })({ request, updatedInput: { command: 'echo ok' } });
  assert.equal(missingTool.error, 'tool_unavailable');

  const noSnapshot = await revalidate({ request: { ...request, ctxSnapshot: null }, updatedInput: { command: 'echo ok' } });
  assert.equal(noSnapshot.error, 'updated_input_unavailable');
});

test('BLOCK-243 重校验：同一 guardKey 放行、新风险维度拒绝、preflight 失败拒绝', async () => {
  const entry = {
    contract: { category: 'workspace', sideEffect: 'execution', riskTier: 'R2' },
    definition: {
      function: {
        parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
      },
    },
  };
  const request = { toolName: 'workspace_exec', guardKey: 'cmd:format', ctxSnapshot: CTX_SNAPSHOT };
  const revalidate = revalidation.createApprovalInputRevalidator({
    getToolEntry: () => entry,
    preflightWorkspaceTool: async () => ({ ok: true }),
  });
  const sameGuard = await revalidate({ request, updatedInput: { command: 'format D: /q' } });
  assert.equal(sameGuard.ok, true, JSON.stringify(sameGuard));

  const newGuard = await revalidate({ request, updatedInput: { command: 'mkfs /dev/sda' } });
  assert.equal(newGuard.ok, false);
  assert.equal(newGuard.error, 'updated_input_denied');
  assert.equal(newGuard.decision.error, 'dynamic_guard_triggered');

  const preflightFails = await revalidation.createApprovalInputRevalidator({
    getToolEntry: () => entry,
    preflightWorkspaceTool: async () => ({ ok: false, error: 'path_escape', message: '越界' }),
  })({ request, updatedInput: { command: 'echo ok' } });
  assert.equal(preflightFails.ok, false);
  assert.equal(preflightFails.error, 'updated_input_denied');
});

test('BLOCK-243 MCP trust：ask+destructive 需审批；allow/非 destructive/ack/指纹放行', () => {
  const contract = {
    category: 'action',
    sideEffect: 'execution',
    riskTier: 'R2',
    mcpApproval: { serverId: 'demo', destructive: true },
  };
  const name = 'mcp_demo_destructive';
  const args = { target: 'db' };
  const baseCtx = {
    accessMode: 'full',
    mcpApproval: { serverId: 'demo', destructive: true, trust: 'ask' },
  };
  const denied = policy.decideAgentToolCall({ name, args, ctx: baseCtx, contract });
  assert.equal(denied.decision, 'deny');
  assert.equal(denied.error, 'mcp_trust_required');
  assert.equal(denied.reason, 'mcp_trust_required');
  assert.equal(denied.guardKey, 'mcp:demo');
  assert.equal(denied.dimension, 'mcp-trust');
  assert.equal(denied.mcpServerId, 'demo');
  assert.match(denied.explanation, /destructive/);
  assert.equal(denied.approvalVariant, 'info');

  const allowedByTrust = policy.decideAgentToolCall({
    name, args, contract,
    ctx: { accessMode: 'full', mcpApproval: { ...baseCtx.mcpApproval, trust: 'allow' } },
  });
  assert.equal(allowedByTrust.decision, 'allow');

  const nonDestructive = policy.decideAgentToolCall({
    name, args, contract,
    ctx: { accessMode: 'full', mcpApproval: { serverId: 'demo', destructive: false, trust: 'ask' } },
  });
  assert.equal(nonDestructive.decision, 'allow');

  const acked = policy.decideAgentToolCall({
    name, args, contract,
    ctx: { ...baseCtx, dynamicGuardAcks: new Set(['mcp:demo']) },
  });
  assert.equal(acked.decision, 'allow');

  const fingerprint = store.callFingerprint(name, args);
  const fingerprintApproved = policy.decideAgentToolCall({
    name, args, contract,
    ctx: { ...baseCtx, approvedFingerprints: new Set([fingerprint]) },
  });
  assert.equal(fingerprintApproved.decision, 'allow');
  assert.equal(fingerprintApproved.fingerprintConsumable, fingerprint);
});

test('BLOCK-243 MCP trust：构造器从合同元数据 + 当前策略解析 trust（缺策略 fail-closed ask）', () => {
  const interceptor = require(resolve(root, 'core/petri-server/agent-tools/agent-tool-interceptor.js'));
  const meta = interceptor.resolveMcpApprovalContext({
    contract: { mcpApproval: { serverId: 'demo', destructive: true } },
  });
  assert.deepEqual(meta, { serverId: 'demo', destructive: true, trust: 'ask' });
  assert.equal(interceptor.resolveMcpApprovalContext({ contract: {} }), null);
});
