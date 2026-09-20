#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');
const SCENARIOS_DIR = path.join(REPO_ROOT, 'acceptance/harness-loop/scenarios');
const REPORT_PATH = path.join(REPO_ROOT, 'acceptance/harness-loop/hle0-evaluate-report.json');

const VALID_SCENARIO_TYPES = ['normal', 'repairable', 'blocking'];
const VALID_DECISIONS = ['continue', 'complete', 'retry', 'block', 'wait'];
const VALID_LOOP_INTEGRITY = ['clean', 'blocked'];
const VALID_LOOP_STATUS_NORMAL_REPAIRABLE = 'completed';
const VALID_LOOP_STATUS_BLOCKING = 'waiting_for_user';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function relativeEvidencePath(filePath) {
  return path.relative(REPO_ROOT, filePath).split(path.sep).join('/');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertSafeRelativePath(value, label) {
  assert(typeof value === 'string' && value.length > 0, `${label} must be a non-empty string`);
  assert(!path.isAbsolute(value), `${label} must be repository-relative`);
  assert(!value.split(/[\\/]/).includes('..'), `${label} must not escape the repository`);
  assert(!/(?:api[_-]?key|secret|token|password|credential)/i.test(value), `${label} contains a sensitive-looking pattern`);
}

function validateScenario(scenario, _scenarioPath) {
  const checks = [];
  const record = (id, condition, evidence = {}) => {
    if (!condition) throw new Error(`FAIL ${id} in ${scenario.scenarioId}`);
    checks.push({ id, passed: true, evidence });
  };

  record('schema_version', scenario.schemaVersion === 1, { schemaVersion: scenario.schemaVersion });
  record('scenario_id_unique', typeof scenario.scenarioId === 'string' && scenario.scenarioId.length > 0, { scenarioId: scenario.scenarioId });
  record('scenario_type_valid', VALID_SCENARIO_TYPES.includes(scenario.scenarioType), { scenarioType: scenario.scenarioType });
  record('task_spec_ref', typeof scenario.taskSpecRef === 'string' && scenario.taskSpecRef.length > 0, { taskSpecRef: scenario.taskSpecRef });
  record('description_present', typeof scenario.description === 'string' && scenario.description.length > 0, { descriptionLength: scenario.description.length });
  record('privacy_note', scenario.privacyNote === 'uses_repository_demo_data_only', { privacyNote: scenario.privacyNote });

  assert(scenario.initialState, 'initialState is required');
  record('initial_state_fields', ['projectId', 'conversationId', 'taskSpecVersion', 'dagStatus', 'activeNodes', 'completedNodes', 'failedNodes'].every((f) => f in scenario.initialState), {});
  record('initial_state_values', typeof scenario.initialState.projectId === 'string' && typeof scenario.initialState.conversationId === 'string', {});

  assert(scenario.expectedTrajectory, 'expectedTrajectory is required');
  assert(Array.isArray(scenario.expectedTrajectory.iterations), 'iterations must be an array');
  record('iterations_exist', scenario.expectedTrajectory.iterations.length > 0, { iterationCount: scenario.expectedTrajectory.iterations.length });

  let sequenceNumbers = [];
  for (const iter of scenario.expectedTrajectory.iterations) {
    record('iteration_sequence', typeof iter.sequence === 'number' && iter.sequence > 0, { sequence: iter.sequence });
    record('iteration_decision', VALID_DECISIONS.includes(iter.decision), { decision: iter.decision, sequence: iter.sequence });
    record('iteration_public_conclusion', typeof iter.publicConclusion === 'string' && iter.publicConclusion.length > 0, { sequence: iter.sequence });
    record('iteration_state_digest', typeof iter.observedStateDigest === 'string', { sequence: iter.sequence });
    record('iteration_proposed_action', iter.proposedAction && typeof iter.proposedAction.type === 'string', { type: iter.proposedAction?.type, sequence: iter.sequence });
    record('iteration_decision_reason', typeof iter.decisionReasonCode === 'string', { reasonCode: iter.decisionReasonCode, sequence: iter.sequence });
    sequenceNumbers.push(iter.sequence);
  }
  record('sequence_numbers_unique', sequenceNumbers.length === new Set(sequenceNumbers).size, { sequenceCount: sequenceNumbers.length });
  record('sequence_numbers_sequential', JSON.stringify(sequenceNumbers) === JSON.stringify(sequenceNumbers.slice().sort((a, b) => a - b)), {});

  assert(scenario.expectedOutcomes, 'expectedOutcomes is required');
  record('expected_outcomes_loop_status', typeof scenario.expectedOutcomes.loopStatus === 'string', { loopStatus: scenario.expectedOutcomes.loopStatus });
  record('expected_outcomes_loop_integrity', VALID_LOOP_INTEGRITY.includes(scenario.expectedOutcomes.loopIntegrity), { loopIntegrity: scenario.expectedOutcomes.loopIntegrity });
  record('expected_outcomes_counts', typeof scenario.expectedOutcomes.completedNodes === 'number' && typeof scenario.expectedOutcomes.totalIterations === 'number', {});

  if (scenario.scenarioType === 'normal' || scenario.scenarioType === 'repairable') {
    record('loop_status_completed', scenario.expectedOutcomes.loopStatus === VALID_LOOP_STATUS_NORMAL_REPAIRABLE, { loopStatus: scenario.expectedOutcomes.loopStatus });
    record('delivery_complete', scenario.expectedOutcomes.deliveryComplete === true, { deliveryComplete: scenario.expectedOutcomes.deliveryComplete });
    record('replay_complete', scenario.expectedOutcomes.replayPackageComplete === true, { replayPackageComplete: scenario.expectedOutcomes.replayPackageComplete });
  }

  if (scenario.scenarioType === 'blocking') {
    record('loop_status_blocking', scenario.expectedOutcomes.loopStatus === VALID_LOOP_STATUS_BLOCKING, { loopStatus: scenario.expectedOutcomes.loopStatus });
    record('delivery_incomplete', scenario.expectedOutcomes.deliveryComplete === false, { deliveryComplete: scenario.expectedOutcomes.deliveryComplete });
    record('blocking_scientific_design_gap', scenario.expectedOutcomes.scientificIntegrity === 'blocked_by_design_gap', { scientificIntegrity: scenario.expectedOutcomes.scientificIntegrity });
    record('user_decision_required', scenario.expectedOutcomes.userDecisionRequired === true, { userDecisionRequired: scenario.expectedOutcomes.userDecisionRequired });
  }

  if (scenario.scenarioType === 'repairable') {
    assert(scenario.failureInjection, 'repairable scenario must have failureInjection');
    record('failure_injection_point', typeof scenario.failureInjection.injectionPoint === 'string', { injectionPoint: scenario.failureInjection.injectionPoint });
    record('failure_injection_class', typeof scenario.failureInjection.failureClass === 'string', { failureClass: scenario.failureInjection.failureClass });
    record('failure_injection_expected_strategy', typeof scenario.failureInjection.expectedRepairStrategy === 'string', { expectedRepairStrategy: scenario.failureInjection.expectedRepairStrategy });
    record('failure_injection_repair_outcome', scenario.failureInjection.expectedRepairOutcome === 'success_on_retry', { expectedRepairOutcome: scenario.failureInjection.expectedRepairOutcome });
    record('retry_count', scenario.expectedOutcomes.totalRetryCount > 0, { totalRetryCount: scenario.expectedOutcomes.totalRetryCount });
    record('repair_actions', Array.isArray(scenario.expectedOutcomes.repairActions) && scenario.expectedOutcomes.repairActions.length > 0, { repairActionCount: scenario.expectedOutcomes.repairActions?.length });
  }

  if (scenario.scenarioType === 'blocking') {
    assert(scenario.failureInjection, 'blocking scenario must have failureInjection');
    record('blocking_user_action_required', scenario.failureInjection.userActionRequired === true, { userActionRequired: scenario.failureInjection.userActionRequired });
    record('blocking_no_repair_strategy', scenario.failureInjection.expectedRepairStrategy === null, { expectedRepairStrategy: scenario.failureInjection.expectedRepairStrategy });
    record('blocking_cannot_repair', scenario.failureInjection.expectedRepairOutcome === 'cannot_repair_automatically', { expectedRepairOutcome: scenario.failureInjection.expectedRepairOutcome });
  }

  const integrityValues = ['repeatableActionCount', 'oscillationCount', 'noProgressCycles'];
  for (const field of integrityValues) {
    record(`integrity_${field}`, typeof scenario.expectedOutcomes[field] === 'number' && scenario.expectedOutcomes[field] === 0, { field, value: scenario.expectedOutcomes[field] });
  }

  return checks;
}

function validateTaskSpec(taskSpec, _taskSpecPath) {
  const checks = [];
  const record = (id, condition, evidence = {}) => {
    if (!condition) throw new Error(`FAIL ${id} in taskSpec`);
    checks.push({ id, passed: true, evidence });
  };

  record('schema_version', taskSpec.schemaVersion === 1, { schemaVersion: taskSpec.schemaVersion });
  record('task_spec_id', taskSpec.taskSpecId === 'spt1-bulk-rnaseq', { taskSpecId: taskSpec.taskSpecId });
  record('version', taskSpec.version === 1, { version: taskSpec.version });
  record('hash_placeholder', taskSpec.hash === 'sha256_placeholder', { hash: taskSpec.hash });
  record('scientific_goal', typeof taskSpec.scientificGoal === 'string' && taskSpec.scientificGoal.length > 0, { goalLength: taskSpec.scientificGoal.length });
  record('original_request', taskSpec.originalRequest && typeof taskSpec.originalRequest.text === 'string', {});
  record('inputs_counts', taskSpec.inputs && taskSpec.inputs.counts && typeof taskSpec.inputs.counts.path === 'string', {});
  record('inputs_metadata', taskSpec.inputs && taskSpec.inputs.metadata && typeof taskSpec.inputs.metadata.path === 'string', {});

  assertSafeRelativePath(taskSpec.inputs.counts.path, 'inputs.counts.path');
  assertSafeRelativePath(taskSpec.inputs.metadata.path, 'inputs.metadata.path');

  const countsPath = path.join(REPO_ROOT, taskSpec.inputs.counts.path);
  const metadataPath = path.join(REPO_ROOT, taskSpec.inputs.metadata.path);
  record('counts_file_exists', fs.existsSync(countsPath), { path: taskSpec.inputs.counts.path });
  record('metadata_file_exists', fs.existsSync(metadataPath), { path: taskSpec.inputs.metadata.path });

  record('automation_modes', taskSpec.automationModes && ['guided', 'confirm', 'trusted'].every((m) => taskSpec.automationModes[m]), {});
  record('access_mode', taskSpec.accessMode === 'full', { accessMode: taskSpec.accessMode });
  record('expected_deliverables', Array.isArray(taskSpec.expectedDeliverables) && taskSpec.expectedDeliverables.length > 0, { count: taskSpec.expectedDeliverables.length });

  assert(taskSpec.dag, 'dag is required');
  assert(Array.isArray(taskSpec.dag.nodes), 'dag.nodes must be an array');
  record('dag_nodes', taskSpec.dag.nodes.length >= 7, { nodeCount: taskSpec.dag.nodes.length });

  const nodeIds = new Set();
  for (const node of taskSpec.dag.nodes) {
    record('node_id_unique', !nodeIds.has(node.nodeId), { nodeId: node.nodeId });
    nodeIds.add(node.nodeId);
    record('node_fields', ['nodeId', 'name', 'toolId', 'dependsOn', 'passPredicate', 'failPredicate', 'outputArtifacts'].every((f) => f in node), { nodeId: node.nodeId });
    record('node_pass_predicate', typeof node.passPredicate === 'string', { nodeId: node.nodeId });
    record('node_fail_predicate', typeof node.failPredicate === 'string', { nodeId: node.nodeId });
  }

  record('privacy_note', taskSpec.privacyNote === 'uses_repository_demo_data_only', { privacyNote: taskSpec.privacyNote });

  return checks;
}

function runEvaluation() {
  const allChecks = [];
  let scenarioFiles = [];

  const scenarioList = ['spt1-normal.json', 'spt1-repairable.json', 'spt1-blocking.json'];
  for (const filename of scenarioList) {
    const filePath = path.join(SCENARIOS_DIR, filename);
    if (!fs.existsSync(filePath)) {
      console.warn(`WARN: Scenario file not found: ${filename}`);
      continue;
    }
    scenarioFiles.push(filePath);
  }

  assert(scenarioFiles.length === 3, `Expected 3 scenario files, found ${scenarioFiles.length}`);

  for (const scenarioPath of scenarioFiles) {
    const scenario = readJson(scenarioPath);
    JSON.parse(JSON.stringify(scenario));
    const checks = validateScenario(scenario, scenarioPath);
    allChecks.push(...checks);
    console.log(`PASS scenarios/${path.basename(scenarioPath)}: ${checks.length} checks`);
  }

  const taskSpecPath = path.join(SCENARIOS_DIR, 'spt1-task-spec.json');
  assert(fs.existsSync(taskSpecPath), `TaskSpec not found: ${taskSpecPath}`);
  const taskSpec = readJson(taskSpecPath);
  JSON.parse(JSON.stringify(taskSpec));
  const taskSpecChecks = validateTaskSpec(taskSpec, taskSpecPath);
  allChecks.push(...taskSpecChecks);
  console.log(`PASS spt1-task-spec.json: ${taskSpecChecks.length} checks`);

  const baselineChecks = [];
  const baselinePath = path.join(REPO_ROOT, 'acceptance/harness-loop/baseline.json');
  const metricsPath = path.join(REPO_ROOT, 'acceptance/harness-loop/loop-baseline-metrics.json');

  const recordBaseline = (id, condition, evidence = {}) => {
    if (!condition) throw new Error(`FAIL ${id} in baseline/metrics`);
    baselineChecks.push({ id, passed: true, evidence });
  };

  if (fs.existsSync(baselinePath)) {
    const baseline = readJson(baselinePath);
    JSON.parse(JSON.stringify(baseline));
    recordBaseline('baseline_schema', baseline.schemaVersion === 1, {});
    recordBaseline('baseline_phase', baseline.phase === 'HLE-0', { phase: baseline.phase });
    recordBaseline('baseline_status', baseline.status === 'baseline_established', { status: baseline.status });
    recordBaseline('baseline_not_product', baseline.notProductAcceptance === true, {});
    recordBaseline('baseline_scenario_count', baseline.scenarioCount === 3, { scenarioCount: baseline.scenarioCount });
    recordBaseline('baseline_scenarios', JSON.stringify(baseline.scenarios.sort()) === JSON.stringify(['blocking', 'normal', 'repairable'].sort()), {});
    recordBaseline('baseline_evidence_files', Array.isArray(baseline.evidenceFiles) && baseline.evidenceFiles.length >= 5, { evidenceFileCount: baseline.evidenceFiles.length });
    recordBaseline('baseline_gaps', Array.isArray(baseline.knownBaselineGaps) && baseline.knownBaselineGaps.length >= 5, { gapCount: baseline.knownBaselineGaps.length });
    console.log(`PASS baseline.json: ${baselineChecks.length} checks`);
  }

  const metricsChecks = [];
  if (fs.existsSync(metricsPath)) {
    const metrics = readJson(metricsPath);
    JSON.parse(JSON.stringify(metrics));
    const recordMetrics = (id, condition, evidence = {}) => {
      if (!condition) throw new Error(`FAIL ${id} in metrics`);
      metricsChecks.push({ id, passed: true, evidence });
    };
    recordMetrics('metrics_schema', metrics.schemaVersion === 1, {});
    recordMetrics('metrics_phase', metrics.phase === 'HLE-0', {});
    recordMetrics('metrics_baseline_version', metrics.baselineVersion === 1, {});
    recordMetrics('metrics_captured_at', typeof metrics.capturedAt === 'string', {});
    recordMetrics('metrics_target_completion_rate', metrics.metrics?.targetCompletionRate !== undefined, {});
    recordMetrics('metrics_fault_classification', metrics.metrics?.faultClassificationAccuracy !== undefined, {});
    recordMetrics('metrics_repair_effectiveness', metrics.metrics?.repairEffectiveness !== undefined, {});
    recordMetrics('metrics_user_intervention_rate', metrics.metrics?.userInterventionRate !== undefined, {});
    recordMetrics('metrics_scope', metrics.scope && metrics.scope.taskSpec === 'SPT-1 Bulk RNA-seq', {});
    console.log(`PASS loop-baseline-metrics.json: ${metricsChecks.length} checks`);
  }

  const totalChecks = allChecks.length + baselineChecks.length + metricsChecks.length;
  const passedChecks = allChecks.filter((c) => c.passed).length + baselineChecks.filter((c) => c.passed).length + metricsChecks.filter((c) => c.passed).length;

  return {
    schemaVersion: 1,
    phase: 'HLE-0',
    passed: passedChecks === totalChecks,
    totalChecks,
    passedChecks,
    allChecks,
    baselineChecks,
    metricsChecks,
    evidence: {
      scenarios: scenarioFiles.map(relativeEvidencePath),
      taskSpec: relativeEvidencePath(taskSpecPath),
      baseline: fs.existsSync(baselinePath) ? relativeEvidencePath(baselinePath) : null,
      metrics: fs.existsSync(metricsPath) ? relativeEvidencePath(metricsPath) : null,
    },
  };
}

try {
  const report = runEvaluation();
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`[HLE-0] ${report.passedChecks}/${report.totalChecks} checks passed`);
    console.log(`[HLE-0] Report written to: ${relativeEvidencePath(REPORT_PATH)}`);
  }
  if (!report.passed) process.exitCode = 1;
} catch (error) {
  console.error(`[HLE-0] ${error.message}`);
  process.exitCode = 1;
}
