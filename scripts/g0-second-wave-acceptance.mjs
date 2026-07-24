#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = join(repoRoot, 'acceptance/g0-living-foundation/g0-second-wave-acceptance.json');
const require = createRequire(import.meta.url);
const g0 = require('../core/shared-backend/g0-baseline');
const science = require('../core/shared-backend/g0-scientific-accuracy');
const replay = require('../core/shared-backend/g0-reproducibility-lab');
const read = (relative) => readFileSync(join(repoRoot, relative), 'utf8');
const sha = (value) => createHash('sha256').update(String(value)).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
const item = (id, passed, evidence, detail) => ({ id, passed: passed === true, evidence, detail });

function isAncestor(commit) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', commit, 'HEAD'], { cwd: repoRoot, stdio: 'ignore' });
    return true;
  } catch { return false; }
}

function inspect(verification = null, bootstrap = false) {
  const corpus = JSON.parse(read('test/fixtures/g0-second-wave/replay-corpus.json'));
  const delivery = read('core/shared-backend/delivery-manifest.js');
  const replayPackage = read('core/shared-backend/scientific-replay-package.js');
  const projection = read('core/shared-backend/g0-truth-projection.js');
  const plan = read('docs/g0-living-foundation-plan.md');
  const commands = verification?.commands || [];
  const corpusValidation = replay.validateReplayCorpus(corpus);
  const negative = science.evaluateScientificAccuracy({
    method: { id: 'fixture', applicable: true, design: '~ condition', contrast: 'b-a' },
    assumptions: [{ id: 'replication', satisfied: true }],
    evidenceLevel: 'validated',
    sampleMatch: true,
    statistics: { adjustedP: 0.8, alpha: 0.05, multipleTesting: 'BH', unit: 'effect', direction: 'none' },
  });
  const checks = [
    item('G0-W2-01', g0.validateG0BaselineBundle().ok && g0.manifest.baselineVersion === '0.3.0' && g0.manifest.qualificationStatus === 'not_yet_qualified', ['core/shared-backend/g0/baseline-manifest.json'], 'Second-wave establishing baseline is internally consistent and not qualified.'),
    item('G0-W2-02', science.validateScientificAccuracyContract().ok && science.contract.requiredChecks.length >= 8, ['core/shared-backend/g0/scientific-accuracy.json'], 'Scientific applicability, assumptions and statistical semantics are machine contracts.'),
    item('G0-W2-03', negative.outcome === 'not_significant' && negative.truthStatus === 'passed' && negative.blocking === false, ['core/shared-backend/g0-scientific-accuracy.js'], 'Non-significance is a valid bounded conclusion, not failure.'),
    item('G0-W2-04', science.contract.prohibited.includes('retry_until_significant') && science.contract.prohibited.includes('threshold_tuning_for_expected_result'), ['core/shared-backend/g0/scientific-accuracy.json'], 'Scientific integrity prohibitions are explicit.'),
    item('G0-W2-05', /scientificValidation/.test(delivery) && /scientificState/.test(projection), ['core/shared-backend/delivery-manifest.js', 'core/shared-backend/g0-truth-projection.js'], 'LF3 reuses Delivery and Truth Projection.'),
    item('G0-W2-06', corpusValidation.ok && corpusValidation.caseCount >= 7, ['test/fixtures/g0-second-wave/replay-corpus.json'], 'Corpus covers normal, boundary, negative, contradictory, failure, legacy and sanitized real cases.'),
    item('G0-W2-07', replay.contract.artifactComparisonModes.join(',') === 'deterministic,tolerance_based,narrative', ['core/shared-backend/g0/reproducibility-lab.json'], 'Artifact comparison modes are explicit.'),
    item('G0-W2-08', replay.contract.driftClasses.join(',') === 'expected,compatible,scientifically_material,unknown', ['core/shared-backend/g0/reproducibility-lab.json'], 'Drift classes are fixed and reviewable.'),
    item('G0-W2-09', replay.contract.requiredFingerprintFields.length === 9 && /buildDriftReport/.test(replayPackage), ['core/shared-backend/scientific-replay-package.js'], 'Replay binds provenance and produces a structured Drift Report.'),
    item('G0-W2-10', g0.manifest.executionTruthChain.join(',') === 'run_tool,tool_job,artifact_truth', ['core/shared-backend/g0/constitution.json'], 'No second executor, Job, Artifact, Validation or Replay truth exists.'),
    item('G0-W2-11', bootstrap || (/G0-LF3[\s\S]*?状态：`completed`/.test(plan) && /G0-LF4[\s\S]*?状态：`completed`/.test(plan)), ['docs/g0-living-foundation-plan.md'], bootstrap ? 'Source bootstrap before status promotion.' : 'LF3/LF4 completion recorded.'),
    item('G0-W2-12', bootstrap || (commands.length >= 7 && commands.every((entry) => entry.passed)), ['acceptance/g0-living-foundation/g0-second-wave-acceptance.json'], bootstrap ? 'Evidence bootstrap.' : 'All required command gates passed.'),
  ];
  return {
    schemaVersion: 1,
    workPackage: 'G0-SECOND-WAVE',
    sourceCommit: git('rev-parse', 'HEAD'),
    baseline: g0.getCurrentG0Baseline(),
    privacy: 'status_counts_and_output_digests_only_no_raw_data_credentials_headers_urls_or_provider_responses',
    checks,
    ...(verification ? { verification } : {}),
    passed: checks.every((entry) => entry.passed),
  };
}

