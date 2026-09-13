#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  assertSanitizedP5Evidence,
  createP5LiveScientificRuntime,
} from './g0-rs-p5-acceptance.mjs';
import {
  SDC1_GATEWAY_CLASSIFICATION,
  startSdc1LocalGateway,
} from './g0-sdc1-local-gateway.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VITE_PATH = path.join(ROOT, 'frontend/node_modules/vite/bin/vite.js');
export function resolveUx1hElectronPath(root = ROOT, platform = process.platform) {
  return platform === 'win32'
    ? path.join(root, 'node_modules/electron/dist/electron.exe')
    : path.join(root, 'node_modules/.bin/electron');
}
const ELECTRON_PATH = resolveUx1hElectronPath();
const DRIVER_PATH = path.join(ROOT, 'scripts/g0-sdc1-electron-driver.cjs');
const EVIDENCE_DIR = path.join(ROOT, 'acceptance/g0-rs-ux1h');
const SCREENSHOT_DIR = path.join(EVIDENCE_DIR, 'screenshots');
const FULL_EVIDENCE_PATH = path.join(EVIDENCE_DIR, 'async-tool-surface.json');
const SOFT_EVIDENCE_PATH = path.join(EVIDENCE_DIR, 'summary-failure-renders-soft.json');
const RETRY_EVIDENCE_PATH = path.join(EVIDENCE_DIR, 'retry-summary-does-not-rerun-tool.json');
const COUNTS_SOURCE_PATH = path.join(ROOT, 'tmp/airway-test/airway_counts_symbol.csv');
const METADATA_SOURCE_PATH = path.join(ROOT, 'tmp/airway-test/airway_metadata.csv');
const TARGET_MESSAGE = '✓ 工具已完成，AI 总结暂时不可用';
const FORBIDDEN_MESSAGE = '请求超时';
const SOURCE_FILES = Object.freeze([
  'frontend/src/components/copilot/SimpleChat.tsx',
  'frontend/src/components/copilot/SimpleChat.test.tsx',
  'frontend/src/components/copilot/toolSummaryPresentation.ts',
  'frontend/src/components/copilot/conversationRunStore.ts',
  'scripts/g0-rs-ux1h-acceptance.mjs',
  'scripts/g0-sdc1-local-gateway.mjs',
  'scripts/g0-sdc1-electron-driver.cjs',
  'core/shared-backend/llm-providers/deepseek.js',
  'core/biof3-server/routes/ai-agent.js',
  'resources/built-in-plugins/deseq2/plugin.json',
  'resources/built-in-plugins/deseq2/scripts/deseq2.R',
  'test/g0-rs-ux1h-acceptance.test.mjs',
  'test/impact-map.json',
  'package.json',
]);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

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
    if (child?.exitCode !== null && child?.exitCode !== undefined) {
      throw new Error('vite_exited_before_ready');
    }
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
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
  const id = 'ux1h-timeout-adapter';
  const profile = {
    id,
    label: 'UX1H deterministic timeout adapter',
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
    chat_model_presets: [{
      id,
      label: profile.label,
      provider: profile.provider,
      model: id,
      baseUrl: gatewayBaseUrl,
    }],
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
  const sourceCommit = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: ROOT,
    encoding: 'utf8',
  }).stdout.trim();
  const sourceHashes = Object.fromEntries(
    SOURCE_FILES.map((file) => [file, sha256(readFileSync(path.join(ROOT, file)))])
  );
  const changed = spawnSync('git', ['diff', '--name-only', 'HEAD', '--', ...SOURCE_FILES], {
    cwd: ROOT,
    encoding: 'utf8',
  }).stdout.trim().split('\n').filter(Boolean);
  const untracked = spawnSync(
    'git',
    ['ls-files', '--others', '--exclude-standard', '--', ...SOURCE_FILES],
    { cwd: ROOT, encoding: 'utf8' }
  ).stdout.trim().split('\n').filter(Boolean);
  return {
    sourceCommit,
    sourceHashes,
    sourceDigest: sha256(JSON.stringify(sourceHashes)),
    sourceCommitMatchesSourceHashes: changed.length === 0 && untracked.length === 0,
    sourceMismatches: [...new Set([...changed, ...untracked])].sort(),
  };
}

