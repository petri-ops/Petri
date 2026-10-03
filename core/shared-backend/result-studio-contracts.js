'use strict';

/**
 * shared-backend/result-studio-contracts.js
 *
 * G0-RS2 — Result Studio 的四个持久化契约与状态机。
 *
 * 契约：
 * - ChangeSet v1（原 ScientificChangeSet，BLOCK-83 D1 改名）  — 一次原子修改
 * - ArtifactRevision v1     — 一个产物版本
 * - SelectionContext v1     — 用户在结果上的结构化选择
 * - WorkspaceCheckpoint v1  — 可恢复的工作台状态
 *
 * 决策来源：docs/g0-rs0-result-studio-audit.md
 * - ADR-RS-1：Git 管文本版本，Artifact Truth 管科学有效性，SQLite 只做索引与投影。
 * - 审计缺陷 1：计划 §6.5 把 `validationStatus` 写成
 *   `valid|degraded|blocked|unavailable`，混了两套词汇。本模块拆成
 *   `validationStatus`（来自 reconcileArtifactTruth）与
 *   `reproducibilityStatus`（来自 delivery-manifest），不新造第三套词表。
 *
 * 不变量：
 * - 本模块只做结构与状态合法性判断，不判定科学有效性。
 *   `validationStatus` 必须由 `reconcileArtifactTruth()` 产出后传入，
 *   任何调用方都不得在这里"升级"一个结果的可信状态。
 * - 状态机只允许显式声明的迁移；`adopted` / `reverted` / `abandoned` 为终态。
 * - adopt / revert 幂等：对已处于目标终态的 ChangeSet 重复调用不报错、不改状态。
 */

const crypto = require('crypto');
const path = require('path');
const { stableStringify } = require('./canonical-json');

const RESULT_STUDIO_CONTRACT_VERSION = 1;

/** ChangeSet 生命周期。与计划 §6.4 一致。 */
const CHANGE_SET_STATUSES = Object.freeze([
  'draft',
  'running',
  'preview_ready',
  'validation_failed',
  'adopted',
  'reverted',
  'abandoned',
]);

/**
 * 允许的状态迁移。
 *
 * 说明：
 * - `validation_failed → draft` 允许重试同一个 ChangeSet（改参数再跑）。
 * - `adopted → reverted` 是"撤销已采用版本"。按计划 §7.4，撤销在 Git 上用**新
 *   commit** 表达，不改写已发布历史；这里只记录 ChangeSet 的终态流转。
 * - 终态不再外流，避免"部分采用"的混合状态。
 */
const CHANGE_SET_TRANSITIONS = Object.freeze({
  draft: Object.freeze(['running', 'abandoned']),
  running: Object.freeze(['preview_ready', 'validation_failed', 'abandoned']),
  preview_ready: Object.freeze(['adopted', 'reverted', 'abandoned']),
  validation_failed: Object.freeze(['draft', 'reverted', 'abandoned']),
  adopted: Object.freeze(['reverted']),
  reverted: Object.freeze([]),
  abandoned: Object.freeze([]),
});

/**
 * 完全关闭：不存在任何向外迁移。
 *
 * `adopted` 不在其中——撤销一次已采用的修改是真实的用户动作
 * （计划 §4.5 的 [撤销]），因此 `adopted → reverted` 合法。
 * 把 adopted 当成"完全关闭"会与迁移表自相矛盾。
 */
const CHANGE_SET_CLOSED_STATUSES = Object.freeze(['reverted', 'abandoned']);

/**
 * 已定局：不再处于进行中，不参与中断恢复扫描。
 * 包含 `adopted`，但它仍可被撤销。
 */
const CHANGE_SET_SETTLED_STATUSES = Object.freeze(['adopted', 'reverted', 'abandoned']);

/** 来自 reconcileArtifactTruth()。不含 `unavailable`。 */
const VALIDATION_STATUSES = Object.freeze(['valid', 'degraded', 'blocked']);

/** 来自 delivery-manifest 的 artifact 级 reproducibility。 */
const REPRODUCIBILITY_STATUSES = Object.freeze(['unavailable', 'available', 'verified']);
const SOURCE_SCRIPT_ORIGINS = Object.freeze(['canonical_plugin', 'execution_snapshot', 'project_materialized']);

