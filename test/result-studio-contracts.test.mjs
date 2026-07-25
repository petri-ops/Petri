/**
 * G0-RS2 — Result Studio 契约与状态机门禁。
 *
 * 覆盖 g0-result-studio-plan.md §6 的四个契约，以及 §3.2 的版本与恢复不变量。
 * 纯函数测试：不建库、不写盘、不访问网络。
 *
 * 关键约束（来自 docs/g0-rs0-result-studio-audit.md §2.4）：
 * validationStatus 与 reproducibilityStatus 是两套独立词表，不得混成一个枚举。
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  RESULT_STUDIO_CONTRACT_VERSION,
  CHANGE_SET_STATUSES,
  CHANGE_SET_CLOSED_STATUSES,
  CHANGE_SET_SETTLED_STATUSES,
  VALIDATION_STATUSES,
  REPRODUCIBILITY_STATUSES,
  MAX_PERSISTED_ENTITY_IDS,
  assessCheckpointConsistency,
  canTransitionChangeSet,
  computeCheckpointHash,
  summarizeSelection,
  validateArtifactRevision,
  validateScientificChangeSet,
  validateSelectionContext,
  validateWorkspaceCheckpoint,
} = require('../core/shared-backend/result-studio-contracts');

const COMMIT_A = 'a'.repeat(40);
const COMMIT_B = 'b'.repeat(40);
const HASH = 'c'.repeat(64);

function baseChangeSet(overrides = {}) {
  return {
    changeSetId: 'cs_1',
    projectId: 'project_1',
    conversationId: 'conv_1',
    baseCommit: COMMIT_A,
    workingBranchRef: 'refs/heads/biof3/changeset/cs_1',
    status: 'draft',
    createdBy: 'agent',
    ...overrides,
  };
}

function baseRevision(overrides = {}) {
  return {
    revisionId: 'rev_1',
    projectId: 'project_1',
    artifactFamilyId: 'family_volcano',
    artifactId: 'volcano_plot',
    outputPath: 'results/jobs/job_1/output/volcano.svg',
    outputHash: HASH,
    validationStatus: 'valid',
    reproducibilityStatus: 'available',
    changeSetId: 'cs_1',
    revisionOrdinal: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. 两套状态词表必须保持独立
// ---------------------------------------------------------------------------

test('RS2 keeps validation and reproducibility vocabularies separate', () => {
  assert.deepEqual(VALIDATION_STATUSES, ['valid', 'degraded', 'blocked']);
  assert.deepEqual(REPRODUCIBILITY_STATUSES, ['unavailable', 'available', 'verified']);
  // `unavailable` 属于复现性，绝不能出现在验证状态里（RS0 §2.4 登记的契约缺陷）
  assert.equal(VALIDATION_STATUSES.includes('unavailable'), false);
  assert.equal(REPRODUCIBILITY_STATUSES.includes('valid'), false);
});

test('RS2 rejects a revision that puts unavailable into validationStatus', () => {
  const result = validateArtifactRevision(baseRevision({ validationStatus: 'unavailable' }));
  assert.equal(result.ok, false);
  assert.equal(result.errors.some((error) => error.code === 'validation_status_invalid'), true);
});

test('RS2 rejects a revision that puts valid into reproducibilityStatus', () => {
  const result = validateArtifactRevision(baseRevision({ reproducibilityStatus: 'valid' }));
  assert.equal(result.ok, false);
  assert.equal(result.errors.some((error) => error.code === 'reproducibility_status_invalid'), true);
});

// ---------------------------------------------------------------------------
// 2. ChangeSet 契约
// ---------------------------------------------------------------------------

test('RS2 accepts a well formed change set and stamps the contract version', () => {
  const result = validateScientificChangeSet(baseChangeSet());
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.changeSet.contractVersion, RESULT_STUDIO_CONTRACT_VERSION);
  assert.equal(result.changeSet.status, 'draft');
  assert.equal(result.changeSet.candidateCommit, null);
});

test('RS2 requires identity, base commit and working branch on a change set', () => {
  for (const [field, value, code] of [
    ['changeSetId', '', 'change_set_id_required'],
    ['projectId', '', 'project_id_required'],
    ['baseCommit', '', 'base_commit_invalid'],
    ['workingBranchRef', '', 'working_branch_required'],
  ]) {
    const result = validateScientificChangeSet(baseChangeSet({ [field]: value }));
    assert.equal(result.ok, false, `${field} should be required`);
    assert.equal(result.errors.some((error) => error.code === code), true, `${field} → ${code}`);
  }
});

test('RS2 rejects malformed commits and unknown status or origin', () => {
  assert.equal(validateScientificChangeSet(baseChangeSet({ baseCommit: 'not-a-commit' })).ok, false);
  assert.equal(validateScientificChangeSet(baseChangeSet({ status: 'finished' })).ok, false);
  assert.equal(validateScientificChangeSet(baseChangeSet({ createdBy: 'robot' })).ok, false);
});

test('RS2 requires a candidate commit once a change set is adopted', () => {
  const withoutCandidate = validateScientificChangeSet(baseChangeSet({ status: 'adopted' }));
  assert.equal(withoutCandidate.ok, false);
  assert.equal(
    withoutCandidate.errors.some((error) => error.code === 'adopted_requires_candidate_commit'),
    true
  );
  const withCandidate = validateScientificChangeSet(
    baseChangeSet({ status: 'adopted', candidateCommit: COMMIT_B, adoptedAt: new Date().toISOString() })
  );
  assert.equal(withCandidate.ok, true, JSON.stringify(withCandidate.errors));
});

test('RS2 rejects changed paths that escape the workspace', () => {
  for (const bad of ['../outside.R', '/etc/passwd', 'analysis/../../x.R']) {
    const result = validateScientificChangeSet(baseChangeSet({ changedPaths: [{ relativePath: bad }] }));
    assert.equal(result.ok, false, `${bad} must be rejected`);
    assert.equal(result.errors.some((error) => error.code === 'changed_path_invalid'), true);
  }
});

// ---------------------------------------------------------------------------
// 3. 状态机：终态封闭、无部分采用
// ---------------------------------------------------------------------------

test('RS2 change set state machine allows only declared transitions', () => {
  assert.equal(canTransitionChangeSet('draft', 'running').allowed, true);
  assert.equal(canTransitionChangeSet('running', 'preview_ready').allowed, true);
  assert.equal(canTransitionChangeSet('running', 'validation_failed').allowed, true);
  assert.equal(canTransitionChangeSet('preview_ready', 'adopted').allowed, true);
  assert.equal(canTransitionChangeSet('preview_ready', 'reverted').allowed, true);

  // 不允许跳过预览直接采用
  assert.equal(canTransitionChangeSet('draft', 'adopted').allowed, false);
  assert.equal(canTransitionChangeSet('running', 'adopted').allowed, false);
  // 校验失败不能直接变成已采用
  assert.equal(canTransitionChangeSet('validation_failed', 'adopted').allowed, false);

  // 未知状态不得被当成合法迁移
  assert.equal(canTransitionChangeSet('nope', 'running').reason, 'unknown_source_status');
  assert.equal(canTransitionChangeSet('draft', 'nope').reason, 'unknown_target_status');
});

test('RS2 same-status transitions are idempotent, not forbidden', () => {
  // 重复 adopt/revert 必须幂等：崩溃重放或用户重复点击不能变成错误。
  for (const status of CHANGE_SET_STATUSES) {
    const decision = canTransitionChangeSet(status, status);
    assert.equal(decision.allowed, true, `${status} → ${status} should be idempotent`);
    assert.equal(decision.idempotent, true);
  }
});

test('RS2 closed change set statuses never transition outward', () => {
  for (const closed of CHANGE_SET_CLOSED_STATUSES) {
    for (const target of CHANGE_SET_STATUSES) {
      // 同状态是幂等重放，不算向外迁移。
      if (target === closed) continue;
      assert.equal(
        canTransitionChangeSet(closed, target).allowed,
        false,
        `${closed} → ${target} must be rejected`
      );
    }
  }
});

test('RS2 adopted is settled but still revertible', () => {
  // adopted 不是"完全关闭"：撤销一次已采用的修改是真实用户动作（计划 §4.5）。
  assert.equal(CHANGE_SET_SETTLED_STATUSES.includes('adopted'), true);
  assert.equal(CHANGE_SET_CLOSED_STATUSES.includes('adopted'), false);
  assert.equal(canTransitionChangeSet('adopted', 'reverted').allowed, true);
  // 但已采用的不能回到进行中状态，避免"部分采用"的混合态。
  for (const target of ['draft', 'running', 'preview_ready', 'validation_failed', 'abandoned']) {
    assert.equal(
      canTransitionChangeSet('adopted', target).allowed,
      false,
      `adopted → ${target} must be rejected`
    );
  }
});

// ---------------------------------------------------------------------------
// 4. ArtifactRevision 契约
// ---------------------------------------------------------------------------

test('RS2 accepts a well formed revision', () => {
  const result = validateArtifactRevision(baseRevision({
    sourceCommit: COMMIT_B,
    sourceScriptRef: { relativePath: 'analysis/scripts/volcano/plot.R', sha256: HASH },
    inputArtifactRefs: [{ artifactId: 'deg_table', hash: HASH, role: 'counts' }],
    toolJobId: 'job_1',
  }));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.revision.inputArtifactRefs.length, 1);
  assert.equal(result.revision.isCurrent, false);
});

test('RS5 sourceScriptRef binds one materialized renderer to its artifact', () => {
  const result = validateArtifactRevision(baseRevision({
    toolJobId: 'job_rs5',
    sourceScriptRef: {
      relativePath: 'analysis/scripts/family_volcano/rev_2/volcano_plot.R',
      sha256: HASH,
      artifactId: 'volcano_plot',
      rendererId: 'volcano-plot:volcano_plot',
      language: 'r',
      origin: 'project_materialized',
    },
  }));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.revision.sourceScriptRef.artifactId, 'volcano_plot');
  assert.equal(result.revision.sourceScriptRef.rendererId, 'volcano-plot:volcano_plot');

  const mismatch = validateArtifactRevision(baseRevision({
    toolJobId: 'job_rs5',
    sourceScriptRef: {
      relativePath: 'analysis/scripts/family_volcano/rev_2/plot.R',
      sha256: HASH,
      artifactId: 'other_plot',
      rendererId: 'volcano-plot:other_plot',
      origin: 'project_materialized',
    },
  }));
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.errors.some((error) => error.code === 'source_script_artifact_mismatch'), true);
});

test('RS2 requires family, artifact, output path and change set on a revision', () => {
  for (const [field, code] of [
    ['revisionId', 'revision_id_required'],
    ['projectId', 'project_id_required'],
    ['artifactFamilyId', 'artifact_family_required'],
    ['artifactId', 'artifact_id_required'],
    ['outputPath', 'output_path_invalid'],
    ['changeSetId', 'change_set_id_required'],
  ]) {
    const result = validateArtifactRevision(baseRevision({ [field]: '' }));
    assert.equal(result.ok, false, `${field} should be required`);
    assert.equal(result.errors.some((error) => error.code === code), true, `${field} → ${code}`);
  }
});

test('RS2 rejects revision output paths outside the project', () => {
  assert.equal(validateArtifactRevision(baseRevision({ outputPath: '/tmp/x.svg' })).ok, false);
  assert.equal(validateArtifactRevision(baseRevision({ outputPath: '../x.svg' })).ok, false);
});

test('RS2 rejects a non positive revision ordinal', () => {
  assert.equal(validateArtifactRevision(baseRevision({ revisionOrdinal: 0 })).ok, false);
  assert.equal(validateArtifactRevision(baseRevision({ revisionOrdinal: -1 })).ok, false);
});

test('RS2 rejects a malformed output hash', () => {
  const result = validateArtifactRevision(baseRevision({ outputHash: 'nope' }));
  assert.equal(result.ok, false);
  assert.equal(result.errors.some((error) => error.code === 'output_hash_invalid'), true);
});

// ---------------------------------------------------------------------------
// 5. SelectionContext 契约：大型选择必须可复现
// ---------------------------------------------------------------------------

test('RS2 accepts a small explicit selection and hashes it', () => {
  const result = validateSelectionContext({
    selectionId: 'sel_1',
    projectId: 'project_1',
    artifactId: 'deg_table',
    revisionId: 'rev_1',
    entityType: 'gene',
    entityIds: ['TP53', 'EGFR', 'TP53'],
  });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  // 去重后 2 个
  assert.equal(result.selection.entityIdCount, 2);
  assert.equal(result.selection.entityIdsTruncated, false);
  assert.match(result.selection.entityIdsHash, /^[a-f0-9]{64}$/);
});

test('RS2 accepts an empty selection', () => {
  const result = validateSelectionContext({
    selectionId: 'sel_empty',
    projectId: 'project_1',
    artifactId: 'deg_table',
    entityType: 'row',
    entityIds: [],
  });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.selection.entityIdCount, 0);
});

test('RS2 truncates a huge selection but demands a filter to stay reproducible', () => {
  const huge = Array.from({ length: MAX_PERSISTED_ENTITY_IDS + 500 }, (_, index) => `gene_${index}`);

  const withoutFilter = validateSelectionContext({
    selectionId: 'sel_big',
    projectId: 'project_1',
    artifactId: 'deg_table',
    entityType: 'gene',
    entityIds: huge,
  });
  assert.equal(withoutFilter.ok, false);
  assert.equal(
    withoutFilter.errors.some((error) => error.code === 'large_selection_requires_filter'),
    true
  );

  const withFilter = validateSelectionContext({
    selectionId: 'sel_big',
    projectId: 'project_1',
    artifactId: 'deg_table',
    entityType: 'gene',
    entityIds: huge,
    filterExpression: { field: 'padj', op: 'lt', value: 0.05 },
  });
  assert.equal(withFilter.ok, true, JSON.stringify(withFilter.errors));
  assert.equal(withFilter.selection.entityIdsTruncated, true);
  assert.equal(withFilter.selection.entityIds.length, MAX_PERSISTED_ENTITY_IDS);
  // 计数仍反映真实规模，不因截断而说谎
  assert.equal(withFilter.selection.entityIdCount, huge.length);
});

test('RS2 selection summary stays bounded and never leaks the full id list', () => {
  const huge = Array.from({ length: 5000 }, (_, index) => `gene_${index}`);
  const { selection } = validateSelectionContext({
    selectionId: 'sel_big',
    projectId: 'project_1',
    artifactId: 'deg_table',
    entityType: 'gene',
    entityIds: huge,
    filterExpression: { field: 'padj', op: 'lt', value: 0.05 },
  });
  const summary = summarizeSelection(selection);
  assert.equal(summary.entityIdCount, 5000);
  assert.equal(summary.truncated, true);
  assert.equal(summary.sampleEntityIds.length, 12);
  assert.equal(summary.hasFilter, true);
  assert.equal(JSON.stringify(summary).length < 2000, true);
});

// ---------------------------------------------------------------------------
// 6. Checkpoint 契约与三方一致性
// ---------------------------------------------------------------------------

test('RS2 checkpoint hash is stable and order independent', () => {
  const left = { projectId: 'p1', changeSetId: 'cs_1', currentRevisionIds: ['rev_1', 'rev_2'] };
  const right = { changeSetId: 'cs_1', currentRevisionIds: ['rev_1', 'rev_2'], projectId: 'p1' };
  assert.equal(computeCheckpointHash(left), computeCheckpointHash(right));
  const changed = { ...left, currentRevisionIds: ['rev_1', 'rev_3'] };
  assert.notEqual(computeCheckpointHash(left), computeCheckpointHash(changed));
});

test('RS2 validates a checkpoint and attaches its hash', () => {
  const result = validateWorkspaceCheckpoint({
    checkpointId: 'ckpt_1',
    projectId: 'project_1',
    baseCommit: COMMIT_A,
    candidateCommit: COMMIT_B,
    changeSetId: 'cs_1',
    changeSetStatus: 'preview_ready',
    currentRevisionIds: ['rev_1'],
  });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.match(result.checkpoint.checkpointHash, /^[a-f0-9]{64}$/);
});

test('RS2 rejects a checkpoint carrying an unknown change set status', () => {
  const result = validateWorkspaceCheckpoint({
    checkpointId: 'ckpt_bad',
    projectId: 'project_1',
    changeSetStatus: 'almost_done',
  });
  assert.equal(result.ok, false);
  assert.equal(result.errors.some((error) => error.code === 'checkpoint_status_invalid'), true);
});

test('RS2 reports drift instead of silently repairing it', () => {
  const { checkpoint } = validateWorkspaceCheckpoint({
    checkpointId: 'ckpt_1',
    projectId: 'project_1',
    candidateCommit: COMMIT_B,
    changeSetId: 'cs_1',
    changeSetStatus: 'preview_ready',
    currentRevisionIds: ['rev_1'],
  });

  const clean = assessCheckpointConsistency({
    checkpoint,
    gitHeadCommit: COMMIT_B,
    changeSetStatus: 'preview_ready',
    currentRevisionIds: ['rev_1'],
  });
  assert.equal(clean.drift.length, 0);
  assert.equal(clean.status, 'consistent');

  const drifted = assessCheckpointConsistency({
    checkpoint,
    gitHeadCommit: COMMIT_A,
    changeSetStatus: 'adopted',
    currentRevisionIds: ['rev_2'],
  });
  const kinds = drifted.drift.map((item) => item.kind);
  assert.equal(kinds.includes('git_commit_drift'), true);
  assert.equal(kinds.includes('change_set_status_drift'), true);
  assert.equal(drifted.status, 'drifted');
});

test('RS2 treats a missing checkpoint as unavailable rather than consistent', () => {
  const result = assessCheckpointConsistency({ checkpoint: null });
  assert.equal(result.status, 'unavailable');
  assert.equal(result.recoverable, false);
});
