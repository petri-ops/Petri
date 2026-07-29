import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const replayPackage = require('../core/shared-backend/scientific-replay-package');
const { sourceMessageDigest } = require('../core/shared-backend/scientific-task-spec');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function fixture() {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-hrt6-'));
  const jobRoot = path.join(projectRoot, 'results', 'jobs', 'job_1');
  const outputDir = path.join(jobRoot, 'output');
  fs.mkdirSync(outputDir, { recursive: true });
  const inputPath = path.join(projectRoot, 'fixture-source', 'counts.csv');
  fs.mkdirSync(path.dirname(inputPath), { recursive: true });
  fs.writeFileSync(inputPath, 'gene,S1,S2\nA,1,2\n');
  const scriptPath = path.join(jobRoot, 'run-script.R');
  fs.writeFileSync(scriptPath, 'args <- commandArgs(trailingOnly=TRUE)\n');
  const tablePath = path.join(outputDir, 'result.csv');
  const plotPath = path.join(outputDir, 'plot.png');
  fs.writeFileSync(tablePath, 'gene,value\nA,3\n');
  fs.writeFileSync(plotPath, 'png-fixture');
  const inputHash = replayPackage.hashFile(inputPath);
  const scriptHash = replayPackage.hashFile(scriptPath);
  const tableHash = replayPackage.hashFile(tablePath);
  const plotHash = replayPackage.hashFile(plotPath);
  const provenance = {
    executionProvenanceVersion: 1,
    provenanceHash: 'a'.repeat(64),
    toolJobId: 'job_1',
    projectId: 'project_1',
    plugin: { id: 'fixture-tool', version: '1.0.0', language: 'r', manifestFingerprint: 'plugin-fp' },
    runtime: { name: 'R', command: '/opt/R/bin/Rscript', version: '4.4.0', readiness: true },
    params: { normalized: { counts: inputPath, threshold: 1 }, sha256: 'b'.repeat(64) },
    inputs: [{ role: 'counts', relativePath: 'data/counts.csv', sha256: inputHash, sizeBytes: fs.statSync(inputPath).size }],
    script: { snapshotPath: scriptPath, sha256: scriptHash, entryPoint: 'scripts/run.R' },
    command: { executable: '/opt/R/bin/Rscript', args: [scriptPath, jobRoot], cwd: jobRoot },
    artifacts: [
      { id: 'result_table', filename: 'result.csv', type: 'table', sha256: tableHash, reproductionTarget: 'result_table' },
      { id: 'result_plot', filename: 'plot.png', type: 'plot', sha256: plotHash, reproductionTarget: 'result_plot' },
    ],
  };
  const deliveryManifest = {
    deliveryManifestVersion: 1,
    status: 'valid',
    manifestHash: 'c'.repeat(64),
    artifacts: [
      { id: 'result_table', type: 'table', label: 'Result table', relativePath: 'results/jobs/job_1/output/result.csv', sizeBytes: fs.statSync(tablePath).size, sha256: tableHash, reproducibility: { status: 'available', scriptPath, scriptSha256: scriptHash } },
      { id: 'result_plot', type: 'plot', label: 'Result plot', relativePath: 'results/jobs/job_1/output/plot.png', sizeBytes: fs.statSync(plotPath).size, sha256: plotHash, reproducibility: { status: 'available', scriptPath, scriptSha256: scriptHash } },
    ],
  };
  const taskRecord = {
    task_id: 'task_1', version: 1, project_id: 'project_1', conversation_id: 'conversation_1',
    spec_hash: 'd'.repeat(64),
    spec: {
      schemaVersion: 1,
      taskId: 'task_1',
      projectId: 'project_1',
      conversationId: 'conversation_1',
      originalRequest: 'Create a fixture table and plot',
      inputs: [{ role: 'counts', relativePath: 'data/counts.csv', sha256: inputHash, sizeBytes: fs.statSync(inputPath).size }],
      method: { category: 'fixture' },
      requestedDeliverables: ['result_table', 'result_plot'],
      execution: { accessMode: 'full', automationMode: 'confirm' },
      status: 'confirmed',
    },
  };
  const job = {
    id: 'job_1', tool_id: 'fixture-tool', project_id: 'project_1', status: 'completed',
    created_at: 1, completed_at: 2,
    params_json: JSON.stringify({ counts: inputPath, threshold: 1, apiKey: 'sk-' + 'x'.repeat(24) }),
    result_json: JSON.stringify({
      artifactSchemaVersion: 1,
      artifactTruth: { status: 'valid', blocking: false },
      artifacts: [
        { id: 'result_table', name: 'result.csv', path: tablePath, size: fs.statSync(tablePath).size },
        { id: 'result_plot', name: 'plot.png', path: plotPath, size: fs.statSync(plotPath).size },
      ],
      executionProvenance: provenance,
      deliveryManifest,
    }),
  };
  const messages = [
    { id: 'msg_1', role: 'user', content: 'Run fixture task' },
    { id: 'msg_2', role: 'assistant', content: 'Confirmed' },
  ];
  const contextCheckpoint = {
    schemaVersion: 1,
    checkpointId: 'ctxcp_1',
    projectId: 'project_1',
    conversationId: 'conversation_1',
    sourceMessageRange: { firstId: 'msg_1', lastId: 'msg_2', count: 2 },
    sourceDigest: sourceMessageDigest(messages),
    policyVersion: 1,
    generatedBy: { mode: 'deterministic', modelProfileId: null, rulesVersion: 1 },
    summary: 'Fixture task confirmed',
    taskRefs: ['task_1@1'],
    confirmedDecisions: [{ field: 'method', value: 'fixture' }],
    rejectedOptions: [], unresolvedDecisions: [], constraints: [], evidenceRefs: [], toolTraceRefs: [],
    jobRefs: ['job_1'], artifactRefs: ['result_table', 'result_plot'], editManifestRefs: [], supersedes: null,
    coverage: { requiredFieldsPresent: true, missing: [] },
    createdAt: '2026-07-22T00:00:00.000Z',
  };
  return { projectRoot, packageDir: path.join(outputDir, 'replay-package'), inputPath, tablePath, plotPath, taskRecord, job, contextCheckpoint, provenance };
}