const CHANGE_SET_ORIGINS = Object.freeze(['user', 'agent']);

// UI-462（2026-10-03 用户裁决）：「existing」绑定模式已随「自有仓库接入退役」移除，
// 绑定模式只剩 managed。
const BINDING_PERSIST_MODES = Object.freeze(['managed']);

/** 选择实体类型。允许插件扩展，因此校验只要求非空字符串。 */
const KNOWN_ENTITY_TYPES = Object.freeze([
  'row', 'column', 'gene', 'sample', 'feature', 'plot-mark', 'region',
]);

/**
 * 超过该数量的选择不再逐个持久化实体 ID，改为保留 filter + hash + 计数。
 * 计划 §6.2 要求 10 万行表格仍可用；把百万 ID 塞进会话既拖慢 UI 也污染 prompt。
 */
const MAX_PERSISTED_ENTITY_IDS = 2000;

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const COMMIT_PATTERN = /^[a-f0-9]{7,40}$/;

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function trimmed(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

function nullableTrimmed(value) {
  const normalized = trimmed(value);
  return normalized || null;
}

function stringArray(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => trimmed(item)).filter(Boolean))];
}

/**
 * 受管理的相对路径校验：拒绝绝对路径、`..` 逃逸与 NUL。
 * 与 git-adapter 的 pathspec 校验同源，但这里作用于持久化记录。
 */
function isSafeRelativePath(value) {
  if (typeof value !== 'string' || value === '') return false;
  if (value.includes('\0')) return false;
  const normalized = value.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) return false;
  if (normalized.split('/').includes('..')) return false;
  return path.posix.normalize(normalized) === normalized;
}

function fail(errors, code, message) {
  errors.push({ code, message });
}

// ---------------------------------------------------------------------------
// ChangeSet v1
// ---------------------------------------------------------------------------

/**
 * 规范化并校验一个 ChangeSet。
 *
 * @param {object} input
 * @returns {{ ok: boolean, errors: Array, changeSet: object|null }}
 */
function validateChangeSet(input) {
  const errors = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, errors: [{ code: 'change_set_invalid', message: 'ChangeSet must be an object.' }], changeSet: null };
  }

  const changeSetId = trimmed(input.changeSetId);
  const projectId = trimmed(input.projectId);
  const baseCommit = trimmed(input.baseCommit);
  const workingBranchRef = trimmed(input.workingBranchRef);
  const status = trimmed(input.status);
  const createdBy = trimmed(input.createdBy);

  if (!isNonEmptyString(changeSetId)) fail(errors, 'change_set_id_required', 'changeSetId is required.');
  if (!isNonEmptyString(projectId)) fail(errors, 'project_id_required', 'projectId is required.');
  if (!COMMIT_PATTERN.test(baseCommit)) fail(errors, 'base_commit_invalid', 'baseCommit must be a git object id.');
  if (!isNonEmptyString(workingBranchRef)) fail(errors, 'working_branch_required', 'workingBranchRef is required.');
  if (!CHANGE_SET_STATUSES.includes(status)) {
    fail(errors, 'status_invalid', `status must be one of: ${CHANGE_SET_STATUSES.join(', ')}.`);
  }
  if (!CHANGE_SET_ORIGINS.includes(createdBy)) {
    fail(errors, 'created_by_invalid', `createdBy must be one of: ${CHANGE_SET_ORIGINS.join(', ')}.`);
  }

  const candidateCommit = nullableTrimmed(input.candidateCommit);
  if (candidateCommit && !COMMIT_PATTERN.test(candidateCommit)) {
    fail(errors, 'candidate_commit_invalid', 'candidateCommit must be a git object id.');
  }
  // 已采用必须有不可变 candidate commit，否则"采用"无法恢复。
  if (status === 'adopted' && !candidateCommit) {
    fail(errors, 'adopted_requires_candidate_commit', 'An adopted ChangeSet requires candidateCommit.');
  }

  const changedPaths = [];
  const rawChangedPaths = Array.isArray(input.changedPaths) ? input.changedPaths : [];
  for (const entry of rawChangedPaths) {
    const relativePath = typeof entry === 'string' ? trimmed(entry) : trimmed(entry && entry.relativePath);
    if (!isSafeRelativePath(relativePath)) {
      fail(errors, 'changed_path_invalid', `changedPaths contains an unsafe path: ${relativePath || '<empty>'}`);
      continue;
    }
    const changeType = typeof entry === 'object' && entry ? trimmed(entry.changeType, 'modified') : 'modified';
    changedPaths.push({
      relativePath,
      changeType: ['added', 'modified', 'deleted', 'renamed'].includes(changeType) ? changeType : 'modified',
      beforeHash: typeof entry === 'object' && entry ? nullableTrimmed(entry.beforeHash) : null,
      afterHash: typeof entry === 'object' && entry ? nullableTrimmed(entry.afterHash) : null,
    });
  }

  const changeSet = {
    contractVersion: RESULT_STUDIO_CONTRACT_VERSION,
    changeSetId,
    projectId,
    conversationId: nullableTrimmed(input.conversationId),
    intentRef: nullableTrimmed(input.intentRef),
    baseCommit,
    candidateCommit,
    workingBranchRef,
    status,
    statusReason: nullableTrimmed(input.statusReason),
    changedPaths,
    parentArtifactRefs: stringArray(input.parentArtifactRefs),
    candidateArtifactRefs: stringArray(input.candidateArtifactRefs),
    jobRefs: stringArray(input.jobRefs),
    validationSummary: input.validationSummary && typeof input.validationSummary === 'object'
      ? input.validationSummary
      : null,
    createdBy,
    createdAt: nullableTrimmed(input.createdAt) || new Date().toISOString(),
    updatedAt: nullableTrimmed(input.updatedAt) || new Date().toISOString(),
    adoptedAt: nullableTrimmed(input.adoptedAt),
    revertedAt: nullableTrimmed(input.revertedAt),
  };

  return { ok: errors.length === 0, errors, changeSet: errors.length === 0 ? changeSet : null };
}

