'use strict';

/**
 * G0-RS-P5 — authoritative Result Studio workflow graph.
 *
 * The old AgentWorkflowPlan is a transient model-carried convenience object.
 * It cannot decide scientific impact.  This module projects the only graph
 * accepted by Result Studio edits from durable SQLite Job/Revision/Selection
 * truth.  A graph edge exists only when a completed child Job carries a
 * server-only lineage record whose source revision, hashes and (when used)
 * selection still verify.
 */

const crypto = require('node:crypto');
const { verifyExecutionProvenance } = require('./execution-provenance');

const RESULT_WORKFLOW_GRAPH_VERSION = 1;
// This is deliberately separate from the graph contract version.  SQLite
// migration ordering is global, while the graph contract can evolve without
// requiring a new table every time its projection gains a field.
const RESULT_WORKFLOW_GRAPH_MIGRATION_VERSION = 2;
const WORKFLOW_GRAPH_AUTHORITY = 'sqlite_job_artifact_truth';
const SHA256 = /^[a-f0-9]{64}$/;
const WORKFLOW_GRAPH_NODE_FIELDS = Object.freeze([
  'id',
  'toolJobId',
  'toolId',
  'artifactIds',
  'provenanceHash',
  'dependsOn',
]);
const WORKFLOW_GRAPH_EDGE_FIELDS = Object.freeze([
  'kind',
  'fromNodeId',
  'toNodeId',
  'sourceToolJobId',
  'sourceRevisionId',
  'sourceArtifactId',
  'sourceOutputHash',
  'selectionId',
  'selectionHash',
  'inputId',
]);

const WORKFLOW_GRAPH_SCHEMA_STATEMENTS = Object.freeze([
  `CREATE TABLE IF NOT EXISTS result_workflow_graphs (
  graph_id TEXT PRIMARY KEY,
  contract_version INTEGER NOT NULL DEFAULT 1,
  project_id TEXT NOT NULL,
  root_tool_job_id TEXT NOT NULL,
  source_digest TEXT NOT NULL,
  nodes_json TEXT NOT NULL,
  edges_json TEXT NOT NULL,
  validation_status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`,
  'CREATE UNIQUE INDEX IF NOT EXISTS uq_rs_workflow_graphs_project_digest ON result_workflow_graphs(project_id, source_digest)',
  'CREATE INDEX IF NOT EXISTS idx_rs_workflow_graphs_project_root ON result_workflow_graphs(project_id, root_tool_job_id)',
]);

const WORKFLOW_GRAPH_MIGRATION_HEADER = `-- G0-RS-P5 — authoritative Result Studio workflow graph (migration 002)
--
-- This file is generated from core/shared-backend/result-workflow-graph.js.
-- It only adds persistent graph snapshots; Job, Artifact and Revision Truth
-- remain in their existing canonical tables.`;

function buildWorkflowGraphMigrationSql() {
  return `${WORKFLOW_GRAPH_MIGRATION_HEADER}\n\n${WORKFLOW_GRAPH_SCHEMA_STATEMENTS.map((statement) => `${statement};`).join('\n\n')}\n`;
}

function ensureResultWorkflowGraphSchema(db) {
  if (!db || typeof db.exec !== 'function') throw new Error('workflow_graph_db_required');
  for (const statement of WORKFLOW_GRAPH_SCHEMA_STATEMENTS) db.exec(statement);
  return { version: RESULT_WORKFLOW_GRAPH_VERSION, table: 'result_workflow_graphs' };
}

