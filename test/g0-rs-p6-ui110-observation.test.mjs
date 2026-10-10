import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import test from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { P5_SOURCE_FILES } from '../scripts/g0-rs-p5-acceptance.mjs';
import {
  P6_UI110_REQUIRED_CAPABILITY,
  P6_UI110_SOURCE_FILES,
  P6_UI110_SOURCE_SENTINELS,
  assertP6Ui110EvidenceWritable,
  assertSanitizedP6Ui110Evidence,
  buildP6Ui110ObjectBinding,
  getP6Ui110SourceBinding,
  inspectP6Ui110LocalCapability,
  stageP6Ui110LocalCapability,
  verifyP6Ui110ArtifactBytes,
  writeP6Ui110Evidence,
} from '../scripts/g0-rs-p6-ui110-observation.mjs';

const require = createRequire(import.meta.url);
const { computeExecutionProvenanceHash } = require('../core/shared-backend/execution-provenance.js');

function sourceBoundEvidence(overrides = {}) {
  return {
    schemaVersion: 1,
    qualificationEligible: false,
    classification: 'development_real_renderer_deterministic_local_adapter_non_provider_non_packaged',
    sourceCommitMatchesSourceHashes: true,
    sourceBindingStableDuringObservation: true,
    sourceMismatches: [],
    passed: true,
    ...overrides,
  };
}

test('P6 UI-110 source binding contains the complete P5 base and independent P6 sentinels', () => {
  for (const [key, file] of Object.entries(P5_SOURCE_FILES)) {
    assert.equal(P6_UI110_SOURCE_FILES[key], file, `P5 source ${key} must remain bound by P6`);
  }

  const boundPaths = new Set(Object.values(P6_UI110_SOURCE_FILES));
  for (const required of [
    'scripts/g0-rs-p6-ui110-observation.mjs',
    'scripts/g0-rs-p6-ui110-driver.cjs',
    'scripts/g0-rs-p6-ui110-local-gateway.mjs',
    'test/result-studio-route-baseline.test.mjs',
    'src/preload.js',
    'core/petri-server/routes/ai-agent.js',
    'core/petri-server/agent-runner.js',
    'core/shared-backend/redaction.js',
    'test/diagnostic-redaction.test.mjs',
    'frontend/src/pages/project-workspace.tsx',
    'frontend/src/components/result-studio/activeArtifactProjection.ts',
    'frontend/src/components/result-studio/activeArtifactProjection.test.ts',
    'frontend/src/components/result-studio/ResultAgentComposer.tsx',
    'frontend/src/components/copilot/copilotClient.ts',
  ]) {
    assert.ok(boundPaths.has(required), `P6 source binding is missing ${required}`);
  }
  assert.equal(
    Object.keys(P6_UI110_SOURCE_FILES).length,
    Object.keys(P5_SOURCE_FILES).length + Object.keys(P6_UI110_SOURCE_SENTINELS).length,
  );
  assert.equal(boundPaths.size, Object.keys(P6_UI110_SOURCE_FILES).length,
    'source binding must not hide duplicate aliases');

  const binding = getP6Ui110SourceBinding();
  assert.equal(Object.keys(binding.sourceHashes).length, Object.keys(P6_UI110_SOURCE_FILES).length);
  assert.match(binding.sourceCommit, /^[a-f0-9]{40}$/);
  assert.match(binding.bindingDigest, /^[a-f0-9]{64}$/);
});

test('P6 UI-110 evidence sanitizer blocks runtime coordinates and secret-shaped values', () => {
  assert.equal(assertSanitizedP6Ui110Evidence(sourceBoundEvidence()), true);
  for (const unsafe of [
    { endpoint: 'http://127.0.0.1:3001/api' },
    { workspace: '/Users/example/private' },
    { revision: 'rev_private123' },
    { apiKey: 'private' },
    { relativePath: '../outside' },
  ]) {
    assert.throws(() => assertSanitizedP6Ui110Evidence(unsafe), /unsafe|leaked/);
  }
});

test('P6 UI-110 stage bindings are order independent and do not expose product identifiers', () => {
  const first = buildP6Ui110ObjectBinding({
    changeSetId: 'cs_private',
    candidateArtifactRefs: ['rev_b', 'rev_a'],
    jobRefs: ['tj_b', 'tj_a'],
    status: 'preview_ready',
  });
  const later = buildP6Ui110ObjectBinding({
    change_set_id: 'cs_private',
    candidate_artifact_refs_json: JSON.stringify(['rev_a', 'rev_b']),
    job_refs_json: JSON.stringify(['tj_a', 'tj_b']),
    status: 'adopted',
  });
  assert.equal(first.objectDigest, later.objectDigest);
  assert.equal(first.revisionSetDigest, later.revisionSetDigest);
  assert.equal(first.jobSetDigest, later.jobSetDigest);
  assert.equal(first.status, 'preview_ready');
  assert.equal(later.status, 'adopted');
  assert.equal(assertSanitizedP6Ui110Evidence({ first, later }), true);
  assert.doesNotMatch(JSON.stringify({ first, later }), /(?:cs|rev|tj)_private/);

  const scalar = buildP6Ui110ObjectBinding({
    changeSetId: 'cs_scalar',
    candidateArtifactRefs: 'rev_scalar',
    jobRefs: 'tj_scalar',
    status: 'preview_ready',
  });
  assert.equal(scalar.revisionCount, 1, 'R auto_unboxed one-element identifier sets must stay exact');
  assert.equal(scalar.jobCount, 1);
});

