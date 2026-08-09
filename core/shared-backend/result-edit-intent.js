'use strict';

const crypto = require('node:crypto');
const { isAuthoritativeWorkflowPlan } = require('./result-workflow-graph');
const { verifyExecutionProvenance } = require('./execution-provenance');

const RESULT_EDIT_INTENT_VERSION = 1;
const RESULT_EDIT_CLASSES = Object.freeze([
  'view_only',
  'presentation_rerender',
  'data_transform',
  'scientific_recompute',
  'workflow_replan',
]);
const IMPACT_ALIASES = Object.freeze({
  view: 'view_only',
  presentation: 'presentation_rerender',
  data: 'data_transform',
  scientific: 'scientific_recompute',
  workflow: 'workflow_replan',
});
const CLASS_RANK = new Map(RESULT_EDIT_CLASSES.map((value, index) => [value, index]));
const SCIENTIFIC_FIELDS = new Set([
  'design', 'design_formula', 'formula', 'contrast', 'contrast_ref', 'contrast_treat',
]);
const WORKFLOW_FIELDS = new Set([
  'method', 'algorithm', 'tool', 'tool_id', 'plugin', 'plugin_id', 'workflow',
]);

function trimmed(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex');
}

function diagnostic(code, message, detail = null) {
  return { code, message, ...(detail == null ? {} : { detail }) };
}

function normalizeImpact(value) {
  const normalized = trimmed(value);
  if (RESULT_EDIT_CLASSES.includes(normalized)) return normalized;
  return IMPACT_ALIASES[normalized] || null;
}

function normalizeRules(rules) {
  if (!rules || typeof rules !== 'object' || Array.isArray(rules)) return {};
  const normalized = {};
  for (const [parameter, impact] of Object.entries(rules)) {
    const value = normalizeImpact(impact);
    if (trimmed(parameter) && value) normalized[parameter] = value;
  }
  return normalized;
}

function classifyParameterPatch({ proposedParameterPatch = {}, parameterImpactRules = {}, requestedEditClass = null } = {}) {
  const patch = proposedParameterPatch && typeof proposedParameterPatch === 'object' && !Array.isArray(proposedParameterPatch)
    ? proposedParameterPatch
    : {};
  const rules = normalizeRules(parameterImpactRules);
  const fields = Object.keys(patch).sort();
  const parameterImpacts = [];
  let editClass = fields.length === 0 ? normalizeImpact(requestedEditClass) || 'view_only' : 'view_only';
  let usedConservativeFallback = false;

  for (const field of fields) {
    const normalizedField = field.trim().toLowerCase().replace(/[.\s-]+/g, '_');
    // 保护字段是**下限**，不是覆盖：它保证 `design`、`method` 这类字段永远不会
    // 被当成样式改动，但当受信 descriptor 声明了更高影响时（例如 DESeq2 把
    // `design` 声明为 workflow），必须采用更高的那个。此前的 if/else 链让保护
    // 字段抢先命中并把已声明的 workflow_replan 降级成 scientific_recompute，
    // 等于让"重新规划下游"被静默说成"只重算本节点"。
    let floorImpact = null;
    let floorSource = null;
    if (WORKFLOW_FIELDS.has(normalizedField)) {
      floorImpact = 'workflow_replan';
      floorSource = 'protected_workflow_field';
    } else if (SCIENTIFIC_FIELDS.has(normalizedField)) {
      floorImpact = 'scientific_recompute';
      floorSource = 'protected_scientific_field';
    }
    const declaredImpact = rules[field] || null;
    let impact;
    let source;
    if (declaredImpact && floorImpact) {
      // 取两者中更保守（rank 更高）的一个，绝不向下取。
      if (CLASS_RANK.get(declaredImpact) >= CLASS_RANK.get(floorImpact)) {
        impact = declaredImpact;
        source = 'declared_parameter_impact';
      } else {
        impact = floorImpact;
        source = floorSource;
      }
    } else if (floorImpact) {
      impact = floorImpact;
      source = floorSource;
    } else if (declaredImpact) {
      impact = declaredImpact;
      source = 'declared_parameter_impact';
    } else {
      impact = 'scientific_recompute';
      source = 'conservative_unknown_parameter';
      usedConservativeFallback = true;
    }
    if (CLASS_RANK.get(impact) > CLASS_RANK.get(editClass)) editClass = impact;
    parameterImpacts.push({ parameter: field, impact, source });
  }

  const requested = normalizeImpact(requestedEditClass);
  if (requested && CLASS_RANK.get(requested) > CLASS_RANK.get(editClass)) editClass = requested;
  const requiresScientificConfirmation =
    usedConservativeFallback || ['scientific_recompute', 'workflow_replan'].includes(editClass);

  return {
    editClass,
    parameterImpacts,
    usedConservativeFallback,
    requiresJob: editClass !== 'view_only',
    requiresScientificConfirmation,
    classificationReason: parameterImpacts.length
      ? parameterImpacts.map((item) => `${item.parameter}:${item.impact}(${item.source})`).join('; ')
      : `explicit:${editClass}`,
  };
}

