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
import { homedir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { captureBaseline } from './g0-rs-p4r-baseline.mjs';
import { ISOLATED_PATH_ENV, assertIsolated } from './g0-rs-p4r-capture.mjs';

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
  invariantTest: 'test/p4r-invariants.test.mjs',
  acceptanceScript: 'scripts/g0-rs-p4r-acceptance.mjs',
};

function sourceCommitStatus(commit, hashes) {
  if (!commit || spawnSync('git', ['merge-base', '--is-ancestor', commit, 'HEAD'], { cwd: root }).status !== 0) {
    return { reachable: false, mismatches: Object.values(sourceFiles) };
  }
  const mismatches = Object.entries(sourceFiles).flatMap(([key, file]) => {
    const result = spawnSync('git', ['show', `${commit}:${file}`], { cwd: root, encoding: 'utf8' });
    return result.status === 0 && sha(result.stdout) === hashes[key] ? [] : [file];
  });
  return { reachable: true, mismatches };
}

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
  versionSwitchMs: 'unmeasured_not_captured_no_browser_automation_in_repo',
  codeOpenMs: 'deferred_to_G0-RS-P4R-5: no revision source projection route exists (23 routes checked)',
});

/**
 * The P4R-0 baseline, frozen as a CONSTANT.
 *
 * A baseline is a record of how the system behaved at a moment, so it must not
 * be re-measured. Until this was added, `--write-evidence` re-ran the capture
 * and overwrote these numbers, and the gate stayed green while doing it — so
 * running the documented update command after a P4R-1 optimisation would have
 * silently destroyed the evidence that the optimisation improved anything.
 * That is the same shape as the defects this stage spent its time removing: an
 * operation that looks routine and quietly erases the thing it reports on.
 *
 * Captured at e1f841c8, revisionCount 1, on an idle machine
 * (gitSpawnMedianMs 9.559, not under npm). Later runs re-measure into
 * `currentObservation` and are compared against this; they never replace it.
 */
export const FROZEN_BASELINE = Object.freeze({
    "capturedAtCommit": "e1f841c8ada919250c01f5cde76586ef2375bdc6",
    "revisionCount": 1,
    "calibration": {
      "gitSpawnMedianMs": 9.559,
      "pathEntries": 31,
      "invokedUnderNpm": false
    },
    "requests": [
      {
        "id": "job-status",
        "role": "render-blocking",
        "status": 200,
        "coldMs": 5.492,
        "warmMs": 2.229,
        "oneTimeCostMs": 3.263
      },
      {
        "id": "artifact-bytes",
        "role": "render-blocking",
        "status": 200,
        "coldMs": 5.043,
        "warmMs": 2.174,
        "oneTimeCostMs": 2.869
      },
      {
        "id": "interaction",
        "role": "secondary",
        "status": 200,
        "coldMs": 389.139,
        "warmMs": 9.9,
        "oneTimeCostMs": 379.239
      },
      {
        "id": "context-envelope",
        "role": "secondary",
        "status": 409,
        "coldMs": 4.235,
        "warmMs": 1.719,
        "oneTimeCostMs": 2.516
      },
      {
        "id": "changesets",
        "role": "secondary",
        "status": 200,
        "coldMs": 45.73,
        "warmMs": 42.102,
        "oneTimeCostMs": 3.628
      },
      {
        "id": "workspace-status",
        "role": "secondary",
        "status": 200,
        "coldMs": 64.925,
        "warmMs": 64.862,
        "oneTimeCostMs": 0.063
      }
    ],
    "eventLoop": {
      "resolutionMs": 10,
      "samples": 16,
      "minMs": 9.839,
      "meanMs": 58.073,
      "maxMs": 394.265,
      "percentilesOmitted": "sample count too low for p95/p99 to be meaningful"
    }
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
    calibration: capture.calibration,
    revisionCount: capture.revisionCount ?? null,
    scalingNote: 'workspace-status is linear in revisionCount. This capture is the cheapest case; the route grows and crosses the frozen 250ms budget well before the 5000-revision cap. P4R-1 must re-capture with revisionCount swept before choosing any cache key.',
    corpus: capture.corpus.map(({ toolId, durationMs, artifactCount }) => ({ toolId, durationMs, artifactCount })),
    requests: capture.requests.map(({ id, role, status, totalMs, coldMs, warmMs, warmSamplesMs, warmSpreadMs, oneTimeCostMs, bytes }) =>
      ({ id, role, status, totalMs, coldMs, warmMs, warmSamplesMs, warmSpreadMs, oneTimeCostMs, bytes })),
    renderBlockingTotalMs: Number(renderBlocking.reduce((sum, request) => sum + request.totalMs, 0).toFixed(3)),
    slowestRequest: capture.requests.reduce((worst, request) => (request.totalMs > (worst?.totalMs ?? -1) ? request : worst), null)?.id ?? null,
    // p95/p99 are dropped deliberately: these runs record ~17 samples, at which
    // percentile(99) returns max exactly, so publishing them invents precision.
    // Report the sample count and the peak, and let the reader judge.
    eventLoop: capture.eventLoop
      ? {
        resolutionMs: capture.eventLoop.resolutionMs,
        samples: capture.eventLoop.samples,
        minMs: capture.eventLoop.minMs,
        meanMs: capture.eventLoop.meanMs,
        maxMs: capture.eventLoop.maxMs,
        percentilesOmitted: 'sample count too low for p95/p99 to be meaningful',
      }
      : null,
    unmeasured: [
      ...Object.entries(capture.clientMetrics).map(([key, metric]) => ({ metric: key, reason: metric.status })),
      // Recorded so the gap cannot be mistaken for a measured zero.
      { metric: 'context-envelope', reason: `route returned ${byId.get('context-envelope')?.status ?? 'unknown'}; excluded from the baseline` },
    ],
  };
}