function runCommands() {
  const specs = [
    ['second-wave-test', 'node', ['--test', 'test/g0-second-wave.test.mjs', 'test/g0-first-wave.test.mjs', 'test/delivery-manifest.test.mjs', 'test/scientific-replay-package.test.mjs']],
    ['root-test', 'npm', ['test']],
    ['frontend-test', 'npm', ['test', '--prefix', 'frontend']],
    ['frontend-build', 'npm', ['run', 'build', '--prefix', 'frontend']],
    ['root-check', 'npm', ['run', 'check']],
    ['scientific-replay', 'npm', ['run', 'harness:scientific-task:replay:test']],
    ['hle-production', 'npm', ['run', 'harness:loop:production']],
  ];
  return specs.map(([label, bin, args]) => {
    const result = spawnSync(bin, args, {
      cwd: repoRoot,
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
      stdoutSha256: sha(result.stdout || ''),
      stderrSha256: sha(result.stderr || ''),
    };
  });
}

function updateEvidence() {
  const verification = { generatedAt: new Date().toISOString(), commands: runCommands() };
  const report = inspect(verification);
  report.generatedAt = verification.generatedAt;
  if (!report.passed) {
    const failed = report.checks.filter((entry) => !entry.passed).map((entry) => entry.id);
    const commands = verification.commands.filter((entry) => !entry.passed).map((entry) => `${entry.label}(exit=${entry.exitCode})`);
    throw new Error(`cannot write failed evidence: ${[...failed, ...commands].join(', ')}`);
  }
  mkdirSync(dirname(evidencePath), { recursive: true });
  writeFileSync(evidencePath, `${JSON.stringify(report, null, 2)}\n`);
  console.log('[G0-SECOND-WAVE] PASS — evidence updated');
}

function verifyEvidence() {
  if (process.env.G0_SECOND_WAVE_BOOTSTRAP === '1') {
    const report = inspect(null, true);
    if (!report.passed) throw new Error(report.checks.filter((entry) => !entry.passed).map((entry) => entry.id).join(', '));
    console.log('[G0-SECOND-WAVE] PASS (bootstrap current gate)');
    return;
  }
  if (!existsSync(evidencePath)) throw new Error('evidence missing; run npm run g0:second-wave:update');
  const stored = JSON.parse(readFileSync(evidencePath, 'utf8'));
  if (!isAncestor(stored.sourceCommit)) throw new Error('evidence source commit is not an ancestor of HEAD');
  if (stored.baseline?.bundleDigest !== g0.getCurrentG0Baseline().bundleDigest) throw new Error('baseline changed without refreshed evidence/version');
  const current = inspect(stored.verification);
  if (!stored.passed || !current.passed) throw new Error(current.checks.filter((entry) => !entry.passed).map((entry) => entry.id).join(', '));
  console.log('[G0-SECOND-WAVE] PASS — 12/12');
}

try {
  if (process.argv.includes('--write-evidence')) updateEvidence();
  else verifyEvidence();
} catch (error) {
  console.error(`[G0-SECOND-WAVE] FAIL — ${error.message}`);
  process.exitCode = 1;
}
