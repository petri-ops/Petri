#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  REPO_ROOT,
  START_EVIDENCE_PATH,
  inspectG0Start,
  writeStartEvidence,
} from './g0-start-audit.mjs';

const require = createRequire(import.meta.url);
const g0 = require('../core/shared-backend/g0-baseline');
const LF0_EVIDENCE_PATH = join(
  REPO_ROOT,
  'acceptance/g0-living-foundation/g0-lf0-acceptance.json',
);

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function git(...args) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
}

function isAncestor(commit) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', commit, 'HEAD'], {
      cwd: REPO_ROOT,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

function read(relativePath) {
  return readFileSync(join(REPO_ROOT, relativePath), 'utf8');
}

function makeCheck(id, passed, evidence, detail) {
  return { id, passed: passed === true, evidence, detail };
}

function inspectLf0(startReport, verification = null, options = {}) {
  const bundle = g0.validateG0BaselineBundle();
  const dbSource = read('core/r-server/db.js');
  const apiSource = read('core/r-server/api-data.js');
  const layoutSource = read('core/shared-backend/project-run-layout.js');
  const workspaceSource = read('core/r-server/agent-tools/workspace-tools.js');
  const plan = read('docs/g0-living-foundation-plan.md');
  const packageJson = JSON.parse(read('package.json'));
  const supportGroups = ['platforms', 'providers', 'runtimes', 'plugins', 'projectFormats'];
  const expectedResources = Object.values(g0.manifest.resourceRefs);
  const requiredFiles = [
    'core/shared-backend/g0-baseline.js',
    'core/shared-backend/g0/constitution.json',
    'core/shared-backend/g0/baseline-manifest.json',
    'core/shared-backend/g0/baseline-registry.json',
    'core/shared-backend/g0/support-matrix.json',
    'core/shared-backend/g0/governance-vocabulary.json',
    'test/g0-baseline.test.mjs',
    'test/g0-project-baseline.test.mjs',
    'test/g0-api-route.test.mjs',
  ];
  const bootstrap = options.bootstrap === true;
  const checks = [
    makeCheck(
      'G0-LF0-01',
      startReport.passed === true && startReport.checks.length === 10,
      ['acceptance/g0-living-foundation/g0-start-audit.json'],
      'G0-START is closed before LF0 promotion.',
    ),
    makeCheck(
      'G0-LF0-02',
      bundle.ok === true
        && bundle.baseline.lifecycleStatus === 'establishing'
        && bundle.baseline.qualificationStatus === 'not_yet_qualified',
      ['core/shared-backend/g0-baseline.js', ...expectedResources],
      'Constitution, manifest, registry, support and governance resources are internally consistent.',
    ),
    makeCheck(
      'G0-LF0-03',
      requiredFiles.every((relativePath) => existsSync(join(REPO_ROOT, relativePath)))
        && g0.constitution.invariants.length === 8
        && g0.constitution.reasoningBoundary.persistHiddenReasoning === false,
      requiredFiles,
      'Machine-readable LF0 resources and contract tests are present.',
    ),
    makeCheck(
      'G0-LF0-04',
      supportGroups.every((group) => g0.supportMatrix[group].every((item) =>
        Object.hasOwn(g0.governanceVocabulary.capabilityStatuses, item.status)
      ))
        && supportGroups.every((group) => g0.supportMatrix[group].every((item) => item.status !== 'qualified')),
      ['core/shared-backend/g0/support-matrix.json', 'core/shared-backend/g0/governance-vocabulary.json'],
      'Support claims use the fixed vocabulary and do not pre-claim LF12 qualification.',
    ),
    makeCheck(
      'G0-LF0-05',
      /CREATE TABLE IF NOT EXISTS project_g0_baselines/.test(dbSource)
        && /created_baseline_id/.test(dbSource)
        && /created_bundle_digest/.test(dbSource)
        && /opened_baseline_id/.test(dbSource)
        && /opened_bundle_digest/.test(dbSource)
        && /compatibility_status/.test(dbSource),
      ['core/r-server/db.js'],
      'Projects persist creating/opening baseline identity and compatibility verdict.',
    ),
    makeCheck(
      'G0-LF0-06',
      /futureMajorPolicy/.test(JSON.stringify(g0.manifest))
        && g0.evaluateProjectBaselineCompatibility({
          createdBaselineId: 'future',
          createdBaselineVersion: '1.0.0',
        }).status === 'blocked'
        && /assertProjectG0Compatible/.test(layoutSource)
        && /requireCompatible/.test(workspaceSource),
      [
        'core/shared-backend/g0-baseline.js',
        'core/shared-backend/project-run-layout.js',
        'core/r-server/agent-tools/workspace-tools.js',
      ],
      'Future or identity-conflicting projects remain readable but formal execution and writes are blocked.',
    ),
    makeCheck(
      'G0-LF0-07',
      /router\.get\('\/g0-baseline'/.test(apiSource)
        && /router\.get\('\/projects\/:id\/g0-baseline'/.test(apiSource),
      ['core/r-server/api-data.js', 'frontend/src/lib/project-types.ts'],
      'Current and per-project baseline identities are exposed through the existing project API.',
    ),
    makeCheck(
      'G0-LF0-08',
      packageJson.scripts['g0:start:check']
        && packageJson.scripts['g0:lf0:test']
        && packageJson.scripts['g0:lf0']
        && packageJson.scripts['g0:lf0:update']
        && packageJson.scripts.check.includes('g0:lf0'),
      ['package.json'],
      'LF0 conformance is a permanent root check, not an optional document claim.',
    ),
    makeCheck(
      'G0-LF0-09',
      bootstrap || (
        /状态：`establishing`/.test(plan)
        && /`G0-START`：`completed`/.test(plan)
        && /`G0-LF0`：`completed`/.test(plan)
      ),
      ['docs/g0-living-foundation-plan.md'],
      bootstrap
        ? 'Bootstrap mode allows the source commit before evidence/status promotion.'
        : 'The G0 plan records establishing lifecycle and completed START/LF0 packages.',
    ),
    makeCheck(
      'G0-LF0-10',
      bootstrap || (
        verification?.commands?.length >= 5
        && verification.commands.every((command) => command.passed === true)
      ),
      ['acceptance/g0-living-foundation/g0-lf0-acceptance.json'],
      bootstrap
        ? 'Bootstrap mode is used only inside the current full validation command.'
        : 'Root, frontend, build and HLE product gates are captured with output digests.',
    ),
  ];
  return {
    schemaVersion: 1,
    workPackage: 'G0-LF0',
    sourceCommit: git('rev-parse', 'HEAD'),
    baseline: g0.getCurrentG0Baseline(),
    privacy: 'no_credentials_urls_headers_raw_provider_responses_or_command_output',
    startGate: {
      passed: startReport.passed,
      checkCount: startReport.checks.length,
    },
    checks,
    ...(verification ? { verification } : {}),
    passed: checks.every((check) => check.passed),
  };
}

function runVerificationCommands() {
  const commands = [
    {
      label: 'g0-lf0-test',
      command: ['node', ['--test', 'test/g0-baseline.test.mjs', 'test/g0-project-baseline.test.mjs', 'test/g0-api-route.test.mjs']],
    },
    {
      label: 'root-test',
      command: ['npm', ['test']],
    },
    {
      label: 'frontend-test',
      command: ['npm', ['test', '--prefix', 'frontend']],
    },
    {
      label: 'frontend-build',
      command: ['npm', ['run', 'build', '--prefix', 'frontend']],
    },
    {
      label: 'root-check',
      command: ['npm', ['run', 'check']],
    },
    {
      label: 'hle-production',
      command: ['npm', ['run', 'harness:loop:production']],
    },
  ];
  return commands.map(({ label, command: [bin, args] }) => {
    const result = spawnSync(bin, args, {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      env: {
        ...process.env,
        G0_LF0_BOOTSTRAP: '1',
        G0_FIRST_WAVE_BOOTSTRAP: '1',
        G0_SECOND_WAVE_BOOTSTRAP: '1',
      },
    });
    return {
      label,
      command: [bin, ...args].join(' '),
      exitCode: result.status,
      signal: result.signal || null,
      passed: result.status === 0,
      stdoutSha256: sha256(result.stdout || ''),
      stderrSha256: sha256(result.stderr || ''),
    };
  });
}

function writeEvidence() {
  const verification = {
    generatedAt: new Date().toISOString(),
    commands: runVerificationCommands(),
  };
  const startReport = inspectG0Start({ verification });
  startReport.generatedAt = verification.generatedAt;
  startReport.verification = verification;
  const lf0Report = inspectLf0(startReport, verification);
  lf0Report.generatedAt = verification.generatedAt;
  if (!startReport.passed || !lf0Report.passed) {
    const failed = [
      ...startReport.checks.filter((item) => !item.passed).map((item) => item.id),
      ...lf0Report.checks.filter((item) => !item.passed).map((item) => item.id),
    ];
    const failedCommands = verification.commands
      .filter((command) => !command.passed)
      .map((command) => `${command.label}(exit=${command.exitCode},signal=${command.signal || 'none'})`);
    throw new Error(
      `cannot write failed G0 evidence: ${failed.join(', ')}`
      + (failedCommands.length > 0 ? `; commands: ${failedCommands.join(', ')}` : ''),
    );
  }
  writeStartEvidence(startReport);
  mkdirSync(dirname(LF0_EVIDENCE_PATH), { recursive: true });
  writeFileSync(LF0_EVIDENCE_PATH, `${JSON.stringify(lf0Report, null, 2)}\n`);
  console.log('[G0-LF0] PASS — evidence updated');
}

function verifyEvidence() {
  const bootstrap = process.env.G0_LF0_BOOTSTRAP === '1';
  if (bootstrap) {
    const startReport = inspectG0Start({ bootstrap: true });
    const report = inspectLf0(startReport, null, { bootstrap: true });
    if (!report.passed) throw new Error(report.checks.filter((item) => !item.passed).map((item) => item.id).join(', '));
    console.log('[G0-LF0] PASS (bootstrap current gate)');
    return;
  }
  if (!existsSync(START_EVIDENCE_PATH) || !existsSync(LF0_EVIDENCE_PATH)) {
    throw new Error('G0 LF0 evidence missing; run npm run g0:lf0:update');
  }
  const storedStart = JSON.parse(readFileSync(START_EVIDENCE_PATH, 'utf8'));
  const storedLf0 = JSON.parse(readFileSync(LF0_EVIDENCE_PATH, 'utf8'));
  if (!isAncestor(storedLf0.sourceCommit)) throw new Error('LF0 evidence source commit is not an ancestor of HEAD');
  const startReport = inspectG0Start({ verification: storedStart.verification });
  const report = inspectLf0(startReport, storedLf0.verification);
  if (storedLf0.baseline?.bundleDigest !== g0.getCurrentG0Baseline().bundleDigest) {
    throw new Error('G0 baseline bundle changed without refreshed evidence/version');
  }
  if (!storedStart.passed || !storedLf0.passed || !startReport.passed || !report.passed) {
    const failed = [
      ...startReport.checks.filter((item) => !item.passed).map((item) => item.id),
      ...report.checks.filter((item) => !item.passed).map((item) => item.id),
    ];
    throw new Error(`G0 LF0 verification failed: ${failed.join(', ')}`);
  }
  console.log('[G0-LF0] PASS — START 10/10, LF0 10/10');
}

try {
  if (process.argv.includes('--write-evidence')) writeEvidence();
  else verifyEvidence();
} catch (error) {
  console.error(`[G0-LF0] FAIL — ${error.message}`);
  process.exitCode = 1;
}