export function observeAirwayDataset() {
  const counts = readFileSync(COUNTS_SOURCE_PATH);
  const metadata = readFileSync(METADATA_SOURCE_PATH);
  const countLines = counts.toString('utf8').trimEnd().split(/\r?\n/);
  const metadataLines = metadata.toString('utf8').trimEnd().split(/\r?\n/);
  const conditions = metadataLines.slice(1).map((line) => {
    const columns = line.split(',').map((value) => value.replace(/^"|"$/g, ''));
    return columns[1] || '';
  });
  return {
    countsSha256: sha256(counts),
    metadataSha256: sha256(metadata),
    featureRows: countLines.length - 1,
    sampleColumns: countLines[0].split(',').length - 1,
    metadataRows: metadataLines.length - 1,
    groups: {
      control: conditions.filter((value) => value === 'control').length,
      treated: conditions.filter((value) => value === 'treated').length,
    },
  };
}

export function buildUx1hEvidence({ renderer, gatewayTrace, binding, dataset, noSeedPrecondition }) {
  const phases = gatewayTrace.map((item) => item.phase);
  const finalTimeout = gatewayTrace.some(
    (item) => item.phase === 'final' && item.behavior === 'timeout'
  );
  const evidence = {
    schemaVersion: 1,
    evidenceId: 'g0-rs-ux1h-async-tool-surface',
    workPackage: 'G0-RS-UX1H / UI-126',
    classification: `${SDC1_GATEWAY_CLASSIFICATION}_with_real_socket_timeout`,
    qualificationEligible: false,
    productScope: 'development Electron with real local DESeq2 and deterministic local LLM timeout; not packaged or real-provider qualification',
    noSeedPrecondition,
    dataset,
    renderer,
    gateway: {
      phases,
      requestCount: gatewayTrace.length,
      finalSocketTimeoutObserved: finalTimeout,
      noRawMessagesPersisted: true,
    },
    ...binding,
  };
  evidence.passed = renderer?.passed === true
    && ['scientific_confirmation', 'catalog', 'contract', 'execute', 'final']
      .every((phase) => phases.includes(phase))
    && finalTimeout
    && dataset.featureRows === 34_889
    && dataset.sampleColumns === 8
    && dataset.metadataRows === 8
    && dataset.groups.control === 4
    && dataset.groups.treated === 4;
  return evidence;
}

function softFailureEvidence(evidence) {
  const presentation = evidence.renderer.summaryPresentation;
  const screenshot = evidence.renderer.screenshots.summaryUnavailable;
  return {
    schemaVersion: 1,
    evidenceId: 'g0-rs-ux1h-summary-failure-renders-soft',
    workPackage: evidence.workPackage,
    classification: evidence.classification,
    qualificationEligible: false,
    sourceCommit: evidence.sourceCommit,
    sourceDigest: evidence.sourceDigest,
    dataset: evidence.dataset,
    assertions: {
      completedDeseq2JobCount: evidence.renderer.execution.completedJobCount,
      artifactTruthStatus: evidence.renderer.execution.artifactTruthStatus,
      artifactTruthBlocking: evidence.renderer.execution.artifactTruthBlocking,
      exactResultAutomaticallyOpened: evidence.renderer.automaticResultOpen.exactJob,
      targetMessage: TARGET_MESSAGE,
      targetMessageVisible: presentation.expectedVisible,
      forbiddenMessage: FORBIDDEN_MESSAGE,
      forbiddenMessageVisible: presentation.forbiddenVisible,
      completedRunToolVisible: presentation.successfulTool,
    },
    screenshot: {
      file: 'screenshots/summary-unavailable.png',
      sha256: screenshot.sha256,
      bytes: screenshot.bytes,
    },
    passed: presentation.expectedVisible === true
      && presentation.forbiddenVisible === false
      && presentation.successfulTool === true
      && evidence.renderer.execution.completedJobCount === 1
      && evidence.renderer.execution.artifactTruthStatus === 'valid'
      && evidence.renderer.execution.artifactTruthBlocking === false
      && evidence.renderer.automaticResultOpen.exactJob === true,
  };
}

