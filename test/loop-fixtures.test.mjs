#!/usr/bin/env node

import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');
const SCENARIOS_DIR = path.join(REPO_ROOT, 'acceptance/harness-loop/scenarios');
const BASELINE_PATH = path.join(REPO_ROOT, 'acceptance/harness-loop/baseline.json');
const METRICS_PATH = path.join(REPO_ROOT, 'acceptance/harness-loop/loop-baseline-metrics.json');

const VALID_SCENARIO_TYPES = ['normal', 'repairable', 'blocking'];
const VALID_DECISIONS = ['continue', 'complete', 'retry', 'block', 'wait'];
const VALID_LOOP_INTEGRITY = ['clean', 'blocked'];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

describe('SPT-1 TaskSpec Schema', () => {
  const taskSpecPath = path.join(SCENARIOS_DIR, 'spt1-task-spec.json');

  it('should exist', () => {
    assert.ok(fs.existsSync(taskSpecPath), 'spt1-task-spec.json should exist');
  });

  it('should have valid schemaVersion', () => {
    const taskSpec = readJson(taskSpecPath);
    assert.strictEqual(taskSpec.schemaVersion, 1);
  });

  it('should have correct taskSpecId and version', () => {
    const taskSpec = readJson(taskSpecPath);
    assert.strictEqual(taskSpec.taskSpecId, 'spt1-bulk-rnaseq');
    assert.strictEqual(taskSpec.version, 1);
  });

  it('should have sha256_placeholder hash', () => {
    const taskSpec = readJson(taskSpecPath);
    assert.strictEqual(taskSpec.hash, 'sha256_placeholder');
  });

  it('should have scientificGoal', () => {
    const taskSpec = readJson(taskSpecPath);
    assert.ok(typeof taskSpec.scientificGoal === 'string' && taskSpec.scientificGoal.length > 0);
  });

  it('should have originalRequest in Chinese', () => {
    const taskSpec = readJson(taskSpecPath);
    assert.ok(taskSpec.originalRequest);
    assert.ok(typeof taskSpec.originalRequest.text === 'string');
    assert.ok(taskSpec.originalRequest.text.includes('处理组'));
  });

  it('should have valid inputs with repo-relative paths', () => {
    const taskSpec = readJson(taskSpecPath);
    assert.ok(taskSpec.inputs);
    assert.ok(taskSpec.inputs.counts);
    assert.ok(taskSpec.inputs.metadata);
    assert.ok(!path.isAbsolute(taskSpec.inputs.counts.path));
    assert.ok(!path.isAbsolute(taskSpec.inputs.metadata.path));
    const countsFullPath = path.join(REPO_ROOT, taskSpec.inputs.counts.path);
    const metadataFullPath = path.join(REPO_ROOT, taskSpec.inputs.metadata.path);
    assert.ok(fs.existsSync(countsFullPath), `counts file should exist: ${countsFullPath}`);
    assert.ok(fs.existsSync(metadataFullPath), `metadata file should exist: ${metadataFullPath}`);
  });

  it('should have all automationModes', () => {
    const taskSpec = readJson(taskSpecPath);
    assert.ok(taskSpec.automationModes);
    assert.ok(taskSpec.automationModes.guided);
    assert.ok(taskSpec.automationModes.confirm);
    assert.ok(taskSpec.automationModes.trusted);
  });

  it('should have expectedDeliverables', () => {
    const taskSpec = readJson(taskSpecPath);
    assert.ok(Array.isArray(taskSpec.expectedDeliverables));
    assert.ok(taskSpec.expectedDeliverables.length > 0);
    assert.ok(taskSpec.expectedDeliverables.includes('deg_table'));
    assert.ok(taskSpec.expectedDeliverables.includes('volcano_plot'));
  });

  it('should have DAG with 7 nodes', () => {
    const taskSpec = readJson(taskSpecPath);
    assert.ok(taskSpec.dag);
    assert.ok(Array.isArray(taskSpec.dag.nodes));
    assert.strictEqual(taskSpec.dag.nodes.length, 7);
  });

  it('should have all DAG nodes with required fields', () => {
    const taskSpec = readJson(taskSpecPath);
    const nodeIds = new Set();
    for (const node of taskSpec.dag.nodes) {
      assert.ok(!nodeIds.has(node.nodeId), `Duplicate nodeId: ${node.nodeId}`);
      nodeIds.add(node.nodeId);
      assert.ok(node.nodeId);
      assert.ok(node.name);
      assert.ok(node.toolId);
      assert.ok(Array.isArray(node.dependsOn));
      assert.ok(typeof node.passPredicate === 'string');
      assert.ok(typeof node.failPredicate === 'string');
      assert.ok(Array.isArray(node.outputArtifacts));
    }
  });

  it('should have privacyNote', () => {
    const taskSpec = readJson(taskSpecPath);
    assert.strictEqual(taskSpec.privacyNote, 'uses_repository_demo_data_only');
  });

  it('should pass JSON round-trip', () => {
    const taskSpec = readJson(taskSpecPath);
    const roundTrip = JSON.parse(JSON.stringify(taskSpec));
    assert.deepStrictEqual(taskSpec, roundTrip);
  });
});

