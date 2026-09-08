const fs = require('fs');
const path = require('path');
const { createResultArchive } = require('./result-archive');
const { v4: uuidv4 } = require('uuid');
const { execFile } = require('child_process');
const {
  artifactContentTypeHint,
  captureStagedInputSnapshots,
  isInternalArtifactName,
  isSafeFlatFilename,
  reconcileArtifactTruth,
} = require('./artifact-truth');
const {
  createVerifiedFileSnapshot,
  createVerifiedSnapshotReadStream,
  pipeVerifiedSnapshotToResponse,
  readVerifiedFileSnapshot,
} = require('./verified-file-snapshot');
const { injectReportTheme, isHtmlFile, normalizeReportTheme } = require('./report-theme');
const { materializeFinalReport } = require('./final-report');
const {
  createExecutionContext: createCanonicalExecutionContext,
} = require('../../shared-backend/execution-context');
const {
  resolveProjectRunLayout,
} = require('../../shared-backend/project-run-layout');
const { resolveRLibsForPlugin } = require('../../shared-backend/r-libs-resolver');
const { ensureBundlesForPlugin } = require('../../shared-backend/capability-bundles');
const { createExecutionProvenance, attachProvenanceToResult } = require('../../shared-backend/execution-provenance');
const { collectExecutionInputs, writeArtifactManifest } = require('../../shared-backend/artifact-manifest');
const { createRuntimeResourceSnapshot } = require('../../shared-backend/runtime-resource-snapshot');
const {
  createToolResourceSampler,
  directoryBytes,
  diskSnapshot,
} = require('../../shared-backend/tool-resource-sampler');
const {
  isChildProcessAlive,
  markUnownedStaleJobs,
  recoverStaleActiveJobs,
  resolveLifecycleDurations,
  scheduleHardTimeout,
  terminateChildProcess,
} = require('../helpers/process-lifecycle');
const { createTargetRegistry } = require('./remote-execution/target-registry');
const { createRemoteJobRunner, AGENT_SCRIPT_HASH } = require('./remote-execution/remote-job-runner');
const { remoteJobDirPath } = require('./remote-execution/ssh-transport');

/**
 * BLOCK-57 — Job provenance 构建工厂。
 * 从 executeJob 提取（原为闭包），使本地 / 远程 / 重启恢复三条执行路径
 * 产出完全同形的 provenance.json；executionTarget 块为远程作业 additive 扩展。
 */
function buildJobProvenance({
  jobId,
  job,
  toolId,
  cfg,
  jobDir,
  runtimeCommand,
  runtimeReady,
  runtimeVersion,
  runCmd,
  startedAt,
  artifacts = [],
  executionTarget = null,
}) {
  const dbMod = require('../db');
  const pluginLoader = require('../plugin-loader');
  const toolDefinition = pluginLoader.getToolDefinition(toolId) || {};
  const pluginManifest = pluginLoader.getPluginManifest(toolId) || cfg;
  const scientificTask = typeof dbMod.getScientificTaskByToolJob === 'function' ? dbMod.getScientificTaskByToolJob(jobId) : null;
  const provenance = createExecutionProvenance({
    toolJobId: jobId,
    projectId: job.project_id || null,
    scientificTask,
    plugin: pluginManifest,
    params: job.params || {},
    inputs: collectExecutionInputs({
      inputDefinitions: Array.isArray(toolDefinition.inputs) ? toolDefinition.inputs : [],
      params: job.params || {},
      jobDir,
    }),
    runtime: { name: cfg.lang || null, command: runtimeCommand, version: runtimeVersion, ready: runtimeReady?.ready },
    runScriptPath: path.join(jobDir, 'run-script.' + (cfg.lang === 'r' ? 'R' : 'py')),
    command: { executable: runCmd[0], args: runCmd.slice(1), cwd: jobDir },
    artifacts,
    startedAt,
    completedAt: new Date().toISOString(),
  });
  if (executionTarget) {
    provenance.executionTarget = executionTarget;
  }
  const provenancePath = path.join(jobDir, 'provenance.json');
  fs.writeFileSync(provenancePath, JSON.stringify(provenance, null, 2));
  return { provenance, provenancePath, pluginManifest };
}

function isManagedResultDir(candidate, jobsDir) {
  if (!candidate || !jobsDir) return false;
  const resolved = path.resolve(String(candidate));
  const roots = [path.resolve(jobsDir), path.resolve(path.dirname(jobsDir), 'mcp-tool-jobs')];
  return roots.some((root) => resolved === root || resolved.startsWith(root + path.sep));
}

function parseStoredToolResult(job) {
  if (!job || !job.result_json) return null;
  try {
    const result = typeof job.result_json === 'string'
      ? JSON.parse(job.result_json)
      : job.result_json;
    return result && typeof result === 'object' && !Array.isArray(result) ? result : null;
  } catch {
    return null;
  }
}

function mergeFinalOutputMeasurement(resourceUsage, finalOutput) {
  if (!resourceUsage?.peak || !resourceUsage?.sampling || !finalOutput) return resourceUsage;
  const bytes = Number(finalOutput.bytes);
  if (Number.isFinite(bytes) && bytes >= 0) {
    const previous = Number(resourceUsage.peak.outputBytes);
    resourceUsage.peak.outputBytes = Number.isFinite(previous) && previous >= 0
      ? Math.max(previous, bytes)
      : bytes;
  }
  resourceUsage.sampling.outputSampleCount = Number(
    resourceUsage.sampling.outputSampleCount || 0,
  ) + 1;
  resourceUsage.sampling.directoryTruncated ||= finalOutput.truncated === true;
  resourceUsage.sampling.directoryReadErrors = Number(
    resourceUsage.sampling.directoryReadErrors || 0,
  ) + Number(finalOutput.readErrors || 0);
  resourceUsage.sampling.directoryStatErrors = Number(
    resourceUsage.sampling.directoryStatErrors || 0,
  ) + Number(finalOutput.statErrors || 0);
  const complete = finalOutput.complete !== false
    && finalOutput.truncated !== true
    && Number(finalOutput.readErrors || 0) === 0
    && Number(finalOutput.statErrors || 0) === 0;
  resourceUsage.sampling.outputMeasurementStatus = complete
    && resourceUsage.sampling.outputMeasurementStatus !== 'partial'
    ? 'measured'
    : 'partial';
  return resourceUsage;
}

function buildCancelledToolResult({
  existingResult = null,
  jobId,
  resourceUsage,
  executionProvenance = null,
  provenanceRef = null,
} = {}) {
  const result = existingResult && typeof existingResult === 'object' && !Array.isArray(existingResult)
    ? { ...existingResult }
    : {};
  result.toolJobId = jobId;
  result.cancellation = {
    phase: 'execute',
    reason: 'user_stop',
    terminalStatus: 'cancelled',
    processExitConfirmed: true,
  };
  result.resourceUsage = resourceUsage;
  if (executionProvenance) result.executionProvenance = executionProvenance;
  if (provenanceRef) result.provenanceRef = provenanceRef;
  return result;
}

function buildFailedToolResult({
  existingResult = null,
  jobId,
  reason,
  exitCode = null,
  resourceUsage,
  executionProvenance = null,
  provenanceRef = null,
} = {}) {
  const result = existingResult && typeof existingResult === 'object' && !Array.isArray(existingResult)
    ? { ...existingResult }
    : {};
  result.toolJobId = jobId;
  result.failure = { phase: 'execute', reason, exitCode };
  result.resourceUsage = resourceUsage;
  if (executionProvenance) result.executionProvenance = executionProvenance;
  if (provenanceRef) result.provenanceRef = provenanceRef;
  return result;
}

function claimActiveToolJob(activeToolJobs, { jobId, toolId, now = Date.now } = {}) {
  if (activeToolJobs.has(jobId)) return null;
  const observedAt = now();
  const owner = {
    process: null,
    phase: 'preparing',
    cancelRequested: false,
    startedAt: observedAt,
    lastHeartbeatAt: observedAt,
    toolId,
  };
  activeToolJobs.set(jobId, owner);
  return owner;
}

function releaseActiveToolJob(activeToolJobs, jobId, owner) {
  if (activeToolJobs.get(jobId) !== owner) return false;
  activeToolJobs.delete(jobId);
  return true;
}

function terminateOwnedToolJobProcess(
  owner,
  { terminate = terminateChildProcess } = {},
) {
  if (!owner?.process) {
    return Promise.resolve({ terminated: false, reason: 'process_handle_missing' });
  }
  if (owner.terminationPromise) return owner.terminationPromise;

  const ownedProcess = owner.process;
  const attempt = Promise.resolve()
    .then(() => terminate(ownedProcess))
    .then((termination) => (
      termination && typeof termination === 'object'
        ? termination
        : { terminated: false, reason: 'termination_result_invalid' }
    ))
    .catch((error) => ({
      terminated: false,
      reason: 'termination_attempt_failed',
      error: error?.message || String(error),
    }));
  owner.terminationPromise = attempt;
  void attempt.then((termination) => {
    owner.lastTerminationResult = termination;
    if (owner.terminationPromise === attempt) owner.terminationPromise = null;
  });
  return attempt;
}

function requestActiveToolJobCancellation(
  activeToolJobs,
  jobId,
  { terminate = terminateChildProcess } = {},
) {
  const active = activeToolJobs.get(jobId);
  if (!active) return { active: false, killed: false, processStarted: false };
  active.cancelRequested = true;
  if (!active.process) {
    return {
      active: true,
      killed: false,
      processStarted: false,
      cancellationAccepted: true,
    };
  }
  const result = { active: true, killed: false, processStarted: true };
  result.termination = terminateOwnedToolJobProcess(active, { terminate })
    .then((termination) => {
      result.killed = termination.terminated;
      if (termination.signal) result.signal = termination.signal;
      else if (termination.terminated && termination.escalated) result.signal = 'SIGKILL';
      return termination;
    });
  return result;
}

async function canLaunchOwnedToolJob({ activeToolJobs, db, jobId, owner }) {
  if (activeToolJobs.get(jobId) !== owner || owner.cancelRequested) return false;
  const stored = await db.prepare('SELECT status FROM tool_jobs WHERE id=?').get(jobId);
  return activeToolJobs.get(jobId) === owner
    && owner.cancelRequested !== true
    && stored?.status === 'running';
}

function persistVerifiedToolJobHeartbeat({
  active,
  jobId,
  db,
  now = Date.now,
  isAlive = isChildProcessAlive,
} = {}) {
  if (!active || !isAlive(active.process)) {
    if (active) active.livenessLostAt ||= now();
    return false;
  }
  const observedAt = now();
  const commitHeartbeat = (persisted) => {
    if (!persisted || persisted.changes < 1) return false;
    if (!isAlive(active.process)) {
      active.livenessLostAt ||= observedAt;
      return false;
    }
    active.livenessLostAt = null;
    active.lastHeartbeatAt = observedAt;
    return true;
  };
  const persisted = db
    .prepare('UPDATE tool_jobs SET heartbeat_at=? WHERE id=? AND status=?')
    .run(observedAt, jobId, 'running');
  return persisted && typeof persisted.then === 'function'
    ? persisted.then(commitHeartbeat)
    : commitHeartbeat(persisted);
}

function armActiveToolJobLifecycle({
  active,
  jobId,
  db,
  heartbeatIntervalMs,
  hardTimeoutMs,
  setIntervalFn = setInterval,
  scheduleHardTimeoutFn = scheduleHardTimeout,
  refreshHeartbeat = persistVerifiedToolJobHeartbeat,
} = {}) {
  if (!active?.process) throw new Error('active_tool_job_process_missing');
  if (active.hardTimeoutTimer || active.heartbeatTimer) {
    throw new Error('active_tool_job_lifecycle_already_armed');
  }

  // Arm the independent kill budget first. Any later sampler/SQLite setup
  // failure still has a bounded retry path if the immediate TERM/KILL result
  // cannot be confirmed.
  active.hardTimeoutTimer = scheduleHardTimeoutFn({
    active,
    jobId,
    db,
    hardTimeoutMs,
  });
  active.heartbeatTimer = setIntervalFn(() => {
    try {
      const refreshed = refreshHeartbeat({ active, jobId, db });
      if (refreshed && typeof refreshed.then === 'function') {
        void refreshed.catch((error) => {
          console.warn('[tools] heartbeat update failed:', error.message);
        });
      }
    } catch (error) {
      console.warn('[tools] heartbeat update failed:', error.message);
    }
  }, heartbeatIntervalMs);
  active.heartbeatTimer.unref?.();
  return {
    hardTimeoutTimer: active.hardTimeoutTimer,
    heartbeatTimer: active.heartbeatTimer,
  };
}

