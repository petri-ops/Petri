#!/usr/bin/env node
/**
 * gate:long-task-kernel — M1（BLOCK-427）专项门：状态机 / 边界族 / goal verifier 三类判据 + 产品契约守卫。
 *
 * 四类必红植入（HK-01 门自身负测）：
 *   ① 非法转移不抛错 ② 取消不返回 turn_cancelled ③ 成本默认变硬停
 *   ④ 模型自报完成但无产物被判 ok
 * 另外机械断言 MAX_AGENT_ITERS === Infinity（撤销产品契约即红）与主循环/边界常量零改动。
 *
 * 用法：node scripts/m-blueprint-m1-kernel-gate.mjs --check [--report <path>]
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const A = (p) => require(path.join(ROOT, p));

/**
 * 纯函数：可被负测注入篡改的 modules（门自身防假绿）。
 * git diff 检查不在这里（属 CLI 层），保证负测只测判据。
 */
export function adjudicateKernel(modules) {
  const issues = [];
  const { TURN_PHASES, TURN_CANCELLED, createTurnMachine } = modules.turnMachine;
  const { createBoundaryGuard, authoritativeTokenCount } = modules.boundaries;
  const { verifyGoalCompletion } = modules.verifier;
  const { MAX_AGENT_ITERS, MAX_AGENT_TOOL_CALLS } = modules.loopControl;

  // 产品契约守卫：撤销 Infinity 即红。
  if (MAX_AGENT_ITERS !== Number.POSITIVE_INFINITY || MAX_AGENT_TOOL_CALLS !== Number.POSITIVE_INFINITY) {
    issues.push('PRODUCT_CONTRACT_BROKEN: MAX_AGENT_ITERS / MAX_AGENT_TOOL_CALLS 必须保持 Infinity（goal-terminated, not round-terminated）');
  }
  if (Object.keys(TURN_PHASES).length < 9) issues.push('TURN_PHASES_TOO_FEW: 需 ≥9 态');
  if (TURN_CANCELLED !== 'turn_cancelled') issues.push('TURN_CANCELLED_TYPE_DRIFT');

  // ① 非法转移必抛
  const m = createTurnMachine({ traceId: 'gate' });
  let threw = false;
  try { m.transition(TURN_PHASES.Completing); } catch (e) { threw = e.code === 'INVALID_TURN_TRANSITION'; }
  if (!threw) issues.push('ILLEGAL_TRANSITION_NOT_RED');
  if (m.phase !== TURN_PHASES.Idle) issues.push('ILLEGAL_TRANSITION_MUTATED_PHASE');

  // ② 取消一等结果 + append-only seq
  const c = createTurnMachine({ shouldAbort: () => false });
  const cancelled = c.cancel();
  if (cancelled.type !== TURN_CANCELLED) issues.push('CANCEL_NOT_FIRST_CLASS');
  if (!c.snapshot().transitions.every((t, i) => t.seq === i + 1)) issues.push('TRANSITIONS_NOT_REPLAYABLE');

  // ③ 成本默认软提示；硬停须显式配置
  const soft = createBoundaryGuard({ config: { costCapCny: 1 } });
  if (soft.adjudicateCost({ spentCny: 2 }).stop !== false) issues.push('COST_CAP_DEFAULT_CHANGED_TO_HARD');
  const hard = createBoundaryGuard({ config: { costCapCny: 1, costCapPolicy: 'hard' } });
  if (hard.adjudicateCost({ spentCny: 2 }).stop !== true) issues.push('COST_CAP_HARD_NOT_AVAILABLE');

  // ④ 无产物必红
  if (verifyGoalCompletion({ goal: { status: 'active' }, artifacts: [], todos: [], backgroundTasks: [] }).ok !== false) {
    issues.push('FALSE_COMPLETION_NOT_RED');
  }
  // provider usage 权威
  if (authoritativeTokenCount({ usage: { total_tokens: 7 } }, 999) !== 7) issues.push('PROVIDER_USAGE_NOT_AUTHORITATIVE');
  // compact 双熔断
  const g = createBoundaryGuard({ config: { compactFailureLimit: 2 } });
  g.recordCompactResult({ ok: false });
  g.recordCompactResult({ ok: false });
  if (!g.shouldCircuitBreak()) issues.push('COMPACT_CIRCUIT_BREAKER_MISSING');

  return { issues, phases: Object.keys(TURN_PHASES).length };
}

export function collectModules() {
  return {
    turnMachine: A('core/petri-server/agent-tools/turn-machine.js'),
    boundaries: A('core/petri-server/agent-tools/loop-boundaries.js'),
    verifier: A('core/petri-server/agent-tools/goal-verifier.js'),
    loopControl: A('core/petri-server/agent-tools/agent-loop-control.js'),
  };
}

function main() {
  const args = process.argv.slice(2);
  if (!args.includes('--check')) {
    process.stderr.write('用法：node scripts/m-blueprint-m1-kernel-gate.mjs --check [--report <path>]\n');
    process.exit(2);
  }
  const { issues, phases } = adjudicateKernel(collectModules());

  // 主循环与 Infinity 常量文件本包零改动（防「偷偷加步数上限」）。
  const changed = execFileSync('git', ['--no-optional-locks', 'diff', '--name-only', 'HEAD', '--',
    'core/petri-server/loop-orchestrator.js', 'core/petri-server/agent-tools/agent-loop-control.js'],
    { cwd: ROOT, encoding: 'utf8' }).trim();
  if (changed) issues.push(`MAIN_LOOP_OR_CONTRACT_FILE_MODIFIED: ${changed.replace(/\n/g, ', ')}`);

  const report = { schemaVersion: 1, script: 'scripts/m-blueprint-m1-kernel-gate.mjs', mode: 'report', exitCode: issues.length ? 1 : 0, summary: { status: issues.length ? 'FAIL' : 'PASS', phases, issues } };
  const reportIdx = args.indexOf('--report');
  if (reportIdx >= 0 && args[reportIdx + 1]) {
    fs.writeFileSync(path.resolve(ROOT, args[reportIdx + 1]), `${JSON.stringify(report, null, 2)}\n`);
  }
  process.stdout.write(`[gate:long-task-kernel] ${phases} 态 / 4 类必红植入 / Infinity 契约守卫 → ${issues.length ? 'FAIL' : 'PASS'}（${issues.length} issues）\n`);
  for (const i of issues) process.stdout.write(`  ✖ ${i}\n`);
  process.exit(issues.length ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