function trimmed(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function stableHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function workflowGraphDigest({ projectId, rootToolJobId, nodes, edges }) {
  return stableHash({
    version: RESULT_WORKFLOW_GRAPH_VERSION,
    projectId,
    rootToolJobId,
    nodes: nodes.map((node) => ({
      id: node.id,
      toolJobId: node.toolJobId,
      toolId: node.toolId,
      artifactIds: node.artifactIds,
      provenanceHash: node.provenanceHash,
      dependsOn: node.dependsOn,
    })),
    edges: edges.map((edge) => Object.fromEntries(
      WORKFLOW_GRAPH_EDGE_FIELDS.map((field) => [field, edge[field]])
    )),
  });
}

function diagnostic(code, message, detail = null) {
  return { code, message, ...(detail == null ? {} : { detail }) };
}

function hasExactFields(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  return actual.length === expected.length
    && actual.every((field, index) => field === expected[index]);
}

function isSortedUniqueStrings(values, { allowEmpty = false } = {}) {
  return Array.isArray(values)
    && (allowEmpty || values.length > 0)
    && values.every((value) => trimmed(value) === value && value.length > 0)
    && values.every((value, index) => index === 0 || values[index - 1].localeCompare(value) < 0);
}

function edgeIdentity(edge) {
  return JSON.stringify(stable(Object.fromEntries(
    WORKFLOW_GRAPH_EDGE_FIELDS.map((field) => [field, edge[field]])
  )));
}

function verifyWorkflowGraphIntegrity(graph) {
  const diagnostics = [];
  if (!graph || typeof graph !== 'object' || Array.isArray(graph)
      || graph.contractVersion !== RESULT_WORKFLOW_GRAPH_VERSION
      || graph.validationStatus !== 'valid'
      || !trimmed(graph.projectId)
      || !trimmed(graph.rootToolJobId)
      || !Array.isArray(graph.nodes)
      || graph.nodes.length === 0
      || !Array.isArray(graph.edges)) {
    return {
      ok: false,
      diagnostics: [diagnostic('workflow_graph_contract_invalid', 'Persisted workflow graph contract is incomplete.')],
      expectedDigest: null,
    };
  }

  const nodesById = new Map();
  for (const node of graph.nodes) {
    if (!hasExactFields(node, WORKFLOW_GRAPH_NODE_FIELDS)
        || node.id !== `job:${trimmed(node.toolJobId)}`
        || !trimmed(node.toolId)
        || !isSortedUniqueStrings(node.artifactIds)
        || !SHA256.test(trimmed(node.provenanceHash))
        || !isSortedUniqueStrings(node.dependsOn, { allowEmpty: true })) {
      diagnostics.push(diagnostic('workflow_graph_node_invalid', 'Persisted workflow graph contains an invalid node.', { nodeId: node?.id || null }));
      continue;
    }
    if (nodesById.has(node.id)) {
      diagnostics.push(diagnostic('workflow_graph_node_duplicate', 'Persisted workflow graph contains a duplicate node.', { nodeId: node.id }));
      continue;
    }
    nodesById.set(node.id, node);
  }

  const parentSets = new Map([...nodesById.keys()].map((nodeId) => [nodeId, new Set()]));
  const childSets = new Map([...nodesById.keys()].map((nodeId) => [nodeId, new Set()]));
  const edgeKeys = new Set();
  for (const edge of graph.edges) {
    const sourceNode = nodesById.get(edge?.fromNodeId) || null;
    const targetNode = nodesById.get(edge?.toNodeId) || null;
    const selectionValid = edge?.kind === 'artifact'
      ? edge.selectionId === null && edge.selectionHash === null
      : edge?.kind === 'selection' && !!trimmed(edge.selectionId) && SHA256.test(trimmed(edge.selectionHash));
    if (!hasExactFields(edge, WORKFLOW_GRAPH_EDGE_FIELDS)
        || !sourceNode || !targetNode || edge.fromNodeId === edge.toNodeId
        || edge.sourceToolJobId !== sourceNode.toolJobId
        || !trimmed(edge.sourceRevisionId)
        || !trimmed(edge.sourceArtifactId)
        || !sourceNode.artifactIds.includes(edge.sourceArtifactId)
        || !SHA256.test(trimmed(edge.sourceOutputHash))
        || !(edge.inputId === null || !!trimmed(edge.inputId))
        || !selectionValid) {
      diagnostics.push(diagnostic('workflow_graph_edge_invalid', 'Persisted workflow graph contains an invalid edge.', {
        fromNodeId: edge?.fromNodeId || null,
        toNodeId: edge?.toNodeId || null,
      }));
      continue;
    }
    const key = edgeIdentity(edge);
    if (edgeKeys.has(key)) {
      diagnostics.push(diagnostic('workflow_graph_edge_duplicate', 'Persisted workflow graph contains a duplicate lineage edge.', {
        fromNodeId: edge.fromNodeId,
        toNodeId: edge.toNodeId,
      }));
      continue;
    }
    edgeKeys.add(key);
    parentSets.get(edge.toNodeId).add(edge.fromNodeId);
    childSets.get(edge.fromNodeId).add(edge.toNodeId);
  }

  for (const [nodeId, node] of nodesById) {
    const expectedParents = [...parentSets.get(nodeId)].sort();
    if (JSON.stringify(node.dependsOn) !== JSON.stringify(expectedParents)) {
      diagnostics.push(diagnostic('workflow_graph_dependency_drift', 'Workflow node dependencies do not match persisted lineage edges.', {
        nodeId,
        expectedParents,
        actualParents: node.dependsOn,
      }));
    }
  }

  const roots = [...nodesById.keys()].filter((nodeId) => parentSets.get(nodeId).size === 0).sort();
  const expectedRootNodeId = `job:${graph.rootToolJobId}`;
  if (roots.length !== 1 || roots[0] !== expectedRootNodeId) {
    diagnostics.push(diagnostic('workflow_graph_root_invalid', 'Workflow graph must have exactly one authoritative upstream root.', {
      rootToolJobId: graph.rootToolJobId,
      rootNodeIds: roots,
    }));
  } else {
    const reached = new Set();
    const queue = [expectedRootNodeId];
    while (queue.length > 0) {
      const nodeId = queue.shift();
      if (reached.has(nodeId)) continue;
      reached.add(nodeId);
      queue.push(...childSets.get(nodeId));
    }
    if (reached.size !== nodesById.size) {
      diagnostics.push(diagnostic('workflow_graph_disconnected', 'Workflow graph contains nodes outside the authoritative root subgraph.'));
    }
  }

  const expectedDigest = nodesById.size === graph.nodes.length
    ? workflowGraphDigest(graph)
    : null;
  if (!expectedDigest || graph.sourceDigest !== expectedDigest
      || graph.graphId !== `wfg_${expectedDigest.slice(0, 24)}`) {
    diagnostics.push(diagnostic('workflow_graph_digest_drift', 'Persisted workflow graph digest does not match its authoritative contents.', {
      actualDigest: graph.sourceDigest || null,
      expectedDigest,
    }));
  }
  return { ok: diagnostics.length === 0, diagnostics, expectedDigest };
}

function parseJobResult(job) {
  if (!job) return {};
  if (job.result && typeof job.result === 'object') return job.result;
  if (job.result_json && typeof job.result_json === 'object') return job.result_json;
  try { return JSON.parse(job.result_json || '{}'); } catch { return {}; }
}

function projectJobNode(job) {
  const result = parseJobResult(job);
  const provenance = result.executionProvenance || {};
  const artifacts = Array.isArray(provenance.artifacts) ? provenance.artifacts : [];
  return {
    id: `job:${job.id}`,
    toolJobId: job.id,
    toolId: trimmed(job.tool_id || job.toolId) || null,
    artifactIds: [...new Set(artifacts.map((item) => trimmed(item && item.id)).filter(Boolean))].sort(),
    provenanceHash: trimmed(provenance.provenanceHash) || null,
    dependsOn: [],
  };
}

function validCompletedJob(job, projectId) {
  if (!job || trimmed(job.id) === '' || !trimmed(job.tool_id || job.toolId)
      || trimmed(job.project_id || job.projectId) !== projectId || job.status !== 'completed') return false;
  const result = parseJobResult(job);
  const provenance = result.executionProvenance || null;
  if (result.artifactTruth?.status !== 'valid' || result.artifactTruth?.blocking === true) return false;
  if (!provenance || provenance.executionProvenanceVersion !== 1 || provenance.toolJobId !== job.id || trimmed(provenance.projectId) !== projectId) return false;
  if (!verifyExecutionProvenance(provenance).ok) return false;
  if (!Array.isArray(provenance.artifacts) || provenance.artifacts.length === 0) return false;
  return provenance.artifacts.every((artifact) => trimmed(artifact && artifact.id) && SHA256.test(trimmed(artifact.sha256)));
}

function validateLineage({ input, projectId, repository, stagedRevisionsById = null }) {
  const lineage = input && input.lineage;
  if (!lineage || typeof lineage !== 'object' || Array.isArray(lineage)) return { ok: false, ignored: true };
  if (lineage.lineageVersion !== 1 || !['selection', 'artifact'].includes(lineage.kind)) {
    return { ok: false, diagnostic: diagnostic('workflow_lineage_invalid', 'Workflow input lineage has an unsupported contract.', { lineageVersion: lineage.lineageVersion, kind: lineage.kind }) };
  }
  const sourceRevisionId = trimmed(lineage.sourceRevisionId);
  const sourceToolJobId = trimmed(lineage.sourceToolJobId);
  const sourceArtifactId = trimmed(lineage.sourceArtifactId);
  const sourceOutputHash = trimmed(lineage.sourceOutputHash);
  const materializationHash = trimmed(lineage.materializationHash);
  if (!sourceRevisionId || !sourceToolJobId || !sourceArtifactId
      || !SHA256.test(sourceOutputHash) || !SHA256.test(materializationHash)) {
    return { ok: false, diagnostic: diagnostic('workflow_lineage_incomplete', 'Workflow input lineage lacks an immutable source revision, selection or hash.') };
  }
  if (!SHA256.test(trimmed(input.sha256)) || input.sha256 !== materializationHash) {
    return { ok: false, diagnostic: diagnostic('workflow_materialization_hash_drift', 'Materialized downstream input no longer matches its persisted lineage hash.', { inputId: input.id || null }) };
  }
  const stagedRevision = stagedRevisionsById instanceof Map
    ? stagedRevisionsById.get(sourceRevisionId) || null
    : null;
  const revision = stagedRevision || (repository && typeof repository.getRevision === 'function'
    ? repository.getRevision(sourceRevisionId)
    : null);
  if (!revision || revision.projectId !== projectId || revision.revisionId !== sourceRevisionId
      || revision.toolJobId !== sourceToolJobId || revision.artifactId !== sourceArtifactId
      || revision.outputHash !== sourceOutputHash) {
    return { ok: false, diagnostic: diagnostic('workflow_source_revision_drift', 'Workflow lineage no longer resolves to the recorded source ArtifactRevision.') };
  }
  if (lineage.kind === 'artifact') {
    // An artifact edge is an exact immutable-byte hand-off.  A transformed
    // file must use a distinct lineage kind rather than masquerading as the
    // upstream Artifact; otherwise an affected-subgraph rerun could silently
    // consume a different data set.
    if (materializationHash !== sourceOutputHash) {
      return { ok: false, diagnostic: diagnostic('workflow_artifact_materialization_drift', 'Artifact lineage must materialize the exact source Artifact bytes.') };
    }
    return {
      ok: true,
      edge: {
        kind: 'artifact',
        fromNodeId: `job:${sourceToolJobId}`,
        sourceToolJobId,
        sourceRevisionId,
        sourceArtifactId,
        sourceOutputHash,
        selectionId: null,
        selectionHash: null,
        inputId: trimmed(input.id) || null,
      },
    };
  }
  const selectionId = trimmed(lineage.selectionId);
  const selectionHash = trimmed(lineage.selectionHash);
  if (!selectionId || !SHA256.test(selectionHash)) {
    return { ok: false, diagnostic: diagnostic('workflow_lineage_incomplete', 'Selection workflow lineage lacks a durable selection identity or hash.') };
  }
  const selection = repository && typeof repository.getSelection === 'function' ? repository.getSelection(selectionId) : null;
  if (!selection || selection.projectId !== projectId || selection.revisionId !== sourceRevisionId
      || selection.artifactId !== sourceArtifactId || selection.entityIdsHash !== selectionHash) {
    return { ok: false, diagnostic: diagnostic('workflow_selection_drift', 'Workflow lineage selection changed or no longer belongs to the source Revision.') };
  }
  return {
    ok: true,
    edge: {
      kind: 'selection',
      fromNodeId: `job:${sourceToolJobId}`,
      sourceToolJobId,
      sourceRevisionId,
      sourceArtifactId,
      sourceOutputHash,
      selectionId,
      selectionHash,
      inputId: trimmed(input.id) || null,
    },
  };
}

function normalizedRequiredJobIds(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => trimmed(value))
    .filter(Boolean))]
    .sort();
}

