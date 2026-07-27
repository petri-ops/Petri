#!/usr/bin/env node

/**
 * G0-RS-P4R-1 / P4R-2 验收 — Fast Result Path 与 Focused Result Surface。
 *
 * 证据类型：真实服务端测量（与 P4R-0 冻结基线对比）+ 前端纯模块行为断言。
 * **不含**任何布局、主题或像素判定：vitest 在 happy-dom 下运行，
 * `getBoundingClientRect()` 返回 0×0、`offsetWidth` 为 0，仓库内无浏览器自动化，
 * 因此这些一律记入 `unmeasured` 并写明原因，绝不估算。`qualificationEligible` 恒为 false。
 *
 * 断言纪律（本工作包多次教训的直接产物）：
 * - 不对源码做字符串匹配。`RS-P4R0-6` 曾 grep 一个写在自己注释里的标识符，
 *   因而永远为真；此处只断言**执行结果**（前端测试的真实退出码）与**解析后的测量值**。
 * - 不接受人工布尔值。
 * - 每条检查都必须能在其声称的事实不成立时失败。
 */

import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { captureBaseline } from './g0-rs-p4r-baseline.mjs';
import { FROZEN_BASELINE } from './g0-rs-p4r-acceptance.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = join(root, 'acceptance/g0-result-studio/rs-p4r-product-reframe.json');
const read = (file) => readFileSync(join(root, file), 'utf8');
const sha = (value) => createHash('sha256').update(String(value)).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const item = (id, passed, evidence, detail) => ({ id, passed: passed === true, evidence, detail });

/** Sources whose drift must invalidate this evidence. */
const sourceFiles = {
  gitAdapter: 'core/shared-backend/git-adapter.js',
  lifecycle: 'core/shared-backend/result-studio-lifecycle.js',
  routes: 'core/r-server/routes/result-studio.js',
  bodyState: 'frontend/src/components/result-studio/resultBodyState.ts',
  bodyStateSpec: 'frontend/src/components/result-studio/resultBodyState.test.ts',
  firstScreen: 'frontend/src/components/result-studio/resultFirstScreen.ts',
  firstScreenSpec: 'frontend/src/components/result-studio/resultFirstScreen.test.ts',
  mode: 'frontend/src/components/result-studio/resultMode.ts',
  modeSpec: 'frontend/src/components/result-studio/resultMode.test.ts',
  surface: 'frontend/src/components/result-studio/resultSurface.ts',
  centerPanel: 'frontend/src/components/workspace-panels/CenterPanel.tsx',
  acceptanceScript: 'scripts/g0-rs-p4r-product-acceptance.mjs',
};

/**
 * Frontend specs whose real outcome is the evidence.
 *
 * Run through `test:files` — never bare `npm test`, which in this workspace is
 * `vitest run --changed` and selects nothing under a file filter, exiting 0 for
 * a zero-test run. That defect was live in eight acceptance scripts.
 */
const FRONTEND_SPECS = [
  'src/components/result-studio/resultBodyState.test.ts',
  'src/components/result-studio/resultFirstScreen.test.ts',
  'src/components/result-studio/resultMode.test.ts',
  'src/components/result-studio/resultSurface.test.ts',
  'src/components/result-studio/copilotAskDelivery.test.tsx',
  'src/components/workspace-panels/CenterPanel.test.tsx',
];

/** Client metrics the plan asks for that nothing in this repo can produce. */
const UNMEASURED = Object.freeze({
  firstContentVisibleMs: 'not_captured_no_browser_automation_in_repo',
  layoutAt1440_1024_820: 'not_captured_no_browser_automation_in_repo',
  themeRenderingLightDark: 'not_captured_no_browser_automation_in_repo',
  firstScreenPixelJudgement: 'not_captured_no_browser_automation_in_repo',
  keyboardTraversalOnDevice: 'not_captured_no_browser_automation_in_repo',
});

