#!/usr/bin/env node
/**
 * BLOCK-449 交付包自核：s0-s5/CLOSEOUT/DELIVERABLES/证据逐项存在性 + 引用路径可达。
 * 退出码 0 = 0 missing；>0 = 缺失数。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PKG = path.join(ROOT, 'acceptance', 'block-449');
const required = [
  's0-fact-baseline.json',
  's1-requirement-matrix.json',
  's2-plan.json',
  's3/task-T1.json',
  's3/task-T2.json',
  's3/task-T3.json',
  's3/task-T4.json',
  's4-verification-report.json',
  's5-decision-log.json',
  'CLOSEOUT.md',
  'DELIVERABLES.md',
  'evidence/t1-test-changed.log',
  'evidence/t1-red-clearing.json',
  'evidence/t2-flow-run1.log',
  'evidence/t2-flow-run6.log',
  'evidence/t2-live-resume.json',
  'evidence/t3-closeout-full-run1.log',
  'evidence/t3-closeout-full-run2.log',
  'evidence/t3-closeout-full-run3.log',
  'evidence/t3-closeout-readings.json',
  'evidence/dev-verify/m7-longtask-resume-live-darwin.json',
  'evidence/dev-verify/m7-longtask-resume-live.png',
];
const repoRequired = [
  '.agents/skills/petri-dev-infra/dev-verify/flows/m7-longtask-resume-live.cjs',
  'test/m7-longtask-resume-live-flow.test.mjs',
  'test/agent-task-resume-route-disambiguation.test.mjs',
  'core/petri-server/routes/ai-agent/team.js',
  'scripts/lib/evals-harness.mjs',
  'docs/block-449-m7-tails-clean-closeout-plan.md',
  'docs/m-blueprint-2026-11-11-program.md',
];
let missing = 0;
for (const rel of required) {
  const p = path.join(PKG, rel);
  if (!fs.existsSync(p)) { console.error(`MISSING ${rel}`); missing += 1; }
}
for (const rel of repoRequired) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) { console.error(`MISSING ${rel}`); missing += 1; }
}
// 计数当次复算（R1 条数与矩阵声明一致）
const matrix = JSON.parse(fs.readFileSync(path.join(PKG, 's1-requirement-matrix.json'), 'utf8'));
if (matrix.requirements.length !== matrix.requirementCount) { console.error('MATRIX_COUNT_DRIFT'); missing += 1; }
// 三连日志全部含 PASS 判定
for (const run of [1, 2, 3]) {
  const log = fs.readFileSync(path.join(PKG, `evidence/t3-closeout-full-run${run}.log`), 'utf8');
  if (!log.includes('CLOSEOUT: PASS')) { console.error(`RUN${run}_NOT_PASS`); missing += 1; }
}
console.log(missing === 0 ? 'DELIVERABLES_OK 0 missing' : `DELIVERABLES_MISSING ${missing}`);
process.exit(missing === 0 ? 0 : 1);
