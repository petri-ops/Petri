import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const evidence = require('../core/shared-backend/result-studio-evidence-bundle');

function fixture(run) {
  const root = mkdtempSync(path.join(tmpdir(), 'biof3-p7-evidence-'));
  try { return run(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

function ref(seed) {
  return evidence.stableHash({ seed });
}

function validFactPackage(taskId = 'volcano_ai_presentation_edit', seed = 'one') {
  const journeyId = `journey-${seed}`;
  const scopeDigest = ref(`scope-${seed}`);
  const contextRef = ref(`context-${seed}`);
  const selectionRef = ref(`selection-${seed}`);
  const sourceRevisionRef = ref(`source-revision-${seed}`);
  const intentRef = ref(`intent-${seed}`);
  const changeSetRef = ref(`changeset-${seed}`);
  const jobRef = ref(`job-${seed}`);
  const revisionRefs = [ref(`revision-${seed}`)];
  const artifactRefs = [ref(`artifact-${seed}`)];
  const hashTruth = { [artifactRefs[0]]: ref(`artifact-bytes-${seed}`) };
  const base = {
    taskId,
    journeyId,
    scopeDigest,
    observedAt: '2026-08-03T08:30:00.000Z',
  };
  const facts = {};
  const add = (id, kind, role, payload) => { facts[id] = { id, kind, role, ...base, payload }; };
  add('conversation', 'conversation_event', 'conversation.record', { conversationRef: ref(`conversation-${seed}`) });
  add('open', 'ui_event', 'ui.open_artifact', { artifactRef: artifactRefs[0], postconditionObserved: true });
  add('selection', 'ui_event', 'ui.selection_or_manual_edit', { selectionRef, postconditionObserved: true });
  add('repository', 'git_record', 'environment.repository', {
    mode: 'managed', initialState: 'non_git', consentObserved: false,
    snapshotBefore: ref(`repository-${seed}`), snapshotAfter: ref(`repository-${seed}`),
  });
  add('context', 'context_snapshot', 'agent.context_envelope', { contextRef, selectionRef, sourceRevisionRef });
  add('provider', 'provider_tool_call', 'provider.result_tool_roundtrip', {
    transport: 'real_network', toolCallObserved: true, toolResultObserved: true,
    expectedJsonEmbeddedInPrompt: false, toolName: 'result_edit_from_context', providerClass: 'deepseek',
  });
  add('intent', 'database_record', 'sqlite.intent', { contextRef, selectionRef, sourceRevisionRef, intentRef });
  add('changeset', 'database_record', 'sqlite.changeset', {
    intentRef, changeSetRef, jobRefs: [jobRef], candidateRevisionRefs: revisionRefs,
    sourceRevisionRefs: [sourceRevisionRef],
  });
  add('changeset-git', 'git_record', 'git.changeset', { changeSetRef, commit: 'a'.repeat(40) });
  add('job', 'database_record', 'sqlite.job', {
    jobRef, changeSetRef, formalArtifactRefs: artifactRefs, outputRevisionRefs: revisionRefs,
    status: 'completed', falseSuccessAbsent: true,
  });
  add('artifact', 'artifact_truth', 'artifact.formal_output_cohort', {
    jobRef, changeSetRef, artifactRefs, revisionRefs,
    declaredHashes: hashTruth, provenanceHashes: hashTruth, physicalHashes: hashTruth,
    scriptHashes: { [artifactRefs[0]]: ref(`script-${seed}`) },
  });
  add('validator', 'validator_record', 'validator.cohort', { valid: true, revisionRefs });
  add('revisions', 'database_record', 'sqlite.candidate_revision_cohort', {
    changeSetRef, revisionRefs, artifactRefs,
  });
  add('revisions-git', 'git_record', 'git.candidate_revision_cohort', {
    changeSetRef, commit: 'a'.repeat(40), revisionRefs,
  });
  add('compare', 'ui_event', 'ui.compare', {
    sourceRevisionRefs: [sourceRevisionRef], candidateRevisionRefs: revisionRefs, postconditionObserved: true,
  });
  add('lifecycle', 'database_record', 'sqlite.lifecycle', {
    changeSetRef, revisionRefs, operation: 'adopt', completeCohort: true,
  });
  add('lifecycle-git', 'git_record', 'git.lifecycle', {
    changeSetRef, commit: 'a'.repeat(40), revisionRefs,
  });
  add('restart', 'restart_event', 'restart.reopen', {
    oldProcessExited: true, packagedAppReopened: true, activeTaskInterrupted: true,
    literalOsRebootObserved: true, bootSessionChanged: true,
    historyDigestBefore: ref(`history-${seed}`), historyDigestAfter: ref(`history-${seed}`),
    sourceDataDigestBefore: ref(`source-${seed}`), sourceDataDigestAfter: ref(`source-${seed}`),
    artifactSetDigestBefore: ref(`artifact-set-${seed}`), artifactSetDigestAfter: ref(`artifact-set-${seed}`),
  });
  add('replay', 'replay_record', 'replay.exact', {
    sourceRevisionRefs: revisionRefs, replayRevisionRefs: [ref(`replay-${seed}`)],
    exactMatch: true, graphExact: true, packageDigest: ref(`replay-package-${seed}`),
    outputCohortHash: ref(`replay-output-${seed}`),
  });
  const factPackage = {
    schemaVersion: evidence.FACT_PACKAGE_SCHEMA_VERSION,
    packageId: `fact-package-${seed}`,
    journeyId,
    taskId,
    projectRefHash: ref(`project-${seed}`),
    conversationRefHash: ref(`conversation-${seed}`),
    primaryOperationDigest: scopeDigest,
    startedAt: '2026-08-03T08:00:00.000Z',
    completedAt: '2026-08-03T09:00:00.000Z',
    facts,
    attachments: {},
  };
  factPackage.packageDigest = evidence.stableHash(factPackage);
  return factPackage;
}

test('P7 evidence manifest re-hashes the exact regular-file set', () => fixture((root) => {
  mkdirSync(path.join(root, 'facts'));
  writeFileSync(path.join(root, 'facts/task.json'), '{"ok":true}\n');
  writeFileSync(path.join(root, 'screen.png'), Buffer.concat([
    Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'),
    Buffer.from('0000033400000200', 'hex'),
  ]));
  const manifest = evidence.buildBundleManifest(root);
  writeFileSync(path.join(root, 'manifest.json'), `${JSON.stringify(manifest)}\n`);
  assert.deepEqual(evidence.verifyBundleManifest(root, manifest), { valid: true, issues: [] });

  writeFileSync(path.join(root, 'facts/task.json'), '{"ok":false}\n');
  assert.equal(evidence.verifyBundleManifest(root, manifest).valid, false);
}));

test('P7 evidence refs resolve file bytes or exact JSON Pointer values', () => fixture((root) => {
  mkdirSync(path.join(root, 'facts'));
  writeFileSync(path.join(root, 'facts/task.json'), JSON.stringify({ task: { status: 'completed', ids: ['a', 'b'] } }));
  const pointed = evidence.resolveEvidenceRef(root, 'facts/task.json#/task');
  assert.deepEqual(pointed.value, { status: 'completed', ids: ['a', 'b'] });
  assert.equal(pointed.digest, evidence.stableHash(pointed.value));
  const bytes = evidence.resolveEvidenceRef(root, 'facts/task.json');
  assert.equal(bytes.value, null);
  assert.equal(bytes.digest, evidence.sha256Bytes(bytes.bytes));
  assert.throws(() => evidence.resolveEvidenceRef(root, '../outside.json'), /ref_unsafe/);
  assert.throws(() => evidence.resolveEvidenceRef(root, 'facts/task.json#/missing'), /pointer_missing/);
}));

test('P7 evidence bundles reject symlinks and parse PNG dimensions from bytes', () => fixture((root) => {
  writeFileSync(path.join(root, 'target.txt'), 'target');
  symlinkSync(path.join(root, 'target.txt'), path.join(root, 'alias.txt'));
  assert.throws(() => evidence.buildBundleManifest(root), /symlink_forbidden/);
  const png = Buffer.concat([
    Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'),
    Buffer.from('000005a000000384', 'hex'),
  ]);
  assert.deepEqual(evidence.parsePngSize(png), { width: 1440, height: 900 });
  assert.throws(() => evidence.parsePngSize(Buffer.from('not-png')), /png_invalid/);
}));

test('P7 fact packages recompute the complete task-local scientific join', () => {
  const factPackage = validFactPackage();
  assert.deepEqual(evidence.validateFactPackage(factPackage).issues, []);

  const partialAdopt = structuredClone(factPackage);
  partialAdopt.facts.lifecycle.payload.revisionRefs = [];
  partialAdopt.packageDigest = evidence.stableHash(Object.fromEntries(
    Object.entries(partialAdopt).filter(([key]) => key !== 'packageDigest'),
  ));
  const verdict = evidence.validateFactPackage(partialAdopt);
  assert.equal(verdict.valid, false);
  assert.ok(verdict.issues.includes('fact_lifecycle_cohort_invalid'));
});

test('P7 independent evidence verification resolves facts, re-hashes PNGs and rejects reuse', () => fixture((root) => {
  mkdirSync(path.join(root, 'facts'));
  mkdirSync(path.join(root, 'screenshots'));
  const factPackage = validFactPackage();
  writeFileSync(path.join(root, 'facts/volcano.json'), `${JSON.stringify(factPackage)}\n`);
  const fact = evidence.resolveEvidenceRef(root, 'facts/volcano.json#/facts/context');
  const trace = {
    traceId: 'trace-volcano-one',
    taskId: factPackage.taskId,
    projectRefHash: factPackage.projectRefHash,
    conversationRefHash: factPackage.conversationRefHash,
    primaryOperationDigest: factPackage.primaryOperationDigest,
    factPackageRef: 'facts/volcano.json#',
    providerClass: 'deepseek',
    evidence: [
      { id: 'context', kind: 'context_snapshot', sourceRef: 'facts/volcano.json#/facts/context', digest: fact.digest },
    ],
  };
  const reportEvidence = [];
  const responsiveMatrix = [];
  let ordinal = 0;
  for (const theme of ['light', 'dark']) {
    for (const width of [1440, 1024, 820]) {
      const png = Buffer.concat([
        Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'),
        Buffer.from('000005a000000384', 'hex'),
        Buffer.from([ordinal]),
      ]);
      const id = `screen-${theme}-${width}`;
      const relative = `screenshots/${theme}-${width}.png`;
      writeFileSync(path.join(root, relative), png);
      reportEvidence.push({
        id, kind: 'screenshot', sourceRef: relative, digest: evidence.sha256Bytes(png),
        width: 1440, height: 900, theme, viewportWidth: width,
      });
      responsiveMatrix.push({
        theme, width, screenshotEvidenceId: id, canvasVisible: true, operationCompleted: true,
        operationPostconditionObserved: true, horizontalOverflow: false, firstCanvasMs: 800,
      });
      ordinal += 1;
    }
  }
  const report = { productTraces: [trace], evidence: reportEvidence, responsiveMatrix };
  const manifest = evidence.buildBundleManifest(root);
  assert.deepEqual(evidence.verifyQualificationEvidence(root, report, manifest).issues, []);

  const copied = structuredClone(trace);
  copied.traceId = 'trace-volcano-copy';
  const reused = evidence.verifyQualificationEvidence(root, { ...report, productTraces: [trace, copied] }, manifest);
  assert.equal(reused.valid, false);
  assert.ok(reused.issues.some((issue) => issue.startsWith('trace_primary_operation_reused:')));
  assert.ok(reused.issues.some((issue) => issue.startsWith('trace_replay_source_reused:')));

  const leaked = structuredClone(factPackage);
  leaked.facts.context.payload.privatePath = '/Users/example/private/result.csv';
  leaked.packageDigest = evidence.stableHash(Object.fromEntries(
    Object.entries(leaked).filter(([key]) => key !== 'packageDigest'),
  ));
  writeFileSync(path.join(root, 'facts/volcano.json'), `${JSON.stringify(leaked)}\n`);
  const leakedManifest = evidence.buildBundleManifest(root);
  const privateVerdict = evidence.verifyQualificationEvidence(root, report, leakedManifest);
  assert.equal(privateVerdict.privacyClean, false);
  assert.ok(privateVerdict.issues.some((issue) => issue.startsWith('private_projection_forbidden_value:')));
}));