test('P6 UI-110 verifies physical Artifact bytes against Revision and execution provenance', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'p6-ui110-artifact-test-'));
  try {
    const relative = 'results/jobs/candidate/volcano.png';
    const target = path.join(root, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    const bytes = Buffer.from('physical-artifact-bytes');
    writeFileSync(target, bytes);
    const digest = createHash('sha256').update(bytes).digest('hex');
    const revision = {
      artifactId: 'volcano',
      projectId: 'project_1',
      outputPath: relative,
      outputHash: digest,
    };
    const provenance = {
      executionProvenanceVersion: 1,
      toolJobId: 'job_1',
      projectId: 'project_1',
      inputs: [],
      artifacts: [{ id: 'volcano', sha256: digest }],
    };
    provenance.provenanceHash = computeExecutionProvenanceHash(provenance);
    const job = {
      id: 'job_1',
      result: {
        artifactTruth: { status: 'valid', blocking: false },
        artifacts: [{ id: 'volcano', path: target, sha256: digest }],
        executionProvenance: provenance,
      },
    };
    const verified = verifyP6Ui110ArtifactBytes({ workspaceRoot: root, revision, job });
    assert.equal(verified.exact, true);
    assert.equal(verified.physicalSha256, digest);

    const drifted = verifyP6Ui110ArtifactBytes({
      workspaceRoot: root,
      revision: { ...revision, outputHash: 'f'.repeat(64) },
      job,
    });
    assert.equal(drifted.exact, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('P6 UI-110 evidence writer requires a current source binding and passing trace', () => {
  const writes = [];
  const receipt = writeP6Ui110Evidence(sourceBoundEvidence(), {
    makeDirectory() {},
    write: (...args) => writes.push(args),
  });
  assert.equal(writes.length, 1);
  assert.match(writes[0][0], /rs-p6-ui110-electron-scientific-trace\.json$/);
  assert.equal(receipt.bytes, Buffer.byteLength(writes[0][1]));
  assert.match(receipt.digest, /^[a-f0-9]{64}$/);
  assert.throws(
    () => assertP6Ui110EvidenceWritable(sourceBoundEvidence({ sourceCommitMatchesSourceHashes: false })),
    (error) => error.code === 'p6_ui110_source_binding_not_current',
  );
  assert.throws(
    () => assertP6Ui110EvidenceWritable(sourceBoundEvidence({ passed: false })),
    (error) => error.code === 'p6_ui110_evidence_not_passed',
  );
  assert.throws(
    () => assertP6Ui110EvidenceWritable(sourceBoundEvidence({ sourceBindingStableDuringObservation: false })),
    (error) => error.code === 'p6_ui110_source_binding_changed_during_observation',
  );
});

test('P6 UI-110 stages only a verified preprovisioned local enrichment capability', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'p6-ui110-capability-test-'));
  try {
    const sourceRuntimes = path.join(root, 'source-runtimes');
    const sourceInstall = path.join(sourceRuntimes, 'capabilities', 'r-enrichment', '1.0.0');
    mkdirSync(sourceInstall, { recursive: true });
    writeFileSync(path.join(sourceInstall, 'bundle-manifest.json'), JSON.stringify({
      bundleId: P6_UI110_REQUIRED_CAPABILITY.capabilityId,
      bundleVersion: P6_UI110_REQUIRED_CAPABILITY.version,
      platform: P6_UI110_REQUIRED_CAPABILITY.platform,
      packageCount: 129,
    }));
    writeFileSync(path.join(sourceInstall, 'sentinel.txt'), 'local-only');
    writeFileSync(path.join(sourceRuntimes, 'harness-provisioning.json'), JSON.stringify({
      schemaVersion: 1,
      capabilities: {
        'r-enrichment': {
          version: P6_UI110_REQUIRED_CAPABILITY.version,
          sha256: P6_UI110_REQUIRED_CAPABILITY.sha256,
        },
      },
    }));

    const inspected = inspectP6Ui110LocalCapability(sourceRuntimes);
    assert.deepEqual({
      ready: inspected.ready,
      capabilityId: inspected.capabilityId,
      version: inspected.version,
      sha256: inspected.sha256,
      packageCount: inspected.packageCount,
    }, {
      ready: true,
      capabilityId: 'r-enrichment',
      version: '1.0.0',
      sha256: P6_UI110_REQUIRED_CAPABILITY.sha256,
      packageCount: 129,
    });

    const targetData = path.join(root, 'target-data');
    const staged = stageP6Ui110LocalCapability({ PETRI_LOCAL_DATA_DIR: targetData }, sourceRuntimes);
    assert.equal(staged.ready, true);
    assert.equal(staged.source, 'verified_preprovisioned_local_dependency');
    assert.equal(staged.networkAccessDuringTrace, 'none');
    assert.equal(
      inspectP6Ui110LocalCapability(path.join(targetData, 'runtimes')).ready,
      true,
    );
    assert.throws(
      () => inspectP6Ui110LocalCapability(path.join(root, 'missing-runtimes')),
      /p6_ui110_local_capability_root_missing/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
