'use strict';

/**
 * shared-backend/result-studio-repository.js
 *
 * G0-RS2 — ChangeSet / ArtifactRevision / SelectionContext / Checkpoint 的持久化层。
 *
 * 决策来源：docs/g0-rs0-result-studio-audit.md ADR-RS-1 / ADR-RS-2
 *
 * 职责：
 * - SQLite 是索引与 UI 投影，不是 Git 或 Artifact 文件本体的替代。
 * - 状态迁移由 result-studio-contracts.js 的状态机裁决，本层只负责原子落库。
 * - adopt / revert / restore 幂等：重复调用返回同一终态，不产生第二次副作用。
 * - 任一 family 同时只能有一个 current revision（DB 层 partial unique index 保证）。
 *
 * 不变量：
 * - 不判定科学有效性：`validationStatus` 必须由 reconcileArtifactTruth() 产出后传入。
 * - 不创建 tool_job，不写 Artifact 文件，不执行 git 命令。
 * - 不使用 INSERT OR REPLACE / PRAGMA / AUTOINCREMENT（与 migration-runner 约束一致）。
 */

const {
  CHANGE_SET_CLOSED_STATUSES,
  CHANGE_SET_SETTLED_STATUSES,
  canTransitionChangeSet,
  computeCheckpointHash,
  validateArtifactRevision,
  validateScientificChangeSet,
  validateSelectionContext,
  validateWorkspaceCheckpoint,
} = require('./result-studio-contracts');
const { ensureResultStudioSchema } = require('./result-studio-schema');

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
    filterExpression: fromJson(row.filter_expression_json, null),
    sort: fromJson(row.sort_json, []),
    viewport: fromJson(row.viewport_json, null),
    displayState: fromJson(row.display_state_json, null),
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

/**
 * 创建仓库。
 *
 * @param {object} db better-sqlite3 实例（同步 API）
 * @param {{ ensureSchema?: boolean }} [options]
 */