function retryDoesNotRerunToolEvidence(evidence, renderer) {
  const retry = renderer.retryAssertion;
  const before = retry?.before || {};
  const after = retry?.after || {};
  const initialRemaining = retry?.initialRemaining ?? null;
  const finalRemaining = retry?.finalRemaining ?? null;
  const dispatchConsistent = retry?.runningObserved === true
    || (typeof finalRemaining === 'number' && typeof initialRemaining === 'number' && finalRemaining < initialRemaining);
  return {
    schemaVersion: 1,
    evidenceId: 'g0-rs-ux1h-retry-summary-does-not-rerun-tool',
    workPackage: evidence.workPackage,
    classification: evidence.classification,
    qualificationEligible: false,
    sourceCommit: evidence.sourceCommit,
    sourceDigest: evidence.sourceDigest,
    dataset: evidence.dataset,
    assertions: {
      retryButtonClicked: retry?.retryClicked === true,
      retryDispatchObserved: retry?.runningObserved === true,
      retryButtonRemainingBefore: initialRemaining,
      retryButtonRemainingAfter: finalRemaining,
      retryButtonDecrementedOrRunning: dispatchConsistent,
      completedDeseq2JobCountBeforeRetry: before.completedDeseq2JobCount,
      completedDeseq2JobCountAfterRetry: after.completedDeseq2JobCount,
      toolDidNotRerun: before.completedDeseq2JobCount === 1 && after.completedDeseq2JobCount === 1,
      artifactTruthStatusBefore: before.artifactTruthStatus,
      artifactTruthStatusAfter: after.artifactTruthStatus,
      artifactTruthStatusUnchanged: before.artifactTruthStatus === after.artifactTruthStatus,
      artifactTruthBlockingBefore: before.artifactTruthBlocking,
      artifactTruthBlockingAfter: after.artifactTruthBlocking,
      artifactTruthBlockingUnchanged: before.artifactTruthBlocking === after.artifactTruthBlocking,
      finalErrorShown: retry?.finalErrorShown === true,
    },
    passed: retry?.retryClicked === true
      && dispatchConsistent
      && before.completedDeseq2JobCount === 1
      && after.completedDeseq2JobCount === 1
      && before.artifactTruthStatus === 'valid'
      && after.artifactTruthStatus === 'valid'
      && before.artifactTruthBlocking === false
      && after.artifactTruthBlocking === false,
  };
}

