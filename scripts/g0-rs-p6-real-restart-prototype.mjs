#!/usr/bin/env node

/**
 * G0-RS-P6-1 real restart prototype.
 *
 * This is deliberately not a canonical evidence writer. It exercises a real
 * no-seed product ledger, kills a context-bound edit worker only after its
 * SQLite checkpoint and candidate Git ref are durable, then cold-boots the
 * server twice against the same database, workspace and managed repository.
 */

import { createHash, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { startServer, stopServer } from './g0-rs-p4r-capture.mjs';
import {
  P5_WORKER_CHECKPOINT_HOLD_MARKER,
  createP5LiveScientificRuntime,
  findBioPackRoot,
} from './g0-rs-p5-acceptance.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const P5_WORKER = path.join(ROOT, 'scripts/g0-rs-p5-acceptance.mjs');
const WORKER_MARKER = '__P5_WORKER_RESULT__';
const TERMINAL_JOB_STATUSES = new Set(['completed', 'failed', 'cancelled', 'recovery_required']);
const SHA256 = /^[a-f0-9]{64}$/;
const GIT_OID = /^[a-f0-9]{40}$/;
const WORKER_CHECKPOINT_TIMEOUT_MS = 120_000;
const WORKER_HOLD_CONFIRMATION_GRACE_MS = 1_000;
const JOB_TIMEOUT_MS = 180_000;

const Database = require(require.resolve('better-sqlite3', {
  paths: [path.join(ROOT, 'core', 'biof3-server'), ROOT],
}));
const { createResultStudioRepository } = require(
  path.join(ROOT, 'core/shared-backend/result-studio-repository.js')
);
const { RExecutor } = require(
  path.join(ROOT, 'core/shared-backend/executors/r-executor.js')
);

function invariant(condition, code, detail = null) {
  if (condition) return;
  const error = new Error(code);
  error.code = code;
  error.detail = detail;
  throw error;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function sleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

function fileIdentity(filePath) {
  const stat = statSync(filePath);
  return { dev: stat.dev, ino: stat.ino };
}

function sameFileIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

async function requestJson(baseUrl, route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    ...options,
    signal: options.signal || AbortSignal.timeout(options.timeoutMs || 60_000),
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  const raw = await response.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { raw: raw.slice(0, 500) }; }
  if (!response.ok) {
    const error = new Error(data.message || data.error || `http_${response.status}`);
    error.code = data.error || `http_${response.status}`;
    error.status = response.status;
    error.detail = data.detail || data.details || null;
    throw error;
  }
  return { data, status: response.status };
}

async function requestJsonResponse(baseUrl, route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    ...options,
    signal: options.signal || AbortSignal.timeout(options.timeoutMs || 60_000),
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  const raw = await response.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { raw: raw.slice(0, 500) }; }
  return { data, status: response.status, ok: response.ok };
}

function postJson(baseUrl, route, body, timeoutMs = 60_000) {
  return requestJson(baseUrl, route, {
    method: 'POST',
    body: JSON.stringify(body),
    timeoutMs,
  });
}

export function buildP6RestartVolcanoInput(rowCount = 240) {
  invariant(Number.isInteger(rowCount) && rowCount >= 40 && rowCount <= 100_000,
    'p6_restart_input_row_count_invalid');
  const rows = ['gene,log2FoldChange,pvalue,padj'];
  for (let index = 0; index < rowCount; index += 1) {
    const direction = index % 2 === 0 ? 1 : -1;
    const magnitude = index < 48 ? 2.2 + (index % 9) / 10 : 0.25 + (index % 7) / 20;
    const pvalue = index < 48 ? 0.00001 * (1 + (index % 5)) : 0.2 + (index % 20) / 100;
    const padj = index < 48 ? Math.min(0.009, pvalue * 4) : Math.min(0.99, pvalue * 1.4);
    rows.push([
      `GENE_${String(index + 1).padStart(4, '0')}`,
      (direction * magnitude).toFixed(4),
      pvalue.toPrecision(8),
      padj.toPrecision(8),
    ].join(','));
  }
  return `${rows.join('\n')}\n`;
}

export function buildP6StopDeseq2Input(rowCount = 50_000) {
  invariant(Number.isInteger(rowCount) && rowCount >= 1_000 && rowCount <= 200_000,
    'p6_stop_input_row_count_invalid');
  const counts = new Array(rowCount + 1);
  counts[0] = 'gene,C1,C2,C3,T1,T2,T3';
  for (let index = 0; index < rowCount; index += 1) {
    const baseline = 20 + (index % 200);
    const effect = index % 4 === 0 ? 5 : index % 4 === 1 ? 2 : 1;
    counts[index + 1] = [
      `GENE_${String(index + 1).padStart(6, '0')}`,
      baseline,
      baseline + 1,
      baseline + 2,
      baseline * effect,
      (baseline + 1) * effect,
      (baseline + 2) * effect,
    ].join(',');
  }
  return {
    counts: `${counts.join('\n')}\n`,
    coldata: 'sample,condition\nC1,Control\nC2,Control\nC3,Control\nT1,Treatment\nT2,Treatment\nT3,Treatment\n',
  };
}

export function buildP6ValidatorBlockedCorrelationInput() {
  return [
    'gene,S1,S2,S3,S4',
    'G_CONST,1,1,1,1',
    'G_UP,1,2,3,4',
    'G_DOWN,4,3,2,1',
    '',
  ].join('\n');
}

function buildP6FailingVolcanoInput() {
  const rows = ['gene,log2FoldChange,pvalue'];
  for (let index = 0; index < 80; index += 1) {
    rows.push(`FAIL_${String(index + 1).padStart(3, '0')},${index % 2 === 0 ? 2 : -2},0.01`);
  }
  return `${rows.join('\n')}\n`;
}

async function submitP6StopJob(runtime, rowCount = 50_000) {
  const input = buildP6StopDeseq2Input(rowCount);
  const submitted = await postJson(runtime.baseUrl, '/api/tools/run', {
    toolId: 'deseq2',
    projectId: runtime.project.id,
    params: {
      design: 'condition',
      contrast_ref: 'Control',
      contrast_treat: 'Treatment',
      padj_cutoff: 0.05,
      lfc_cutoff: 1,
    },
    files: {
      'counts.csv': Buffer.from(input.counts).toString('base64'),
      'coldata.csv': Buffer.from(input.coldata).toString('base64'),
    },
  }, 120_000);
  invariant(submitted.data?.ok === true && submitted.data?.jobId,
    'p6_stop_submission_failed', submitted.data);
  return submitted.data.jobId;
}

async function submitP6VolcanoJob(runtime, csv) {
  const submitted = await postJson(runtime.baseUrl, '/api/tools/run', {
    toolId: 'volcano-plot',
    projectId: runtime.project.id,
    params: {
      deg_table: 'deg_table.csv',
      fc_threshold: 1,
      pval_threshold: 1.3,
      top_n: 6,
      plot_width: 3,
      plot_height: 3,
      export_dpi: 72,
    },
    files: { 'deg_table.csv': Buffer.from(csv).toString('base64') },
  });
  invariant(submitted.data?.ok === true && submitted.data?.jobId,
    'p6_failure_volcano_submission_failed', submitted.data);
  return submitted.data.jobId;
}

async function submitP6ValidatorBlockedJob(runtime) {
  const submitted = await postJson(runtime.baseUrl, '/api/tools/run', {
    toolId: 'gene-correlation',
    projectId: runtime.project.id,
    params: {
      expr_matrix: 'expr_matrix.csv',
      top_n: 3,
      method: 'pearson',
      cluster_rows: false,
      cluster_cols: false,
    },
    files: {
      'expr_matrix.csv': Buffer.from(buildP6ValidatorBlockedCorrelationInput()).toString('base64'),
    },
  });
  invariant(submitted.data?.ok === true && submitted.data?.jobId,
    'p6_validator_submission_failed', submitted.data);
  return submitted.data.jobId;
}

async function waitForRunningJobProcess(dbPath, jobId, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const sqlite = openLedger(dbPath);
    let row;
    try {
      row = sqlite.prepare('SELECT status, process_pid FROM tool_jobs WHERE id=?').get(jobId);
    } finally {
      sqlite.close();
    }
    if (row?.status === 'running' && Number.isInteger(row.process_pid) && row.process_pid > 0) return row;
    if (row && TERMINAL_JOB_STATUSES.has(row.status)) {
      throw Object.assign(new Error('p6_stop_job_finished_before_cancel'), { detail: row.status });
    }
    await sleep(5);
  }
  throw new Error('p6_stop_running_process_timeout');
}

function readResultStudioCounts(dbPath, projectId) {
  const sqlite = openLedger(dbPath);
  try {
    return {
      changeSets: sqlite.prepare('SELECT COUNT(*) AS count FROM scientific_change_sets WHERE project_id=?').get(projectId).count,
      revisions: sqlite.prepare('SELECT COUNT(*) AS count FROM artifact_revisions WHERE project_id=?').get(projectId).count,
    };
  } finally {
    sqlite.close();
  }
}

async function waitForCompletedJob(baseUrl, jobId, timeoutMs = JOB_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let job = null;
  while (Date.now() < deadline) {
    job = (await requestJson(baseUrl, `/api/tools/status/${encodeURIComponent(jobId)}`)).data;
    if (TERMINAL_JOB_STATUSES.has(job?.status)) break;
    await sleep(100);
  }
  invariant(job && TERMINAL_JOB_STATUSES.has(job.status), 'p6_restart_baseline_job_timeout');
  invariant(job.status === 'completed', `p6_restart_baseline_job_${job.status}`, job?.error || null);
  invariant(job.result?.artifactTruth?.status === 'valid'
    && job.result.artifactTruth.blocking !== true,
  'p6_restart_baseline_artifact_truth_invalid', job.result?.artifactTruth || null);
  return { ...job, id: job.id || jobId };
}

async function waitForTerminalJob(baseUrl, jobId, timeoutMs = JOB_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let job = null;
  while (Date.now() < deadline) {
    job = (await requestJson(baseUrl, `/api/tools/status/${encodeURIComponent(jobId)}`)).data;
    if (TERMINAL_JOB_STATUSES.has(job?.status)) return { ...job, id: job.id || jobId };
    await sleep(50);
  }
  throw new Error('p6_failure_job_timeout');
}

function exactJobArtifactHashes(job) {
  const provenanceById = new Map((job?.result?.executionProvenance?.artifacts || [])
    .map((artifact) => [artifact?.id, artifact]));
  const artifacts = job?.result?.artifacts || [];
  return artifacts.length > 0 && artifacts.every((artifact) => {
    const provenance = provenanceById.get(artifact?.id);
    return artifact?.path
      && SHA256.test(artifact.sha256 || '')
      && provenance?.sha256 === artifact.sha256
      && existsSync(artifact.path)
      && sha256(readFileSync(artifact.path)) === artifact.sha256;
  });
}

