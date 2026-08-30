#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assertSanitizedP5Evidence,
  createP5LiveScientificRuntime,
} from './g0-rs-p5-acceptance.mjs';
import { SDC1_GATEWAY_CLASSIFICATION, startSdc1LocalGateway } from './g0-sdc1-local-gateway.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VITE_PATH = path.join(ROOT, 'frontend/node_modules/vite/bin/vite.js');
const ELECTRON_PATH = path.join(ROOT, 'node_modules/.bin/electron');
const DRIVER_PATH = path.join(ROOT, 'scripts/g0-sdc1-electron-driver.cjs');
const EVIDENCE_PATH = path.join(ROOT, 'acceptance/g0-scientific-data-contract/data-to-first-result.json');
const SCREENSHOT_DIR = path.join(ROOT, 'acceptance/g0-scientific-data-contract/data-to-first-result');
const SOURCE_FILES = Object.freeze([
  'core/shared-backend/data-profiler.js',
  'core/biof3-server/routes/files.js',
  'frontend/src/lib/data-profile.ts',
  'frontend/src/components/workspace-panels/DataIntakeControl.tsx',
  'frontend/src/components/workspace-panels/RightPanel.tsx',
  'frontend/src/pages/project-workspace.tsx',
  'frontend/src/pages/project-workspace.module.css',
  'scripts/g0-sdc1-local-gateway.mjs',
  'scripts/g0-sdc1-electron-driver.cjs',
  'scripts/g0-sdc1-acceptance.mjs',
]);

function sha256(value) { return createHash('sha256').update(value).digest('hex'); }

async function freePort(excluded = new Set()) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const port = await new Promise((resolve, reject) => {
      const server = createServer();
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        const selected = typeof address === 'object' && address ? address.port : null;
        server.close(() => resolve(selected));
      });
    });
    if (Number.isInteger(port) && !excluded.has(port)) return port;
  }
  throw new Error('could_not_allocate_loopback_port');
}

async function waitForUrl(url, child, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child?.exitCode !== null && child?.exitCode !== undefined) throw new Error('vite_exited_before_ready');
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('vite_not_ready');
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

function writeAiSettings(env, gatewayBaseUrl) {
  const id = 'sdc1-scripted';
  const profile = {
    id,
    label: 'SDC1 scripted local adapter',
    provider: 'openai-compatible',
    protocol: 'openai-compatible',
    model: id,
    baseUrl: gatewayBaseUrl,
    credentialRef: 'provider:openai-compatible',
    capabilities: ['chat', 'streaming', 'tools'],
    roles: ['chat', 'agent', 'planner', 'summary', 'report', 'explanation'],
    parameters: {},
  };
  const settings = {
    chat_model_presets: [{ id, label: profile.label, provider: profile.provider, model: id, baseUrl: gatewayBaseUrl }],
    active_chat_model_id: id,
    llm_provider: 'openai-compatible',
    model_profiles: [profile],
    model_role_bindings: Object.fromEntries(profile.roles.map((role) => [role, id])),
    model_fallback_enabled: false,
  };
  const target = path.join(env.BIOF3_LOCAL_DATA_DIR, 'ai-settings.json');
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
}

function sourceBinding() {
  const sourceCommit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
  const sourceHashes = Object.fromEntries(SOURCE_FILES.map((file) => [file, sha256(readFileSync(path.join(ROOT, file)))]));
  const changed = spawnSync('git', ['diff', '--name-only', 'HEAD', '--', ...SOURCE_FILES], {
    cwd: ROOT, encoding: 'utf8',
  }).stdout.trim().split('\n').filter(Boolean);
  const untracked = spawnSync('git', ['ls-files', '--others', '--exclude-standard', '--', ...SOURCE_FILES], {
    cwd: ROOT, encoding: 'utf8',
  }).stdout.trim().split('\n').filter(Boolean);
  return {
    sourceCommit,
    sourceHashes,
    sourceDigest: sha256(JSON.stringify(sourceHashes)),
    sourceCommitMatchesSourceHashes: changed.length === 0 && untracked.length === 0,
    sourceMismatches: [...new Set([...changed, ...untracked])].sort(),
  };
}