/**
 * Exercise the isolation list instead of reading its source.
 *
 * Deleting the real keys from ISOLATED_PATH_ENV must fail this. The previous
 * source-regex version stayed green because the same variable names appear in
 * the capture script's own doc comment.
 */
function probeIsolationBehaviour() {
  const REQUIRED = [
    'BIOF3_DB_PATH', 'BIOF3_TEMP_DIR', 'BIOF3_LOCAL_RESULTS_DIR', 'BIOF3_LOCAL_UPLOADS_DIR',
    'BIOF3_LOCAL_DATA_DIR', 'BIOF3_PLUGINS_DIR', 'BIOF3_HARNESS_LOCAL_ROOT',
  ];
  const allGuarded = REQUIRED.every((key) => key in ISOLATED_PATH_ENV);
  const fakeRoot = '/tmp/biof3-acceptance-probe';
  const env = Object.fromEntries(
    Object.entries(ISOLATED_PATH_ENV).map(([key, leaf]) => [key, join(fakeRoot, leaf)]),
  );
  let rejectsRealDataRoot = false;
  try {
    assertIsolated({ ...env, BIOF3_LOCAL_DATA_DIR: join(homedir(), 'Documents', 'BioF3-Local') }, fakeRoot);
  } catch {
    rejectsRealDataRoot = true;
  }
  return { allGuarded, rejectsRealDataRoot };
}

/** Exercise the probe rather than grepping it: off by default, real samples when armed. */
function probeBehaviourCheck() {
  const perfProbe = createRequire(import.meta.url)(join(root, 'core/r-server/helpers/perf-probe.js'));
  const hadFlag = process.env.BIOF3_PERF_PROBE;
  delete process.env.BIOF3_PERF_PROBE;
  perfProbe.disableProbe();
  const offByDefault = perfProbe.enableProbe() === false
    && perfProbe.snapshotProbe().enabled === false;

  perfProbe.enableProbe({ force: true });
  const snapshot = perfProbe.snapshotProbe();
  const resolutionMs = snapshot.eventLoop ? snapshot.eventLoop.resolutionMs : null;
  // An unsampled histogram must report null rather than its int64 sentinel.
  const reportsRealSamples = snapshot.eventLoop !== null
    && (snapshot.eventLoop.samples === 0 ? snapshot.eventLoop.maxMs === null : true);
  perfProbe.disableProbe();
  if (hadFlag !== undefined) process.env.BIOF3_PERF_PROBE = hadFlag;
  return { offByDefault, resolutionMs, reportsRealSamples };
}