function clearActiveToolJobLifecycleTimers(active) {
  if (!active) return;
  if (active.hardTimeoutTimer) clearTimeout(active.hardTimeoutTimer);
  if (active.heartbeatTimer) clearInterval(active.heartbeatTimer);
  active.hardTimeoutTimer = null;
  active.heartbeatTimer = null;
}

async function transitionToolJobToFailed({
  db,
  jobId,
  error,
  completedAt = Date.now(),
} = {}) {
  return db
    .prepare('UPDATE tool_jobs SET status=?, error=?, completed_at=? WHERE id=? AND status IN (?,?)')
    .run('failed', error, completedAt, jobId, 'pending', 'running');
}

async function transitionToolJobToCompleted({
  db,
  jobId,
  result,
  completedAt = Date.now(),
} = {}) {
  return db
    .prepare('UPDATE tool_jobs SET status=?, result_json=?, completed_at=? WHERE id=? AND status=?')
    .run('completed', JSON.stringify(result), completedAt, jobId, 'running');
}

async function settleConfirmedToolCancellation({
  db,
  jobId,
  result,
  completedAt = Date.now(),
} = {}) {
  return db
    .prepare(
      'UPDATE tool_jobs SET status=?, error=?, result_json=?, completed_at=?, process_pid=?, heartbeat_at=? '
      + 'WHERE id=? AND status IN (?,?,?)',
    )
    .run(
      'cancelled',
      null,
      JSON.stringify(result),
      completedAt,
      null,
      null,
      jobId,
      'pending',
      'running',
      'cancelled',
    );
}

async function handleActiveToolJobSetupFailure({
  activeToolJobs,
  jobId,
  error,
  markFailed,
  terminate = terminateChildProcess,
} = {}) {
  const owner = activeToolJobs.get(jobId);
  const message = error?.message || String(error || 'unknown executor setup failure');
  if (!owner) {
    await markFailed(jobId, `Executor setup failed: ${message}`, 'setup');
    return { active: false, processStarted: false };
  }
  owner.setupFailure = { phase: 'setup', reason: 'executor_setup_failure', message };
  if (!owner.process) {
    try {
      await markFailed(jobId, `Executor setup failed: ${message}`, 'setup');
    } finally {
      releaseActiveToolJob(activeToolJobs, jobId, owner);
    }
    return { active: true, processStarted: false };
  }

  if (owner.heartbeatTimer) clearInterval(owner.heartbeatTimer);
  owner.heartbeatTimer = null;
  const termination = await terminateOwnedToolJobProcess(owner, { terminate });
  owner.setupTerminationResult = termination;
  if (!termination.terminated) {
    // Make the existing periodic owner scan retry this handle on its next pass.
    // The independently armed hard timeout is deliberately retained as a
    // second bounded termination path.
    owner.lastHeartbeatAt = 0;
    return { active: true, processStarted: true, termination };
  }

  clearActiveToolJobLifecycleTimers(owner);
  if (!owner.cancelRequested) {
    try {
      await markFailed(
        jobId,
        `Executor setup failed: ${message}; child termination confirmed (${termination.signal || 'exit'})`,
        'setup',
      );
    } finally {
      releaseActiveToolJob(activeToolJobs, jobId, owner);
    }
  }
  return { active: true, processStarted: true, termination };
}

function declaredResultFilenames(result) {
  const names = new Set();
  const manifest = result && result.manifest;
  const sources = [
    result && result.artifacts,
    result && result.outputs,
    result && result.files,
    Array.isArray(manifest) ? manifest : null,
    manifest && manifest.artifacts,
    manifest && manifest.outputs,
    manifest && manifest.files,
  ];
  for (const items of sources) {
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      const candidate = typeof item === 'string'
        ? item
        : item && typeof item === 'object'
          ? item.filename || item.name || item.file
          : null;
      if (!isSafeFlatFilename(candidate) || isInternalArtifactName(candidate)) continue;
      names.add(candidate);
    }
  }
  return names;
}

function resolveStoredArtifactTruthBinding(result, filename) {
  const truth = result && result.artifactTruth;
  if (!truth) return { ok: true, expectedSha256: null, legacy: true };
  if (truth.blocking === true || !['valid', 'degraded'].includes(truth.status)) {
    return { ok: false, error: 'artifact_truth_unavailable' };
  }
  const artifacts = Array.isArray(result.artifacts) ? result.artifacts : [];
  const matches = artifacts.filter((artifact) => {
    if (!artifact || typeof artifact !== 'object') return false;
    const name = artifact.filename || artifact.name || artifact.path;
    return isSafeFlatFilename(path.basename(String(name || '')))
      && path.basename(String(name || '')) === filename;
  });
  if (matches.length !== 1) {
    return {
      ok: false,
      error: matches.length > 1 ? 'artifact_identity_ambiguous' : 'artifact_truth_unavailable',
    };
  }
  const expectedSha256 = String(matches[0].sha256 || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expectedSha256)) {
    return { ok: false, error: 'artifact_truth_unavailable' };
  }
  return { ok: true, expectedSha256, legacy: false };
}

function exactLegacyResultRoots(jobId, jobsDir) {
  if (!isSafeFlatFilename(String(jobId || '')) || !jobsDir) return [];
  const toolRoot = path.resolve(jobsDir, String(jobId));
  const mcpRoot = path.resolve(path.dirname(jobsDir), 'mcp-tool-jobs', String(jobId));
  return [toolRoot, path.join(toolRoot, 'output'), mcpRoot, path.join(mcpRoot, 'output')];
}

function isRealPathInside(root, target) {
  const relative = path.relative(root, target);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..'
    && !path.isAbsolute(relative);
}

function expectedPhysicalResultRoot({ job, layout, jobsDir, resultDir }) {
  if (job.project_id) {
    if (!layout?.workspaceRoot || !layout.jobRoot || !layout.outputDir) return null;
    const realWorkspace = fs.realpathSync(layout.workspaceRoot);
    const realJobRoot = fs.realpathSync(layout.jobRoot);
    if (!isRealPathInside(realWorkspace, realJobRoot)) return null;
    if (resultDir === path.resolve(layout.jobRoot)) return realJobRoot;
    const realOutputDir = fs.realpathSync(layout.outputDir);
    return path.dirname(realOutputDir) === realJobRoot ? realOutputDir : null;
  }

  const legacyRoots = exactLegacyResultRoots(job.id, jobsDir);
  const index = legacyRoots.indexOf(resultDir);
  if (index === -1) return null;
  const legacyBase = index < 2
    ? path.resolve(jobsDir)
    : path.resolve(path.dirname(jobsDir), 'mcp-tool-jobs');
  const realBase = fs.realpathSync(legacyBase);
  return path.join(realBase, String(job.id), ...(index % 2 === 1 ? ['output'] : []));
}

function resultFileIdentity(stat) {
  return {
    dev: stat.dev,
    ino: stat.ino,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs,
  };
}

function hasSameResultFileIdentity(stat, identity) {
  return Boolean(
    identity
      && stat.dev === identity.dev
      && stat.ino === identity.ino
      && stat.size === identity.size
      && stat.mtimeMs === identity.mtimeMs
      && stat.ctimeMs === identity.ctimeMs,
  );
}

/**
 * Resolve a private artifact only from the current Job's persisted declaration.
 * The stored result root must be one of this Job's exact server-derived roots;
 * realpath containment prevents a declared symlink from escaping that root.
 */
function resolveAuthorizedToolResultFile({ job, filename, layout = null, jobsDir }) {
  if (!isSafeFlatFilename(filename) || isInternalArtifactName(filename)) {
    return { ok: false, error: 'bad_path' };
  }
  const result = parseStoredToolResult(job);
  if (!result || !declaredResultFilenames(result).has(filename)) {
    return { ok: false, error: 'file_not_found' };
  }
  const truthBinding = resolveStoredArtifactTruthBinding(result, filename);
  if (!truthBinding.ok) return truthBinding;

  const storedResultDir = typeof result.resultDir === 'string'
    ? result.resultDir
    : typeof result.outputDir === 'string'
      ? result.outputDir
      : null;
  if (!storedResultDir || path.resolve(storedResultDir) !== storedResultDir) {
    return { ok: false, error: 'file_not_found' };
  }

  const allowedRoots = job.project_id
    ? [layout && layout.jobRoot, layout && layout.outputDir]
      .filter(Boolean)
      .map((root) => path.resolve(root))
    : exactLegacyResultRoots(job.id, jobsDir);
  const resultDir = path.resolve(storedResultDir);
  if (!allowedRoots.includes(resultDir)) {
    return { ok: false, error: 'file_not_found' };
  }

  try {
    const realRoot = fs.realpathSync(resultDir);
    const expectedRealRoot = expectedPhysicalResultRoot({ job, layout, jobsDir, resultDir });
    if (realRoot !== expectedRealRoot || !fs.statSync(realRoot).isDirectory()) {
      return { ok: false, error: 'file_not_found' };
    }
    const candidate = path.join(resultDir, filename);
    if (path.dirname(candidate) !== resultDir) return { ok: false, error: 'bad_path' };
    const realFile = fs.realpathSync(candidate);
    const fileStat = fs.statSync(realFile);
    if (path.dirname(realFile) !== realRoot || !fileStat.isFile()) {
      return { ok: false, error: 'file_not_found' };
    }
    return {
      ok: true,
      filePath: realFile,
      resultDir,
      fileIdentity: resultFileIdentity(fileStat),
      expectedSha256: truthBinding.expectedSha256,
    };
  } catch {
    return { ok: false, error: 'file_not_found' };
  }
}

/**
 * Open exactly the file that passed the authorization realpath checks. Sending
 * the path through Express after that check would re-resolve it and allow a
 * rename/symlink race. The caller owns the returned descriptor on success.
 */
async function openVerifiedAuthorizedToolResultFile(resolved) {
  if (!resolved || !resolved.ok || !resolved.filePath || !resolved.fileIdentity) {
    return { ok: false, error: 'file_not_found' };
  }

  let fd = null;
  try {
    const noFollow = Number.isInteger(fs.constants.O_NOFOLLOW) ? fs.constants.O_NOFOLLOW : 0;
    fd = fs.openSync(resolved.filePath, fs.constants.O_RDONLY | noFollow);
    const openedStat = fs.fstatSync(fd);
    if (!openedStat.isFile() || !hasSameResultFileIdentity(openedStat, resolved.fileIdentity)) {
      fs.closeSync(fd);
      return { ok: false, error: 'file_not_found' };
    }
    const sourceFd = fd;
    fd = null;
    const snapshot = await createVerifiedFileSnapshot(sourceFd, {
      expectedIdentity: resolved.fileIdentity,
      expectedSha256: resolved.expectedSha256,
    });
    return {
      ok: true,
      fd: snapshot.fd,
      stat: snapshot.stat,
      verification: snapshot.verification,
      actualSha256: resolved.expectedSha256 ? snapshot.sha256 : null,
    };
  } catch (error) {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch {}
    }
    if (error?.code === 'verified_snapshot_hash_mismatch') {
      return { ok: false, error: 'artifact_truth_drift' };
    }
    return { ok: false, error: 'file_not_found' };
  }
}

/**
 * The tools HTTP contract accepts a flat `filename -> base64` map. Tool
 * scripts resolve their inputs directly from the job root; directory uploads
 * are not part of that contract. Resolve every key before writing so a bad
 * key cannot escape the job sandbox or leave a partial upload behind.
 */
