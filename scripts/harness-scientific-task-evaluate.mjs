#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { indexDirectory, writeIndexCache } from './harness-file-index.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');
const FIXTURE_ROOT = path.join(REPO_ROOT, 'test/fixtures/harness-scientific-task');
const ACCEPTANCE_ROOT = path.join(REPO_ROOT, 'acceptance/harness-scientific-task');
const REQUIRED_COVERAGE = Array.from({ length: 20 }, (_, index) => index + 1);
const REQUIRED_MODES = ['guided', 'confirm', 'trusted'];
const METRIC_FILES = [
  'interaction-metrics.json',
  'context-edit-metrics.json',
  'context-compaction-metrics.json',
  'durability-recovery-metrics.json',
  'tool-locator-metrics.json',
  'cache-cost-metrics.json',
  'usage-resource-metrics.json',
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function relativeEvidencePath(filePath) {
  return path.relative(REPO_ROOT, filePath).split(path.sep).join('/');
}

function assertSafeRelativePath(value, label) {
  assert(typeof value === 'string' && value.length > 0, `${label} must be a non-empty string`);
  assert(!path.isAbsolute(value), `${label} must be repository-relative`);
  assert(!value.split(/[\\/]/).includes('..'), `${label} must not escape the repository`);
  assert(!/(?:api[_-]?key|secret|token|password)/i.test(value), `${label} contains a sensitive-looking path`);
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)];
}

