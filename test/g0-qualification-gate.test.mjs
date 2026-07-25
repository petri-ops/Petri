import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateQualificationGate } from '../scripts/g0-qualification-gate.mjs';

const classIds = Array.from({ length: 16 }, (_, index) => `class-${index}`);
const zeroIds = Array.from({ length: 10 }, (_, index) => `ZT-${String(index + 1).padStart(2, '0')}`);

function fixture() {
  const subject = {
    baselineId: 'g0-fifth-wave-establishing-0.6',
    baselineVersion: '0.6.0',
    manifestDigest: 'a'.repeat(64),
    bundleDigest: 'b'.repeat(64),
  };
  const decisionHash = 'c'.repeat(64);
  const ledgerHash = 'd'.repeat(64);
  const sourceCommit = 'e'.repeat(40);
  return {
    baselineValidation: { ok: true },
    currentBaseline: { baselineVersion: '1.1.1', lifecycleStatus: 'maintained', qualificationStatus: 'qualified' },
    subjectBaseline: subject,
    qualificationManifest: { bundleDigest: subject.bundleDigest },
    ledger: {
      classStatus: Object.fromEntries(classIds.map((id) => [id, 'satisfied'])),
      zeroToleranceObservations: zeroIds.map((id) => ({ id, violations: 0 })),
      zeroToleranceIntegrityIssues: [],
      invalidEntryCount: 0,
      ledgerHash,
    },
    decision: {
      state: 'qualified',
      blockers: [],
      limitedClaims: [],
      unsupportedClaims: [],
      decisionHash,
      sourceCommit,
      bundleDigest: subject.bundleDigest,
    },
    supportMatrix: {
      platforms: [{ id: 'macos-arm64', status: 'qualified' }, { id: 'windows-x64', status: 'unavailable' }],
      providers: [{ id: 'deepseek', status: 'qualified' }, { id: 'openai-compatible', status: 'qualified' }],
      runtimes: [{ id: 'node-local', status: 'qualified' }, { id: 'r-local', status: 'qualified' }, { id: 'python-local', status: 'qualified' }],
      plugins: [{ id: 'deseq2', status: 'qualified' }],
      productCapabilities: [{ id: 'result-studio-editing', status: 'experimental' }],
    },
    baselineManifest: {
      executionTruthChain: ['run_tool', 'tool_job', 'artifact_truth'],
      qualification: { decisionState: 'qualified', decisionHash, ledgerHash, sourceCommit, qualifiedFrom: subject },
    },
    commandGates: Array.from({ length: 6 }, (_, index) => ({ id: `gate-${index}`, passed: true })),
  };
}

test('permanent gate accepts only the complete maintained qualification', async () => {
  const input = fixture();
  // The production evaluator uses the contract class IDs; mirror them here.
  const qualification = await import('../core/shared-backend/g0/qualification-manifest.json', { with: { type: 'json' } });
  input.ledger.classStatus = Object.fromEntries(
    qualification.default.requiredEvidenceClasses.map(({ id }) => [id, 'satisfied']),
  );
  const verdict = evaluateQualificationGate(input);
  assert.equal(verdict.passed, true, JSON.stringify(verdict.checks));
});

test('permanent gate rejects stale, incomplete or non-zero qualification truth', async () => {
  const input = fixture();
  const qualification = await import('../core/shared-backend/g0/qualification-manifest.json', { with: { type: 'json' } });
  input.ledger.classStatus = Object.fromEntries(
    qualification.default.requiredEvidenceClasses.map(({ id }) => [id, 'satisfied']),
  );
  input.ledger.zeroToleranceObservations[0].violations = 1;
  input.decision.blockers.push('mandatory_evidence_stale:packaged_app');
  input.baselineManifest.qualification.decisionHash = 'f'.repeat(64);
  const verdict = evaluateQualificationGate(input);
  assert.equal(verdict.passed, false);
  assert.equal(verdict.checks.zeroTolerance, false);
  assert.equal(verdict.checks.qualificationDecision, false);
  assert.equal(verdict.checks.promotionBinding, false);
});