function stagedRevisionIndex(stagedRevisions, projectId) {
  const byId = new Map();
  const diagnostics = [];
  for (const revision of Array.isArray(stagedRevisions) ? stagedRevisions : []) {
    const revisionId = trimmed(revision && revision.revisionId);
    if (!revisionId || trimmed(revision && revision.projectId) !== projectId
        || !trimmed(revision && revision.toolJobId) || !trimmed(revision && revision.artifactId)
        || !SHA256.test(trimmed(revision && revision.outputHash))) {
      diagnostics.push(diagnostic(
        'workflow_staged_revision_invalid',
        'A staged candidate Revision is incomplete or belongs to another project.',
        { revisionId: revisionId || null }
      ));
      continue;
    }
    if (byId.has(revisionId)) {
      diagnostics.push(diagnostic(
        'workflow_staged_revision_duplicate',
        'A staged candidate Revision id is duplicated.',
        { revisionId }
      ));
      continue;
    }
    byId.set(revisionId, revision);
  }
  return { byId, diagnostics };
}

function artifactProducerIndexes(validJobs) {
  const byHash = new Map();
  const byArtifactId = new Map();
  const add = (index, key, nodeId) => {
    if (!key) return;
    if (!index.has(key)) index.set(key, new Set());
    index.get(key).add(nodeId);
  };
  for (const job of validJobs) {
    const nodeId = `job:${job.id}`;
    const artifacts = parseJobResult(job).executionProvenance?.artifacts || [];
    for (const artifact of artifacts) {
      add(byHash, trimmed(artifact && artifact.sha256), nodeId);
      add(byArtifactId, trimmed(artifact && artifact.id), nodeId);
    }
  }
  return { byHash, byArtifactId };
}

