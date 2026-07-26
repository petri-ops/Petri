#!/usr/bin/env node

/**
 * G0-RS-P4R-0 验收 — Truth Baseline 与预算冻结。
 *
 * 证据类型：一次性隔离环境中的真实 `run_tool → tool_job → artifact truth` 语料 +
 * 真实服务器请求瀑布 + 10ms 分辨率事件循环直方图。**不包含**客户端指标：仓库内
 * 没有浏览器自动化，因此首屏内容可见、Artifact 切换、版本切换与代码打开一律记为
 * 未捕获，不做估算。`qualificationEligible` 恒为 false。
 *
 * `passed` 的语义是「P4R-0 交付了有效基线并冻结了预算」，**不是**「性能达标」。
 * 当前实现实测违反 250ms 事件循环预算，这一事实由 budgetStatus 显式记录，
 * 并且是 P4R-1 必须修复的对象。
 *
 * 断言原则：只断言可从真实源码与真实测量读出的事实，不接受人工布尔值。
 */

import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { captureBaseline } from './g0-rs-p4r-baseline.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = join(root, 'acceptance/g0-result-studio/rs-p4r-performance.json');
const read = (file) => readFileSync(join(root, file), 'utf8');
const sha = (value) => createHash('sha256').update(String(value)).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const item = (id, passed, evidence, detail) => ({ id, passed: passed === true, evidence, detail });

const sourceFiles = {
  probe: 'core/r-server/helpers/perf-probe.js',
  probeRoutes: 'core/r-server/routes/perf-probe.js',
  bootstrap: 'core/r-server/bootstrap.js',
  capture: 'scripts/g0-rs-p4r-capture.mjs',
  corpus: 'scripts/g0-rs-p4r-corpus.mjs',
  baseline: 'scripts/g0-rs-p4r-baseline.mjs',
  probeTest: 'test/perf-probe.test.mjs',
  captureTest: 'test/p4r-capture.test.mjs',
  corpusTest: 'test/p4r-corpus.test.mjs',
  baselineTest: 'test/p4r-baseline.test.mjs',
  acceptanceScript: 'scripts/g0-rs-p4r-acceptance.mjs',
};

/**
 * Frozen budgets.
 *
 * Only the plan's own product contracts are frozen here. The plan also asks for
 * per-artifact-size first-content and version-switch thresholds "written from
 * real sampling", but sampling the CURRENT implementation would enshrine the
 * defect P4R-1 exists to remove — the measured secondary path is already an
 * order of magnitude over the block budget. Those thresholds are therefore
 * deferred to P4R-1, when a fast path exists to sample. Deferring is recorded
 * explicitly; it is not a silent omission, and it is not a loosening.
 */
const BUDGETS = Object.freeze({
  eventLoopMaxMs: {
    value: 250,
    source: 'G0-RS-P4R-0 plan: no synchronous Result Studio block may exceed 250ms',
    signal: 'perf-probe eventLoop.maxMs (monitorEventLoopDelay, 10ms resolution)',
    // server.js's tick sampler runs at 1Hz and only warns above 2000ms, so it
    // cannot resolve or attribute a 250ms block. The histogram is authoritative.
    rejectedSignal: 'server.js startEventLoopMonitor tick sampler (1Hz, 2000ms threshold)',
    machineVerifiable: true,
  },
  visibleFeedbackMs: {
    value: 100,
    source: 'G0-RS-P4R-0 plan: visible feedback within 100ms of a result click',
    signal: 'client-side; no producer exists in this repository',
    machineVerifiable: false,
    status: 'frozen_target_not_yet_measurable',
  },
});

const DEFERRED_BUDGETS = Object.freeze({
  firstContentBySizeMs: 'deferred_to_G0-RS-P4R-1: sampling the pre-fast-path implementation would freeze the defect as the standard',
  versionSwitchMs: 'deferred_to_G0-RS-P4R-1: no read-only version switch surface exists yet',
  codeOpenMs: 'deferred_to_G0-RS-P4R-5: no revision source projection route exists (23 routes checked)',
});

/** Routes whose real cost the baseline must have measured. */
const MUST_BE_MEASURED = ['job-status', 'artifact-bytes', 'interaction', 'changesets', 'workspace-status'];

function sourceHashes() {
  return Object.fromEntries(Object.entries(sourceFiles).map(([key, file]) => [key, sha(read(file))]));
}