/**
 * 判断状态迁移是否合法。
 *
 * @returns {{ allowed: boolean, idempotent: boolean, reason: string|null }}
 */
function canTransitionChangeSet(from, to) {
  if (!CHANGE_SET_STATUSES.includes(from)) {
    return { allowed: false, idempotent: false, reason: 'unknown_source_status' };
  }
  if (!CHANGE_SET_STATUSES.includes(to)) {
    return { allowed: false, idempotent: false, reason: 'unknown_target_status' };
  }
  // 幂等：重复 adopt 一个已 adopted、或重复 revert 一个已 reverted 的 ChangeSet
  // 不是错误，调用方按同一结果返回。
  if (from === to) {
    return { allowed: true, idempotent: true, reason: null };
  }
  const allowed = CHANGE_SET_TRANSITIONS[from].includes(to);
  return {
    allowed,
    idempotent: false,
    reason: allowed ? null : 'transition_forbidden',
  };
}

// ---------------------------------------------------------------------------
// ArtifactRevision v1
// ---------------------------------------------------------------------------

/**
 * 规范化并校验一个 ArtifactRevision。
 *
 * 重要：`validationStatus` 必须来自 `reconcileArtifactTruth()`，
 * `reproducibilityStatus` 必须来自 delivery-manifest 的 artifact 级判定。
 * 本函数不推导、不放宽这两个字段。
 */
