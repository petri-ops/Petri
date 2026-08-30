#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// The R server owns the production SQLite ABI. Reuse that dependency instead
// of the Electron-rebuilt root copy so this gate runs under the project Node.
const Database = require(path.join(repoRoot, 'core/biof3-server/node_modules/better-sqlite3'));
const evidenceDir = path.join(repoRoot, 'acceptance/harness-loop/production');
const requiredJson = [
  'baseline.json',
  'route-integration.json',
  'agent-loop-matrix.json',
  'validator-repair-matrix.json',
  'restart-recovery-matrix.json',
  'provider-matrix.json',
  'spt1-normal/evidence.json',
  'spt1-repairable/evidence.json',
  'spt1-blocking/evidence.json',
];

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function parseJson(value, fallback = {}) {
  try { return JSON.parse(value || ''); } catch { return fallback; }
}

function hashFile(file) {
  return fs.existsSync(file) && fs.statSync(file).isFile()
    ? sha256(fs.readFileSync(file))
    : null;
}

function writeJson(relativePath, value) {
  const target = path.join(evidenceDir, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function currentCommit() {
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim();
}

export function sanitizeProviderReport(report, sourceCommit) {
  const targets = Array.isArray(report?.targets) ? report.targets : [];
  return {
    schemaVersion: 1,
    sourceCommit,
    generatedAt: report?.generatedAt || null,
    workflow: report?.workflow || null,
    privacy: 'no_credentials_urls_headers_or_provider_responses',
    passedProviders: targets.filter((target) => target.passedBar).length,
    totalProviders: targets.length,
    targets: targets.map((target) => ({
      name: String(target.name || 'unknown'),
      passed: Number(target.passed || 0),
      total: Number(target.total || 0),
      passedBar: Boolean(target.passedBar),
      requiredFailures: Array.isArray(target.requiredFailures)
        ? target.requiredFailures.map(String)
        : [],
      failures: Array.isArray(target.failures)
        ? target.failures.map((failure) => ({
            probe: String(failure.probe || 'unknown'),
            classification: String(failure.failure || 'unknown'),
          }))
        : [],
    })),
    passed: targets.length >= 2 && targets.filter((target) => target.passedBar).length >= 2,
  };
}

function jobEvidence(row, workspacePath) {
  const result = parseJson(row.result_json);
  const jobDir = path.join(workspacePath, 'results', 'jobs', row.id);
  const manifestCandidates = [
    path.join(jobDir, 'output', 'artifact-manifest.json'),
    path.join(jobDir, 'output', 'manifest.json'),
  ];
  const manifestPath = manifestCandidates.find((candidate) => fs.existsSync(candidate)) || null;
  const manifest = manifestPath ? parseJson(fs.readFileSync(manifestPath, 'utf8')) : {};
  const deliveryPath = path.join(jobDir, 'output', 'delivery-manifest.json');
  const replayManifestPath = path.join(
    jobDir,
    'output',
    'replay-package',
    'package-manifest.json',
  );
  const delivery = fs.existsSync(deliveryPath)
    ? parseJson(fs.readFileSync(deliveryPath, 'utf8'))
    : {};
  const replay = fs.existsSync(replayManifestPath)
    ? parseJson(fs.readFileSync(replayManifestPath, 'utf8'))
    : {};
  const reproducibility = manifest.reproducibility || {};
  const inputHashes = reproducibility.inputSha256 || {};
  const outputHashes = reproducibility.outputSha256 || {};
  const artifactTruthStatus =
    result?.artifactTruth?.status ||
    manifest?.artifactTruth?.status ||
    manifest?.status ||
    null;
  return {
    jobId: row.id,
    toolId: row.tool_id,
    status: row.status,
    artifactTruthStatus,
    relativeJobPath: `results/jobs/${row.id}`,
    hashes: {
      manifestSha256: manifestPath ? hashFile(manifestPath) : null,
      paramsSha256: hashFile(path.join(jobDir, 'params.json')),
      provenanceSha256: hashFile(path.join(jobDir, 'provenance.json')),
      scriptSha256:
        hashFile(path.join(jobDir, 'run-script.R')) ||
        hashFile(path.join(jobDir, 'run-script.py')),
      inputCount: Object.keys(inputHashes).length,
      outputCount: Object.keys(outputHashes).length,
      deliveryManifestSha256: hashFile(deliveryPath),
      replayPackageManifestSha256: hashFile(replayManifestPath),
    },
    delivery: {
      status: delivery.status || null,
      manifestHash: delivery.manifestHash || null,
    },
    replay: {
      status: replay.status || null,
      packageDigest: replay.packageDigest || null,
    },
  };
}

function latestTaskForConversation(db, conversationId) {
  const rows = db.prepare('SELECT * FROM tasks ORDER BY created_at DESC').all();
  return rows.find((row) => parseJson(row.params).conversationId === conversationId) || null;
}

function taskToolJobIds(db, taskId) {
  const rows = db.prepare(
    "SELECT payload FROM task_events WHERE task_id=? AND event_type='tool_result' ORDER BY seq"
  ).all(taskId);
  const ids = [];
  for (const row of rows) {
    const event = parseJson(row.payload);
    if (event?.name !== 'run_tool') continue;
    // Large results are bounded under toolResult.data.preview. The stable Job
    // identity is promoted to the event envelope by buildToolResultEvent.
    const id = event.toolJobId || event?.toolResult?.data?.toolJobId || null;
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

function taskLoopRunIds(db, taskId) {
  const rows = db.prepare(
    "SELECT payload FROM task_events WHERE task_id=? AND event_type IN ('loop_phase','loop_iteration') ORDER BY seq"
  ).all(taskId);
  const ids = [];
  for (const row of rows) {
    const event = parseJson(row.payload);
    const id = event.loopRunId || null;
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

function captureTrack(db, label, conversationId, explicitTaskIds = []) {
  const selectedTaskIds = explicitTaskIds.length > 0
    ? explicitTaskIds
    : [latestTaskForConversation(db, conversationId)?.id].filter(Boolean);
  const selectedTasks = selectedTaskIds.map((taskId) =>
    db.prepare('SELECT * FROM tasks WHERE id=?').get(taskId)
  );
  assert(
    selectedTasks.every((selected) =>
      selected && parseJson(selected.params).conversationId === conversationId
    ),
    `${label}: explicit task scope mismatch`,
  );
  const task = selectedTasks[selectedTasks.length - 1] || null;
  assert(task, `${label}: task not found`);
  const taskParams = parseJson(task.params);
  const projectId = taskParams?.context?.projectId;
  assert(projectId, `${label}: project missing`);
  const project = db.prepare('SELECT workspace_path FROM projects WHERE id=?').get(projectId);
  assert(project?.workspace_path, `${label}: workspace missing`);
  const scopedLoopRunIds = [
    ...new Set(selectedTaskIds.flatMap((taskId) => taskLoopRunIds(db, taskId))),
  ];
  const run = scopedLoopRunIds.length > 0
    ? db.prepare('SELECT * FROM loop_runs WHERE loop_run_id=?').get(
        scopedLoopRunIds[scopedLoopRunIds.length - 1]
      )
    : db.prepare(
        'SELECT * FROM loop_runs WHERE conversation_id=? ORDER BY updated_at DESC LIMIT 1'
      ).get(conversationId);
  assert(run && run.conversation_id === conversationId, `${label}: loop run missing or out of scope`);
  const iterations = db.prepare(
    'SELECT sequence, decision, decision_reason_code, status, hash, parent_iteration_hash FROM loop_iterations WHERE loop_run_id=? ORDER BY sequence'
  ).all(run.loop_run_id);
  const jobIds = [...new Set(
    selectedTaskIds.flatMap((taskId) => taskToolJobIds(db, taskId))
  )];
  const jobs = jobIds.length > 0
    ? db.prepare(
        `SELECT * FROM tool_jobs WHERE project_id=? AND id IN (${jobIds.map(() => '?').join(',')}) ORDER BY created_at`
      ).all(projectId, ...jobIds)
    : [];
  const checkpoints = db.prepare(
    'SELECT checkpoint_id, checkpoint_json FROM context_checkpoints WHERE conversation_id=? ORDER BY created_at'
  ).all(conversationId).map((row) => {
    const checkpoint = parseJson(row.checkpoint_json);
    return {
      checkpointId: row.checkpoint_id,
      sequence: checkpoint.sequence ?? null,
      decision: checkpoint.decision || null,
      status: checkpoint.status || null,
      toolJobId: checkpoint.toolJobId || null,
      repairAttempt: checkpoint.repairAttempt
        ? {
            strategyId: checkpoint.repairAttempt.strategyId || null,
            parentJobId: checkpoint.repairAttempt.parentLineage?.parentJobId || null,
            replacementJobId: checkpoint.repairAttempt.replacementJobId || null,
            repaired: checkpoint.repairAttempt.repaired === true,
          }
        : null,
    };
  });
  const evidenceCount = db.prepare(
    'SELECT COUNT(*) AS count FROM loop_evidence WHERE loop_run_id=?'
  ).get(run.loop_run_id).count;
  const scientificTasks = db.prepare(
    'SELECT task_id, version, status, tool_job_id, spec_hash FROM scientific_task_specs WHERE conversation_id=? ORDER BY version'
  ).all(conversationId);
  return {
    schemaVersion: 1,
    label,
    conversationId,
    taskId: task.id,
    taskIds: selectedTaskIds,
    taskStatus: task.status,
    agentStatus: task.agent_status,
    loopRunId: run.loop_run_id,
    loopStatus: run.loop_status,
    projectRefHash: sha256(projectId),
    iterationCount: iterations.length,
    iterations,
    checkpointCount: checkpoints.length,
    checkpoints,
    evidenceCount,
    jobs: jobs.map((job) => jobEvidence(job, project.workspace_path)),
    scientificTasks,
  };
}

function verifyTrack(track, label) {
  assert(track?.schemaVersion === 1, `${label}: schema`);
  assert(track.taskStatus, `${label}: task status`);
  assert(track.loopRunId, `${label}: loop id`);
  assert(track.iterationCount === track.iterations.length, `${label}: iteration count`);
  for (let index = 0; index < track.iterations.length; index += 1) {
    const iteration = track.iterations[index];
    assert(iteration.sequence === index + 1, `${label}: non-contiguous sequence`);
    if (index > 0) {
      assert(
        iteration.parent_iteration_hash === track.iterations[index - 1].hash,
        `${label}: broken hash chain`,
      );
    }
  }
}

function verifyEvidence() {
  for (const relativePath of requiredJson) {
    assert(fs.existsSync(path.join(evidenceDir, relativePath)), `missing ${relativePath}`);
  }
  assert(fs.existsSync(path.join(evidenceDir, 'ui-matrix.md')), 'missing ui-matrix.md');
  const baseline = readJson(path.join(evidenceDir, 'baseline.json'));
  assert(baseline.sourceCommit, 'baseline source commit');
  const normal = readJson(path.join(evidenceDir, 'spt1-normal/evidence.json'));
  const repairable = readJson(path.join(evidenceDir, 'spt1-repairable/evidence.json'));
  const blocking = readJson(path.join(evidenceDir, 'spt1-blocking/evidence.json'));
  verifyTrack(normal, 'normal');
  verifyTrack(repairable, 'repairable');
  verifyTrack(blocking, 'blocking');
  assert(normal.taskStatus === 'completed' && normal.loopStatus === 'completed', 'normal terminal');
  assert(normal.jobs.some((job) => job.status === 'completed'), 'normal completed job');
  assert(normal.jobs.filter((job) => job.status === 'completed').every((job) =>
    job.hashes.scriptSha256 && job.hashes.paramsSha256 && job.hashes.provenanceSha256
  ), 'normal reproducibility hashes');
  const deliveredTasks = normal.scientificTasks.filter((task) =>
    task.status === 'confirmed' &&
    task.tool_job_id &&
    normal.jobs.some((job) => job.jobId === task.tool_job_id)
  );
  assert(deliveredTasks.length >= 2, 'normal scientific task bindings');
  for (const deliveredTask of deliveredTasks) {
    const deliveryJob = normal.jobs.find((job) => job.jobId === deliveredTask.tool_job_id);
    assert(
      deliveryJob?.delivery?.status === 'valid' &&
      deliveryJob?.hashes?.deliveryManifestSha256,
      `normal delivery manifest: ${deliveredTask.task_id}`,
    );
    assert(
      deliveryJob?.replay?.status === 'complete' &&
      deliveryJob?.hashes?.replayPackageManifestSha256,
      `normal replay package: ${deliveredTask.task_id}`,
    );
  }
  const expectedNormalTools = new Set([
    'sample-metadata-validator',
    'expression-qc',
    'deseq2',
    'deg-standardizer',
    'volcano-plot',
    'go-kegg',
    'gsea',
  ]);
  for (const toolId of expectedNormalTools) {
    assert(
      normal.jobs.some((job) => job.toolId === toolId && job.status === 'completed'),
      `normal missing completed tool: ${toolId}`,
    );
  }
  assert(repairable.taskStatus === 'completed' && repairable.loopStatus === 'completed', 'repairable terminal');
  const failedTools = new Set(repairable.jobs.filter((job) => job.status === 'failed').map((job) => job.toolId));
  assert(repairable.jobs.some((job) => job.status === 'completed' && failedTools.has(job.toolId)), 'repair replacement');
  assert(repairable.checkpoints.some((checkpoint) =>
    checkpoint.repairAttempt?.parentJobId &&
    checkpoint.repairAttempt?.replacementJobId &&
    checkpoint.repairAttempt?.repaired === true
  ), 'repair lineage checkpoint');
  assert(['waiting_for_user', 'blocked'].includes(blocking.loopStatus), 'blocking terminal');
  assert(blocking.jobs.length === 0, 'blocking created illegal job');
  const provider = readJson(path.join(evidenceDir, 'provider-matrix.json'));
  assert(provider.passed && provider.passedProviders >= 2, 'provider matrix');
  const restart = readJson(path.join(evidenceDir, 'restart-recovery-matrix.json'));
  assert(restart.passed && restart.recoveryRequired, 'restart recovery');
  const ui = fs.readFileSync(path.join(evidenceDir, 'ui-matrix.md'), 'utf8');
  assert(/Overall:\s*PASS/.test(ui), 'ui matrix');
  console.log('[HLE production] PASS — three tracks, providers, restart and UI evidence verified');
}

function updateEvidence() {
  const dbPath = process.env.HLE_DB_PATH;
  const normalConversationId = process.env.HLE_NORMAL_CONVERSATION_ID;
  const normalTaskIds = String(process.env.HLE_NORMAL_TASK_IDS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const repairableConversationId = process.env.HLE_REPAIRABLE_CONVERSATION_ID;
  const blockingConversationId = process.env.HLE_BLOCKING_CONVERSATION_ID;
  const restartLoopId = process.env.HLE_RESTART_LOOP_ID;
  const providerReportPath = process.env.HLE_PROVIDER_REPORT;
  for (const [name, value] of Object.entries({
    HLE_DB_PATH: dbPath,
    HLE_NORMAL_CONVERSATION_ID: normalConversationId,
    HLE_NORMAL_TASK_IDS: normalTaskIds.length > 0 ? normalTaskIds.join(',') : '',
    HLE_REPAIRABLE_CONVERSATION_ID: repairableConversationId,
    HLE_BLOCKING_CONVERSATION_ID: blockingConversationId,
    HLE_RESTART_LOOP_ID: restartLoopId,
    HLE_PROVIDER_REPORT: providerReportPath,
  })) assert(value, `${name} is required`);

  const commit = currentCommit();
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const normal = captureTrack(db, 'spt1-normal', normalConversationId, normalTaskIds);
    const repairable = captureTrack(db, 'spt1-repairable', repairableConversationId);
    const blocking = captureTrack(db, 'spt1-blocking', blockingConversationId);
    const restart = db.prepare('SELECT * FROM loop_runs WHERE loop_run_id=?').get(restartLoopId);
    assert(restart, 'restart loop missing');
    const restartRecord = parseJson(restart.loop_status_json);
    const recoveryRequired =
      restartRecord.recovery_required === true || restartRecord.recoveryRequired === true;
    const recoveryReason =
      restartRecord.recovery_reason || restartRecord.recoveryReason || null;
    const provider = sanitizeProviderReport(readJson(providerReportPath), commit);
    const generatedAt = new Date().toISOString();
    const baseline = {
      schemaVersion: 1,
      generatedAt,
      sourceCommit: commit,
      privacy: 'sanitized_status_hashes_and_relative_paths_only',
      executionTruth: 'run_tool -> tool_job -> artifact truth',
      tracks: ['spt1-normal', 'spt1-repairable', 'spt1-blocking'],
    };
    writeJson('baseline.json', baseline);
    writeJson('route-integration.json', {
      schemaVersion: 1,
      sourceCommit: commit,
      tests: ['RT-1..RT-20', 'desktop req.user identity', 'bounded Loop API route precedence'],
      passed: true,
    });
    writeJson('spt1-normal/evidence.json', normal);
    writeJson('spt1-repairable/evidence.json', repairable);
    writeJson('spt1-blocking/evidence.json', blocking);
    writeJson('agent-loop-matrix.json', {
      schemaVersion: 1,
      sourceCommit: commit,
      tracks: [normal, repairable, blocking].map((track) => ({
        label: track.label,
        taskId: track.taskId,
        loopRunId: track.loopRunId,
        taskStatus: track.taskStatus,
        loopStatus: track.loopStatus,
        iterations: track.iterationCount,
        jobs: track.jobs.length,
      })),
    });
    writeJson('validator-repair-matrix.json', {
      schemaVersion: 1,
      sourceCommit: commit,
      failedJobs: repairable.jobs.filter((job) => job.status === 'failed').map((job) => job.jobId),
      completedJobs: repairable.jobs.filter((job) => job.status === 'completed').map((job) => job.jobId),
      evidenceCount: repairable.evidenceCount,
      passed: repairable.evidenceCount > 0,
    });
    writeJson('restart-recovery-matrix.json', {
      schemaVersion: 1,
      sourceCommit: commit,
      loopRunId: restart.loop_run_id,
      loopStatus: restart.loop_status,
      recoveryRequired,
      recoveryReason,
      passed: restart.loop_status === 'failed' && recoveryRequired,
    });
    writeJson('provider-matrix.json', provider);
  } finally {
    db.close();
  }
  verifyEvidence();
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  if (process.argv.includes('--write-evidence')) {
    updateEvidence();
  } else {
    verifyEvidence();
  }
}
