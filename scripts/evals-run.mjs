#!/usr/bin/env node
/**
 * scripts/evals-run.mjs — 黄金任务套件运行器（BLOCK-181）。
 *
 * 用法：npm run evals:run -- --suite=smoke --provider=mock [--report=<path>]
 * - provider=mock：脚本化回合（任务定义 mockScript）——测 harness 与 loop 机制回归
 * - provider=real：真实 provider——测模型质量（无凭据任务诚实 skip）
 * 报告落 acceptance/evals/<suite>-latest.json（+时间戳副本）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  spawnIsolatedBackend, startMockProvider, runGoldenTask, defaultTmpDir,
} from './lib/evals-harness.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const suiteName = (args.find((a) => a.startsWith('--suite=')) || '--suite=smoke').split('=')[1];
const provider = (args.find((a) => a.startsWith('--provider=')) || '--provider=mock').split('=')[1];
const explicitReport = (args.find((a) => a.startsWith('--report=')) || '').split('=')[1];

const suiteDir = path.join(root, 'evals', 'suites', suiteName);
if (!fs.existsSync(suiteDir)) {
  console.error(`[evals] 套件不存在：evals/suites/${suiteName}`);
  process.exit(2);
}
const tasks = fs.readdirSync(suiteDir).filter((f) => f.endsWith('.json')).sort()
  .map((f) => JSON.parse(fs.readFileSync(path.join(suiteDir, f), 'utf8')));

const tmpDir = defaultTmpDir('petri-evals-');
const mock = provider === 'mock' ? startMockProvider() : null;
const mockPort = mock ? await mock.ready : null;
if (mock) process.env.PETRI_EVALS_BASE_URL = `http://127.0.0.1:${mockPort}/v1`;
if (provider === 'real' && !process.env.PETRI_EVALS_PROVIDER_KEY) {
  console.log('[evals] provider=real 且未配置 PETRI_EVALS_PROVIDER_KEY——全部任务诚实 skip');
}

const backend = await spawnIsolatedBackend({ root, tmpDir });
console.log(`[evals] suite=${suiteName} provider=${provider} tasks=${tasks.length} backend=${backend.ok ? 'up' : 'DOWN'} @${backend.port}`);

const report = {
  suite: suiteName,
  provider,
  measures: provider === 'mock' ? 'harness' : 'model',
  at: new Date().toISOString(),
  tasks: [],
};
let passCount = 0;

if (backend.ok) {
  const api = backend.api;
  for (const task of tasks) {
    if (provider === 'real' && !process.env.PETRI_EVALS_PROVIDER_KEY) {
      report.tasks.push({ id: task.id, skipped: true, passed: false, reason: 'real provider 未配置凭据', criteriaResults: [] });
      console.log(`SKIP ${task.id} — real provider 未配置凭据`);
      continue;
    }
    if (mock && Array.isArray(task.mockScript)) mock.push(...task.mockScript);
    const result = await runGoldenTask({ api, tmpDir, task });
    result.criteriaResults = result.criteriaResults || [];
    if (!result.skipped) {
      for (const c of result.criteriaResults) {
        console.log(`  ${c.passed ? '✔' : '✖'} ${task.id} · ${c.kind}${c.detail ? ` — ${c.detail.slice(0, 90)}` : ''}`);
      }
    }
    report.tasks.push(result);
    if (result.passed) passCount += 1;
    console.log(`${result.passed ? 'PASS' : 'FAIL'} ${task.id}（${result.durationMs}ms）`);
  }
} else {
  for (const task of tasks) report.tasks.push({ id: task.id, passed: false, skipped: false, criteriaResults: [], error: 'backend DOWN' });
}

report.pass = passCount;
report.total = tasks.length;
report.skipped = report.tasks.filter((t) => t.skipped).length;
const failures = report.tasks.filter((t) => !t.skipped && !t.passed).length;
await backend.cleanup();
if (mock) await mock.close();
try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* Windows 句柄延迟 */ }

const evidenceDir = path.join(root, 'acceptance', 'evals');
fs.mkdirSync(evidenceDir, { recursive: true });
const reportPath = explicitReport || path.join(evidenceDir, `${suiteName}-latest.json`);
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
const stamped = path.join(evidenceDir, `${suiteName}-${report.at.replace(/[:.]/g, '-')}.json`);
fs.writeFileSync(stamped, JSON.stringify(report, null, 2));
console.log(`\n=== evals run: ${passCount}/${tasks.length} PASS（skipped ${report.skipped}；报告 ${path.relative(root, reportPath)}；measures=${report.measures}）===`);
process.exitCode = failures === 0 ? 0 : 1;
