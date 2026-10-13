/**
 * BLOCK-180 — 审批一等资源集成断言（policy+拦截器+store 三层接线）。
 * 钉住：
 * ① deny 信封携 requestId/spans/expiresAt（guardKey 既有字段不动）；
 * ② 「放行一次」：approve once→指纹放行→拦截器执行前消耗→同指纹再调需重批；
 * ③ 「总是放行」：维度级 guardKey Set 语义零改写（存量路径）；
 * ④ store 缺席=存量行为（纯键确认，信封无 requestId）。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import path, { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// 内存 DB 自举（拦截器 require 链拉起 db 模块，同 block109 先例：PETRI_DB_PATH 先行）
{
  const Database = require('better-sqlite3');
  const fssync = require('node:fs');
  const os = require('node:os');
  const tempDbDir = fssync.mkdtempSync(path.join(os.tmpdir(), 'petri-b180-'));
  const boot = new Database(path.join(tempDbDir, 'petri.db'));
  const migrationsDir = path.join(root, 'src', 'migrations');
  for (const f of fssync.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    boot.exec(fssync.readFileSync(path.join(migrationsDir, f), 'utf8'));
  }
  boot.close();
  process.env.PETRI_DB_PATH = path.join(tempDbDir, 'petri.db');
  process.on('exit', () => {
    try { fssync.rmSync(tempDbDir, { recursive: true, force: true }); } catch { /* Windows 句柄延迟 */ }
  });
}

const { createAgentToolInterceptor } = require(resolve(root, 'core/petri-server/agent-tools/agent-tool-interceptor.js'));
const policy = require(resolve(root, 'core/petri-server/agent-tools/agent-tool-policy.js'));
const store = require(resolve(root, 'core/petri-server/helpers/approval-request-store.js'));
const { createGuardAcks, releaseGuardAcks } = require(resolve(root, 'core/petri-server/helpers/guard-ack-store.js'));

const EXEC_CONTRACT = { category: 'workspace', sideEffect: 'execution', riskTier: 'R2' };
// 测试注入 stub entry+fake preflight（真实 handler/preflight 依赖项目上下文，本测试只钉审批 wiring）
const stubEntry = {
  contract: EXEC_CONTRACT,
  definition: { function: { name: 'workspace_exec', parameters: { type: 'object', properties: {} } } },
  handler: async () => ({ ok: true, executed: true }),
};
const interceptAgentToolCall = createAgentToolInterceptor({
  getToolEntry: () => stubEntry,
  preflightWorkspaceTool: async () => ({ ok: true }),
});
const ARGS = { command: 'format C: /q' };
const CTX_BASE = { accessMode: 'full', userId: 'u_b180' };

function freshTask(taskId) {
  const approvalRequests = store.createApprovalRequests(taskId);
  const ctx = {
    ...CTX_BASE,
    approvalRequests,
    approvedFingerprints: approvalRequests.approvedFingerprints,
  };
  return { ctx, cleanup: () => store.releaseApprovalRequests(taskId) };
}

test('① — 动态防护 deny 信封携 requestId/command/spans/expiresAt', async () => {
  const { ctx, cleanup } = freshTask('b180-a');
  const denied = await interceptAgentToolCall('workspace_exec', ARGS, ctx);
  assert.equal(denied.ok, false);
  assert.equal(denied.error, 'dynamic_guard_triggered');
  assert.equal(denied.guardKey, 'cmd:format', 'guardKey 既有字段不动');
  assert.ok(denied.requestId && denied.requestId.startsWith('apr_'), 'requestId 随信封');
  assert.ok(denied.expiresAt, 'expiresAt 随信封');
  assert.equal(denied.command, ARGS.command);
  assert.ok(Array.isArray(denied.spans) && denied.spans.some((s) => s.kind === 'destructive-token'), '破坏 token span 随信封');

  // 幂等：模型重试同一调用，requestId 不漂移
  const retried = await interceptAgentToolCall('workspace_exec', ARGS, ctx);
  assert.equal(retried.requestId, denied.requestId, '重试复用同一 pending 请求');
  cleanup();
});

test('② — 放行一次：请求级 approve→指纹放行→执行前消耗→再调需重批', async () => {
  const { ctx, cleanup } = freshTask('b180-b');
  const denied = await interceptAgentToolCall('workspace_exec', ARGS, ctx);
  const decision = store.decideApprovalRequest({
    taskId: 'b180-b', requestId: denied.requestId, decision: 'approve', mode: 'once',
  });
  assert.equal(decision.ok, true);
  assert.equal(decision.consumeOnUse, true);
  ctx.approvedFingerprints.add(decision.fingerprint);

  const allowed = await interceptAgentToolCall('workspace_exec', ARGS, ctx, { __probe: true });
  assert.equal(allowed.ok, true, '指纹放行后同调用通过');
  assert.equal(ctx.approvedFingerprints.has(decision.fingerprint), false, '指纹已消耗');

  const again = await interceptAgentToolCall('workspace_exec', ARGS, ctx);
  assert.equal(again.error, 'dynamic_guard_triggered', '消耗后同指纹再调需重新审批');
  cleanup();
});

test('③ — 总是放行：guardKey 维度级语义零改写', async () => {
  const taskId = 'b180-c';
  const acks = createGuardAcks(taskId);
  const ctx = { ...CTX_BASE, dynamicGuardAcks: acks };
  const denied = await interceptAgentToolCall('workspace_exec', ARGS, ctx);
  assert.equal(denied.error, 'dynamic_guard_triggered');
  acks.add('cmd:format');
  const allowed = await interceptAgentToolCall('workspace_exec', ARGS, ctx);
  assert.equal(allowed.ok, true, '维度级 ack 放行（存量语义）');
  releaseGuardAcks(taskId);
});

test('④ — store 缺席=存量行为（信封无 requestId，纯键确认）', async () => {
  const ctx = { ...CTX_BASE };
  const denied = await interceptAgentToolCall('workspace_exec', ARGS, ctx);
  assert.equal(denied.error, 'dynamic_guard_triggered');
  assert.equal(denied.requestId, undefined, '无资源 store 时信封不掺新字段');
  assert.equal(denied.spans, undefined);
});

test('⑤ — policy 纯读侧：指纹放行走 policy allow 且带消耗标记', () => {
  const taskId = 'b180-e';
  const approvalRequests = store.createApprovalRequests(taskId);
  const reg = store.registerApprovalRequest(approvalRequests, {
    toolName: 'workspace_exec', args: ARGS, guardKey: 'cmd:format', dimension: 'command',
  });
  const ctx = {
    ...CTX_BASE, approvalRequests,
    approvedFingerprints: approvalRequests.approvedFingerprints,
  };
  ctx.approvedFingerprints.add(reg.request.fingerprint);
  const decision = policy.decideAgentToolCall({ name: 'workspace_exec', args: ARGS, ctx, contract: EXEC_CONTRACT, preflight: { ok: true } });
  assert.equal(decision.decision, 'allow');
  assert.equal(decision.fingerprintConsumable, reg.request.fingerprint, 'allow 携消耗标记供拦截器消耗');
  store.releaseApprovalRequests(taskId);
});
