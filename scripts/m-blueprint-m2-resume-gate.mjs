#!/usr/bin/env node
/**
 * gate:long-task-resume — M2（BLOCK-428）专项门：崩溃续跑 / 任务图 / 幂等 / 租约判据。
 * 纯函数 adjudicateResume 可被负测注入篡改（门自身防假绿）。
 *
 * 用法：node scripts/m-blueprint-m2-resume-gate.mjs --check [--report <path>]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
export const collectResumeModule = () => require(path.join(ROOT, 'core/petri-server/agent-tools/long-task-resume.js'));

export function adjudicateResume(M) {
  const issues = [];
  // ① 崩溃注入 → resume：消息序列逐字对齐 + interruptedToolCount
  const t = M.createTranscript({ traceId: 'gate' });
  t.appendMessage({ role: 'user', content: 'do A' });
  t.appendPart({ type: 'tool_call', callId: 'c1', state: 'running' });
  const h = M.hydrateTranscript(t.snapshot());
  if (h.messages.length !== 1 || h.messages[0].content !== 'do A') issues.push('HYDRATE_MESSAGE_MISMATCH');
  if (h.interruptedToolCount !== 1 || h.danglingToolCalls.length !== 0) issues.push('DANGLING_TOOL_CALL_NOT_SYNTHESIZED');

  // ② checkpoint 损坏 fail-closed
  const cp = M.writeCheckpoint({ messagesHash: 'x' });
  let damaged = false;
  try { M.readCheckpoint({ ...cp.payload, digest: 'bad' }); } catch (e) { damaged = e.code === 'CHECKPOINT_DAMAGED'; }
  if (!damaged) issues.push('CHECKPOINT_SILENT_CORRUPTION');

  // ③ 任务图暂停/重派 + 恢复不回退
  const g = M.createTaskGraph({ maxConsecutiveErrors: 2 });
  if (g.stages.length !== 8) issues.push('DAG_STAGE_COUNT_WRONG');
  g.transition('clarify', 'done');
  g.transition('task_analysis', 'failed');
  g.transition('decompose', 'failed');
  if (!g.paused) issues.push('MAX_CONSECUTIVE_ERRORS_NOT_PAUSED');
  const restored = M.createTaskGraph({ persisted: g.persist() });
  if (restored.nodeState('clarify') !== 'done') issues.push('RESUME_NODE_STATE_ROLLED_BACK');
  restored.redispatch('task_analysis');
  if (restored.nodeState('task_analysis') !== 'dispatched') issues.push('REDISPATCH_MISSING');

  // ④ 幂等：重复/陈旧/空命令
  const inbox = M.createCommandInbox({ revision: 3 });
  const a1 = inbox.admit({ commandId: 'x', baseRevision: 3, payload: { v: 1 } });
  const a2 = inbox.admit({ commandId: 'x', baseRevision: 4, payload: { v: 1 } });
  const a3 = inbox.admit({ commandId: 'y', baseRevision: 2, payload: { v: 1 } });
  if (a1.ack !== 'applied' || a2.ack !== 'duplicate' || a3.ack !== 'stale') issues.push('IDEMPOTENCY_ACK_DRIFT');

  // ⑤ 单一 owner。fail-closed：租约模块 API 缺失/抛错也判红，不让门自身 TypeError 逃逸
  // （HK-01 门自身负测抓真：篡改模块缺 pidOf 曾使门抛异常而非产出 issue）。
  try {
    const leases = M.createLeaseTable();
    if (typeof leases.acquire !== 'function' || typeof leases.cancel !== 'function'
      || typeof leases.persist !== 'function' || typeof leases.pidOf !== 'function') {
      issues.push('LEASE_API_INCOMPLETE');
    } else {
      leases.acquire({ taskId: 'T', owner: 'backend:3001', pid: 7 });
      if (leases.cancel('T', { from: 'backend:3005' }).ok !== false) issues.push('NON_OWNER_CANCEL_ALLOWED');
      const restoredLeases = M.createLeaseTable({ persisted: leases.persist() });
      if (typeof restoredLeases.pidOf !== 'function' || restoredLeases.pidOf('T') !== 7) {
        issues.push('LEASE_NOT_PERSISTED');
      }
    }
  } catch (e) {
    issues.push(`LEASE_API_THREW: ${e && e.message ? e.message : String(e)}`);
  }
  return issues;
}

function main() {
  const args = process.argv.slice(2);
  if (!args.includes('--check')) {
    process.stderr.write('用法：node scripts/m-blueprint-m2-resume-gate.mjs --check [--report <path>]\n');
    process.exit(2);
  }
  const issues = adjudicateResume(collectResumeModule());
  const report = { schemaVersion: 1, script: 'scripts/m-blueprint-m2-resume-gate.mjs', mode: 'report', exitCode: issues.length ? 1 : 0, summary: { status: issues.length ? 'FAIL' : 'PASS', issues } };
  const idx = args.indexOf('--report');
  if (idx >= 0 && args[idx + 1]) fs.writeFileSync(path.resolve(ROOT, args[idx + 1]), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`[gate:long-task-resume] 5 类判据 → ${issues.length ? 'FAIL' : 'PASS'}（${issues.length} issues）\n`);
  for (const i of issues) process.stdout.write(`  ✖ ${i}\n`);
  process.exit(issues.length ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