describe('spt1-normal.json Schema and Trajectory', () => {
  const scenarioPath = path.join(SCENARIOS_DIR, 'spt1-normal.json');

  it('should exist', () => {
    assert.ok(fs.existsSync(scenarioPath));
  });

  it('should have valid schema', () => {
    const scenario = readJson(scenarioPath);
    assert.strictEqual(scenario.schemaVersion, 1);
    assert.strictEqual(scenario.scenarioId, 'spt1-normal');
    assert.strictEqual(scenario.scenarioType, 'normal');
  });

  it('should have initialState with required fields', () => {
    const scenario = readJson(scenarioPath);
    assert.ok(scenario.initialState);
    assert.ok(scenario.initialState.projectId);
    assert.ok(scenario.initialState.conversationId);
    assert.strictEqual(scenario.initialState.dagStatus, 'planned');
  });

  it('should have complete trajectory with 8 iterations', () => {
    const scenario = readJson(scenarioPath);
    assert.ok(scenario.expectedTrajectory);
    assert.ok(Array.isArray(scenario.expectedTrajectory.iterations));
    assert.strictEqual(scenario.expectedTrajectory.iterations.length, 8);
  });

  it('should have all iterations with required fields', () => {
    const scenario = readJson(scenarioPath);
    let prevSeq = 0;
    for (const iter of scenario.expectedTrajectory.iterations) {
      assert.ok(typeof iter.sequence === 'number' && iter.sequence > prevSeq, `Invalid sequence: ${iter.sequence}`);
      prevSeq = iter.sequence;
      assert.ok(VALID_DECISIONS.includes(iter.decision), `Invalid decision: ${iter.decision}`);
      assert.ok(typeof iter.publicConclusion === 'string');
      assert.ok(typeof iter.observedStateDigest === 'string');
      assert.ok(typeof iter.decisionReasonCode === 'string');
      assert.ok(iter.proposedAction);
      assert.ok(typeof iter.proposedAction.type === 'string');
    }
  });

  it('should have last decision as complete', () => {
    const scenario = readJson(scenarioPath);
    const lastIter = scenario.expectedTrajectory.iterations[scenario.expectedTrajectory.iterations.length - 1];
    assert.strictEqual(lastIter.decision, 'complete');
    assert.strictEqual(lastIter.decisionReasonCode, 'ALL_NODES_VERIFIED');
  });

  it('should have expectedOutcomes with loopStatus=completed', () => {
    const scenario = readJson(scenarioPath);
    assert.ok(scenario.expectedOutcomes);
    assert.strictEqual(scenario.expectedOutcomes.loopStatus, 'completed');
    assert.strictEqual(scenario.expectedOutcomes.loopIntegrity, 'clean');
    assert.strictEqual(scenario.expectedOutcomes.deliveryComplete, true);
    assert.strictEqual(scenario.expectedOutcomes.replayPackageComplete, true);
    assert.strictEqual(scenario.expectedOutcomes.completedNodes, 7);
    assert.strictEqual(scenario.expectedOutcomes.failedNodes, 0);
  });

  it('should have failureInjection=null', () => {
    const scenario = readJson(scenarioPath);
    assert.strictEqual(scenario.failureInjection, null);
  });

  it('should have privacyNote', () => {
    const scenario = readJson(scenarioPath);
    assert.strictEqual(scenario.privacyNote, 'uses_repository_demo_data_only');
  });

  it('should pass JSON round-trip', () => {
    const scenario = readJson(scenarioPath);
    const roundTrip = JSON.parse(JSON.stringify(scenario));
    assert.deepStrictEqual(scenario, roundTrip);
  });
});