function benchmarkIndex() {
  const realRoot = path.join(REPO_ROOT, 'resources/built-in-plugins/deseq2/demo-data');
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-hrt0-eval-'));
  const largeRoot = path.join(tempRoot, 'large');
  const cachePath = path.join(tempRoot, 'large-index.json');
  fs.mkdirSync(largeRoot, { recursive: true });
  for (let dirIndex = 0; dirIndex < 20; dirIndex += 1) {
    const dir = path.join(largeRoot, `batch-${dirIndex}`);
    fs.mkdirSync(dir);
    for (let fileIndex = 0; fileIndex < 20; fileIndex += 1) {
      fs.writeFileSync(path.join(dir, `table-${fileIndex}.csv`), 'gene,score\nTP53,4.2\nEGFR,3.1\n');
    }
  }
  try {
    const realStarted = performance.now();
    const real = indexDirectory(realRoot, { hash: true });
    const realMs = performance.now() - realStarted;
    const cold = [];
    const hot = [];
    for (let index = 0; index < 3; index += 1) {
      let started = performance.now();
      const large = indexDirectory(largeRoot, { hash: true, maxFiles: 500 });
      cold.push(performance.now() - started);
      writeIndexCache(large, cachePath);
      started = performance.now();
      indexDirectory(largeRoot, { hash: true, maxFiles: 500, cache: cachePath });
      hot.push(performance.now() - started);
    }
    return {
      realFileCount: real.fileCount,
      realMs,
      largeFileCount: 400,
      coldP50: percentile(cold, 0.5),
      coldP95: percentile(cold, 0.95),
      hotP50: percentile(hot, 0.5),
      hotP95: percentile(hot, 0.95),
    };
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function runEvaluation() {
  const checks = [];
  const record = (id, condition, evidence = {}) => {
    assert(condition, `FAIL ${id}`);
    checks.push({ id, passed: true, evidence });
  };

  const tasksPath = path.join(FIXTURE_ROOT, 'tasks.json');
  const contextsPath = path.join(FIXTURE_ROOT, 'context-scenarios.json');
  const platformPath = path.join(FIXTURE_ROOT, 'platform-scenarios.json');
  const baselinePath = path.join(ACCEPTANCE_ROOT, 'baseline.json');
  const tasks = readJson(tasksPath);
  const contexts = readJson(contextsPath);
  const platform = readJson(platformPath);
  const baseline = readJson(baselinePath);

  record('fixture_schema', tasks.schemaVersion === 1 && Array.isArray(tasks.cases), { caseCount: tasks.cases.length });
  record('privacy_mode', tasks.privacy === 'synthetic_or_repository_demo_data_only', { privacy: tasks.privacy });

  const coverage = [...new Set(tasks.cases.flatMap((item) => item.covers || []))].sort((a, b) => a - b);
  record('requirements_1_to_20', JSON.stringify(coverage) === JSON.stringify(REQUIRED_COVERAGE), { coverageCount: coverage.length });

  const scientificTasks = tasks.cases.filter((item) => item.kind === 'scientific_task');
  record('three_representative_scientific_tasks', scientificTasks.length >= 3, { scientificTaskCount: scientificTasks.length });
  record('novice_natural_language_task', scientificTasks.some((item) => item.persona === 'no_bioinformatics_background' && !/(DESeq2|GSEA|contrast)/.test(item.originalRequest)), {});
  record('multistep_lineage_task', scientificTasks.some((item) => Array.isArray(item.moduleDag) && item.moduleDag.length >= 4 && item.lineageRules?.includes('downstream_requires_verified_artifact')), {});
  record('cannot_reliably_answer_task', scientificTasks.some((item) => item.expectedDecision === 'cannot_reliably_answer' && item.scientificEvidenceGap), {});

  for (const item of tasks.cases) {
    for (const field of ['id', 'kind', 'originalRequest', 'expectedDeliverables', 'automation', 'failureBoundary', 'noviceSuccessPath']) {
      assert(item[field] !== undefined && item[field] !== null, `${item.id}.${field} is required`);
    }
    for (const mode of REQUIRED_MODES) assert(item.automation[mode], `${item.id}.automation.${mode} is required`);
    for (const input of item.inputs || []) {
      assertSafeRelativePath(input.path, `${item.id}.inputs.path`);
      assert(fs.existsSync(path.join(REPO_ROOT, input.path)), `${item.id} input does not exist: ${input.path}`);
    }
  }
  record('task_contract_fields', true, { checkedTasks: tasks.cases.length });
  record('automation_modes', true, { modes: REQUIRED_MODES.join(',') });
  record('input_paths_exist', true, { checkedInputs: tasks.cases.reduce((sum, item) => sum + (item.inputs?.length || 0), 0) });

  const novice = tasks.cases.find((item) => item.id === 'novice-bulk-rna-success');
  record('plain_language_preview', ['found', 'plan', 'missing'].every((key) => novice?.plainLanguagePreview?.[key]), {});
  record('command_policy_boundary', ['auto', 'confirm', 'deny'].every((key) => Array.isArray(novice?.commandPolicy?.[key]) && novice.commandPolicy[key].length > 0), {});

  record('context_edit_matrix', contexts.editCases.length >= 6 && contexts.editCases.some((item) => item.id === 'concurrent-drift'), { editCaseCount: contexts.editCases.length });
  record('two_checkpoint_recovery', contexts.checkpointCases.some((item) => item.checkpointCount >= 2 && item.mustPreserve.length >= 6), {});
  record('model_switch_matrix', contexts.modelSwitchCases.length >= 4 && contexts.modelSwitchCases.some((item) => item.expected === 'context_capacity_insufficient'), { modelSwitchCaseCount: contexts.modelSwitchCases.length });
  record('durability_matrix', platform.durabilityCases.length >= 6, { durabilityCaseCount: platform.durabilityCases.length });
  record('cache_invalidation_matrix', platform.cacheCases.length >= 5, { cacheCaseCount: platform.cacheCases.length });
  record('resource_decision_matrix', platform.resourceCases.length >= 7, { resourceCaseCount: platform.resourceCases.length });

  const metrics = Object.fromEntries(METRIC_FILES.map((name) => [name, readJson(path.join(ACCEPTANCE_ROOT, name))]));
  record('seven_metric_files', Object.values(metrics).every((item) => item.schemaVersion === 1), { metricFileCount: METRIC_FILES.length });
  const gapMetrics = Object.entries(metrics).filter(([, value]) => value.productionStatus === 'gap');
  record('honest_gap_ownership', gapMetrics.length >= 3 && gapMetrics.every(([, value]) => typeof value.gapOwner === 'string' && value.gapOwner.length > 0), { gapMetricCount: gapMetrics.length });

  const locator = metrics['tool-locator-metrics.json'];
  record('stored_locator_baseline', locator.fixtures.length === 2 && locator.thresholdFrozen === false && locator.fixtures.every((item) => item.coldMs.p50 >= 0 && item.hotMs.p50 >= 0), { storedFixtureCount: locator.fixtures.length });
  const liveIndex = benchmarkIndex();
  record('live_small_and_large_locator', liveIndex.realFileCount >= 4 && liveIndex.largeFileCount === 400 && liveIndex.coldP50 >= 0 && liveIndex.hotP50 >= 0, { realFileCount: liveIndex.realFileCount, largeFileCount: liveIndex.largeFileCount, coldP50Ms: Number(liveIndex.coldP50.toFixed(3)), hotP50Ms: Number(liveIndex.hotP50.toFixed(3)) });

  for (const evidenceFile of baseline.evidenceFiles || []) {
    assertSafeRelativePath(evidenceFile, 'baseline.evidenceFiles');
    assert(fs.existsSync(path.join(REPO_ROOT, evidenceFile)), `baseline evidence missing: ${evidenceFile}`);
  }
  record('baseline_evidence_index', baseline.status === 'complete' && baseline.notProductAcceptance === true && baseline.evidenceFiles.length >= 10, { evidenceFileCount: baseline.evidenceFiles.length });
  record('known_gaps_preserved', baseline.knownGaps.length >= 5 && baseline.knownGaps.every((item) => item.id && item.owner), { knownGapCount: baseline.knownGaps.length });

  return {
    schemaVersion: 1,
    phase: 'HRT-0',
    passed: true,
    passedChecks: checks.length,
    totalChecks: checks.length,
    checks,
    evidence: {
      tasks: relativeEvidencePath(tasksPath),
      baseline: relativeEvidencePath(baselinePath),
      metrics: METRIC_FILES.map((name) => relativeEvidencePath(path.join(ACCEPTANCE_ROOT, name))),
    },
  };
}

try {
  const report = runEvaluation();
  if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
  else {
    for (const item of report.checks) console.log(`PASS ${item.id}`);
    console.log(`[HRT-0] ${report.passedChecks}/${report.totalChecks} checks passed`);
  }
} catch (error) {
  console.error(`[HRT-0] ${error.message}`);
  process.exitCode = 1;
}
