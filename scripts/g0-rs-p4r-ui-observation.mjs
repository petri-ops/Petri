#!/usr/bin/env node

/**
 * G0-RS-P4R-6 real renderer observation.
 *
 * One parent process owns the complete disposable lifecycle:
 *
 *   real run_tool corpus -> isolated backend :3001 -> Vite :3000
 *   -> hidden Electron/Chromium driver -> bounded screenshots + DOM evidence
 *   -> stop every child -> remove the disposable root.
 *
 * This replaces the former manual/multi-session capture shape. It fails closed
 * when either fixed renderer port is occupied, installs signal cleanup, never
 * points at user data, and only writes canonical evidence when exact HEAD
 * contains every hashed producer/source file.
 */

import { createHash } from 'node:crypto';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createCaptureEnv, startServer, stopServer } from './g0-rs-p4r-capture.mjs';
import { generateCorpus } from './g0-rs-p4r-corpus.mjs';
import { runAgentChild } from './g0-rs-p4r-live-observation.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const evidencePath = path.join(repoRoot, 'acceptance/g0-result-studio/rs-p4r-ui-observation.json');
const screenshotDir = path.join(repoRoot, 'acceptance/g0-result-studio/rs-p4r-ui');
const driverPath = path.join(repoRoot, 'scripts/g0-rs-p4r-ui-driver.cjs');
const vitePath = path.join(repoRoot, 'frontend/node_modules/vite/bin/vite.js');
const electronPath = path.join(repoRoot, 'node_modules/.bin/electron');
const RENDERER_URL = 'http://127.0.0.1:3000';
const BACKEND_PORT = 3001;

export const UI_SOURCE_FILES = Object.freeze({
  observation: 'scripts/g0-rs-p4r-ui-observation.mjs',
  driver: 'scripts/g0-rs-p4r-ui-driver.cjs',
  observationTest: 'test/p4r-ui-observation.test.mjs',
  liveProducer: 'scripts/g0-rs-p4r-live-observation.mjs',
  corpus: 'scripts/g0-rs-p4r-corpus.mjs',
  capture: 'scripts/g0-rs-p4r-capture.mjs',
  packageScripts: 'package.json',
  impactMap: 'test/impact-map.json',
  background: 'core/shared-backend/result-studio-background.js',
  backgroundChild: 'core/shared-backend/result-studio-background-child.js',
  workspace: 'frontend/src/pages/project-workspace.tsx',
  workspaceStyles: 'frontend/src/pages/project-workspace.module.css',
  resultSurface: 'frontend/src/components/result-studio/ResultStudioSurface.tsx',
  resultSurfaceStyles: 'frontend/src/components/result-studio/ResultStudioSurface.module.css',
  resultComposerStyles: 'frontend/src/components/result-studio/ResultAgentComposer.module.css',
  resultComposer: 'frontend/src/components/result-studio/ResultAgentComposer.tsx',
  resultEditPanelStyles: 'frontend/src/components/result-studio/ResultEditPanel.module.css',
  resultEditPanel: 'frontend/src/components/result-studio/ResultEditPanel.tsx',
  changeReview: 'frontend/src/components/result-studio/ResultStudioChangeSetPanel.tsx',
  changeReviewStyles: 'frontend/src/components/result-studio/ResultStudioChangeSetPanel.module.css',
  changeReviewTest: 'frontend/src/components/result-studio/ResultStudioChangeSetPanel.test.tsx',
  codeView: 'frontend/src/components/result-studio/RevisionCodeView.tsx',
  codeViewStyles: 'frontend/src/components/result-studio/RevisionCodeView.module.css',
  resultStudioClient: 'frontend/src/components/result-studio/resultStudioClient.ts',
  interactionClient: 'frontend/src/lib/result-studio-interaction-client.ts',
  scientificViewer: 'frontend/src/components/result-studio/ScientificInteractionViewer.tsx',
  scientificViewerStyles: 'frontend/src/components/result-studio/ScientificInteractionViewer.module.css',
  scientificViewerTest: 'frontend/src/components/result-studio/ScientificInteractionViewer.test.tsx',
  theme: 'frontend/src/themes/ThemeProvider.tsx',
});

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function sourceBinding() {
  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim();
  const sourceHashes = Object.fromEntries(Object.entries(UI_SOURCE_FILES).map(([key, file]) => [
    key,
    sha256(readFileSync(path.join(repoRoot, file))),
  ]));
  const sourceMismatches = Object.entries(UI_SOURCE_FILES).flatMap(([key, file]) => {
    const shown = spawnSync('git', ['show', `${sourceCommit}:${file}`], { cwd: repoRoot });
    return shown.status === 0 && sha256(shown.stdout) === sourceHashes[key] ? [] : [file];
  });
  return {
    sourceCommit,
    sourceFiles: UI_SOURCE_FILES,
    sourceHashes,
    sourceCommitMatchesSourceHashes: sourceMismatches.length === 0,
    sourceMismatches,
  };
}