test('HRT-6 exports a complete portable package with one replay entry per artifact', () => {
  const f = fixture();
  const built = replayPackage.buildScientificReplayPackage({
    taskRecord: f.taskRecord,
    job: f.job,
    projectRoot: f.projectRoot,
    packageDir: f.packageDir,
    contextCheckpoint: f.contextCheckpoint,
    includeFixtureInputs: true,
    inputSources: { counts: f.inputPath },
    privacyMode: 'repository_demo_data_only',
    workflowPlan: { steps: [{ id: 'step-1' }], apiKey: 'sk-test-secret' },
  });
  assert.equal(built.packageManifest.status, 'complete');
  assert.equal(built.replay.artifacts.length, 2);
  assert.ok(fs.existsSync(path.join(f.packageDir, 'repro', 'artifacts', 'result_table.json')));
  assert.ok(fs.existsSync(path.join(f.packageDir, 'repro', 'artifacts', 'result_plot.json')));
  assert.equal(replayPackage.validateScientificReplayPackage(f.packageDir).ok, true);
  const exported = fs.readFileSync(path.join(f.packageDir, 'params.json'), 'utf8');
  const exportedWorkflow = fs.readFileSync(path.join(f.packageDir, 'workflow-plan.json'), 'utf8');
  assert.ok(!exported.includes('sk-'));
  assert.ok(!exportedWorkflow.includes('sk-'));
  assert.ok(!exported.includes(f.projectRoot));
  assert.match(exported, /inputs\/data\/counts\.csv/);
  const wrapper = spawnSync(process.execPath, [path.join(f.packageDir, 'repro', 'reproduce.mjs'), '--artifact', 'result_table'], { encoding: 'utf8' });
  assert.equal(wrapper.status, 0, wrapper.stderr);
  const response = JSON.parse(wrapper.stdout);
  assert.equal(response.ok, true);
  assert.equal(response.requiresConfirmation, true);
  assert.equal(response.artifact.artifactId, 'result_table');
});

test('HRT-6 refuses fixture input copies for real task privacy mode', () => {
  const f = fixture();
  assert.throws(() => replayPackage.buildScientificReplayPackage({
    taskRecord: f.taskRecord,
    job: f.job,
    projectRoot: f.projectRoot,
    packageDir: f.packageDir,
    includeFixtureInputs: true,
    inputSources: { counts: f.inputPath },
    privacyMode: 'references_only',
  }), /fixture_input_policy_denied/);
});

