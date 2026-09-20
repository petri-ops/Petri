import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const {
  buildAuthoritativeWorkflowGraph,
  isAuthoritativeWorkflowPlan,
  rebindWorkflowGraphForEquivalentRestore,
} = require('../core/shared-backend/result-workflow-graph');
const { computeExecutionProvenanceHash } = require('../core/shared-backend/execution-provenance');
const { createResultStudioRepository } = require('../core/shared-backend/result-studio-repository');

const HASH = Object.freeze({
  deg: 'a'.repeat(64),
  go: 'b'.repeat(64),
  selection: 'c'.repeat(64),
});

function signedProvenance(payload) {
  return { ...payload, provenanceHash: computeExecutionProvenanceHash(payload) };
}

function job({ id, toolId, artifactId, artifactHash, inputs = [] }) {
  return {
    id,
    project_id: 'p_1',
    tool_id: toolId,
    status: 'completed',
    result: {
      artifactTruth: { status: 'valid', blocking: false },
      artifacts: [{ id: artifactId, path: `/project/results/${id}/${artifactId}.csv` }],
      executionProvenance: signedProvenance({
        executionProvenanceVersion: 1,
        projectId: 'p_1',
        toolJobId: id,
        inputs,
        artifacts: [{ id: artifactId, sha256: artifactHash }],
      }),
    },
  };
}

function revision({ revisionId, toolJobId, artifactId, outputHash }) {
  return { revisionId, projectId: 'p_1', toolJobId, artifactId, outputHash };
}

function truth({ input = null, selection = null } = {}) {
  const revisions = new Map([
    ['rev_deg', revision({ revisionId: 'rev_deg', toolJobId: 'tj_deg', artifactId: 'deg_table', outputHash: HASH.deg })],
    ['rev_go', revision({ revisionId: 'rev_go', toolJobId: 'tj_go', artifactId: 'go_bp_results', outputHash: HASH.go })],
  ]);
  const jobs = [
    job({ id: 'tj_deg', toolId: 'deseq2', artifactId: 'deg_table', artifactHash: HASH.deg }),
    job({
      id: 'tj_go',
      toolId: 'go-kegg',
      artifactId: 'go_bp_results',
      artifactHash: HASH.go,
      inputs: input ? [input] : [],
    }),
  ];
  return {
    jobs,
    repository: {
      getRevision: (id) => revisions.get(id) || null,
      getSelection: (id) => id === 'sel_1' ? selection : null,
    },
  };
}

function artifactLineage(overrides = {}) {
  return {
    id: 'deg_table',
    sha256: HASH.deg,
    lineage: {
      lineageVersion: 1,
      kind: 'artifact',
      sourceRevisionId: 'rev_deg',
      sourceToolJobId: 'tj_deg',
      sourceArtifactId: 'deg_table',
      sourceOutputHash: HASH.deg,
      materializationHash: HASH.deg,
      ...overrides,
    },
  };
}

function selectionLineage(overrides = {}) {
  return {
    id: 'gene_list',
    sha256: HASH.go,
    lineage: {
      lineageVersion: 1,
      kind: 'selection',
      sourceRevisionId: 'rev_deg',
      sourceToolJobId: 'tj_deg',
      sourceArtifactId: 'deg_table',
      sourceOutputHash: HASH.deg,
      selectionId: 'sel_1',
      selectionHash: HASH.selection,
      materializationHash: HASH.go,
      ...overrides,
    },
  };
}

test('P5 derives a deterministic downstream DAG only from durable artifact lineage', () => {
  const { jobs, repository } = truth({ input: artifactLineage() });
  const first = buildAuthoritativeWorkflowGraph({ projectId: 'p_1', sourceToolJobId: 'tj_deg', jobs, repository });
  const second = buildAuthoritativeWorkflowGraph({ projectId: 'p_1', sourceToolJobId: 'tj_deg', jobs, repository });
  assert.equal(first.ok, true);
  assert.equal(first.workflowPlan.authority, 'sqlite_job_artifact_truth');
  assert.equal(isAuthoritativeWorkflowPlan(first.workflowPlan), true);
  assert.deepEqual(first.workflowPlan.steps.map((step) => [step.toolJobId, step.dependsOn]), [
    ['tj_deg', []],
    ['tj_go', ['job:tj_deg']],
  ]);
  assert.equal(first.graph.sourceDigest, second.graph.sourceDigest);
  assert.equal(first.graph.graphId, second.graph.graphId);
});

