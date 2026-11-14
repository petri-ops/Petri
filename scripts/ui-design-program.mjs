#!/usr/bin/env node
/**
 * UI-D5 (BLOCK-420) — 界面设计优化程序统一汇总门。
 *
 * 串行调用 D0–D4 的 6 个专项门（全部走 node 直调，不绕 npm），逐个记录退出码
 * 与输出首行；任一门非 0 即整体 FAIL，结论不可由调用方伪造。
 * --flows 列出视觉/几何回归 flow 与证据路径（复用，不另建第二份路线）。
 *
 * 用法：node scripts/ui-design-program.mjs [--check] [--flows] [--json]
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const GATES = Object.freeze([
  { id: 'ui-baseline', script: 'scripts/ui-design-baseline.mjs', phase: 'D0', evidence: 'd0/gate-readout.json' },
  { id: 'ui-entries', script: 'scripts/ui-design-entry-gate.mjs', phase: 'D1', evidence: 'd1/gate-readout.json' },
  { id: 'ui-breakpoints', script: 'scripts/ui-design-breakpoints.mjs', phase: 'D2', evidence: 'd2/gate-readout.json' },
  { id: 'ui-layout', script: 'scripts/ui-design-layout-gate.mjs', phase: 'D2', evidence: 'd2/gate-readout.json' },
  { id: 'ui-visual', script: 'scripts/ui-design-visual.mjs', phase: 'D3', evidence: 'd3/gate-readout.json' },
  { id: 'ui-a11y', script: 'scripts/ui-design-a11y.mjs', phase: 'D4', evidence: 'd4/gate-readout.json' },
]);

/** 视觉/几何回归 flow：复用既有两个离屏 flow，不另立第二份路线。 */
export const FLOWS = Object.freeze([
  { id: 'ui-d2-geometry-live', file: '.agents/skills/petri-dev-infra/dev-verify/flows/ui-d2-geometry-live.cjs', evidence: 'd2/ui-d2-geometry-live-darwin.json', note: '四块几何/长内容三态；D2 实机 9/9 但探针在 body fallback，诚实降级' },
  { id: 'ui-d4-a11y-live', file: '.agents/skills/petri-dev-infra/dev-verify/flows/ui-d4-a11y-live.cjs', evidence: 'd4/ui-d4-a11y-live-darwin.json', note: 'ARIA/焦点/token 运行时读数；D4 实机 8/9 诚实判红（焦点环不可见）' },
]);

export function runGate(gate, runner = defaultRunner) {
  const script = path.join(ROOT, gate.script);
  if (!fs.existsSync(script)) return { ...gate, exit: 127, output: 'gate script missing' };
  const r = runner(script);
  const output = String(r.stdout || '').trim().split('\n').find((l) => l.includes('PASS') || l.includes('FAIL')) || String(r.stderr || '').trim().split('\n')[0] || '(no output)';
  return { ...gate, exit: r.status, output };
}

function defaultRunner(script) {
  return spawnSync(process.execPath, [script, '--check'], { cwd: ROOT, encoding: 'utf8', timeout: 120_000 });
}

/** 纯函数汇总，供负测注入伪造的逐门结果。 */
export function summarize(results) {
  const problems = [];
  if (results.length !== GATES.length) problems.push(`门数量不符：期望 ${GATES.length}，实际 ${results.length}`);
  for (const r of results) {
    if (r.exit !== 0) problems.push(`${r.id}: FAIL (exit ${r.exit}) — ${r.output}`);
  }
  const ids = new Set(results.map((r) => r.id));
  for (const g of GATES) if (!ids.has(g.id)) problems.push(`门缺失：${g.id}`);
  return { allPass: problems.length === 0, problems, passed: results.filter((r) => r.exit === 0).length, total: results.length };
}

export function checkFiles() {
  const results = GATES.map((g) => runGate(g));
  return { results, summary: summarize(results) };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--flows')) {
    console.log('视觉/几何回归 flow（复用，不另立第二份）：');
    for (const f of FLOWS) console.log(`  ${f.id} → ${f.file} → ${f.evidence} :: ${f.note}`);
    process.exit(0);
  }
  const { results, summary } = checkFiles();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ schema: 'petri.ui-design.program-gate.v1', capturedAt: new Date().toISOString(), gates: results, summary }, null, 2));
  } else {
    for (const r of results) console.log(`[${r.phase}] ${r.id}: ${r.exit === 0 ? 'PASS' : `FAIL(${r.exit})`} — ${r.output}`);
    console.log(`[ui-program] ${summary.allPass ? 'PASS' : 'FAIL'} — ${summary.passed}/${summary.total} 门`);
  }
  if (!summary.allPass) {
    for (const p of summary.problems) console.error(`  - ${p}`);
    process.exit(1);
  }
}