async function assertPortFree(port) {
  await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', () => reject(new Error(`required local port ${port} is already in use`)));
    probe.listen(port, '127.0.0.1', () => probe.close(resolve));
  });
}

async function waitForUrl(url, child, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  let last = 'not attempted';
  while (Date.now() < deadline) {
    if (child?.exitCode !== null && child?.exitCode !== undefined) {
      throw new Error(`renderer process exited before ready (code ${child.exitCode})`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
      last = `status ${response.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`renderer did not become ready: ${last}`);
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 3_000)),
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

function pickArtifact(outputs) {
  const names = Object.keys(outputs || {});
  return names.find((name) => /volcano.*\.png$/i.test(name))
    || names.find((name) => /\.png$/i.test(name))
    || null;
}

function alignDisposableDesktopIdentity(databasePath, projectId) {
  const Database = require(require.resolve('better-sqlite3', {
    paths: [path.join(repoRoot, 'core/r-server'), repoRoot],
  }));
  const sqlite = new Database(databasePath);
  try {
    const row = sqlite.prepare('select user_id from projects where id=?').get(projectId);
    if (!row) throw new Error('disposable UI project is missing');
    if (row.user_id === 'local-user') return false;
    if (row.user_id !== 'p4r-corpus') {
      throw new Error('refusing to rewrite an unexpected UI fixture owner');
    }
    const update = sqlite.prepare('update projects set user_id=? where id=? and user_id=?')
      .run('local-user', projectId, 'p4r-corpus');
    if (update.changes !== 1) throw new Error('disposable UI identity alignment failed');
    return true;
  } finally {
    sqlite.close();
  }
}

async function runElectron(configPath, resultPath, { onSpawn, onRestartRequest } = {}) {
  const stderr = [];
  let stdoutBuffer = '';
  let controlChain = Promise.resolve();
  const child = spawn(electronPath, [driverPath], {
    cwd: repoRoot,
    env: { ...process.env, BIOF3_P4R_UI_DRIVER_CONFIG: configPath },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  onSpawn?.(child);
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdoutBuffer += chunk;
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() || '';
    for (const line of lines) {
      if (line === '__P4R6_BACKEND_RESTART_REQUEST__') {
        controlChain = controlChain.then(async () => {
          await onRestartRequest?.('stop');
          child.stdin.write('__P4R6_BACKEND_STOPPED__\n');
        });
      } else if (line === '__P4R6_BACKEND_RESTART_CONTINUE__') {
        controlChain = controlChain.then(async () => {
          await onRestartRequest?.('start');
          child.stdin.write('__P4R6_BACKEND_RESTARTED__\n');
        });
      }
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr.push(chunk);
    if (stderr.join('').length > 12_000) stderr.splice(0, stderr.length - 4);
  });
  const exit = await new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
    child.once('error', (error) => resolve({ code: null, signal: null, error }));
  });
  if (exit.code !== 0) {
    const persisted = existsSync(resultPath)
      ? JSON.parse(readFileSync(resultPath, 'utf8'))
      : null;
    throw new Error(`Electron observation failed (${JSON.stringify(exit)}): ${persisted?.error || stderr.join('').slice(-4_000)}`);
  }
  if (!existsSync(resultPath)) throw new Error('Electron observation exited without a result');
  return JSON.parse(readFileSync(resultPath, 'utf8'));
}

export function sanitizeUiEvidence(value, location = '$') {
  if (typeof value === 'string') {
    if (/https?:\/\//i.test(value)) throw new Error(`privacy violation: URL at ${location}`);
    if (/(?:\/Users\/|\/home\/|[A-Za-z]:\\)/.test(value)) throw new Error(`privacy violation: absolute path at ${location}`);
    if (/\b(?:rev|cs|tj|sel|conv|p)_[a-z0-9_-]{6,}\b/i.test(value)) {
      throw new Error(`privacy violation: internal identifier at ${location}`);
    }
    if (/sk-[A-Za-z0-9]{12,}/.test(value)) throw new Error(`privacy violation: credential-like value at ${location}`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => sanitizeUiEvidence(item, `${location}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) sanitizeUiEvidence(item, `${location}.${key}`);
  }
}

export async function observeP4RUi({ writeEvidence = false, keep = false } = {}) {
  await assertPortFree(3000);
  await assertPortFree(BACKEND_PORT);

  const root = mkdtempSync(path.join(tmpdir(), 'biof3-p4r-ui-'));
  const captureDir = path.join(root, 'ui-captures');
  const configPath = path.join(root, 'ui-driver-config.json');
  const resultPath = path.join(root, 'ui-driver-result.json');
  let backend = null;
  let vite = null;
  let electron = null;
  let cleaning = false;

  const cleanup = async () => {
    if (cleaning) return;
    cleaning = true;
    await stopChild(electron);
    await stopChild(vite);
    await stopServer(backend?.child);
    if (!keep && existsSync(root)) rmSync(root, { recursive: true, force: true });
  };
  const onSignal = (signal) => {
    void cleanup().finally(() => {
      process.exit(signal === 'SIGINT' ? 130 : 143);
    });
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  try {
    const corpus = await generateCorpus({ root, keep: true, quiet: true });
    if (!corpus.ok) throw new Error('real P4R corpus did not complete');
    alignDisposableDesktopIdentity(path.join(root, 'biof3.db'), corpus.projectId);
    const record = corpus.records.find((item) => item.id === 'volcano-plot');
    const artifact = pickArtifact(corpus.outputs['volcano-plot']);
    if (!record?.toolJobId || !artifact) throw new Error('standalone volcano target is unavailable');

    const { env } = createCaptureEnv({ port: BACKEND_PORT, root });
    env.R_SERVER_PORT = String(BACKEND_PORT);
    backend = await startServer(env);

    const interaction = await fetch(
      `${backend.baseUrl}/api/result-studio/interaction?projectId=${encodeURIComponent(corpus.projectId)}&jobId=${encodeURIComponent(record.toolJobId)}&artifact=${encodeURIComponent(artifact)}`,
    );
    if (!interaction.ok) throw new Error(`baseline interaction failed with ${interaction.status}`);
    const interactionData = await interaction.json();
    const revisionId = interactionData.revision?.revisionId || null;
    const requestedOutcome = '换成色盲友好配色，并让标签更容易阅读';
    const agentCandidate = await runAgentChild(env, {
      projectId: corpus.projectId,
      jobId: record.toolJobId,
      artifact,
      revisionId,
      requestedOutcome,
      parameterPatch: {
        color_up: '#d55e00',
        color_down: '#0072b2',
        point_size: 2.4,
        label_size: 3.6,
      },
    });
    const conversationId = agentCandidate.conversationId;
    const contextPreflight = await fetch(
      `${backend.baseUrl}/api/result-studio/context-envelope?projectId=${encodeURIComponent(corpus.projectId)}&conversationId=${encodeURIComponent(conversationId)}&jobId=${encodeURIComponent(record.toolJobId)}&artifact=${encodeURIComponent(artifact)}${revisionId ? `&revisionId=${encodeURIComponent(revisionId)}` : ''}`,
    );
    if (!contextPreflight.ok) {
      const detail = await contextPreflight.json().catch(() => ({}));
      throw new Error(`UI context preflight failed with ${contextPreflight.status}: ${detail.error || 'context_unavailable'}`);
    }

    vite = spawn(process.execPath, [vitePath, '--host', '127.0.0.1', '--port', '3000', '--strictPort'], {
      cwd: path.join(repoRoot, 'frontend'),
      env: { ...process.env, NODE_ENV: 'development' },
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    await waitForUrl(RENDERER_URL, vite);

    mkdirSync(captureDir, { recursive: true });
    const projectUrl = `${RENDERER_URL}/project/${encodeURIComponent(corpus.projectId)}?mode=result&job=${encodeURIComponent(record.toolJobId)}&artifact=${encodeURIComponent(artifact)}`;
    writeFileSync(configPath, `${JSON.stringify({
      url: projectUrl,
      outputDir: captureDir,
      resultPath,
      requestedOutcome,
    })}\n`, { mode: 0o600 });

    const renderer = await runElectron(configPath, resultPath, {
      onSpawn(child) { electron = child; },
      async onRestartRequest(phase) {
        if (phase === 'stop') {
          await stopServer(backend?.child);
          backend = null;
          return;
        }
        backend = await startServer(env);
      },
    });
    const binding = sourceBinding();
    const result = {
      schemaVersion: 1,
      workPackage: 'G0-RS-P4R-6',
      qualificationEligible: false,
      classification: 'development_real_renderer_non_provider_non_packaged',
      privacy: 'fixture_labels_counts_timings_bounded_dom_digests_and_screenshot_hashes_only',
      captureMode: 'single_parent_disposable_real_corpus_backend_vite_electron_chromium',
      ...binding,
      renderer,
    };
    result.passed = renderer.passed === true && result.sourceCommitMatchesSourceHashes;
    sanitizeUiEvidence(result);

    if (writeEvidence) {
      if (!result.sourceCommitMatchesSourceHashes) {
        throw new Error(`refusing to write stale evidence; uncommitted source files: ${result.sourceMismatches.join(', ')}`);
      }
      rmSync(screenshotDir, { recursive: true, force: true });
      mkdirSync(screenshotDir, { recursive: true });
      cpSync(captureDir, screenshotDir, { recursive: true });
      mkdirSync(path.dirname(evidencePath), { recursive: true });
      writeFileSync(evidencePath, `${JSON.stringify(result, null, 2)}\n`);
    }
    return result;
  } finally {
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    await cleanup();
  }
}

async function main() {
  const writeEvidence = process.argv.includes('--write-evidence');
  const keep = process.argv.includes('--keep');
  const result = await observeP4RUi({ writeEvidence, keep });
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
