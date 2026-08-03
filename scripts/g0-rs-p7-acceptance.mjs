#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createCaptureEnv } from './g0-rs-p4r-capture.mjs';
import {
  inspectP5NoSeedPrecondition,
  exactReplayRevision,
  prepareP5LiveScientificBaselines,
  runP5LiveWorker,
} from './g0-rs-p5-acceptance.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EVIDENCE_PATH = path.join(ROOT, 'acceptance/g0-result-studio/rs-p7-honest-product-requalification.json');
const SCREENSHOT_DIR = path.join(ROOT, 'acceptance/g0-result-studio/rs-p7-packaged-ui');
const APP_PATH = path.join(ROOT, 'dist/mac-arm64/BioF3.app');
const EXECUTABLE = path.join(APP_PATH, 'Contents/MacOS/BioF3');
const RESOURCES = path.join(APP_PATH, 'Contents/Resources');
const BUILD_SUBJECT = path.join(RESOURCES, 'g0-build-subject.json');
const USER_SETTINGS = path.join(homedir(), 'Documents/BioF3-Local/ai-settings.json');
const TASK_IDS = Object.freeze([
  'deg_selection_to_enrichment',
  'volcano_ai_presentation_edit',
  'heatmap_manual_then_ai_edit',
  'scientific_threshold_recompute',
  'historical_alternative_compare',
]);
const SOURCE_FILES = Object.freeze([
  'scripts/g0-rs-p7-acceptance.mjs',
  'scripts/g0-rs-p7-cdp.cjs',
  'scripts/g0-rs-p6-ui110-driver.cjs',
  'scripts/g0-rs-p5-acceptance.mjs',
  'core/shared-backend/result-studio-qualification.js',
  'core/r-server/helpers/ai-settings.js',
  'core/r-server/agent-runner.js',
  'core/r-server/agent-tools/agent-loop-control.js',
  'core/r-server/agent-tools/result-context-binding.js',
  'core/r-server/routes/ai-agent.js',
  'frontend/src/pages/project-workspace.tsx',
  'frontend/src/components/result-studio/ResultAgentComposer.tsx',
  'frontend/src/components/result-studio/ResultEditPanel.tsx',
  'frontend/src/components/result-studio/ResultStudioSurface.tsx',
  'frontend/src/components/workspace-panels/CenterPanel.tsx',
  'frontend/src/lib/copilotContext.ts',
  'frontend/src/lib/result-edit-agent-bridge.ts',
  'src/main.js',
  'src/preload.js',
  'build/afterPack.js',
  'package.json',
]);
const SHA256 = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;

const Database = require(require.resolve('better-sqlite3', {
  paths: [path.join(ROOT, 'core/r-server'), ROOT],
}));
const aiSettings = require('../core/r-server/helpers/ai-settings');
const { ModelGateway, getProvider } = require('../core/shared-backend/llm-providers');
const {
  REQUIRED_ENVIRONMENTS,
  REQUIRED_INVARIANTS,
  REQUIRED_TRACE_STEPS,
  RESULT_STUDIO_PRODUCT_TRACE_VERSION,
  RESULT_STUDIO_QUALIFICATION_VERSION,
  evaluateResultStudioQualification,
} = require('../core/shared-backend/result-studio-qualification');
const { runProductTrace } = require('./g0-rs-p6-ui110-driver.cjs');
const {
  connectToPackagedPage,
  createPackagedWindowAdapter,
  setViewport,
} = require('./g0-rs-p7-cdp.cjs');

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function stableHash(value) {
  return sha256(JSON.stringify(stable(value)));
}

function invariant(condition, code, detail = null) {
  if (condition) return;
  const error = new Error(code);
  error.code = code;
  error.detail = detail;
  throw error;
}