function runCommands() {
  const commands = [
    ['probe-and-harness', 'node', ['--test',
      'test/perf-probe.test.mjs',
      'test/p4r-capture.test.mjs',
      'test/p4r-corpus.test.mjs',
      'test/p4r-baseline.test.mjs',
    ]],
    ['impact-map', 'node', ['--test', 'test/test-affected.test.mjs']],
    ['syntax', 'node', ['--check', 'scripts/g0-rs-p4r-acceptance.mjs']],
  ];
  return commands.map(([label, bin, args]) => {
    const result = spawnSync(bin, args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    return {
      label,
      command: [bin, ...args].join(' '),
      exitCode: result.status,
      passed: result.status === 0,
      stdoutSha256: sha(result.stdout || ''),
      stderrSha256: sha(result.stderr || ''),
    };
  });
}

/** Reduce a raw capture into the bounded, redacted observation stored as evidence. */
function toObservation(capture) {
  const byId = new Map(capture.requests.map((request) => [request.id, request]));
  const renderBlocking = capture.requests.filter((request) => request.role === 'render-blocking');
  return {
    captureMode: 'real_run_tool_chain_in_disposable_root_with_env_gated_probe',
    corpus: capture.corpus.map(({ toolId, durationMs, artifactCount }) => ({ toolId, durationMs, artifactCount })),
    requests: capture.requests.map(({ id, role, status, totalMs, bytes }) => ({ id, role, status, totalMs, bytes })),
    renderBlockingTotalMs: Number(renderBlocking.reduce((sum, request) => sum + request.totalMs, 0).toFixed(3)),
    slowestRequest: capture.requests.reduce((worst, request) => (request.totalMs > (worst?.totalMs ?? -1) ? request : worst), null)?.id ?? null,
    eventLoop: capture.eventLoop,
    unmeasured: [
      ...Object.entries(capture.clientMetrics).map(([key, metric]) => ({ metric: key, reason: metric.status })),
      // Recorded so the gap cannot be mistaken for a measured zero.
      { metric: 'context-envelope', reason: `route returned ${byId.get('context-envelope')?.status ?? 'unknown'}; excluded from the baseline` },
    ],
  };
}

function inspect(verification, observation) {
  const capture = read(sourceFiles.capture);
  const corpus = read(sourceFiles.corpus);
  const baseline = read(sourceFiles.baseline);
  const probe = read(sourceFiles.probe);
  const commands = verification?.commands || [];

  const byId = new Map((observation?.requests || []).map((request) => [request.id, request]));
  const measuredAll = MUST_BE_MEASURED.every((id) => byId.get(id)?.status === 200);
  const eventLoop = observation?.eventLoop || {};
  const budgetMet = Number.isFinite(eventLoop.maxMs) && eventLoop.maxMs <= BUDGETS.eventLoopMaxMs.value;

  const checks = [
    item('RS-P4R0-1',
      Array.isArray(observation?.corpus) && observation.corpus.length >= 3
      && observation.corpus.every((step) => step.artifactCount > 0),
      [sourceFiles.corpus],
      'Baseline corpus was produced by real run_tool -> tool_job -> artifact truth runs, not a database seed.'),

    item('RS-P4R0-2', measuredAll,
      [sourceFiles.baseline, sourceFiles.baselineTest],
      'Every route the baseline must measure returned 200, so the timings are the real path and not argument validation.'),

    item('RS-P4R0-3',
      Number.isFinite(eventLoop.maxMs) && Number(eventLoop.samples) > 0,
      [sourceFiles.probe],
      'Event-loop delay came from a real histogram sample, not the empty-histogram sentinel.'),

    item('RS-P4R0-4',
      /monitorEventLoopDelay/.test(probe) && BUDGETS.eventLoopMaxMs.signal.includes('monitorEventLoopDelay'),
      [sourceFiles.probe],
      'The authoritative >250ms signal is declared as the 10ms-resolution histogram; the 1Hz tick sampler is explicitly rejected as unable to resolve it.'),

    item('RS-P4R0-5',
      Array.isArray(observation?.unmeasured) && observation.unmeasured.length > 0
      && observation.unmeasured.every((entry) => typeof entry.reason === 'string' && entry.reason.length > 0),
      [sourceFiles.baseline],
      'Metrics with no producer are recorded as unmeasured with a stated reason, never estimated or defaulted to zero.'),

    item('RS-P4R0-6',
      /ISOLATED_PATH_ENV/.test(capture) && /assertIsolated/.test(capture)
      && /BIOF3_LOCAL_DATA_DIR/.test(capture) && /BIOF3_PLUGINS_DIR/.test(capture)
      && /BIOF3_HARNESS_LOCAL_ROOT/.test(capture),
      [sourceFiles.capture, sourceFiles.captureTest],
      'Every writable path is redirected and guarded from one declared list, so a capture cannot reach the developer database or the real user data root.'),

    item('RS-P4R0-7',
      /envEnabled/.test(probe) && /BIOF3_PERF_PROBE/.test(probe),
      [sourceFiles.probe, sourceFiles.probeRoutes],
      'The probe is env-gated: with the flag unset every export is a no-op and the /api/__perf surface is not mounted.'),

    item('RS-P4R0-8',
      /createProject/.test(corpus) && /setProjectUserId/.test(corpus),
      [sourceFiles.corpus],
      'The corpus creates and owns a real project, without which every Result Studio route rejects and the baseline would time validation.'),

    item('RS-P4R0-9', commands.length >= 3 && commands.every((command) => command.passed),
      [evidencePath.replace(`${root}/`, '')],
      'All declared P4R-0 command gates passed.'),

    // Checks the recorded commands, not this file's own source: an earlier
    // version grepped the script for the pattern and matched the check's own
    // code, which is a self-referential assertion rather than a real one.
    item('RS-P4R0-10',
      commands.length > 0
      && commands.every((command) => !/\bnpm test\b/.test(command.command)),
      [evidencePath.replace(`${root}/`, '')],
      'No recorded gate invokes bare `npm test`, which under a file filter resolves to `vitest run --changed`, selects nothing and reports success for a zero-test run.'),
  ];

  return {
    schemaVersion: 1,
    workPackage: 'G0-RS-P4R-0',
    sourceCommit: git('rev-parse', 'HEAD'),
    captureMode: 'real_chain_corpus_plus_server_request_waterfall_and_event_loop_histogram_in_disposable_root',
    qualificationEligible: false,
    qualificationReason: 'P4R-0 only captures a baseline and freezes budgets. It does not implement the fast path, and it does not measure any client-side metric. Result Studio product qualification remains reserved for P7.',
    privacy: 'repository_relative_paths_digests_counts_timings_and_bounded_statuses_only_no_project_job_conversation_selection_url_credential_prompt_or_result_data',
    sourceHashes: sourceHashes(),
    budgets: BUDGETS,
    deferredBudgets: DEFERRED_BUDGETS,
    baselineObservation: observation,
    budgetStatus: {
      eventLoopMaxMs: budgetMet ? 'met' : 'violated_by_current_implementation',
      observedMaxMs: eventLoop.maxMs ?? null,
      attributedTo: observation?.slowestRequest ?? null,
      note: budgetMet
        ? 'Current implementation is within the frozen block budget.'
        : 'The frozen 250ms budget is exceeded by the current implementation. This is the P4R-0 finding, not a P4R-0 failure: P4R-1 owns the fix. The budget must not be raised to accommodate it.',
    },
    checks,
    verification,
    invariants: {
      executionTruth: 'run_tool -> tool_job -> artifact_truth',
      secondExecutorCreated: false,
      developerDatabaseTouched: false,
      realUserDataTouched: false,
      clientMetricsFabricated: false,
      resultStudioQualificationClaimed: false,
    },
    passed: checks.every((check) => check.passed),
  };
}

try {
  if (process.argv.includes('--write-evidence')) {
    const capture = await captureBaseline({ quiet: true });
    const observation = toObservation(capture);
    const verification = { generatedAt: new Date().toISOString(), commands: runCommands() };
    const report = { ...inspect(verification, observation), generatedAt: verification.generatedAt, privacyClean: true };
    if (!report.passed) throw new Error(report.checks.filter((check) => !check.passed).map((check) => check.id).join(','));
    mkdirSync(dirname(evidencePath), { recursive: true });
    writeFileSync(evidencePath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`[G0-RS-P4R-0] PASS — evidence updated (${report.checks.length}/${report.checks.length})`);
    console.log(`[G0-RS-P4R-0] budget ${report.budgetStatus.eventLoopMaxMs}: observed ${report.budgetStatus.observedMaxMs}ms against a frozen ${BUDGETS.eventLoopMaxMs.value}ms`);
  } else {
    if (!existsSync(evidencePath)) throw new Error('evidence missing; run npm run g0:result-studio:p4r:update');
    const stored = JSON.parse(readFileSync(evidencePath, 'utf8'));
    const current = inspect(stored.verification, stored.baselineObservation);
    if (!stored.passed || !current.passed
      || JSON.stringify(stored.sourceHashes) !== JSON.stringify(current.sourceHashes)) {
      throw new Error('stored G0-RS-P4R-0 evidence is stale or invalid');
    }
    // A stored budget that was quietly raised is exactly the failure the plan
    // forbids, so the frozen values are re-verified rather than trusted.
    if (JSON.stringify(stored.budgets) !== JSON.stringify(BUDGETS)) {
      throw new Error('frozen G0-RS-P4R-0 budgets were modified; they must not be loosened to obtain a pass');
    }
    console.log(`[G0-RS-P4R-0] PASS — ${current.checks.length}/${current.checks.length} (budget ${stored.budgetStatus.eventLoopMaxMs}, observed ${stored.budgetStatus.observedMaxMs}ms)`);
  }
} catch (error) {
  console.error(`[G0-RS-P4R-0] FAIL — ${error.message}`);
  process.exitCode = 1;
}