function resolveUploadedFilePath(jobDir, key) {
  if (typeof jobDir !== 'string' || !jobDir || jobDir.includes('\0')) {
    return { ok: false, error: '上传目录无效。' };
  }
  if (typeof key !== 'string' || !key || key.includes('\0')) {
    return { ok: false, error: '上传文件名无效。' };
  }

  // Reject both platform separator syntaxes. This is deliberately stricter
  // than a containment-only check because nested upload paths are unsupported.
  if (
    key.includes('/') ||
    key.includes('\\') ||
    key === '.' ||
    key === '..' ||
    path.isAbsolute(key) ||
    path.win32.isAbsolute(key) ||
    /^[A-Za-z]:/.test(key)
  ) {
    return { ok: false, error: '上传文件名不能包含路径。' };
  }
  if (isInternalArtifactName(key)) {
    return { ok: false, error: '上传文件名与任务内部控制文件冲突。' };
  }

  const root = path.resolve(jobDir);
  const filePath = path.resolve(root, key);
  if (path.dirname(filePath) !== root) {
    return { ok: false, error: '上传文件路径超出任务目录。' };
  }
  return { ok: true, filePath, key };
}

function resolveUploadedFiles(jobDir, files) {
  if (files === undefined || files === null) return { ok: true, entries: [] };
  if (typeof files !== 'object' || Array.isArray(files) || Buffer.isBuffer(files)) {
    return { ok: false, error: '上传文件必须是文件名到 Base64 内容的映射。' };
  }
  const prototype = Object.getPrototypeOf(files);
  if (prototype !== Object.prototype && prototype !== null) {
    return { ok: false, error: '上传文件必须是文件名到 Base64 内容的映射。' };
  }

  const entries = [];
  for (const [key, fileData] of Object.entries(files)) {
    const resolved = resolveUploadedFilePath(jobDir, key);
    if (!resolved.ok) return resolved;
    if (typeof fileData !== 'string') {
      return { ok: false, error: `文件 "${key}" 的上传内容无效。` };
    }
    entries.push({ ...resolved, fileData });
  }
  return { ok: true, entries };
}

function writeUploadedFiles(jobDir, files) {
  const resolved = resolveUploadedFiles(jobDir, files);
  if (!resolved.ok) return resolved;

  for (const entry of resolved.entries) {
    fs.writeFileSync(entry.filePath, Buffer.from(entry.fileData, 'base64'));
  }
  return resolved;
}

function validateUploadedFiles(toolId, jobDir, files) {
  const resolvedFiles = resolveUploadedFiles(jobDir, files);
  if (!resolvedFiles.ok) return resolvedFiles.error;
  const csvTools = [
    'deseq2',
    'go-kegg',
    'gsea',
    'km-survival',
    'lasso-cox',
    'bindea-immune',
    'wgcna',
    'complexheatmap',
  ];

  for (const { key, filePath } of resolvedFiles.entries) {
    if (!fs.existsSync(filePath)) continue;

    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(4096);
    const bytesRead = fs.readSync(fd, buf, 0, 4096, 0);
    fs.closeSync(fd);
    const head = buf.slice(0, bytesRead).toString('utf-8');

    if (csvTools.includes(toolId) && head.includes('\0')) {
      return `文件 "${key}" 似乎是二进制文件（如 Excel .xlsx），请转换为 CSV 或 TSV 格式后重新上传。提示：在 Excel 中"另存为" → 选择 CSV (UTF-8) 格式。`;
    }

    if (csvTools.includes(toolId)) {
      const lines = head.split(/\r?\n/).filter((line) => line.trim());
      if (lines.length < 2) {
        return `文件 "${key}" 内容为空或只有表头，需要至少包含 1 行数据。`;
      }
      const firstLine = lines[0];
      const sep = firstLine.includes('\t') ? '\t' : ',';
      const headerCols = firstLine.split(sep).length;
      // GO/KEGG explicitly accepts a one-column gene list (`gene` header);
      // the other CSV tools require at least two columns.
      const acceptsSingleColumnGeneList = toolId === 'go-kegg';
      if (headerCols < 2 && !acceptsSingleColumnGeneList) {
        return `文件 "${key}" 只检测到 1 列。请确认分隔符是逗号(CSV)或制表符(TSV)，不是分号或空格。`;
      }
      const dataCols = lines[1].split(sep).length;
      if (Math.abs(dataCols - headerCols) > 1) {
        return `文件 "${key}" 格式异常：表头有 ${headerCols} 列，但第一行数据有 ${dataCols} 列。请检查 CSV 格式是否正确。`;
      }
    }

    const stat = fs.statSync(filePath);
    if (
      stat.size > 100 * 1024 * 1024 &&
      toolId !== 'seurat-standard' &&
      toolId !== 'cellchat'
    ) {
      return `文件 "${key}" 大小为 ${Math.round(stat.size / 1024 / 1024)}MB，超过推荐上限(100MB)。大文件可能导致分析超时。建议：筛选基因或样本后重试。`;
    }
  }
  return null;
}

function hydrateExecutionJob(row) {
  if (!row || typeof row !== 'object') return null;
  let params = {};
  try {
    params = row.params_json
      ? (typeof row.params_json === 'string' ? JSON.parse(row.params_json) : row.params_json)
      : {};
  } catch {
    params = {};
  }
  return { ...row, params };
}

/**
 * Plugin scripts historically use either `<job>/output` or the isolated Job
 * root as their result directory. Both locations are server-owned; select one
 * only from a produced manifest or an exact declared artifact filename.
 */
function resolveProducedResultDirectory({ jobDir, outputDir, expectedArtifacts = [] }) {
  const resultRoots = [path.resolve(outputDir), path.resolve(jobDir)];
  const manifestNames = ['manifest.json', 'artifact-manifest.json'];
  for (const root of resultRoots) {
    for (const name of manifestNames) {
      const candidate = path.join(root, name);
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return { resultDir: root, manifestPath: candidate, reason: 'manifest' };
      }
    }
  }
  const declaredNames = expectedArtifacts
    .map((artifact) => artifact && (artifact.filename || artifact.name))
    .filter((name) => typeof name === 'string' && name === path.basename(name) && !name.includes('\0'));
  for (const root of resultRoots) {
    if (declaredNames.some((name) => {
      const candidate = path.join(root, name);
      return fs.existsSync(candidate) && fs.statSync(candidate).isFile();
    })) {
      return { resultDir: root, manifestPath: path.join(root, 'manifest.json'), reason: 'declared_artifact' };
    }
  }
  return {
    resultDir: path.resolve(outputDir),
    manifestPath: path.join(path.resolve(outputDir), 'manifest.json'),
    reason: 'standard_default',
  };
}