test('P6 affected graph excludes historical descendants while retaining current Jobs and ancestors', () => {
  const { jobs: baseJobs, repository: baseRepository } = truth({ input: artifactLineage() });
  const currentChild = job({
    id: 'tj_go_current',
    toolId: 'go-kegg',
    artifactId: 'go_bp_results',
    artifactHash: 'd'.repeat(64),
    inputs: [artifactLineage()],
  });
  const graph = buildAuthoritativeWorkflowGraph({
    projectId: 'p_1',
    sourceToolJobId: 'tj_deg',
    jobs: [...baseJobs, currentChild],
    repository: {
      ...baseRepository,
      listCurrentRevisions: () => [
        { revisionId: 'rev_deg', projectId: 'p_1', toolJobId: 'tj_deg' },
        { revisionId: 'rev_go_current', projectId: 'p_1', toolJobId: 'tj_go_current' },
      ],
    },
  });
  assert.equal(graph.ok, true, JSON.stringify(graph.diagnostics));
  assert.deepEqual(graph.graph.nodes.map((node) => node.toolJobId), ['tj_deg', 'tj_go_current']);
  assert.equal(graph.graph.nodes.some((node) => node.toolJobId === 'tj_go'), false);
});

test('P5 resolves the authoritative upstream root when graph discovery enters through a downstream Job', () => {
  const { jobs, repository } = truth({ input: artifactLineage() });
  const result = buildAuthoritativeWorkflowGraph({
    projectId: 'p_1',
    sourceToolJobId: 'tj_go',
    jobs,
    repository,
    requiredToolJobIds: ['tj_deg', 'tj_go'],
  });
  assert.equal(result.ok, true);
  assert.equal(result.graph.rootToolJobId, 'tj_deg');
  assert.equal(result.workflowPlan.rootToolJobId, 'tj_deg');
  assert.deepEqual(result.graph.nodes.map((node) => node.toolJobId), ['tj_deg', 'tj_go']);
});

test('P5 rejects a Job whose execution provenance payload changed after its self-hash was issued', () => {
  const { jobs, repository } = truth({ input: artifactLineage() });
  jobs[0].result.executionProvenance.artifacts[0].id = 'tampered_artifact';
  const result = buildAuthoritativeWorkflowGraph({
    projectId: 'p_1', sourceToolJobId: 'tj_deg', jobs, repository,
  });
  assert.equal(result.ok, false);
  assert.equal(result.diagnostics[0].code, 'workflow_source_job_unverified');
});

test('P5 deduplicates an identical repeated lineage edge without duplicating dependencies', () => {
  const { jobs, repository } = truth({ input: artifactLineage() });
  const duplicate = structuredClone(jobs[1].result.executionProvenance.inputs[0]);
  jobs[1].result.executionProvenance.inputs.push(duplicate);
  jobs[1].result.executionProvenance.provenanceHash = computeExecutionProvenanceHash(
    jobs[1].result.executionProvenance
  );
  const result = buildAuthoritativeWorkflowGraph({
    projectId: 'p_1', sourceToolJobId: 'tj_deg', jobs, repository,
  });
  assert.equal(result.ok, true);
  assert.equal(result.graph.edges.length, 1);
  assert.deepEqual(result.graph.nodes[1].dependsOn, ['job:tj_deg']);
});

