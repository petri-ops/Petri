import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  P6_ELECTRON_PRESSURE_BUDGETS,
  P6_ELECTRON_PRESSURE_CLASSIFICATION,
  P6_ELECTRON_PRESSURE_ROWS,
  P6_ELECTRON_PRESSURE_SOURCE_FILES,
  P6_ELECTRON_PRESSURE_SYNTHETIC_REVISIONS,
  assertP6ElectronPressureEvidenceWritable,
  assertSanitizedP6ElectronPressureEvidence,
  buildP6ElectronPressureVerdict,
  buildVolcanoPressureCsv,
  findBioPackRoot,
  getP6ElectronPressureSourceBinding,
  loadGoKeggPressureInput,
  writeP6ElectronPressureEvidence,
} from '../scripts/g0-rs-p6-electron-pressure-prototype.mjs';
import { P6_UI110_SOURCE_FILES } from '../scripts/g0-rs-p6-ui110-observation.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Bio fixtures live in the independent domain pack; pack-absent machines skip
// the pack-dependent producer test with an explicit reason (BLOCK-83 §P4).
const BIO_PACK_SKIP_REASON = 'bio pack not present (expected sibling ../gewu-pack-bio or BIOF3_BIO_PACK_ROOT); go-kegg pressure fixture unavailable';

function passingObservation(overrides = {}) {
  const base = {
    truth: {
      artifactTruthValid: true,
      exactPhysicalHashes: true,
      sqliteFormalOutputRevisionsExact: true,
      table: { rows: P6_ELECTRON_PRESSURE_ROWS },
      svg: { complex: true },
      png: { width: 2100 },
      report: {
        present: true,
        longVolumeProven: true,
        sqliteRevisionProjection: 'measured',
      },
    },
    pressure: {
      realJobBackedCohortCount: 2,
      projectToolJobCount: 2,
      syntheticRevisionCount: P6_ELECTRON_PRESSURE_SYNTHETIC_REVISIONS,
      syntheticFamilyCount: 3,
      syntheticClassification: 'same_real_artifact_bytes_revision_alias_without_additional_execution',
      immutableMutationRejected: true,
      immutableDigestStable: true,
    },
    renderer: {
      passed: true,
      renderProcessGoneCount: 0,
      table: {
        totalRows: P6_ELECTRON_PRESSURE_ROWS,
        canvasFirstVisibleMs: 500,
        navigationMs: 700,
        scrollFeedbackMs: 20,
        scrollChanged: true,
        selectionFeedbackMs: 15,
        selectionChanged: true,
        sortFeedbackMs: 18,
        sortChanged: true,
        filterFeedbackMs: 16,
        filterQueryCompleteMs: 620,
        filterChanged: true,
        filterQueryChanged: true,
        filterMatchedSummaryChanged: true,
        filterFirstVisibleRowChanged: true,
        virtualPageLoadMs: 350,
        virtualPageChanged: true,
      },
      media: {
        png: {
          loadMs: 900,
          switch: { feedbackMs: 25, changed: true },
          rendered: true,
          renderMode: 'source_image',
          naturalWidth: 2100,
          naturalHeight: 1500,
          sourceTargetMatched: true,
          artifactTargetMatched: true,
        },
        svg: {
          loadMs: 4_000,
          switch: { feedbackMs: 30, changed: true },
          exportLinkPresent: true,
          exportHrefMatched: true,
          bytes: 1_200_000,
          validSvgRoot: true,
          fetchMs: 30,
          sourceTargetMatched: true,
          artifactTargetMatched: true,
        },
        report: {
          loadMs: 3_000,
          iframeVisible: true,
          iframeWidth: 582,
          iframeHeight: 520,
          textCharacters: 1_283,
          embeddedImageCount: 6,
          firstEmbeddedImageWidth: 258,
          sourceTargetMatched: true,
          artifactTargetMatched: true,
        },
      },
      compare: {
        progressiveRows: 200,
        openMs: 650,
        progressivePages: [
          { rows: 50, loadMs: null },
          { rows: 100, loadMs: 250 },
          { rows: 150, loadMs: 300 },
          { rows: 200, loadMs: 350 },
        ],
      },
      history: {
        firstPageVersions: 100,
        firstPageMs: 1_200,
        afterPaginationVersions: 123,
        paginationMs: 450,
      },
      memory: { peakPostGcGrowthBytes: 8 * 1024 * 1024 },
      publicProjectionAudit: { absolutePath: false, providerMaterial: false, rawInternalId: false },
      publicProjectionSampleCount: 7,
      artifactNetwork: {
        completedCount: 4,
        errorCount: 0,
        events: [
          { artifactName: 'volcano.svg', outcome: 'completed', statusCode: 200 },
        ],
      },
      backendStatus: { checkCount: 2, everyCheckReady: true, maxDurationMs: 25 },
    },
    revisionLedgerStableDuringElectron: true,
  };
  return {
    ...base,
    ...overrides,
    truth: { ...base.truth, ...(overrides.truth || {}) },
    pressure: { ...base.pressure, ...(overrides.pressure || {}) },
    renderer: {
      ...base.renderer,
      ...(overrides.renderer || {}),
      table: { ...base.renderer.table, ...(overrides.renderer?.table || {}) },
      media: {
        ...base.renderer.media,
        ...(overrides.renderer?.media || {}),
        png: { ...base.renderer.media.png, ...(overrides.renderer?.media?.png || {}) },
        svg: { ...base.renderer.media.svg, ...(overrides.renderer?.media?.svg || {}) },
        report: { ...base.renderer.media.report, ...(overrides.renderer?.media?.report || {}) },
      },
      compare: { ...base.renderer.compare, ...(overrides.renderer?.compare || {}) },
      history: { ...base.renderer.history, ...(overrides.renderer?.history || {}) },
      memory: { ...base.renderer.memory, ...(overrides.renderer?.memory || {}) },
    },
  };
}