function validateArtifactRevision(input) {
  const errors = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, errors: [{ code: 'revision_invalid', message: 'Revision must be an object.' }], revision: null };
  }

  const revisionId = trimmed(input.revisionId);
  const projectId = trimmed(input.projectId);
  const artifactFamilyId = trimmed(input.artifactFamilyId);
  const artifactId = trimmed(input.artifactId);
  const changeSetId = trimmed(input.changeSetId);
  const outputPath = trimmed(input.outputPath);
  const validationStatus = trimmed(input.validationStatus);
  const reproducibilityStatus = trimmed(input.reproducibilityStatus, 'unavailable');

  if (!isNonEmptyString(revisionId)) fail(errors, 'revision_id_required', 'revisionId is required.');
  if (!isNonEmptyString(projectId)) fail(errors, 'project_id_required', 'projectId is required.');
  if (!isNonEmptyString(artifactFamilyId)) fail(errors, 'artifact_family_required', 'artifactFamilyId is required.');
  if (!isNonEmptyString(artifactId)) fail(errors, 'artifact_id_required', 'artifactId is required.');
  if (!isNonEmptyString(changeSetId)) fail(errors, 'change_set_id_required', 'changeSetId is required.');
  if (!isSafeRelativePath(outputPath)) {
    fail(errors, 'output_path_invalid', 'outputPath must be a safe project-relative path.');
  }
  if (!VALIDATION_STATUSES.includes(validationStatus)) {
    fail(errors, 'validation_status_invalid',
      `validationStatus must come from artifact truth (${VALIDATION_STATUSES.join(', ')}); "unavailable" belongs to reproducibilityStatus.`);
  }
  if (!REPRODUCIBILITY_STATUSES.includes(reproducibilityStatus)) {
    fail(errors, 'reproducibility_status_invalid',
      `reproducibilityStatus must be one of: ${REPRODUCIBILITY_STATUSES.join(', ')}.`);
  }

  const outputHash = nullableTrimmed(input.outputHash);
  if (outputHash && !SHA256_PATTERN.test(outputHash)) {
    fail(errors, 'output_hash_invalid', 'outputHash must be a lowercase sha256 hex digest.');
  }
  const sourceCommit = nullableTrimmed(input.sourceCommit);
  if (sourceCommit && !COMMIT_PATTERN.test(sourceCommit)) {
    fail(errors, 'source_commit_invalid', 'sourceCommit must be a git object id.');
  }

  // 一个 valid 版本必须能说明它是怎么来的，否则无法复现也无法比较。
  if (validationStatus === 'valid' && !input.toolJobId) {
    fail(errors, 'valid_revision_requires_job', 'A valid revision must reference the tool_job that produced it.');
  }
  // verified 强于 available：必须已有脚本与输出哈希才能声称已验证复现。
  if (reproducibilityStatus === 'verified' && !outputHash) {
    fail(errors, 'verified_requires_output_hash', 'A verified revision requires outputHash.');
  }

  const inputArtifactRefs = [];
  for (const entry of Array.isArray(input.inputArtifactRefs) ? input.inputArtifactRefs : []) {
    if (!entry || typeof entry !== 'object') continue;
    const refId = trimmed(entry.artifactId);
    const hash = nullableTrimmed(entry.hash);
    if (!refId) {
      fail(errors, 'input_ref_invalid', 'inputArtifactRefs entries require artifactId.');
      continue;
    }
    if (hash && !SHA256_PATTERN.test(hash)) {
      fail(errors, 'input_ref_hash_invalid', `inputArtifactRefs hash must be sha256: ${refId}`);
      continue;
    }
    inputArtifactRefs.push({ artifactId: refId, hash, role: nullableTrimmed(entry.role) });
  }

  const revisionOrdinal = Number(input.revisionOrdinal);
  if (!Number.isInteger(revisionOrdinal) || revisionOrdinal < 1) {
    fail(errors, 'revision_ordinal_invalid', 'revisionOrdinal must be a positive integer.');
  }

  let sourceScriptRef = null;
  if (input.sourceScriptRef && typeof input.sourceScriptRef === 'object') {
    sourceScriptRef = {
      relativePath: nullableTrimmed(input.sourceScriptRef.relativePath),
      sha256: nullableTrimmed(input.sourceScriptRef.sha256),
      entryPoint: nullableTrimmed(input.sourceScriptRef.entryPoint),
      artifactId: nullableTrimmed(input.sourceScriptRef.artifactId),
      rendererId: nullableTrimmed(input.sourceScriptRef.rendererId),
      language: nullableTrimmed(input.sourceScriptRef.language),
      origin: nullableTrimmed(input.sourceScriptRef.origin),
    };
    if (sourceScriptRef.relativePath && !isSafeRelativePath(sourceScriptRef.relativePath)) {
      fail(errors, 'source_script_path_invalid', 'sourceScriptRef.relativePath must be project-relative and path-safe.');
    }
    if (sourceScriptRef.sha256 && !SHA256_PATTERN.test(sourceScriptRef.sha256)) {
      fail(errors, 'source_script_hash_invalid', 'sourceScriptRef.sha256 must be a lowercase sha256 digest.');
    }
    if (sourceScriptRef.artifactId && sourceScriptRef.artifactId !== artifactId) {
      fail(errors, 'source_script_artifact_mismatch', 'sourceScriptRef.artifactId must match the revision artifactId.');
    }
    if (sourceScriptRef.origin && !SOURCE_SCRIPT_ORIGINS.includes(sourceScriptRef.origin)) {
      fail(errors, 'source_script_origin_invalid', `sourceScriptRef.origin must be one of: ${SOURCE_SCRIPT_ORIGINS.join(', ')}.`);
    }
    if (sourceScriptRef.origin === 'project_materialized'
      && (!sourceScriptRef.relativePath || !sourceScriptRef.sha256 || !sourceScriptRef.artifactId || !sourceScriptRef.rendererId)) {
      fail(errors, 'materialized_script_ref_incomplete', 'A project-materialized sourceScriptRef requires path, hash, artifactId and rendererId.');
    }
  }

  const revision = {
    contractVersion: RESULT_STUDIO_CONTRACT_VERSION,
    revisionId,
    projectId,
    artifactFamilyId,
    artifactId,
    parentRevisionIds: stringArray(input.parentRevisionIds),
    sourceCommit,
    sourceScriptRef,
    inputArtifactRefs,
    parametersRef: nullableTrimmed(input.parametersRef),
    parametersHash: nullableTrimmed(input.parametersHash),
    toolJobId: nullableTrimmed(input.toolJobId),
    outputPath,
    outputHash,
    validationStatus,
    reproducibilityStatus,
    changeSetId,
    revisionOrdinal: Number.isInteger(revisionOrdinal) && revisionOrdinal >= 1 ? revisionOrdinal : 1,
    isCurrent: input.isCurrent === true,
    createdAt: nullableTrimmed(input.createdAt) || new Date().toISOString(),
  };

  if (revision.parametersRef && !isSafeRelativePath(revision.parametersRef)) {
    fail(errors, 'parameters_path_invalid', 'parametersRef must be project-relative and path-safe.');
  }
  if (revision.parametersHash && !SHA256_PATTERN.test(revision.parametersHash)) {
    fail(errors, 'parameters_hash_invalid', 'parametersHash must be a lowercase sha256 digest.');
  }
  if ((revision.parametersRef && !revision.parametersHash) || (!revision.parametersRef && revision.parametersHash)) {
    fail(errors, 'parameters_ref_incomplete', 'parametersRef and parametersHash must be provided together.');
  }

  return { ok: errors.length === 0, errors, revision: errors.length === 0 ? revision : null };
}

