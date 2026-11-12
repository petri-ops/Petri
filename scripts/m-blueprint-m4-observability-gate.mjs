#!/usr/bin/env node
/**
 * gate:long-task-observability — M4（BLOCK-430）专项门：fixture / 基线 / trace / usage / 性能五类判据。
 * 纯函数 adjudicateObservability 可被负测注入篡改（门自身防假绿）。
 * 用法：node scripts/m-blueprint-m4-observability-gate.mjs --check [--report <path>]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
export const collectObservabilityModule = () => require(path.join(ROOT, 'core/petri-server/agent-tools/long-task-observability.js'));

export function adjudicateObservability(M) {
  const issues = [];
  // ① fixture ≥1000 轮 + 零出网 + manifest 计数对账
  const fx = M.generateFixture({ turns: 1000, seed: 11 });
  if (fx.manifest.turnCount < M.FIXTURE_MIN_TURNS) issues.push('FIXTURE_TOO_SMALL');
  if (fx.manifest.provider !== 'mock' || fx.manifest.network !== false) issues.push('FIXTURE_NOT_LOCAL_MOCK');
  if (!M.verifyFixture(fx).ok) issues.push('FIXTURE_MANIFEST_NOT_VERIFIABLE');
  if (M.verifyFixture({ ...fx, manifest: { ...fx.manifest, partCount: 1 } }).ok !== false) issues.push('FIXTURE_TAMPER_NOT_RED');

  // ② 基线不得宣称「稳定完成长任务」
  const baseline = M.adjudicateLongTaskBaseline([{ success: true, completion: 1, resumeConsistent: true }]);
  if (baseline.successRate !== 1 || baseline.claimStableLongTask !== false) issues.push('BASELINE_OVERCLAIM');

  // ③ traceId 全链 + 跨重启可查
  const t = M.createTraceProjection({ traceId: 'g' });
  for (const kind of M.TRACE_KINDS) t.append({ kind, name: 'n' });
  const restored = M.createTraceProjection({ persisted: t.persist() });
  if (restored.count !== M.TRACE_KINDS.length) issues.push('TRACE_PERSISTENCE_BROKEN');
  if (!restored.spans.every((s) => s.traceId === 'g')) issues.push('TRACE_ID_NOT_PROPAGATED');

  // ④ usage 三层 + 失败请求记账
  const u = M.createUsageLedger({ prices: { m: { input: 1, output: 2 } } });
  u.record({ layer: 'model', model: 'm', inputTokens: 10, outputTokens: 10 });
  u.record({ layer: 'turn' });
  u.record({ layer: 'tool', name: 'r' });
  u.recordFailed({ model: 'm', reason: 'timeout' });
  if (u.byLayer('model').length !== 2) issues.push('FAILED_REQUEST_NOT_ACCOUNTED');
  if (!u.events.some((e) => e.type === 'model_request_failed')) issues.push('FAILURE_EVENT_MISSING');

  // ⑤ 植入 400+ 节点必红 + 窗口化有界
  if (!M.adjudicateUserPerceivedPerf({ domNodes: 401 }).issues.some((i) => i.code === 'DOM_NODE_BUDGET_EXCEEDED')) {
    issues.push('DOM_BUDGET_NOT_RED');
  }
  if (M.planWindowedRender({ totalItems: 10000, scrollIndex: 500 }).rendered.length > 30) issues.push('WINDOW_UNBOUNDED');
  return issues;
}

function main() {
  const args = process.argv.slice(2);
  if (!args.includes('--check')) {
    process.stderr.write('用法：node scripts/m-blueprint-m4-observability-gate.mjs --check [--report <path>]\n');
    process.exit(2);
  }
  const issues = adjudicateObservability(collectObservabilityModule());
  const report = { schemaVersion: 1, script: 'scripts/m-blueprint-m4-observability-gate.mjs', mode: 'report', exitCode: issues.length ? 1 : 0, summary: { status: issues.length ? 'FAIL' : 'PASS', issues } };
  const idx = args.indexOf('--report');
  if (idx >= 0 && args[idx + 1]) fs.writeFileSync(path.resolve(ROOT, args[idx + 1]), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`[gate:long-task-observability] 5 类判据 → ${issues.length ? 'FAIL' : 'PASS'}（${issues.length} issues）\n`);
  for (const i of issues) process.stdout.write(`  ✖ ${i}\n`);
  process.exit(issues.length ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