function parseJobResult(job) {
  if (!job) return {};
  if (job.result && typeof job.result === 'object') return job.result;
  if (job.result_json && typeof job.result_json === 'object') return job.result_json;
  try {
    return JSON.parse(job.result_json || '{}');
  } catch {
    return {};
  }
}

function exactArtifact(result, artifactId) {
  const artifacts = Array.isArray(result.artifacts) ? result.artifacts : [];
  const matches = artifacts.filter((artifact) => artifact && artifact.id === artifactId);
  return matches.length === 1 ? matches[0] : null;
}

function hasStructuredInputLineage(input) {
  const lineage = input?.lineage;
  if (!lineage || typeof lineage !== 'object' || Array.isArray(lineage)
      || lineage.lineageVersion !== 1 || !['artifact', 'selection'].includes(lineage.kind)) return false;
  const sha256 = /^[a-f0-9]{64}$/;
  if (!trimmed(lineage.sourceRevisionId) || !trimmed(lineage.sourceToolJobId)
      || !trimmed(lineage.sourceArtifactId) || !sha256.test(trimmed(lineage.sourceOutputHash))
      || !sha256.test(trimmed(lineage.materializationHash))
      || trimmed(input?.sha256) !== trimmed(lineage.materializationHash)) return false;
  return lineage.kind === 'artifact'
    ? trimmed(lineage.materializationHash) === trimmed(lineage.sourceOutputHash)
    : Boolean(trimmed(lineage.selectionId) && sha256.test(trimmed(lineage.selectionHash)));
}

function locateResultSource({ toolJob, artifactId, projectId } = {}) {
  const diagnostics = [];
  if (!toolJob) return { ok: false, diagnostics: [diagnostic('source_job_not_found', 'Source tool job was not found.')] };
  const jobProjectId = trimmed(toolJob.project_id || toolJob.projectId);
  if (!trimmed(projectId) || jobProjectId !== trimmed(projectId)) {
    return { ok: false, diagnostics: [diagnostic('source_project_mismatch', 'Source job does not belong to the active project.')] };
  }
  if (toolJob.status !== 'completed') {
    diagnostics.push(diagnostic('source_job_not_completed', `Source job status is ${toolJob.status || 'unknown'}.`));
  }
  const result = parseJobResult(toolJob);
  if (!result.artifactTruth || result.artifactTruth.status !== 'valid' || result.artifactTruth.blocking === true) {
    diagnostics.push(diagnostic('source_artifact_truth_invalid', 'Source job has no valid, non-blocking artifact truth.'));
  }
  const artifact = exactArtifact(result, artifactId);
  if (!artifact) {
    diagnostics.push(diagnostic('source_artifact_not_found', 'Artifact id was not found exactly once in the source job; filenames are not used as identity.'));
  }
  const provenance = result.executionProvenance || null;
  if (!provenance || provenance.toolJobId !== toolJob.id) {
    diagnostics.push(diagnostic('source_provenance_missing', 'Execution provenance is missing or does not bind to the source job.'));
  }
  if (provenance && !verifyExecutionProvenance(provenance).ok) {
    diagnostics.push(diagnostic('source_provenance_integrity_invalid', 'Execution provenance no longer matches its server-issued digest.'));
  }
  if (provenance && trimmed(provenance.projectId) && trimmed(provenance.projectId) !== trimmed(projectId)) {
    diagnostics.push(diagnostic('source_provenance_project_mismatch', 'Execution provenance belongs to another project.'));
  }
  const provenanceArtifact = provenance && Array.isArray(provenance.artifacts)
    ? provenance.artifacts.filter((item) => item && item.id === artifactId)
    : [];
  if (provenance && provenanceArtifact.length !== 1) {
    diagnostics.push(diagnostic('source_artifact_provenance_missing', 'Artifact is not uniquely bound by id in execution provenance.'));
  }
  const script = provenance && provenance.script;
  if (!script || !trimmed(script.snapshotPath) || !trimmed(script.sha256)) {
    diagnostics.push(diagnostic('source_script_missing', 'A reproducible source script snapshot and hash are required.'));
  }
  const inputs = provenance && Array.isArray(provenance.inputs) ? provenance.inputs : [];
  if (inputs.length === 0 || inputs.some((input) => !input || !trimmed(input.relativePath) || !trimmed(input.sha256))) {
    diagnostics.push(diagnostic('source_inputs_missing', 'Hashed execution inputs are required to plan a reproducible edit.'));
  }

  return {
    ok: diagnostics.length === 0,
    diagnostics,
    source: {
      toolJobId: toolJob.id,
      toolId: toolJob.tool_id || toolJob.toolId || null,
      artifact: artifact ? { id: artifact.id, type: artifact.type || null } : null,
      provenanceHash: provenance && provenance.provenanceHash || null,
      script: script ? {
        snapshotPath: script.snapshotPath,
        sha256: script.sha256,
        entryPoint: script.entryPoint || null,
      } : null,
      inputs: inputs.map((input) => ({
        id: input.id || null,
        role: input.role || null,
        relativePath: input.relativePath,
        sha256: input.sha256,
        sourceArtifactRef: input.sourceArtifactRef || null,
        hasStructuredLineage: hasStructuredInputLineage(input),
        lineageKind: hasStructuredInputLineage(input) ? input.lineage.kind : null,
      })),
    },
  };
}