describe('spt1-repairable.json Schema and Repair Action', () => {
  const scenarioPath = path.join(SCENARIOS_DIR, 'spt1-repairable.json');

  it('should exist', () => {
    assert.ok(fs.existsSync(scenarioPath));
  });

  it('should have scenarioType=repairable', () => {
    const scenario = readJson(scenarioPath);
    assert.strictEqual(scenario.scenarioType, 'repairable');
  });

  it('should have complete trajectory with retry at deseq2', () => {
    const scenario = readJson(scenarioPath);
    assert.ok(Array.isArray(scenario.expectedTrajectory.iterations));
    const deseq2Retry = scenario.expectedTrajectory.iterations.find((i) => i.decision === 'retry');
    assert.ok(deseq2Retry, 'Should have a retry iteration for deseq2');
    assert.strictEqual(deseq2Retry.decisionReasonCode, 'TRANSIENT_RUNTIME_RETRY');
    const retrySuccess = scenario.expectedTrajectory.iterations.find((i) => i.decisionReasonCode === 'DESEQ2_REPAIRED');
    assert.ok(retrySuccess, 'Should have a DESEQ2_REPAIRED iteration');
  });

  it('should have totalRetryCount > 0', () => {
    const scenario = readJson(scenarioPath);
    assert.ok(scenario.expectedOutcomes.totalRetryCount > 0);
  });

  it('should have repairActions array', () => {
    const scenario = readJson(scenarioPath);
    assert.ok(Array.isArray(scenario.expectedOutcomes.repairActions));
    assert.ok(scenario.expectedOutcomes.repairActions.length > 0);
    const repair = scenario.expectedOutcomes.repairActions[0];
    assert.strictEqual(repair.success, true);
    assert.ok(typeof repair.strategyId === 'string');
  });

  it('should have failureInjection with transient_runtime', () => {
    const scenario = readJson(scenarioPath);
    assert.ok(scenario.failureInjection);
    assert.strictEqual(scenario.failureInjection.failureClass, 'transient_runtime');
    assert.strictEqual(scenario.failureInjection.expectedRepairStrategy, 'transient_runtime_retry');
    assert.strictEqual(scenario.failureInjection.expectedRepairOutcome, 'success_on_retry');
    assert.strictEqual(scenario.failureInjection.simulatedError?.recoverable, true);
  });

  it('should have loopStatus=completed', () => {
    const scenario = readJson(scenarioPath);
    assert.strictEqual(scenario.expectedOutcomes.loopStatus, 'completed');
    assert.strictEqual(scenario.expectedOutcomes.deliveryComplete, true);
  });

  it('should have privacyNote', () => {
    const scenario = readJson(scenarioPath);
    assert.strictEqual(scenario.privacyNote, 'uses_repository_demo_data_only');
  });

  it('should pass JSON round-trip', () => {
    const scenario = readJson(scenarioPath);
    const roundTrip = JSON.parse(JSON.stringify(scenario));
    assert.deepStrictEqual(scenario, roundTrip);
  });
});

