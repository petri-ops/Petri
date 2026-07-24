#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = join(root, 'acceptance/g0-qualification/qualification-gate.json');
const require = createRequire(import.meta.url);
const g0 = require('../core/shared-backend/g0-baseline');
const qualification = require('../core/shared-backend/g0-baseline-qualification');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const readJson = (path) => JSON.parse(readFileSync(join(root, path), 'utf8'));
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

const commandSpecs = Object.freeze([
  ['audit', 'node', ['scripts/g0-qualification-audit.mjs']],
  ['offline', 'node', ['scripts/g0-qualification-offline.mjs']],
  ['provider', 'node', ['scripts/g0-qualification-provider.mjs']],
  ['packaged', 'node', ['scripts/g0-qualification-packaged.mjs']],
  ['soak', 'node', ['scripts/g0-qualification-soak.mjs']],
  ['visual', 'node', ['scripts/g0-qualification-visual.mjs']],
]);

function isAncestor(candidate, subject = 'HEAD') {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', candidate, subject], { cwd: root, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function runCommandGates() {
  return commandSpecs.map(([id, bin, args]) => {
    const result = spawnSync(bin, args, {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env },
    });
    return {
      id,
      command: [bin, ...args].join(' '),
      exitCode: result.status,
      signal: result.signal || null,
      passed: result.status === 0,
      stdoutSha256: sha256(result.stdout || ''),
      stderrSha256: sha256(result.stderr || ''),
    };
  });
}

export function evaluateQualificationGate({
  baselineValidation,
  currentBaseline,
  subjectBaseline,
  qualificationManifest,
  ledger,
  decision,
  supportMatrix,
  baselineManifest,
  commandGates = [],
} = {}) {
  const requiredClassIds = qualification.contract.requiredEvidenceClasses.map((item) => item.id);
  const zeroToleranceIds = qualification.contract.zeroToleranceInvariants.map((item) => item.id);
  const qualifiedFrom = baselineManifest?.qualification?.qualifiedFrom;
  const qualified = (group, id) => supportMatrix?.[group]?.find((item) => item.id === id)?.status === 'qualified';
  const observations = new Map((ledger?.zeroToleranceObservations || []).map((item) => [item.id, item]));
  const checks = {
    baselineBundle: baselineValidation?.ok === true,
    maintainedQualified: currentBaseline?.baselineVersion === '1.0.0'
      && currentBaseline?.lifecycleStatus === 'maintained'
      && currentBaseline?.qualificationStatus === 'qualified',
    sealedSubject: subjectBaseline?.baselineId === qualification.contract.subjectBaselineId
      && subjectBaseline?.baselineVersion === qualification.contract.subjectBaselineVersion
      && subjectBaseline?.bundleDigest === qualifiedFrom?.bundleDigest
      && subjectBaseline?.manifestDigest === qualifiedFrom?.manifestDigest,
    qualificationDecision: decision?.state === 'qualified'
      && Array.isArray(decision?.blockers) && decision.blockers.length === 0
      && Array.isArray(decision?.limitedClaims) && decision.limitedClaims.length === 0
      && Array.isArray(decision?.unsupportedClaims) && decision.unsupportedClaims.length === 0,
    mandatoryEvidence: requiredClassIds.length === 16
      && requiredClassIds.every((id) => ledger?.classStatus?.[id] === 'satisfied'),
    zeroTolerance: zeroToleranceIds.length === 10
      && zeroToleranceIds.every((id) => observations.get(id)?.violations === 0)
      && (ledger?.zeroToleranceIntegrityIssues || []).length === 0,
    evidenceIntegrity: ledger?.invalidEntryCount === 0
      && /^[a-f0-9]{64}$/.test(String(ledger?.ledgerHash || '')),
    promotionBinding: baselineManifest?.qualification?.decisionState === 'qualified'
      && baselineManifest?.qualification?.decisionHash === decision?.decisionHash
      && baselineManifest?.qualification?.ledgerHash === ledger?.ledgerHash
      && baselineManifest?.qualification?.sourceCommit === decision?.sourceCommit
      && qualificationManifest?.bundleDigest === decision?.bundleDigest,
    supportBoundary: qualified('platforms', 'macos-arm64')
      && qualified('providers', 'deepseek')
      && qualified('providers', 'openai-compatible')
      && qualified('runtimes', 'node-local')
      && qualified('runtimes', 'r-local')
      && qualified('runtimes', 'python-local')
      && qualified('plugins', 'deseq2')
      && supportMatrix?.platforms?.find((item) => item.id === 'windows-x64')?.status === 'unavailable',
    singleExecutionTruth: baselineManifest?.executionTruthChain?.join(',') === 'run_tool,tool_job,artifact_truth',
    commandGates: commandGates.length === commandSpecs.length && commandGates.every((item) => item.passed),
  };
  return Object.freeze({ checks: Object.freeze(checks), passed: Object.values(checks).every(Boolean) });
}