export async function observeSdc1({ writeEvidence = false, keep = false, show = false } = {}) {
  const backendPort = await freePort();
  const uiPort = await freePort(new Set([backendPort]));
  let gateway = null;
  let runtime = null;
  let vite = null;
  let electron = null;
  let cleaning = false;
  const cleanup = async () => {
    if (cleaning) return;
    cleaning = true;
    await stopChild(electron);
    await stopChild(vite);
    await gateway?.close();
    const root = runtime?.root;
    await runtime?.close({ removeRoot: !keep });
    if (!keep && root && existsSync(root)) rmSync(root, { recursive: true, force: true });
  };
  const onSignal = (signal) => {
    void cleanup().finally(() => process.exit(signal === 'SIGINT' ? 130 : 143));
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  try {
    gateway = await startSdc1LocalGateway({});
    runtime = await createP5LiveScientificRuntime({
      port: backendPort,
      beforeStart: ({ env }) => {
        const origin = `http://127.0.0.1:${uiPort}`;
        env.BIOF3_RENDERER_DEV_URL = origin;
        env.BIOF3_TRUSTED_DESKTOP_ORIGINS = origin;
        env.OPENAI_COMPATIBLE_API_KEY = 'sdc1-local-adapter-only';
        writeAiSettings(env, gateway.baseUrl);
      },
    });
    const countsPath = path.join(runtime.project.workspace_path, 'data', 'counts.csv');
    const metadataPath = path.join(runtime.project.workspace_path, 'data', 'metadata.csv');
    gateway.setInputPaths({ countsPath, metadataPath });

    vite = spawn(process.execPath, [VITE_PATH, '--host', '127.0.0.1', '--port', String(uiPort), '--strictPort'], {
      cwd: path.join(ROOT, 'frontend'),
      env: { ...process.env, NODE_ENV: 'development' },
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    await waitForUrl(`http://127.0.0.1:${uiPort}`, vite);

    const outputDir = path.join(runtime.root, 'sdc1-ui');
    const configPath = path.join(runtime.root, 'sdc1-driver.json');
    const resultPath = path.join(runtime.root, 'sdc1-result.json');
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(configPath, `${JSON.stringify({
      uiBaseUrl: `http://127.0.0.1:${uiPort}`,
      backendBaseUrl: `http://127.0.0.1:${backendPort}`,
      projectId: runtime.project.id,
      outputDir,
      resultPath,
      electronUserDataPath: path.join(runtime.root, 'electron-user-data'),
      countsSourcePath: path.join(ROOT, 'resources/built-in-plugins/deseq2/demo-data/demo-counts.csv'),
      metadataSourcePath: path.join(ROOT, 'resources/built-in-plugins/deseq2/demo-data/demo-coldata.csv'),
      show,
    })}\n`, { mode: 0o600 });

    const renderer = await new Promise((resolve, reject) => {
      const child = spawn(ELECTRON_PATH, [DRIVER_PATH], {
        cwd: ROOT,
        env: {
          ...process.env,
          ...runtime.env,
          BIOF3_DESKTOP: '1',
          R_SERVER_PORT: String(backendPort),
          BIOF3_SDC1_DRIVER_CONFIG: configPath,
        },
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      electron = child;
      const stderr = [];
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk) => stderr.push(String(chunk).slice(-4000)));
      child.once('error', reject);
      child.once('exit', (code) => {
        if (code === 0 && existsSync(resultPath)) {
          resolve(JSON.parse(readFileSync(resultPath, 'utf8')));
          return;
        }
        const persisted = existsSync(resultPath) ? JSON.parse(readFileSync(resultPath, 'utf8')) : null;
        reject(new Error(`sdc1_electron_failed:${persisted?.stage || 'unknown'}:${persisted?.error || stderr.join('').slice(-4000)}`));
      });
    });
    const phases = gateway.trace.map((item) => item.phase);
    const binding = sourceBinding();
    const evidence = {
      schemaVersion: 1,
      workPackage: 'G0-SDC1-A / UI-125',
      classification: SDC1_GATEWAY_CLASSIFICATION,
      qualificationEligible: false,
      productScope: 'development Electron renderer with deterministic local adapter; not packaged or real-provider qualification',
      noSeedPrecondition: runtime.noSeedPrecondition,
      renderer,
      gateway: {
        phases,
        requestCount: gateway.trace.length,
        noRawMessagesPersisted: true,
      },
      ...binding,
    };
    evidence.passed = renderer.passed === true
      && ['scientific_confirmation', 'catalog', 'contract', 'execute', 'final']
        .every((phase) => phases.includes(phase));
    assertSanitizedP5Evidence(evidence);

    if (writeEvidence) {
      if (!evidence.passed) throw new Error('refusing_to_write_failed_sdc1_evidence');
      if (!binding.sourceCommitMatchesSourceHashes) {
        throw new Error(`refusing_to_write_uncommitted_sdc1_evidence:${binding.sourceMismatches.join(',')}`);
      }
      mkdirSync(path.dirname(EVIDENCE_PATH), { recursive: true });
      mkdirSync(SCREENSHOT_DIR, { recursive: true });
      copyFileSync(path.join(outputDir, 'data-ready.png'), path.join(SCREENSHOT_DIR, 'data-ready.png'));
      copyFileSync(path.join(outputDir, 'result-open.png'), path.join(SCREENSHOT_DIR, 'result-open.png'));
      writeFileSync(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`);
    }
    console.log(JSON.stringify(evidence, null, 2));
    return evidence;
  } finally {
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    await cleanup();
  }
}

const args = new Set(process.argv.slice(2));
if (import.meta.url === `file://${process.argv[1]}`) {
  observeSdc1({
    writeEvidence: args.has('--write'),
    keep: args.has('--keep'),
    show: args.has('--show'),
  }).then((result) => {
    if (!result.passed) process.exitCode = 1;
  }).catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