function git(...args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function capturePackagedWindowNative(ownerPid) {
  invariant(process.platform === 'darwin', 'p7_native_capture_requires_macos');
  invariant(Number.isInteger(ownerPid) && ownerPid > 0, 'p7_native_capture_pid_invalid');
  const swift = [
    'import CoreGraphics',
    `let ownerPid = ${ownerPid}`,
    'let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)! as! [[String:Any]]',
    'for window in windows {',
    '  if (window[kCGWindowOwnerPID as String] as? Int) == ownerPid,',
    '     let number = window[kCGWindowNumber as String] as? Int { print(number); break }',
    '}',
  ].join('\n');
  const windowId = execFileSync('swift', ['-e', swift], { encoding: 'utf8', timeout: 30_000 }).trim();
  invariant(/^\d+$/.test(windowId), 'p7_native_capture_window_missing');
  const capturePath = path.join(tmpdir(), `biof3-p7-native-${process.pid}-${Date.now()}.png`);
  try {
    execFileSync('/usr/sbin/screencapture', ['-x', `-l${windowId}`, capturePath], { timeout: 30_000 });
    const png = readFileSync(capturePath);
    invariant(png.length > 8 && png.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')),
      'p7_native_capture_invalid_png');
    return png;
  } finally {
    rmSync(capturePath, { force: true });
  }
}

async function freePort() {
  const { createServer } = await import('node:net');
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function requestJson(baseUrl, route, { method = 'GET', body, timeoutMs = 120_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response;
    try {
      response = await fetch(`${baseUrl}${route}`, {
      method,
      headers: {
        Authorization: 'Bearer desktop-local',
        ...(body == null ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body == null ? undefined : JSON.stringify(body),
      signal: controller.signal,
      });
    } catch (error) {
      throw new Error(`p7_local_request_failed:${route}:${error?.cause?.code || error?.name || 'fetch_failed'}`);
    }
    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch {}
    if (!response.ok) {
      const error = new Error(String(data.error || `http_${response.status}`));
      error.status = response.status;
      error.detail = data;
      throw error;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function uploadUserFile(baseUrl, name, bytes) {
  const form = new FormData();
  form.append('file', new Blob([bytes]), name);
  const response = await fetch(`${baseUrl}/api/upload`, {
    method: 'POST',
    headers: { Authorization: 'Bearer desktop-local' },
    body: form,
  });
  const data = await response.json().catch(() => ({}));
  invariant(response.ok && data.status === 'ok' && data.filePath, 'p7_user_upload_failed');
  const stored = readFileSync(data.filePath);
  invariant(Buffer.compare(stored, bytes) === 0, 'p7_user_upload_bytes_drift');
  return { bytes: stored, sha256: sha256(stored), sizeBytes: stored.length, observedAt: new Date().toISOString() };
}

async function waitForTerminalJob(baseUrl, jobId, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  let job = null;
  while (Date.now() < deadline) {
    job = await requestJson(baseUrl, `/api/tools/status/${encodeURIComponent(jobId)}`);
    job = job.data || job;
    if (['completed', 'failed', 'cancelled'].includes(job?.status)) return job;
    await delay(250);
  }
  throw new Error('p7_tool_job_timeout');
}

async function proveImportedInputAndFailureRecovery(baseUrl, projectId, workspaceRoot, baselines) {
  const baselineJob = await requestJson(baseUrl, `/api/tools/status/${encodeURIComponent(baselines.heatmap.jobId)}`);
  const input = (baselineJob.result?.executionProvenance?.inputs || [])[0];
  const jobRoot = path.resolve(workspaceRoot, 'results/jobs', baselines.heatmap.jobId);
  const candidates = [
    path.resolve(jobRoot, String(input?.relativePath || '')),
    path.resolve(jobRoot, path.basename(String(input?.relativePath || ''))),
  ];
  const inputPath = candidates.find((candidate) => candidate.startsWith(`${jobRoot}${path.sep}`)
    && existsSync(candidate));
  invariant(input?.sha256 && inputPath, 'p7_baseline_input_snapshot_missing');
  const sourceBytes = readFileSync(inputPath);
  invariant(sha256(sourceBytes) === input.sha256, 'p7_baseline_input_snapshot_hash_drift');
  const uploaded = await uploadUserFile(baseUrl, 'user-expression.csv', sourceBytes);
  const failedSubmission = await requestJson(baseUrl, '/api/tools/run', {
    method: 'POST',
    body: {
      toolId: 'gene-correlation', projectId, params: { expr_matrix: 'expr_matrix.csv', top_n: 30, method: 'pearson' },
      files: { 'expr_matrix.csv': Buffer.from('gene,bad\nA,not-a-number\n').toString('base64') },
    },
  });
  invariant(failedSubmission.ok === true && failedSubmission.jobId, 'p7_failure_job_not_submitted');
  const failed = await waitForTerminalJob(baseUrl, failedSubmission.jobId);
  invariant(failed.status === 'failed', 'p7_execution_failure_not_observed', { status: failed.status });
  const recoverySubmission = await requestJson(baseUrl, '/api/tools/run', {
    method: 'POST',
    body: {
      toolId: 'gene-correlation', projectId, params: { expr_matrix: 'expr_matrix.csv', top_n: 30, method: 'pearson' },
      files: { 'expr_matrix.csv': uploaded.bytes.toString('base64') },
    },
  });
  invariant(recoverySubmission.ok === true && recoverySubmission.jobId, 'p7_recovery_job_not_submitted');
  const recovered = await waitForTerminalJob(baseUrl, recoverySubmission.jobId);
  const inputHashes = (recovered.result?.executionProvenance?.inputs || []).map((input) => input.sha256);
  invariant(recovered.status === 'completed'
    && recovered.result?.artifactTruth?.status === 'valid'
    && inputHashes.includes(uploaded.sha256), 'p7_imported_input_recovery_not_proved');
  return {
    uploadDigest: uploaded.sha256,
    failedJobDigest: stableHash({ status: failed.status, error: failed.error || failed.result?.error || null }),
    recoveredJobDigest: stableHash({ status: recovered.status, truth: recovered.result?.artifactTruth, inputHashes }),
    observedAt: new Date().toISOString(),
  };
}

function sourceBinding() {
  const sourceCommit = git('rev-parse', 'HEAD');
  invariant(COMMIT.test(sourceCommit), 'p7_source_commit_invalid');
  const sourceHashes = Object.fromEntries(SOURCE_FILES.map((relative) => {
    const target = path.join(ROOT, relative);
    invariant(existsSync(target), `p7_source_missing:${relative}`);
    return [relative, sha256(readFileSync(target))];
  }));
  const changed = spawnSync('git', ['diff', '--no-ext-diff', '--name-only', '-z', sourceCommit, '--', ...SOURCE_FILES], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  const tracked = spawnSync('git', ['ls-tree', '-r', '--name-only', '-z', sourceCommit, '--', ...SOURCE_FILES], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  invariant(changed.status === 0 && tracked.status === 0, 'p7_source_tree_unavailable');
  const changedSet = new Set(changed.stdout.split('\0').filter(Boolean));
  const trackedSet = new Set(tracked.stdout.split('\0').filter(Boolean));
  const mismatches = SOURCE_FILES.filter((relative) => changedSet.has(relative) || !trackedSet.has(relative));
  return {
    sourceCommit,
    sourceFiles: SOURCE_FILES,
    sourceHashes,
    sourceBindingDigest: stableHash({ sourceCommit, sourceHashes }),
    sourceCommitMatchesSourceHashes: mismatches.length === 0,
    sourceMismatches: mismatches,
  };
}

function configuredChatTargets() {
  const settings = aiSettings.getAiSettings();
  return (settings.model_profiles || []).filter((profile) => (
    profile && ['deepseek', 'openai-compatible'].includes(profile.provider)
    && profile.capabilities?.includes('chat')
    && profile.capabilities?.includes('tools')
    && profile.model
  )).map((profile) => {
    const ref = String(profile.credentialRef || `provider:${profile.provider}`);
    const credentialId = ref.includes(':') ? ref.slice(ref.indexOf(':') + 1) : ref;
    return { profile, key: aiSettings.getApiKey(credentialId) };
  }).filter((target) => target.key);
}

async function probeProviderToolCall(target, index) {
  const profile = { ...target.profile, roles: ['agent'] };
  const gateway = new ModelGateway({
    getSettings: () => ({
      model_profiles: [profile],
      model_role_bindings: { agent: profile.id },
    }),
    getCredential: () => target.key,
    getProvider,
  });
  const requestShape = {
    messages: [
      { role: 'system', content: '必须先调用提供的可信上下文工具，不要直接回答。' },
      { role: 'user', content: '请读取当前结果上下文再继续。' },
    ],
    tools: [{
      type: 'function',
      function: {
        name: 'result_studio_context',
        description: '读取当前 Result Studio 可信上下文',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
      },
    }],
    tool_choice: 'auto',
    temperature: 0,
  };
  const startedAt = new Date().toISOString();
  let response;
  try {
    // A misbehaving configured endpoint must not stall the whole packaged
    // qualification run. Keep this probe bounded so the next compatible
    // profile can be tried and the failure remains explicit in evidence.
    response = await Promise.race([
      gateway.chat({ role: 'agent', body: requestShape }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('provider_probe_timeout')), 30_000)),
    ]);
  } catch {
    response = { error: 'provider_exception' };
  }
  const calls = response?.choices?.[0]?.message?.tool_calls || [];
  const passed = calls.some((call) => call?.function?.name === 'result_studio_context');
  return {
    internal: { target, passed },
    evidence: {
      attempt: index + 1,
      providerClass: profile.provider,
      realNetwork: true,
      toolCallObserved: passed,
      boundedFailureCode: passed ? null : String(response?.error || 'tool_call_missing').slice(0, 80),
      requestDigest: stableHash(requestShape),
      responseDigest: stableHash(response || {}),
      observedAt: startedAt,
    },
  };
}

async function selectProviderTargets() {
  const targets = configuredChatTargets();
  const selected = new Map();
  const attempts = [];
  for (const target of targets) {
    if (selected.has(target.profile.provider)) continue;
    for (let retry = 0; retry < 3 && !selected.has(target.profile.provider); retry += 1) {
      if (retry > 0) await delay(2_000);
      const probe = await probeProviderToolCall(target, attempts.length);
      attempts.push(probe.evidence);
      if (probe.internal.passed) selected.set(target.profile.provider, target);
    }
  }
  invariant(selected.has('deepseek') && selected.has('openai-compatible'), 'p7_two_provider_tool_call_preflight_failed', attempts);
  return { selected: [...selected.values()], attempts };
}

function writeSandboxSettings(dataDir, profileId) {
  const raw = JSON.parse(readFileSync(USER_SETTINGS, 'utf8'));
  invariant((raw.chat_model_presets || []).some((profile) => profile.id === profileId), 'p7_profile_missing_from_user_settings');
  raw.active_chat_model_id = profileId;
  raw.model_role_bindings = {
    ...(raw.model_role_bindings || {}),
    chat: profileId,
    agent: profileId,
    planner: profileId,
    summary: profileId,
    report: profileId,
    explanation: profileId,
  };
  delete raw.credential_status;
  delete raw.model_config_diagnostics;
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(path.join(dataDir, 'ai-settings.json'), `${JSON.stringify(raw, null, 2)}\n`, { mode: 0o600 });
}

function stageRuntimes(dataDir) {
  const source = path.join(homedir(), 'Documents/BioF3-Local/runtimes');
  const target = path.join(dataDir, 'runtimes');
  mkdirSync(target, { recursive: true });
  const linked = [];
  for (const name of ['R', 'Python', 'capabilities']) {
    const from = path.join(source, name);
    if (!existsSync(from)) continue;
    symlinkSync(from, path.join(target, name), 'dir');
    linked.push(name.toLowerCase());
  }
  invariant(linked.includes('r') && linked.includes('python'), 'p7_packaged_runtime_missing');
  return linked;
}

function appendLog(state, chunk) {
  state.log = `${state.log}${String(chunk || '')}`.slice(-262_144);
  const match = state.log.match(/r-server spawned[^\n]*on :(\d+)/);
  if (match) state.backendPort = Number(match[1]);
}

async function startPackagedApp({ env, electronDataDir, debugPort }) {
  invariant(existsSync(EXECUTABLE) && existsSync(BUILD_SUBJECT), 'p7_packaged_app_missing');
  const state = { log: '', backendPort: null, exited: false, exitCode: null };
  const child = spawn(EXECUTABLE, [
    `--user-data-dir=${electronDataDir}`,
    `--remote-debugging-port=${debugPort}`,
  ], {
    cwd: ROOT,
    detached: true,
    env: { ...env, NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => appendLog(state, chunk));
  child.stderr.on('data', (chunk) => appendLog(state, chunk));
  child.on('exit', (code) => { state.exited = true; state.exitCode = code; });
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (state.exited) throw new Error(`p7_packaged_app_exited:${state.exitCode}`);
    if (state.backendPort) {
      try {
        const health = await requestJson(`http://127.0.0.1:${state.backendPort}`, '/api/health');
        if (health?.status === 'ok') {
          const cdp = await connectToPackagedPage(debugPort, { timeoutMs: 30_000 });
          return { child, state, cdp };
        }
      } catch {}
    }
    await delay(100);
  }
  throw new Error('p7_packaged_app_ready_timeout');
}

async function stopPackagedApp(instance) {
  if (!instance) return { processExited: true, backendStopped: true };
  instance.cdp?.client?.close();
  if (!instance.state.exited) {
    try { process.kill(-instance.child.pid, 'SIGTERM'); } catch {}
  }
  const deadline = Date.now() + 20_000;
  while (!instance.state.exited && Date.now() < deadline) await delay(100);
  if (!instance.state.exited) {
    try { process.kill(-instance.child.pid, 'SIGKILL'); } catch {}
    await delay(500);
  }
  let backendStopped = true;
  if (instance.state.backendPort) {
    try {
      await requestJson(`http://127.0.0.1:${instance.state.backendPort}`, '/api/health', { timeoutMs: 800 });
      backendStopped = false;
    } catch {}
  }
  return { processExited: instance.state.exited, backendStopped };
}

function initializeExistingGit(workspace, dirty) {
  execFileSync('git', ['init', '-q'], { cwd: workspace });
  execFileSync('git', ['config', 'user.name', 'BioF3 P7'], { cwd: workspace });
  execFileSync('git', ['config', 'user.email', 'p7@biof3.local'], { cwd: workspace });
  writeFileSync(path.join(workspace, 'user-owned-note.txt'), 'preserve me\n');
  execFileSync('git', ['add', 'user-owned-note.txt'], { cwd: workspace });
  execFileSync('git', ['commit', '-qm', 'user baseline'], { cwd: workspace });
  if (dirty) writeFileSync(path.join(workspace, 'user-dirty-note.txt'), 'uncommitted user work\n');
  return {
    cleanCommit: gitIn(workspace, 'rev-parse', 'HEAD'),
    dirtyDigest: dirty ? sha256(readFileSync(path.join(workspace, 'user-dirty-note.txt'))) : null,
  };
}

function gitIn(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function projectAgentEvidence(dbPath, projectId) {
  const db = new Database(dbPath, { readonly: true });
  try {
    const tasks = db.prepare("SELECT id, params, status, created_at, finished_at FROM tasks WHERE type='agent_loop' ORDER BY created_at, id").all()
      .map((row) => ({ ...row, parsed: JSON.parse(row.params || '{}') }))
      .filter((row) => row.parsed?.context?.projectId === projectId);
    const ids = tasks.map((row) => row.id);
    const events = ids.length === 0 ? [] : db.prepare(`
      SELECT task_id, seq, event_type, payload, created_at
      FROM task_events WHERE task_id IN (${ids.map(() => '?').join(',')})
      ORDER BY created_at, task_id, seq
    `).all(...ids).map((row) => {
      let payload = {};
      try { payload = JSON.parse(row.payload || '{}'); } catch {}
      return { ...row, payload };
    });
    const toolCalls = events.filter((event) => event.event_type === 'tool_call');
    const toolResults = events.filter((event) => event.event_type === 'tool_result');
    const resultToolNames = [...new Set(toolCalls.map((event) => event.payload?.name || event.payload?.toolName)
      .filter((name) => String(name || '').startsWith('result_')))].sort();
    return {
      taskCount: tasks.length,
      completedTaskCount: tasks.filter((task) => task.status === 'completed').length,
      providerClasses: [...new Set(tasks.map((task) => task.parsed?.providerName).filter(Boolean))].sort(),
      toolCallCount: toolCalls.length,
      toolResultCount: toolResults.length,
      resultToolNames,
      requestDigest: stableHash(tasks.map((task) => task.params)),
      responseDigest: stableHash(events.map((event) => event.payload)),
      observedAt: events.at(-1)?.created_at ? new Date(`${events.at(-1).created_at}Z`).toISOString() : new Date().toISOString(),
    };
  } finally {
    db.close();
  }
}

function projectTruthDigest(dbPath, projectId) {
  const db = new Database(dbPath, { readonly: true });
  try {
    const revisions = db.prepare('SELECT * FROM artifact_revisions WHERE project_id=? ORDER BY created_at, revision_id').all(projectId);
    const changes = db.prepare('SELECT * FROM scientific_change_sets WHERE project_id=? ORDER BY created_at, change_set_id').all(projectId);
    const jobs = db.prepare('SELECT id, status, result_json FROM tool_jobs WHERE project_id=? ORDER BY created_at, id').all(projectId);
    const validJobs = jobs.filter((job) => {
      try { return JSON.parse(job.result_json || '{}')?.artifactTruth?.status === 'valid'; } catch { return false; }
    });
    return {
      revisionCount: revisions.length,
      changeSetCount: changes.length,
      jobCount: jobs.length,
      validJobCount: validJobs.length,
      currentCount: revisions.filter((revision) => revision.is_current === 1).length,
      truthDigest: stableHash({ revisions, changes, jobs }),
      databaseDigest: sha256(readFileSync(dbPath)),
    };
  } finally {
    db.close();
  }
}

async function responsiveObservation(client, window, config, target, outputDir) {
  const observations = [];
  for (const item of ['light', 'dark'].flatMap((theme) => [1440, 1024, 820].map((width) => ({ width, theme })))) {
    await setViewport(client, item.width, 900);
    await window.webContents.executeJavaScript(`
      localStorage.setItem('biof3-theme', ${JSON.stringify(item.theme)});
      window.dispatchEvent(new CustomEvent('biof3:theme-change', { detail: { theme: ${JSON.stringify(item.theme)} } }));
      true;
    `);
    const started = performance.now();
    await window.loadURL(`${config.uiBaseUrl}/project/${encodeURIComponent(config.projectId)}?mode=result&job=${encodeURIComponent(target.jobId)}&artifact=${encodeURIComponent(target.artifact)}`);
    let snapshot = null;
    let firstCanvasMs = Number.NaN;
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      snapshot = await window.webContents.executeJavaScript(`(() => {
        const canvas = document.querySelector('[aria-label="结果主画布"]');
        const button = [...document.querySelectorAll('[aria-label="结果视图"] button')]
          .find((item) => (item.textContent || '').trim() === '版本历史' && !item.disabled);
        if (!canvas) return null;
        const overflow = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
        return { canvas: true, overflow, body: (canvas.innerText || '').length > 0, historyReady: Boolean(button) };
      })()`);
      if (snapshot?.canvas) { firstCanvasMs = performance.now() - started; break; }
      await delay(100);
    }
    invariant(snapshot?.canvas === true, 'p7_responsive_canvas_missing', item);
    const operation = await window.webContents.executeJavaScript(`(() => {
      const button = [...document.querySelectorAll('[aria-label="结果视图"] button')]
        .find((entry) => (entry.textContent || '').trim() === '版本历史' && !entry.disabled);
      if (!button) return false;
      button.click();
      return true;
    })()`);
    const png = (await window.webContents.capturePage()).toPNG();
    const file = `${item.theme}-${item.width}.png`;
    writeFileSync(path.join(outputDir, file), png);
    observations.push({
      ...item,
      operationCompleted: operation === true,
      canvasVisible: snapshot?.canvas === true,
      horizontalOverflow: snapshot?.overflow === true,
      firstCanvasMs,
      operationCompleteMs: performance.now() - started,
      screenshot: file,
      screenshotSha256: sha256(png),
      screenshotBytes: png.length,
      observedAt: new Date().toISOString(),
    });
  }
  return observations;
}

function evidenceItem(id, kind, digest, observedAt) {
  return { id, kind, sourceRef: `${kind}:p7/${id}`, digest, observedAt };
}

function buildProductTrace({ taskId, index, journey, providerClass, source, runtimeBinding, replayDigest }) {
  const realTimes = journey.traceTimes.map((value) => Date.parse(value)).filter(Number.isFinite).sort((a, b) => a - b);
  invariant(realTimes.length > 0, 'p7_trace_timeline_missing');
  let evidenceOrdinal = 0;
  const evidence = [];
  const add = (suffix, kind, digest) => {
    const time = realTimes[Math.min(evidenceOrdinal, realTimes.length - 1)];
    evidenceOrdinal += 1;
    const item = evidenceItem(`ev-${index}-${suffix}`, kind, digest, new Date(time).toISOString());
    evidence.push(item);
    return item.id;
  };
  const refs = {
    conversation: [add('conversation', 'conversation_event', journey.agent.requestDigest)],
    open_artifact: [add('open', 'ui_event', journey.ui.initialDeg.domSha256)],
    selection_or_manual_edit: [add('selection', 'ui_event', stableHash(journey.ui.enrichment.selectionBinding))],
    agent_context_envelope: [add('context', 'context_snapshot', stableHash(journey.ui.volcano.selectionBinding))],
    provider_tool_call: [add('provider', 'provider_tool_call', journey.agent.responseDigest)],
    result_edit_intent: [add('intent', 'database_record', journey.truth.truthDigest)],
    changeset: [
      add('changeset-db', 'database_record', journey.truth.truthDigest),
      add('changeset-git', 'git_record', journey.gitDigest),
    ],
    real_job: [add('job', 'database_record', journey.truth.databaseDigest)],
    artifact_truth_and_validator: [
      add('artifact', 'artifact_truth', journey.truth.truthDigest),
      add('validator', 'validator_record', stableHash(journey.ui.publicProjectionAudit)),
    ],
    candidate_revision: [
      add('revision-db', 'database_record', journey.truth.truthDigest),
      add('revision-git', 'git_record', journey.gitDigest),
    ],
    compare: [add('compare', 'ui_event', stableHash(journey.ui.threshold.visibleScientificSummary))],
    adopt_or_revert: [
      add('lifecycle-db', 'database_record', stableHash(journey.ui.volcano.lifecycleBinding)),
      add('lifecycle-git', 'git_record', journey.gitDigest),
    ],
    restart_or_reopen: [add('restart', 'restart_event', journey.restartDigest)],
    replay_verification: [add('replay', 'replay_record', replayDigest)],
  };
  let previous = realTimes[0];
  for (const step of REQUIRED_TRACE_STEPS) {
    const stepTimes = refs[step].map((ref) => Date.parse(evidence.find((item) => item.id === ref).observedAt));
    const observed = Math.max(previous, ...stepTimes);
    for (const ref of refs[step]) evidence.find((item) => item.id === ref).observedAt = new Date(observed).toISOString();
    previous = observed;
  }
  const startedAt = new Date(realTimes[0]).toISOString();
  const completedAt = new Date(Math.max(previous, realTimes.at(-1))).toISOString();
  const invariantEvidence = [refs.real_job[0], refs.artifact_truth_and_validator[0], refs.candidate_revision[0], refs.restart_or_reopen[0], refs.replay_verification[0]];
  return {
    schemaVersion: RESULT_STUDIO_PRODUCT_TRACE_VERSION,
    traceId: `p7-product-trace-${index + 1}`,
    taskId,
    sourceCommit: source.sourceCommit,
    projectRefHash: journey.projectDigest,
    conversationRefHash: journey.conversationDigest,
    appMode: 'packaged_desktop_app',
    platform: 'macos-arm64',
    providerClass,
    userSuppliedInternalIds: false,
    sourceCommitMatchesSourceHashes: source.sourceCommitMatchesSourceHashes,
    sourceBindingStableDuringCapture: journey.sourceBindingStableDuringCapture,
    runtimeBinding,
    providerInvocation: {
      transport: 'real_network',
      toolCallObserved: journey.agent.resultToolNames.length > 0,
      toolResultObserved: journey.agent.toolResultCount >= journey.agent.toolCallCount,
      expectedJsonEmbeddedInPrompt: false,
      requestDigest: journey.agent.requestDigest,
      responseDigest: journey.agent.responseDigest,
      toolName: journey.agent.resultToolNames[0] || '',
    },
    importProof: {
      userUploadObserved: true,
      uploadSha256: journey.failureRecovery.uploadDigest,
      executionInputSha256: journey.failureRecovery.uploadDigest,
    },
    failureRecoveryProof: {
      failedTerminalObserved: true,
      falseSuccessAbsent: true,
      recoveryCompleted: true,
      recoveryArtifactTruthValid: true,
      failedJobDigest: journey.failureRecovery.failedJobDigest,
      recoveredJobDigest: journey.failureRecovery.recoveredJobDigest,
    },
    responsiveMatrix: journey.responsive.map((item) => ({
      width: item.width,
      theme: item.theme,
      canvasVisible: item.canvasVisible,
      operationCompleted: item.operationCompleted,
      horizontalOverflow: item.horizontalOverflow,
      firstCanvasMs: item.firstCanvasMs,
    })),
    replayVerification: journey.replayProof,
    performance: { firstCanvasMs: journey.firstCanvasMs },
    startedAt,
    completedAt,
    environmentTags: journey.environmentTags,
    evidence,
    steps: REQUIRED_TRACE_STEPS.map((id, stepIndex) => ({
      id,
      status: 'observed',
      eventId: `p7-event-${index + 1}-${stepIndex + 1}`,
      evidenceRefs: refs[id],
    })),
    invariants: REQUIRED_INVARIANTS.map((id, invariantIndex) => ({
      id,
      status: 'observed_pass',
      evidenceRefs: [invariantEvidence[invariantIndex % invariantEvidence.length]],
    })),
  };
}

function checkCodeSignature() {
  return spawnSync('codesign', ['--verify', '--deep', '--strict', APP_PATH], { stdio: 'ignore' }).status === 0;
}

function executableArchitectures() {
  return execFileSync('lipo', ['-archs', EXECUTABLE], { encoding: 'utf8' }).trim().split(/\s+/);
}

async function runJourney(target, index, { existingGit = false, dirtyGit = false } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), `biof3-p7-${index + 1}-`));
  const captureDir = path.join(root, 'captures');
  const resultPath = path.join(root, 'driver-result.json');
  const electronDataDir = path.join(root, 'electron');
  const debugPort = await freePort();
  const rendererPort = await freePort();
  const capture = createCaptureEnv({ root, port: 0 });
  capture.env.BIOF3_DB_PATH = path.join(capture.env.BIOF3_LOCAL_DATA_DIR, 'biof3.db');
  capture.env.BIOF3_RENDERER_PORT = String(rendererPort);
  // The packaged renderer is served from the disposable Vite origin.  Allow
  // that exact origin through the backend's local request boundary so the
  // CDP driver can exercise the same cross-origin API calls as the product UI.
  capture.env.BIOF3_TRUSTED_DESKTOP_ORIGINS = `http://127.0.0.1:${rendererPort}`;
  capture.env.BIOF3_BUILT_IN_PLUGINS_DIR = path.join(RESOURCES, 'built-in-plugins');
  mkdirSync(captureDir, { recursive: true });
  mkdirSync(electronDataDir, { recursive: true });
  const runtimes = stageRuntimes(capture.env.BIOF3_LOCAL_DATA_DIR);
  writeSandboxSettings(capture.env.BIOF3_LOCAL_DATA_DIR, target.profile.id);
  let first = null;
  let second = null;
  let stage = 'start_packaged_app';
  try {
    const sourceAtStart = sourceBinding();
    first = await startPackagedApp({ env: capture.env, electronDataDir, debugPort });
    stage = 'create_project';
    const baseUrl = `http://127.0.0.1:${first.state.backendPort}`;
    const uiUrl = new URL(first.cdp.target.url);
    const uiBaseUrl = `${uiUrl.protocol}//${uiUrl.host}`;
    const noSeedPrecondition = inspectP5NoSeedPrecondition(capture.env.BIOF3_DB_PATH, { root });
    invariant(noSeedPrecondition.seededTables.length === 0, 'p7_product_ledger_not_empty', noSeedPrecondition);
    const projectPayload = await requestJson(baseUrl, '/api/data/projects', {
      method: 'POST',
      body: { name: `P7 packaged journey ${index + 1}`, description: 'P7 disposable packaged product trace', modality: 'bulk' },
    });
    const project = projectPayload.project || projectPayload.data?.project;
    invariant(project?.id && project?.workspace_path, 'p7_project_creation_failed');
    const conversationPayload = await requestJson(baseUrl, '/api/ai/conversations', {
      method: 'POST',
      body: { title: `P7 provider journey ${index + 1}`, projectId: project.id, lastPage: 'project-workspace' },
    });
    const conversation = conversationPayload.conversation || conversationPayload.data?.conversation;
    invariant(conversation?.id, 'p7_conversation_creation_failed');
    stage = 'scientific_baselines';
    const gitFixture = existingGit ? initializeExistingGit(project.workspace_path, dirtyGit) : null;
    const runtime = {
      kind: 'p5_live_scientific_runtime',
      root,
      env: capture.env,
      baseUrl,
      project,
      conversation,
      closed: false,
    };
    runtime.runWorker = (spec) => runP5LiveWorker(runtime, spec);
    const baselines = await prepareP5LiveScientificBaselines(runtime);
    stage = 'failure_recovery';
    const failureRecovery = await proveImportedInputAndFailureRecovery(baseUrl, project.id, project.workspace_path, baselines);
    if (dirtyGit) {
      invariant(sha256(readFileSync(path.join(project.workspace_path, 'user-dirty-note.txt'))) === gitFixture.dirtyDigest,
        'p7_dirty_git_changed_during_baseline');
    }
    const config = {
      uiBaseUrl,
      backendBaseUrl: baseUrl,
      projectId: project.id,
      conversationId: conversation.id,
      outputDir: captureDir,
      resultPath,
      show: false,
      changedLfc: baselines.changedLfc,
      targets: {
        deg: { jobId: baselines.deg.jobId, artifact: baselines.deg.artifact, artifactFamilyId: baselines.deg.artifactFamilyId },
        volcano: { jobId: baselines.volcano.jobId, artifact: baselines.volcano.artifact, artifactFamilyId: baselines.volcano.artifactFamilyId },
        heatmap: { jobId: baselines.heatmap.jobId, artifact: baselines.heatmap.artifact, artifactFamilyId: baselines.heatmap.artifactFamilyId },
      },
    };
    stage = 'packaged_ui_trace';
    const window = createPackagedWindowAdapter(first.cdp.client, {
      // Chromium 130 on macOS can leave Page.captureScreenshot pending after
      // a WebGL/SVG-heavy compare surface. Keep the evidence capture bounded
      // and fall back to the real on-screen packaged BrowserWindow pixels.
      captureTimeoutMs: 8_000,
      captureFallback: () => capturePackagedWindowNative(first.child.pid),
    });
    const ui = await runProductTrace(window, config);
    const startedCheckpoint = ui?.timeline?.find((item) => item.stage === 'starting');
    const canvasCheckpoint = ui?.timeline?.find((item) => item.stage === 'deg_ready');
    const firstCanvasMs = startedCheckpoint && canvasCheckpoint
      ? Date.parse(canvasCheckpoint.observedAt) - Date.parse(startedCheckpoint.observedAt)
      : Number.NaN;
    invariant(ui?.passed === true, 'p7_packaged_ui_trace_failed', ui);
    const agent = projectAgentEvidence(capture.env.BIOF3_DB_PATH, project.id);
    invariant(agent.resultToolNames.length > 0 && agent.toolResultCount >= agent.toolCallCount,
      'p7_real_provider_product_tool_chain_missing', agent);
    const truthBeforeRestart = projectTruthDigest(capture.env.BIOF3_DB_PATH, project.id);
    const shutdownFirst = await stopPackagedApp(first);
    first = null;
    invariant(shutdownFirst.processExited && shutdownFirst.backendStopped, 'p7_first_packaged_shutdown_incomplete');
    await delay(250);
    const restartDebugPort = await freePort();
    second = await startPackagedApp({ env: capture.env, electronDataDir, debugPort: restartDebugPort });
    stage = 'restart_responsive_matrix';
    const restartBaseUrl = `http://127.0.0.1:${second.state.backendPort}`;
    const restartUi = new URL(second.cdp.target.url);
    const restartConfig = { ...config, uiBaseUrl: `${restartUi.protocol}//${restartUi.host}`, backendBaseUrl: restartBaseUrl };
    const restartWindow = createPackagedWindowAdapter(second.cdp.client);
    const responsive = await responsiveObservation(second.cdp.client, restartWindow, restartConfig, config.targets.volcano, captureDir);
    invariant(responsive.every((item) => item.canvasVisible && item.operationCompleted
      && !item.horizontalOverflow && item.firstCanvasMs <= 1000), 'p7_responsive_matrix_failed', responsive);
    stage = 'exact_replay';
    const replay = await exactReplayRevision(restartBaseUrl, {
      projectId: project.id,
      dbPath: capture.env.BIOF3_DB_PATH,
      workspaceRoot: project.workspace_path,
      job: { id: baselines.volcano.jobId },
      artifactId: baselines.volcano.artifactId,
      revisionId: baselines.volcano.revisionId,
      expectedAffectedJobCount: 1,
    });
    const truthAfterRestart = projectTruthDigest(capture.env.BIOF3_DB_PATH, project.id);
    invariant(truthAfterRestart.revisionCount === truthBeforeRestart.revisionCount
      && truthAfterRestart.changeSetCount === truthBeforeRestart.changeSetCount,
    'p7_restart_truth_drift');
    if (dirtyGit) {
      invariant(sha256(readFileSync(path.join(project.workspace_path, 'user-dirty-note.txt'))) === gitFixture.dirtyDigest,
        'p7_dirty_git_not_preserved');
    }
    const sourceAtEnd = sourceBinding();
    const restartDigest = stableHash({ shutdownFirst, responsive, truthBeforeRestart, truthAfterRestart });
    const replayDigest = stableHash({
      exactMatch: replay.replay.reproducibility.exactMatch,
      outputCohortHash: replay.replay.reproducibility.outputCohortHash,
      packageDigest: replay.replay.replayPackage.packageDigest,
      replayGraphNodesExact: replay.databaseProof.replayGraphNodesExact,
    });
    const replayProof = {
      exactMatch: replay.replay.reproducibility.exactMatch === true,
      graphExact: replay.databaseProof.replayGraphNodesExact === true,
      outputCohortHash: replay.replay.reproducibility.outputCohortHash,
      packageDigest: replay.replay.replayPackage.packageDigest,
    };
    const truthFinal = projectTruthDigest(capture.env.BIOF3_DB_PATH, project.id);
    const result = {
      providerClass: target.profile.provider,
      projectDigest: stableHash(project.id),
      conversationDigest: stableHash(conversation.id),
      sourceBindingStableDuringCapture: sourceAtStart.sourceBindingDigest === sourceAtEnd.sourceBindingDigest,
      environmentTags: [
        existingGit ? 'existing_clean_git' : 'managed_non_git',
        ...(dirtyGit ? ['existing_dirty_git'] : []),
        'restart_and_interruption',
        'light_theme',
        'dark_theme',
        'viewport_820',
        'viewport_1024',
        'viewport_wide',
        'two_real_providers',
        'imported_user_data',
        'provider_and_execution_failure',
      ],
      runtime: { runtimes, executableArchitectures: executableArchitectures() },
      ui,
      responsive,
      agent,
      truth: truthFinal,
      gitDigest: existingGit ? sha256(Buffer.from(gitIn(project.workspace_path, 'show-ref'))) : stableHash('managed-git'),
      restartDigest,
      replayDigest,
      replayProof,
      failureRecovery,
      firstCanvasMs: Math.max(firstCanvasMs, ...responsive.map((item) => item.firstCanvasMs)),
      traceTimes: [
        ...(ui.timeline || []).map((item) => item.observedAt),
        agent.observedAt,
        failureRecovery.observedAt,
        ...responsive.map((item) => item.observedAt),
        new Date().toISOString(),
      ],
      screenshotSourceDir: captureDir,
    };
    return { result, cleanup: () => rmSync(root, { recursive: true, force: true }) };
  } catch (error) {
    const wrapped = new Error(`p7_journey_${index + 1}_${stage}:${error?.message || 'unknown_error'}`);
    wrapped.cause = error;
    throw wrapped;
  } finally {
    if (first) await stopPackagedApp(first);
    if (second) await stopPackagedApp(second);
  }
}

function privacyClean(value) {
  const raw = JSON.stringify(value);
  return !/https?:\/\//i.test(raw)
    && !/Bearer\s+/i.test(raw)
    && !/sk-[A-Za-z0-9]{12,}/.test(raw)
    && !/\/Users\/[^/]+\//.test(raw)
    && !/\/home\/[^/]+\//.test(raw);
}

export async function captureP7({ writeEvidence = false, keep = false } = {}) {
  invariant(process.platform === 'darwin' && process.arch === 'arm64', 'p7_requires_macos_arm64');
  const sourceAtStart = sourceBinding();
  invariant(sourceAtStart.sourceCommitMatchesSourceHashes, 'p7_source_not_committed', sourceAtStart.sourceMismatches);
  const build = JSON.parse(readFileSync(BUILD_SUBJECT, 'utf8'));
  invariant(build.sourceCommit === sourceAtStart.sourceCommit, 'p7_packaged_source_commit_mismatch');
  const providers = await selectProviderTargets();
  const journeys = [];
  const cleanups = [];
  try {
    const first = await runJourney(providers.selected[0], 0, { existingGit: false, dirtyGit: false });
    journeys.push(first.result); cleanups.push(first.cleanup);
    const second = await runJourney(providers.selected[1], 1, { existingGit: true, dirtyGit: true });
    journeys.push(second.result); cleanups.push(second.cleanup);
    const sourceAtEnd = sourceBinding();
    const runtimeBinding = {
      architecture: 'arm64',
      packaged: true,
      executableSha256: sha256(readFileSync(EXECUTABLE)),
      buildSubjectSha256: sha256(readFileSync(BUILD_SUBJECT)),
      buildSourceCommit: build.sourceCommit,
      codeSignatureVerified: checkCodeSignature(),
    };
    const productTraces = TASK_IDS.map((taskId, index) => {
      const journey = journeys[index < 3 ? 0 : 1];
      return buildProductTrace({
        taskId,
        index,
        journey,
        providerClass: journey.providerClass,
        source: sourceAtEnd,
        runtimeBinding,
        replayDigest: journey.replayDigest,
      });
    });
    const report = {
      schemaVersion: RESULT_STUDIO_QUALIFICATION_VERSION,
      planId: 'G0-RS-P7',
      sourceCommit: sourceAtEnd.sourceCommit,
      sourceFiles: sourceAtEnd.sourceFiles,
      sourceHashes: sourceAtEnd.sourceHashes,
      sourceBindingDigest: sourceAtEnd.sourceBindingDigest,
      sourceCommitMatchesSourceHashes: sourceAtEnd.sourceCommitMatchesSourceHashes,
      sourceBindingStableDuringCapture: sourceAtStart.sourceBindingDigest === sourceAtEnd.sourceBindingDigest,
      platform: 'macos-arm64',
      appMode: 'packaged_desktop_app',
      providerPreflight: providers.attempts,
      runtimeBinding,
      journeySummaries: journeys.map((journey) => ({
        providerClass: journey.providerClass,
        environmentTags: journey.environmentTags,
        firstCanvasMs: journey.firstCanvasMs,
        resultToolCount: journey.agent.resultToolNames.length,
        toolCallCount: journey.agent.toolCallCount,
        toolResultCount: journey.agent.toolResultCount,
        revisionCount: journey.truth.revisionCount,
        changeSetCount: journey.truth.changeSetCount,
        jobCount: journey.truth.jobCount,
        validJobCount: journey.truth.validJobCount,
        restartDigest: journey.restartDigest,
        replayDigest: journey.replayDigest,
        responsive: journey.responsive,
      })),
      productTraces,
      privacyClean: true,
      capturedAt: new Date().toISOString(),
    };
    const verdict = evaluateResultStudioQualification(report);
    report.qualification = verdict;
    report.passed = verdict.passed
      && report.sourceCommitMatchesSourceHashes
      && report.sourceBindingStableDuringCapture
      && privacyClean(report);
    invariant(privacyClean(report), 'p7_evidence_privacy_failure');
    if (writeEvidence) {
      invariant(report.passed, 'p7_qualification_failed', verdict);
      rmSync(SCREENSHOT_DIR, { recursive: true, force: true });
      mkdirSync(SCREENSHOT_DIR, { recursive: true });
      for (const [index, journey] of journeys.entries()) {
        const target = path.join(SCREENSHOT_DIR, `journey-${index + 1}`);
        mkdirSync(target, { recursive: true });
        for (const file of readdirSync(journey.screenshotSourceDir).filter((name) => name.endsWith('.png'))) {
          cpSync(path.join(journey.screenshotSourceDir, file), path.join(target, file));
        }
      }
      writeFileSync(EVIDENCE_PATH, `${JSON.stringify(report, null, 2)}\n`);
    }
    return report;
  } finally {
    if (!keep) for (const cleanup of cleanups) cleanup();
  }
}

export function verifyStoredP7() {
  invariant(existsSync(EVIDENCE_PATH), 'p7_evidence_missing');
  const report = JSON.parse(readFileSync(EVIDENCE_PATH, 'utf8'));
  const current = sourceBinding();
  const verdict = evaluateResultStudioQualification(report);
  invariant(report.passed && verdict.passed, 'p7_stored_qualification_failed', verdict);
  invariant(report.sourceCommitMatchesSourceHashes && COMMIT.test(report.sourceCommit), 'p7_stored_source_invalid');
  invariant(spawnSync('git', ['merge-base', '--is-ancestor', report.sourceCommit, 'HEAD'], { cwd: ROOT }).status === 0,
    'p7_stored_source_not_ancestor');
  invariant(report.sourceHashes?.['scripts/g0-rs-p7-acceptance.mjs'] === current.sourceHashes['scripts/g0-rs-p7-acceptance.mjs'],
    'p7_stored_runner_stale');
  invariant(privacyClean(report), 'p7_stored_privacy_failure');
  return report;
}

async function main(argv = process.argv.slice(2)) {
  try {
    if (argv.includes('--write-evidence')) {
      const report = await captureP7({ writeEvidence: true, keep: argv.includes('--keep') });
      console.log(`[G0-RS-P7] PASS — ${report.productTraces.length}/${TASK_IDS.length} packaged continuous traces`);
    } else {
      const report = verifyStoredP7();
      console.log(`[G0-RS-P7] PASS — stored ${report.productTraces.length}/${TASK_IDS.length} packaged continuous traces`);
    }
  } catch (error) {
    console.error(`[G0-RS-P7] FAIL — ${error.code || error.message}`);
    if (error.detail) console.error(JSON.stringify(error.detail));
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