function createToolsExecutor({
  db,
  dbMod,
  config,
  notify,
  jobsDir,
  scriptsDir,
  publicDemoJobIds,
  safeJoinUnder,
  getUserId,
  isSmokeTestRequest,
}) {
  const activeToolJobs = new Map();
  const defaultLocalRoot =
    process.env.BIOF3_HARNESS_LOCAL_ROOT ||
    process.env.BIOF3_LOCAL_ROOT ||
    config.localResultsDir ||
    path.dirname(jobsDir);
  const defaultCanonicalRoot =
    process.env.BIOF3_HARNESS_CANONICAL_ROOT || process.env.BIOF3_CANONICAL_ROOT || '/work/biof3';

  function canonicalizePath(localPath) {
    return createCanonicalExecutionContext({
      workDir: localPath,
      localRoot: defaultLocalRoot,
      canonicalRoot: defaultCanonicalRoot,
    }).canonicalizePath(localPath);
  }

  function createExecutionContext({
    jobDir,
    outputDir,
    resultDir,
    runtime,
    runtimeCommand,
    runtimeReady,
  }) {
    return createCanonicalExecutionContext({
      workDir: jobDir,
      outputDir,
      resultDir,
      runtime,
      runtimeCommand,
      runtimeReady,
      localRoot: defaultLocalRoot,
      canonicalRoot: defaultCanonicalRoot,
    }).context;
  }

  function forwardedToolRunUserId(req) {
    if (!req.isInternal) return getUserId(req);
    const raw = req.headers['x-biof3-user-id'];
    const uid = Array.isArray(raw) ? raw[0] : raw;
    return uid ? String(uid).trim() : null;
  }

  function killLocalToolJob(jobId) {
    // BLOCK-57：远程作业取消——本地 durable 取消态照常落定；节点侧补发 agent cancel，
    // 由 attach 循环 / re-adopt 扫描对账收敛为 cancelled（节点真相胜出）。
    void (async () => {
      try {
        const remoteJob = await db.prepare('SELECT execution_target_id FROM tool_jobs WHERE id=?').get(jobId);
        if (remoteJob && remoteJob.execution_target_id) {
          const target = await targetRegistry.getById({ id: remoteJob.execution_target_id });
          if (target) {
            await remoteRunner.cancel({ alias: target.alias, jobId }).catch(() => {});
          }
        }
      } catch {}
    })();
    return requestActiveToolJobCancellation(activeToolJobs, jobId);
  }

  async function cleanupLocalToolJobDir(jobId) {
    if (publicDemoJobIds.has(jobId)) {
      return { removed: false, protected: true, reason: 'public_demo_asset' };
    }

    // Phase 2: 尝试从数据库读取 job 的项目关联
    let jobDir = null;
    try {
      const job = await db.prepare('SELECT project_id FROM tool_jobs WHERE id=?').get(jobId);
      if (job && job.project_id) {
        const layout = resolveProjectRunLayout({
          projectId: job.project_id,
          toolJobId: jobId,
          db: dbMod,
          skipPermissionCheck: true,
          ensureDirs: false,
        });
        jobDir = layout.jobRoot;
      }
    } catch (error) {
      console.warn('[tools] Failed to resolve project layout for cleanup:', error.message);
    }

    // 回退到全局目录
    if (!jobDir) {
      jobDir = safeJoinUnder(jobsDir, jobId);
    }

    if (!jobDir) return { removed: false, error: 'bad_path' };
    const existed = fs.existsSync(jobDir);
    try {
      fs.rmSync(jobDir, { recursive: true, force: true });
      return { removed: existed, existed };
    } catch (e) {
      return { removed: false, existed, error: e.message };
    }
  }

  async function handlePrivateFileRead(req, res) {
    const job = req.toolJob;
    if (!job || String(job.id) !== String(req.params.jobId)) {
      return res.status(404).json({ error: 'job_not_found' });
    }

    let layout = null;
    if (job.project_id) {
      try {
        layout = resolveProjectRunLayout({
          projectId: job.project_id,
          toolJobId: job.id,
          db: dbMod,
          skipPermissionCheck: true,
          ensureDirs: false,
        });
      } catch (error) {
        console.warn('[tools] Project layout resolution failed for file read:', error.message);
        return res.status(404).json({ error: 'file_not_found' });
      }
    }

    const resolved = resolveAuthorizedToolResultFile({
      job,
      filename: req.params.filename,
      layout,
      jobsDir,
    });
    if (!resolved.ok) {
      const status = resolved.error === 'bad_path'
        ? 400
        : resolved.error.startsWith('artifact_')
          ? 409
          : 404;
      return res.status(status).json({ error: resolved.error });
    }
    const opened = await openVerifiedAuthorizedToolResultFile(resolved);
    if (!opened.ok) {
      return res.status(opened.error === 'artifact_truth_drift' ? 409 : 404).json({ error: opened.error });
    }

    const theme = normalizeReportTheme(req?.query?.theme);
    if (theme && isHtmlFile(resolved.filePath)) {
      try {
        const html = await readVerifiedFileSnapshot(opened, { encoding: 'utf8' });
        return res.type('html').set('Cache-Control', 'private, no-store').send(injectReportTheme(html, theme));
      } catch {
        return res.status(404).json({ error: 'file_not_found' });
      }
    }

    // Each fixed block is hashed before the exact Buffer read from the
    // unlinked descriptor is pushed. A retained writer can therefore abort a
    // response, but cannot make the route send bytes outside Snapshot Truth.
    const stream = createVerifiedSnapshotReadStream(opened);
    stream.once('error', (error) => {
      if (!res.headersSent) {
        res.status(404).json({ error: 'file_not_found' });
      } else {
        res.destroy(error);
      }
    });
    res
      .type(artifactContentTypeHint(resolved.filePath))
      .set('Cache-Control', 'private, no-store')
      .set('Content-Length', String(opened.stat.size));
    return pipeVerifiedSnapshotToResponse(stream, req, res);
  }

  function regenerateReportForImage(jobId, toolId, filename, outputDirOverride) {
    if (!filename.endsWith('.png') || !toolId) return;
    try {
      // Phase 4: 优先用调用方解析出的 outputDir（项目沙盒），回退全局目录
      const outputDir = outputDirOverride || path.join(jobsDir, jobId, 'output');
      const templatePath = path.join(scriptsDir, toolId + '-report-template.html');
      if (!fs.existsSync(templatePath)) return;
      let html = fs.readFileSync(templatePath, 'utf-8');
      const pngs = fs.readdirSync(outputDir).filter((f) => f.endsWith('.png'));
      for (const png of pngs) {
        const pngPath = path.join(outputDir, png);
        const b64 = fs.readFileSync(pngPath).toString('base64');
        const dataUri = 'data:image/png;base64,' + b64;
        html = html.split('https://biof3.com/api/r/tools/demo/' + toolId + '/' + png).join(dataUri);
        html = html
          .split('https://biof3.com/api/platform/tools/demo/' + toolId + '/' + png)
          .join(dataUri);
        if (png === 'heatmap.png') {
          html = html
            .split('https://biof3.com/api/r/tools/demo/' + toolId + '/heatmap_top50.png')
            .join(dataUri);
          html = html
            .split('https://biof3.com/api/platform/tools/demo/' + toolId + '/heatmap_top50.png')
            .join(dataUri);
        }
      }
      fs.writeFileSync(path.join(outputDir, 'report.html'), html);
    } catch (e) {
      console.warn('[tools] Report regen failed:', e.message);
    }
  }

  async function handlePrivateFileWrite(req, res, toolId) {
    try {
      const job =
        req.toolJob ||
        (await db.prepare('SELECT * FROM tool_jobs WHERE id=?').get(req.params.jobId));

      let filePath = null;
      let outputDir = null;

      // Phase 4: 写入项目沙盒的 output/（safeJoinUnder 强制 containment）
      if (job && job.project_id) {
        try {
          const layout = resolveProjectRunLayout({
            projectId: job.project_id,
            toolJobId: job.id,
            db: dbMod,
            skipPermissionCheck: true,
            ensureDirs: false,
          });
          outputDir = layout.outputDir;
          filePath = safeJoinUnder(outputDir, req.params.filename);
        } catch (error) {
          console.warn('[tools] Project layout resolution failed for file write:', error.message);
        }
      }

      // 回退：全局目录（历史兼容）。仅当项目目录不存在时才回退。
      if (!filePath || !fs.existsSync(path.dirname(filePath))) {
        const globalPath = safeJoinUnder(jobsDir, req.params.jobId, 'output', req.params.filename);
        if (globalPath && fs.existsSync(path.dirname(globalPath))) {
          filePath = globalPath;
          outputDir = path.join(jobsDir, req.params.jobId, 'output');
        }
      }

      if (!filePath) return res.status(400).json({ error: 'bad_path' });
      if (!fs.existsSync(path.dirname(filePath)))
        return res.status(404).json({ error: 'job_dir_not_found' });
      fs.writeFileSync(filePath, req.body || Buffer.alloc(0));
      regenerateReportForImage(req.params.jobId, toolId, req.params.filename, outputDir);
      return res.json({ ok: true, replaced: req.params.filename });
    } catch (error) {
      return res.status(500).json({ error: 'file_write_failed', message: error.message });
    }
  }

  async function handleGenerateFinalReport(req, res) {
    try {
      const job = req.toolJob || (await db.prepare('SELECT * FROM tool_jobs WHERE id=?').get(req.params.jobId));
      if (!job) {
        return res.status(404).json({error: 'job_not_found'});
      }

      let outputDir = null;
      let projectExportsDir = null;

      // Phase 2: 尝试从项目目录读取
      if (job.project_id) {
        try {
          const layout = resolveProjectRunLayout({
            projectId: job.project_id,
            toolJobId: job.id,
            db: dbMod,
            skipPermissionCheck: true,
            ensureDirs: false,
          });
          outputDir = layout.outputDir;
          projectExportsDir = layout.exportsDir;
        } catch (error) {
          console.warn('[tools] Project layout resolution failed for report:', error.message);
        }
      }

      // 回退：尝试全局目录
      if (!outputDir || !fs.existsSync(outputDir)) {
        outputDir = safeJoinUnder(jobsDir, req.params.jobId, 'output');
      }

      // 回退：尝试历史 result_json 路径
      const result = job && job.result_json
        ? (typeof job.result_json === 'string' ? JSON.parse(job.result_json) : job.result_json)
        : null;
      const resultDir = result && (result.resultDir || result.outputDir);
      if ((!outputDir || !fs.existsSync(outputDir)) && isManagedResultDir(resultDir, jobsDir)) {
        outputDir = path.resolve(resultDir);
      }

      if (!outputDir || !fs.existsSync(outputDir)) {
        return res.status(404).json({error: 'job_output_not_found'});
      }

      const theme = normalizeReportTheme(req.body?.theme);
      const report = materializeFinalReport({
        outputDir,
        transformHtml: theme ? (html) => injectReportTheme(html, theme) : undefined,
      });

      // Phase 4: 最终报告在 job 的 output/ 生成（上面已完成）；用户主动导出时，
      // 把一份自包含副本落到项目沙盒的 results/exports/，使其在项目文件树可发现。
      // 副本命名带 jobId，避免不同 job 覆盖；导出不改变 artifact truth。
      let exportRelPath = null;
      if (projectExportsDir) {
        try {
          fs.mkdirSync(projectExportsDir, { recursive: true });
          const exportName = `${req.params.jobId}-${report.fileName}`;
          const exportTarget = safeJoinUnder(projectExportsDir, exportName);
          if (exportTarget) {
            fs.copyFileSync(path.join(outputDir, report.fileName), exportTarget);
            exportRelPath = path.join('results', 'exports', exportName);
          }
        } catch (error) {
          console.warn('[tools] Final report export copy failed:', error.message);
        }
      }

      return res.json({
        ok: true,
        ...report,
        theme,
        url: `/api/tools/file/${encodeURIComponent(req.params.jobId)}/${report.fileName}`,
        ...(exportRelPath ? { exportPath: exportRelPath } : {}),
      });
    } catch (error) {
      const code = error && error.code === 'report_source_not_found' ? 'report_source_not_found' : 'report_generation_failed';
      return res.status(code === 'report_source_not_found' ? 404 : 500).json({error: code, message: error.message});
    }
  }

  async function recoverZombieJobs({ startup = false } = {}) {
    try {
      const cutoff = Date.now() - ZOMBIE_TIMEOUT_MS;
      // BLOCK-57：远程作业无本地子进程，本地 stale-kill 语义不适用（D5.3 连不上≠作业死）。
      const locallyOwned = new Map([...activeToolJobs].filter(([, active]) => !active.remote));
      await recoverStaleActiveJobs({ activeJobs: locallyOwned, cutoff, db });
      const result = await markUnownedStaleJobs({
        db,
        cutoff,
        ownedJobIds: activeToolJobs.keys(),
        excludeRemoteTargets: true,
      });
      if (result.changes > 0) {
        console.log(`[tools] Recovered ${result.changes} unowned zombie job(s)`);
        try {
          notify.custom({
            title: `⚠️ ${startup ? '启动恢复' : '周期扫描'}：${result.changes} 个无主 zombie 任务标 failed`,
            template: 'orange',
            dedupeKey: `zombie_${startup ? 'startup' : 'periodic'}:${result.changes}`,
            lines: [
              '发现超过活性窗口且没有本次进程句柄的 running/pending 任务。',
              '因无法证明 PID 归属，未发送信号；已如实标记 failed。',
            ],
          });
        } catch {}
      }
      // BLOCK-57：远程作业对账恢复（D5.2）——running + 有目标 + 本进程无 owner
      // （重启遗留）→ re-attach；节点状态真相决定终态。
      try {
        const remoteRunning = await db
          .prepare("SELECT id FROM tool_jobs WHERE status='running' AND execution_target_id IS NOT NULL")
          .all();
        for (const row of remoteRunning) {
          if (!activeToolJobs.has(row.id)) {
            await adoptRemoteRunningJob(row.id);
          }
        }
      } catch (e) {
        console.warn('[tools] remote re-adopt scan failed:', e.message);
      }
    } catch (e) {
      console.warn(`[tools] recoverZombieJobs failed: ${e.message} — skipping startup scan`);
    }
  }

  function startZombieRecovery() {
    recoverZombieJobs({ startup: true });
    setInterval(
      () => {
        void recoverZombieJobs({ startup: false });
      },
      5 * 60 * 1000
    );
  }

  async function markJobFailed(jobId, errorMsg, stage) {
    const raw = String(errorMsg || '');
    let errStr;
    if (raw.length <= 3000) {
      errStr = raw;
    } else {
      errStr =
        raw.slice(0, 1200) +
        '\n\n... [truncated ' +
        (raw.length - 2400) +
        ' chars] ...\n\n' +
        raw.slice(-1200);
    }
    const failed = await transitionToolJobToFailed({ db, jobId, error: errStr });
    if (!failed || failed.changes < 1) {
      console.log('[tools] Job ' + jobId + ' reached another terminal state; skip failure overwrite');
      return;
    }
    const translated = translateRError(errStr);
    if (translated) {
      const combined = '💡 ' + translated + '\n\n--- 原始错误信息 ---\n' + errStr;
      await db
        .prepare('UPDATE tool_jobs SET error=? WHERE id=? AND status=?')
        .run(combined, jobId, 'failed');
    }
    try {
      const job = await db
        .prepare('SELECT user_id, tool_id, created_at, is_test_run FROM tool_jobs WHERE id=?')
        .get(jobId);
      if (!job) return;
      if (job.is_test_run) return;
      let username = null;
      try {
        const u = await db.prepare('SELECT username FROM users WHERE id=?').get(job.user_id);
        username = u && u.username;
      } catch {}
      notify.toolJobFailed({
        jobId,
        toolId: job.tool_id,
        username,
        error: errStr,
        durationMs: job.created_at ? Date.now() - job.created_at : null,
        stage,
      });
    } catch (e) {
      console.warn('[tools] notify on failure error:', e.message);
    }
  }

  function getToolConfig(toolId) {
    // Installed plugins take precedence and carry absolute local script paths.
    try {
      const { getScriptForTool, getPlugin } = require('../plugin-loader');
      const plugin = getPlugin(toolId);
      if (plugin) {
        const scriptPath = getScriptForTool(toolId);
        if (scriptPath && fs.existsSync(scriptPath)) {
          return {
            script: scriptPath,
            lang: plugin.language,
            _isPlugin: true,
            pluginDir: plugin.pluginDir,
            // Carry bundle declarations so the run path can (a) auto-provision
            // required capability bundles and (b) mount them via R_LIBS_USER.
            requiresBundle: plugin.requiresBundle,
            requiresBundleVersion: plugin.requiresBundleVersion,
          };
        }
      }
    } catch (e) {
      console.warn('[tools] plugin-loader lookup failed for', toolId, ':', e.message);
    }

    // Built-in registry is the local R-tool fallback. Python tools run locally via the executor registry.
    try {
      const { getToolConfig: getRegistryConfig } = require('../tool-registry');
      const cfg = getRegistryConfig(toolId);
      if (cfg && cfg.lang === 'r' && cfg.pluginOnly !== true) {
        return {
          script: cfg.script,
          lang: cfg.lang,
        };
      }
    } catch (e) {
      console.warn('[tools] tool-registry lookup failed for', toolId, ':', e.message);
    }

    return null;
  }

  // BLOCK-57 —— 远程执行编排（daemonless：节点真相在 state/exit 文件，见设计评审 D1/D4/D5）
  const targetRegistry = createTargetRegistry({ db, ensureAgent: ({ alias }) => remoteRunner.ensureAgent({ alias }) });
  const remoteRunner = createRemoteJobRunner();

  const REMOTE_RUNNER_SAMPLES = {
    peak: {},
    sampling: { status: 'unavailable', sampleCount: null, reason: 'remote_execution' },
    peakStatus: 'unavailable',
  };
  const REMOTE_LOG_CAP_BYTES = 10 * 1024 * 1024;

  /**
   * 提交前解析执行目标：目标存在 → 节点探测 → 语言运行时解析（诚实失败）。
   * argmode 镜像本地 spawn 约定：R 一律 job_dir；Python 插件 job_dir / 内置 params。
   */
  async function resolveRemoteTargetForJob({ cfg, targetId }) {
    const target = await targetRegistry.getById({ id: targetId });
    if (!target) {
      return { error: true, stage: 'setup', message: '执行目标不存在或已被移除（' + String(targetId).slice(0, 40) + '）' };
    }
    const probe = await targetRegistry.probe({ id: target.id });
    if (!probe.ok) {
      return { error: true, stage: 'setup', message: '执行目标探测失败（' + probe.error + '）：' + (probe.detail || '') };
    }
    const runtime = remoteRunner.resolveRuntime(probe.info, cfg.lang);
    // 目标级运行时覆盖（module 系统 / 非 PATH 安装）优先于探测结果
    let override = null;
    try { override = target.runtime_json ? JSON.parse(target.runtime_json) : null; } catch { override = null; }
    const overrideBin = override && typeof override[cfg.lang] === 'string' ? override[cfg.lang] : null;
    if (overrideBin) {
      runtime.ready = true;
      runtime.runtimeBin = overrideBin;
      runtime.reason = null;
      runtime.overridden = true;
    }
    if (!runtime.ready) {
      return { error: true, stage: 'runtime', message: runtime.reason + '（目标 ' + target.alias + '）' };
    }
    const argmode = cfg.lang === 'r' || cfg._isPlugin ? 'jobdir' : 'params';
    return { target, probeInfo: probe.info, runtime, argmode, mode: 'submit' };
  }

  /**
   * 远程作业主循环：提交（attach 模式跳过）→ 日志流（断开即重连，偏移续传）→
   * 30s 轮询节点状态（心跳事实源）→ 终态后产物拉回 + sha256 对账 → 共用 finalize。
   * 传输失败永不改写作业终态（D8），只有节点真相与产物校验可以。
   */
  async function runRemoteToolJob({
    owner,
    jobId,
    jobDir,
    outputDir,
    cfg,
    remoteDispatch,
    finalizeJobRun,
    markJobFailed: markFailed,
  }) {
    const alias = remoteDispatch.target.alias;
    owner.remote = true;

    let stdoutText = '';
    const mirrorLogPath = path.join(outputDir, 'remote-runner.log');
    const appendLog = (text) => {
      stdoutText = (stdoutText + text).slice(-REMOTE_LOG_CAP_BYTES);
      try { fs.appendFileSync(mirrorLogPath, text); } catch {}
    };

    let logOffset = 0;
    let logStream = null;
    const startLogStream = () => {
      logStream = remoteRunner.streamLog({
        alias,
        jobId,
        offset: logOffset,
        onChunk: (chunk) => {
          logOffset += chunk.length;
          appendLog(chunk.toString('utf8'));
        },
        onExit: () => { logStream = null; },
      });
    };

    if (remoteDispatch.mode !== 'attach') {
      owner.phase = 'remote-submitting';
      const submitted = await remoteRunner.submit({
        target: remoteDispatch.target,
        jobId,
        jobDir,
        lang: cfg.lang,
        argmode: remoteDispatch.argmode,
        runtimeBin: remoteDispatch.runtime.runtimeBin,
      });
      if (!submitted.ok) {
        const kind = (submitted.error && submitted.error.kind) || 'transport.unknown';
        const detail = (submitted.error && submitted.error.detail) || '';
        const stage = submitted.stage === 'start' && kind === 'node.runtime_missing' ? 'runtime' : 'setup';
        await markFailed(jobId, '远程提交失败（' + submitted.stage + '/' + kind + '）：' + detail, stage);
        releaseActiveToolJob(activeToolJobs, jobId, owner);
        return;
      }
    }
    owner.phase = 'remote-running';
    startLogStream();

    let cancelSent = false;
    let unknownCount = 0;
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, HEARTBEAT_INTERVAL_MS));
      if (owner.cancelRequested && !cancelSent) {
        cancelSent = true;
        await remoteRunner.cancel({ alias, jobId });
      }
      const status = await remoteRunner.pollStatus({ alias, jobId });
      if (!status.ok) {
        // 传输失败 ≠ 作业失败：挂起重试，UI 以「状态未知（以节点为准）」理解。
        if (!logStream) startLogStream();
        continue;
      }
      if (status.kind === 'active') {
        unknownCount = 0;
        try {
          await db.prepare("UPDATE tool_jobs SET heartbeat_at=? WHERE id=? AND status='running'").run(Date.now(), jobId);
        } catch {}
        owner.lastHeartbeatAt = Date.now();
        owner.livenessLostAt = null;
        if (!logStream) startLogStream();
        continue;
      }
      if (status.kind === 'unknown') {
        unknownCount += 1;
        if (unknownCount >= 3) {
          // 节点明确应答无此作业记录——节点真相胜出，诚实失败（D4）。
          try { if (logStream) logStream.stop(); } catch {}
          await markFailed(jobId, '节点侧无此作业记录（可能已被清理或 agent 数据目录被移除）', 'execute');
          releaseActiveToolJob(activeToolJobs, jobId, owner);
          return;
        }
        continue;
      }
      // terminal —— 节点终态事实（exit.json）
      try { if (logStream) logStream.stop(); } catch {}
      const exit = await remoteRunner.fetchExitInfo({ alias, jobId });
      const exitInfo = exit.ok ? exit.info : null;
      const code = Number(exitInfo && exitInfo.code);
      if (owner.cancelRequested) {
        // 取消收敛：finalize 内 cancelRequested 分支落 cancelled（与本地同链）。
        await finalizeJobRun({ err: null, stdout: stdoutText, stderr: '', sampledResources: REMOTE_RUNNER_SAMPLES });
        return;
      }
      const pulled = await remoteRunner.pullOutputs({ target: remoteDispatch.target, jobId, localJobDir: jobDir });
      if (!pulled.ok) {
        if (pulled.stage === 'verify') {
          await markFailed(jobId, '产物传输完整性校验失败（fail-closed）：' + ((pulled.error && pulled.error.detail) || ''), 'artifact_validation');
          releaseActiveToolJob(activeToolJobs, jobId, owner);
          return;
        }
        if (Number.isFinite(code) && code !== 0) {
          // 作业已失败的诊断性产物：拉不回也如实进失败链，不无限重试。
          const scriptErr = Object.assign(new Error('remote script exited ' + code), { code });
          await finalizeJobRun({ err: scriptErr, stdout: stdoutText, stderr: '', sampledResources: REMOTE_RUNNER_SAMPLES });
          return;
        }
        // 成功作业的产物传输失败：挂起重试（终态事实不会消失），回到轮询循环。
        if (!logStream) startLogStream();
        continue;
      }
      const scriptErr = Number.isFinite(code) && code !== 0
        ? Object.assign(new Error('remote script exited ' + code), { code })
        : null;
      await finalizeJobRun({ err: scriptErr, stdout: stdoutText, stderr: '', sampledResources: REMOTE_RUNNER_SAMPLES });
      return;
    }
  }

  /**
   * 重启恢复（D5.2 启动扫描）：re-attach 节点侧仍在运行的远程作业，走同一
   * 收尾工厂。节点探测失败不标败（连不上≠作业死），留待下次扫描。
   */
  async function adoptRemoteRunningJob(jobId) {
    let job;
    try {
      job = await db.prepare('SELECT * FROM tool_jobs WHERE id=?').get(jobId);
    } catch {
      return;
    }
    if (!job || job.status !== 'running' || !job.execution_target_id) return;
    if (activeToolJobs.has(jobId)) return;
    const cfg = getToolConfig(job.tool_id);
    if (!cfg) {
      await markJobFailed(jobId, 'Unknown tool: ' + job.tool_id, 'config');
      return;
    }
    const owner = claimActiveToolJob(activeToolJobs, { jobId, toolId: job.tool_id });
    if (!owner) return;
    let jobDir = null;
    if (job.project_id) {
      try {
        const layout = resolveProjectRunLayout({
          projectId: job.project_id,
          toolJobId: jobId,
          db: dbMod,
          skipPermissionCheck: true,
          ensureDirs: true,
        });
        jobDir = layout.jobRoot;
      } catch (error) {
        console.warn('[tools] remote adopt project layout failed:', error.message);
      }
    }
    if (!jobDir) jobDir = safeJoinUnder(jobsDir, jobId);
    if (!jobDir) {
      releaseActiveToolJob(activeToolJobs, jobId, owner);
      return;
    }
    config.mkdirSandbox(jobDir);
    const outputDir = path.join(jobDir, 'output');
    config.mkdirSandbox(outputDir);
    const dispatch = await resolveRemoteTargetForJob({ cfg, targetId: job.execution_target_id });
    if (dispatch.error) {
      releaseActiveToolJob(activeToolJobs, jobId, owner);
      console.warn('[tools] remote adopt probe failed for ' + jobId + ': ' + dispatch.message);
      return;
    }
    dispatch.mode = 'attach';
    const startedAt = new Date().toISOString();
    const runtimeCommand = dispatch.runtime.runtimeBin;
    const runtimeReady = { runtime: cfg.lang || null, ready: true, command: runtimeCommand, reason: null };
    const runtimeVersion = dispatch.runtime.version;
    const remoteScriptBase = 'run-script.' + (cfg.lang === 'r' ? 'R' : 'py');
    const runCmd = dispatch.argmode === 'jobdir'
      ? [runtimeCommand, remoteScriptBase, remoteJobDirPath(jobId)]
      : [runtimeCommand, remoteScriptBase, '--args', 'params.json'];
    const buildProvenance = (artifacts = []) => buildJobProvenance({
      jobId,
      job: hydrateExecutionJob(job),
      toolId: job.tool_id,
      cfg,
      jobDir,
      runtimeCommand,
      runtimeReady,
      runtimeVersion,
      runCmd,
      startedAt,
      artifacts,
      executionTarget: {
        kind: 'ssh-direct',
        targetId: dispatch.target.id,
        alias: dispatch.target.alias,
        nodeOs: dispatch.probeInfo.os || null,
        runtime: { name: cfg.lang || null, version: runtimeVersion, command: runtimeCommand },
        remoteJobDir: remoteJobDirPath(jobId),
        argmode: dispatch.argmode,
        agentVersion: AGENT_SCRIPT_HASH,
        transport: 'tar-over-ssh',
        recoveredAfterRestart: true,
      },
    });
    const finalizeJobRun = createJobRunFinalizer({
      owner,
      jobId,
      toolId: job.tool_id,
      cfg,
      jobDir,
      outputDir,
      stagedInputFiles: [],
      stagedInputSnapshots: [],
      buildProvenance,
      resourceStart: createRuntimeResourceSnapshot({
        disk: diskSnapshot(outputDir),
        runtime: { r: cfg.lang === 'r', python: cfg.lang === 'python' },
        activeJobs: activeToolJobs.size,
        observedAt: startedAt,
      }),
      runtimeCommand,
      runtimeReady,
      hardTimeoutMs: TOOL_LIFECYCLE.hardTimeoutMs,
    });
    console.log('[tools] re-adopting remote job ' + jobId + ' on ' + dispatch.target.alias);
    await runRemoteToolJob({
      owner,
      jobId,
      jobDir,
      outputDir,
      cfg,
      remoteDispatch: dispatch,
      finalizeJobRun,
      markJobFailed,
    });
  }

  // BLOCK-57：Job 终态收尾工厂。本地 / 远程提交 / 重启恢复三条执行路径共用同一
  // 收尾实现（cancellation / failure / artifact 校验 / manifest / completed 落库），
  // 不存在第二条 Artifact Truth 构建路径。
  function createJobRunFinalizer(deps) {
    const {
      owner,
      jobId,
      toolId,
      cfg,
      jobDir,
      outputDir,
      stagedInputFiles,
      stagedInputSnapshots,
      buildProvenance,
      resourceStart,
      runtimeCommand,
      runtimeReady,
      hardTimeoutMs,
    } = deps;
    return async function finalizeJobRun({ err, stdout, stderr, sampledResources }) {
      try {
        const active = owner;
        clearActiveToolJobLifecycleTimers(active);
        const resourceEnd = createRuntimeResourceSnapshot({
          disk: diskSnapshot(outputDir),
          runtime: { r: cfg.lang === 'r' && runtimeReady?.ready, python: cfg.lang === 'python' && runtimeReady?.ready },
          activeJobs: Math.max(
            0,
            activeToolJobs.size - (activeToolJobs.get(jobId) === owner ? 1 : 0),
          ),
          observedAt: new Date().toISOString(),
        });
        const resourceUsage = { start: resourceStart, end: resourceEnd, ...sampledResources };
        try {
          const log = `=== STDOUT ===\n${stdout || ''}\n\n=== STDERR ===\n${stderr || ''}\n\n=== EXIT ===\n${err ? 'ERROR: ' + err.message : 'OK'}\nTimestamp: ${new Date().toISOString()}\n`;
          fs.writeFileSync(path.join(outputDir, 'run.log'), log);
        } catch {}

        let currentJob = null;
        try {
          currentJob = await db
            .prepare('SELECT status, is_test_run, result_json FROM tool_jobs WHERE id=?')
            .get(jobId);
        } catch {}
        const finalizeCancellation = async (recorded = null) => {
          try {
            const finalOutput = await directoryBytes(outputDir);
            mergeFinalOutputMeasurement(resourceUsage, finalOutput);
          } catch {
            // Periodic samples remain truthful when the final directory scan is unavailable.
          }
          let cancellationProvenance = recorded;
          if (!cancellationProvenance) {
            try { cancellationProvenance = buildProvenance(); } catch {}
          }
          const cancelledResult = buildCancelledToolResult({
            existingResult: parseStoredToolResult(currentJob),
            jobId,
            resourceUsage,
            executionProvenance: cancellationProvenance?.provenance || null,
            provenanceRef: cancellationProvenance ? {
              provenanceHash: cancellationProvenance.provenance.provenanceHash,
              path: cancellationProvenance.provenancePath,
              toolJobId: jobId,
            } : null,
          });
          try {
            await settleConfirmedToolCancellation({ db, jobId, result: cancelledResult });
          } catch (error) {
            console.warn('[tools] cancelled Job terminal persistence failed:', error.message);
          }
          console.log('[tools] Job ' + jobId + ' cancellation confirmed by process exit');
        };
        if (active && active.cancelRequested) {
          await finalizeCancellation();
          return;
        }
        if (currentJob && currentJob.status === 'cancelled') {
          await finalizeCancellation();
          return;
        }

        const executionFailure = err || active.setupFailure;
        if (executionFailure) {
          let failed = null;
          try {
            failed = buildProvenance();
          } catch (error) {
            console.warn('[tools] failed Job provenance persistence failed:', error.message);
          }
          const failedResult = buildFailedToolResult({
            existingResult: parseStoredToolResult(currentJob),
            jobId,
            reason: active.setupFailure
              ? 'executor_setup_failure'
              : active?.timedOut
                ? 'hard_timeout'
                : err.killed
                  ? 'terminated'
                  : 'nonzero_exit',
            exitCode: err?.code ?? null,
            resourceUsage,
            executionProvenance: failed?.provenance || null,
            provenanceRef: failed ? {
              provenanceHash: failed.provenance.provenanceHash,
              path: failed.provenancePath,
              toolJobId: jobId,
            } : null,
          });
          try {
            await db
              .prepare('UPDATE tool_jobs SET result_json=? WHERE id=? AND status IN (?,?,?)')
              .run(JSON.stringify(failedResult), jobId, 'pending', 'running', 'failed');
          } catch (error) {
            console.warn('[tools] failed Job resource summary persistence failed:', error.message);
          }
          if (active.cancelRequested) {
            await finalizeCancellation(failed);
            return;
          }
          const failureMessage = active?.timedOut
            ? `任务超过最大运行预算 ${hardTimeoutMs}ms；子进程退出已确认`
            : active.setupFailure?.message || stderr || err?.message || '';
          await markJobFailed(jobId, failureMessage, 'execute');
          return;
        }

        let expectedArtifacts = [];
        try {
          const pluginLoader = require('../plugin-loader');
          const definition = pluginLoader.getToolDefinition(toolId);
          expectedArtifacts = Array.isArray(definition && definition.outputs)
            ? definition.outputs.map((item) =>
                item && item.id === 'zip' && !item.filename && !item.name
                  ? { ...item, filename: 'all_results.zip' }
                  : item
              )
            : [];
        } catch {}
        const produced = resolveProducedResultDirectory({ jobDir, outputDir, expectedArtifacts });
        const resultDir = produced.resultDir;
        const manifestPath = produced.manifestPath;
        const archiveArtifact = expectedArtifacts.find(
          (item) => item && item.id === 'zip' && item.required !== false
        );
        if (archiveArtifact) {
          try {
            await createResultArchive(
              resultDir,
              archiveArtifact.filename || archiveArtifact.name || 'all_results.zip'
            );
          } catch (archiveError) {
            if (active.cancelRequested) {
              await finalizeCancellation();
              return;
            }
            await markJobFailed(jobId, `Result archive failed: ${archiveError.message}`, 'postprocess');
            return;
          }
        }

        let result = {};
        if (fs.existsSync(manifestPath)) {
          try {
            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
            result = { ...manifest, manifest };
          } catch {}
        } else {
          const files = fs.existsSync(resultDir) ? fs.readdirSync(resultDir) : [];
          result.files = files.map((f) => ({
            name: f,
            type: f.endsWith('.png') ? 'plot' : f.endsWith('.csv') ? 'table' : 'file',
            url: '/api/tools/file/' + jobId + '/' + f,
          }));
        }
        const executionContext = createExecutionContext({
          jobDir,
          outputDir,
          resultDir,
          runtime: cfg.lang || null,
          runtimeCommand,
          runtimeReady,
        });
        result.toolJobId = jobId;
        result.jobDir = jobDir;
        result.outputDir = outputDir;
        result.resultDir = resultDir;
        result.canonicalJobDir = canonicalizePath(jobDir);
        result.canonicalOutputDir = canonicalizePath(outputDir);
        result.canonicalResultDir = canonicalizePath(resultDir);
        result.execution = executionContext;
        try {
          const finalOutput = await directoryBytes(resultDir);
          mergeFinalOutputMeasurement(resourceUsage, finalOutput);
        } catch {
          // Process/system samples remain valid when final output accounting is unavailable.
        }
        result.resourceUsage = resourceUsage;
        result.artifactSchemaVersion = result.artifactSchemaVersion || 1;
        if (Array.isArray(result.outputs)) {
          result.outputs = result.outputs.map((item) => {
            const name = item && (item.filename || item.name || item.path);
            if (!name) return item;
            const itemPath = item.path || path.join(resultDir, path.basename(String(name)));
            return {
              ...item,
              path: itemPath,
              canonicalPath: item.canonicalPath || canonicalizePath(itemPath),
            };
          });
        }
        if (Array.isArray(result.files)) {
          result.files = result.files.map((item) => {
            const name = item && (item.filename || item.name || item.path);
            if (!name) return item;
            const itemPath = item.path || path.join(resultDir, path.basename(String(name)));
            return {
              ...item,
              path: itemPath,
              canonicalPath: item.canonicalPath || canonicalizePath(itemPath),
            };
          });
        }
        const truth = reconcileArtifactTruth({
          result,
          resultDir,
          expectedArtifacts,
          canonicalizePath,
          excludedArtifactPaths: stagedInputFiles,
          stagedInputSnapshots,
        });
        const recorded = buildProvenance(truth.artifacts);
        result = attachProvenanceToResult(truth.result, recorded.provenance, recorded.provenancePath);
        writeArtifactManifest({
          outputDir: resultDir,
          result,
          provenance: recorded.provenance,
          plugin: recorded.pluginManifest,
        });
        if (active.cancelRequested) {
          await finalizeCancellation(recorded);
          return;
        }
        if (truth.blocking) {
          const truthError =
            truth.issues
              .filter((issue) => issue.severity === 'error')
              .map((issue) => issue.message)
              .join('; ') || 'Required result artifacts are missing.';
          await markJobFailed(jobId, truthError, 'artifact_validation');
          await db
            .prepare('UPDATE tool_jobs SET result_json=? WHERE id=? AND status=?')
            .run(JSON.stringify(result), jobId, 'failed');
          return;
        }
        const completed = await transitionToolJobToCompleted({ db, jobId, result });
        if (!completed || completed.changes < 1) {
          if (active.cancelRequested) await finalizeCancellation(recorded);
          return;
        }
        console.log('[tools] Job ' + jobId + ' completed');

        try {
          if (currentJob && currentJob.is_test_run) {
            fs.rmSync(jobDir, { recursive: true, force: true });
            console.log('[tools] Cleaned up test job dir: ' + jobId);
          }
        } catch (e) {
          console.warn('[tools] cleanup error:', e.message);
        }
        } catch (callbackError) {
          console.warn('[tools] Job ' + jobId + ' finalization failed:', callbackError.message);
          try {
            await markJobFailed(jobId, `Job finalization failed: ${callbackError.message}`, 'finalize');
          } catch (persistenceError) {
            console.warn('[tools] Job finalization failure persistence failed:', persistenceError.message);
          }
        } finally {
          releaseActiveToolJob(activeToolJobs, jobId, owner);
        }
      };
    }

  async function executeJob(jobId, toolId, jobDir, stagedInputFiles = []) {
    const owner = claimActiveToolJob(activeToolJobs, { jobId, toolId });
    if (!owner) {
      console.warn('[tools] Job ' + jobId + ' already has an active execution owner');
      return;
    }
    const started = await db
      .prepare('UPDATE tool_jobs SET status = ? WHERE id = ? AND status = ?')
      .run('running', jobId, 'pending');
    if (!started || started.changes < 1) {
      releaseActiveToolJob(activeToolJobs, jobId, owner);
      console.log('[tools] Job ' + jobId + ' not started because it is no longer pending');
      return;
    }
    const job = hydrateExecutionJob(
      await db.prepare('SELECT * FROM tool_jobs WHERE id = ?').get(jobId)
    );
    if (!job) {
      await markJobFailed(jobId, 'Tool job disappeared before execution.', 'setup');
      releaseActiveToolJob(activeToolJobs, jobId, owner);
      return;
    }
    let stagedInputSnapshots;
    try {
      stagedInputSnapshots = captureStagedInputSnapshots(stagedInputFiles);
    } catch (error) {
      await markJobFailed(jobId, `Staged input snapshot failed: ${error.message}`, 'setup');
      releaseActiveToolJob(activeToolJobs, jobId, owner);
      return;
    }
    const outputDir = path.join(jobDir, 'output');
    config.mkdirSandbox(outputDir);

    const cfg = getToolConfig(toolId);
    if (!cfg) {
      await markJobFailed(jobId, 'Unknown tool: ' + toolId, 'config');
      releaseActiveToolJob(activeToolJobs, jobId, owner);
      return;
    }

    // 插件脚本：cfg.script 已是绝对路径；内置工具：拼 scriptsDir
    const scriptSrc = cfg._isPlugin ? cfg.script : path.join(scriptsDir, cfg.script);
    if (!fs.existsSync(scriptSrc)) {
      await markJobFailed(jobId, 'Script not found: ' + cfg.script, 'config');
      releaseActiveToolJob(activeToolJobs, jobId, owner);
      return;
    }

    const scriptPath = path.join(jobDir, 'run-script.' + (cfg.lang === 'r' ? 'R' : 'py'));

    try {
      fs.copyFileSync(
        scriptSrc,
        path.join(jobDir, 'run-script.' + (cfg.lang === 'r' ? 'R' : 'py'))
      );
      // 报告模板：插件自带模板优先；内置插件可复用 biof3-server 旧模板。
      const templateCandidates = cfg._isPlugin
        ? [
            path.join(cfg.pluginDir, toolId + '-report-template.html'),
            path.join(scriptsDir, toolId + '-report-template.html'),
          ]
        : [path.join(scriptsDir, toolId + '-report-template.html')];
      const templateSrc = templateCandidates.find((candidate) => fs.existsSync(candidate));
      if (templateSrc) {
        fs.copyFileSync(templateSrc, path.join(jobDir, 'report-template.html'));
      }
      if (cfg.lang === 'r') {
        const sharedHelpers = ['_biof3-theme.R'];
        // 插件脚本目录优先（build-plugin.sh 已把 _biof3-theme.R 复制进去），其次 scriptsDir
        const helperSearchDirs = cfg._isPlugin
          ? [path.dirname(scriptSrc), scriptsDir]
          : [scriptsDir];
        for (const h of sharedHelpers) {
          for (const dir of helperSearchDirs) {
            const src = path.join(dir, h);
            if (fs.existsSync(src)) {
              fs.copyFileSync(src, path.join(jobDir, h));
              break;
            }
          }
        }
      }
    } catch (e) {
      await markJobFailed(jobId, 'Copy failed: ' + e.message, 'setup');
      releaseActiveToolJob(activeToolJobs, jobId, owner);
      return;
    }

    // 本地执行：直接调内嵌 Rscript/python3。
    let runCmd;
    let runEnv = undefined;
    let runtimeReady = null;
    let runtimeCommand = null;
    let runtimeVersion = null;

    // BLOCK-57：作业级 ExecutionTarget 分派。execution_target_id 为 NULL 走
    // 本地路径（逐字节不变）；非 NULL 走远程（节点探测 → 语言运行时解析）。
    // 远程作业不做本地 BLOCK-58 依赖检查与本地 binPath 检查——节点侧运行时
    // 以 agent probe 为准，缺失走 stage=runtime 诚实失败。
    let remoteDispatch = null;
    if (job.execution_target_id) {
      remoteDispatch = await resolveRemoteTargetForJob({ jobId, cfg, targetId: job.execution_target_id });
      if (remoteDispatch.error) {
        await markJobFailed(jobId, remoteDispatch.message, remoteDispatch.stage);
        releaseActiveToolJob(activeToolJobs, jobId, owner);
        return;
      }
      runtimeReady = { runtime: cfg.lang || null, ready: true, command: remoteDispatch.runtime.runtimeBin, reason: null };
      runtimeCommand = remoteDispatch.runtime.runtimeBin;
      runtimeVersion = remoteDispatch.runtime.version;
      const remoteScriptBase = 'run-script.' + (cfg.lang === 'r' ? 'R' : 'py');
      runCmd = remoteDispatch.argmode === 'jobdir'
        ? [remoteDispatch.runtime.runtimeBin, remoteScriptBase, remoteJobDirPath(jobId)]
        : [remoteDispatch.runtime.runtimeBin, remoteScriptBase, '--args', 'params.json'];
    }
    if (!remoteDispatch) {
      const { getExecutor } = require('../../shared-backend/executors');
      const executor = getExecutor(cfg.lang);
      runtimeCommand = executor && executor.binPath;
      // BLOCK-66 P1 — runtime preflight：binPath 是路径字符串（executor 解析
      // 失败会回退 PATH 搜索仍返回字符串），必须 existsSync 校验；R/Python
      // 运行时未安装时诚实失败 + 商店指引（而非裸 spawn ENOENT）。
      runtimeReady = evaluateRuntimePreflight(executor, cfg.lang);
      runtimeVersion = runtimeReady.ready && typeof executor.getRuntimeVersion === 'function'
        ? executor.getRuntimeVersion()
        : null;
      if (!runtimeReady.ready) {
        await markJobFailed(jobId, runtimeReady.reason, 'runtime');
        releaseActiveToolJob(activeToolJobs, jobId, owner);
        return;
      }
      if (cfg.lang === 'r') {
        // BLOCK-58 — 内置 R 工具脚本执行前毫秒级依赖检查（读 _dependencies.json，
        // executor.checkPackageInstalled 查 R_HOME/library 目录存在性）：缺包直接
        // fail-fast 拒绝派生进程（脚本内亦有 MISSING_R_PACKAGES 兜底，分析路径零联网安装）。
        // 插件脚本（_isPlugin）走 manifest packages + 预编译包通道，不在此管。
        if (!cfg._isPlugin) {
          const { checkToolDependencies, missingPackagesMessage } = require('./tool-dependencies');
          const depCheck = checkToolDependencies(executor, cfg.script);
          if (depCheck.checked && depCheck.missing.length > 0) {
            await markJobFailed(jobId, missingPackagesMessage(toolId, depCheck.missing), 'dependencies');
            releaseActiveToolJob(activeToolJobs, jobId, owner);
            return;
          }
        }
        // R 工具脚本约定：commandArgs(trailingOnly=TRUE)[1] = job_dir
        //（deseq2.R: `args <- commandArgs(trailingOnly=TRUE); job_dir <- args[1]`）
        // 不能用 buildSpawnCommand（它加 --args params.json，是 figcode 脚本约定，
        // 会让 args[1]="--args"，R 脚本 source(file.path("--args",...)) 找不到文件）
        runCmd = [executor.binPath, scriptPath, jobDir];
        // 插件脚本：注入插件自带的预编译包目录到 R 库搜索路径，
        // 让 library(DESeq2) 等从 pluginDir/packages/r 加载，不污染基础 runtime library。
        // R_LIBS_USER 会被追加到默认 .libPaths() 之后，runtime 基础包仍可用。
        // 三段式组装逻辑抽到 shared-backend/r-libs-resolver.js（与 mcp/registry.js 共用）。
        if (cfg._isPlugin) {
          // Stage 3 B2 part2：在组装 R_LIBS_USER 之前，先确保插件声明的 capability
          // bundle 已就绪（缺则按需下载）。ensureBundlesForPlugin 对 unpublished /
          // unknown bundle 不下载、不抛错；任何非 ok 结果只 warn，随后照常继续用基础
          // runtime 跑（与接线前行为完全一致——resolveRLibsForPlugin 找不到即返回 null）。
          // 绝不因 bundle 未就绪而中断 job。await 确保已下载的 bundle 能被随后的
          // resolveRLibsForPlugin → checkCapabilityReady 命中。
          if (cfg.requiresBundle) {
            try {
              const ensured = await ensureBundlesForPlugin(cfg);
              if (ensured && !ensured.ok) {
                console.warn(
                  '[tools] capability bundle not fully ready for',
                  toolId,
                  '— continuing with base runtime:',
                  JSON.stringify(ensured.results)
                );
              }
            } catch (e) {
              console.warn('[tools] ensureBundlesForPlugin failed for', toolId, ':', e.message);
            }
          }
          const resolvedEnv = resolveRLibsForPlugin(cfg);
          if (resolvedEnv) runEnv = resolvedEnv;
        }
      } else {
        const spawnCmd = executor.buildSpawnCommand(scriptPath, jobDir, {});
        if (cfg._isPlugin) {
          runCmd = [executor.binPath, scriptPath, jobDir];
        } else {
          runCmd = [spawnCmd.cmd, ...spawnCmd.args];
        }
        if (spawnCmd.env) runEnv = spawnCmd.env;
      }
    }

    if (!await canLaunchOwnedToolJob({ activeToolJobs, db, jobId, owner })) {
      releaseActiveToolJob(activeToolJobs, jobId, owner);
      console.log('[tools] Job ' + jobId + ' launch suppressed by durable cancellation state');
      // BLOCK-57：远程分派窗口长（探测+上传需数秒），durable cancel 抑制启动后
      // 必须行级收敛为 cancelled——与 cancel 路由的行级 UPDATE 同语义，防作业行滞留 running。
      try {
        await db
          .prepare(
            'UPDATE tool_jobs SET status=?, error=NULL, completed_at=?, process_pid=NULL, heartbeat_at=NULL '
            + 'WHERE id=? AND status IN (?,?,?)'
          )
          .run('cancelled', Date.now(), jobId, 'pending', 'running', 'cancelled');
      } catch (error) {
        console.warn('[tools] suppressed-launch cancellation convergence failed:', error.message);
      }
      return;
    }

    const startedAt = new Date().toISOString();
    const resourceStart = createRuntimeResourceSnapshot({
      disk: diskSnapshot(outputDir),
      runtime: { r: cfg.lang === 'r' && runtimeReady?.ready, python: cfg.lang === 'python' && runtimeReady?.ready },
      activeJobs: activeToolJobs.size,
      observedAt: startedAt,
    });
    const buildProvenance = (artifacts = []) => buildJobProvenance({
      jobId,
      job,
      toolId,
      cfg,
      jobDir,
      runtimeCommand,
      runtimeReady,
      runtimeVersion,
      runCmd,
      startedAt,
      artifacts,
      executionTarget: remoteDispatch ? {
        kind: 'ssh-direct',
        targetId: remoteDispatch.target.id,
        alias: remoteDispatch.target.alias,
        nodeOs: remoteDispatch.probeInfo.os || null,
        runtime: { name: cfg.lang || null, version: runtimeVersion, command: runtimeCommand },
        remoteJobDir: remoteJobDirPath(jobId),
        argmode: remoteDispatch.argmode,
        agentVersion: AGENT_SCRIPT_HASH,
        transport: 'tar-over-ssh',
      } : null,
    });
    const hardTimeoutMs = TOOL_LIFECYCLE.hardTimeoutMs;
    let resourceSampler = null;
    const collectSampledResources = async () => {
      try {
        return resourceSampler
          ? await resourceSampler.stop()
          : {
            peak: {},
            sampling: { status: 'unavailable', sampleCount: null, reason: 'process_sampler_unavailable' },
            peakStatus: 'unavailable',
          };
      } catch {
        return {
          peak: {},
          sampling: { status: 'unavailable', sampleCount: null, reason: 'process_sampler_failed' },
          peakStatus: 'unavailable',
        };
      }
    };
    // BLOCK-57：终态收尾统一入口（工厂实现见 createJobRunFinalizer）——本地 execFile
    // 回调与远程执行路径共用，保证 provenance/校验/落库链路与 Artifact Truth 同构。
    const finalizeJobRun = createJobRunFinalizer({
      owner,
      jobId,
      toolId,
      cfg,
      jobDir,
      outputDir,
      stagedInputFiles,
      stagedInputSnapshots,
      buildProvenance,
      resourceStart,
      runtimeCommand,
      runtimeReady,
      hardTimeoutMs,
    });

    // BLOCK-57：远程执行路径——提交 + 日志流 + 节点真相轮询 + 产物拉回对账，
    // 终态后与本地路径共用同一条 finalizeJobRun 链。
    if (remoteDispatch) {
      await runRemoteToolJob({
        owner,
        jobId,
        jobDir,
        outputDir,
        cfg,
        remoteDispatch,
        finalizeJobRun,
        markJobFailed,
      });
      return;
    }

    const child = execFile(
      runCmd[0],
      runCmd.slice(1),
      { timeout: 0, maxBuffer: 10 * 1024 * 1024, env: runEnv },
      async (err, stdout, stderr) => {
        await finalizeJobRun({ err, stdout, stderr, sampledResources: await collectSampledResources() });
      }
    );
    owner.process = child;
    owner.phase = 'running';
    owner.lastHeartbeatAt = Date.now();
    armActiveToolJobLifecycle({
      active: owner,
      jobId,
      db,
      heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
      hardTimeoutMs,
    });
    resourceSampler = createToolResourceSampler({
      pid: child.pid,
      jobDir: outputDir,
      activeJobs: () => activeToolJobs.size,
    });
    resourceSampler.start();
    const ownership = await db
      .prepare('UPDATE tool_jobs SET process_pid=?, heartbeat_at=? WHERE id=? AND status=?')
      .run(child.pid || null, Date.now(), jobId, 'running');
    if (!ownership || ownership.changes < 1) {
      throw new Error('tool_job_process_ownership_persistence_rejected');
    }
    if (activeToolJobs.get(jobId) !== owner) {
      throw new Error('active_tool_job_owner_lost_after_spawn');
    }
  }

  function translateRError(rawError) {
    if (!rawError) return null;
    for (const { pattern, msg } of R_ERROR_TRANSLATIONS) {
      const m = rawError.match(pattern);
      if (m) return typeof msg === 'function' ? msg(m) : msg;
    }
    return null;
  }

  async function handleToolRun(req, res) {
    const uid = forwardedToolRunUserId(req);
    if (!uid) return res.status(401).json({ error: 'login_required' });
    const { toolId, files, projectId } = req.body || {};
    if (!toolId) return res.status(400).json({ error: 'missing_tool_id' });
    const isTest = isSmokeTestRequest(req);

    // BLOCK-57：executionTargetId 为 params 保留键——作业级 ExecutionTarget，
    // 服务端剥离后不入 params.json（脚本参数面零污染）；未知目标 fail-closed。
    let executionTargetId = null;
    let params = (req.body && req.body.params) || {};
    if (params && typeof params === 'object' && 'executionTargetId' in params) {
      const raw = params.executionTargetId;
      const rest = { ...params };
      delete rest.executionTargetId;
      params = rest;
      executionTargetId = typeof raw === 'string' && raw.trim() ? raw.trim() : null;
    }
    if (executionTargetId && !(await targetRegistry.getById({ id: executionTargetId }))) {
      return res.status(400).json({
        ok: false,
        error: 'unknown_execution_target',
        message: '执行目标不存在：' + executionTargetId,
      });
    }

    const jobId = 'job_' + uuidv4().replace(/-/g, '').slice(0, 16);

    // Phase 2: 使用项目目录解析器，或兜底到全局目录（历史兼容）
    let jobDir;
    let layout = null;
    if (projectId) {
      try {
        layout = resolveProjectRunLayout({
          projectId,
          toolJobId: jobId,
          db: dbMod,
          userId: uid,
          skipPermissionCheck: false,
          ensureDirs: true,
        });
        jobDir = layout.jobRoot;
      } catch (error) {
        console.warn('[tools] Failed to resolve project layout:', error.message);
        return res.status(400).json({
          error: 'project_layout_failed',
          message: error.message
        });
      }
    } else {
      // 兜底到全局目录（历史兼容，未来可移除）
      console.warn('[tools] No projectId provided, using legacy global directory');
      jobDir = path.join(jobsDir, jobId);
      config.mkdirSandbox(jobDir);
    }

    const uploadResult = writeUploadedFiles(jobDir, files);
    if (!uploadResult.ok) {
      try {
        fs.rmSync(jobDir, { recursive: true, force: true });
      } catch {}
      return res.status(400).json({ ok: false, error: uploadResult.error });
    }

    fs.writeFileSync(path.join(jobDir, 'params.json'), JSON.stringify(params || {}));

    const validationError = validateUploadedFiles(toolId, jobDir, files);
    if (validationError) {
      try {
        fs.rmSync(jobDir, { recursive: true, force: true });
      } catch {}
      return res.status(400).json({ ok: false, error: validationError });
    }

    if (!isTest) {
      const running = await db
        .prepare(
          "SELECT COUNT(*) as cnt FROM tool_jobs WHERE user_id = ? AND status IN ('pending','running') AND is_test_run = 0"
        )
        .get(uid);
      if (running && running.cnt >= 2)
        return res.status(429).json({
          error: 'max_concurrent',
          message: '最多同时运行 2 个分析任务，请等待当前任务完成',
        });
    }

    const toolNames = {
      deseq2: 'DESeq2',
      'go-kegg': 'GO/KEGG ORA',
      'km-survival': 'KM生存',
      gsea: 'GSEA',
      'bindea-immune': '免疫浸润',
      wgcna: 'WGCNA',
      'lasso-cox': 'LASSO Cox',
      'seurat-standard': 'Seurat',
      complexheatmap: 'ComplexHeatmap',
      'maftools-mutation': 'maftools',
      cellchat: 'CellChat',
      'ml-feature-select': 'ML特征选择',
      'ml-classifier': 'ML分类器',
      'rsf-survival': 'RSF生存森林',
      'shap-explain': 'SHAP',
      'consensus-cluster': '一致性聚类',
      'ml-scvi-annotate': 'scVI',
      'mo-mofa': 'MOFA2',
      'mo-snf': 'SNF',
    };
    const existCount = await db
      .prepare('SELECT COUNT(*) as cnt FROM tool_jobs WHERE user_id = ? AND tool_id = ?')
      .get(uid, toolId);
    const labelPrefix = isTest ? '🧪 ' : '';
    const jobName =
      labelPrefix + (toolNames[toolId] || toolId) + ' #' + ((existCount ? existCount.cnt : 0) + 1);

    await db
      .prepare(
        'INSERT INTO tool_jobs (id,user_id,tool_id,params_json,status,created_at,name,is_test_run,project_id,execution_target_id) VALUES (?,?,?,?,?,?,?,?,?,?)'
      )
      .run(
        jobId,
        uid,
        toolId,
        JSON.stringify(params || {}),
        'pending',
        Date.now(),
        jobName,
        isTest ? 1 : 0,
        projectId || null,
        executionTargetId
      );
    void executeJob(jobId, toolId, jobDir, uploadResult.entries.map((entry) => entry.filePath))
      .catch((error) => handleActiveToolJobSetupFailure({
        activeToolJobs,
        jobId,
        error,
        markFailed: markJobFailed,
      }))
      .catch((error) => {
        console.warn('[tools] Job ' + jobId + ' setup failure handling failed:', error.message);
      });
    console.log(
      `[tools] Job ${jobId} submitted (tool=${toolId} rid=${req.requestId} user=${uid} test=${isTest})`
    );
    res.json({ ok: true, jobId, status: 'pending', isTestRun: isTest, requestId: req.requestId });
  }

  startZombieRecovery();

  return {
    handleToolRun,
    handlePrivateFileRead,
    handlePrivateFileWrite,
    handleGenerateFinalReport,
    killLocalToolJob,
    cleanupLocalToolJobDir,
  };
}