function writableEvidence(overrides = {}) {
  const observation = passingObservation();
  const verdict = buildP6ElectronPressureVerdict(observation);
  return {
    ...observation,
    schemaVersion: 1,
    classification: P6_ELECTRON_PRESSURE_CLASSIFICATION,
    qualificationEligible: false,
    p6CloseoutEligible: false,
    sourceCommitMatchesSourceHashes: true,
    sourceBindingStableDuringObservation: true,
    budgets: P6_ELECTRON_PRESSURE_BUDGETS,
    checks: verdict.checks,
    passed: true,
    ...overrides,
  };
}

test('P6 Electron pressure source binding contains its complete UI/runtime ancestry without aliases', () => {
  const paths = Object.values(P6_ELECTRON_PRESSURE_SOURCE_FILES);
  assert.equal(new Set(paths).size, paths.length, 'one source path must not hide behind multiple aliases');
  for (const relative of Object.values(P6_UI110_SOURCE_FILES)) {
    assert.ok(paths.includes(relative), `P6 UI-110 dependency is not bound: ${relative}`);
  }
  for (const required of [
    'scripts/g0-rs-p6-electron-pressure-prototype.mjs',
    'scripts/g0-rs-p6-electron-pressure-driver.cjs',
    'test/g0-rs-p6-electron-pressure-prototype.test.mjs',
    'core/biof3-server/helpers/tools-executor.js',
    'core/biof3-server/routes/result-studio.js',
    'core/shared-backend/result-studio-lifecycle.js',
    'core/shared-backend/result-studio-repository.js',
    'core/shared-backend/result-studio-runtime-lease.js',
    'core/shared-backend/result-studio-table-query.js',
    'src/backend-health.js',
    'frontend/src/components/result-studio/ScientificInteractionViewer.tsx',
    'frontend/src/components/result-studio/ResultStudioChangeSetPanel.tsx',
    'frontend/src/components/result-studio/resultSurface.ts',
  ]) {
    assert.ok(paths.includes(required), `missing source-bound pressure dependency: ${required}`);
  }

  const binding = getP6ElectronPressureSourceBinding();
  assert.match(binding.sourceCommit, /^[a-f0-9]{40}$/);
  assert.match(binding.bindingDigest, /^[a-f0-9]{64}$/);
  assert.equal(Object.keys(binding.sourceHashes).length, paths.length);
  assert.ok(Object.values(binding.sourceHashes).every((digest) => /^[a-f0-9]{64}$/.test(digest)));
  assert.ok(Array.isArray(binding.sourceMismatches));
});