test('P5 selection lineage verifies the exact revision, selection and materialized input bytes', () => {
  const selection = {
    selectionId: 'sel_1', projectId: 'p_1', revisionId: 'rev_deg', artifactId: 'deg_table', entityIdsHash: HASH.selection,
  };
  const valid = truth({ input: selectionLineage(), selection });
  assert.equal(buildAuthoritativeWorkflowGraph({ projectId: 'p_1', sourceToolJobId: 'tj_deg', ...valid }).ok, true);

  const staleSelection = truth({ input: selectionLineage(), selection: { ...selection, entityIdsHash: HASH.go } });
  const staleResult = buildAuthoritativeWorkflowGraph({ projectId: 'p_1', sourceToolJobId: 'tj_deg', ...staleSelection });
  assert.equal(staleResult.ok, false);
  assert.equal(staleResult.diagnostics[0].code, 'workflow_selection_drift');

  const driftedInput = truth({ input: selectionLineage({ materializationHash: HASH.deg }), selection });
  const driftResult = buildAuthoritativeWorkflowGraph({ projectId: 'p_1', sourceToolJobId: 'tj_deg', ...driftedInput });
  assert.equal(driftResult.ok, false);
  assert.equal(driftResult.diagnostics[0].code, 'workflow_materialization_hash_drift');
});

test('P5 refuses a direct-artifact edge when the child no longer received exact source bytes', () => {
  const { jobs, repository } = truth({ input: artifactLineage({ materializationHash: HASH.go }) });
  const result = buildAuthoritativeWorkflowGraph({ projectId: 'p_1', sourceToolJobId: 'tj_deg', jobs, repository });
  assert.equal(result.ok, false);
  assert.equal(result.diagnostics[0].code, 'workflow_materialization_hash_drift');
});

test('P5 refuses a root-only graph when a child consumed root bytes without server lineage', () => {
  const missingLineage = artifactLineage();
  delete missingLineage.lineage;
  const { jobs, repository } = truth({ input: missingLineage });
  const result = buildAuthoritativeWorkflowGraph({
    projectId: 'p_1',
    sourceToolJobId: 'tj_deg',
    jobs,
    repository,
    requiredToolJobIds: ['tj_go'],
  });
  assert.equal(result.ok, false);
  assert.equal(result.diagnostics[0].code, 'workflow_lineage_missing');
  assert.deepEqual(result.diagnostics[0].detail.candidateParentNodeIds, ['job:tj_deg']);
});

test('P5 refuses to persist an execution snapshot whose required Job is absent or disconnected', () => {
  const { jobs, repository } = truth();
  const disconnected = buildAuthoritativeWorkflowGraph({
    projectId: 'p_1', sourceToolJobId: 'tj_deg', jobs, repository, requiredToolJobIds: ['tj_go'],
  });
  assert.equal(disconnected.ok, false);
  assert.equal(disconnected.diagnostics[0].code, 'workflow_required_job_disconnected');

  const absent = buildAuthoritativeWorkflowGraph({
    projectId: 'p_1', sourceToolJobId: 'tj_deg', jobs: jobs.slice(0, 1), repository, requiredToolJobIds: ['tj_go'],
  });
  assert.equal(absent.ok, false);
  assert.equal(absent.diagnostics[0].code, 'workflow_required_job_unverified');
});