// ---------------------------------------------------------------------------
// SelectionContext v1
// ---------------------------------------------------------------------------

/**
 * 规范化并校验一个 SelectionContext。
 *
 * 大型选择不逐个持久化 ID：超过 MAX_PERSISTED_ENTITY_IDS 时保留
 * filter + 计数 + 全量 ID 的稳定 hash，并标记 truncated。
 * 这样 Agent 上下文拿到的是有界摘要，但仍能校验选择是否变化。
 */
function validateSelectionContext(input) {
  const errors = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, errors: [{ code: 'selection_invalid', message: 'Selection must be an object.' }], selection: null };
  }

  const selectionId = trimmed(input.selectionId);
  const projectId = trimmed(input.projectId);
  const artifactId = trimmed(input.artifactId);
  const entityType = trimmed(input.entityType);

  if (!isNonEmptyString(selectionId)) fail(errors, 'selection_id_required', 'selectionId is required.');
  if (!isNonEmptyString(projectId)) fail(errors, 'project_id_required', 'projectId is required.');
  if (!isNonEmptyString(artifactId)) fail(errors, 'artifact_id_required', 'artifactId is required.');
  if (!isNonEmptyString(entityType)) fail(errors, 'entity_type_required', 'entityType is required.');

  const allEntityIds = stringArray(input.entityIds);
  const suppliedCount = Number(input.entityIdCount);
  const authoritativeCount = Number.isInteger(suppliedCount) && suppliedCount >= allEntityIds.length
    ? suppliedCount
    : allEntityIds.length;
  const suppliedHash = nullableTrimmed(input.entityIdsHash);
  const filterHash = nullableTrimmed(input.filterHash);
  const explicitIdsHash = allEntityIds.length > 0
    ? sha256Hex(stableStringify([...allEntityIds].sort()))
    : null;
  const queryBacked = authoritativeCount > allEntityIds.length;

  if (suppliedHash && !SHA256_PATTERN.test(suppliedHash)) {
    fail(errors, 'entity_ids_hash_invalid', 'entityIdsHash must be a lowercase sha256 digest.');
  }
  if (filterHash && !SHA256_PATTERN.test(filterHash)) {
    fail(errors, 'filter_hash_invalid', 'filterHash must be a lowercase sha256 digest.');
  }
  if (queryBacked && !input.filterExpression) {
    fail(errors, 'query_selection_requires_filter', 'A query-backed selection requires filterExpression.');
  }
  if (queryBacked && (!suppliedHash || !filterHash)) {
    fail(errors, 'query_selection_requires_evidence', 'A query-backed selection requires entityIdsHash and filterHash.');
  }
  if (!queryBacked && suppliedHash && explicitIdsHash && suppliedHash !== explicitIdsHash) {
    fail(errors, 'entity_ids_hash_mismatch', 'entityIdsHash does not match the explicit entity ID set.');
  }

  const truncated = authoritativeCount > MAX_PERSISTED_ENTITY_IDS || queryBacked;
  const persistedEntityIds = truncated ? allEntityIds.slice(0, MAX_PERSISTED_ENTITY_IDS) : allEntityIds;
  // Query 选择的全量 hash 由权威表查询器计算；显式小选择则在这里重算，
  // 永不信任浏览器为显式 ID 集合自报的摘要。
  const entityIdsHash = queryBacked ? suppliedHash : explicitIdsHash;

  if (truncated && !input.filterExpression) {
    // 没有 filter 就无法在截断后重建完整选择 → 选择将不可复现。
    fail(errors, 'large_selection_requires_filter',
      `A selection larger than ${MAX_PERSISTED_ENTITY_IDS} entities requires filterExpression to stay reproducible.`);
  }

  const selection = {
    contractVersion: RESULT_STUDIO_CONTRACT_VERSION,
    selectionId,
    projectId,
    conversationId: nullableTrimmed(input.conversationId),
    artifactId,
    revisionId: nullableTrimmed(input.revisionId),
    entityType,
    entityIds: persistedEntityIds,
    entityIdCount: authoritativeCount,
    entityIdsTruncated: truncated,
    entityIdsHash,
    filterHash,
    filterExpression: input.filterExpression && typeof input.filterExpression === 'object' ? input.filterExpression : null,
    sort: Array.isArray(input.sort)
      ? input.sort
        .filter((item) => item && isNonEmptyString(item.field))
        .map((item) => ({ field: trimmed(item.field), direction: item.direction === 'desc' ? 'desc' : 'asc' }))
      : [],
    viewport: input.viewport && typeof input.viewport === 'object' ? input.viewport : null,
    displayState: input.displayState && typeof input.displayState === 'object' ? input.displayState : null,
    createdAt: nullableTrimmed(input.createdAt) || new Date().toISOString(),
    updatedAt: nullableTrimmed(input.updatedAt) || new Date().toISOString(),
  };

  return { ok: errors.length === 0, errors, selection: errors.length === 0 ? selection : null };
}

