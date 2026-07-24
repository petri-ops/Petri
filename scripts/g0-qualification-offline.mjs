#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = join(root, 'acceptance/g0-qualification/offline-conformance.json');
const require = createRequire(import.meta.url);
const g0 = require('../core/shared-backend/g0-baseline');
const qualification = require('../core/shared-backend/g0-baseline-qualification');
const sha256 = (value) => createHash('sha256').update(String(value)).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

const specs = [
  {
    label: 'constitution-baseline-migration',
    bin: 'node',
    args: ['--test', 'test/g0-baseline.test.mjs', 'test/g0-project-baseline.test.mjs', 'test/g0-api-route.test.mjs'],
    evidenceClasses: ['constitution_baseline', 'migration_upgrade'],
  },
  {
    label: 'truth-durable-recovery',
    bin: 'node',
    args: ['--test', 'test/g0-first-wave.test.mjs', 'test/harness-workflow-state.test.mjs', 'test/loop-recovery-integration.test.mjs'],
    evidenceClasses: ['truth_lattice', 'durable_state'],
  },
  {
    label: 'science-replay-drift',
    bin: 'node',
    args: ['--test', 'test/g0-second-wave.test.mjs', 'test/delivery-manifest.test.mjs', 'test/scientific-replay-package.test.mjs'],
    evidenceClasses: ['scientific_accuracy', 'replay_drift'],
  },
  {
    label: 'runtime-model-observable',
    bin: 'node',
    args: ['--test', 'test/g0-third-wave.test.mjs', 'test/runtime-resource-snapshot.test.mjs', 'test/model-gateway.test.mjs', 'test/loop-checkpoint.test.cjs'],
    evidenceClasses: ['runtime_resource', 'model_memory_cost', 'observable_experience'],
  },
  {
    label: 'supply-security-resilience',
    bin: 'node',
    args: ['--test', 'test/g0-fourth-wave.test.mjs', 'test/plugin-sdk.test.mjs', 'test/agent-tool-policy.test.mjs', 'test/harness-workspace-tools.test.mjs', 'test/diagnostic-redaction.test.mjs', 'test/loop-false-success-regression.test.mjs'],
    evidenceClasses: ['plugin_supply_chain', 'security_permission', 'resilience_fault_matrix'],
  },
];

function runSpec(spec) {
  const result = spawnSync(spec.bin, spec.args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env },
  });
  return {
    label: spec.label,
    command: [spec.bin, ...spec.args].join(' '),
    evidenceClasses: [...spec.evidenceClasses],
    exitCode: result.status,
    signal: result.signal || null,
    passed: result.status === 0,
    stdoutSha256: sha256(result.stdout || ''),
    stderrSha256: sha256(result.stderr || ''),
  };
}

function buildReport() {
  const baseline = g0.getQualificationSubjectBaseline();
  const sourceCommit = git('rev-parse', 'HEAD');
  const commands = specs.map(runSpec);
  const classStatus = {};
  for (const cls of qualification.contract.requiredEvidenceClasses.filter((item) => item.evidenceMode === 'offline_deterministic')) {
    const relevant = commands.filter((command) => command.evidenceClasses.includes(cls.id));
    classStatus[cls.id] = relevant.length > 0 && relevant.every((command) => command.passed)
      ? 'passed'
      : 'blocked';
  }
  return {
    schemaVersion: 1,
    qualificationId: qualification.contract.qualificationId,
    sourceCommit,
    baseline: {
      baselineId: baseline.baselineId,
      baselineVersion: baseline.baselineVersion,
      bundleDigest: baseline.bundleDigest,
    },
    platform: 'macos-arm64',
    architecture: 'arm64',
    appMode: 'qualification-harness',
    privacy: 'command_status_and_output_digests_only_no_raw_output_credentials_urls_or_absolute_paths',
    commands,
    runnerSha256: sha256(readFileSync(fileURLToPath(import.meta.url))),
    classStatus,
    passed: Object.values(classStatus).every((status) => status === 'passed') && commands.every((command) => command.passed),
    generatedAt: new Date().toISOString(),
  };
}

function isAncestor(commit) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', commit, 'HEAD'], { cwd: root, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function verifyStored() {
  if (!existsSync(evidencePath)) throw new Error('offline_conformance_evidence_missing');
  const stored = JSON.parse(readFileSync(evidencePath, 'utf8'));
  const baseline = g0.getQualificationSubjectBaseline();
  const offlineIds = qualification.contract.requiredEvidenceClasses
    .filter((item) => item.evidenceMode === 'offline_deterministic')
    .map((item) => item.id);
  if (!stored.passed) throw new Error('offline_conformance_not_passed');
  if (!isAncestor(stored.sourceCommit)) throw new Error('offline_conformance_source_not_ancestor');
  if (stored.baseline?.bundleDigest !== baseline.bundleDigest) throw new Error('offline_conformance_baseline_stale');
  if (stored.runnerSha256 !== sha256(readFileSync(fileURLToPath(import.meta.url)))) throw new Error('offline_conformance_runner_stale');
  if (!offlineIds.every((id) => stored.classStatus?.[id] === 'passed')) throw new Error('offline_conformance_class_missing');
  if (!Array.isArray(stored.commands) || stored.commands.length !== specs.length || !stored.commands.every((item) => item.passed)) {
    throw new Error('offline_conformance_command_failure');
  }
  return stored;
}

try {
  if (process.argv.includes('--write-evidence')) {
    const report = buildReport();
    if (!report.passed) {
      const failed = report.commands.filter((item) => !item.passed).map((item) => item.label);
      throw new Error(`offline_conformance_failed:${failed.join(',')}`);
    }
    mkdirSync(dirname(evidencePath), { recursive: true });
    writeFileSync(evidencePath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`[G0-LF12-Q2-Q4] PASS — ${Object.keys(report.classStatus).length}/12 offline classes, evidence updated`);
  } else {
    const report = verifyStored();
    console.log(`[G0-LF12-Q2-Q4] PASS — ${Object.keys(report.classStatus).length}/12 offline classes`);
  }
} catch (error) {
  console.error(`[G0-LF12-Q2-Q4] FAIL — ${error.message}`);
  process.exitCode = 1;
}