function missingLineageParents({ input, repository, nodesById, producerIndexes }) {
  const parents = new Set();
  const inputHash = trimmed(input && input.sha256);
  const sourceArtifactRef = trimmed(input && input.sourceArtifactRef);
  for (const nodeId of producerIndexes.byHash.get(inputHash) || []) parents.add(nodeId);
  for (const nodeId of producerIndexes.byArtifactId.get(sourceArtifactRef) || []) parents.add(nodeId);
  if (sourceArtifactRef && repository && typeof repository.getRevision === 'function') {
    const revision = repository.getRevision(sourceArtifactRef);
    const nodeId = revision && `job:${trimmed(revision.toolJobId)}`;
    if (nodeId && nodesById.has(nodeId)) parents.add(nodeId);
  }
  return [...parents].sort();
}

function topologicalComponent({ rootId, nodesById, edges }) {
  const adjacency = new Map();
  for (const id of nodesById.keys()) adjacency.set(id, new Set());
  for (const edge of edges) {
    if (!adjacency.has(edge.fromNodeId) || !adjacency.has(edge.toNodeId)) continue;
    adjacency.get(edge.fromNodeId).add(edge.toNodeId);
    adjacency.get(edge.toNodeId).add(edge.fromNodeId);
  }
  const component = new Set();
  const queue = [rootId];
  while (queue.length > 0) {
    const id = queue.shift();
    if (component.has(id) || !adjacency.has(id)) continue;
    component.add(id);
    queue.push(...adjacency.get(id));
  }
  const directed = edges.filter((edge) => component.has(edge.fromNodeId) && component.has(edge.toNodeId));
  const children = new Map([...component].map((id) => [id, new Set()]));
  const indegree = new Map([...component].map((id) => [id, 0]));
  for (const edge of directed) {
    if (children.get(edge.fromNodeId).has(edge.toNodeId)) continue;
    children.get(edge.fromNodeId).add(edge.toNodeId);
    indegree.set(edge.toNodeId, indegree.get(edge.toNodeId) + 1);
  }
  const ready = [...component].filter((id) => indegree.get(id) === 0).sort();
  const ordered = [];
  while (ready.length > 0) {
    const id = ready.shift();
    ordered.push(id);
    for (const child of [...children.get(id)].sort()) {
      indegree.set(child, indegree.get(child) - 1);
      if (indegree.get(child) === 0) ready.push(child);
    }
    ready.sort();
  }
  return { component, edges: directed, ordered, cyclic: ordered.length !== component.size };
}

