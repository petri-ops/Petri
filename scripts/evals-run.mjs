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
  spawnIsolatedBackend, startMockProvider, runGoldenTask, defaultTmpDir, buildContextSnapshot,
  sanitizeEvalTasksForStorage,
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

const backend = await spawnIsolatedBackend({ root, tmpDir, mode: provider });
// BLOCK-192：real 凭据 env 缺省已由 harness 回落本机凭据库；仍拿不到才诚实 skip（附原因，不伪造真模型结果）。
const realBlocked = provider === 'real' && !backend.provider.hasKey;
if (realBlocked) console.log(`[evals] provider=real 凭据不可得（${backend.provider.skipReason || '未知原因'}）——全部任务诚实 skip`);
else if (provider === 'real' && backend.provider.source === 'local-store') console.log(`[evals] provider=real 凭据来自本机凭据库（model=${backend.provider.model}）`);
console.log(`[evals] suite=${suiteName} provider=${provider} tasks=${tasks.length} backend=${backend.ok ? 'up' : 'DOWN'} @${backend.port}`);

const report = {
  suite: suiteName,
  provider,
  measures: provider === 'mock' ? 'harness' : 'model',
  at: new Date().toISOString(),
  tasks: [],
};
let passCount = 0;
let snapshotDrift = false;

if (backend.ok) {
  const api = backend.api;
  for (const task of tasks) {
    if (realBlocked) {
      const reason = `real 凭据不可得：${backend.provider.skipReason || '未知'}`;
      report.tasks.push({ id: task.id, skipped: true, passed: false, reason, criteriaResults: [] });
      console.log(`SKIP ${task.id} — ${reason}`);
      continue;
    }
    if (mock && Array.isArray(task.mockScript)) mock.push(...task.mockScript);
    const result = await runGoldenTask({ api, tmpDir, task, outbound: mock ? mock.captured : null });
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

// ── BLOCK-188 context_snapshot 棘轮（按套件）─────────────────────
// 全局组装契约指纹（system prompt + 工具 schema + role 骨架；动态值归一化）。system prompt
// 随 accessMode/上下文变，故基线**逐套件**（evals/snapshots/<suite>.json），golden=满权限规范组装。
// prompt/工具 schema/上下文组装任一变更 → 漂移红；建立/重打基线仅走显式 --update-snapshot（防退化）。
// 无基线且非 --update → 静默跳过（不为新套件自动 bootstrap 基线）。
if (backend.ok && mock) {
  const agentReq = mock.captured.find((c) => Array.isArray(c.tools) && c.tools.length > 0);
  if (agentReq) {
    const snap = buildContextSnapshot(agentReq, { tmpRoot: tmpDir });
    const baselinePath = path.join(root, 'evals', 'snapshots', `${suiteName}.json`);
    const updating = args.includes('--update-snapshot');
    if (updating) {
      fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
      fs.writeFileSync(baselinePath, `${JSON.stringify({ ...snap, updatedAt: new Date().toISOString() }, null, 2)}\n`);
      console.log(`[context-snapshot] 重打基线 ${path.relative(root, baselinePath)} fp=${snap.fingerprint.slice(0, 16)}`);
    } else if (fs.existsSync(baselinePath)) {
      const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
      if (baseline.fingerprint !== snap.fingerprint) {
        snapshotDrift = true;
        const why = [];
        if (baseline.system !== snap.system) why.push('system prompt 文案变更');
        const bTools = (baseline.tools || []).map((t) => `${t.name}#${t.schema}`).join('|');
        const sTools = snap.tools.map((t) => `${t.name}#${t.schema}`).join('|');
        if (bTools !== sTools) why.push('工具 schema 变更');
        if ((baseline.skeleton || []).join(',') !== snap.skeleton.join(',')) why.push('上下文 role 骨架变更');
        console.log(`[context-snapshot] ✖ 组装契约漂移 fp=${snap.fingerprint.slice(0, 16)} vs 基线 ${String(baseline.fingerprint).slice(0, 16)}｜${why.join('；') || '指纹不一致'}`);
      } else {
        console.log(`[context-snapshot] ✔ 组装契约一致 fp=${snap.fingerprint.slice(0, 16)}`);
      }
    }
  }
}

report.pass = passCount;
report.total = tasks.length;
report.skipped = report.tasks.filter((t) => t.skipped).length;
const failures = report.tasks.filter((t) => !t.skipped && !t.passed).length;
// 入库前脱敏：报告与基线不留模型原文（判据结论足够驱动棘轮，见 sanitizeEvalTasksForStorage 注释）
report.tasks = sanitizeEvalTasksForStorage(report.tasks);
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
process.exitCode = failures === 0 && !snapshotDrift ? 0 : 1;