function createResultStudioRepository(db, options = {}) {
  if (!db || typeof db.prepare !== 'function') {
    throw new ResultStudioRepositoryError('db_required', 'A better-sqlite3 database instance is required.');
  }
  if (options.ensureSchema !== false) ensureResultStudioSchema(db);

  const transaction = typeof db.transaction === 'function'
    ? (fn) => db.transaction(fn)
    : (fn) => fn;

  const api = {
    // ---------------------------------------------------------------- bindings

    /** 记录 RS1 的绑定结果。同一 project 只保留最新一条。 */
    saveRepositoryBinding(binding) {
      if (!binding || !binding.projectId) {
        throw new ResultStudioRepositoryError('binding_invalid', 'projectId is required.');
      }
      const timestamp = nowIso();
      const existing = db.prepare('SELECT project_id, created_at FROM git_repository_bindings WHERE project_id = ?')
        .get(binding.projectId);
      if (existing) {
        db.prepare(`UPDATE git_repository_bindings SET
            mode = ?, workspace_root = ?, git_dir = ?, work_tree = ?, managed_paths_json = ?,
            status = ?, reason = ?, git_version = ?, updated_at = ?
          WHERE project_id = ?`)
          .run(
            binding.mode, binding.workspaceRoot, binding.gitDir, binding.workTree,
            toJson(binding.managedPaths || []), binding.status, binding.reason || null,
            binding.gitVersion || null, timestamp, binding.projectId
          );
      } else {
        db.prepare(`INSERT INTO git_repository_bindings (
            project_id, contract_version, mode, workspace_root, git_dir, work_tree,
            managed_paths_json, status, reason, git_version, created_at, updated_at
          ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(
            binding.projectId, binding.mode, binding.workspaceRoot, binding.gitDir, binding.workTree,
            toJson(binding.managedPaths || []), binding.status, binding.reason || null,
            binding.gitVersion || null, timestamp, timestamp
          );
      }
      return api.getRepositoryBinding(binding.projectId);
    },

    getRepositoryBinding(projectId) {
      return rowToBinding(
        db.prepare('SELECT * FROM git_repository_bindings WHERE project_id = ?').get(projectId)
      );
    },

    // -------------------------------------------------------------- change set

    /**
     * 创建 ChangeSet。
     *
     * 状态被强制为 `draft`：不允许凭空创建一个已经 `adopted` 或 `preview_ready`
     * 的 ChangeSet。采用必须走真实的 draft → running → preview_ready → adopted
     * 轨迹，否则"已采用"就成了可以直接伪造的声明。
     */
    createChangeSet(input) {
      const validated = validateScientificChangeSet({ ...input, status: 'draft' });
      if (!validated.ok) {
        throw new ResultStudioRepositoryError('change_set_invalid', 'ChangeSet failed validation.', validated.errors);
      }
      const cs = validated.changeSet;
      if (db.prepare('SELECT change_set_id FROM scientific_change_sets WHERE change_set_id = ?').get(cs.changeSetId)) {
        throw new ResultStudioRepositoryError('change_set_exists', `ChangeSet already exists: ${cs.changeSetId}`);
      }
      db.prepare(`INSERT INTO scientific_change_sets (
          change_set_id, contract_version, project_id, conversation_id, intent_ref,
          base_commit, candidate_commit, working_branch_ref, status, status_reason,
          changed_paths_json, parent_artifact_refs_json, candidate_artifact_refs_json,
          job_refs_json, validation_summary_json, created_by, created_at, updated_at,
          adopted_at, reverted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(
          cs.changeSetId, cs.contractVersion, cs.projectId, cs.conversationId, cs.intentRef,
          cs.baseCommit, cs.candidateCommit, cs.workingBranchRef, cs.status, cs.statusReason,
          toJson(cs.changedPaths), toJson(cs.parentArtifactRefs), toJson(cs.candidateArtifactRefs),
          toJson(cs.jobRefs), toJson(cs.validationSummary), cs.createdBy, cs.createdAt, cs.updatedAt,
          cs.adoptedAt, cs.revertedAt
        );
      return api.getChangeSet(cs.changeSetId);
    },

    getChangeSet(changeSetId) {
      return rowToChangeSet(
        db.prepare('SELECT * FROM scientific_change_sets WHERE change_set_id = ?').get(changeSetId)
      );
    },

    listChangeSets({ projectId, status = null, limit = 50 } = {}) {
      const bounded = Number.isInteger(limit) && limit > 0 && limit <= 500 ? limit : 50;
      const rows = status
        ? db.prepare(`SELECT * FROM scientific_change_sets WHERE project_id = ? AND status = ?
             ORDER BY created_at DESC LIMIT ?`).all(projectId, status, bounded)
        : db.prepare(`SELECT * FROM scientific_change_sets WHERE project_id = ?
             ORDER BY created_at DESC LIMIT ?`).all(projectId, bounded);
      return rows.map(rowToChangeSet);
    },

    /**
     * 状态迁移。非法迁移抛错；终态到自身视为幂等 no-op。
     */
    transitionChangeSet({ changeSetId, to, reason = null, candidateCommit = undefined, validationSummary = undefined, jobRefs = undefined, changedPaths = undefined, candidateArtifactRefs = undefined } = {}) {
      const current = api.getChangeSet(changeSetId);
      if (!current) {
        throw new ResultStudioRepositoryError('change_set_not_found', `Unknown ChangeSet: ${changeSetId}`);
      }
      if (current.status === to) {
        return { changeSet: current, changed: false, idempotent: true };
      }
      // canTransitionChangeSet 返回 { allowed, idempotent, reason } 对象。
      // 必须读 .allowed：对对象直接取反永远为 false，会让守卫失效、放行所有非法迁移。
      const decision = canTransitionChangeSet(current.status, to);
      if (!decision.allowed) {
        throw new ResultStudioRepositoryError(
          'change_set_transition_invalid',
          `Illegal ChangeSet transition: ${current.status} → ${to}`,
          { from: current.status, to, reason: decision.reason }
        );
      }
      const timestamp = nowIso();
      const run = transaction(() => {
        db.prepare(`UPDATE scientific_change_sets SET
            status = ?, status_reason = ?, updated_at = ?,
            candidate_commit = COALESCE(?, candidate_commit),
            validation_summary_json = COALESCE(?, validation_summary_json),
            job_refs_json = COALESCE(?, job_refs_json),
            changed_paths_json = COALESCE(?, changed_paths_json),
            candidate_artifact_refs_json = COALESCE(?, candidate_artifact_refs_json),
            adopted_at = CASE WHEN ? = 'adopted' THEN ? ELSE adopted_at END,
            reverted_at = CASE WHEN ? = 'reverted' THEN ? ELSE reverted_at END
          WHERE change_set_id = ? AND status = ?`)
          .run(
            to, reason, timestamp,
            candidateCommit === undefined ? null : candidateCommit,
            validationSummary === undefined ? null : toJson(validationSummary),
            jobRefs === undefined ? null : toJson(jobRefs),
            changedPaths === undefined ? null : toJson(changedPaths),
            candidateArtifactRefs === undefined ? null : toJson(candidateArtifactRefs),
            to, timestamp,
            to, timestamp,
            changeSetId, current.status
          );
      });
      run();
      const updated = api.getChangeSet(changeSetId);
      if (updated.status !== to) {
        // 条件更新未命中 → 期间已被并发改写。不猜测，交给调用方重试。
        throw new ResultStudioRepositoryError('change_set_conflict', 'ChangeSet changed concurrently.', {
          expected: current.status,
          actual: updated.status,
        });
      }
      return { changeSet: updated, changed: true, idempotent: false };
    },

    // ---------------------------------------------------------------- revision

    /**
     * 追加一个 Revision。
     *
     * ordinal 由 family 内最大值 +1 推导，不由调用方指定，避免并发下重号。
     * `isCurrent` 在此处**不**生效：正式切换当前版本必须走 adoptChangeSet()。
     */
    appendRevision(input) {
      const familyId = input && input.artifactFamilyId;
      if (!familyId) {
        throw new ResultStudioRepositoryError('revision_invalid', 'artifactFamilyId is required.');
      }
      const create = transaction(() => {
        const maxRow = db.prepare(
          'SELECT MAX(revision_ordinal) AS ordinal FROM artifact_revisions WHERE artifact_family_id = ?'
        ).get(familyId);
        const nextOrdinal = (maxRow && maxRow.ordinal ? maxRow.ordinal : 0) + 1;
        const validated = validateArtifactRevision({ ...input, revisionOrdinal: nextOrdinal, isCurrent: false });
        if (!validated.ok) {
          throw new ResultStudioRepositoryError('revision_invalid', 'ArtifactRevision failed validation.', validated.errors);
        }
        const rev = validated.revision;
        if (db.prepare('SELECT revision_id FROM artifact_revisions WHERE revision_id = ?').get(rev.revisionId)) {
          throw new ResultStudioRepositoryError('revision_exists', `Revision already exists: ${rev.revisionId}`);
        }
        db.prepare(`INSERT INTO artifact_revisions (
            revision_id, contract_version, project_id, artifact_family_id, artifact_id,
            parent_revision_ids_json, source_commit, source_script_ref_json, input_artifact_refs_json,
            parameters_ref, parameters_hash, tool_job_id, output_path, output_hash,
            validation_status, reproducibility_status, change_set_id, revision_ordinal,
            is_current, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`)
          .run(
            rev.revisionId, rev.contractVersion, rev.projectId, rev.artifactFamilyId, rev.artifactId,
            toJson(rev.parentRevisionIds), rev.sourceCommit, toJson(rev.sourceScriptRef),
            toJson(rev.inputArtifactRefs), rev.parametersRef, rev.parametersHash, rev.toolJobId,
            rev.outputPath, rev.outputHash, rev.validationStatus, rev.reproducibilityStatus,
            rev.changeSetId, rev.revisionOrdinal, rev.createdAt
          );
        return rev.revisionId;
      });
      const revisionId = create();
      return api.getRevision(revisionId);
    },

    getRevision(revisionId) {
      return rowToRevision(
        db.prepare('SELECT * FROM artifact_revisions WHERE revision_id = ?').get(revisionId)
      );
    },

    findRevisionByJobArtifact({ projectId, toolJobId, artifactId } = {}) {
      if (!projectId || !toolJobId || !artifactId) return null;
      return rowToRevision(
        db.prepare(`SELECT * FROM artifact_revisions
          WHERE project_id = ? AND tool_job_id = ? AND artifact_id = ?
          ORDER BY revision_ordinal DESC LIMIT 1`)
          .get(projectId, toolJobId, artifactId)
      );
    },

    listRevisions({ artifactFamilyId, limit = 100 } = {}) {
      const bounded = Number.isInteger(limit) && limit > 0 && limit <= 1000 ? limit : 100;
      return db.prepare(`SELECT * FROM artifact_revisions WHERE artifact_family_id = ?
          ORDER BY revision_ordinal ASC LIMIT ?`)
        .all(artifactFamilyId, bounded)
        .map(rowToRevision);
    },

    getCurrentRevision(artifactFamilyId) {
      return rowToRevision(
        db.prepare('SELECT * FROM artifact_revisions WHERE artifact_family_id = ? AND is_current = 1')
          .get(artifactFamilyId)
      );
    },

    listCurrentRevisions(projectId) {
      return db.prepare('SELECT * FROM artifact_revisions WHERE project_id = ? AND is_current = 1')
        .all(projectId)
        .map(rowToRevision);
    },

    // ------------------------------------------------------- adopt / revert

    /**
     * 采用一个 ChangeSet：状态转 adopted，并原子切换其候选 Revision 为 current。
     *
     * 幂等：已 adopted 时直接返回同一结果，不重复切换。
     * 原子：状态与 current 指针在同一事务内完成，异常退出不留"部分采用"。
     */
    adoptChangeSet({ changeSetId, candidateCommit = undefined } = {}) {
      const current = api.getChangeSet(changeSetId);
      if (!current) {
        throw new ResultStudioRepositoryError('change_set_not_found', `Unknown ChangeSet: ${changeSetId}`);
      }
      if (current.status === 'adopted') {
        return {
          changeSet: current,
          adoptedRevisionIds: api.listRevisionsByChangeSet(changeSetId).filter((r) => r.isCurrent).map((r) => r.revisionId),
          idempotent: true,
        };
      }
      // 必须读 .allowed —— canTransitionChangeSet 返回对象，`!对象` 永远为 false。
      if (!canTransitionChangeSet(current.status, 'adopted').allowed) {
        throw new ResultStudioRepositoryError(
          'change_set_transition_invalid',
          `Cannot adopt from status ${current.status}`,
          { from: current.status, to: 'adopted' }
        );
      }
      const revisions = api.listRevisionsByChangeSet(changeSetId);
      if (revisions.length === 0) {
        throw new ResultStudioRepositoryError('change_set_has_no_revision', 'Cannot adopt a ChangeSet without revisions.');
      }
      const blocked = revisions.filter((rev) => rev.validationStatus === 'blocked');
      if (blocked.length > 0) {
        // 计划 §3.1：blocked 结果不能因预览成功而升级为 valid。
        throw new ResultStudioRepositoryError(
          'change_set_blocked_revision',
          'Cannot adopt a ChangeSet containing blocked revisions.',
          { revisionIds: blocked.map((rev) => rev.revisionId) }
        );
      }
      const timestamp = nowIso();
      const apply = transaction(() => {
        for (const rev of revisions) {
          // 先清空同 family 的旧 current，再置新 current；
          // partial unique index 保证任何中间态都不会出现两个 current。
          db.prepare('UPDATE artifact_revisions SET is_current = 0 WHERE artifact_family_id = ? AND is_current = 1')
            .run(rev.artifactFamilyId);
          db.prepare('UPDATE artifact_revisions SET is_current = 1 WHERE revision_id = ?').run(rev.revisionId);
        }
        db.prepare(`UPDATE scientific_change_sets SET
            status = 'adopted', adopted_at = ?, updated_at = ?,
            candidate_commit = COALESCE(?, candidate_commit)
          WHERE change_set_id = ? AND status = ?`)
          .run(timestamp, timestamp, candidateCommit === undefined ? null : candidateCommit, changeSetId, current.status);
      });
      apply();
      const updated = api.getChangeSet(changeSetId);
      if (updated.status !== 'adopted') {
        throw new ResultStudioRepositoryError('change_set_conflict', 'ChangeSet changed concurrently during adopt.');
      }
      return {
        changeSet: updated,
        adoptedRevisionIds: revisions.map((rev) => rev.revisionId),
        idempotent: false,
      };
    },

    /**
     * 撤销一个 ChangeSet。
     *
     * 未采用 → 只标记 reverted，不动 current 指针。
     * 已采用 → 把每个 family 的 current 回退到该 ChangeSet 之前的最高 ordinal；
     *          历史 Revision 一律保留（计划 §3.2：不自动消失）。
     */
    revertChangeSet({ changeSetId, reason = null } = {}) {
      const current = api.getChangeSet(changeSetId);
      if (!current) {
        throw new ResultStudioRepositoryError('change_set_not_found', `Unknown ChangeSet: ${changeSetId}`);
      }
      if (current.status === 'reverted') {
        return { changeSet: current, restoredRevisionIds: [], idempotent: true };
      }
      // 必须读 .allowed —— canTransitionChangeSet 返回对象，`!对象` 永远为 false。
      if (!canTransitionChangeSet(current.status, 'reverted').allowed) {
        throw new ResultStudioRepositoryError(
          'change_set_transition_invalid',
          `Cannot revert from status ${current.status}`,
          { from: current.status, to: 'reverted' }
        );
      }
      const wasAdopted = current.status === 'adopted';
      const revisions = api.listRevisionsByChangeSet(changeSetId);
      const timestamp = nowIso();
      const restored = [];
      const apply = transaction(() => {
        if (wasAdopted) {
          for (const rev of revisions) {
            db.prepare('UPDATE artifact_revisions SET is_current = 0 WHERE revision_id = ?').run(rev.revisionId);
            const previous = db.prepare(`SELECT * FROM artifact_revisions
                WHERE artifact_family_id = ? AND revision_ordinal < ? AND validation_status <> 'blocked'
                ORDER BY revision_ordinal DESC LIMIT 1`)
              .get(rev.artifactFamilyId, rev.revisionOrdinal);
            if (previous) {
              db.prepare('UPDATE artifact_revisions SET is_current = 1 WHERE revision_id = ?').run(previous.revision_id);
              restored.push(previous.revision_id);
            }
          }
        }
        db.prepare(`UPDATE scientific_change_sets SET
            status = 'reverted', status_reason = ?, reverted_at = ?, updated_at = ?
          WHERE change_set_id = ? AND status = ?`)
          .run(reason, timestamp, timestamp, changeSetId, current.status);
      });
      apply();
      const updated = api.getChangeSet(changeSetId);
      if (updated.status !== 'reverted') {
        throw new ResultStudioRepositoryError('change_set_conflict', 'ChangeSet changed concurrently during revert.');
      }
      return { changeSet: updated, restoredRevisionIds: restored, idempotent: false };
    },

    listRevisionsByChangeSet(changeSetId) {
      return db.prepare('SELECT * FROM artifact_revisions WHERE change_set_id = ? ORDER BY revision_ordinal ASC')
        .all(changeSetId)
        .map(rowToRevision);
    },

    // --------------------------------------------------------------- selection

    saveSelection(input) {
      const validated = validateSelectionContext(input);
      if (!validated.ok) {
        throw new ResultStudioRepositoryError('selection_invalid', 'SelectionContext failed validation.', validated.errors);
      }
      const sel = validated.selection;
      const existing = db.prepare('SELECT selection_id FROM result_selection_contexts WHERE selection_id = ?')
        .get(sel.selectionId);
      if (existing) {
        db.prepare(`UPDATE result_selection_contexts SET
            artifact_id = ?, revision_id = ?, entity_type = ?, entity_ids_json = ?,
            entity_id_count = ?, entity_ids_truncated = ?, entity_ids_hash = ?,
            filter_expression_json = ?, sort_json = ?, viewport_json = ?, display_state_json = ?,
            updated_at = ?
          WHERE selection_id = ?`)
          .run(
            sel.artifactId, sel.revisionId, sel.entityType, toJson(sel.entityIds),
            sel.entityIdCount, sel.entityIdsTruncated ? 1 : 0, sel.entityIdsHash,
            toJson(sel.filterExpression), toJson(sel.sort), toJson(sel.viewport), toJson(sel.displayState),
            nowIso(), sel.selectionId
          );
      } else {
        db.prepare(`INSERT INTO result_selection_contexts (
            selection_id, contract_version, project_id, conversation_id, artifact_id, revision_id,
            entity_type, entity_ids_json, entity_id_count, entity_ids_truncated, entity_ids_hash,
            filter_expression_json, sort_json, viewport_json, display_state_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(
            sel.selectionId, sel.contractVersion, sel.projectId, sel.conversationId, sel.artifactId,
            sel.revisionId, sel.entityType, toJson(sel.entityIds), sel.entityIdCount,
            sel.entityIdsTruncated ? 1 : 0, sel.entityIdsHash, toJson(sel.filterExpression),
            toJson(sel.sort), toJson(sel.viewport), toJson(sel.displayState), sel.createdAt, sel.updatedAt
          );
      }
      return api.getSelection(sel.selectionId);
    },

    getSelection(selectionId) {
      return rowToSelection(
        db.prepare('SELECT * FROM result_selection_contexts WHERE selection_id = ?').get(selectionId)
      );
    },

    deleteSelection(selectionId) {
      const result = db.prepare('DELETE FROM result_selection_contexts WHERE selection_id = ?').run(selectionId);
      return { deleted: result.changes > 0 };
    },

    // -------------------------------------------------------------- checkpoint

    saveCheckpoint(input) {
      const validated = validateWorkspaceCheckpoint(input);
      if (!validated.ok) {
        throw new ResultStudioRepositoryError('checkpoint_invalid', 'Checkpoint failed validation.', validated.errors);
      }
      const cp = validated.checkpoint;
      const existing = db.prepare('SELECT checkpoint_id FROM workspace_revision_checkpoints WHERE checkpoint_id = ?')
        .get(cp.checkpointId);
      if (existing) {
        db.prepare(`UPDATE workspace_revision_checkpoints SET
            base_commit = ?, candidate_commit = ?, change_set_id = ?, change_set_status = ?,
            current_revision_ids_json = ?, selection_id = ?, pending_preview_json = ?,
            job_refs_json = ?, loop_refs_json = ?, checkpoint_hash = ?, updated_at = ?
          WHERE checkpoint_id = ?`)
          .run(
            cp.baseCommit, cp.candidateCommit, cp.changeSetId, cp.changeSetStatus,
            toJson(cp.currentRevisionIds), cp.selectionId, toJson(cp.pendingPreview),
            toJson(cp.jobRefs), toJson(cp.loopRefs), cp.checkpointHash, nowIso(), cp.checkpointId
          );
      } else {
        db.prepare(`INSERT INTO workspace_revision_checkpoints (
            checkpoint_id, contract_version, project_id, conversation_id, base_commit, candidate_commit,
            change_set_id, change_set_status, current_revision_ids_json, selection_id,
            pending_preview_json, job_refs_json, loop_refs_json, checkpoint_hash, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(
            cp.checkpointId, cp.contractVersion, cp.projectId, cp.conversationId, cp.baseCommit,
            cp.candidateCommit, cp.changeSetId, cp.changeSetStatus, toJson(cp.currentRevisionIds),
            cp.selectionId, toJson(cp.pendingPreview), toJson(cp.jobRefs), toJson(cp.loopRefs),
            cp.checkpointHash, cp.createdAt, cp.updatedAt
          );
      }
      return api.getCheckpoint(cp.checkpointId);
    },

    getCheckpoint(checkpointId) {
      return rowToCheckpoint(
        db.prepare('SELECT * FROM workspace_revision_checkpoints WHERE checkpoint_id = ?').get(checkpointId)
      );
    },

    getLatestCheckpoint({ projectId, conversationId = null } = {}) {
      const row = conversationId
        ? db.prepare(`SELECT * FROM workspace_revision_checkpoints
             WHERE project_id = ? AND conversation_id = ? ORDER BY updated_at DESC LIMIT 1`)
          .get(projectId, conversationId)
        : db.prepare(`SELECT * FROM workspace_revision_checkpoints
             WHERE project_id = ? ORDER BY updated_at DESC LIMIT 1`).get(projectId);
      return rowToCheckpoint(row);
    },

    /** 校验落库的 checkpoint hash 是否与内容一致（检测外部改写/损坏）。 */
    verifyCheckpointIntegrity(checkpointId) {
      const stored = api.getCheckpoint(checkpointId);
      if (!stored) return { status: 'unavailable', checkpointId, matches: false };
      const { checkpointHash, contractVersion, ...rest } = stored;
      const recomputed = computeCheckpointHash({ contractVersion, ...rest });
      return {
        status: recomputed === checkpointHash ? 'intact' : 'hash_mismatch',
        checkpointId,
        matches: recomputed === checkpointHash,
        storedHash: checkpointHash,
        recomputedHash: recomputed,
      };
    },

    // -------------------------------------------------------------- 恢复 / GC

    /**
     * 启动恢复扫描：找出中断态 ChangeSet。
     *
     * `running` 表示进程在执行中退出；`preview_ready` 表示有未决预览等用户处理。
     * 本函数只报告，不自动改写状态——自动"修复"会掩盖真实中断原因。
     */
    findInterruptedChangeSets(projectId) {
      const rows = db.prepare(`SELECT * FROM scientific_change_sets
          WHERE project_id = ? AND status IN ('running', 'preview_ready', 'draft')
          ORDER BY updated_at DESC`).all(projectId);
      return rows.map(rowToChangeSet).map((cs) => ({
        changeSet: cs,
        recovery: cs.status === 'running'
          ? 'recovery_required_after_restart'
          : cs.status === 'preview_ready'
            ? 'awaiting_user_decision'
            : 'resumable_draft',
      }));
    },

    /**
     * 可达性分析：哪些 Revision 仍被引用，不能清理。
     *
     * 可达 = 当前版本、被已采用 ChangeSet 产生、或作为其他 Revision 的父/输入。
     * 计划 §8：清理必须先做 reachability，不得删除仍被引用的对象。
     */
    analyzeRevisionReachability(projectId) {
      const all = db.prepare('SELECT * FROM artifact_revisions WHERE project_id = ?').all(projectId).map(rowToRevision);
      const adoptedChangeSets = new Set(
        db.prepare("SELECT change_set_id FROM scientific_change_sets WHERE project_id = ? AND status = 'adopted'")
          .all(projectId).map((row) => row.change_set_id)
      );
      const referenced = new Set();
      for (const rev of all) {
        for (const parentId of rev.parentRevisionIds) referenced.add(parentId);
        for (const ref of rev.inputArtifactRefs) {
          if (ref && ref.artifactId) referenced.add(ref.artifactId);
        }
      }
      // "保护原始版本"只对**活跃 family** 成立：family 内存在 current 或
      // 由已采用 ChangeSet 产生的版本，才有"可以回退到的基线"这层含义。
      //
      // 若一个 family 的全部版本都来自未采用/已放弃的 ChangeSet（用户新建了一个
      // 产物族后又放弃），那它的 ordinal 1 是真正的垃圾。无条件保护 ordinal 1
      // 会让这类残留永久占用磁盘，且用户无法通过任何 UI 操作清掉。
      const liveFamilies = new Set(
        all.filter((rev) => rev.isCurrent || adoptedChangeSets.has(rev.changeSetId))
          .map((rev) => rev.artifactFamilyId)
      );

      const reachable = [];
      const unreachable = [];
      for (const rev of all) {
        const reasons = [];
        if (rev.isCurrent) reasons.push('current_revision');
        if (adoptedChangeSets.has(rev.changeSetId)) reasons.push('adopted_change_set');
        if (referenced.has(rev.revisionId)) reasons.push('referenced_by_descendant');
        if (rev.revisionOrdinal === 1 && liveFamilies.has(rev.artifactFamilyId)) {
          reasons.push('original_revision_of_live_family');
        }
        if (reasons.length > 0) reachable.push({ revisionId: rev.revisionId, reasons });
        else unreachable.push({ revisionId: rev.revisionId, outputPath: rev.outputPath });
      }
      return {
        projectId,
        total: all.length,
        reachable,
        // 仅为候选清单；本层不删除任何文件或记录。
        gcCandidates: unreachable,
        mode: 'read_only_analysis',
      };
    },
  };

  return api;
}

module.exports = {
  ResultStudioRepositoryError,
  createResultStudioRepository,
  CHANGE_SET_CLOSED_STATUSES,
  CHANGE_SET_SETTLED_STATUSES,
};