test('P6 pressure input producers are deterministic and preserve exact requested row counts', {
  skip: findBioPackRoot() ? false : BIO_PACK_SKIP_REASON,
}, () => {
  const volcano = buildVolcanoPressureCsv(4);
  assert.equal(volcano, buildVolcanoPressureCsv(4));
  assert.equal(volcano.trimEnd().split('\n').length, 5);
  assert.match(volcano, /^gene,log2FoldChange,pvalue,padj\nGENE000001,/);
  assert.match(volcano, /GENE000004,/);

  const report = loadGoKeggPressureInput();
  assert.equal(report.rowCount, report.csv.trimEnd().split('\n').length - 1);
  assert.ok(report.rowCount >= 60);
  assert.match(report.csv, /^gene\nTP53\nBRCA1/);
  assert.deepEqual(report, loadGoKeggPressureInput());
  assert.throws(() => buildVolcanoPressureCsv(0), /p6_pressure_row_count_invalid/);

  const prototype = readFileSync(
    path.join(ROOT, 'scripts/g0-rs-p6-electron-pressure-prototype.mjs'),
    'utf8',
  );
  assert.match(prototype, /GO\\\/KEGG 功能富集分析/);
  assert.doesNotMatch(prototype, /Expression QC Report/);
  assert.doesNotMatch(prototype, /stageP6Ui110LocalCapability/);
  assert.match(prototype, /host_runtime_observed_through_completed_artifact_truth_job/);
  assert.match(prototype, /repository\.appendRevisionBatch\(\{\s+revisions:/);
  assert.doesNotMatch(prototype, /UPDATE artifact_revisions SET output_hash/);
  const driver = readFileSync(
    path.join(ROOT, 'scripts/g0-rs-p6-electron-pressure-driver.cjs'),
    'utf8',
  );
  assert.match(driver, /return resolve\(\{\s+feedbackMs,\s+queryCompleteMs:/);
  assert.match(driver, /queryCompleteMs: performance\.now\(\) - started/);
  assert.match(driver, /filterQueryCompleteMs: filter\.queryCompleteMs/);
});

test('P6 pressure verdict independently enforces every frozen renderer budget', () => {
  const passing = buildP6ElectronPressureVerdict(passingObservation());
  assert.equal(passing.passed, true);
  assert.equal(passing.checks.length, 26);
  assert.equal(passing.frozenBudgetCount, 15);
  assert.equal(P6_ELECTRON_PRESSURE_BUDGETS.firstCanvasMs, 1_500,
    'P6 measures cold development navigation; the packaged/in-app 1s target stays in P7');
  assert.ok(!passing.remainingGaps.includes('long_report_volume_not_proven'));
  assert.ok(!passing.remainingGaps.includes('report_revision_projection_not_measured'));
  assert.ok(passing.remainingGaps.includes('synthetic_revision_aliases_do_not_prove_201_distinct_tool_executions'));

  const budgetCases = [
    ['P6EP-10', P6_ELECTRON_PRESSURE_BUDGETS.firstCanvasMs,
      (value) => ({ renderer: { table: { canvasFirstVisibleMs: value } } })],
    ['P6EP-11', P6_ELECTRON_PRESSURE_BUDGETS.tableScrollFeedbackMs,
      (value) => ({ renderer: { table: { scrollFeedbackMs: value } } })],
    ['P6EP-12', P6_ELECTRON_PRESSURE_BUDGETS.selectionFeedbackMs,
      (value) => ({ renderer: { table: { selectionFeedbackMs: value } } })],
    ['P6EP-13', P6_ELECTRON_PRESSURE_BUDGETS.sortFeedbackMs,
      (value) => ({ renderer: { table: { sortFeedbackMs: value } } })],
    ['P6EP-14', P6_ELECTRON_PRESSURE_BUDGETS.filterFeedbackMs,
      (value) => ({ renderer: { table: { filterFeedbackMs: value } } })],
    ['P6EP-15', P6_ELECTRON_PRESSURE_BUDGETS.artifactSwitchMs,
      (value) => ({ renderer: { media: { png: { switch: { feedbackMs: value } } } } })],
    ['P6EP-16', P6_ELECTRON_PRESSURE_BUDGETS.virtualPageLoadMs,
      (value) => ({ renderer: { table: { virtualPageLoadMs: value } } })],
    ['P6EP-17', P6_ELECTRON_PRESSURE_BUDGETS.pngContentReadyMs,
      (value) => ({ renderer: { media: { png: { loadMs: value } } } })],
    ['P6EP-18', P6_ELECTRON_PRESSURE_BUDGETS.svgContentReadyMs,
      (value) => ({ renderer: { media: { svg: { loadMs: value } } } })],
    ['P6EP-19', P6_ELECTRON_PRESSURE_BUDGETS.reportContentReadyMs,
      (value) => ({ renderer: { media: { report: { loadMs: value } } } })],
    ['P6EP-20', P6_ELECTRON_PRESSURE_BUDGETS.compareOpenMs,
      (value) => ({ renderer: { compare: { openMs: value } } })],
    ['P6EP-21', P6_ELECTRON_PRESSURE_BUDGETS.progressivePageLoadMs,
      (value) => ({ renderer: { compare: { progressivePages: [
        { rows: 50, loadMs: null },
        { rows: 100, loadMs: value },
        { rows: 150, loadMs: 300 },
        { rows: 200, loadMs: 350 },
      ] } } })],
    ['P6EP-22', P6_ELECTRON_PRESSURE_BUDGETS.historyFirstPageMs,
      (value) => ({ renderer: { history: { firstPageMs: value } } })],
    ['P6EP-23', P6_ELECTRON_PRESSURE_BUDGETS.historyPaginationMs,
      (value) => ({ renderer: { history: { paginationMs: value } } })],
    ['P6EP-24', P6_ELECTRON_PRESSURE_BUDGETS.rendererPostGcHeapGrowthBytes,
      (value) => ({ renderer: { memory: { peakPostGcGrowthBytes: value } } })],
  ];
  for (const [id, limit, overrideFor] of budgetCases) {
    for (const value of [limit + 1, undefined, Number.NaN, -1]) {
      const verdict = buildP6ElectronPressureVerdict(passingObservation(overrideFor(value)));
      assert.equal(verdict.passed, false, `${id} must fail the overall verdict for ${String(value)}`);
      assert.equal(verdict.checks.find((entry) => entry.id === id)?.passed, false,
        `${id} must fail closed for an over-limit, missing, NaN or negative observation`);
    }
  }

  const missingProjectionAudit = buildP6ElectronPressureVerdict(passingObservation({
    renderer: { publicProjectionAudit: undefined },
  }));
  assert.equal(missingProjectionAudit.checks.find((entry) => entry.id === 'P6EP-25')?.passed, false);
  const incompleteProjectionAudit = buildP6ElectronPressureVerdict(passingObservation({
    renderer: { publicProjectionSampleCount: 6 },
  }));
  assert.equal(incompleteProjectionAudit.checks.find((entry) => entry.id === 'P6EP-25')?.passed, false);

  for (const renderer of [
    { table: { scrollChanged: false } },
    { table: { selectionChanged: false } },
    { table: { sortChanged: false } },
    { table: { filterChanged: false } },
    { table: { filterQueryChanged: false } },
    { table: { filterMatchedSummaryChanged: false, filterFirstVisibleRowChanged: false } },
    { table: { virtualPageChanged: false } },
    { media: { png: { rendered: false } } },
    { media: { png: { sourceTargetMatched: false } } },
    { media: { svg: { validSvgRoot: false } } },
    { media: { svg: { artifactTargetMatched: false } } },
    { media: { report: { embeddedImageCount: 0 } } },
    { media: { report: { sourceTargetMatched: false } } },
    { artifactNetwork: { completedCount: 3, errorCount: 1, events: [
      { artifactName: 'volcano.svg', outcome: 'error', statusCode: 200 },
    ] } },
    { backendStatus: undefined },
    { backendStatus: { checkCount: 0, everyCheckReady: false, maxDurationMs: null } },
    { backendStatus: { checkCount: 1, everyCheckReady: false, maxDurationMs: 1_500 } },
  ]) {
    const contradiction = buildP6ElectronPressureVerdict(passingObservation({
      renderer: { passed: true, ...renderer },
    }));
    assert.equal(contradiction.checks.find((entry) => entry.id === 'P6EP-07')?.passed, false,
      'raw renderer readiness must override a contradictory nested passed flag');
    assert.equal(contradiction.passed, false);
  }

  for (const report of [
    { present: true, longVolumeProven: false, sqliteRevisionProjection: 'measured' },
    { present: true, longVolumeProven: true, sqliteRevisionProjection: 'unavailable' },
  ]) {
    const verdict = buildP6ElectronPressureVerdict(passingObservation({ truth: { report } }));
    assert.equal(verdict.passed, false, 'long report volume and formal Revision are hard truth gates');
    assert.equal(verdict.checks.find((entry) => entry.id === 'P6EP-03')?.passed, false);
  }
});

test('P6 pressure verdict keeps real Jobs separate from synthetic Revision aliases', () => {
  const tooFewJobs = buildP6ElectronPressureVerdict(passingObservation({
    pressure: { realJobBackedCohortCount: 1 },
  }));
  assert.equal(tooFewJobs.checks.find((entry) => entry.id === 'P6EP-04')?.passed, false);
  assert.equal(tooFewJobs.passed, false);

  const tooFewAliases = buildP6ElectronPressureVerdict(passingObservation({
    pressure: { syntheticRevisionCount: P6_ELECTRON_PRESSURE_SYNTHETIC_REVISIONS - 1 },
  }));
  assert.equal(tooFewAliases.checks.find((entry) => entry.id === 'P6EP-05')?.passed, false);
});

test('P6 pressure evidence sanitizer rejects runtime coordinates, credentials and internal IDs', () => {
  assert.equal(assertSanitizedP6ElectronPressureEvidence(writableEvidence()), true);
  for (const unsafe of [
    { endpoint: 'http://127.0.0.1:3011' },
    { workspace: '/Users/example/private' },
    { artifact: 'rev_private123' },
    { apiKey: 'private' },
    { relativePath: '../outside' },
    { windowsPath: 'C:\\private\\result.csv' },
  ]) {
    assert.throws(() => assertSanitizedP6ElectronPressureEvidence(unsafe), /unsafe|leaked/);
  }
});

test('P6 pressure evidence writer is source-bound, non-qualifying and fail-closed', () => {
  const writes = [];
  const receipt = writeP6ElectronPressureEvidence(writableEvidence(), {
    makeDirectory() {},
    write: (...args) => writes.push(args),
  });
  assert.equal(writes.length, 1);
  assert.match(writes[0][0], /rs-p6-electron-pressure-multirevision\.json$/);
  assert.equal(receipt.bytes, Buffer.byteLength(writes[0][1]));
  assert.match(receipt.digest, /^[a-f0-9]{64}$/);

  assert.throws(
    () => assertP6ElectronPressureEvidenceWritable(writableEvidence({ sourceCommitMatchesSourceHashes: false })),
    (error) => error.code === 'p6_pressure_source_binding_not_current',
  );
  assert.throws(
    () => assertP6ElectronPressureEvidenceWritable(writableEvidence({ qualificationEligible: true })),
    (error) => error.code === 'p6_pressure_evidence_classification_invalid',
  );
  const failingChecks = writableEvidence();
  failingChecks.checks = failingChecks.checks.map((entry, index) => (
    index === 0 ? { ...entry, passed: false } : entry
  ));
  assert.throws(
    () => assertP6ElectronPressureEvidenceWritable(failingChecks),
    (error) => error.code === 'p6_pressure_observation_not_passed',
  );
  const forgedObservation = writableEvidence();
  forgedObservation.renderer.table.filterChanged = false;
  assert.throws(
    () => assertP6ElectronPressureEvidenceWritable(forgedObservation),
    (error) => error.code === 'p6_pressure_observation_not_passed',
  );
  assert.throws(
    () => assertP6ElectronPressureEvidenceWritable(writableEvidence({ budgets: {} })),
    (error) => error.code === 'p6_pressure_observation_not_passed',
  );
});

test('P6 Electron driver uses one hardened BrowserWindow and direct Chromium heap observations', () => {
  const driver = readFileSync(path.join(ROOT, 'scripts/g0-rs-p6-electron-pressure-driver.cjs'), 'utf8');
  assert.match(driver, /new BrowserWindow\(\{/);
  assert.match(driver, /contextIsolation:\s*true/);
  assert.match(driver, /nodeIntegration:\s*false/);
  assert.match(driver, /sandbox:\s*true/);
  assert.match(driver, /Runtime\.getHeapUsage/);
  assert.match(driver, /HeapProfiler\.collectGarbage/);
  assert.match(driver, /app\.setPath\('userData', disposableUserData\)/);
  assert.match(driver, /ipcMain\.handle\('backend:status', async \(\) => \{/);
  assert.match(driver, /new URL\('\/api\/health', config\.backendBaseUrl\)/);
  assert.match(driver, /probeUrl\(healthUrl, BACKEND_STATUS_TIMEOUT_MS\)/);
  assert.match(driver, /isReady: rServerUp/);
  assert.match(driver, /result\.backendStatus\.everyCheckReady === true/);
  assert.doesNotMatch(driver, /isReady:\s*true/);
  assert.match(driver, /webRequest\.onCompleted/);
  assert.match(driver, /webRequest\.onErrorOccurred/);
  assert.match(driver, /resourceTimings/);
  assert.match(driver, /artifactNetwork: artifactNetworkObservation\(\)/);
  assert.match(driver, /result\.artifactNetwork\.errorCount === 0/);
  assert.match(driver, /event\.artifactName === config\.targets\.svg\.artifact/);
  assert.doesNotMatch(driver, /events\.push\(\{[^}]*\burl\b/s);
  assert.match(driver, /canvas\.querySelector\('select\[aria-label="切换当前结果"\]'\)/);
  assert.doesNotMatch(driver, /\[\.\.\.document\.querySelectorAll\('button'\)\]\.find/);
  assert.match(driver, /if \(!pngSwitch\.changed\) throw new Error\('png_artifact_switch_failed'\)/);
  assert.match(driver, /inspectSvgExport\(window\.webContents, config\.targets\.svg\)/);
  assert.match(driver, /exportLinkPresent: true/);
  assert.match(driver, /validSvgRoot:/);
  assert.match(driver, /inspectPlotProjection\(window\.webContents, config\.targets\.png\)/);
  assert.doesNotMatch(driver, /inspectImage\(window\.webContents, config\.targets\.svg\)/);
  assert.doesNotMatch(driver, /当前预览/);
  assert.match(driver, /inspectReport\(window\.webContents, config\.targets\.report\)/);
  assert.match(driver, /ipcMain\.handle\('ai-settings:get', async \(\) => \{/);
  assert.match(driver, /terminal_not_exercised_by_pressure_trace/);
  assert.doesNotMatch(driver, /terminal:session-start/);
  assert.ok(
    driver.indexOf('const tableNavigationMs = await navigate')
      < driver.indexOf('await attachDebugger(window.webContents)'),
    'the first renderer must load before CDP attaches',
  );
  assert.match(driver, /科学结果表格/);
  assert.match(driver, /renderMode: 'scientific_interaction'/);
  assert.match(driver, /pointCount > 0/);
  assert.match(driver, /渐进查看候选表/);
  assert.match(driver, /加载更早版本/);
  assert.match(driver, /startsWith\('data:image\/'\)/);
  assert.match(driver, /image\.complete && image\.naturalWidth > 0/);
  assert.match(driver, /Page\.createIsolatedWorld/);
  assert.match(driver, /Runtime\.evaluate/);
  assert.match(driver, /grantUniveralAccess: false/);
  assert.match(driver, /matchedSummaryChanged/);
  assert.match(driver, /firstVisibleRowChanged/);
  assert.match(driver, /queryChanged && !loading/);
  assert.doesNotMatch(driver, /if \(input\.value === expected\) \{\s*return resolve/);
  assert.match(driver, /canvasFirstVisibleMs: tableNavigationMs/);
  assert.match(driver, /result\.media\.report\.iframeVisible === true/);
  assert.match(driver, /nav\[aria-label="结果视图"\]/);
  assert.match(driver, /switchResultMode\(window\.webContents, '审查', 'compare'\)/);
  assert.match(driver, /switchResultMode\(window\.webContents, '版本历史', 'history'\)/);
  assert.match(driver, /publicProjectionSampleCount >= 7/);
  assert.doesNotMatch(driver, /const publicProjectionAudit = await publicProjectionAudit/);
  assert.match(driver, /result\.media\.report\.embeddedImageCount >= 1/);
  assert.doesNotMatch(driver, /qualificationEligible:\s*true/);
});