/**
 * 判断一个持久 SelectionContext 是否仍能用于当前 Artifact/Revision。
 *
 * - compatible：同一 Revision，或跨 Revision 但权威 filter/entity hash 完全一致；
 * - stale：Artifact 相同但 Revision/内容证据发生变化，可展示、不可自动交给 Agent；
 * - invalid：跨项目/跨 Artifact、缺稳定身份或选择本身不可持久。
 */
function assessSelectionCompatibility({
  selection,
  projectId,
  artifactId,
  revisionId = null,
  entityIdsHash = null,
  filterHash = null,
  selectionDurable = true,
} = {}) {
  if (!selection || typeof selection !== 'object') {
    return { status: 'invalid', reason: 'selection_missing' };
  }
  if (selection.projectId !== projectId) {
    return { status: 'invalid', reason: 'project_mismatch' };
  }
  if (selection.artifactId !== artifactId) {
    return { status: 'invalid', reason: 'artifact_mismatch' };
  }
  if (!selectionDurable || selection.displayState?.durable === false) {
    return { status: 'invalid', reason: 'selection_not_durable' };
  }
  const hasIdentity = selection.entityIdCount > 0
    ? SHA256_PATTERN.test(selection.entityIdsHash || '')
    : Array.isArray(selection.displayState?.fields) && selection.displayState.fields.length > 0;
  if (!hasIdentity) return { status: 'invalid', reason: 'selection_identity_missing' };

  const sameRevision = (selection.revisionId || null) === (revisionId || null);
  const entityMatches = !entityIdsHash || selection.entityIdsHash === entityIdsHash;
  const filterMatches = !selection.filterHash || !filterHash || selection.filterHash === filterHash;
  if (sameRevision && entityMatches && filterMatches) {
    return { status: 'compatible', reason: 'same_revision' };
  }
  if (!sameRevision
      && entityIdsHash && selection.entityIdsHash === entityIdsHash
      && (!selection.filterHash || (filterHash && selection.filterHash === filterHash))) {
    return { status: 'compatible', reason: 'equivalent_entity_evidence' };
  }
  return {
    status: 'stale',
    reason: sameRevision ? 'selection_evidence_changed' : 'revision_changed',
  };
}

