#!/usr/bin/env node
/**
 * scripts/evals-gate.mjs — 评测基线棘轮门（BLOCK-181）。
 *
 * 用法：npm run evals:gate -- --suite=smoke [--report=<path>] [--update]
 * - 对比最新 run 报告与 evals/baselines/<suite>.json：
 *   基线通过、本次失败 = 回归（红）；基线失败、本次通过 = 改善；新任务只记录不判红。
 * - --update：以最新 run 提升基线（显式动作，不自动）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareRunVsBaseline } from './lib/evals-harness.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const suiteName = (args.find((a) => a.startsWith('--suite=')) || '--suite=smoke').split('=')[1];
const reportPath = (args.find((a) => a.startsWith('--report=')) || '').split('=')[1]
  || path.join(root, 'acceptance', 'evals', `${suiteName}-latest.json`);
const update = args.includes('--update');
const baselinePath = path.join(root, 'evals', 'baselines', `${suiteName}.json`);

if (!fs.existsSync(reportPath)) {
  console.error(`[evals-gate] 运行报告不存在：${path.relative(root, reportPath)}——先跑 npm run evals:run`);
  process.exit(2);
}
const run = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
if (!fs.existsSync(baselinePath)) {
  if (update) {
    fs.writeFileSync(baselinePath, JSON.stringify({ suite: suiteName, updatedAt: new Date().toISOString(), tasks: run.tasks }, null, 2));
    console.log(`[evals-gate] 基线尚不存在，已按当前 run 建立：${path.relative(root, baselinePath)}`);
    process.exit(0);
  }
  console.error(`[evals-gate] 基线不存在：${path.relative(root, baselinePath)}——首次建立请加 --update`);
  process.exit(2);
}
const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
const verdict = compareRunVsBaseline(run, baseline);

console.log(`[evals-gate] suite=${suiteName} 回归 ${verdict.regressions.length} · 改善 ${verdict.improvements.length} · 新任务 ${verdict.newTasks.length} · skip ${verdict.skipped.length}`);
for (const key of verdict.regressions) console.log(`  ✖ 回归：${key}`);
for (const key of verdict.improvements) console.log(`  ✔ 改善：${key}`);
for (const id of verdict.newTasks) console.log(`  + 新任务：${id}（不判红，--update 入基线）`);
for (const id of verdict.skipped) console.log(`  - skip：${id}`);

if (update) {
  fs.writeFileSync(baselinePath, JSON.stringify({ suite: suiteName, updatedAt: new Date().toISOString(), tasks: run.tasks }, null, 2));
  console.log(`[evals-gate] 基线已按当前 run 提升：${path.relative(root, baselinePath)}`);
}
process.exitCode = verdict.ok ? 0 : 1;