export async function createRealVolcanoBaseline(runtime, rowCount = 240) {
  const csv = buildP6RestartVolcanoInput(rowCount);
  const submitted = await postJson(runtime.baseUrl, '/api/tools/run', {
    toolId: 'volcano-plot',
    projectId: runtime.project.id,
    params: {
      deg_table: 'deg_table.csv',
      fc_threshold: 1,
      pval_threshold: 1.3,
      top_n: 6,
      plot_width: 3,
      plot_height: 3,
      export_dpi: 72,
    },
    files: { 'deg_table.csv': Buffer.from(csv).toString('base64') },
  });
  invariant(submitted.data?.ok === true && submitted.data?.jobId,
    'p6_restart_baseline_submission_failed', submitted.data);
  const job = await waitForCompletedJob(runtime.baseUrl, submitted.data.jobId);
  // UX1G-1 contract: every openable product job carries a conversation
  // ownership. The direct `/api/tools/run` path deliberately inserts without
  // conversation_id, so the P6 fixture binds the baseline to the live trace
  // conversation here — otherwise the renderer's fail-closed guard
  // (「这个旧结果没有可信的会话归属」) refuses the deep link and the fallback
  // binds the running candidate job instead, which hides the version panel.
  {
    const bind = openLedger(runtime.env.BIOF3_DB_PATH, { readonly: false });
    try {
      const bound = bind.prepare(
        'UPDATE tool_jobs SET conversation_id=? WHERE id=? AND conversation_id IS NULL'
      ).run(runtime.conversation.id, job.id);
      invariant(bound.changes === 1, 'p6_restart_baseline_conversation_bind_failed');
    } finally {
      bind.close();
    }
  }
  const artifact = (job.result?.artifacts || []).find((item) => item?.id === 'volcano');
  const provenanceArtifact = (job.result?.executionProvenance?.artifacts || [])
    .find((item) => item?.id === 'volcano');
  invariant(artifact?.path && SHA256.test(provenanceArtifact?.sha256 || ''),
    'p6_restart_baseline_volcano_missing');
  invariant(sha256(readFileSync(artifact.path)) === provenanceArtifact.sha256,
    'p6_restart_baseline_physical_hash_invalid');

  const query = new URLSearchParams({
    projectId: runtime.project.id,
    jobId: job.id,
    artifact: path.basename(artifact.path),
  });
  const interaction = (await requestJson(
    runtime.baseUrl,
    `/api/result-studio/interaction?${query.toString()}`,
    { timeoutMs: 120_000 },
  )).data;
  invariant(interaction?.revision?.revisionId
    && interaction.revision.validationStatus === 'valid'
    && interaction.revision.isCurrent === true,
  'p6_restart_baseline_revision_invalid', interaction?.revision || null);
  return {
    job,
    artifact,
    interaction,
    artifactHash: provenanceArtifact.sha256,
  };
}

function openLedger(dbPath, { readonly = true } = {}) {
  return new Database(dbPath, readonly ? { readonly: true, fileMustExist: true } : { fileMustExist: true });
}

function safeParse(value) {
  try { return value ? JSON.parse(value) : null; } catch { return null; }
}

function readBaselineTruth(dbPath, projectId, baselineRevisionIds) {
  const sqlite = openLedger(dbPath);
  try {
    const rows = baselineRevisionIds.map((revisionId) => sqlite.prepare(`
      SELECT revision_id, artifact_family_id, artifact_id, source_commit,
             output_path, output_hash, change_set_id, is_current
      FROM artifact_revisions WHERE project_id=? AND revision_id=?
    `).get(projectId, revisionId)).filter(Boolean);
    return {
      journalMode: sqlite.pragma('journal_mode', { simple: true }),
      rows,
      digest: sha256(JSON.stringify(rows)),
    };
  } finally {
    sqlite.close();
  }
}

function verifyCheckpoint(dbPath, checkpointId) {
  const sqlite = openLedger(dbPath);
  try {
    return createResultStudioRepository(sqlite, { ensureSchema: false })
      .verifyCheckpointIntegrity(checkpointId);
  } finally {
    sqlite.close();
  }
}

function candidateRefCommit(dbPath, projectId, workingBranchRef) {
  const sqlite = openLedger(dbPath);
  let binding;
  try {
    binding = sqlite.prepare(`
      SELECT git_dir, work_tree FROM git_repository_bindings WHERE project_id=?
    `).get(projectId);
  } finally {
    sqlite.close();
  }
  invariant(binding?.git_dir && existsSync(binding.git_dir), 'p6_restart_git_binding_missing');
  const resolved = spawnSync('git', [
    `--git-dir=${binding.git_dir}`,
    `--work-tree=${binding.work_tree}`,
    'rev-parse',
    '--verify',
    workingBranchRef,
  ], { cwd: ROOT, encoding: 'utf8' });
  return {
    commit: resolved.status === 0 ? resolved.stdout.trim() : null,
    gitDir: binding.git_dir,
    workTree: binding.work_tree,
  };
}

function runManagedGit(binding, args) {
  const result = spawnSync('git', [
    `--git-dir=${binding.gitDir}`,
    `--work-tree=${binding.workTree}`,
    ...args,
  ], { cwd: ROOT, encoding: 'utf8' });
  invariant(result.status === 0, 'p6_drift_git_command_failed', {
    operation: args[0] || null,
    status: result.status,
  });
  return result.stdout.trim();
}

export function spawnEditWorker(runtime, baseline) {
  invariant(process.platform !== 'win32',
    'p6_restart_checkpoint_hold_unsupported_platform:win32');
  const trustedRRuntimeIdentity = configuredRRuntimeIdentity(new RExecutor().binPath);
  const spec = {
    op: 'context_edit',
    projectId: runtime.project.id,
    conversationId: runtime.conversation.id,
    jobId: baseline.job.id,
    artifact: path.basename(baseline.artifact.path),
    revisionId: baseline.interaction.revision.revisionId,
    requestedOutcome: 'Use an accessible palette and larger points without changing scientific thresholds.',
    parameterPatch: {
      color_up: '#d55e00',
      color_down: '#0072b2',
      point_size: 3.2,
    },
    // Acceptance-only protocol implemented by the existing P5 worker.  It
    // stops its detached process group only after the real durable checkpoint
    // and a real candidate tool_job are both running, so the Electron trace
    // cannot race a naturally completed edit.
    acceptanceCheckpointHold: {
      version: 1,
      mode: 'sigstop_process_group',
      checkpointStage: 'candidate_committed',
      expectedToolId: 'volcano-plot',
      notBeforeEpochMs: Date.now(),
    },
  };
  const payload = Buffer.from(JSON.stringify(spec)).toString('base64url');
  const detached = process.platform !== 'win32';
  const child = spawn(process.execPath, [P5_WORKER, '--worker', payload], {
    cwd: ROOT,
    env: runtime.env,
    detached,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  return {
    child,
    detached,
    baselineJobId: baseline.job.id,
    trustedRRuntimeIdentity,
    checkpointHoldConfirmed: false,
    output: () => ({ stdout, stderr }),
  };
}

export function parseP5WorkerCheckpointHold(stdout) {
  const source = String(stdout || '');
  const marker = source.lastIndexOf(P5_WORKER_CHECKPOINT_HOLD_MARKER);
  if (marker < 0) return null;
  const tail = source.slice(marker + P5_WORKER_CHECKPOINT_HOLD_MARKER.length);
  const newline = tail.indexOf('\n');
  if (newline < 0) return null;
  try {
    const parsed = JSON.parse(tail.slice(0, newline));
    return parsed && parsed.version === 1
      && parsed.mode === 'sigstop_process_group'
      && parsed.checkpointStage === 'candidate_committed'
      && typeof parsed.changeSetId === 'string'
      && typeof parsed.checkpointId === 'string'
      && typeof parsed.candidateJobId === 'string'
      && parsed.candidateJobExact === true
      && parsed.candidateInputExact === true
      && parsed.candidateRuntimePausedBeforeCheckpoint === true
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export function inspectP6StoppedWorkerProcessGroupOutput(output, {
  workerPid,
  candidateJobId,
  workspaceRoot,
  trustedRuntimePaths = [],
  expectedRunScriptPaths = [],
  expectedJobDirPaths = [],
  runtimeExecutablePathsByPid = {},
  trustedRuntimeExecutablePaths = trustedRuntimePaths,
  trustedRuntimeExecCommandPaths = [],
} = {}) {
  // ps 输出恒为 posix 分隔符；本函数实跑平台是 Unix，但纯函数测试也要能在
  // Windows 运行——path.join/resolve 会产出反斜杠（且 resolve('/tmp/x') 会补
  // 盘符）。比对前统一归一 posix，并为 resolve 变体同时保留原始路径变体。
  const toComparablePath = (value) => String(value || '').split(path.sep).join('/');
  const rawWorkspaceRoot = String(workspaceRoot || '');
  const expectedJobDir = path.join(
    path.resolve(rawWorkspaceRoot), 'results', 'jobs', candidateJobId || '',
  );
  const expectedRunScript = path.join(
    expectedJobDir, 'run-script.R',
  );
  const expectedJobDirPosix = toComparablePath(path.join(
    rawWorkspaceRoot, 'results', 'jobs', candidateJobId || '',
  ));
  const expectedRunScriptPosix = `${expectedJobDirPosix}/run-script.R`;
  const trustedRuntimePathSet = new Set(trustedRuntimePaths.map(toComparablePath));
  const trustedRuntimeExecutablePathSet = new Set(
    trustedRuntimeExecutablePaths.map(toComparablePath),
  );
  const trustedRuntimeExecCommandPathSet = new Set(
    trustedRuntimeExecCommandPaths.map(toComparablePath),
  );
  const expectedRunScriptPathSet = new Set([
    expectedRunScript,
    expectedRunScriptPosix,
    ...expectedRunScriptPaths.map(toComparablePath),
  ]);
  const expectedJobDirPathSet = new Set([
    expectedJobDir,
    expectedJobDirPosix,
    ...expectedJobDirPaths.map(toComparablePath),
  ]);
  const groupMembers = String(output || '').split('\n').flatMap((line) => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/);
    if (!match || Number(match[3]) !== workerPid) return [];
    return [{
      pid: Number(match[1]),
      ppid: Number(match[2]),
      pgid: Number(match[3]),
      state: match[4],
      command: match[5],
    }];
  });
  const runtimeChild = groupMembers.find((member) => {
    // This acceptance runtime deliberately uses disposable paths without
    // whitespace.  Parse the exact execFile argv shape instead of accepting a
    // command substring: a helper named Rscript, or a later --note containing
    // run-script.R, must never impersonate the candidate runtime.
    const argv = member.command.trim().split(/\s+/);
    const kernelExecutablePath = toComparablePath(
      runtimeExecutablePathsByPid[member.pid] || '',
    );
    const rscriptShapeExact = argv.length === 3
      && trustedRuntimePathSet.has(toComparablePath(argv[0]))
      && expectedRunScriptPathSet.has(toComparablePath(argv[1]))
      && expectedJobDirPathSet.has(toComparablePath(argv[2]));
    const execRShapeExact = argv.length === 6
      && trustedRuntimeExecCommandPathSet.has(toComparablePath(argv[0]))
      && argv[1] === '--no-echo'
      && argv[2] === '--no-restore'
      && [...expectedRunScriptPathSet].some((runScript) => toComparablePath(argv[3]) === `--file=${runScript}`)
      && argv[4] === '--args'
      && expectedJobDirPathSet.has(toComparablePath(argv[5]));
    return member.ppid === workerPid
      && member.pid !== workerPid
      && /^T/.test(member.state)
      && trustedRuntimeExecutablePathSet.has(kernelExecutablePath)
      && (rscriptShapeExact || execRShapeExact);
  }) || null;
  return {
    groupMembers,
    workerProcessStopped: groupMembers.some((member) => (
      member.pid === workerPid && /^T/.test(member.state)
    )),
    childProcessPresent: groupMembers.some((member) => member.pid !== workerPid),
    directZombieChildPresent: groupMembers.some((member) => (
      member.ppid === workerPid && member.pid !== workerPid && /^Z/.test(member.state)
    )),
    processGroupAllStopped: groupMembers.length >= 2
      && groupMembers.every((member) => /^T/.test(member.state)),
    candidateRuntimeProcessObserved: Boolean(runtimeChild),
    candidateRuntimeDirectChild: Boolean(runtimeChild && runtimeChild.ppid === workerPid),
    candidateRuntimeCommandTrusted: Boolean(runtimeChild),
    candidateRuntimeExecutableIdentityExact: Boolean(runtimeChild),
    candidateRuntimePid: runtimeChild?.pid || null,
  };
}

export function parseP6DarwinLsofExecutablePathOutput(output, expectedPid) {
  const lines = String(output || '').split('\n').map((line) => line.trim()).filter(Boolean);
  const processMarker = `p${expectedPid}`;
  const start = lines.indexOf(processMarker);
  if (start < 0) return null;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^p\d+$/.test(lines[index])) break;
    if (lines[index] === 'ftxt' && lines[index + 1]?.startsWith('n')) {
      const filePath = lines[index + 1].slice(1);
      return path.isAbsolute(filePath) ? filePath : null;
    }
  }
  return null;
}