const TOOL_LIFECYCLE = resolveLifecycleDurations();
const ZOMBIE_TIMEOUT_MS = TOOL_LIFECYCLE.zombieTimeoutMs;
const HEARTBEAT_INTERVAL_MS = TOOL_LIFECYCLE.heartbeatIntervalMs;

const R_ERROR_TRANSLATIONS = [
  {
    pattern: /more columns than column names/i,
    msg: 'CSV 格式错误：列数不一致。请检查文件是否有多余的逗号，或者表头列数与数据列数不匹配。',
  },
  {
    pattern: /cannot open the connection|No such file or directory/i,
    msg: '文件读取失败：请确认上传的文件格式正确且未损坏。',
  },
  {
    pattern: /object '(\w+)' not found/i,
    msg: (m) => `数据中缺少必需的列或变量："${m[1]}"。请检查输入文件的列名是否正确。`,
  },
  {
    pattern: /cannot allocate vector of size/i,
    msg: '内存不足：数据太大，超出服务器内存限制(4GB)。建议：减少基因数或样本数后重试。',
  },
  {
    pattern: /there is no package called '(\w+)'/i,
    msg: (m) => `服务器缺少 R 包 "${m[1]}"，请联系管理员安装。`,
  },
  {
    pattern: /replacement has (\d+) rows, data has (\d+)/i,
    msg: '数据维度不匹配：行数不一致。请检查输入文件的样本数是否与实验设计一致。',
  },
  {
    pattern: /undefined columns selected/i,
    msg: '列名不存在：请检查参数中指定的列名是否在数据文件中存在（注意大小写）。',
  },
  {
    pattern: /duplicate 'row\.names'/i,
    msg: '行名重复：数据文件中有重复的基因名或样本名，请去重后重新上传。',
  },
  {
    pattern: /non-numeric argument to binary operator/i,
    msg: '数据类型错误：某些应该是数字的列包含了文本。请检查数据文件中是否有非数字字符（如 "NA" 文本、空格、特殊符号）。',
  },
  {
    pattern: /subscript out of bounds/i,
    msg: '数据索引越界：可能是筛选条件过严导致结果为空。请放宽筛选阈值（如降低 padj 或 log2FC 要求）后重试。',
  },
  {
    pattern: /Killed|exit code 137/i,
    msg: '任务被系统终止（内存超限）：数据量超出服务器容量。建议：减少输入数据量或联系管理员。',
  },
  {
    pattern: /timeout|timed out/i,
    msg: '分析超时（超过 5 分钟）：数据量可能过大。建议：减少基因数/样本数，或选择更快的分析参数。',
  },
  {
    pattern: /colData.*must have the same number/i,
    msg: 'coldata 与 counts 样本数不匹配：请确认 coldata 的行数等于 counts 的列数，且样本名一致。',
  },
  {
    pattern: /design matrix.*not full rank/i,
    msg: '实验设计矩阵不满秩：可能是某个分组只有 1 个样本，或分组变量有完全共线的列。请检查 coldata。',
  },
];