function validateWorkflow(workflowPlan) {
  const steps = workflowPlan && Array.isArray(workflowPlan.steps) ? workflowPlan.steps : null;
  // Preserve the useful distinction between "there is no graph" and
  // "someone supplied an invented graph".  Both are fail-closed for science,
  // but only the latter is an authority violation.
  if (!steps || steps.length === 0) {
    return { ok: false, diagnostics: [diagnostic('workflow_dag_missing', 'A real workflow DAG is required for affected-subgraph planning.')] };
  }
  if (!isAuthoritativeWorkflowPlan(workflowPlan)) {
    return {
      ok: false,
      diagnostics: [diagnostic(
        'workflow_dag_not_authoritative',
        'Scientific impact requires a workflow graph projected from persisted SQLite Job, Artifact and Selection Truth.'
      )],
    };
  }
  const ids = steps.map((step) => trimmed(step && step.id));
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length) {
    return { ok: false, diagnostics: [diagnostic('workflow_node_ambiguous', 'Workflow node ids must be present and unique.')] };
  }
  const idSet = new Set(ids);
  const downstream = new Map(ids.map((id) => [id, []]));
  for (const step of steps) {
    const dependencies = Array.isArray(step.dependsOn) ? step.dependsOn : [];
    for (const dependency of dependencies) {
      if (!idSet.has(dependency)) {
        return { ok: false, diagnostics: [diagnostic('workflow_dependency_missing', `Workflow dependency does not exist: ${dependency}`)] };
      }
      downstream.get(dependency).push(step.id);
    }
  }
  const visiting = new Set();
  const visited = new Set();
  function visit(id) {
    if (visiting.has(id)) return false;
    if (visited.has(id)) return true;
    visiting.add(id);
    for (const child of downstream.get(id)) if (!visit(child)) return false;
    visiting.delete(id);
    visited.add(id);
    return true;
  }
  if (!ids.every(visit)) {
    return { ok: false, diagnostics: [diagnostic('workflow_cycle_detected', 'Workflow DAG contains a cycle.')] };
  }
  return { ok: true, steps, downstream, diagnostics: [] };
}