function readP6ProcessExecutablePath(pid) {
  try {
    if (process.platform === 'darwin') {
      const inspected = spawnSync('/usr/sbin/lsof', [
        '-a', '-p', String(pid), '-d', 'txt', '-Fn',
      ], { cwd: ROOT, encoding: 'utf8' });
      if (inspected.status !== 0) return null;
      const executablePath = parseP6DarwinLsofExecutablePathOutput(inspected.stdout, pid);
      return executablePath ? realpathSync(executablePath) : null;
    }
    if (process.platform === 'linux') {
      return realpathSync(`/proc/${pid}/exe`);
    }
  } catch {
    return null;
  }
  return null;
}

function exactExistingPathAliases(filePath, code) {
  invariant(typeof filePath === 'string' && filePath.length > 0, code);
  const resolved = path.resolve(filePath);
  invariant(!/\s/.test(resolved) && existsSync(resolved), code);
  const canonical = realpathSync(resolved);
  invariant(!/\s/.test(canonical), code);
  return [...new Set([resolved, canonical])];
}

function configuredRRuntimeIdentity(configuredRscript) {
  const rscriptCommandPaths = exactExistingPathAliases(
    configuredRscript,
    'p6_restart_configured_r_runtime_unavailable',
  );
  const homeProbe = spawnSync(configuredRscript, [
    '--vanilla', '-e', 'cat(R.home())',
  ], { cwd: ROOT, encoding: 'utf8', timeout: 5_000 });
  invariant(homeProbe.status === 0 && path.isAbsolute(String(homeProbe.stdout || '').trim()),
    'p6_restart_configured_r_home_probe_failed');
  const runtimeHome = path.resolve(String(homeProbe.stdout).trim());
  const canonicalRuntimeHome = realpathSync(runtimeHome);
  const canonicalRscript = realpathSync(path.resolve(configuredRscript));
  invariant(canonicalRscript.startsWith(`${canonicalRuntimeHome}${path.sep}`),
    'p6_restart_configured_rscript_outside_home');
  const execR = path.join(runtimeHome, 'bin', 'exec', 'R');
  const execCommandPaths = exactExistingPathAliases(
    execR,
    'p6_restart_configured_r_exec_runtime_unavailable',
  );
  const canonicalExecR = realpathSync(execR);
  invariant(canonicalExecR.startsWith(`${canonicalRuntimeHome}${path.sep}`),
    'p6_restart_configured_r_exec_runtime_outside_home');
  return Object.freeze({
    rscriptCommandPaths,
    execCommandPaths,
    executablePaths: [...new Set([...rscriptCommandPaths, ...execCommandPaths])],
  });
}