describe('spt1-blocking.json Schema and Blocking Decision', () => {
  const scenarioPath = path.join(SCENARIOS_DIR, 'spt1-blocking.json');

  it('should exist', () => {
    assert.ok(fs.existsSync(scenarioPath));
  });

  it('should have scenarioType=blocking', () => {
    const scenario = readJson(scenarioPath);
    assert.strictEqual(scenario.scenarioType, 'blocking');
  });

  it('should block at sample-metadata-validator', () => {
    const scenario = readJson(scenarioPath);
    const blockIter = scenario.expectedTrajectory.iterations.find((i) => i.decision === 'block');
    assert.ok(blockIter, 'Should have a block iteration');
    assert.strictEqual(blockIter.decisionReasonCode, 'INPUT_FORMAT_MISMATCH');
    assert.ok(blockIter.publicConclusion.includes('metadata'));
  });

  it('should have wait iteration for user decision', () => {
    const scenario = readJson(scenarioPath);
    const waitIter = scenario.expectedTrajectory.iterations.find((i) => i.decision === 'wait');
    assert.ok(waitIter, 'Should have a wait iteration');
    assert.strictEqual(waitIter.decisionReasonCode, 'SCIENTIFIC_DESIGN_MISSING');
    assert.ok(waitIter.proposedAction.question);
  });

  it('should have loopStatus=waiting_for_user', () => {
    const scenario = readJson(scenarioPath);
    assert.strictEqual(scenario.expectedOutcomes.loopStatus, 'waiting_for_user');
  });

  it('should have loopIntegrity=blocked', () => {
    const scenario = readJson(scenarioPath);
    assert.strictEqual(scenario.expectedOutcomes.loopIntegrity, 'blocked');
  });

  it('should have deliveryComplete=false', () => {
    const scenario = readJson(scenarioPath);
    assert.strictEqual(scenario.expectedOutcomes.deliveryComplete, false);
  });

  it('should have userDecisionRequired=true', () => {
    const scenario = readJson(scenarioPath);
    assert.strictEqual(scenario.expectedOutcomes.userDecisionRequired, true);
  });

  it('should have scientificIntegrity=blocked_by_design_gap', () => {
    const scenario = readJson(scenarioPath);
    assert.strictEqual(scenario.expectedOutcomes.scientificIntegrity, 'blocked_by_design_gap');
  });

  it('should have failureInjection with userActionRequired', () => {
    const scenario = readJson(scenarioPath);
    assert.ok(scenario.failureInjection);
    assert.strictEqual(scenario.failureInjection.userActionRequired, true);
    assert.strictEqual(scenario.failureInjection.expectedRepairStrategy, null);
    assert.strictEqual(scenario.failureInjection.expectedRepairOutcome, 'cannot_repair_automatically');
  });

  it('should have privacyNote', () => {
    const scenario = readJson(scenarioPath);
    assert.strictEqual(scenario.privacyNote, 'uses_repository_demo_data_only');
  });

  it('should pass JSON round-trip', () => {
    const scenario = readJson(scenarioPath);
    const roundTrip = JSON.parse(JSON.stringify(scenario));
    assert.deepStrictEqual(scenario, roundTrip);
  });
});

describe('All Scenarios - Privacy and Integrity', () => {
  const scenarioFiles = ['spt1-normal.json', 'spt1-repairable.json', 'spt1-blocking.json'];

  for (const filename of scenarioFiles) {
    const scenarioPath = path.join(SCENARIOS_DIR, filename);

    it(`${filename}: privacyNote should be uses_repository_demo_data_only`, () => {
      const scenario = readJson(scenarioPath);
      assert.strictEqual(scenario.privacyNote, 'uses_repository_demo_data_only');
    });
  }

  for (const filename of scenarioFiles) {
    const scenarioPath = path.join(SCENARIOS_DIR, filename);

    it(`${filename}: loopIntegrity should be clean or blocked`, () => {
      const scenario = readJson(scenarioPath);
      assert.ok(VALID_LOOP_INTEGRITY.includes(scenario.expectedOutcomes.loopIntegrity));
    });
  }

  for (const filename of scenarioFiles) {
    const scenarioPath = path.join(SCENARIOS_DIR, filename);

    it(`${filename}: all iterations should have valid decisions`, () => {
      const scenario = readJson(scenarioPath);
      for (const iter of scenario.expectedTrajectory.iterations) {
        assert.ok(VALID_DECISIONS.includes(iter.decision), `Invalid decision ${iter.decision} in ${filename}`);
      }
    });
  }

  for (const filename of scenarioFiles) {
    const scenarioPath = path.join(SCENARIOS_DIR, filename);

    it(`${filename}: integrity metrics should be 0`, () => {
      const scenario = readJson(scenarioPath);
      assert.strictEqual(scenario.expectedOutcomes.repeatableActionCount, 0);
      assert.strictEqual(scenario.expectedOutcomes.oscillationCount, 0);
      assert.strictEqual(scenario.expectedOutcomes.noProgressCycles, 0);
    });
  }
});