/**
 * Build a graph solely from persisted Job / ArtifactRevision / Selection truth.
 * No caller-supplied node, edge or WorkflowPlan is read.
 */
function buildAuthoritativeWorkflowGraph({
  projectId,
  sourceToolJobId,
  jobs = [],
  repository,
  requiredToolJobIds = [],
  stagedRevisions = [],
} = {}) {
  const normalizedProjectId = trimmed(projectId);
  const rootJobId = trimmed(sourceToolJobId);
  if (!normalizedProjectId || !rootJobId || !repository) {
    return { ok: false, diagnostics: [diagnostic('workflow_truth_context_missing', 'Project, source Job and Result Studio repository are required.')] };
  }
  const requiredJobIds = normalizedRequiredJobIds(requiredToolJobIds);
  const staged = stagedRevisionIndex(stagedRevisions, normalizedProjectId);
  if (staged.diagnostics.length > 0) return { ok: false, diagnostics: staged.diagnostics };
  const validJobs = (Array.isArray(jobs) ? jobs : []).filter((job) => validCompletedJob(job, normalizedProjectId));
  const entryJob = validJobs.find((job) => job.id === rootJobId) || null;
  if (!entryJob) {
    return { ok: false, diagnostics: [diagnostic('workflow_source_job_unverified', 'The source Job is not a completed valid Artifact Truth record.')] };
  }
  const nodesById = new Map(validJobs.map((job) => [`job:${job.id}`, projectJobNode(job)]));
  const diagnostics = [];
  const edges = [];
  const edgeKeys = new Set();
  const missingLineageInputs = [];
  for (const job of validJobs) {
    const provenance = parseJobResult(job).executionProvenance;
    for (const input of provenance.inputs || []) {
      const lineage = validateLineage({
        input,
        projectId: normalizedProjectId,
        repository,
        stagedRevisionsById: staged.byId,
      });
      if (lineage.ignored) {
        missingLineageInputs.push({ job, input });
        continue;
      }
      if (!lineage.ok) {
        diagnostics.push({ ...lineage.diagnostic, detail: { ...(lineage.diagnostic.detail || {}), toolJobId: job.id } });
        continue;
      }
      if (!nodesById.has(lineage.edge.fromNodeId)) {
        diagnostics.push(diagnostic('workflow_parent_job_unverified', 'Workflow lineage points to a Job without valid Artifact Truth.', { toolJobId: job.id, sourceToolJobId: lineage.edge.sourceToolJobId }));
        continue;
      }
      const edge = { ...lineage.edge, toNodeId: `job:${job.id}` };
      const key = edgeIdentity(edge);
      if (!edgeKeys.has(key)) {
        edgeKeys.add(key);
        edges.push(edge);
      }
    }
  }
  if (diagnostics.length > 0) return { ok: false, diagnostics };
  const rootId = `job:${rootJobId}`;
  const component = topologicalComponent({ rootId, nodesById, edges });
  if (component.cyclic) return { ok: false, diagnostics: [diagnostic('workflow_cycle_detected', 'Persisted Job lineage contains a cycle.')] };
  const authoritativeRootIds = component.ordered.filter((nodeId) => (
    !component.edges.some((edge) => edge.toNodeId === nodeId)
  ));
  if (authoritativeRootIds.length !== 1) {
    return {
      ok: false,
      diagnostics: [diagnostic(
        'workflow_root_ambiguous',
        'Persisted Job lineage must resolve to exactly one authoritative upstream root.',
        { entryToolJobId: rootJobId, rootNodeIds: authoritativeRootIds }
      )],
    };
  }
  const authoritativeRootId = authoritativeRootIds[0];
  const authoritativeRootJobId = nodesById.get(authoritativeRootId).toolJobId;
  const producerIndexes = artifactProducerIndexes(validJobs);
  for (const { job, input } of missingLineageInputs) {
    const jobNodeId = `job:${job.id}`;
    const candidateParents = missingLineageParents({ input, repository, nodesById, producerIndexes })
      .filter((nodeId) => nodeId !== jobNodeId);
    const touchesComponent = component.component.has(jobNodeId)
      || candidateParents.some((nodeId) => component.component.has(nodeId));
    if (!touchesComponent) continue;
    if (candidateParents.length === 0 && !trimmed(input && input.sourceArtifactRef)) continue;
    diagnostics.push(diagnostic(
      'workflow_lineage_missing',
      'A Job input connected to this workflow lacks server-issued immutable lineage.',
      {
        toolJobId: job.id,
        inputId: trimmed(input && input.id) || null,
        sourceArtifactRef: trimmed(input && input.sourceArtifactRef) || null,
        candidateParentNodeIds: candidateParents,
      }
    ));
  }
  if (diagnostics.length > 0) return { ok: false, diagnostics };
  for (const requiredJobId of requiredJobIds) {
    const requiredNodeId = `job:${requiredJobId}`;
    if (!nodesById.has(requiredNodeId)) {
      diagnostics.push(diagnostic(
        'workflow_required_job_unverified',
        'The Job required by this graph snapshot is not completed valid Artifact Truth.',
        { toolJobId: requiredJobId }
      ));
    } else if (!component.component.has(requiredNodeId)) {
      diagnostics.push(diagnostic(
        'workflow_required_job_disconnected',
        'The Job required by this graph snapshot has no verified lineage path to the source Job.',
        { toolJobId: requiredJobId, sourceToolJobId: authoritativeRootJobId }
      ));
    }
  }
  if (diagnostics.length > 0) return { ok: false, diagnostics };
  const componentNodes = component.ordered.map((id) => ({
    ...nodesById.get(id),
    dependsOn: [...new Set(component.edges
      .filter((edge) => edge.toNodeId === id)
      .map((edge) => edge.fromNodeId))].sort(),
  }));
  const componentEdges = component.edges
    .map((edge) => ({ ...edge }))
    .sort((left, right) => edgeIdentity(left).localeCompare(edgeIdentity(right)));
  const sourceDigest = workflowGraphDigest({
    projectId: normalizedProjectId,
    rootToolJobId: authoritativeRootJobId,
    nodes: componentNodes,
    edges: componentEdges,
  });
  const graphId = `wfg_${sourceDigest.slice(0, 24)}`;
  const workflowPlan = {
    workflowTruthVersion: RESULT_WORKFLOW_GRAPH_VERSION,
    authority: WORKFLOW_GRAPH_AUTHORITY,
    graphId,
    sourceDigest,
    rootToolJobId: authoritativeRootJobId,
    steps: componentNodes.map((node) => ({ id: node.id, toolJobId: node.toolJobId, toolId: node.toolId, dependsOn: node.dependsOn })),
  };
  return {
    ok: true,
    diagnostics: [],
    graph: {
      graphId,
      contractVersion: RESULT_WORKFLOW_GRAPH_VERSION,
      projectId: normalizedProjectId,
      rootToolJobId: authoritativeRootJobId,
      sourceDigest,
      nodes: componentNodes,
      edges: componentEdges,
      validationStatus: 'valid',
    },
    workflowPlan,
  };
}

