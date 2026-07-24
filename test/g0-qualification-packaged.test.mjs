import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

import { evaluatePackagedReport } from '../scripts/g0-qualification-packaged.mjs';
const require = createRequire(import.meta.url);
const { normalizeBuilderArch } = require('../build/afterPack.js');

function report(overrides = {}) {
  return {
    sourceCommit: 'a'.repeat(40),
    baseline: { bundleDigest: 'b'.repeat(64) },
    architecture: 'arm64',
    executableArchitectures: ['arm64'],
    codeSignatureVerified: true,
    executableSha256: 'c'.repeat(64),
    resourceBundleSha256: 'd'.repeat(64),
    buildSubjectSha256: 'e'.repeat(64),
    resourceChecksPassed: 5,
    resourceChecksTotal: 5,
    launchCount: 2,
    taskCyclesCompleted: 2,
    artifacts: {
      artifactManifests: 2,
      params: 2,
      provenance: 2,
      independentScripts: 2,
      htmlReports: 2,
    },
    persistence: { projectsBeforeRestart: 2, projectsAfterRestart: 2 },
    health: { passed: 120, failed: 0 },
    shutdown: [{ backendStopped: true }, { backendStopped: true }],
    observationMs: 300000,
    ...overrides,
  };
}

test('packaged qualification requires build binding, real artifact truth and restart persistence', () => {
  const verdict = evaluatePackagedReport(report(), {
    minimumTaskCycles: 2,
    minimumObservationMs: 300000,
    minimumHealthSamples: 60,
  });
  assert.equal(verdict.passed, true, JSON.stringify(verdict.checks));
});

test('packaged qualification rejects false completion and privacy leakage', () => {
  const falseCompletion = evaluatePackagedReport(report({
    artifacts: { artifactManifests: 0, params: 2, provenance: 2, independentScripts: 2, htmlReports: 2 },
  }));
  assert.equal(falseCompletion.passed, false);
  assert.equal(falseCompletion.checks.artifactTruth, false);

  const leaked = evaluatePackagedReport(report({ note: '/Users/person/private/input.csv' }));
  assert.equal(leaked.passed, false);
  assert.equal(leaked.checks.privacy, false);
});

test('electron-builder architecture enum is recorded without ambiguity', () => {
  assert.equal(normalizeBuilderArch(0), 'x64');
  assert.equal(normalizeBuilderArch(3), 'arm64');
  assert.equal(normalizeBuilderArch(4), 'universal');
});