// BLOCK-66 P1 — runtime preflight：executor.binPath 是路径字符串（executor
// 解析失败会回退 PATH 搜索仍返回字符串），必须 existsSync 校验；R/Python
// 运行时未安装时诚实失败 + 商店指引（而非裸 spawn ENOENT）。纯函数便于测试。
function evaluateRuntimePreflight(executor, lang) {
  const binPath = executor && executor.binPath;
  const binExists = !!(binPath && require('node:fs').existsSync(binPath));
  if (executor && binPath && binExists) {
    return { runtime: lang || null, ready: true, command: binPath, reason: null };
  }
  const label = lang === 'r' ? 'R' : lang === 'python' ? 'Python' : lang || '';
  if (!executor) {
    return { runtime: lang || null, ready: false, command: null, reason: `未找到 ${lang || 'unknown'} 执行器` };
  }
  // P3 实机实证：隔离无 R 环境下 binPath 可能为 null（PATH 搜索无果），
  // 此时同样是"运行时未安装"，必须给商店指引而非含糊的"未找到执行器"。
  const where = binPath
    ? `可执行文件不存在：${binPath}`
    : `未找到 ${lang === 'r' ? 'Rscript' : lang === 'python' ? 'python' : '可执行文件'}`;
  return {
    runtime: lang || null,
    ready: false,
    command: null,
    reason: `${label} 分析运行时未安装（${where}）。`
      + '请在「插件商店 → 运行时」安装对应分析运行时后重试（安装后需重启应用）。',
  };
}

module.exports = {
  createToolsExecutor,
  _test: {
    isManagedResultDir,
    evaluateRuntimePreflight,
    resolveUploadedFilePath,
    resolveUploadedFiles,
    writeUploadedFiles,
    validateUploadedFiles,
    hydrateExecutionJob,
    resolveProducedResultDirectory,
    resolveAuthorizedToolResultFile,
    resolveStoredArtifactTruthBinding,
    openVerifiedAuthorizedToolResultFile,
    mergeFinalOutputMeasurement,
    buildCancelledToolResult,
    buildFailedToolResult,
    claimActiveToolJob,
    releaseActiveToolJob,
    terminateOwnedToolJobProcess,
    requestActiveToolJobCancellation,
    canLaunchOwnedToolJob,
    persistVerifiedToolJobHeartbeat,
    armActiveToolJobLifecycle,
    clearActiveToolJobLifecycleTimers,
    transitionToolJobToFailed,
    transitionToolJobToCompleted,
    settleConfirmedToolCancellation,
    handleActiveToolJobSetupFailure,
  },
};