/** Run the invariant suite and parse its real outcome. */
function runInvariantSuite() {
  const result = spawnSync('node', ['--test', sourceFiles.invariantTest], {
    cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  const out = `${result.stdout || ''}`;
  const num = (label) => {
    const match = new RegExp(`^# ${label} (\\d+)$`, 'm').exec(out);
    return match ? Number(match[1]) : Number((new RegExp(`\u2139 ${label} (\\d+)`).exec(out) || [])[1] ?? NaN);
  };
  const passed = num('pass');
  const failed = num('fail');
  return { passed, failed, total: passed + failed };
}

/** Compare a fresh measurement against the frozen baseline, warm path only. */
function compareToBaseline(observation) {
  const baseline = new Map(FROZEN_BASELINE.requests.map((r) => [r.id, r]));
  return (observation?.requests || [])
    .filter((r) => r.status === 200 && Number.isFinite(r.warmMs))
    .map((r) => {
      const was = baseline.get(r.id);
      if (!was || !Number.isFinite(was.warmMs)) return { id: r.id, baselineWarmMs: null, currentWarmMs: r.warmMs };
      return {
        id: r.id,
        baselineWarmMs: was.warmMs,
        currentWarmMs: r.warmMs,
        deltaPct: Number((((r.warmMs - was.warmMs) / was.warmMs) * 100).toFixed(1)),
      };
    });
}

function inspect(verification, observation) {
  const capture = read(sourceFiles.capture);
  const corpus = read(sourceFiles.corpus);
  const baseline = read(sourceFiles.baseline);
  const probe = read(sourceFiles.probe);
  const commands = verification?.commands || [];

  const isolationBehaviour = probeIsolationBehaviour();
  const probeBehaviour = probeBehaviourCheck();
  const invariantRun = runInvariantSuite();
  const packageScripts = JSON.parse(read('package.json')).scripts || {};
  const byId = new Map((observation?.requests || []).map((request) => [request.id, request]));
  const measuredAll = MUST_BE_MEASURED.every((id) => byId.get(id)?.status === 200);
  const eventLoop = observation?.eventLoop || {};
  const budgetMet = Number.isFinite(eventLoop.maxMs) && eventLoop.maxMs <= BUDGETS.eventLoopMaxMs.value;
  const requests = observation?.requests || [];
  // A route is one-time dominated when most of its first-call cost disappears on
  // the second call; optimising it would not change steady-state viewing.
  const oneTimeDominated = requests.filter((r) => Number.isFinite(r.oneTimeCostMs)
    && Number.isFinite(r.coldMs) && r.coldMs > 0 && r.oneTimeCostMs / r.coldMs >= 0.5);
  const steadyStateWorst = requests
    .filter((r) => Number.isFinite(r.warmMs))
    .reduce((worst, r) => (r.warmMs > (worst?.warmMs ?? -1) ? r : worst), null);

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

    // Was `BUDGETS.x.signal.includes('monitorEventLoopDelay')` — a constant
    // asserted against itself. Now exercises the probe: a live histogram must
    // report a real resolution and real samples.
    item('RS-P4R0-4',
      probeBehaviour.resolutionMs === 10 && probeBehaviour.reportsRealSamples === true,
      [sourceFiles.probe],
      'The authoritative >250ms signal is declared as the 10ms-resolution histogram; the 1Hz tick sampler is explicitly rejected as unable to resolve it.'),

    item('RS-P4R0-5',
      Array.isArray(observation?.unmeasured) && observation.unmeasured.length > 0
      && observation.unmeasured.every((entry) => typeof entry.reason === 'string' && entry.reason.length > 0),
      [sourceFiles.baseline],
      'Metrics with no producer are recorded as unmeasured with a stated reason, never estimated or defaulted to zero.'),

    // Was five regexes over scripts/g0-rs-p4r-capture.mjs. All three variable
    // names also appear in that file's own doc comment, so deleting the real
    // keys from ISOLATED_PATH_ENV left this green while its claim became false.
    // Now imports the list and exercises the guard.
    item('RS-P4R0-6', isolationBehaviour.allGuarded === true && isolationBehaviour.rejectsRealDataRoot === true,
      [sourceFiles.capture, sourceFiles.captureTest],
      'Every writable path is redirected and guarded from one declared list, so a capture cannot reach the developer database or the real user data root.'),

    item('RS-P4R0-7', probeBehaviour.offByDefault === true,
      [sourceFiles.probe, sourceFiles.probeRoutes],
      'The probe is env-gated: with the flag unset every export is a no-op and the /api/__perf surface is not mounted.'),

    // A grep for 'createProject' matched this script's own prose too. The
    // measurement itself proves it: without an owned project every
    // result-studio route rejects, so 200s ARE the evidence.
    item('RS-P4R0-8',
      MUST_BE_MEASURED.filter((id) => id.startsWith('changesets') || id.startsWith('workspace'))
        .every((id) => byId.get(id)?.status === 200),
      [sourceFiles.corpus],
      'The corpus creates and owns a real project, without which every Result Studio route rejects and the baseline would time validation.'),

    item('RS-P4R0-11',
      requests.length > 0
      && requests.filter((r) => r.status === 200).every((r) => Number.isFinite(r.coldMs) && Number.isFinite(r.warmMs)),
      [sourceFiles.baseline],
      'Every measured route records both a first-call and a second-call timing, so one-time creation cost cannot be reported as steady-state viewing cost.'),

    // Was three literal greps, all of which also occur in that file's comments,
    // so deleting every assertion kept this green. Now RUNS the suite and
    // asserts its real shape: four invariants present, and at least one failing
    // (a suite that all passes would mean P4R-1's targets no longer exist).
    item('RS-P4R0-12',
      invariantRun.total >= 4 && invariantRun.failed >= 1 && invariantRun.passed >= 1,
      [sourceFiles.invariantTest],
      'The plan invariants exist as tests written against code reality and name concrete defects. They are deliberately NOT aggregated into this gate: the remaining source-projection invariant stays red until its owning P4R-5 phase, while the earlier P4R-1 invariants now pass.'),

    // Fails if the frozen baseline is edited to match a later measurement.
    // A baseline that drifts toward the present proves nothing.
    item('RS-P4R0-13',
      FROZEN_BASELINE.capturedAtCommit === 'e1f841c8ada919250c01f5cde76586ef2375bdc6'
      && FROZEN_BASELINE.revisionCount === 1
      && (FROZEN_BASELINE.requests.find((r) => r.id === 'workspace-status') || {}).warmMs === 64.862
      && (FROZEN_BASELINE.requests.find((r) => r.id === 'changesets') || {}).warmMs === 42.102,
      [sourceFiles.acceptanceScript],
      'The P4R-0 baseline is a frozen constant, not a re-measured value. Its numbers are pinned so a later run cannot quietly replace the record it exists to preserve.'),

    item('RS-P4R0-9', commands.length >= 3 && commands.every((command) => command.passed),
      [evidencePath.replace(`${root}/`, '')],
      'All declared P4R-0 command gates passed.'),

    // Checks the recorded commands, not this file's own source: an earlier
    // version grepped the script for the pattern and matched the check's own
    // code, which is a self-referential assertion rather than a real one.
    // Reads package.json rather than this script's own command literals: the
    // vacuous-gate class lives in the npm scripts, so that is what must be checked.
    item('RS-P4R0-10',
      commands.length > 0
      && commands.every((command) => !/\bnpm test\b/.test(command.command))
      && Object.values(packageScripts).every((value) => !/npm test --prefix frontend/.test(String(value))),
      [evidencePath.replace(`${root}/`, ''), 'package.json'],
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
    // The frozen record and a fresh measurement, kept apart on purpose. Only
    // `currentObservation` moves; `frozenBaseline` is a constant in this file.
    frozenBaseline: FROZEN_BASELINE,
    baselineObservation: observation,
    improvementVsBaseline: compareToBaseline(observation),
    budgetStatus: {
      eventLoopMaxMs: budgetMet ? 'met' : 'violated_by_current_implementation',
      observedMaxMs: eventLoop.maxMs ?? null,
      attributedTo: observation?.slowestRequest ?? null,
      // The first version of this evidence attributed the whole peak to
      // `interaction` without noting that its first call lazily creates a
      // ChangeSet, writes .biof3/revision/ and makes a Git commit. Measuring a
      // second pass separates one-time creation from what every view pays, and
      // that distinction decides what P4R-1 should actually optimise.
      steadyStateWorstMs: steadyStateWorst?.warmMs ?? null,
      steadyStateWorstRoute: steadyStateWorst?.id ?? null,
      oneTimeDominated: oneTimeDominated.map((r) => r.id),
      note: budgetMet
        ? 'Current implementation is within the frozen block budget.'
        : 'The frozen 250ms budget is exceeded by the current implementation. This is the P4R-0 finding, not a P4R-0 failure: P4R-1 owns the fix. The budget must not be raised to accommodate it.',
      // Honesty about the instrument, not just the reading. Absolute timings on
      // this harness are load-sensitive: the same capture produced a 383ms cold
      // interaction on an idle machine and 4072ms immediately after several
      // back-to-back DESeq2 runs, with tight within-run spreads either way. What
      // is stable across every observation is the STRUCTURE below, and the
      // violation conclusion holds at both ends of the observed range, since even
      // the cleanest run exceeds 250ms.
      absoluteTimingsAreLoadSensitive: true,
      observedColdRangeMsAcrossRuns: [383.491, 4072.669],
      loadSensitivityCause: 'Process-spawn cost swings roughly 12x with invocation context (measured ~9-11ms direct, ~117-122ms under npm), and detectGitRuntime() is uncached so every git-touching route pays it per call. An earlier revision of this file blamed PATH length; that explanation was tested and DISPROVED, and the real cause is not established. Compare readings only within the same calibration — see baselineObservation.calibration.',
      violationRobustAtRangeFloor: true,
      structuralFinding: 'interaction is one-time dominated (its cost disappears on a second call); changesets and workspace-status are recurring costs paid by every view. P4R-1 should target the recurring pair, not the one-time creation.',
      // Said plainly so P4R-1 is not judged against work it is not chartered to do.
      violationAttribution: 'The recorded peak is the one-time interaction ChangeSet creation, which is OUT of P4R-1 scope. The routes P4R-1 owns are under budget at this revisionCount and exceed it as revisions accumulate. P4R-1 is accountable for the recurring pair and for the growth term, not for this peak.',
    },
    checks,
    verification,
    // No hand-written invariant booleans. This script's own stated principle
    // rejects manual assertions, and six unchecked booleans (secondExecutorCreated,
    // developerDatabaseTouched, ...) had no check behind them and were referenced
    // by none of the checks. What is actually verified lives in checks[].
    executionTruth: 'run_tool -> tool_job -> artifact_truth',
    passed: checks.every((check) => check.passed),
  };
}

// Guarded: this module also exports FROZEN_BASELINE, and importing that must
// not run the gate. Without this, importing the constant regenerated this very
// evidence file as a side effect of another script starting up.
const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

try {
  if (!invokedDirectly) {
    // imported for FROZEN_BASELINE only
  } else if (process.argv.includes('--write-evidence')) {
    const capture = await captureBaseline({ quiet: true });
    const observation = toObservation(capture);
    const verification = { generatedAt: new Date().toISOString(), commands: runCommands() };
    const report = { ...inspect(verification, observation), generatedAt: verification.generatedAt, privacyClean: true };
    const commitStatus = sourceCommitStatus(report.sourceCommit, report.sourceHashes);
    report.sourceCommitReachable = commitStatus.reachable;
    report.sourceCommitMatchesSourceHashes = commitStatus.reachable && commitStatus.mismatches.length === 0;
    report.sourceCommitMismatches = commitStatus.mismatches;
    if (!report.sourceCommitMatchesSourceHashes) throw new Error(`source commit mismatch: ${commitStatus.mismatches.join(',')}`);
    if (!report.passed) throw new Error(report.checks.filter((check) => !check.passed).map((check) => check.id).join(','));
    mkdirSync(dirname(evidencePath), { recursive: true });
    writeFileSync(evidencePath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`[G0-RS-P4R-0] PASS — evidence updated (${report.checks.length}/${report.checks.length})`);
    console.log(`[G0-RS-P4R-0] budget ${report.budgetStatus.eventLoopMaxMs}: observed ${report.budgetStatus.observedMaxMs}ms against a frozen ${BUDGETS.eventLoopMaxMs.value}ms`);
  } else {
    if (!existsSync(evidencePath)) throw new Error('evidence missing; run npm run g0:result-studio:p4r:update');
    const stored = JSON.parse(readFileSync(evidencePath, 'utf8'));
    const current = inspect(stored.verification, stored.baselineObservation);
    const commitStatus = sourceCommitStatus(stored.sourceCommit, stored.sourceHashes || {});
    if (!stored.passed || !current.passed || !stored.sourceCommitMatchesSourceHashes
      || !commitStatus.reachable || commitStatus.mismatches.length > 0
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