function computeResultAffectedSubgraph({ workflowPlan, sourceToolJobId, sourceNodeId, editClass } = {}) {
  if (editClass === 'view_only') {
    return { ok: true, sourceNodeId: null, affectedNodeIds: [], affectedScope: 'none', diagnostics: [] };
  }
  const workflowSteps = workflowPlan && Array.isArray(workflowPlan.steps) ? workflowPlan.steps : null;
  // A presentation-only rerender has a truthful bounded scope even when this
  // historical Job was not created from a persisted workflow DAG: it affects
  // the current result only. Scientific/data/workflow changes still require a
  // real DAG so downstream impact can never be guessed away.
  if (editClass === 'presentation_rerender' && (!workflowSteps || workflowSteps.length === 0)) {
    return {
      ok: true,
      sourceNodeId: null,
      affectedNodeIds: [],
      affectedScope: 'current_result_only',
      diagnostics: [],
    };
  }
  const validated = validateWorkflow(workflowPlan);
  if (!validated.ok) {
    return {
      ok: false, sourceNodeId: null, affectedNodeIds: [], affectedScope: 'unknown', diagnostics: validated.diagnostics,
    };
  }
  let matches = [];
  if (trimmed(sourceNodeId)) matches = validated.steps.filter((step) => step.id === sourceNodeId);
  else matches = validated.steps.filter((step) => (step.toolJobId || step.tool_job_id) === sourceToolJobId);
  if (matches.length !== 1) {
    return {
      ok: false,
      sourceNodeId: null,
      affectedNodeIds: [],
      affectedScope: 'unknown',
      diagnostics: [diagnostic('source_workflow_node_ambiguous', 'The source job must map to exactly one workflow node.')],
    };
  }
  const root = matches[0].id;
  if (editClass === 'presentation_rerender') {
    return {
      ok: true, sourceNodeId: root, affectedNodeIds: [root], affectedScope: 'current_result_only', diagnostics: [],
    };
  }
  const affected = [];
  const queue = [root];
  const seen = new Set();
  while (queue.length) {
    const id = queue.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    affected.push(id);
    queue.push(...validated.downstream.get(id));
  }
  return {
    ok: true, sourceNodeId: root, affectedNodeIds: affected, affectedScope: 'workflow_subgraph', diagnostics: [],
  };
}

function validateResultEditIntent(intent) {
  const errors = [];
  if (!intent || typeof intent !== 'object' || Array.isArray(intent)) {
    return { ok: false, errors: [diagnostic('intent_invalid', 'Intent must be an object.')] };
  }
  if (intent.contractVersion !== String(RESULT_EDIT_INTENT_VERSION)) errors.push(diagnostic('intent_version_unsupported', 'Unsupported intent contract version.'));
  if (!trimmed(intent.intentId)) errors.push(diagnostic('intent_id_required', 'intentId is required.'));
  if (!intent.artifactRef || !trimmed(intent.artifactRef.artifactId) || !trimmed(intent.artifactRef.revisionId)) errors.push(diagnostic('artifact_ref_incomplete', 'artifactId and revisionId are required.'));
  if (!RESULT_EDIT_CLASSES.includes(intent.editClass)) errors.push(diagnostic('edit_class_invalid', 'Unknown edit class.'));
  if (!Array.isArray(intent.affectedNodeIds)) errors.push(diagnostic('affected_nodes_invalid', 'affectedNodeIds must be an array.'));
  // Additive P4R-3 field: historical persisted/test intents without it remain
  // valid, while newly planned intents always carry an explicit honest scope.
  if (intent.affectedScope != null
      && !['none', 'current_result_only', 'workflow_subgraph'].includes(intent.affectedScope)) {
    errors.push(diagnostic('affected_scope_invalid', 'affectedScope must describe the truthful impact boundary.'));
  }
  const graph = intent.workflowGraph;
  if (graph != null && (!graph || typeof graph !== 'object' || Array.isArray(graph)
      || !trimmed(graph.graphId).startsWith('wfg_') || !/^[a-f0-9]{64}$/.test(trimmed(graph.sourceDigest)))) {
    errors.push(diagnostic('workflow_graph_ref_invalid', 'workflowGraph must reference a source-bound authoritative graph.'));
  }
  if (['data_transform', 'scientific_recompute', 'workflow_replan'].includes(intent.editClass)
      && (!graph || !trimmed(graph.graphId).startsWith('wfg_') || !/^[a-f0-9]{64}$/.test(trimmed(graph.sourceDigest)))) {
    errors.push(diagnostic('workflow_graph_ref_required', 'Scientific, data and workflow edits require an authoritative persisted workflow graph reference.'));
  }
  if (typeof intent.requiresJob !== 'boolean') errors.push(diagnostic('requires_job_invalid', 'requiresJob must be boolean.'));
  if (typeof intent.requiresScientificConfirmation !== 'boolean') errors.push(diagnostic('scientific_confirmation_invalid', 'requiresScientificConfirmation must be boolean.'));
  if (!trimmed(intent.requestedOutcome)) errors.push(diagnostic('requested_outcome_required', 'requestedOutcome is required.'));
  return { ok: errors.length === 0, errors };
}

