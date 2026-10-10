#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = join(root, 'acceptance/g0-qualification/packaged-app.json');
const require = createRequire(import.meta.url);
const qualification = require('../core/shared-backend/g0-baseline-qualification');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const delay = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));

function sha256File(file) {
  return sha256(readFileSync(file));
}

function isAncestor(commit) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', commit, 'HEAD'], {
      cwd: root,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

function walkFiles(dir, files = []) {
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const target = join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(target, files);
    else if (entry.isFile()) files.push(target);
  }
  return files;
}

export function collectArtifactCounts(dataDir, reportDirs = []) {
  const files = [
    ...walkFiles(dataDir),
    ...reportDirs.flatMap((dir) => walkFiles(dir)),
  ];
  const count = (name) => files.filter((file) => basename(file) === name).length;
  const manifests = files.filter((file) => basename(file) === 'artifact-manifest.json');
  return {
    artifactManifests: manifests.length,
    params: count('params.json'),
    provenance: count('provenance.json'),
    independentScripts: files.filter((file) => /^run-script\.(R|py)$/.test(basename(file))).length,
    deliveryManifests: count('delivery-manifest.json'),
    replayPackageManifests: count('package-manifest.json'),
    htmlReports: files.filter((file) => file.endsWith('.html')).length,
    artifactManifestSetSha256: sha256(
      manifests.map((file) => sha256File(file)).sort().join('\n'),
    ),
  };
}

function createRuntimeLinks(dataDir) {
  const sourceRoot = process.env.PETRI_QUALIFICATION_RUNTIME_ROOT
    || join(homedir(), 'Documents', 'Petri-Local', 'runtimes');
  const targetRoot = join(dataDir, 'runtimes');
  mkdirSync(targetRoot, { recursive: true });
  const linked = { r: false, python: false, capabilities: false };
  for (const [name, key] of [['R', 'r'], ['Python', 'python'], ['capabilities', 'capabilities']]) {
    const source = join(sourceRoot, name);
    if (!existsSync(source)) continue;
    symlinkSync(source, join(targetRoot, name), 'dir');
    linked[key] = true;
  }
  if (!linked.r || !linked.python) throw new Error('qualification_runtime_missing');
  return linked;
}

function appPaths(appPath) {
  const contents = join(appPath, 'Contents');
  return {
    appPath,
    executable: join(contents, 'MacOS', 'Petri'),
    infoPlist: join(contents, 'Info.plist'),
    resources: join(contents, 'Resources'),
    buildSubject: join(contents, 'Resources', 'g0-build-subject.json'),
  };
}

function resolveAppPath() {
  return resolve(
    process.env.G0_QUALIFICATION_APP_PATH
      || join(root, 'dist', 'mac-arm64', 'Petri.app'),
  );
}