test('HRT-6 classifies input, plugin, parameter, environment and execution drift', () => {
  const f = fixture();
  replayPackage.buildScientificReplayPackage({
    taskRecord: f.taskRecord,
    job: f.job,
    projectRoot: f.projectRoot,
    packageDir: f.packageDir,
    contextCheckpoint: f.contextCheckpoint,
    includeFixtureInputs: true,
    inputSources: { counts: f.inputPath },
    privacyMode: 'repository_demo_data_only',
  });
  const assessment = replayPackage.assessReplayReadiness({
    packageDir: f.packageDir,
    inputSources: { counts: path.join(f.projectRoot, 'missing.csv') },
    currentPluginFingerprint: 'different-plugin',
    currentParams: { counts: 'inputs/data/counts.csv', threshold: 2 },
    currentRuntimeVersion: '4.5.0',
    executionResult: { exitCode: 1, stderr: 'fixture computation failed' },
  });
  assert.equal(assessment.ok, false);
  assert.deepEqual(new Set(assessment.drift.map((item) => item.kind)), new Set([
    'input_drift', 'plugin_drift', 'parameter_drift', 'environment_drift', 'execution_failure',
  ]));
});

test('HRT-6 detects package and deterministic artifact hash drift', () => {
  const f = fixture();
  replayPackage.buildScientificReplayPackage({
    taskRecord: f.taskRecord,
    job: f.job,
    projectRoot: f.projectRoot,
    packageDir: f.packageDir,
    contextCheckpoint: f.contextCheckpoint,
    includeFixtureInputs: true,
    inputSources: { counts: f.inputPath },
    privacyMode: 'repository_demo_data_only',
  });
  const artifactDrift = replayPackage.assessReplayReadiness({
    packageDir: f.packageDir,
    currentParams: JSON.parse(fs.readFileSync(path.join(f.packageDir, 'params.json'), 'utf8')),
    executionResult: { exitCode: 0 },
    artifactSources: { result_table: f.inputPath, result_plot: f.plotPath },
  });
  assert.ok(artifactDrift.drift.some((item) => item.kind === 'artifact_drift'));
  fs.appendFileSync(path.join(f.packageDir, 'HANDOFF.md'), '\ntampered\n');
  const validation = replayPackage.validateScientificReplayPackage(f.packageDir);
  assert.equal(validation.ok, false);
  assert.ok(validation.issues.some((item) => item.code === 'package_file_hash_mismatch'));
});