/**
 * A historical restore creates new Revision identities while preserving the
 * exact immutable outputs of an already-authoritative cohort.  Rebind only
 * those Revision ids inside a verified artifact-edge graph; never accept a
 * caller-supplied graph, edge, Job, or output hash.  This keeps a restored
 * multi-Job cohort replayable without pretending that an old graph already
 * names its newly materialized Revisions.
 */
function rebindWorkflowGraphForEquivalentRestore({ graph, sourceRevisions, restoredRevisions } = {}) {
  if (!graph || graph.validationStatus !== 'valid' || !graph.projectId || !graph.rootToolJobId
      || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)
      || graph.nodes.length === 0) {
    return { ok: false, diagnostic: diagnostic('restore_workflow_graph_invalid', 'Historical restore requires a valid persisted authoritative workflow graph.') };
  }
  const integrity = verifyWorkflowGraphIntegrity(graph);
  if (!integrity.ok) {
    return { ok: false, diagnostic: diagnostic('restore_workflow_graph_digest_drift', 'Persisted workflow graph digest no longer matches its authoritative contents.') };
  }
  const source = Array.isArray(sourceRevisions) ? sourceRevisions : [];
  const restored = Array.isArray(restoredRevisions) ? restoredRevisions : [];
  if (source.length === 0 || source.length !== restored.length) {
    return { ok: false, diagnostic: diagnostic('restore_workflow_cohort_incomplete', 'Historical restore requires a complete one-to-one Revision cohort.') };
  }
  const sourceById = new Map();
  const restoredByIdentity = new Map();
  const identityFor = (revision) => {
    const familyId = trimmed(revision && revision.artifactFamilyId);
    const artifactId = trimmed(revision && revision.artifactId);
    return familyId && artifactId ? `${familyId}\u0000${artifactId}` : null;
  };
  for (const revision of source) {
    const identity = identityFor(revision);
    if (!trimmed(revision && revision.revisionId) || !trimmed(revision && revision.toolJobId)
        || !identity || revision.projectId !== graph.projectId
        || !SHA256.test(trimmed(revision && revision.outputHash))
        || sourceById.has(revision.revisionId)) {
      return { ok: false, diagnostic: diagnostic('restore_workflow_source_revision_invalid', 'Historical workflow graph cannot be rebound from an invalid source Revision.') };
    }
    sourceById.set(revision.revisionId, revision);
  }
  for (const revision of restored) {
    const identity = identityFor(revision);
    if (!trimmed(revision && revision.revisionId) || !trimmed(revision && revision.toolJobId)
        || !identity || revision.projectId !== graph.projectId
        || !SHA256.test(trimmed(revision && revision.outputHash))
        || restoredByIdentity.has(identity)) {
      return { ok: false, diagnostic: diagnostic('restore_workflow_restored_revision_invalid', 'Historical workflow graph cannot be rebound to an invalid restored Revision.') };
    }
    restoredByIdentity.set(identity, revision);
  }
  const replacements = new Map();
  for (const sourceRevision of source) {
    const restoredRevision = restoredByIdentity.get(identityFor(sourceRevision));
    if (!restoredRevision
        || restoredRevision.toolJobId !== sourceRevision.toolJobId
        || restoredRevision.outputHash !== sourceRevision.outputHash) {
      return { ok: false, diagnostic: diagnostic('restore_workflow_equivalence_failed', 'Restored Revision does not preserve the exact source Job and output bytes.') };
    }
    replacements.set(sourceRevision.revisionId, restoredRevision);
  }
  const edges = graph.edges.map((edge) => {
    const sourceRevision = sourceById.get(edge && edge.sourceRevisionId);
    const restoredRevision = sourceRevision && replacements.get(sourceRevision.revisionId);
    if (!edge || edge.kind !== 'artifact' || !sourceRevision || !restoredRevision
        || edge.sourceToolJobId !== sourceRevision.toolJobId
        || edge.sourceArtifactId !== sourceRevision.artifactId
        || edge.sourceOutputHash !== sourceRevision.outputHash) {
      return null;
    }
    return { ...edge, sourceRevisionId: restoredRevision.revisionId };
  });
  if (edges.some((edge) => edge == null)) {
    return { ok: false, diagnostic: diagnostic('restore_workflow_edge_unverified', 'Historical workflow edges do not exactly resolve to the restored immutable cohort.') };
  }
  const sourceDigest = workflowGraphDigest({
    projectId: graph.projectId,
    rootToolJobId: graph.rootToolJobId,
    nodes: graph.nodes,
    edges,
  });
  return {
    ok: true,
    graph: {
      graphId: `wfg_${sourceDigest.slice(0, 24)}`,
      contractVersion: RESULT_WORKFLOW_GRAPH_VERSION,
      projectId: graph.projectId,
      rootToolJobId: graph.rootToolJobId,
      sourceDigest,
      nodes: graph.nodes.map((node) => ({ ...node, dependsOn: [...(node.dependsOn || [])] })),
      edges,
      validationStatus: 'valid',
    },
  };
}

function isAuthoritativeWorkflowPlan(workflowPlan) {
  return !!workflowPlan
    && workflowPlan.workflowTruthVersion === RESULT_WORKFLOW_GRAPH_VERSION
    && workflowPlan.authority === WORKFLOW_GRAPH_AUTHORITY
    && trimmed(workflowPlan.graphId).startsWith('wfg_')
    && SHA256.test(trimmed(workflowPlan.sourceDigest))
    && Array.isArray(workflowPlan.steps);
}

module.exports = {
  RESULT_WORKFLOW_GRAPH_VERSION,
  RESULT_WORKFLOW_GRAPH_MIGRATION_VERSION,
  WORKFLOW_GRAPH_AUTHORITY,
  WORKFLOW_GRAPH_SCHEMA_STATEMENTS,
  WORKFLOW_GRAPH_MIGRATION_HEADER,
  buildWorkflowGraphMigrationSql,
  ensureResultWorkflowGraphSchema,
  workflowGraphDigest,
  verifyWorkflowGraphIntegrity,
  buildAuthoritativeWorkflowGraph,
  rebindWorkflowGraphForEquivalentRestore,
  isAuthoritativeWorkflowPlan,
};