function buildLiveReport() {
  const qualificationManifest = readJson('acceptance/g0-qualification/qualification-manifest.json');
  const ledger = readJson('acceptance/g0-qualification/evidence-ledger.json');
  const decision = readJson('acceptance/g0-qualification/qualification-decision.json');
  const commandGates = runCommandGates();
  const currentBaseline = g0.getCurrentG0Baseline();
  const subjectBaseline = g0.getQualificationSubjectBaseline();
  const verdict = evaluateQualificationGate({
    baselineValidation: g0.validateG0BaselineBundle(),
    currentBaseline,
    subjectBaseline,
    qualificationManifest,
    ledger,
    decision,
    supportMatrix: g0.supportMatrix,
    baselineManifest: g0.manifest,
    commandGates,
  });
  return {
    schemaVersion: 1,
    qualificationId: qualification.contract.qualificationId,
    sourceCommit: git('rev-parse', 'HEAD'),
    currentBaseline,
    subjectBaseline,
    decisionHash: decision.decisionHash,
    ledgerHash: ledger.ledgerHash,
    privacy: 'baseline_ids_digests_counts_booleans_and_command_output_hashes_only',
    commandGates,
    checks: verdict.checks,
    passed: verdict.passed,
    runnerSha256: sha256(readFileSync(fileURLToPath(import.meta.url))),
    generatedAt: new Date().toISOString(),
  };
}

function validateStored(liveReport) {
  if (!existsSync(evidencePath)) throw new Error('qualification_gate_evidence_missing');
  const stored = JSON.parse(readFileSync(evidencePath, 'utf8'));
  if (!stored.passed || !Object.values(stored.checks || {}).every(Boolean)) throw new Error('qualification_gate_not_passed');
  if (!isAncestor(stored.sourceCommit)) throw new Error('qualification_gate_source_not_ancestor');
  if (stored.currentBaseline?.bundleDigest !== liveReport.currentBaseline.bundleDigest) throw new Error('qualification_gate_baseline_stale');
  if (stored.subjectBaseline?.bundleDigest !== liveReport.subjectBaseline.bundleDigest) throw new Error('qualification_gate_subject_stale');
  if (stored.decisionHash !== liveReport.decisionHash || stored.ledgerHash !== liveReport.ledgerHash) {
    throw new Error('qualification_gate_decision_stale');
  }
  if (stored.runnerSha256 !== liveReport.runnerSha256) throw new Error('qualification_gate_runner_stale');
  return stored;
}

export function main(argv = process.argv.slice(2)) {
  try {
    const liveReport = buildLiveReport();
    if (!liveReport.passed) {
      const failed = Object.entries(liveReport.checks).filter(([, passed]) => !passed).map(([id]) => id);
      throw new Error(`qualification_gate_failed:${failed.join(',')}`);
    }
    if (argv.includes('--write-evidence')) {
      mkdirSync(dirname(evidencePath), { recursive: true });
      writeFileSync(evidencePath, `${JSON.stringify(liveReport, null, 2)}\n`);
      console.log('[G0-LF12] QUALIFIED + MAINTAINED — permanent evidence updated');
    } else if (argv.includes('--live')) {
      console.log('[G0-LF12] QUALIFIED + MAINTAINED — live gate passed');
    } else {
      validateStored(liveReport);
      console.log('[G0-LF12] QUALIFIED + MAINTAINED — permanent gate passed');
    }
  } catch (error) {
    console.error(`[G0-LF12] FAIL — ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