function planResultEdit(input = {}) {
  const classification = classifyParameterPatch(input);
  const source = locateResultSource({
    toolJob: input.toolJob,
    artifactId: input.artifactId,
    projectId: input.projectId,
  });
  const graph = computeResultAffectedSubgraph({
    workflowPlan: input.workflowPlan,
    sourceToolJobId: input.toolJob && input.toolJob.id,
    sourceNodeId: input.sourceNodeId,
    editClass: classification.editClass,
  });
  const diagnostics = [...source.diagnostics, ...graph.diagnostics];
  if (source.ok && graph.ok && graph.sourceNodeId && input.workflowPlan) {
    const sourceStep = input.workflowPlan.steps.find((step) => step.id === graph.sourceNodeId);
    const hasUpstreamDependency = sourceStep && Array.isArray(sourceStep.dependsOn) && sourceStep.dependsOn.length > 0;
    const hasExplicitArtifactLineage = source.source.inputs.some((item) =>
      trimmed(item.sourceArtifactRef) || item.hasStructuredLineage === true);
    if (hasUpstreamDependency && !hasExplicitArtifactLineage) {
      diagnostics.push(diagnostic(
        'source_lineage_missing',
        'A source node with upstream dependencies requires signed structured lineage or an explicit sourceArtifactRef; filenames are never used to infer lineage.'
      ));
    }
  }
  if (!trimmed(input.revisionId)) diagnostics.push(diagnostic('source_revision_missing', 'A persisted source revision id is required.'));
  if (!trimmed(input.requestedOutcome)) diagnostics.push(diagnostic('requested_outcome_required', 'requestedOutcome is required.'));
  const blocked = diagnostics.length > 0;
  const intentCore = {
    contractVersion: String(RESULT_EDIT_INTENT_VERSION),
    artifactRef: { artifactId: trimmed(input.artifactId), revisionId: trimmed(input.revisionId) },
    ...(trimmed(input.userMessageId) ? { userMessageId: trimmed(input.userMessageId) } : {}),
    ...(trimmed(input.selectionId) ? { selectionRef: trimmed(input.selectionId) } : {}),
    requestedOutcome: trimmed(input.requestedOutcome),
    editClass: classification.editClass,
    proposedParameterPatch: input.proposedParameterPatch && typeof input.proposedParameterPatch === 'object' && !Array.isArray(input.proposedParameterPatch)
      ? input.proposedParameterPatch
      : {},
    affectedNodeIds: blocked ? [] : graph.affectedNodeIds,
    affectedScope: blocked ? 'unknown' : graph.affectedScope,
    requiresJob: classification.requiresJob,
    requiresScientificConfirmation: classification.requiresScientificConfirmation,
    classificationReason: classification.classificationReason,
    ...(graph.ok && isAuthoritativeWorkflowPlan(input.workflowPlan)
      ? { workflowGraph: { graphId: input.workflowPlan.graphId, sourceDigest: input.workflowPlan.sourceDigest } }
      : {}),
  };
  const intent = { ...intentCore, intentId: `rei_${digest(intentCore).slice(0, 24)}` };
  const validation = validateResultEditIntent(intent);
  return {
    ok: !blocked && validation.ok,
    status: blocked || !validation.ok ? 'blocked' : classification.requiresScientificConfirmation ? 'confirmation_required' : 'ready',
    intent,
    source: source.source || null,
    sourceNodeId: graph.sourceNodeId,
    parameterImpacts: classification.parameterImpacts,
    diagnostics: [...diagnostics, ...validation.errors],
    execution: { performed: false, toolJobCreated: false, changeSetCreated: false },
  };
}

module.exports = {
  RESULT_EDIT_INTENT_VERSION,
  RESULT_EDIT_CLASSES,
  classifyParameterPatch,
  locateResultSource,
  computeResultAffectedSubgraph,
  validateResultEditIntent,
  planResultEdit,
};
