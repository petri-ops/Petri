#!/usr/bin/env node
/**
 * B-04 / B-33 保守交付：把「暂不接线」的判据固化成机械门 + 逐件分诊表。
 *
 * 为什么不直接接线：
 *  - B-04：tools-executor / ssh-direct-runner 接一次性准入凭据需要跨 tool_jobs 行与
 *    SSH 会话设计凭据载体，属执行语义变更，不得为凑完成数擅自改；MCP 两轴分离是用户裁决。
 *  - B-33：165 个零消费 IPC 通道「接线到哪个 UI 入口」是产品决策，盲接会造出无入口的死 UI。
 * 因此交付 = 逐件判据在册 + 新增/漏判即红，让后续切片有可复跑的起点，而非假装完成。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'acceptance/post-s7-2026-11-10/h10/deferred-triage.json');
const IPC_TRIAGE = path.join(ROOT, 'acceptance/post-s7-2026-11-10/h9/ipc-unused-triage.json');

export function classifyDeferred(rows) {
  const out = { reserved: [], needsProductDecision: [], mainOnly: [] };
  for (const r of rows) {
    if (r.mainOnly) out.mainOnly.push(r.channel);
    else if (r.inPreload) out.needsProductDecision.push(r.channel);
    else out.reserved.push(r.channel);
  }
  return out;
}

export function evaluateDeferred(triage, admissionChannels) {
  const issues = [];
  if (!Array.isArray(triage?.buckets?.needsWiring)) issues.push('B-33 分诊表缺 needsWiring');
  const buckets = triage?.buckets || {};
  if (!Array.isArray(buckets.deletable)) issues.push('B-33 分诊表缺 deletable');
  if (!Array.isArray(buckets.retainWithReason)) issues.push('B-33 分诊表缺 retainWithReason');
  const deferred = admissionChannels.filter((c) => c.state === 'deferred');
  if (deferred.length !== 2) issues.push(`B-04 deferred 入口应为 2，实际 ${deferred.length}`);
  for (const c of deferred) if (!c.reason) issues.push(`B-04 ${c.id} 缺 deferred 理由`);
  return { ok: issues.length === 0, issues };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const triage = JSON.parse(fs.readFileSync(IPC_TRIAGE, 'utf8'));
  const channels = [
    { id: 'workspace_exec', state: 'consumed', reason: '执行边界已闭环' },
    { id: 'tools_executor', state: 'deferred', reason: '需跨 tool_jobs 行设计凭据载体' },
    { id: 'ssh_direct_runner', state: 'deferred', reason: '需跨 SSH 会话设计凭据载体' },
  ];
  const r = evaluateDeferred(triage, channels);
  const cls = classifyDeferred(triage.buckets.needsWiring || []);
  const evidence = {
    schemaVersion: 1, kind: 'b04-b33-deferred-triage', generatedAt: new Date().toISOString(),
    evaluation: r,
    b04: { channels, decision: '保守默认：不擅自改执行准入语义；两轴分离用户裁决维持。' },
    b33: {
      total: triage.total,
      needsWiring: (triage.buckets.needsWiring || []).length,
      retainWithReason: (triage.buckets.retainWithReason || []).length,
      deletable: (triage.buckets.deletable || []).length,
      classification: {
        reserved: cls.reserved.length,
        needsProductDecision: cls.needsProductDecision.length,
        mainOnly: cls.mainOnly.length,
        sampleProductDecision: cls.needsProductDecision.slice(0, 8),
      },
      decision: '逐件分诊在册；接线到哪个 UI 入口属产品决策，不盲接、不删 preload。',
    },
    note: '本门只固化判据，不冒充接线完成。',
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(evidence, null, 2) + '\n');
  console.log(`[deferred-triage] ${r.ok ? 'PASS' : 'FAIL'} — B-04 deferred 2 / B-33 needsWiring ${evidence.b33.needsWiring} (产品决策 ${cls.needsProductDecision.length})`);
  if (!r.ok) for (const i of r.issues) console.log('  -', i);
  process.exitCode = r.ok ? 0 : 1;
}
