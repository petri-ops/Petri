'use strict';

// BLOCK-92 Wave C-4 — 行映射/规范校验/ref-transaction 完整性断言簇外迁
// （原 result-studio-repository.js 48-307 行，纯搬运零行为变化）。

const { computeResultRefTransactionHash } = require('../result-ref-transaction-schema');

const GIT_OID_PATTERN = /^[a-f0-9]{40}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const PETRI_REF_PATTERN = /^refs\/heads\/petri\/[A-Za-z0-9][A-Za-z0-9._\-/]*$/;

class ResultStudioRepositoryError extends Error {
  constructor(code, message, detail = null) {
    super(message);
    this.name = 'ResultStudioRepositoryError';
    this.code = code;
    this.detail = detail;
  }
}

function toJson(value) {
  return JSON.stringify(value == null ? null : value);
}

function fromJson(value, fallback) {
  if (value == null) return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed == null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function rowToChangeSet(row) {
  if (!row) return null;
  return {
    contractVersion: row.contract_version,
    changeSetId: row.change_set_id,
    projectId: row.project_id,
    conversationId: row.conversation_id || null,
    intentRef: row.intent_ref || null,
    baseCommit: row.base_commit,
    candidateCommit: row.candidate_commit || null,
    workingBranchRef: row.working_branch_ref,
    status: row.status,
    statusReason: row.status_reason || null,
    changedPaths: fromJson(row.changed_paths_json, []),
    parentArtifactRefs: fromJson(row.parent_artifact_refs_json, []),
    candidateArtifactRefs: fromJson(row.candidate_artifact_refs_json, []),
    jobRefs: fromJson(row.job_refs_json, []),
    validationSummary: fromJson(row.validation_summary_json, null),
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    adoptedAt: row.adopted_at || null,
    revertedAt: row.reverted_at || null,
  };
}

function rowToRevision(row) {
  if (!row) return null;
  return {
    contractVersion: row.contract_version,
    revisionId: row.revision_id,
    projectId: row.project_id,
    artifactFamilyId: row.artifact_family_id,
    artifactId: row.artifact_id,
    parentRevisionIds: fromJson(row.parent_revision_ids_json, []),
    sourceCommit: row.source_commit || null,
    sourceScriptRef: fromJson(row.source_script_ref_json, null),
    inputArtifactRefs: fromJson(row.input_artifact_refs_json, []),
    parametersRef: row.parameters_ref || null,
    parametersHash: row.parameters_hash || null,
    toolJobId: row.tool_job_id || null,
    outputPath: row.output_path,
    outputHash: row.output_hash || null,
    validationStatus: row.validation_status,
    reproducibilityStatus: row.reproducibility_status,
    changeSetId: row.change_set_id,
    revisionOrdinal: row.revision_ordinal,
    isCurrent: row.is_current === 1,
    createdAt: row.created_at,
  };
}

function rowToSelection(row) {
  if (!row) return null;
  const displayState = fromJson(row.display_state_json, null);
  return {
    contractVersion: row.contract_version,
    selectionId: row.selection_id,
    projectId: row.project_id,
    conversationId: row.conversation_id || null,
    artifactId: row.artifact_id,
    revisionId: row.revision_id || null,
    entityType: row.entity_type,
    entityIds: fromJson(row.entity_ids_json, []),
    entityIdCount: row.entity_id_count,
    entityIdsTruncated: row.entity_ids_truncated === 1,
    entityIdsHash: row.entity_ids_hash || null,
    filterHash: displayState?.filterHash || null,
    filterExpression: fromJson(row.filter_expression_json, null),
    sort: fromJson(row.sort_json, []),
    viewport: fromJson(row.viewport_json, null),
    displayState,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToCheckpoint(row) {
  if (!row) return null;
  return {
    contractVersion: row.contract_version,
    checkpointId: row.checkpoint_id,
    projectId: row.project_id,
    conversationId: row.conversation_id || null,
    baseCommit: row.base_commit || null,
    candidateCommit: row.candidate_commit || null,
    changeSetId: row.change_set_id || null,
    changeSetStatus: row.change_set_status || null,
    currentRevisionIds: fromJson(row.current_revision_ids_json, []),
    selectionId: row.selection_id || null,
    pendingPreview: fromJson(row.pending_preview_json, null),
    jobRefs: fromJson(row.job_refs_json, []),
    loopRefs: fromJson(row.loop_refs_json, []),
    checkpointHash: row.checkpoint_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToBinding(row) {
  if (!row) return null;
  return {
    contractVersion: row.contract_version,
    projectId: row.project_id,
    mode: row.mode,
    workspaceRoot: row.workspace_root,
    gitDir: row.git_dir,
    workTree: row.work_tree,
    managedPaths: fromJson(row.managed_paths_json, []),
    status: row.status,
    reason: row.reason || null,
    gitVersion: row.git_version || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToWorkflowGraph(row) {
  if (!row) return null;
  return {
    graphId: row.graph_id,
    contractVersion: row.contract_version,
    projectId: row.project_id,
    rootToolJobId: row.root_tool_job_id,
    sourceDigest: row.source_digest,
    nodes: fromJson(row.nodes_json, []),
    edges: fromJson(row.edges_json, []),
    validationStatus: row.validation_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToRefTransaction(row) {
  if (!row) return null;
  return {
    contractVersion: row.contract_version,
    operationId: row.operation_id,
    projectId: row.project_id,
    changeSetId: row.change_set_id,
    operationKind: row.operation_kind,
    state: row.state,
    sourceStatus: row.source_status,
    targetStatus: row.target_status,
    refUpdates: fromJson(row.ref_updates_json, []),
    targetRevisionIds: fromJson(row.target_revision_ids_json, []),
    checkpoint: fromJson(row.checkpoint_json, null),
    ownerLease: fromJson(row.owner_lease_json, null),
    intentHash: row.intent_hash,
    statusReason: row.status_reason || null,
    failureReason: row.failure_reason || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at || null,
  };
}

function sameStringSet(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return leftSet.size === left.length
    && rightSet.size === right.length
    && [...leftSet].every((value) => rightSet.has(value));
}

function isCanonicalIdentifier(value) {
  return typeof value === 'string' && value !== '' && value.trim() === value;
}

function isCanonicalUniqueIdentifierArray(values) {
  return Array.isArray(values)
    && values.length > 0
    && values.every(isCanonicalIdentifier)
    && new Set(values).size === values.length;
}

function assertRefTransactionIntegrity(intent) {
  if (!intent || !SHA256_PATTERN.test(String(intent.intentHash || ''))
      || computeResultRefTransactionHash(intent) !== intent.intentHash) {
    throw new ResultStudioRepositoryError(
      'ref_transaction_integrity_failed',
      'The durable ref transition journal failed its immutable intent hash.',
      { operationId: intent?.operationId || null },
    );
  }
  return intent;
}

function assertRefTransactionRevisionBindings(intent, getRevision) {
  const currentRefUpdates = intent.refUpdates.filter(
    (entry) => entry.ref.startsWith('refs/heads/petri/current/'),
  );
  if (currentRefUpdates.length !== intent.targetRevisionIds.length) {
    throw new ResultStudioRepositoryError(
      'ref_transaction_revision_cohort_mismatch',
      'Every current ref update requires one exact target Revision.'
    );
  }
  const targetRevisions = intent.targetRevisionIds.map((revisionId) => getRevision(revisionId));
  if (targetRevisions.some((revision) => !revision || revision.projectId !== intent.projectId)
      || new Set(targetRevisions.map((revision) => revision.artifactFamilyId)).size !== targetRevisions.length) {
    throw new ResultStudioRepositoryError(
      'ref_transaction_target_revision_invalid',
      'Target Revisions must form one unique same-project Artifact family cohort.'
    );
  }
  for (let index = 0; index < targetRevisions.length; index += 1) {
    const revision = targetRevisions[index];
    const update = currentRefUpdates[index];
    const ref = `refs/heads/petri/current/${revision.artifactFamilyId}`;
    // Array position is part of the immutable intent hash, so it also freezes
    // each target Revision's exact family/ref/commit binding across a restart.
    if (!update || update.ref !== ref || update.newOid !== revision.sourceCommit) {
      throw new ResultStudioRepositoryError(
        'ref_transaction_target_revision_mismatch',
        'Target Revision commits must match the exact current ref cohort.',
        { revisionId: revision.revisionId, artifactFamilyId: revision.artifactFamilyId },
      );
    }
  }
  return targetRevisions;
}

/**
 * 创建仓库。
 *
 * @param {object} db better-sqlite3 实例（同步 API）
 * @param {{ ensureSchema?: boolean }} [options]
 */

module.exports = {
  PETRI_REF_PATTERN,
  SHA256_PATTERN,
  GIT_OID_PATTERN,
  ResultStudioRepositoryError,
  toJson,
  fromJson,
  nowIso,
  rowToChangeSet,
  rowToRevision,
  rowToSelection,
  rowToCheckpoint,
  rowToBinding,
  rowToWorkflowGraph,
  rowToRefTransaction,
  sameStringSet,
  isCanonicalIdentifier,
  isCanonicalUniqueIdentifierArray,
  assertRefTransactionIntegrity,
  assertRefTransactionRevisionBindings,
};