test('HRT-6 binds the exact inventory and manifest payload to the package digest', () => {
  const f = fixture();
  replayPackage.buildScientificReplayPackage({
    taskRecord: f.taskRecord,
    job: f.job,
    projectRoot: f.projectRoot,
    packageDir: f.packageDir,
    contextCheckpoint: f.contextCheckpoint,
    includeFixtureInputs: true,
    inputSources: { counts: f.inputPath },
    privacyMode: 'repository_demo_data_only',
  });
  const replayPath = path.join(f.packageDir, 'replay.json');
  const replay = JSON.parse(fs.readFileSync(replayPath, 'utf8'));
  replay.replayPolicy.realTaskRequiresConfirmation = false;
  fs.writeFileSync(replayPath, JSON.stringify(replay, null, 2) + '\n');

  // Simulate an attacker updating the per-file manifest entry but not the
  // package-level digest. A per-file-only validator would accept this.
  const manifestPath = path.join(f.packageDir, 'package-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const replayEntry = manifest.files.find((item) => item.relativePath === 'replay.json');
  replayEntry.sha256 = replayPackage.hashFile(replayPath);
  replayEntry.sizeBytes = fs.statSync(replayPath).size;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  const validation = replayPackage.validateScientificReplayPackage(f.packageDir);
  assert.equal(validation.ok, false);
  assert.ok(validation.issues.some((item) => item.code === 'package_digest_mismatch'));
  const wrapper = spawnSync(process.execPath, [path.join(f.packageDir, 'repro', 'reproduce.mjs')], { encoding: 'utf8' });
  assert.notEqual(wrapper.status, 0);
  assert.ok(JSON.parse(wrapper.stdout).failures.some((item) => item.code === 'package_digest_mismatch'));
});

test('HRT-6 rejects malformed file entries and unlisted package contents', () => {
  const f = fixture();
  replayPackage.buildScientificReplayPackage({
    taskRecord: f.taskRecord,
    job: f.job,
    projectRoot: f.projectRoot,
    packageDir: f.packageDir,
    contextCheckpoint: f.contextCheckpoint,
    includeFixtureInputs: true,
    inputSources: { counts: f.inputPath },
    privacyMode: 'repository_demo_data_only',
  });
  fs.writeFileSync(path.join(f.packageDir, 'unexpected.txt'), 'not in the manifest\n');
  const manifestPath = path.join(f.packageDir, 'package-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const duplicate = { ...manifest.files[0] };
  const wrongSize = manifest.files.find((item) => item.relativePath === 'replay.json');
  wrongSize.sizeBytes += 1;
  manifest.files.push(duplicate, {
    relativePath: '../outside.txt',
    sha256: 'a'.repeat(64),
    sizeBytes: 0,
  });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  const validation = replayPackage.validateScientificReplayPackage(f.packageDir);
  assert.equal(validation.ok, false);
  assert.ok(validation.issues.some((item) => item.code === 'package_manifest_file_duplicate'));
  assert.ok(validation.issues.some((item) => item.code === 'package_manifest_file_path_invalid'));
  assert.ok(validation.issues.some((item) => item.code === 'package_file_size_mismatch'));
  assert.ok(validation.issues.some((item) => item.code === 'package_file_inventory_mismatch'));
});

test('HRT-6 fails closed when the package manifest is not an object', () => {
  const f = fixture();
  replayPackage.buildScientificReplayPackage({
    taskRecord: f.taskRecord,
    job: f.job,
    projectRoot: f.projectRoot,
    packageDir: f.packageDir,
    contextCheckpoint: f.contextCheckpoint,
    includeFixtureInputs: true,
    inputSources: { counts: f.inputPath },
    privacyMode: 'repository_demo_data_only',
  });
  fs.writeFileSync(path.join(f.packageDir, 'package-manifest.json'), 'null\n');
  const validation = replayPackage.validateScientificReplayPackage(f.packageDir);
  assert.equal(validation.ok, false);
  assert.ok(validation.issues.some((item) => item.code === 'package_manifest_schema_invalid'));
  const wrapper = spawnSync(process.execPath, [path.join(f.packageDir, 'repro', 'reproduce.mjs')], { encoding: 'utf8' });
  assert.notEqual(wrapper.status, 0);
  assert.ok(JSON.parse(wrapper.stdout).failures.some((item) => item.code === 'package_manifest_schema_invalid'));
});

test('HRT-6 source digest changes when checkpoint or execution evidence changes', () => {
  const left = fixture();
  const right = fixture();
  right.contextCheckpoint.sourceDigest = sha256('different messages');
  const a = replayPackage.buildScientificReplayPackage({ taskRecord: left.taskRecord, job: left.job, projectRoot: left.projectRoot, packageDir: left.packageDir, contextCheckpoint: left.contextCheckpoint });
  const b = replayPackage.buildScientificReplayPackage({ taskRecord: right.taskRecord, job: right.job, projectRoot: right.projectRoot, packageDir: right.packageDir, contextCheckpoint: right.contextCheckpoint });
  assert.notEqual(a.packageManifest.sourceDigest, b.packageManifest.sourceDigest);
});

test('HRT-6 selects the newest compatible context checkpoint when Loop checkpoints share persistence', () => {
  const f = fixture();
  const loopCheckpoint = {
    schemaVersion: 1,
    checkpointId: 'cp_loop_1',
    projectId: 'project_1',
    conversationId: 'conversation_1',
    sourceDigest: 'e'.repeat(64),
    createdAt: '2026-07-22T01:00:00.000Z',
    loopRunId: 'loop_1',
    sequence: 2,
    decision: 'continue',
  };
  assert.equal(
    replayPackage.selectReplayContextCheckpoint([loopCheckpoint, f.contextCheckpoint]).checkpointId,
    f.contextCheckpoint.checkpointId,
  );
  assert.equal(replayPackage.selectReplayContextCheckpoint([loopCheckpoint]), null);
});