test('P5 can validate a candidate DAG against Revisions staged for the same atomic write', () => {
  const stagedRevisionId = 'rev_deg_candidate';
  const candidateHash = 'f'.repeat(64);
  const candidateJobs = [
    job({ id: 'tj_deg_candidate', toolId: 'deseq2', artifactId: 'deg_table', artifactHash: candidateHash }),
    job({
      id: 'tj_go_candidate',
      toolId: 'go-kegg',
      artifactId: 'go_bp_results',
      artifactHash: HASH.go,
      inputs: [{
        id: 'deg_table',
        sha256: candidateHash,
        lineage: {
          lineageVersion: 1,
          kind: 'artifact',
          sourceRevisionId: stagedRevisionId,
          sourceToolJobId: 'tj_deg_candidate',
          sourceArtifactId: 'deg_table',
          sourceOutputHash: candidateHash,
          materializationHash: candidateHash,
        },
      }],
    }),
  ];
  const result = buildAuthoritativeWorkflowGraph({
    projectId: 'p_1',
    sourceToolJobId: 'tj_deg_candidate',
    jobs: candidateJobs,
    repository: { getRevision: () => null, getSelection: () => null },
    requiredToolJobIds: candidateJobs.map((entry) => entry.id),
    stagedRevisions: [{
      revisionId: stagedRevisionId,
      projectId: 'p_1',
      toolJobId: 'tj_deg_candidate',
      artifactId: 'deg_table',
      outputHash: candidateHash,
    }],
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.graph.nodes.map((node) => node.toolJobId), ['tj_deg_candidate', 'tj_go_candidate']);
});

test('P5 graph snapshots are durable and idempotent rather than model-carried state', (context) => {
  const root = mkdtempSync(join(tmpdir(), 'biof3-workflow-graph-'));
  context.after(() => {
      // BLOCK-104 P2 — Windows 派生进程延迟释放句柄，rmSync 重试后仍可 EPERM；
      // 清理降级 best-effort（残留 %TEMP% 由系统回收），不得让清理炸掉测试结果。
      try {
        rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      } catch {
        /* best-effort cleanup */
      }
    });
  const database = new Database(join(root, 'result-studio.db'));
  context.after(() => database.close());
  const repository = createResultStudioRepository(database);
  const { jobs, repository: truthRepository } = truth({ input: artifactLineage() });
  const graph = buildAuthoritativeWorkflowGraph({ projectId: 'p_1', sourceToolJobId: 'tj_deg', jobs, repository: truthRepository });
  assert.equal(graph.ok, true);
  const first = repository.saveWorkflowGraph(graph.graph);
  const second = repository.saveWorkflowGraph(graph.graph);
  assert.equal(first.graphId, graph.graph.graphId);
  assert.deepEqual(second, first);
  assert.deepEqual(repository.findWorkflowGraph({ projectId: 'p_1', sourceDigest: graph.graph.sourceDigest }), first);

  const tamperedNodes = structuredClone(first.nodes);
  tamperedNodes[0].toolId = 'forged-tool';
  tamperedNodes[0].artifactIds = ['forged_artifact'];
  database.prepare('UPDATE result_workflow_graphs SET nodes_json = ? WHERE graph_id = ?')
    .run(JSON.stringify(tamperedNodes), first.graphId);
  assert.throws(
    () => repository.getWorkflowGraph(first.graphId),
    (error) => error.code === 'workflow_graph_integrity_failed'
      && error.detail.diagnostics.some((entry) => entry.code === 'workflow_graph_digest_drift'),
  );
});

test('P5 rebinds a root-only scientific graph when restoring an exact single-Job cohort', () => {
  const { jobs, repository } = truth();
  const source = buildAuthoritativeWorkflowGraph({
    projectId: 'p_1', sourceToolJobId: 'tj_deg', jobs, repository,
  });
  assert.equal(source.ok, true);
  assert.deepEqual(source.graph.edges, []);
  const sourceRevision = {
    revisionId: 'rev_deg', projectId: 'p_1', artifactFamilyId: 'family_deg',
    artifactId: 'deg_table', toolJobId: 'tj_deg', outputHash: HASH.deg,
  };
  const restoredRevision = { ...sourceRevision, revisionId: 'rev_deg_restored' };
  const rebound = rebindWorkflowGraphForEquivalentRestore({
    graph: source.graph,
    sourceRevisions: [sourceRevision],
    restoredRevisions: [restoredRevision],
  });
  assert.equal(rebound.ok, true);
  assert.equal(rebound.graph.graphId, source.graph.graphId);
  assert.deepEqual(rebound.graph.edges, []);
});

test('P5 rebinds only an exact historical cohort into a new authoritative restore graph', () => {
  const { jobs, repository } = truth({ input: artifactLineage() });
  const source = buildAuthoritativeWorkflowGraph({ projectId: 'p_1', sourceToolJobId: 'tj_deg', jobs, repository });
  assert.equal(source.ok, true);
  const sourceRevisions = [
    { revisionId: 'rev_deg', projectId: 'p_1', artifactFamilyId: 'family_deg', artifactId: 'deg_table', toolJobId: 'tj_deg', outputHash: HASH.deg },
    { revisionId: 'rev_go', projectId: 'p_1', artifactFamilyId: 'family_go', artifactId: 'go_bp_results', toolJobId: 'tj_go', outputHash: HASH.go },
  ];
  const restoredRevisions = [
    { revisionId: 'rev_deg_restored', projectId: 'p_1', artifactFamilyId: 'family_deg', artifactId: 'deg_table', toolJobId: 'tj_deg', outputHash: HASH.deg },
    { revisionId: 'rev_go_restored', projectId: 'p_1', artifactFamilyId: 'family_go', artifactId: 'go_bp_results', toolJobId: 'tj_go', outputHash: HASH.go },
  ];
  const rebound = rebindWorkflowGraphForEquivalentRestore({
    graph: source.graph,
    sourceRevisions,
    restoredRevisions,
  });
  assert.equal(rebound.ok, true);
  assert.notEqual(rebound.graph.graphId, source.graph.graphId);
  assert.equal(rebound.graph.edges[0].sourceRevisionId, 'rev_deg_restored');

  const mismatched = rebindWorkflowGraphForEquivalentRestore({
    graph: source.graph,
    sourceRevisions,
    restoredRevisions: [{ ...restoredRevisions[0], outputHash: HASH.go }, restoredRevisions[1]],
  });
  assert.equal(mismatched.ok, false);
  assert.equal(mismatched.diagnostic.code, 'restore_workflow_equivalence_failed');
});

test('P6 restores a downstream cohort while preserving exact immutable ancestor edges', () => {
  const { jobs, repository } = truth({ input: artifactLineage() });
  const source = buildAuthoritativeWorkflowGraph({
    projectId: 'p_1', sourceToolJobId: 'tj_go', jobs, repository,
  });
  assert.equal(source.ok, true);
  const sourceRevision = {
    revisionId: 'rev_go', projectId: 'p_1', artifactFamilyId: 'family_go',
    artifactId: 'go_bp_results', toolJobId: 'tj_go', outputHash: HASH.go,
  };
  const restoredRevision = { ...sourceRevision, revisionId: 'rev_go_restored' };
  const rebound = rebindWorkflowGraphForEquivalentRestore({
    graph: source.graph,
    sourceRevisions: [sourceRevision],
    restoredRevisions: [restoredRevision],
    resolveRevision: repository.getRevision,
  });
  assert.equal(rebound.ok, true);
  assert.deepEqual(rebound.graph.edges, source.graph.edges);
  assert.equal(rebound.graph.edges[0].sourceRevisionId, 'rev_deg');

  const driftedAncestor = rebindWorkflowGraphForEquivalentRestore({
    graph: source.graph,
    sourceRevisions: [sourceRevision],
    restoredRevisions: [restoredRevision],
    resolveRevision: (revisionId) => ({ ...repository.getRevision(revisionId), outputHash: HASH.go }),
  });
  assert.equal(driftedAncestor.ok, false);
  assert.equal(driftedAncestor.diagnostic.code, 'restore_workflow_edge_unverified');

  const descendantExpansion = rebindWorkflowGraphForEquivalentRestore({
    graph: source.graph,
    sourceRevisions: [{
      revisionId: 'rev_deg', projectId: 'p_1', artifactFamilyId: 'family_deg',
      artifactId: 'deg_table', toolJobId: 'tj_deg', outputHash: HASH.deg,
    }],
    restoredRevisions: [{
      revisionId: 'rev_deg_restored', projectId: 'p_1', artifactFamilyId: 'family_deg',
      artifactId: 'deg_table', toolJobId: 'tj_deg', outputHash: HASH.deg,
    }],
  });
  assert.equal(descendantExpansion.ok, false);
  assert.equal(descendantExpansion.diagnostic.code, 'restore_workflow_graph_scope_mismatch');
});