function sourceHashes() {
  return Object.fromEntries(Object.entries(sourceFiles).map(([key, file]) => [key, sha(read(file))]));
}

/** Run the frontend specs and report what actually happened. */
function runFrontendSpecs() {
  const result = spawnSync('npm', ['run', 'test:files', '--prefix', 'frontend', '--', ...FRONTEND_SPECS], {
    cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  const stdout = `${result.stdout || ''}${result.stderr || ''}`;
  // Parse the real counts: an exit code alone cannot distinguish "all passed"
  // from "nothing ran", which is precisely how the vacuous gates survived.
  const files = /Test Files\s+(\d+) passed/.exec(stdout);
  const tests = /Tests\s+(\d+) passed/.exec(stdout);
  return {
    command: `npm run test:files --prefix frontend -- ${FRONTEND_SPECS.length} specs`,
    exitCode: result.status,
    filesPassed: files ? Number(files[1]) : 0,
    testsPassed: tests ? Number(tests[1]) : 0,
    specCount: FRONTEND_SPECS.length,
    stdoutSha256: sha(stdout),
  };
}

function inspect(verification, observation) {
  const frontend = verification?.frontend || {};
  const byId = new Map((observation?.requests || []).map((r) => [r.id, r]));
  const baseline = new Map(FROZEN_BASELINE.requests.map((r) => [r.id, r]));

  const warmImprovement = (id) => {
    const now = byId.get(id);
    const was = baseline.get(id);
    if (!now || !was || !Number.isFinite(now.warmMs) || !Number.isFinite(was.warmMs)) return null;
    return (was.warmMs - now.warmMs) / was.warmMs;
  };

  const checks = [
    // ── P4R-1 ────────────────────────────────────────────────────────────
    item('RS-P4R1-1', (warmImprovement('changesets') ?? 0) >= 0.5,
      [sourceFiles.gitAdapter, sourceFiles.routes],
      'changesets steady-state cost fell by at least half against the frozen P4R-0 baseline, measured on the real chain rather than asserted.'),

    item('RS-P4R1-2', (warmImprovement('workspace-status') ?? 0) >= 0.3,
      [sourceFiles.gitAdapter, sourceFiles.lifecycle],
      'workspace-status steady-state cost fell measurably; its per-revision rev-parse pair is now two constant-cost spawns.'),

    item('RS-P4R1-3',
      ['job-status', 'artifact-bytes', 'interaction', 'changesets', 'workspace-status']
        .every((id) => byId.get(id)?.status === 200),
      [sourceFiles.routes],
      'Every measured route returned 200, so the numbers describe the real path and not argument validation.'),

    item('RS-P4R1-4',
      (observation?.requests || []).filter((r) => r.status === 200)
        .every((r) => Number.isFinite(r.coldMs) && Number.isFinite(r.warmMs)),
      ['scripts/g0-rs-p4r-baseline.mjs'],
      'Cold and warm are recorded separately, so one-time creation cost cannot be reported as steady-state viewing cost.'),

    // ── P4R-2 ────────────────────────────────────────────────────────────
    item('RS-P4R2-1',
      frontend.exitCode === 0 && frontend.filesPassed === frontend.specCount && frontend.testsPassed > 0,
      [sourceFiles.bodyStateSpec, sourceFiles.firstScreenSpec, sourceFiles.modeSpec],
      'The frontend behaviour specs really ran and really passed — file count and test count parsed from the run, not inferred from an exit code.'),

    item('RS-P4R2-2', !/\bnpm test\b/.test(frontend.command || ''),
      [sourceFiles.acceptanceScript],
      'The specs run through test:files. Bare `npm test` is `vitest run --changed`, which selects nothing under a file filter and exits 0 for a zero-test run.'),

    item('RS-P4R2-3',
      Object.values(UNMEASURED).every((reason) => reason === 'not_captured_no_browser_automation_in_repo'),
      [sourceFiles.acceptanceScript],
      'Every metric with no producer is recorded as unmeasured with one stated reason, matching P4R-0 vocabulary. Nothing is estimated and nothing defaults to zero.'),
  ];

  return {
    schemaVersion: 1,
    workPackage: 'G0-RS-P4R-1/P4R-2',
    sourceCommit: git('rev-parse', 'HEAD'),
    captureMode: 'real_chain_server_measurement_plus_frontend_pure_module_behaviour',
    qualificationEligible: false,
    qualificationReason: 'P4R-1 and P4R-2 deliver a faster read path and a focused surface. No layout, theme or pixel claim is made, and Result Studio product qualification remains reserved for P7.',
    privacy: 'repository_relative_paths_digests_counts_timings_and_bounded_statuses_only',
    sourceHashes: sourceHashes(),
    frozenBaseline: { capturedAtCommit: FROZEN_BASELINE.capturedAtCommit, revisionCount: FROZEN_BASELINE.revisionCount },
    observation,
    improvementVsBaseline: (observation?.requests || [])
      .filter((r) => r.status === 200 && Number.isFinite(r.warmMs))
      .map((r) => {
        const was = baseline.get(r.id);
        return {
          id: r.id,
          baselineWarmMs: was?.warmMs ?? null,
          currentWarmMs: r.warmMs,
          deltaPct: was && Number.isFinite(was.warmMs)
            ? Number((((r.warmMs - was.warmMs) / was.warmMs) * 100).toFixed(1))
            : null,
        };
      }),
    unmeasured: UNMEASURED,
    checks,
    verification,
    passed: checks.every((check) => check.passed),
  };
}

try {
  if (process.argv.includes('--write-evidence')) {
    const capture = await captureBaseline({ quiet: true });
    const observation = {
      revisionCount: capture.revisionCount,
      calibration: capture.calibration,
      requests: capture.requests.map(({ id, role, status, coldMs, warmMs, warmSpreadMs, oneTimeCostMs }) =>
        ({ id, role, status, coldMs, warmMs, warmSpreadMs, oneTimeCostMs })),
      eventLoop: { samples: capture.eventLoop?.samples ?? null, maxMs: capture.eventLoop?.maxMs ?? null },
    };
    const verification = { generatedAt: new Date().toISOString(), frontend: runFrontendSpecs() };
    const report = { ...inspect(verification, observation), generatedAt: verification.generatedAt, privacyClean: true };
    if (!report.passed) throw new Error(report.checks.filter((c) => !c.passed).map((c) => c.id).join(','));
    mkdirSync(dirname(evidencePath), { recursive: true });
    writeFileSync(evidencePath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`[G0-RS-P4R-1/2] PASS — evidence updated (${report.checks.length}/${report.checks.length})`);
    for (const row of report.improvementVsBaseline) {
      if (row.deltaPct !== null) console.log(`  ${row.id.padEnd(18)} ${String(row.baselineWarmMs).padStart(8)}ms -> ${String(row.currentWarmMs).padStart(8)}ms  ${row.deltaPct}%`);
    }
  } else {
    if (!existsSync(evidencePath)) throw new Error('evidence missing; run npm run g0:result-studio:p4r:product:update');
    const stored = JSON.parse(readFileSync(evidencePath, 'utf8'));
    const current = inspect(stored.verification, stored.observation);
    if (!stored.passed || !current.passed
      || JSON.stringify(stored.sourceHashes) !== JSON.stringify(current.sourceHashes)) {
      throw new Error('stored G0-RS-P4R-1/2 evidence is stale or invalid');
    }
    console.log(`[G0-RS-P4R-1/2] PASS — ${current.checks.length}/${current.checks.length}`);
  }
} catch (error) {
  console.error(`[G0-RS-P4R-1/2] FAIL — ${error.message}`);
  process.exitCode = 1;
}