export async function observeUx1h({
  writeEvidence = false,
  keep = false,
  show = false,
  finalBehavior = 'timeout',
} = {}) {
  const dataset = observeAirwayDataset();
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
    const runtimeRoot = runtime?.root;
    await runtime?.close({ removeRoot: !keep });
    if (!keep && runtimeRoot && existsSync(runtimeRoot)) {
      rmSync(runtimeRoot, { recursive: true, force: true });
    }
  };
  const onSignal = (signal) => {
    void cleanup().finally(() => process.exit(signal === 'SIGINT' ? 130 : 143));
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  try {
    gateway = await startSdc1LocalGateway({
      analysis: { design: 'condition', reference: 'control', treatment: 'treated' },
      finalBehavior,
      modelId: 'ux1h-timeout-adapter',
    });
    runtime = await createP5LiveScientificRuntime({
      port: backendPort,
      beforeStart: ({ env }) => {
        const origin = `http://127.0.0.1:${uiPort}`;
        const bundledRHome = process.env.BIOF3_R_HOME
          || path.join(process.env.USERPROFILE || '', 'Documents', 'BioF3-Local', 'runtimes', 'R');
        if (existsSync(path.join(bundledRHome, 'bin', process.platform === 'win32' ? 'Rscript.exe' : 'Rscript'))) {
          env.BIOF3_R_HOME = bundledRHome;
        }
        env.BIOF3_RENDERER_DEV_URL = origin;
        env.BIOF3_TRUSTED_DESKTOP_ORIGINS = origin;
        env.OPENAI_COMPATIBLE_API_KEY = 'ux1h-local-adapter-only';
        writeAiSettings(env, gateway.baseUrl);
      },
    });

    const countsUploadName = 'airway_counts_symbol.csv';
    const metadataUploadName = 'airway_metadata.csv';
    gateway.setInputPaths({
      countsPath: path.join(runtime.project.workspace_path, 'data', countsUploadName),
      metadataPath: path.join(runtime.project.workspace_path, 'data', metadataUploadName),
    });

    vite = spawn(process.execPath, [
      VITE_PATH,
      '--host',
      '127.0.0.1',
      '--port',
      String(uiPort),
      '--strictPort',
    ], {
      cwd: path.join(ROOT, 'frontend'),
      env: { ...process.env, NODE_ENV: 'development' },
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    await waitForUrl(`http://127.0.0.1:${uiPort}`, vite);

    const outputDir = path.join(runtime.root, 'ux1h-ui');
    const configPath = path.join(runtime.root, 'ux1h-driver.json');
    const resultPath = path.join(runtime.root, 'ux1h-result.json');
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(configPath, `${JSON.stringify({
      uiBaseUrl: `http://127.0.0.1:${uiPort}`,
      backendBaseUrl: `http://127.0.0.1:${backendPort}`,
      projectId: runtime.project.id,
      outputDir,
      resultPath,
      electronUserDataPath: path.join(runtime.root, 'electron-user-data'),
      countsSourcePath: COUNTS_SOURCE_PATH,
      metadataSourcePath: METADATA_SOURCE_PATH,
      countsUploadName,
      metadataUploadName,
      allowNonActionableData: true,
      initialAnalysisMessage: 'Data Profiler 已导入 airway counts 与 metadata。请先确认 design 与 control/treated 对比，再执行 DESeq2。',
      expectedConfirmationText: '请确认：design 使用 condition',
      confirmationMessage: '确认：design=condition，对照组=control，实验组=treated。请执行 DESeq2。',
      expectedAssistantText: TARGET_MESSAGE,
      forbiddenAssistantText: FORBIDDEN_MESSAGE,
      enableRetryAssertion: true,
      show,
    }, null, 2)}\n`, { mode: 0o600 });

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
        const persisted = existsSync(resultPath)
          ? JSON.parse(readFileSync(resultPath, 'utf8'))
          : null;
        reject(new Error(
          `ux1h_electron_failed:${persisted?.stage || 'unknown'}:${persisted?.error || stderr.join('').slice(-4000)}`
        ));
      });
    });

    const binding = sourceBinding();
    const evidence = buildUx1hEvidence({
      renderer,
      gatewayTrace: gateway.trace,
      binding,
      dataset,
      noSeedPrecondition: runtime.noSeedPrecondition,
    });
    const softEvidence = softFailureEvidence(evidence);
    const retryEvidence = retryDoesNotRerunToolEvidence(evidence, renderer);
    evidence.passed = evidence.passed && softEvidence.passed && retryEvidence.passed;
    assertSanitizedP5Evidence(evidence);
    assertSanitizedP5Evidence(softEvidence);
    assertSanitizedP5Evidence(retryEvidence);
    console.log(JSON.stringify({ evidence, softEvidence, retryEvidence }, null, 2));

    if (writeEvidence) {
      if (!evidence.passed || !softEvidence.passed || !retryEvidence.passed) {
        throw new Error('refusing_to_write_failed_ux1h_evidence');
      }
      if (!binding.sourceCommitMatchesSourceHashes) {
        throw new Error(`refusing_to_write_uncommitted_ux1h_evidence:${binding.sourceMismatches.join(',')}`);
      }
      mkdirSync(SCREENSHOT_DIR, { recursive: true });
      copyFileSync(
        path.join(outputDir, 'data-ready.png'),
        path.join(SCREENSHOT_DIR, 'airway-data-ready.png')
      );
      copyFileSync(
        path.join(outputDir, 'result-open.png'),
        path.join(SCREENSHOT_DIR, 'deseq2-result-open.png')
      );
      copyFileSync(
        path.join(outputDir, 'summary-unavailable.png'),
        path.join(SCREENSHOT_DIR, 'summary-unavailable.png')
      );
      mkdirSync(EVIDENCE_DIR, { recursive: true });
      writeFileSync(FULL_EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`);
      writeFileSync(SOFT_EVIDENCE_PATH, `${JSON.stringify(softEvidence, null, 2)}\n`);
      writeFileSync(RETRY_EVIDENCE_PATH, `${JSON.stringify(retryEvidence, null, 2)}\n`);
    }

    return { evidence, softEvidence };
  } finally {
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    await cleanup();
  }
}

const args = new Set(process.argv.slice(2));
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  observeUx1h({
    writeEvidence: args.has('--write'),
    keep: args.has('--keep'),
    show: args.has('--show'),
    finalBehavior: args.has('--fast-timeout') ? 'http-timeout' : 'timeout',
  }).then(({ evidence }) => {
    if (!evidence.passed) process.exitCode = 1;
  }).catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