/**
 * 供 Agent 上下文使用的紧凑摘要。永不返回完整 ID 列表。
 */
function summarizeSelection(selection, { maxSampleIds = 12 } = {}) {
  if (!selection) return null;
  return {
    selectionId: selection.selectionId,
    artifactId: selection.artifactId,
    revisionId: selection.revisionId || null,
    entityType: selection.entityType,
    entityIdCount: selection.entityIdCount,
    truncated: selection.entityIdsTruncated === true,
    sampleEntityIds: (selection.entityIds || []).slice(0, maxSampleIds),
    entityIdsHash: selection.entityIdsHash || null,
    filterHash: selection.filterHash || null,
    hasFilter: !!selection.filterExpression,
    sort: selection.sort || [],
  };
}

// ---------------------------------------------------------------------------
// WorkspaceCheckpoint v1
// ---------------------------------------------------------------------------

/**
 * 计算 checkpoint 的稳定 hash。恢复时用它与 Git / SQLite / Artifact 三方核对。
 */
function computeCheckpointHash(checkpoint) {
  return sha256Hex(stableStringify({
    projectId: checkpoint.projectId,
    conversationId: checkpoint.conversationId,
    baseCommit: checkpoint.baseCommit,
    candidateCommit: checkpoint.candidateCommit,
    changeSetId: checkpoint.changeSetId,
    changeSetStatus: checkpoint.changeSetStatus,
    currentRevisionIds: checkpoint.currentRevisionIds,
    selectionId: checkpoint.selectionId,
    pendingPreview: checkpoint.pendingPreview,
    jobRefs: checkpoint.jobRefs,
    loopRefs: checkpoint.loopRefs,
  }));
}