describe('baseline.json and loop-baseline-metrics.json', () => {
  it('baseline.json should exist and be valid', () => {
    assert.ok(fs.existsSync(BASELINE_PATH));
    const baseline = readJson(BASELINE_PATH);
    assert.strictEqual(baseline.schemaVersion, 1);
    assert.strictEqual(baseline.phase, 'HLE-0');
    assert.strictEqual(baseline.status, 'baseline_established');
    assert.strictEqual(baseline.notProductAcceptance, true);
    assert.strictEqual(baseline.scenarioCount, 3);
    assert.ok(Array.isArray(baseline.evidenceFiles));
    assert.ok(baseline.evidenceFiles.length >= 5);
    assert.ok(Array.isArray(baseline.knownBaselineGaps));
    assert.ok(baseline.knownBaselineGaps.length >= 5);
  });

  it('baseline.json should pass JSON round-trip', () => {
    const baseline = readJson(BASELINE_PATH);
    const roundTrip = JSON.parse(JSON.stringify(baseline));
    assert.deepStrictEqual(baseline, roundTrip);
  });

  it('loop-baseline-metrics.json should exist and be valid', () => {
    assert.ok(fs.existsSync(METRICS_PATH));
    const metrics = readJson(METRICS_PATH);
    assert.strictEqual(metrics.schemaVersion, 1);
    assert.strictEqual(metrics.phase, 'HLE-0');
    assert.strictEqual(metrics.baselineVersion, 1);
    assert.ok(typeof metrics.capturedAt === 'string');
    assert.ok(metrics.metrics);
    assert.ok(metrics.metrics.targetCompletionRate);
    assert.ok(metrics.metrics.faultClassificationAccuracy);
    assert.ok(metrics.metrics.repairEffectiveness);
    assert.ok(metrics.metrics.userInterventionRate);
    assert.ok(metrics.scope);
    assert.strictEqual(metrics.scope.taskSpec, 'SPT-1 Bulk RNA-seq');
  });

  it('loop-baseline-metrics.json should pass JSON round-trip', () => {
    const metrics = readJson(METRICS_PATH);
    const roundTrip = JSON.parse(JSON.stringify(metrics));
    assert.deepStrictEqual(metrics, roundTrip);
  });

  it('baseline.json should reference all evidence files', () => {
    const baseline = readJson(BASELINE_PATH);
    for (const evidenceFile of baseline.evidenceFiles) {
      assert.ok(!path.isAbsolute(evidenceFile), `Evidence file should be relative: ${evidenceFile}`);
      const fullPath = path.join(REPO_ROOT, evidenceFile);
      assert.ok(fs.existsSync(fullPath), `Evidence file should exist: ${evidenceFile}`);
    }
  });
});

describe('All Files - No Sensitive Data', () => {
  const allFiles = [
    path.join(SCENARIOS_DIR, 'spt1-task-spec.json'),
    path.join(SCENARIOS_DIR, 'spt1-normal.json'),
    path.join(SCENARIOS_DIR, 'spt1-repairable.json'),
    path.join(SCENARIOS_DIR, 'spt1-blocking.json'),
    BASELINE_PATH,
    METRICS_PATH,
  ];

  for (const filePath of allFiles) {
    it(`${path.basename(filePath)}: should not contain sensitive patterns`, () => {
      const content = fs.readFileSync(filePath, 'utf8');
      assert.ok(!/(?:api[_-]?key|secret|token|password|credential|private[_-]?key)/i.test(content), `File contains sensitive pattern: ${filePath}`);
    });
  }

  for (const filePath of allFiles) {
    it(`${path.basename(filePath)}: should not contain absolute paths`, () => {
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.includes('"path"') || line.includes('"counts"') || line.includes('"metadata"')) {
          assert.ok(!line.match(/"\/[A-Za-z]/) || line.includes('/Users/') === false, `Line ${i + 1} contains absolute path: ${line.trim().substring(0, 80)}`);
        }
      }
    });
  }
});
