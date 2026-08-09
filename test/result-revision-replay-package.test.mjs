import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  buildResultRevisionReplayPackage,
  hashFile,
  validateScientificReplayPackage,
} = require('../core/shared-backend/scientific-replay-package');

test('adopted Result Studio Revision exports a database-free package with exact input and output cohort hashes', (context) => {
  const projectRoot = mkdtempSync(path.join(tmpdir(), 'biof3-result-revision-package-'));
  const handoffRoot = mkdtempSync(path.join(tmpdir(), 'biof3-result-revision-handoff-'));
  context.after(() => rmSync(projectRoot, { recursive: true, force: true }));
  context.after(() => rmSync(handoffRoot, { recursive: true, force: true }));

  const inputPath = path.join(projectRoot, 'inputs', 'counts.csv');
  const outputPath = path.join(projectRoot, 'results', 'jobs', 'job_candidate', 'output', 'deg_table.csv');
  const reportPath = path.join(projectRoot, 'results', 'jobs', 'job_candidate', 'output', 'run-report.html');
  const scriptPath = path.join(projectRoot, '.biof3', 'revision', 'cs_candidate', 'run-script.R');
  mkdirSync(path.dirname(inputPath), { recursive: true });
  mkdirSync(path.dirname(outputPath), { recursive: true });
  mkdirSync(path.dirname(scriptPath), { recursive: true });
  writeFileSync(inputPath, 'gene,s1,s2\nTP53,10,20\n');
  writeFileSync(outputPath, 'gene,log2FoldChange,padj\nTP53,1.5,0.01\n');
  writeFileSync(reportPath, '<html><body>intermediate report</body></html>\n');
  writeFileSync(scriptPath, 'message("revision replay")\n');

  const inputHash = hashFile(inputPath);
  const outputHash = hashFile(outputPath);
  const reportHash = hashFile(reportPath);
  const scriptHash = hashFile(scriptPath);
  const normalized = {
    counts: { inputRef: 'inputs/counts.csv', sha256: inputHash },
    padj_cutoff: 0.05,
  };
  const provenance = {
    executionProvenanceVersion: 1,
    provenanceHash: 'a'.repeat(64),
    toolJobId: 'job_candidate',
    projectId: 'project_1',
    plugin: { id: 'deseq2', version: '1.0.0', language: 'r' },
    runtime: { name: 'R', version: '4.5.2', readiness: true },
    params: { normalized },
    inputs: [{ id: 'counts', role: 'counts', relativePath: 'inputs/counts.csv', sha256: inputHash }],
    script: { snapshotPath: scriptPath, sha256: scriptHash, entryPoint: 'run-script.R' },
    artifacts: [
      { id: 'deg_table', filename: 'deg_table.csv', sha256: outputHash },
      { id: 'run_report', filename: 'run-report.html', sha256: reportHash },
    ],
  };
  const job = {
    id: 'job_candidate',
    project_id: 'project_1',
    tool_id: 'deseq2',
    status: 'completed',
    params: { counts: inputPath, padj_cutoff: 0.05 },
    result: {
      artifactTruth: { status: 'valid', blocking: false },
      executionProvenance: provenance,
      artifacts: [
        {
          id: 'deg_table',
          type: 'table',
          label: 'DEG table',
          path: outputPath,
          provenance: { provenanceHash: provenance.provenanceHash },
        },
        {
          id: 'run_report',
          type: 'report',
          label: 'Intermediate report',
          path: reportPath,
          provenance: { provenanceHash: provenance.provenanceHash },
        },
      ],
    },
  };
  const revision = {
    revisionId: 'rev_candidate',
    projectId: 'project_1',
    artifactFamilyId: 'family_deg',
    artifactId: 'deg_table',
    changeSetId: 'cs_candidate',
    toolJobId: job.id,
    sourceCommit: 'b'.repeat(40),
    outputHash,
  };
  const changeSet = {
    changeSetId: 'cs_candidate',
    projectId: 'project_1',
    conversationId: 'conversation_1',
    status: 'adopted',
  };
  const packageDir = path.join(outputPath, '..', 'replay-package');
  const built = buildResultRevisionReplayPackage({
    revision,
    changeSet,
    job,
    projectRoot,
    packageDir,
    workflowGraph: {
      graphId: 'wfg_123',
      contractVersion: 1,
      sourceDigest: 'c'.repeat(64),
      rootToolJobId: job.id,
      nodes: [{ id: `job:${job.id}`, toolJobId: job.id }],
      edges: [],
    },
    formalArtifactIds: ['deg_table'],
  });

  assert.equal(built.validation.ok, true);
  assert.equal(built.replay.privacyMode, 'project_bound_private');
  assert.equal(built.replay.replayPolicy.packagedProjectInputs, true);
  assert.deepEqual(built.outputCohort, [{ artifactId: 'deg_table', expectedHash: outputHash }]);
  assert.deepEqual(built.replay.artifacts.map((artifact) => artifact.sourceArtifactId), ['deg_table']);
  assert.deepEqual(
    JSON.parse(readFileSync(path.join(packageDir, 'artifact-manifest.json'), 'utf8')).artifacts.map((artifact) => artifact.id),
    ['deg_table'],
  );
  assert.deepEqual(
    JSON.parse(readFileSync(path.join(packageDir, 'delivery-manifest.json'), 'utf8')).artifacts.map((artifact) => artifact.id),
    ['deg_table', 'run_report'],
  );
  assert.equal(existsSync(path.join(packageDir, 'inputs', 'inputs', 'counts.csv')), true);
  assert.equal(JSON.parse(readFileSync(path.join(packageDir, 'workflow-plan.json'), 'utf8')).authority, 'sqlite_job_artifact_truth');

  const detachedPackage = path.join(handoffRoot, 'replay-package');
  cpSync(packageDir, detachedPackage, { recursive: true });
  rmSync(projectRoot, { recursive: true, force: true });
  assert.equal(validateScientificReplayPackage(detachedPackage).ok, true);
  assert.equal(hashFile(path.join(detachedPackage, 'inputs', 'inputs', 'counts.csv')), inputHash);
});

test('Result Studio ReplayPackage refuses candidate or failed Job truth', (context) => {
  const projectRoot = mkdtempSync(path.join(tmpdir(), 'biof3-result-revision-package-reject-'));
  context.after(() => rmSync(projectRoot, { recursive: true, force: true }));
  assert.throws(() => buildResultRevisionReplayPackage({
    revision: { revisionId: 'rev_1', projectId: 'p_1', changeSetId: 'cs_1', toolJobId: 'job_1' },
    changeSet: { changeSetId: 'cs_1', projectId: 'p_1', status: 'preview_ready' },
    job: { id: 'job_1', project_id: 'p_1', status: 'completed', result: {} },
    projectRoot,
    packageDir: path.join(projectRoot, 'package'),
  }), /requires_adopted_changeset/);
});