function checkCodeSignature(appPath) {
  try {
    execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function executableArchitectures(executable) {
  return execFileSync('lipo', ['-archs', executable], { encoding: 'utf8' })
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

async function fetchJson(port, pathname, timeoutMs = 2500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
      headers: { Authorization: 'Bearer desktop-local' },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function appendBounded(state, chunk) {
  state.log = `${state.log}${String(chunk)}`.slice(-262144);
  const match = state.log.match(/petri-server spawned[^\n]*on :(\d+)/);
  if (match) state.port = Number(match[1]);
}

async function startPackagedApp(paths, sandbox) {
  const state = { log: '', port: null, exited: false, exitCode: null };
  const child = spawn(paths.executable, [`--user-data-dir=${sandbox.electronDataDir}`], {
    cwd: root,
    detached: true,
    env: {
      ...process.env,
      PETRI_LOCAL_DATA_DIR: sandbox.dataDir,
      NODE_ENV: 'production',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => appendBounded(state, chunk));
  child.stderr.on('data', (chunk) => appendBounded(state, chunk));
  child.on('exit', (code) => {
    state.exited = true;
    state.exitCode = code;
  });
  const startedAt = Date.now();
  while (Date.now() - startedAt < 120000) {
    if (state.exited) throw new Error(`packaged_app_exited_before_ready:${state.exitCode}`);
    if (state.port) {
      const health = await fetchJson(state.port, '/api/health');
      if (health?.status === 'ok') return { child, state };
    }
    await delay(250);
  }
  throw new Error('packaged_app_health_timeout');
}

async function stopPackagedApp(instance) {
  const { child, state } = instance;
  if (!state.exited) {
    try { process.kill(-child.pid, 'SIGTERM'); } catch {}
  }
  const startedAt = Date.now();
  while (!state.exited && Date.now() - startedAt < 20000) await delay(100);
  if (!state.exited) {
    try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    await delay(500);
  }
  const healthAfterStop = state.port ? await fetchJson(state.port, '/api/health', 800) : null;
  return { exited: state.exited, backendStopped: healthAfterStop === null };
}

function processTreePids(rootPid) {
  const result = new Set([rootPid]);
  const pending = [rootPid];
  while (pending.length > 0) {
    const parent = pending.shift();
    let children = [];
    try {
      children = execFileSync('pgrep', ['-P', String(parent)], { encoding: 'utf8' })
        .trim().split(/\s+/).filter(Boolean).map(Number);
    } catch {}
    for (const child of children) {
      if (result.has(child)) continue;
      result.add(child);
      pending.push(child);
    }
  }
  return [...result];
}

function treeRssBytes(pid) {
  let totalKb = 0;
  for (const item of processTreePids(pid)) {
    try {
      const value = Number(execFileSync('ps', ['-o', 'rss=', '-p', String(item)], { encoding: 'utf8' }).trim());
      if (Number.isFinite(value)) totalKb += value;
    } catch {}
  }
  return totalKb * 1024;
}

async function runGoldenPath(port, reportDir, demoInputDir) {
  mkdirSync(reportDir, { recursive: true });
  return await new Promise((resolveRun, rejectRun) => {
    let stderr = '';
    const child = spawn(process.execPath, [
      join(root, 'scripts/golden-path.mjs'),
      '--skip-install',
      '--report-out', reportDir,
      '--demo-input', demoInputDir,
      '--timeout-ms', '600000',
    ], {
      cwd: root,
      env: { ...process.env, R_BASE: `http://127.0.0.1:${port}` },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-8192); });
    child.on('error', () => rejectRun(new Error('packaged_task_spawn_failed')));
    child.on('exit', (code) => {
      if (code === 0) resolveRun();
      else rejectRun(new Error(`packaged_task_failed:${code}:${sha256(stderr)}`));
    });
  });
}

async function projectCount(port) {
  const payload = await fetchJson(port, '/api/data/projects', 5000);
  const projects = Array.isArray(payload?.projects)
    ? payload.projects
    : Array.isArray(payload?.data)
      ? payload.data
      : [];
  return projects.length;
}

function privacyClean(value) {
  const serialized = JSON.stringify(value);
  return !/https?:\/\//i.test(serialized)
    && !/Bearer\s+/i.test(serialized)
    && !/sk-[A-Za-z0-9]{12,}/.test(serialized)
    && !/\/Users\/[^/]+\//.test(serialized)
    && !/\/home\/[^/]+\//.test(serialized);
}

export function evaluatePackagedReport(report, {
  minimumTaskCycles = 1,
  minimumObservationMs = 0,
  minimumHealthSamples = 1,
} = {}) {
  const checks = {
    buildBinding: /^[a-f0-9]{40}$/.test(String(report.sourceCommit || ''))
      && /^[a-f0-9]{64}$/.test(String(report.baseline?.bundleDigest || '')),
    architecture: report.architecture === 'arm64' && report.executableArchitectures?.includes('arm64'),
    bundleIntegrity: /^[a-f0-9]{64}$/.test(String(report.executableSha256 || ''))
      && /^[a-f0-9]{64}$/.test(String(report.resourceBundleSha256 || ''))
      && /^[a-f0-9]{64}$/.test(String(report.buildSubjectSha256 || '')),
    packagedResources: report.resourceChecksPassed === report.resourceChecksTotal
      && report.resourceChecksTotal >= 5,
    appLaunch: report.launchCount >= 2 && report.health?.failed === 0,
    realTasks: report.taskCyclesCompleted >= minimumTaskCycles,
    artifactTruth: report.artifacts?.artifactManifests >= minimumTaskCycles
      && report.artifacts?.params >= minimumTaskCycles
      && report.artifacts?.provenance >= minimumTaskCycles
      && report.artifacts?.independentScripts >= minimumTaskCycles
      && report.artifacts?.htmlReports >= minimumTaskCycles,
    restartPersistence: report.persistence?.projectsBeforeRestart >= minimumTaskCycles
      && report.persistence?.projectsAfterRestart >= report.persistence?.projectsBeforeRestart,
    ownedBackendShutdown: report.shutdown?.every((item) => item.backendStopped === true) === true,
    endurance: report.observationMs >= minimumObservationMs
      && report.health?.passed >= minimumHealthSamples,
    privacy: privacyClean(report),
  };
  return { checks, passed: Object.values(checks).every(Boolean) };
}

export async function runPackagedQualification({
  taskCycles = 1,
  minimumObservationMs = 0,
  appMode = 'packaged-macos-arm64-qualification',
} = {}) {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') {
    throw new Error('packaged_qualification_requires_macos_arm64');
  }
  const paths = appPaths(resolveAppPath());
  for (const file of [paths.executable, paths.infoPlist, paths.buildSubject]) {
    if (!existsSync(file)) throw new Error(`packaged_resource_missing:${basename(file)}`);
  }
  const buildSubject = JSON.parse(readFileSync(paths.buildSubject, 'utf8'));
  const subject = qualification.buildQualificationManifest();
  if (buildSubject.sourceCommit !== git('rev-parse', 'HEAD')) throw new Error('packaged_source_commit_mismatch');
  if (buildSubject.baseline?.bundleDigest !== subject.bundleDigest) throw new Error('packaged_baseline_mismatch');

  const requiredResources = [
    join(paths.resources, 'frontend/dist/index.html'),
    join(paths.resources, 'core/petri-server/server.js'),
    join(paths.resources, 'core/shared-backend/g0-baseline.js'),
    join(paths.resources, 'built-in-plugins/manifest.json'),
    join(paths.resources, 'built-in-plugins/deseq2/scripts/deseq2.R'),
  ];
  const tempRoot = mkdtempSync(join(tmpdir(), 'petri-lf12-packaged-'));
  const sandbox = {
    dataDir: join(tempRoot, 'data'),
    electronDataDir: join(tempRoot, 'electron'),
  };
  mkdirSync(sandbox.dataDir, { recursive: true });
  mkdirSync(sandbox.electronDataDir, { recursive: true });
  const runtime = createRuntimeLinks(sandbox.dataDir);
  const reportDirs = [];
  const shutdown = [];
  const health = { passed: 0, failed: 0, samples: 0 };
  const rss = [];
  let firstInstance = null;
  let secondInstance = null;
  const startedAt = Date.now();
  let observationStartedAt = null;
  let sampler = null;
  try {
    firstInstance = await startPackagedApp(paths, sandbox);
    observationStartedAt = Date.now();
    let sampling = false;
    const sample = async () => {
      if (sampling || !firstInstance || firstInstance.state.exited) return;
      sampling = true;
      try {
        health.samples += 1;
        const response = await fetchJson(firstInstance.state.port, '/api/health');
        if (response?.status === 'ok') health.passed += 1;
        else health.failed += 1;
        rss.push(treeRssBytes(firstInstance.child.pid));
      } finally {
        sampling = false;
      }
    };
    await sample();
    sampler = setInterval(() => { sample().catch(() => { health.failed += 1; }); }, 2500);
    for (let index = 0; index < taskCycles; index += 1) {
      const reportDir = join(tempRoot, `report-${index + 1}`);
      reportDirs.push(reportDir);
      await runGoldenPath(
        firstInstance.state.port,
        reportDir,
        join(paths.resources, 'built-in-plugins/deseq2/demo-data'),
      );
    }
    const remaining = minimumObservationMs - (Date.now() - observationStartedAt);
    if (remaining > 0) await delay(remaining);
    clearInterval(sampler);
    sampler = null;
    while (sampling) await delay(25);

    const projectsBeforeRestart = await projectCount(firstInstance.state.port);
    shutdown.push(await stopPackagedApp(firstInstance));
    firstInstance = null;

    secondInstance = await startPackagedApp(paths, sandbox);
    const restartHealth = await fetchJson(secondInstance.state.port, '/api/health');
    if (restartHealth?.status === 'ok') health.passed += 1;
    else health.failed += 1;
    health.samples += 1;
    rss.push(treeRssBytes(secondInstance.child.pid));
    const projectsAfterRestart = await projectCount(secondInstance.state.port);
    shutdown.push(await stopPackagedApp(secondInstance));
    secondInstance = null;

    const artifacts = collectArtifactCounts(sandbox.dataDir, reportDirs);
    const observationMs = Date.now() - observationStartedAt;
    const report = {
      schemaVersion: 1,
      qualificationId: qualification.contract.qualificationId,
      sourceCommit: buildSubject.sourceCommit,
      baseline: buildSubject.baseline,
      platform: 'macos-arm64',
      architecture: 'arm64',
      appMode,
      privacy: 'source_commit_digests_counts_booleans_and_bounded_resource_metrics_only',
      executableArchitectures: executableArchitectures(paths.executable),
      codeSignatureVerified: checkCodeSignature(paths.appPath),
      resourceChecksPassed: requiredResources.filter(existsSync).length,
      resourceChecksTotal: requiredResources.length,
      resourceBundleSha256: sha256(requiredResources.map((file) => existsSync(file) ? sha256File(file) : 'missing').join('\n')),
      executableSha256: sha256File(paths.executable),
      infoPlistSha256: sha256File(paths.infoPlist),
      buildSubjectSha256: sha256File(paths.buildSubject),
      runnerHashes: {
        packagedQualificationSha256: sha256File(fileURLToPath(import.meta.url)),
        goldenPathSha256: sha256File(join(root, 'scripts/golden-path.mjs')),
        afterPackSha256: sha256File(join(root, 'build/afterPack.js')),
      },
      runtime,
      launchCount: 2,
      taskCyclesCompleted: taskCycles,
      artifacts,
      persistence: { projectsBeforeRestart, projectsAfterRestart },
      health,
      resources: {
        sampleCount: rss.length,
        firstTreeRssBytes: rss[0] || 0,
        lastTreeRssBytes: rss[rss.length - 1] || 0,
        maxTreeRssBytes: rss.length > 0 ? Math.max(...rss) : 0,
      },
      shutdown,
      observationMs,
      totalDurationMs: Date.now() - startedAt,
      generatedAt: new Date().toISOString(),
    };
    const minimumSamples = Math.max(1, Math.floor(minimumObservationMs / 5000));
    const verdict = evaluatePackagedReport(report, {
      minimumTaskCycles: taskCycles,
      minimumObservationMs,
      minimumHealthSamples: minimumSamples,
    });
    return { ...report, checks: verdict.checks, passed: verdict.passed };
  } finally {
    if (sampler) clearInterval(sampler);
    if (firstInstance) await stopPackagedApp(firstInstance);
    if (secondInstance) await stopPackagedApp(secondInstance);
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

export function verifyStoredPackaged(file = evidencePath) {
  if (!existsSync(file)) throw new Error('packaged_evidence_missing');
  const report = JSON.parse(readFileSync(file, 'utf8'));
  const subject = qualification.buildQualificationManifest();
  const verdict = evaluatePackagedReport(report);
  if (!report.passed || !verdict.passed) throw new Error('packaged_qualification_failed');
  if (!isAncestor(report.sourceCommit)) throw new Error('packaged_source_not_ancestor');
  if (report.baseline?.bundleDigest !== subject.bundleDigest) throw new Error('packaged_baseline_stale');
  if (
    report.runnerHashes?.packagedQualificationSha256 !== sha256File(fileURLToPath(import.meta.url))
    || report.runnerHashes?.goldenPathSha256 !== sha256File(join(root, 'scripts/golden-path.mjs'))
    || report.runnerHashes?.afterPackSha256 !== sha256File(join(root, 'build/afterPack.js'))
  ) throw new Error('packaged_runner_stale');
  if (!privacyClean(report)) throw new Error('packaged_evidence_privacy_failure');
  return report;
}

export async function main(argv = process.argv.slice(2)) {
  try {
    if (argv.includes('--write-evidence')) {
      const report = await runPackagedQualification();
      mkdirSync(dirname(evidencePath), { recursive: true });
      writeFileSync(evidencePath, `${JSON.stringify(report, null, 2)}\n`);
      if (!report.passed) throw new Error('packaged_qualification_failed');
      console.log('[G0-LF12 packaged] PASS — current macOS arm64 app, real task and restart');
    } else {
      verifyStoredPackaged();
      console.log('[G0-LF12 packaged] PASS — stored evidence valid');
    }
  } catch (error) {
    console.error(`[G0-LF12 packaged] FAIL — ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