function validateWorkspaceCheckpoint(input) {
  const errors = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, errors: [{ code: 'checkpoint_invalid', message: 'Checkpoint must be an object.' }], checkpoint: null };
  }

  const checkpointId = trimmed(input.checkpointId);
  const projectId = trimmed(input.projectId);
  if (!isNonEmptyString(checkpointId)) fail(errors, 'checkpoint_id_required', 'checkpointId is required.');
  if (!isNonEmptyString(projectId)) fail(errors, 'project_id_required', 'projectId is required.');

  const changeSetStatus = nullableTrimmed(input.changeSetStatus);
  if (changeSetStatus && !CHANGE_SET_STATUSES.includes(changeSetStatus)) {
    fail(errors, 'checkpoint_status_invalid', 'changeSetStatus must be a known ChangeSet status.');
  }

  const base = {
    contractVersion: RESULT_STUDIO_CONTRACT_VERSION,
    checkpointId,
    projectId,
    conversationId: nullableTrimmed(input.conversationId),
    baseCommit: nullableTrimmed(input.baseCommit),
    candidateCommit: nullableTrimmed(input.candidateCommit),
    changeSetId: nullableTrimmed(input.changeSetId),
    changeSetStatus,
    currentRevisionIds: stringArray(input.currentRevisionIds),
    selectionId: nullableTrimmed(input.selectionId),
    pendingPreview: input.pendingPreview && typeof input.pendingPreview === 'object' ? input.pendingPreview : null,
    jobRefs: stringArray(input.jobRefs),
    loopRefs: stringArray(input.loopRefs),
    createdAt: nullableTrimmed(input.createdAt) || new Date().toISOString(),
    updatedAt: nullableTrimmed(input.updatedAt) || new Date().toISOString(),
  };

  const checkpoint = { ...base, checkpointHash: computeCheckpointHash(base) };
  return { ok: errors.length === 0, errors, checkpoint: errors.length === 0 ? checkpoint : null };
}

/**
 * 恢复时的三方一致性判定。
 *
 * 不自动"修复"漂移：只分类并给出可解释状态，由上层决定阻断或重建。
 * 计划 §3.2：软件异常退出不能留下"部分采用"的混合状态。
 */
function assessCheckpointConsistency({ checkpoint, gitHeadCommit, changeSetStatus, currentRevisionIds } = {}) {
  if (!checkpoint) {
    return { status: 'unavailable', drift: [], recoverable: false };
  }
  const drift = [];
  if (checkpoint.changeSetId && changeSetStatus && checkpoint.changeSetStatus !== changeSetStatus) {
    drift.push({
      kind: 'change_set_status_drift',
      expected: checkpoint.changeSetStatus,
      actual: changeSetStatus,
    });
  }
  if (checkpoint.candidateCommit && gitHeadCommit && !gitHeadCommit.startsWith(checkpoint.candidateCommit)
    && !checkpoint.candidateCommit.startsWith(gitHeadCommit)) {
    drift.push({ kind: 'git_commit_drift', expected: checkpoint.candidateCommit, actual: gitHeadCommit });
  }
  if (Array.isArray(currentRevisionIds)) {
    const expected = [...checkpoint.currentRevisionIds].sort();
    const actual = [...stringArray(currentRevisionIds)].sort();
    if (stableStringify(expected) !== stableStringify(actual)) {
      drift.push({ kind: 'revision_set_drift', expected, actual });
    }
  }
  // 采用中途崩溃的特征：checkpoint 记着 adopted，但 ChangeSet 仍停在 running。
  const partialAdopt = checkpoint.changeSetStatus === 'adopted' && changeSetStatus === 'running';
  return {
    status: drift.length === 0 ? 'consistent' : partialAdopt ? 'partial_adopt_detected' : 'drifted',
    drift,
    recoverable: !partialAdopt,
  };
}

module.exports = {
  RESULT_STUDIO_CONTRACT_VERSION,
  CHANGE_SET_STATUSES,
  CHANGE_SET_TRANSITIONS,
  CHANGE_SET_CLOSED_STATUSES,
  CHANGE_SET_SETTLED_STATUSES,
  CHANGE_SET_ORIGINS,
  VALIDATION_STATUSES,
  REPRODUCIBILITY_STATUSES,
  SOURCE_SCRIPT_ORIGINS,
  BINDING_PERSIST_MODES,
  KNOWN_ENTITY_TYPES,
  MAX_PERSISTED_ENTITY_IDS,
  sha256Hex,
  isSafeRelativePath,
  validateChangeSet,
  // BLOCK-83 D1 兼容别名（一版后移除）：
  validateScientificChangeSet: validateChangeSet,
  canTransitionChangeSet,
  validateArtifactRevision,
  validateSelectionContext,
  assessSelectionCompatibility,
  summarizeSelection,
  computeCheckpointHash,
  validateWorkspaceCheckpoint,
  assessCheckpointConsistency,
};
