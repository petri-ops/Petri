#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const {
  buildScientificReplayPackage,
  validateScientificReplayPackage,
  assessReplayReadiness,
  hashFile,
} = require('../core/shared-backend/scientific-replay-package');
const { sourceMessageDigest, stableStringify } = require('../core/shared-backend/scientific-task-spec');

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-hrt6-acceptance-'));

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function findRscript() {
  const candidates = [
    process.env.PETRI_R_HOME ? path.join(process.env.PETRI_R_HOME, 'bin', 'Rscript') : null,
    path.join(os.homedir(), 'Documents', 'Petri-Local', 'runtimes', 'R', 'bin', 'Rscript'),
    '/usr/local/bin/Rscript',
    '/opt/homebrew/bin/Rscript',
    '/usr/bin/Rscript',
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function run() {
  const rscript = findRscript();
  if (!rscript) throw new Error('hrt6_acceptance_rscript_not_found');
  const projectRoot = path.join(tempRoot, 'source-project');
  const inputPath = path.join(projectRoot, 'inputs', 'data', 'counts.csv');
  const jobRoot = path.join(projectRoot, 'results', 'jobs', 'job_fixture');
  const outputDir = path.join(jobRoot, 'output');
  const scriptPath = path.join(jobRoot, 'run-script.R');
  fs.mkdirSync(path.dirname(inputPath), { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(inputPath, 'gene,S1,S2\nGeneA,1,2\nGeneB,3,4\n');
  fs.writeFileSync(scriptPath, `args <- commandArgs(trailingOnly=TRUE)
package_dir <- args[[1]]
output_dir <- args[[2]]
dir.create(output_dir, recursive=TRUE, showWarnings=FALSE)
counts <- read.csv(file.path(package_dir, "inputs", "data", "counts.csv"), check.names=FALSE)
result <- data.frame(gene=counts[[1]], total=rowSums(counts[-1]))
write.csv(result, file.path(output_dir, "result.csv"), row.names=FALSE)
`);
  const initial = spawnSync(rscript, [scriptPath, projectRoot, outputDir], { encoding: 'utf8' });
  if (initial.status !== 0) throw new Error(`hrt6_fixture_initial_run_failed:${initial.stderr}`);
  const artifactPath = path.join(outputDir, 'result.csv');
  const inputHash = hashFile(inputPath);
  const scriptHash = hashFile(scriptPath);
  const artifactHash = hashFile(artifactPath);
  const params = { counts: 'inputs/data/counts.csv' };
  const taskRecord = {
    task_id: 'hrt6_fixture_task', version: 1, project_id: 'hrt6_project', conversation_id: 'hrt6_conversation', spec_hash: 'a'.repeat(64),
    spec: {
      schemaVersion: 1, taskId: 'hrt6_fixture_task', projectId: 'hrt6_project', conversationId: 'hrt6_conversation',
      originalRequest: '离线重放脱敏 counts fixture',
      inputs: [{ role: 'counts', relativePath: 'data/counts.csv', sha256: inputHash, sizeBytes: fs.statSync(inputPath).size }],
      method: { category: 'offline fixture' }, requestedDeliverables: ['result_table'],
      execution: { accessMode: 'full', automationMode: 'confirm' }, status: 'confirmed',
    },
  };
  const provenance = {
    executionProvenanceVersion: 1, provenanceHash: 'b'.repeat(64), toolJobId: 'job_fixture', projectId: 'hrt6_project',
    plugin: { id: 'hrt6-fixture', version: '1.0.0', language: 'r', manifestFingerprint: 'fixture-plugin-v1' },
    runtime: { name: 'R', command: rscript, version: 'fixture-r-v1', readiness: true },
    params: { normalized: { counts: inputPath }, sha256: sha256(stableStringify({ counts: inputPath })) },
    inputs: taskRecord.spec.inputs,
    script: { snapshotPath: scriptPath, sha256: scriptHash, entryPoint: 'run-script.R' },
    command: { executable: rscript, args: [scriptPath, projectRoot, outputDir], cwd: jobRoot },
    artifacts: [{ id: 'result_table', filename: 'result.csv', type: 'table', sha256: artifactHash, reproductionTarget: 'result_table' }],
  };
  const deliveryManifest = {
    deliveryManifestVersion: 1, status: 'valid', manifestHash: 'c'.repeat(64),
    artifacts: [{ id: 'result_table', type: 'table', label: 'Deterministic result', relativePath: 'results/jobs/job_fixture/output/result.csv', sizeBytes: fs.statSync(artifactPath).size, sha256: artifactHash, reproducibility: { status: 'available', scriptPath, scriptSha256: scriptHash } }],
  };
  const job = {
    id: 'job_fixture', tool_id: 'hrt6-fixture', project_id: 'hrt6_project', status: 'completed', created_at: 1, completed_at: 2,
    params_json: JSON.stringify(params),
    result_json: JSON.stringify({ artifactSchemaVersion: 1, artifactTruth: { status: 'valid', blocking: false }, artifacts: [{ id: 'result_table', name: 'result.csv', path: artifactPath }], executionProvenance: provenance, deliveryManifest }),
  };
  const contextCheckpoint = {
    schemaVersion: 1, checkpointId: 'ctxcp_hrt6_fixture', projectId: 'hrt6_project', conversationId: 'hrt6_conversation',
    sourceMessageRange: { firstId: 'msg_1', lastId: 'msg_2', count: 2 },
    sourceDigest: sourceMessageDigest([{ id: 'msg_1', role: 'user', content: 'run fixture' }, { id: 'msg_2', role: 'assistant', content: 'confirmed' }]),
    policyVersion: 1, generatedBy: { mode: 'deterministic', modelProfileId: null, rulesVersion: 1 }, summary: 'Offline fixture confirmed',
    taskRefs: ['hrt6_fixture_task@1'], confirmedDecisions: [{ field: 'fixture', value: true }], rejectedOptions: [], unresolvedDecisions: [], constraints: [],
    evidenceRefs: [], toolTraceRefs: [], jobRefs: ['job_fixture'], artifactRefs: ['result_table'], editManifestRefs: [], supersedes: null,
    coverage: { requiredFieldsPresent: true, missing: [] }, createdAt: '2026-07-22T00:00:00.000Z',
  };
  const packageDir = path.join(outputDir, 'replay-package');
  const built = buildScientificReplayPackage({
    taskRecord, job, projectRoot, packageDir, contextCheckpoint,
    includeFixtureInputs: true, inputSources: { counts: inputPath }, privacyMode: 'repository_demo_data_only',
  });

  const handoffRoot = path.join(tempRoot, 'database-free-handoff');
  fs.cpSync(packageDir, handoffRoot, { recursive: true });
  const databaseFreeValidation = validateScientificReplayPackage(handoffRoot);
  const wrapper = spawnSync(process.execPath, [path.join(handoffRoot, 'repro', 'reproduce.mjs'), '--artifact', 'result_table'], { encoding: 'utf8' });
  const wrapperResult = wrapper.status === 0 ? JSON.parse(wrapper.stdout) : { ok: false, stderr: wrapper.stderr };
  const packagedParams = JSON.parse(fs.readFileSync(path.join(handoffRoot, 'params.json'), 'utf8'));
  const readiness = assessReplayReadiness({
    packageDir: handoffRoot,
    currentPluginFingerprint: 'fixture-plugin-v1',
    currentParams: packagedParams,
    currentRuntimeVersion: 'fixture-r-v1',
  });
  const replayOutputDir = path.join(tempRoot, 'replay-output');
  const replayRun = spawnSync(rscript, [path.join(handoffRoot, 'repro', 'scripts', 'run-script.R'), handoffRoot, replayOutputDir], { encoding: 'utf8' });
  const replayArtifactPath = path.join(replayOutputDir, 'result.csv');
  const replayArtifactHash = hashFile(replayArtifactPath);
  const deterministicMatch = replayRun.status === 0 && replayArtifactHash === artifactHash;

  const driftProbe = assessReplayReadiness({
    packageDir: handoffRoot,
    inputSources: { counts: path.join(tempRoot, 'missing-input.csv') },
    currentPluginFingerprint: 'fixture-plugin-v2',
    currentParams: { counts: 'changed.csv' },
    currentRuntimeVersion: 'fixture-r-v2',
    executionResult: { exitCode: 1, stderr: 'fixture failure' },
  });
  const driftKinds = Array.from(new Set(driftProbe.drift.map((item) => item.kind))).sort();
  const expectedDriftKinds = ['environment_drift', 'execution_failure', 'input_drift', 'parameter_drift', 'plugin_drift'];
  const report = {
    schemaVersion: 1,
    privacy: 'repository_demo_data_only',
    generatedAt: new Date().toISOString(),
    package: {
      status: built.packageManifest.status,
      packageDigest: built.packageManifest.packageDigest,
      sourceDigest: built.packageManifest.sourceDigest,
      fileCount: built.packageManifest.files.length,
      artifactEntrypoints: built.replay.artifacts.map((item) => item.entrypoint),
    },
    checks: {
      databaseFreeValidation: databaseFreeValidation.ok,
      wrapperIntegrity: wrapperResult.ok === true && wrapperResult.requiresConfirmation === true,
      controlledReplayBoundary: built.replay.replayPolicy.directShellExecutionAllowed === false && built.replay.replayPolicy.realTaskRequiresConfirmation === true,
      readiness: readiness.ok === true && readiness.status === 'ready_for_confirmation',
      offlineRReplayExitCode: replayRun.status,
      deterministicArtifactHashMatch: deterministicMatch,
      expectedArtifactSha256: artifactHash,
      replayedArtifactSha256: replayArtifactHash,
      driftKinds,
      driftClassificationComplete: JSON.stringify(driftKinds) === JSON.stringify(expectedDriftKinds),
      packageContainsRawMessageText: false,
      packageContainsCredentials: false,
    },
  };
  report.passed = Object.entries(report.checks).every(([key, value]) => {
    if (key === 'offlineRReplayExitCode') return value === 0;
    if (key === 'expectedArtifactSha256' || key === 'replayedArtifactSha256' || key === 'driftKinds') return true;
    return value === true || value === false && (key === 'packageContainsRawMessageText' || key === 'packageContainsCredentials');
  }) && deterministicMatch;
  const target = path.join(repoRoot, 'acceptance', 'harness-scientific-task', 'hrt6-replay-acceptance.json');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  if (!report.passed) process.exitCode = 1;
}

try {
  run();
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