function inspectStoppedWorkerProcessGroup(worker, runtime, candidateJobId) {
  if (process.platform === 'win32') {
    throw new Error('p6_restart_checkpoint_hold_unsupported_platform:win32');
  }
  let groupAddressable = false;
  try {
    process.kill(-worker.child.pid, 0);
    groupAddressable = true;
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
  const inspected = spawnSync('ps', ['-o', 'stat=', '-p', String(worker.child.pid)], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  const processState = inspected.status === 0 ? String(inspected.stdout || '').trim() : '';
  const groupInspection = spawnSync('ps', ['-axo', 'pid=,ppid=,pgid=,stat=,command='], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  const expectedJobDir = path.join(
    runtime.project.workspace_path, 'results', 'jobs', candidateJobId,
  );
  const expectedRunScript = path.join(expectedJobDir, 'run-script.R');
  const runtimeIdentity = worker.trustedRRuntimeIdentity;
  invariant(runtimeIdentity?.rscriptCommandPaths?.length > 0
    && runtimeIdentity?.execCommandPaths?.length > 0,
  'p6_restart_trusted_r_runtime_identity_missing');
  const inspectionOutput = groupInspection.status === 0 ? groupInspection.stdout : '';
  const parserOptions = {
    workerPid: worker.child.pid,
    candidateJobId,
    workspaceRoot: runtime.project.workspace_path,
    trustedRuntimePaths: runtimeIdentity.rscriptCommandPaths,
    trustedRuntimeExecCommandPaths: runtimeIdentity.execCommandPaths,
    trustedRuntimeExecutablePaths: runtimeIdentity.executablePaths,
    expectedRunScriptPaths: exactExistingPathAliases(
      expectedRunScript,
      'p6_restart_candidate_run_script_unavailable',
    ),
    expectedJobDirPaths: exactExistingPathAliases(
      expectedJobDir,
      'p6_restart_candidate_job_dir_unavailable',
    ),
  };
  const membership = inspectP6StoppedWorkerProcessGroupOutput(inspectionOutput, parserOptions);
  const runtimeExecutablePathsByPid = Object.fromEntries(
    membership.groupMembers
      .filter((member) => member.ppid === worker.child.pid && /^T/.test(member.state))
      .map((member) => [member.pid, readP6ProcessExecutablePath(member.pid)])
      .filter(([, executablePath]) => typeof executablePath === 'string'),
  );
  const parsed = inspectP6StoppedWorkerProcessGroupOutput(inspectionOutput, {
    ...parserOptions,
    runtimeExecutablePathsByPid,
  });
  const workerProcessStopped = /^T/.test(processState) && parsed.workerProcessStopped;
  const {
    childProcessPresent,
    directZombieChildPresent,
    processGroupAllStopped,
    candidateRuntimeProcessObserved,
    candidateRuntimeDirectChild,
    candidateRuntimeCommandTrusted,
    candidateRuntimeExecutableIdentityExact,
    candidateRuntimePid,
  } = parsed;
  return {
    confirmed: groupAddressable && workerProcessStopped
      && childProcessPresent && processGroupAllStopped
      && candidateRuntimeProcessObserved
      && candidateRuntimeDirectChild
      && candidateRuntimeCommandTrusted
      && candidateRuntimeExecutableIdentityExact,
    groupAddressable,
    workerProcessStopped,
    childProcessPresent,
    directZombieChildPresent,
    processGroupAllStopped,
    groupMemberCount: parsed.groupMembers.length,
    processState: processState || null,
    candidateRuntimeProcessObserved,
    candidateRuntimeDirectChild,
    candidateRuntimeCommandTrusted,
    candidateRuntimeExecutableIdentityExact,
    candidateRuntimePid,
  };
}

function readDurableCandidateCheckpoint(dbPath, projectId, conversationId, baselineJobId) {
  const sqlite = openLedger(dbPath);
  try {
    const row = sqlite.prepare(`
      SELECT cs.change_set_id, cs.status,
             cs.candidate_commit AS change_set_candidate_commit,
             cs.working_branch_ref,
             cp.checkpoint_id, cp.change_set_status,
             cp.candidate_commit, cp.pending_preview_json,
             cp.checkpoint_hash, cp.updated_at,
             (SELECT COUNT(*) FROM artifact_revisions ar
               WHERE ar.change_set_id=cs.change_set_id) AS revision_count
      FROM scientific_change_sets cs
      JOIN workspace_revision_checkpoints cp ON cp.change_set_id=cs.change_set_id
      WHERE cs.project_id=? AND cs.conversation_id=? AND cs.status='running'
      ORDER BY cp.updated_at DESC LIMIT 1
    `).get(projectId, conversationId);
    const candidateJob = sqlite.prepare(`
      SELECT id, status, process_pid, heartbeat_at FROM tool_jobs
      WHERE project_id=? AND id<>? AND status IN ('pending', 'running')
      ORDER BY created_at DESC LIMIT 1
    `).get(projectId, baselineJobId);
    if (!row || !candidateJob) return null;
    const pendingPreview = safeParse(row.pending_preview_json);
    if (pendingPreview?.stage !== 'candidate_committed'
        || !GIT_OID.test(row.candidate_commit || '')
        || row.change_set_status !== 'running'
        || candidateJob.status !== 'running') return null;
    return { ...row, pendingPreview, candidateJob };
  } finally {
    sqlite.close();
  }
}

function readWorkerDebugState(dbPath, projectId, conversationId, baselineJobId) {
  const sqlite = openLedger(dbPath);
  try {
    const changeSets = sqlite.prepare(`
      SELECT cs.status, cs.candidate_commit, cp.change_set_status, cp.pending_preview_json
      FROM scientific_change_sets cs
      LEFT JOIN workspace_revision_checkpoints cp ON cp.change_set_id=cs.change_set_id
      WHERE cs.project_id=? AND cs.conversation_id=? ORDER BY cs.updated_at DESC
    `).all(projectId, conversationId).map((row) => ({
      status: row.status,
      candidateCommitPresent: GIT_OID.test(row.candidate_commit || ''),
      checkpointStatus: row.change_set_status,
      checkpointStage: safeParse(row.pending_preview_json)?.stage || null,
    }));
    const jobs = sqlite.prepare(`
      SELECT status, process_pid, heartbeat_at FROM tool_jobs
      WHERE project_id=? AND id<>? ORDER BY created_at DESC
    `).all(projectId, baselineJobId).map((row) => ({
      status: row.status,
      processPidPresent: Number.isInteger(row.process_pid) && row.process_pid > 0,
      heartbeatPresent: Number.isFinite(row.heartbeat_at),
    }));
    return { changeSets, jobs };
  } finally {
    sqlite.close();
  }
}

export async function waitForDurableCandidateCheckpoint(runtime, worker, timeoutMs = WORKER_CHECKPOINT_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let lastCheckpoint = null;
  let lastHandshakeSeen = false;
  let lastProcessGroup = null;
  let holdConfirmationStartedAt = null;
  while (Date.now() < deadline) {
    const checkpoint = readDurableCandidateCheckpoint(
      runtime.env.BIOF3_DB_PATH,
      runtime.project.id,
      runtime.conversation.id,
      worker.baselineJobId,
    );
    if (checkpoint) {
      lastCheckpoint = {
        status: checkpoint.status,
        checkpointStatus: checkpoint.change_set_status,
        checkpointStage: checkpoint.pendingPreview?.stage || null,
        candidateJobStatus: checkpoint.candidateJob?.status || null,
      };
      const handshake = parseP5WorkerCheckpointHold(worker.output().stdout);
      lastHandshakeSeen = Boolean(handshake);
      if (!handshake) {
        if (worker.child.exitCode !== null || worker.child.signalCode !== null) {
          const output = worker.output();
          throw Object.assign(new Error('p6_restart_worker_exited_before_checkpoint_hold'), {
            detail: {
              code: worker.child.exitCode,
              signal: worker.child.signalCode,
              stdout: output.stdout.slice(-1600),
              stderr: output.stderr.slice(-1200),
            },
          });
        }
        await sleep(5);
        continue;
      }
      invariant(handshake.changeSetId === checkpoint.change_set_id
        && handshake.checkpointId === checkpoint.checkpoint_id
        && handshake.candidateJobId === checkpoint.candidateJob.id
        && handshake.candidateJobExact === true
        && handshake.candidateInputExact === true,
      'p6_restart_checkpoint_hold_mismatch', {
        checkpoint: {
          changeSetId: checkpoint.change_set_id,
          checkpointId: checkpoint.checkpoint_id,
          candidateJobId: checkpoint.candidateJob.id,
        },
        handshake,
      });
      const processGroup = inspectStoppedWorkerProcessGroup(
        worker,
        runtime,
        checkpoint.candidateJob.id,
      );
      lastProcessGroup = {
        groupAddressable: processGroup.groupAddressable,
        workerProcessStopped: processGroup.workerProcessStopped,
        childProcessPresent: processGroup.childProcessPresent,
        directZombieChildPresent: processGroup.directZombieChildPresent,
        processGroupAllStopped: processGroup.processGroupAllStopped,
        candidateRuntimeProcessObserved: processGroup.candidateRuntimeProcessObserved,
        candidateRuntimeDirectChild: processGroup.candidateRuntimeDirectChild,
        candidateRuntimeCommandTrusted: processGroup.candidateRuntimeCommandTrusted,
        candidateRuntimeExecutableIdentityExact:
          processGroup.candidateRuntimeExecutableIdentityExact,
      };
      if (!processGroup.confirmed) {
        if (processGroup.workerProcessStopped) {
          holdConfirmationStartedAt ||= Date.now();
          if (processGroup.directZombieChildPresent
              || Date.now() - holdConfirmationStartedAt > WORKER_HOLD_CONFIRMATION_GRACE_MS) {
            throw Object.assign(new Error('p6_restart_candidate_runtime_not_live_at_hold'), {
              detail: { processGroup: lastProcessGroup },
            });
          }
        }
        if (worker.child.exitCode !== null || worker.child.signalCode !== null) {
          throw Object.assign(new Error('p6_restart_worker_exited_before_checkpoint_hold_confirmation'), {
            detail: {
              code: worker.child.exitCode,
              signal: worker.child.signalCode,
              processGroup,
            },
          });
        }
        await sleep(5);
        continue;
      }
      holdConfirmationStartedAt = null;
      const heldCheckpoint = readDurableCandidateCheckpoint(
        runtime.env.BIOF3_DB_PATH,
        runtime.project.id,
        runtime.conversation.id,
        worker.baselineJobId,
      );
      invariant(heldCheckpoint
        && heldCheckpoint.change_set_id === checkpoint.change_set_id
        && heldCheckpoint.checkpoint_id === checkpoint.checkpoint_id
        && heldCheckpoint.candidateJob.id === checkpoint.candidateJob.id,
      'p6_restart_checkpoint_changed_after_hold');
      const integrity = verifyCheckpoint(runtime.env.BIOF3_DB_PATH, checkpoint.checkpoint_id);
      const git = candidateRefCommit(
        runtime.env.BIOF3_DB_PATH,
        runtime.project.id,
        checkpoint.working_branch_ref,
      );
      if (integrity.matches === true && git.commit === checkpoint.candidate_commit) {
        invariant(checkpoint.pendingPreview?.runtimeLease?.instanceId,
          'p6_restart_checkpoint_runtime_lease_missing');
        worker.checkpointHoldConfirmed = true;
        worker.candidateRuntimePid = processGroup.candidateRuntimePid;
        return {
          checkpoint: heldCheckpoint,
          integrity,
          git,
          hold: {
            confirmed: true,
            mode: handshake.mode,
            groupAddressable: processGroup.groupAddressable,
            workerProcessStopped: processGroup.workerProcessStopped,
            childProcessPresent: processGroup.childProcessPresent,
            processGroupAllStopped: processGroup.processGroupAllStopped,
            groupMemberCount: processGroup.groupMemberCount,
            candidateRuntimeProcessObserved: processGroup.candidateRuntimeProcessObserved,
            candidateRuntimeDirectChild: processGroup.candidateRuntimeDirectChild,
            candidateRuntimeCommandTrusted: processGroup.candidateRuntimeCommandTrusted,
            candidateRuntimeExecutableIdentityExact:
              processGroup.candidateRuntimeExecutableIdentityExact,
            candidateRuntimePid: processGroup.candidateRuntimePid,
            candidateJobExact: handshake.candidateJobExact === true,
            candidateInputExact: handshake.candidateInputExact === true,
            candidateRuntimePausedBeforeCheckpoint:
              handshake.candidateRuntimePausedBeforeCheckpoint === true,
          },
        };
      }
    }
    if (worker.child.exitCode !== null || worker.child.signalCode !== null) {
      const output = worker.output();
      throw Object.assign(new Error('p6_restart_worker_exited_before_checkpoint'), {
        detail: {
          code: worker.child.exitCode,
          signal: worker.child.signalCode,
          stdout: output.stdout.slice(-1600),
          stderr: output.stderr.slice(-1200),
          state: readWorkerDebugState(
            runtime.env.BIOF3_DB_PATH,
            runtime.project.id,
            runtime.conversation.id,
            worker.baselineJobId,
          ),
        },
      });
    }
    await sleep(5);
  }
  const output = worker.output();
  throw Object.assign(new Error('p6_restart_candidate_checkpoint_timeout'), {
    detail: {
      code: worker.child.exitCode,
      signal: worker.child.signalCode,
      stdout: output.stdout.slice(-1600),
      stderr: output.stderr.slice(-1200),
      state: readWorkerDebugState(
        runtime.env.BIOF3_DB_PATH,
        runtime.project.id,
        runtime.conversation.id,
        worker.baselineJobId,
      ),
      lastCheckpoint,
      lastHandshakeSeen,
      lastProcessGroup,
    },
  });
}

export async function killWorkerWithSigkill(worker) {
  invariant(worker.child.exitCode === null && worker.child.signalCode === null,
    'p6_restart_worker_exited_before_sigkill', {
      code: worker.child.exitCode,
      signal: worker.child.signalCode,
      completionMarkerSeen: worker.output().stdout.includes(WORKER_MARKER),
    });
  const exit = new Promise((resolve) => {
    worker.child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  try {
    if (worker.detached) {
      process.kill(-worker.child.pid, 'SIGKILL');
    } else {
      worker.child.kill('SIGKILL');
    }
  } catch (error) {
    throw Object.assign(new Error('p6_restart_worker_sigkill_failed'), {
      code: 'p6_restart_worker_sigkill_failed',
      cause: error,
      detail: {
        errorCode: error?.code || null,
        completionMarkerSeen: worker.output().stdout.includes(WORKER_MARKER),
      },
    });
  }
  let exitTimeout = null;
  const timeout = new Promise((_, reject) => {
    exitTimeout = setTimeout(() => reject(new Error('p6_restart_sigkill_exit_timeout')), 10_000);
  });
  let outcome;
  try {
    outcome = await Promise.race([exit, timeout]);
  } finally {
    clearTimeout(exitTimeout);
  }
  invariant(outcome.signal === 'SIGKILL', 'p6_restart_worker_not_sigkilled', outcome);
  invariant(!worker.output().stdout.includes(WORKER_MARKER),
    'p6_restart_worker_completed_before_sigkill');
  const goneBefore = async (deadline, target) => {
    while (Date.now() < deadline) {
      try {
        process.kill(target, 0);
      } catch (error) {
        if (error?.code === 'ESRCH') return true;
        throw error;
      }
      await sleep(10);
    }
    try {
      process.kill(target, 0);
      return false;
    } catch (error) {
      if (error?.code === 'ESRCH') return true;
      throw error;
    }
  };
  const deadline = Date.now() + 2_000;
  const processGroupGone = worker.detached
    ? await goneBefore(deadline, -worker.child.pid)
    : true;
  const candidateRuntimeProcessGone = Number.isInteger(worker.candidateRuntimePid)
    ? await goneBefore(deadline, worker.candidateRuntimePid)
    : false;
  invariant(processGroupGone && candidateRuntimeProcessGone,
    'p6_restart_worker_process_group_survived_sigkill', {
      processGroupGone,
      candidateRuntimeProcessGone,
    });
  return { ...outcome, processGroupGone, candidateRuntimeProcessGone };
}

function processExited(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return error?.code === 'ESRCH';
  }
}

function readInterruptedTruth(dbPath, changeSetId) {
  const sqlite = openLedger(dbPath);
  try {
    const changeSet = sqlite.prepare(`
      SELECT status, status_reason, candidate_commit, working_branch_ref,
             candidate_artifact_refs_json, job_refs_json, validation_summary_json
      FROM scientific_change_sets WHERE change_set_id=?
    `).get(changeSetId);
    const checkpoint = sqlite.prepare(`
      SELECT checkpoint_id, change_set_status, candidate_commit, pending_preview_json,
             job_refs_json, checkpoint_hash
      FROM workspace_revision_checkpoints WHERE change_set_id=?
      ORDER BY updated_at DESC LIMIT 1
    `).get(changeSetId);
    const revisions = sqlite.prepare(`
      SELECT revision_id, is_current FROM artifact_revisions WHERE change_set_id=?
    `).all(changeSetId);
    const jobs = sqlite.prepare(`
      SELECT id, status, result_json FROM tool_jobs
      WHERE id IN (SELECT value FROM json_each(COALESCE(?, '[]')))
    `).all(changeSet?.job_refs_json || '[]');
    return {
      changeSet,
      checkpoint: checkpoint ? {
        ...checkpoint,
        pendingPreview: safeParse(checkpoint.pending_preview_json),
      } : null,
      revisions,
      jobs: jobs.map((job) => ({
        status: job.status,
        artifactTruthStatus: safeParse(job.result_json)?.artifactTruth?.status || null,
      })),
    };
  } finally {
    sqlite.close();
  }
}

function readJobTruth(dbPath, jobId) {
  const sqlite = openLedger(dbPath);
  try {
    const row = sqlite.prepare(`
      SELECT id, status, result_json, completed_at, process_pid FROM tool_jobs WHERE id=?
    `).get(jobId);
    const result = row ? safeParse(row.result_json) : null;
    return row ? {
      status: row.status,
      artifactTruthStatus: result?.artifactTruth?.status || null,
      completed: Number.isFinite(row.completed_at),
      processPid: Number.isInteger(row.process_pid) ? row.process_pid : null,
      cancellation: result?.cancellation || null,
      resourceSamplingStatus: result?.resourceUsage?.sampling?.status || null,
      resourceSampleCount: Number.isInteger(result?.resourceUsage?.sampling?.sampleCount)
        ? result.resourceUsage.sampling.sampleCount
        : null,
      resourcePeakStatus: result?.resourceUsage?.peakStatus || null,
    } : null;
  } finally {
    sqlite.close();
  }
}

async function waitForInterruptedJobTerminal(dbPath, jobId, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  let job = null;
  while (Date.now() < deadline) {
    job = readJobTruth(dbPath, jobId);
    if (job && TERMINAL_JOB_STATUSES.has(job.status)) return job;
    await sleep(50);
  }
  return job;
}

async function waitForCancelledJobResourceSummary(dbPath, jobId, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  let job = null;
  while (Date.now() < deadline) {
    job = readJobTruth(dbPath, jobId);
    if (job?.status === 'cancelled'
        && job.cancellation?.terminalStatus === 'cancelled'
        && job.cancellation?.processExitConfirmed === true
        && job.resourceSamplingStatus === 'measured'
        && job.resourceSampleCount > 0) return job;
    await sleep(50);
  }
  return job;
}

function physicalBaselineStillExact(workspaceRoot, baselineTruth) {
  return baselineTruth.rows.length > 0 && baselineTruth.rows.every((revision) => {
    const target = path.resolve(workspaceRoot, revision.output_path);
    return target.startsWith(path.resolve(workspaceRoot) + path.sep)
      && existsSync(target)
      && sha256(readFileSync(target)) === revision.output_hash
      && revision.is_current === 1;
  });
}

function publicStatusShape(status) {
  const lifecycle = status?.lifecycle || status;
  return {
    status: lifecycle?.status || null,
    checkpointIntegrity: lifecycle?.checkpointIntegrity || null,
    consistency: lifecycle?.consistency || null,
    interruptedCount: lifecycle?.interrupted?.length || 0,
    activeOperationCount: lifecycle?.activeOperations?.length || 0,
    pendingDecisionCount: lifecycle?.pendingDecisions?.length || 0,
    pendingIssues: (lifecycle?.pendingIssues || []).map((item) => item.kind).sort(),
    revisionIntegrityStatus: lifecycle?.revisionIntegrity?.status || null,
    revisionIntegrityIssues: (lifecycle?.revisionIntegrity?.issues || [])
      .map((item) => item.kind).sort(),
    interrupted: (lifecycle?.interrupted || []).map((item) => ({
      status: item.status,
      checkpointStage: item.checkpointStage,
      preservedRevisionCount: item.preservedRevisionCount,
    })),
  };
}

export function evaluateP6RealRestartPrototype(observation) {
  const checks = {
    noSeedProductRuntime: observation.noSeedSeededTableCount === 0,
    realBaselineTruth: observation.baselineJobCompleted
      && observation.baselineArtifactTruthValid
      && observation.baselineRevisionCount >= 3,
    realJobResourceSampling: observation.baselineResourceSamplingMeasured
      && observation.baselineCpuPeakMeasured
      && observation.baselineRssPeakMeasured
      && observation.baselineOutputPeakMeasured
      && observation.baselineSystemResourcesMeasured
      && observation.baselineActiveJobPeakMeasured,
    checkpointDurableBeforeKill: observation.checkpointIntegrityBeforeKill === true
      && observation.checkpointStageBeforeKill === 'candidate_committed'
      && observation.candidateRefMatchedBeforeKill === true
      && observation.candidateJobRunningBeforeKill === true
      && observation.workerCheckpointHoldConfirmed === true
      && observation.workerCheckpointHoldMode === 'sigstop_process_group'
      && observation.processGroupAliveBeforeKill === true
      && observation.candidateChildPresentBeforeKill === true
      && observation.candidateJobExactBeforeKill === true
      && observation.candidateInputExactBeforeKill === true
      && observation.candidateRuntimePausedBeforeCheckpoint === true
      && observation.candidateRuntimeProcessObservedBeforeKill === true
      && observation.candidateRuntimeDirectChildBeforeKill === true
      && observation.candidateRuntimeCommandTrustedBeforeKill === true
      && observation.candidateRuntimeExecutableIdentityExactBeforeKill === true
      && observation.processGroupAllStoppedBeforeKill === true,
    actualSigkill: observation.workerExitSignal === 'SIGKILL'
      && observation.workerCompletionMarkerSeen === false
      && observation.processGroupGoneAfterKill === true
      && observation.candidateRuntimeProcessGoneAfterKill === true,
    sameDurableStores: observation.sqliteFileIdentityStable
      && observation.sqliteJournalModeBefore === 'wal'
      && observation.sqliteJournalModeAfter === 'wal'
      && observation.workspaceStable
      && observation.gitBindingStable,
    restartDetectsInterruption: observation.firstColdStatus?.status === 'recovery_available'
      && observation.firstColdStatus.checkpointIntegrity?.matches === true
      && observation.firstColdStatus.consistency?.status === 'consistent'
      && observation.firstColdStatus.interruptedCount === 1
      && observation.firstColdStatus.activeOperationCount === 0
      && observation.firstColdStatus.pendingIssues.length === 0,
    failClosedRecovery: observation.recoveryHttpStatus === 200
      && observation.recoveryRepairKinds.includes('running_to_validation_failed')
      && observation.recoveredChangeSetStatus === 'validation_failed'
      && observation.recoveredCheckpointStatus === 'validation_failed'
      && observation.recoveredRevisionCount === 0,
    artifactAndCurrentTruthPreserved: observation.baselineDigestStable
      && observation.baselineArtifactsExactAfterRecovery,
    secondColdBootIdempotent: observation.secondColdStatus?.status === 'ready'
      && observation.secondColdStatus.checkpointIntegrity?.matches === true
      && observation.secondColdStatus.consistency?.status === 'consistent'
      && observation.secondColdStatus.interruptedCount === 0
      && observation.secondRecoveryRecovered === false,
    noZombieJobTruth: observation.interruptedJobsTerminal === true,
  };
  return { checks, passed: Object.values(checks).every(Boolean) };
}

export function evaluateP6RealStopPrototype(observation) {
  const checks = {
    realCancelRoute: observation.cancelHttpStatus === 200
      && observation.cancelResponseStatus === 'cancelled'
      && observation.cancelTerminationConfirmed === true,
    cancelledJobTerminal: observation.cancelledJobStatus === 'cancelled'
      && observation.cancelledJobCompleted === true
      && observation.cancelledProcessExited === true
      && observation.cancelledResourceSamplingStatus === 'measured'
      && observation.cancelledResourceSampleCount > 0
      && ['measured', 'partial_process_peak_unavailable'].includes(observation.cancelledResourcePeakStatus)
      && observation.cancelledResourceProcessExitConfirmed === true,
    noResultStudioPartialWrite: observation.changeSetCountBefore === observation.changeSetCountAfter
      && observation.revisionCountBefore === observation.revisionCountAfter,
    baselinePreserved: observation.baselineDigestStable === true
      && observation.baselineArtifactsExact === true,
    workspaceConverged: observation.workspaceStatus?.status === 'ready'
      && observation.workspaceStatus?.interruptedCount === 0
      && observation.workspaceStatus?.activeOperationCount === 0
      && observation.workspaceStatus?.pendingIssues?.length === 0,
  };
  return { checks, passed: Object.values(checks).every(Boolean) };
}

export function evaluateP6RealFailurePrototype(observation) {
  const checks = {
    realRProcessFailed: observation.failedJobStatus === 'failed'
      && observation.failedJobCompleted === true
      && observation.failedProcessExited === true,
    failedJobLeftNoPartialResultStudioWrite:
      observation.changeSetCountBeforeFailure === observation.changeSetCountAfterFailure
      && observation.revisionCountBeforeFailure === observation.revisionCountAfterFailure,
    validJobRecoveredAfterRFailure: observation.recoveryJobStatus === 'completed'
      && observation.recoveryJobArtifactTruthStatus === 'valid'
      && observation.recoveryJobArtifactsExact === true,
    realValidatorBlockedScientificOutput: observation.validatorJobStatus === 'completed'
      && observation.validatorJobArtifactTruthStatus === 'valid'
      && observation.validatorJobArtifactsExact === true
      && observation.validatorHttpStatus === 200
      && observation.validatorRevisionCreated === false
      && observation.validatorDiagnosticCode === 'baseline_plugin_validation_failed',
    validatorLeftNoPartialResultStudioWrite:
      observation.changeSetCountBeforeValidator === observation.changeSetCountAfterValidator
      && observation.revisionCountBeforeValidator === observation.revisionCountAfterValidator,
    baselinePreservedAcrossFailures: observation.baselineDigestStable === true
      && observation.baselineArtifactsExact === true,
    workspaceConverged: observation.workspaceStatus?.status === 'ready'
      && observation.workspaceStatus?.interruptedCount === 0
      && observation.workspaceStatus?.activeOperationCount === 0
      && observation.workspaceStatus?.pendingIssues?.length === 0,
  };
  return { checks, passed: Object.values(checks).every(Boolean) };
}

export function evaluateP6RealDriftPrototype(observation) {
  const checks = {
    dirtyGitPreserved: observation.dirtyGitDetected === true
      && observation.dirtyMarkerHashStable === true,
    artifactDriftFailsClosed: observation.artifactDriftStatus?.status === 'blocked'
      && observation.artifactDriftStatus.revisionIntegrityIssues.includes('artifact_hash_drift')
      && observation.artifactRecoverHttpStatus === 409
      && observation.artifactRecoverAfterStatus === 'blocked'
      && observation.afterArtifactRestoreStatus?.status === 'ready',
    refDriftFailsClosed: observation.refDriftStatus?.status === 'blocked'
      && observation.refDriftStatus.revisionIntegrityIssues.includes('current_ref_drift')
      && observation.refRecoverHttpStatus === 409
      && observation.refRecoverAfterStatus === 'blocked'
      && observation.afterRefRestoreStatus?.status === 'ready',
    scriptDriftAndMissingFailClosed: observation.scriptHashRevisionCreated === false
      && observation.scriptHashDiagnosticCode === 'background_source_script_drift'
      && observation.scriptMissingRevisionCreated === false
      && observation.scriptMissingDiagnosticCode === 'source_script_missing'
      && observation.scriptDriftChangeSetCountStable === true
      && observation.scriptDriftRevisionCountStable === true,
    staleSelectionExcluded: observation.selectionCompatibility === 'stale'
      && observation.contextSelectionCompatibility === 'stale'
      && observation.contextSelectionExcluded === true
      && observation.oldContextHttpStatus === 409
      && observation.oldContextErrorCode === 'context_token_stale'
      && observation.oldContextWriteCountsStable === true,
    pluginUpgradeBlocksReplayOnly: observation.coldBootStatus?.status === 'ready'
      && observation.historySourceStillExact === true
      && observation.pluginReplayHttpStatus === 409
      && observation.pluginReplayErrorCode === 'replay_plugin_version_drift'
      && observation.pluginReplayWriteCountsStable === true,
    authoritativeArtifactsPreserved: observation.currentRevisionArtifactsExact === true,
  };
  return { checks, passed: Object.values(checks).every(Boolean) };
}

/**
 * Exercise the product cancel route against a real long-running DESeq2 Job
 * while an existing Result Studio baseline remains current. Like the restart
 * prototype, this returns bounded facts and never writes canonical evidence.
 */
export async function captureP6RealStopPrototype({ keep = false, verbose = false } = {}) {
  let runtime = null;
  let root = null;
  try {
    runtime = await createP5LiveScientificRuntime({ verbose });
    root = runtime.root;
    const baseline = await createRealVolcanoBaseline(runtime);
    const sqlite = openLedger(runtime.env.BIOF3_DB_PATH);
    let baselineRevisionIds;
    try {
      baselineRevisionIds = sqlite.prepare(`
        SELECT revision_id FROM artifact_revisions
        WHERE project_id=? AND change_set_id=? ORDER BY artifact_id
      `).all(runtime.project.id, baseline.interaction.revision.changeSetId)
        .map((row) => row.revision_id);
    } finally {
      sqlite.close();
    }
    const baselineBefore = readBaselineTruth(
      runtime.env.BIOF3_DB_PATH,
      runtime.project.id,
      baselineRevisionIds,
    );
    const countsBefore = readResultStudioCounts(runtime.env.BIOF3_DB_PATH, runtime.project.id);
    const stopJobId = await submitP6StopJob(runtime);
    const running = await waitForRunningJobProcess(runtime.env.BIOF3_DB_PATH, stopJobId);
    const cancelled = await postJson(
      runtime.baseUrl,
      `/api/tools/cancel/${encodeURIComponent(stopJobId)}`,
      {},
      30_000,
    );
    const job = await waitForCancelledJobResourceSummary(runtime.env.BIOF3_DB_PATH, stopJobId, 10_000);
    const countsAfter = readResultStudioCounts(runtime.env.BIOF3_DB_PATH, runtime.project.id);
    const baselineAfter = readBaselineTruth(
      runtime.env.BIOF3_DB_PATH,
      runtime.project.id,
      baselineRevisionIds,
    );
    const workspaceStatus = publicStatusShape((await requestJson(
      runtime.baseUrl,
      `/api/result-studio/workspace/status?${new URLSearchParams({
        projectId: runtime.project.id,
        conversationId: runtime.conversation.id,
      }).toString()}`,
      { timeoutMs: 120_000 },
    )).data);
    const observation = {
      prototype: 'real_user_stop_noncanonical',
      cancelHttpStatus: cancelled.status,
      cancelResponseStatus: cancelled.data?.status || null,
      cancelTerminationConfirmed: cancelled.data?.local?.killed === true,
      cancelledJobStatus: job?.status || null,
      cancelledJobCompleted: job?.completed === true,
      cancelledProcessExited: processExited(running.process_pid),
      cancelledResourceSamplingStatus: job?.resourceSamplingStatus || null,
      cancelledResourceSampleCount: job?.resourceSampleCount ?? null,
      cancelledResourcePeakStatus: job?.resourcePeakStatus || null,
      cancelledResourceProcessExitConfirmed: job?.cancellation?.processExitConfirmed === true,
      changeSetCountBefore: countsBefore.changeSets,
      changeSetCountAfter: countsAfter.changeSets,
      revisionCountBefore: countsBefore.revisions,
      revisionCountAfter: countsAfter.revisions,
      baselineDigestStable: baselineBefore.digest === baselineAfter.digest,
      baselineArtifactsExact: physicalBaselineStillExact(runtime.project.workspace_path, baselineAfter),
      workspaceStatus,
      qualificationEligible: false,
      providerUsed: false,
      packagedAppUsed: false,
    };
    return { ...observation, ...evaluateP6RealStopPrototype(observation), kept: keep };
  } finally {
    if (runtime && runtime.closed !== true) await runtime.close({ removeRoot: !keep });
    if (!keep && root && existsSync(root)) rmSync(root, { recursive: true, force: true });
  }
}

/**
 * Exercise two distinct real failure boundaries: an admitted R process exits
 * non-zero before Artifact Truth, then another admitted Job completes with
 * physical Artifact Truth but is rejected by its scientific validator.
 */
export async function captureP6RealFailurePrototype({ keep = false, verbose = false } = {}) {
  let runtime = null;
  let root = null;
  try {
    runtime = await createP5LiveScientificRuntime({ verbose });
    root = runtime.root;
    const baseline = await createRealVolcanoBaseline(runtime);
    const sqlite = openLedger(runtime.env.BIOF3_DB_PATH);
    let baselineRevisionIds;
    try {
      baselineRevisionIds = sqlite.prepare(`
        SELECT revision_id FROM artifact_revisions
        WHERE project_id=? AND change_set_id=? ORDER BY artifact_id
      `).all(runtime.project.id, baseline.interaction.revision.changeSetId)
        .map((row) => row.revision_id);
    } finally {
      sqlite.close();
    }
    const baselineBefore = readBaselineTruth(
      runtime.env.BIOF3_DB_PATH,
      runtime.project.id,
      baselineRevisionIds,
    );

    const countsBeforeFailure = readResultStudioCounts(runtime.env.BIOF3_DB_PATH, runtime.project.id);
    const failedJobId = await submitP6VolcanoJob(runtime, buildP6FailingVolcanoInput());
    const failedJob = await waitForTerminalJob(runtime.baseUrl, failedJobId);
    const failedLedger = readJobTruth(runtime.env.BIOF3_DB_PATH, failedJobId);
    const countsAfterFailure = readResultStudioCounts(runtime.env.BIOF3_DB_PATH, runtime.project.id);

    const recoveryJobId = await submitP6VolcanoJob(runtime, buildP6RestartVolcanoInput(80));
    const recoveryJob = await waitForCompletedJob(runtime.baseUrl, recoveryJobId);

    const countsBeforeValidator = readResultStudioCounts(runtime.env.BIOF3_DB_PATH, runtime.project.id);
    const validatorJobId = await submitP6ValidatorBlockedJob(runtime);
    const validatorJob = await waitForCompletedJob(runtime.baseUrl, validatorJobId);
    const validatorArtifact = (validatorJob.result?.artifacts || [])
      .find((artifact) => artifact?.id === 'corr_matrix');
    invariant(validatorArtifact?.path, 'p6_validator_matrix_artifact_missing');
    let validatorHttpStatus = null;
    let validatorRevisionCreated = false;
    let validatorDiagnosticCode = null;
    try {
      const query = new URLSearchParams({
        projectId: runtime.project.id,
        jobId: validatorJob.id,
        artifact: path.basename(validatorArtifact.path),
      });
      const response = await requestJson(runtime.baseUrl, `/api/result-studio/interaction?${query.toString()}`, {
        timeoutMs: 120_000,
      });
      validatorHttpStatus = response.status;
      validatorRevisionCreated = !!response.data?.revision?.revisionId;
      validatorDiagnosticCode = (response.data?.manifest?.diagnostics || [])
        .find((diagnostic) => diagnostic?.code === 'baseline_plugin_validation_failed')?.code || null;
    } catch (error) {
      validatorHttpStatus = error.status || null;
      validatorDiagnosticCode = error.code || null;
    }
    const countsAfterValidator = readResultStudioCounts(runtime.env.BIOF3_DB_PATH, runtime.project.id);
    const baselineAfter = readBaselineTruth(
      runtime.env.BIOF3_DB_PATH,
      runtime.project.id,
      baselineRevisionIds,
    );
    const workspaceStatus = publicStatusShape((await requestJson(
      runtime.baseUrl,
      `/api/result-studio/workspace/status?${new URLSearchParams({
        projectId: runtime.project.id,
        conversationId: runtime.conversation.id,
      }).toString()}`,
      { timeoutMs: 120_000 },
    )).data);
    const observation = {
      prototype: 'real_r_failure_and_validator_block_noncanonical',
      failedJobStatus: failedJob.status || null,
      failedJobCompleted: failedLedger?.completed === true,
      failedProcessExited: processExited(failedLedger?.processPid),
      changeSetCountBeforeFailure: countsBeforeFailure.changeSets,
      changeSetCountAfterFailure: countsAfterFailure.changeSets,
      revisionCountBeforeFailure: countsBeforeFailure.revisions,
      revisionCountAfterFailure: countsAfterFailure.revisions,
      recoveryJobStatus: recoveryJob.status || null,
      recoveryJobArtifactTruthStatus: recoveryJob.result?.artifactTruth?.status || null,
      recoveryJobArtifactsExact: exactJobArtifactHashes(recoveryJob),
      validatorJobStatus: validatorJob.status || null,
      validatorJobArtifactTruthStatus: validatorJob.result?.artifactTruth?.status || null,
      validatorJobArtifactsExact: exactJobArtifactHashes(validatorJob),
      validatorHttpStatus,
      validatorRevisionCreated,
      validatorDiagnosticCode,
      changeSetCountBeforeValidator: countsBeforeValidator.changeSets,
      changeSetCountAfterValidator: countsAfterValidator.changeSets,
      revisionCountBeforeValidator: countsBeforeValidator.revisions,
      revisionCountAfterValidator: countsAfterValidator.revisions,
      baselineDigestStable: baselineBefore.digest === baselineAfter.digest,
      baselineArtifactsExact: physicalBaselineStillExact(runtime.project.workspace_path, baselineAfter),
      workspaceStatus,
      qualificationEligible: false,
      providerUsed: false,
      packagedAppUsed: false,
    };
    return { ...observation, ...evaluateP6RealFailurePrototype(observation), kept: keep };
  } finally {
    if (runtime && runtime.closed !== true) await runtime.close({ removeRoot: !keep });
    if (!keep && root && existsSync(root)) rmSync(root, { recursive: true, force: true });
  }
}

export async function captureP6RealDriftPrototype({ keep = false, verbose = false } = {}) {
  let runtime = null;
  let coldServer = null;
  let root = null;
  try {
    runtime = await createP5LiveScientificRuntime({
      verbose,
      beforeStart({ root: disposableRoot, env }) {
        // BLOCK-83/84 后领域插件唯一来源=已安装领域包：server 启动时读
        // <BIOF3_LOCAL_DATA_DIR>/packs/installed.json → 追加包 plugins 源 +
        // 注册领域工具表。隔离运行时按同一接线：dataDir 指向一次性根并
        // 落安装记录。包缺失显式失败，绝不静默降级为无领域工具的空转。
        const coreBuiltIns = path.join(ROOT, 'resources/built-in-plugins');
        if (existsSync(coreBuiltIns)) {
          const isolatedBuiltIns = path.join(disposableRoot, 'built-in-plugins');
          cpSync(coreBuiltIns, isolatedBuiltIns, { recursive: true });
          env.BIOF3_BUILT_IN_PLUGINS_DIR = isolatedBuiltIns;
          return;
        }
        const packRoot = findBioPackRoot();
        if (!packRoot) {
          throw Object.assign(new Error('p6_restart_bio_pack_root_missing'), {
            code: 'p6_restart_bio_pack_root_missing',
            detail: { hint: 'set BIOF3_BIO_PACK_ROOT or check out gewu-pack-bio as a sibling directory' },
          });
        }
        env.BIOF3_LOCAL_DATA_DIR = disposableRoot;
        const { installPack } = require('../core/shared-backend/pack-registry.js');
        const installed = installPack(disposableRoot, packRoot);
        if (!installed.ok) {
          throw Object.assign(new Error('p6_restart_bio_pack_install_failed'), {
            code: 'p6_restart_bio_pack_install_failed',
            detail: { error: installed.error, packRoot },
          });
        }
      },
    });
    root = runtime.root;
    const dirtyMarker = path.join(runtime.project.workspace_path, 'user-notes.txt');
    const dirtyMarkerBytes = Buffer.from('user-owned dirty workspace bytes\n');
    writeFileSync(dirtyMarker, dirtyMarkerBytes);
    const dirtyMarkerHash = sha256(dirtyMarkerBytes);

    const baseline = await createRealVolcanoBaseline(runtime);
    const baselineRevisionId = baseline.interaction.revision.revisionId;
    const baselineTruth = readBaselineTruth(
      runtime.env.BIOF3_DB_PATH,
      runtime.project.id,
      [baselineRevisionId],
    );
    const binding = candidateRefCommit(
      runtime.env.BIOF3_DB_PATH,
      runtime.project.id,
      `refs/heads/biof3/current/${baseline.interaction.revision.artifactFamilyId}`,
    );
    const dirtyGitDetected = runManagedGit(binding, ['status', '--porcelain'])
      .split('\n').some((line) => line.endsWith('user-notes.txt'));

    const artifactRow = baselineTruth.rows[0];
    const artifactPath = path.resolve(runtime.project.workspace_path, artifactRow.output_path);
    const artifactBytes = readFileSync(artifactPath);
    writeFileSync(artifactPath, Buffer.concat([artifactBytes, Buffer.from('external-drift')]));
    const artifactDriftStatus = publicStatusShape((await requestJson(
      runtime.baseUrl,
      `/api/result-studio/workspace/status?${new URLSearchParams({
        projectId: runtime.project.id,
        conversationId: runtime.conversation.id,
      }).toString()}`,
      { timeoutMs: 120_000 },
    )).data);
    const artifactRecover = await requestJsonResponse(
      runtime.baseUrl,
      '/api/result-studio/workspace/recover',
      {
        method: 'POST',
        body: JSON.stringify({
          projectId: runtime.project.id,
          conversationId: runtime.conversation.id,
        }),
        timeoutMs: 120_000,
      },
    );
    writeFileSync(artifactPath, artifactBytes);
    const afterArtifactRestoreStatus = publicStatusShape((await requestJson(
      runtime.baseUrl,
      `/api/result-studio/workspace/status?${new URLSearchParams({
        projectId: runtime.project.id,
        conversationId: runtime.conversation.id,
      }).toString()}`,
      { timeoutMs: 120_000 },
    )).data);

    const currentRef = `refs/heads/biof3/current/${artifactRow.artifact_family_id}`;
    const alternateCommit = runManagedGit(binding, ['rev-parse', '--verify', 'refs/heads/biof3/main']);
    invariant(alternateCommit !== artifactRow.source_commit, 'p6_drift_alternate_commit_not_distinct');
    runManagedGit(binding, ['update-ref', currentRef, alternateCommit, artifactRow.source_commit]);
    const refDriftStatus = publicStatusShape((await requestJson(
      runtime.baseUrl,
      `/api/result-studio/workspace/status?${new URLSearchParams({
        projectId: runtime.project.id,
        conversationId: runtime.conversation.id,
      }).toString()}`,
      { timeoutMs: 120_000 },
    )).data);
    const refRecover = await requestJsonResponse(
      runtime.baseUrl,
      '/api/result-studio/workspace/recover',
      {
        method: 'POST',
        body: JSON.stringify({
          projectId: runtime.project.id,
          conversationId: runtime.conversation.id,
        }),
        timeoutMs: 120_000,
      },
    );
    runManagedGit(binding, ['update-ref', currentRef, artifactRow.source_commit, alternateCommit]);
    const afterRefRestoreStatus = publicStatusShape((await requestJson(
      runtime.baseUrl,
      `/api/result-studio/workspace/status?${new URLSearchParams({
        projectId: runtime.project.id,
        conversationId: runtime.conversation.id,
      }).toString()}`,
      { timeoutMs: 120_000 },
    )).data);

    const scriptJobId = await submitP6VolcanoJob(runtime, buildP6RestartVolcanoInput(80));
    const scriptJob = await waitForCompletedJob(runtime.baseUrl, scriptJobId);
    const scriptSnapshotPath = scriptJob.result?.executionProvenance?.script?.snapshotPath;
    invariant(scriptSnapshotPath && existsSync(scriptSnapshotPath), 'p6_drift_script_snapshot_missing_before_test');
    const scriptSnapshotBytes = readFileSync(scriptSnapshotPath);
    const scriptArtifact = (scriptJob.result?.artifacts || []).find((artifact) => artifact?.id === 'volcano');
    const scriptCountsBefore = readResultStudioCounts(runtime.env.BIOF3_DB_PATH, runtime.project.id);
    writeFileSync(scriptSnapshotPath, Buffer.concat([scriptSnapshotBytes, Buffer.from('\n# external drift\n')]));
    const scriptQuery = new URLSearchParams({
      projectId: runtime.project.id,
      jobId: scriptJob.id,
      artifact: path.basename(scriptArtifact.path),
    });
    const scriptHashResponse = await requestJson(
      runtime.baseUrl,
      `/api/result-studio/interaction?${scriptQuery.toString()}`,
      { timeoutMs: 120_000 },
    );
    writeFileSync(scriptSnapshotPath, scriptSnapshotBytes);
    rmSync(scriptSnapshotPath);
    const scriptMissingResponse = await requestJson(
      runtime.baseUrl,
      `/api/result-studio/interaction?${scriptQuery.toString()}`,
      { timeoutMs: 120_000 },
    );
    const scriptCountsAfter = readResultStudioCounts(runtime.env.BIOF3_DB_PATH, runtime.project.id);

    const selectionId = `sel_${randomUUID().replace(/-/g, '')}`;
    await postJson(runtime.baseUrl, '/api/result-studio/selection', {
      selectionId,
      projectId: runtime.project.id,
      conversationId: runtime.conversation.id,
      artifactId: baseline.interaction.manifest.artifactId,
      revisionId: baselineRevisionId,
      entityType: baseline.interaction.manifest.entityType,
      entityIds: ['GENE_0001'],
      entityIdCount: 1,
      displayState: { durable: true, source: 'p6_real_stale_selection' },
    });
    const baselineContext = (await requestJson(
      runtime.baseUrl,
      `/api/result-studio/context-envelope?${new URLSearchParams({
        projectId: runtime.project.id,
        conversationId: runtime.conversation.id,
        jobId: baseline.job.id,
        artifact: path.basename(baseline.artifact.path),
        revisionId: baselineRevisionId,
      }).toString()}`,
    )).data;
    invariant(baselineContext?.envelope?.contextToken, 'p6_drift_baseline_context_missing');
    const secondBaseline = await createRealVolcanoBaseline(runtime, 90);
    const secondRevision = secondBaseline.interaction.revision;
    const staleSelection = (await requestJson(
      runtime.baseUrl,
      `/api/result-studio/selection/current?${new URLSearchParams({
        projectId: runtime.project.id,
        conversationId: runtime.conversation.id,
        artifactId: secondBaseline.interaction.manifest.artifactId,
        revisionId: secondRevision.revisionId,
        selectionDurable: 'true',
      }).toString()}`,
    )).data;
    const secondContext = (await requestJson(
      runtime.baseUrl,
      `/api/result-studio/context-envelope?${new URLSearchParams({
        projectId: runtime.project.id,
        conversationId: runtime.conversation.id,
        jobId: secondBaseline.job.id,
        artifact: path.basename(secondBaseline.artifact.path),
        revisionId: secondRevision.revisionId,
      }).toString()}`,
    )).data;
    const oldContextCountsBefore = readResultStudioCounts(runtime.env.BIOF3_DB_PATH, runtime.project.id);
    const oldContextReplay = await requestJsonResponse(
      runtime.baseUrl,
      `/api/result-studio/revisions/${encodeURIComponent(secondRevision.revisionId)}/replay`,
      {
        method: 'POST',
        body: JSON.stringify({
          projectId: runtime.project.id,
          conversationId: runtime.conversation.id,
          phase: 'preflight',
          contextToken: baselineContext.envelope.contextToken,
        }),
        timeoutMs: 120_000,
      },
    );
    const oldContextCountsAfter = readResultStudioCounts(runtime.env.BIOF3_DB_PATH, runtime.project.id);

    await runtime.close({ removeRoot: false });
    const pluginManifestPath = path.join(
      runtime.env.BIOF3_BUILT_IN_PLUGINS_DIR,
      'volcano-plot/plugin.json',
    );
    const upgradedPlugin = JSON.parse(readFileSync(pluginManifestPath, 'utf8'));
    upgradedPlugin.version = '2.0.0';
    writeFileSync(pluginManifestPath, `${JSON.stringify(upgradedPlugin, null, 2)}\n`);
    const builtInManifestPath = path.join(runtime.env.BIOF3_BUILT_IN_PLUGINS_DIR, 'manifest.json');
    const builtInManifest = JSON.parse(readFileSync(builtInManifestPath, 'utf8'));
    const indexedPlugin = builtInManifest.plugins?.['volcano-plot'];
    invariant(indexedPlugin, 'p6_drift_plugin_index_missing');
    indexedPlugin.version = '2.0.0';
    writeFileSync(builtInManifestPath, `${JSON.stringify(builtInManifest, null, 2)}\n`);
    coldServer = await startServer(runtime.env, verbose
      ? { onLog: (channel, line) => console.error(`[p6-drift-cold:${channel}] ${line}`) }
      : {});
    const coldBootStatus = publicStatusShape((await requestJson(
      coldServer.baseUrl,
      `/api/result-studio/workspace/status?${new URLSearchParams({
        projectId: runtime.project.id,
        conversationId: runtime.conversation.id,
      }).toString()}`,
      { timeoutMs: 120_000 },
    )).data);
    const sourceResponse = await requestJson(
      coldServer.baseUrl,
      `/api/result-studio/revisions/${encodeURIComponent(secondRevision.revisionId)}/source?${new URLSearchParams({
        projectId: runtime.project.id,
        expectSha256: secondRevision.sourceScriptRef.sha256,
      }).toString()}`,
    );
    const coldContext = (await requestJson(
      coldServer.baseUrl,
      `/api/result-studio/context-envelope?${new URLSearchParams({
        projectId: runtime.project.id,
        conversationId: runtime.conversation.id,
        jobId: secondBaseline.job.id,
        artifact: path.basename(secondBaseline.artifact.path),
        revisionId: secondRevision.revisionId,
      }).toString()}`,
    )).data;
    const pluginCountsBefore = readResultStudioCounts(runtime.env.BIOF3_DB_PATH, runtime.project.id);
    const pluginReplay = await requestJsonResponse(
      coldServer.baseUrl,
      `/api/result-studio/revisions/${encodeURIComponent(secondRevision.revisionId)}/replay`,
      {
        method: 'POST',
        body: JSON.stringify({
          projectId: runtime.project.id,
          conversationId: runtime.conversation.id,
          phase: 'preflight',
          contextToken: coldContext.envelope.contextToken,
        }),
        timeoutMs: 120_000,
      },
    );
    const pluginCountsAfter = readResultStudioCounts(runtime.env.BIOF3_DB_PATH, runtime.project.id);
    const allCurrent = openLedger(runtime.env.BIOF3_DB_PATH);
    let currentRevisionIds;
    try {
      currentRevisionIds = allCurrent.prepare(`
        SELECT revision_id FROM artifact_revisions WHERE project_id=? AND is_current=1 ORDER BY revision_id
      `).all(runtime.project.id).map((row) => row.revision_id);
    } finally {
      allCurrent.close();
    }
    const currentTruth = readBaselineTruth(
      runtime.env.BIOF3_DB_PATH,
      runtime.project.id,
      currentRevisionIds,
    );
    const observation = {
      prototype: 'real_product_drift_noncanonical',
      dirtyGitDetected,
      dirtyMarkerHashStable: existsSync(dirtyMarker)
        && sha256(readFileSync(dirtyMarker)) === dirtyMarkerHash,
      artifactDriftStatus,
      artifactRecoverHttpStatus: artifactRecover.status,
      artifactRecoverAfterStatus: artifactRecover.data?.after?.status || null,
      afterArtifactRestoreStatus,
      refDriftStatus,
      refRecoverHttpStatus: refRecover.status,
      refRecoverAfterStatus: refRecover.data?.after?.status || null,
      afterRefRestoreStatus,
      scriptHashRevisionCreated: !!scriptHashResponse.data?.revision?.revisionId,
      scriptHashDiagnosticCode: (scriptHashResponse.data?.manifest?.diagnostics || [])
        .find((diagnostic) => diagnostic?.code === 'background_source_script_drift')?.code || null,
      scriptMissingRevisionCreated: !!scriptMissingResponse.data?.revision?.revisionId,
      scriptMissingDiagnosticCode: (scriptMissingResponse.data?.manifest?.diagnostics || [])
        .find((diagnostic) => diagnostic?.code === 'source_script_missing')?.code || null,
      scriptDriftChangeSetCountStable: scriptCountsBefore.changeSets === scriptCountsAfter.changeSets,
      scriptDriftRevisionCountStable: scriptCountsBefore.revisions === scriptCountsAfter.revisions,
      selectionCompatibility: staleSelection.compatibility?.status || null,
      contextSelectionCompatibility: secondContext.envelope?.selectionState?.compatibility || null,
      contextSelectionExcluded: secondContext.envelope?.selection == null,
      oldContextHttpStatus: oldContextReplay.status,
      oldContextErrorCode: oldContextReplay.data?.error || null,
      oldContextWriteCountsStable: oldContextCountsBefore.changeSets === oldContextCountsAfter.changeSets
        && oldContextCountsBefore.revisions === oldContextCountsAfter.revisions,
      coldBootStatus,
      historySourceStillExact: sourceResponse.data?.sha256 === secondRevision.sourceScriptRef.sha256,
      pluginReplayHttpStatus: pluginReplay.status,
      pluginReplayErrorCode: pluginReplay.data?.error || null,
      pluginReplayWriteCountsStable: pluginCountsBefore.changeSets === pluginCountsAfter.changeSets
        && pluginCountsBefore.revisions === pluginCountsAfter.revisions,
      currentRevisionArtifactsExact: physicalBaselineStillExact(runtime.project.workspace_path, currentTruth),
      qualificationEligible: false,
      providerUsed: false,
      packagedAppUsed: false,
    };
    return { ...observation, ...evaluateP6RealDriftPrototype(observation), kept: keep };
  } finally {
    if (coldServer?.child) await stopServer(coldServer.child);
    if (runtime && runtime.closed !== true) await runtime.close({ removeRoot: !keep });
    if (!keep && root && existsSync(root)) rmSync(root, { recursive: true, force: true });
  }
}

/**
 * Run the real process-boundary prototype. It returns only bounded summaries;
 * IDs and absolute paths stay inside the disposable process and are never
 * written to acceptance/.
 */
export async function captureP6RealRestartPrototype({ keep = false, verbose = false } = {}) {
  let runtime = null;
  let worker = null;
  let coldServer = null;
  let root = null;
  let removed = false;
  let interruptionSignal = null;
  const terminateOwnedWorkerOnSignal = (signal) => {
    if (interruptionSignal) return;
    interruptionSignal = signal;
    process.exitCode = signal === 'SIGINT' ? 130 : 143;
    if (!worker?.child || worker.child.exitCode !== null || worker.child.signalCode !== null) return;
    try {
      if (worker.detached) process.kill(-worker.child.pid, 'SIGKILL');
      else worker.child.kill('SIGKILL');
    } catch { /* the ordinary finally path confirms or retries cleanup */ }
  };
  const onSigint = () => terminateOwnedWorkerOnSignal('SIGINT');
  const onSigterm = () => terminateOwnedWorkerOnSignal('SIGTERM');
  try {
    runtime = await createP5LiveScientificRuntime({
      verbose,
      beforeStart({ env }) {
        // The production default is ten minutes. This isolated harness keeps
        // the same stale-owner algorithm but shortens its observation window.
        env.BIOF3_TOOL_ZOMBIE_TIMEOUT_MS = '250';
        env.BIOF3_TOOL_HEARTBEAT_INTERVAL_MS = '100';
      },
    });
    root = runtime.root;
    const dbIdentityBefore = fileIdentity(runtime.env.BIOF3_DB_PATH);
    const baseline = await createRealVolcanoBaseline(runtime, 50_000);
    const sqlite = openLedger(runtime.env.BIOF3_DB_PATH);
    let baselineRevisionIds;
    try {
      baselineRevisionIds = sqlite.prepare(`
        SELECT revision_id FROM artifact_revisions
        WHERE project_id=? AND change_set_id=? ORDER BY artifact_id
      `).all(runtime.project.id, baseline.interaction.revision.changeSetId)
        .map((row) => row.revision_id);
    } finally {
      sqlite.close();
    }
    invariant(baselineRevisionIds.length >= 3, 'p6_restart_baseline_cohort_incomplete');
    const baselineBefore = readBaselineTruth(
      runtime.env.BIOF3_DB_PATH,
      runtime.project.id,
      baselineRevisionIds,
    );

    worker = spawnEditWorker(runtime, baseline);
    process.once('SIGINT', onSigint);
    process.once('SIGTERM', onSigterm);
    const durable = await waitForDurableCandidateCheckpoint(runtime, worker);
    const killed = await killWorkerWithSigkill(worker);
    const markerSeen = worker.output().stdout.includes(WORKER_MARKER);
    worker = null;
    process.removeListener('SIGINT', onSigint);
    process.removeListener('SIGTERM', onSigterm);
    invariant(interruptionSignal == null, 'p6_restart_interrupted_by_signal', {
      signal: interruptionSignal,
    });

    // Let the intentionally shortened stale-owner window elapse, then close
    // the original server. No process from the first runtime remains alive.
    await sleep(350);
    await runtime.close({ removeRoot: false });
    invariant(existsSync(root), 'p6_restart_root_removed_before_cold_boot');

    coldServer = await startServer(runtime.env, verbose
      ? { onLog: (channel, line) => console.error(`[p6-cold-1:${channel}] ${line}`) }
      : {});
    const firstColdStatusRaw = (await requestJson(
      coldServer.baseUrl,
      `/api/result-studio/workspace/status?${new URLSearchParams({
        projectId: runtime.project.id,
        conversationId: runtime.conversation.id,
      }).toString()}`,
      { timeoutMs: 120_000 },
    )).data;
    const firstColdStatus = publicStatusShape(firstColdStatusRaw);
    const recoveryResponse = await postJson(
      coldServer.baseUrl,
      '/api/result-studio/workspace/recover',
      { projectId: runtime.project.id, conversationId: runtime.conversation.id },
      120_000,
    );
    const afterRecoveryTruth = readInterruptedTruth(
      runtime.env.BIOF3_DB_PATH,
      durable.checkpoint.change_set_id,
    );
    const interruptedJob = await waitForInterruptedJobTerminal(
      runtime.env.BIOF3_DB_PATH,
      durable.checkpoint.candidateJob.id,
    );
    const afterRecoveryIntegrity = verifyCheckpoint(
      runtime.env.BIOF3_DB_PATH,
      afterRecoveryTruth.checkpoint.checkpoint_id,
    );
    invariant(afterRecoveryIntegrity.matches === true,
      'p6_restart_recovered_checkpoint_corrupt', afterRecoveryIntegrity);
    const baselineAfterRecovery = readBaselineTruth(
      runtime.env.BIOF3_DB_PATH,
      runtime.project.id,
      baselineRevisionIds,
    );

    await stopServer(coldServer.child);
    coldServer = null;
    coldServer = await startServer(runtime.env, verbose
      ? { onLog: (channel, line) => console.error(`[p6-cold-2:${channel}] ${line}`) }
      : {});
    const secondColdStatus = publicStatusShape((await requestJson(
      coldServer.baseUrl,
      `/api/result-studio/workspace/status?${new URLSearchParams({
        projectId: runtime.project.id,
        conversationId: runtime.conversation.id,
      }).toString()}`,
      { timeoutMs: 120_000 },
    )).data);
    const secondRecovery = (await postJson(
      coldServer.baseUrl,
      '/api/result-studio/workspace/recover',
      { projectId: runtime.project.id, conversationId: runtime.conversation.id },
      120_000,
    )).data;
    const bindingAfter = candidateRefCommit(
      runtime.env.BIOF3_DB_PATH,
      runtime.project.id,
      durable.checkpoint.working_branch_ref,
    );
    const dbIdentityAfter = fileIdentity(runtime.env.BIOF3_DB_PATH);
    const observation = {
      prototype: 'real_process_restart_noncanonical',
      noSeedSeededTableCount: runtime.noSeedPrecondition.seededTables.length,
      baselineJobCompleted: baseline.job.status === 'completed',
      baselineArtifactTruthValid: baseline.job.result?.artifactTruth?.status === 'valid'
        && baseline.job.result.artifactTruth.blocking !== true,
      baselineRevisionCount: baselineRevisionIds.length,
      baselineResourceSamplingMeasured: baseline.job.result?.resourceUsage?.sampling?.status === 'measured'
        && baseline.job.result.resourceUsage.sampling.sampleCount > 0,
      baselineCpuPeakMeasured: Number.isFinite(baseline.job.result?.resourceUsage?.peak?.cpuPercent)
        && baseline.job.result.resourceUsage.peak.cpuPercent >= 0,
      baselineRssPeakMeasured: baseline.job.result?.resourceUsage?.peak?.rssBytes > 0,
      baselineOutputPeakMeasured: baseline.job.result?.resourceUsage?.peak?.outputBytes > 0,
      baselineSystemResourcesMeasured: baseline.job.result?.resourceUsage?.peak?.minimumAvailableMemoryBytes > 0
        && baseline.job.result?.resourceUsage?.peak?.minimumAvailableDiskBytes > 0,
      baselineActiveJobPeakMeasured: baseline.job.result?.resourceUsage?.peak?.activeJobs >= 1,
      checkpointIntegrityBeforeKill: durable.integrity.matches === true,
      checkpointStageBeforeKill: durable.checkpoint.pendingPreview.stage,
      candidateRefMatchedBeforeKill: durable.git.commit === durable.checkpoint.candidate_commit,
      candidateJobRunningBeforeKill: durable.checkpoint.candidateJob.status === 'running',
      workerCheckpointHoldConfirmed: durable.hold.confirmed === true
        && durable.hold.groupAddressable === true
        && durable.hold.workerProcessStopped === true
        && durable.hold.processGroupAllStopped === true,
      workerCheckpointHoldMode: durable.hold.mode,
      processGroupAliveBeforeKill: durable.hold.groupAddressable === true,
      candidateChildPresentBeforeKill: durable.hold.childProcessPresent === true
        && durable.hold.groupMemberCount >= 2,
      candidateJobExactBeforeKill: durable.hold.candidateJobExact === true,
      candidateInputExactBeforeKill: durable.hold.candidateInputExact === true,
      candidateRuntimePausedBeforeCheckpoint:
        durable.hold.candidateRuntimePausedBeforeCheckpoint === true,
      candidateRuntimeProcessObservedBeforeKill:
        durable.hold.candidateRuntimeProcessObserved === true,
      candidateRuntimeDirectChildBeforeKill: durable.hold.candidateRuntimeDirectChild === true,
      candidateRuntimeCommandTrustedBeforeKill:
        durable.hold.candidateRuntimeCommandTrusted === true,
      candidateRuntimeExecutableIdentityExactBeforeKill:
        durable.hold.candidateRuntimeExecutableIdentityExact === true,
      processGroupAllStoppedBeforeKill: durable.hold.processGroupAllStopped === true,
      workerExitSignal: killed.signal,
      workerCompletionMarkerSeen: markerSeen,
      processGroupGoneAfterKill: killed.processGroupGone === true,
      candidateRuntimeProcessGoneAfterKill: killed.candidateRuntimeProcessGone === true,
      sqliteFileIdentityStable: sameFileIdentity(dbIdentityBefore, dbIdentityAfter),
      sqliteJournalModeBefore: baselineBefore.journalMode,
      sqliteJournalModeAfter: baselineAfterRecovery.journalMode,
      workspaceStable: runtime.project.workspace_path === runtime.coordinates.projectWorkspace
        && existsSync(runtime.project.workspace_path),
      gitBindingStable: durable.git.gitDir === bindingAfter.gitDir
        && durable.git.workTree === bindingAfter.workTree,
      firstColdStatus,
      recoveryHttpStatus: recoveryResponse.status,
      recoveryRepairKinds: (recoveryResponse.data?.repaired || []).map((item) => item.repair).sort(),
      recoveredChangeSetStatus: afterRecoveryTruth.changeSet?.status || null,
      recoveredCheckpointStatus: afterRecoveryTruth.checkpoint?.change_set_status || null,
      recoveredRevisionCount: afterRecoveryTruth.revisions.length,
      baselineDigestStable: baselineBefore.digest === baselineAfterRecovery.digest,
      baselineArtifactsExactAfterRecovery: physicalBaselineStillExact(
        runtime.project.workspace_path,
        baselineAfterRecovery,
      ),
      secondColdStatus,
      secondRecoveryRecovered: secondRecovery?.recovered === true,
      interruptedJobsTerminal: interruptedJob != null
        && TERMINAL_JOB_STATUSES.has(interruptedJob.status)
        && interruptedJob.completed,
      interruptedJobStatuses: interruptedJob ? [interruptedJob.status] : [],
      qualificationEligible: false,
      providerUsed: false,
      packagedAppUsed: false,
    };
    return { ...observation, ...evaluateP6RealRestartPrototype(observation), kept: keep };
  } finally {
    process.removeListener('SIGINT', onSigint);
    process.removeListener('SIGTERM', onSigterm);
    if (worker) {
      try { await killWorkerWithSigkill(worker); } catch { /* best effort */ }
    }
    await stopServer(coldServer?.child);
    if (runtime && runtime.closed !== true) {
      await runtime.close({ removeRoot: !keep });
      removed = !keep;
    }
    if (!keep && !removed && root && existsSync(root)) {
      rmSync(root, { recursive: true, force: true });
    }
  }
}

function parseCli(argv) {
  return {
    keep: argv.includes('--keep'),
    verbose: argv.includes('--verbose'),
    json: argv.includes('--json'),
  };
}

async function main() {
  const options = parseCli(process.argv.slice(2));
  const result = await captureP6RealRestartPrototype(options);
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    const passed = Object.values(result.checks).filter(Boolean).length;
    console.log(`[G0-RS-P6 real restart prototype] ${result.passed ? 'PASS' : 'FAIL'} - ${passed}/${Object.keys(result.checks).length} checks`);
    for (const [name, value] of Object.entries(result.checks)) {
      console.log(`  ${value ? 'PASS' : 'FAIL'} ${name}`);
    }
  }
  if (!result.passed) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`[G0-RS-P6 real restart prototype] FAIL - ${error.code || error.message}`);
    if (process.argv.includes('--verbose')) {
      console.error(error.stack || error);
      if (error.detail) console.error(JSON.stringify(error.detail, null, 2));
    }
    process.exitCode = 1;
  });
}
