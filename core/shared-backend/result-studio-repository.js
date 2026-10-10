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
  validateChangeSet,
  validateSelectionContext,
  validateWorkspaceCheckpoint,
} = require('./result-studio-contracts');
const { ensureResultStudioSchema } = require('./result-studio-schema');
const {
  ensureResultWorkflowGraphSchema,
  verifyWorkflowGraphIntegrity,
} = require('./result-workflow-graph');
const {
  computeResultRefTransactionHash,
  ensureResultRefTransactionSchema,
} = require('./result-ref-transaction-schema');
const {
  getResultStudioRuntimeLease,
  isResultStudioRuntimeLease,
} = require('./result-studio-runtime-lease');

const {
  PETRI_REF_PATTERN,
  SHA256_PATTERN,
  GIT_OID_PATTERN,
  ResultStudioRepositoryError,
  toJson,
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
} = require('./result-studio-repository/rows');

// BLOCK-92 Wave C-4：行映射/校验簇外迁 rows.js（纯搬运）；
// createResultStudioRepository 工厂闭包保留本文件（同 tools-executor 先例）。

function createResultStudioRepository(db, options = {}) {
  if (!db || typeof db.prepare !== 'function') {
    throw new ResultStudioRepositoryError('db_required', 'A better-sqlite3 database instance is required.');
  }
  if (options.ensureSchema !== false) {
    ensureResultStudioSchema(db);
    ensureResultWorkflowGraphSchema(db);
    ensureResultRefTransactionSchema(db);
  }

  const transaction = typeof db.transaction === 'function'
    ? (fn) => db.transaction(fn)
    : (fn) => fn;
  const immediateTransaction = typeof db.transaction === 'function'
    ? (fn) => (...args) => db.transaction(fn).immediate(...args)
    : (fn) => fn;

  function validateWorkflowGraphPayload(graph) {
    const integrity = verifyWorkflowGraphIntegrity(graph);
    if (!integrity.ok) {
      throw new ResultStudioRepositoryError(
        'workflow_graph_integrity_failed',
        'Authoritative workflow graph failed content-addressed integrity validation.',
        { diagnostics: integrity.diagnostics }
      );
    }
    return graph;
  }

  function readWorkflowGraphRow(row) {
    const graph = rowToWorkflowGraph(row);
    if (!graph) return null;
    return validateWorkflowGraphPayload(graph);
  }

  function persistWorkflowGraph(graph) {
    validateWorkflowGraphPayload(graph);
    const existing = db.prepare('SELECT * FROM result_workflow_graphs WHERE project_id = ? AND source_digest = ?')
      .get(graph.projectId, graph.sourceDigest);
    if (existing) {
      const stored = readWorkflowGraphRow(existing);
      if (stored.graphId !== graph.graphId
          || stored.rootToolJobId !== graph.rootToolJobId
          || toJson(stored.nodes) !== toJson(graph.nodes)
          || toJson(stored.edges) !== toJson(graph.edges)) {
        throw new ResultStudioRepositoryError(
          'workflow_graph_digest_conflict',
          'The workflow graph digest is already bound to a different authoritative snapshot.',
          { graphId: graph.graphId, existingGraphId: stored.graphId, sourceDigest: graph.sourceDigest }
        );
      }
      return stored;
    }
    const timestamp = nowIso();
    db.prepare(`INSERT INTO result_workflow_graphs (
        graph_id, contract_version, project_id, root_tool_job_id, source_digest,
        nodes_json, edges_json, validation_status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        graph.graphId, graph.contractVersion || 1, graph.projectId, graph.rootToolJobId, graph.sourceDigest,
        toJson(graph.nodes), toJson(graph.edges), graph.validationStatus, timestamp, timestamp
      );
    return readWorkflowGraphRow(
      db.prepare('SELECT * FROM result_workflow_graphs WHERE graph_id = ?').get(graph.graphId)
    );
  }

  function insertRevision(input) {
    const familyId = input && input.artifactFamilyId;
    if (!familyId) {
      throw new ResultStudioRepositoryError('revision_invalid', 'artifactFamilyId is required.');
    }
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
    const changeSet = rowToChangeSet(
      db.prepare('SELECT * FROM scientific_change_sets WHERE change_set_id = ?').get(rev.changeSetId)
    );
    if (!changeSet || changeSet.projectId !== rev.projectId) {
      throw new ResultStudioRepositoryError(
        'revision_change_set_mismatch',
        'ArtifactRevision must belong to an existing ChangeSet in the same project.',
        { revisionId: rev.revisionId, changeSetId: rev.changeSetId, projectId: rev.projectId }
      );
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
    return rowToRevision(
      db.prepare('SELECT * FROM artifact_revisions WHERE revision_id = ?').get(rev.revisionId)
    );
  }

  const api = {
    // ---------------------------------------------------------------- bindings

    // 2026-10-03 用户裁决（UI-462）：「接入用户自有仓库」能力退役，consent 存取
    // 已删除；历史 git_repository_consents 表保留但不再被任何路径读写，
    // 旧 consent 行对绑定行为零影响（绑定恒为 managed）。

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

    // -------------------------------------------------------- workflow graph

    /**
     * Persist a source-bound authoritative DAG snapshot.  The service that
     * produces `graph` has already validated Job/Artifact/Selection Truth;
     * this method deliberately does not accept arbitrary caller nodes later.
     * Same project + source digest is idempotent and never overwrites history.
     */
    saveWorkflowGraph(graph) {
      return persistWorkflowGraph(graph);
    },

    getWorkflowGraph(graphId) {
      return readWorkflowGraphRow(
        db.prepare('SELECT * FROM result_workflow_graphs WHERE graph_id = ?').get(graphId)
      );
    },

    findWorkflowGraph({ projectId, sourceDigest } = {}) {
      if (!projectId || !sourceDigest) return null;
      return readWorkflowGraphRow(
        db.prepare('SELECT * FROM result_workflow_graphs WHERE project_id = ? AND source_digest = ?')
          .get(projectId, sourceDigest)
      );
    },

    // BLOCK-127（BIO-3 P1）：按项目列出全部权威工作流图，updated_at 降序
    //（最新优先）——lineage 投影端点据此找包含目标 job 的图。
    listProjectWorkflowGraphs(projectId) {
      if (!projectId) return [];
      const rows = db.prepare(
        'SELECT * FROM result_workflow_graphs WHERE project_id = ? ORDER BY updated_at DESC, graph_id DESC'
      ).all(projectId);
      const graphs = [];
      for (const row of rows) {
        try {
          graphs.push(readWorkflowGraphRow(row));
        } catch { /* 单图载荷损坏不拖垮整列表，跳过 */ }
      }
      return graphs.filter(Boolean);
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
      const validated = validateChangeSet({ ...input, status: 'draft' });
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

    listChangeSetsByArtifactFamily({ projectId, artifactFamilyId, limit = 100, offset = 0 } = {}) {
      const bounded = Number.isInteger(limit) && limit > 0 && limit <= 500 ? limit : 100;
      const skipped = Number.isInteger(offset) && offset >= 0 ? offset : 0;
      if (!projectId || !artifactFamilyId) return [];
      return db.prepare(`SELECT DISTINCT cs.* FROM scientific_change_sets cs
          INNER JOIN artifact_revisions revision ON revision.change_set_id = cs.change_set_id
          WHERE cs.project_id = ? AND revision.project_id = ? AND revision.artifact_family_id = ?
          ORDER BY cs.created_at DESC LIMIT ? OFFSET ?`)
        .all(projectId, projectId, artifactFamilyId, bounded, skipped)
        .map(rowToChangeSet);
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
        const updated = db.prepare(`UPDATE scientific_change_sets SET
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
        if (updated.changes !== 1) {
          throw new ResultStudioRepositoryError('change_set_conflict', 'ChangeSet changed concurrently.', {
            expected: current.status,
          });
        }
      });
      run();
      const updated = api.getChangeSet(changeSetId);
      return { changeSet: updated, changed: true, idempotent: false };
    },

    /** Persist a normal state transition and its durable checkpoint together. */
    transitionChangeSetWithCheckpoint({ transition, checkpoint, beforeCommit = null } = {}) {
      if (!transition?.changeSetId || !transition?.to || !checkpoint?.checkpointId
          || checkpoint.changeSetId !== transition.changeSetId) {
        throw new ResultStudioRepositoryError(
          'checkpoint_transition_invalid',
          'A ChangeSet transition and its exact checkpoint are required.'
        );
      }
      const apply = transaction(() => {
        const transitioned = api.transitionChangeSet(transition);
        if (checkpoint.projectId !== transitioned.changeSet.projectId
            || checkpoint.changeSetStatus !== transitioned.changeSet.status
            || (checkpoint.candidateCommit || null) !== (transitioned.changeSet.candidateCommit || null)) {
          throw new ResultStudioRepositoryError(
            'checkpoint_transition_mismatch',
            'Checkpoint must describe the exact resulting ChangeSet state.'
          );
        }
        const savedCheckpoint = api.saveCheckpoint(checkpoint);
        if (typeof beforeCommit === 'function') {
          beforeCommit({ changeSet: transitioned.changeSet, checkpoint: savedCheckpoint });
        }
        return {
          changeSetId: transitioned.changeSet.changeSetId,
          checkpointId: savedCheckpoint.checkpointId,
          changed: transitioned.changed,
        };
      });
      const result = apply();
      return {
        changeSet: api.getChangeSet(result.changeSetId),
        checkpoint: api.getCheckpoint(result.checkpointId),
        changed: result.changed,
      };
    },

    /**
     * Remove the only pre-checkpoint crash window for a new edit: draft row,
     * running transition and ownership lease become visible in one commit.
     */
    startChangeSetWithCheckpoint({ changeSet, checkpoint, previewSlot = null, beforeCommit = null } = {}) {
      if (!changeSet?.changeSetId || !checkpoint?.checkpointId
          || checkpoint.changeSetId !== changeSet.changeSetId
          || checkpoint.projectId !== changeSet.projectId
          || checkpoint.changeSetStatus !== 'running') {
        throw new ResultStudioRepositoryError(
          'change_set_start_invalid',
          'Starting a ChangeSet requires its exact running checkpoint.'
        );
      }
      if (previewSlot && (previewSlot.projectId !== changeSet.projectId
          || !Number.isInteger(previewSlot.maxConcurrentPreviews)
          || previewSlot.maxConcurrentPreviews < 1)) {
        throw new ResultStudioRepositoryError(
          'preview_slot_invalid',
          'A preview slot must be bound to the exact project and a positive concurrency limit.'
        );
      }
      const apply = transaction(() => {
        let slot = null;
        if (previewSlot) {
          const activePreviewJobs = db.prepare(`SELECT COUNT(*) AS count
              FROM scientific_change_sets WHERE project_id = ? AND status = 'running'`)
            .get(changeSet.projectId).count;
          if (activePreviewJobs >= previewSlot.maxConcurrentPreviews) {
            throw new ResultStudioRepositoryError(
              'preview_concurrency_saturated',
              'The project has no free background preview slot.',
              { activePreviewJobs, maxBackgroundPreviews: previewSlot.maxConcurrentPreviews }
            );
          }
          slot = {
            activePreviewJobsBefore: activePreviewJobs,
            activePreviewJobsAfter: activePreviewJobs + 1,
            maxBackgroundPreviews: previewSlot.maxConcurrentPreviews,
          };
        }
        api.createChangeSet(changeSet);
        const started = api.transitionChangeSetWithCheckpoint({
          transition: { changeSetId: changeSet.changeSetId, to: 'running' },
          checkpoint,
        });
        if (typeof beforeCommit === 'function') {
          beforeCommit({ changeSet: started.changeSet, checkpoint: started.checkpoint });
        }
        return { changeSetId: started.changeSet.changeSetId, checkpointId: started.checkpoint.checkpointId, slot };
      });
      // BEGIN IMMEDIATE serializes the count-and-claim decision across the
      // independent Result Studio worker processes sharing this SQLite file.
      const result = previewSlot && typeof apply.immediate === 'function' ? apply.immediate() : apply();
      return {
        changeSet: api.getChangeSet(result.changeSetId),
        checkpoint: api.getCheckpoint(result.checkpointId),
        previewSlot: result.slot,
      };
    },

    // ---------------------------------------------------------------- revision

    /**
     * 追加一个 Revision。
     *
     * ordinal 由 family 内最大值 +1 推导，不由调用方指定，避免并发下重号。
     * `isCurrent` 在此处**不**生效：正式切换当前版本必须走 adoptChangeSet()。
     */
    appendRevision(input) {
      return api.appendRevisionBatch({ revisions: [input] }).revisions[0];
    },

    /**
     * Atomically register a complete candidate cohort.  When supplied,
     * `workflowGraph` and `transition` are persisted in the exact
     * same SQLite transaction as every Revision.  A validation, constraint,
     * transition or injected `beforeCommit` failure therefore leaves none of
     * the candidate Revisions, graph or preview projection behind.
     */
    appendRevisionBatch({ revisions, workflowGraph = null, transition = null, beforeCommit = null } = {}) {
      if (!Array.isArray(revisions) || revisions.length === 0) {
        throw new ResultStudioRepositoryError('revision_batch_invalid', 'Revision batch must contain at least one Revision.');
      }
      if (revisions.some((revision) => !revision || typeof revision !== 'object' || Array.isArray(revision))) {
        throw new ResultStudioRepositoryError('revision_batch_invalid', 'Every batch member must be a Revision object.');
      }
      if (revisions.some((revision) => revision.reproducibilityStatus === 'verified')) {
        throw new ResultStudioRepositoryError(
          'revision_verified_requires_replay_proof',
          'A Revision can become verified only through an exact replay proof.'
        );
      }
      const projectIds = revisions.map((revision) => revision.projectId);
      const changeSetIds = revisions.map((revision) => revision.changeSetId);
      if (!isCanonicalUniqueIdentifierArray([...new Set(projectIds)])
          || !isCanonicalUniqueIdentifierArray([...new Set(changeSetIds)])
          || new Set(projectIds).size !== 1
          || new Set(changeSetIds).size !== 1) {
        throw new ResultStudioRepositoryError(
          'revision_batch_mixed_scope',
          'Every Revision in an atomic batch must belong to one project and one ChangeSet.'
        );
      }
      const [projectId] = projectIds;
      const [changeSetId] = changeSetIds;
      const revisionIds = revisions.map((revision) => revision.revisionId);
      if (!isCanonicalUniqueIdentifierArray(revisionIds)) {
        throw new ResultStudioRepositoryError('revision_batch_duplicate', 'Revision batch IDs must be present and unique.');
      }
      const artifactFamilyIds = revisions.map((revision) => revision.artifactFamilyId);
      if (!isCanonicalUniqueIdentifierArray(artifactFamilyIds)) {
        throw new ResultStudioRepositoryError(
          'revision_batch_duplicate_family',
          'A candidate cohort may contain exactly one Revision per Artifact family.'
        );
      }
      if (workflowGraph && workflowGraph.projectId !== projectId) {
        throw new ResultStudioRepositoryError(
          'revision_batch_graph_scope_mismatch',
          'Workflow graph and candidate Revision batch must belong to the same project.'
        );
      }
      if (workflowGraph) {
        validateWorkflowGraphPayload(workflowGraph);
        const nodesByJobId = new Map(workflowGraph.nodes.map((node) => [node.toolJobId, node]));
        const revisionsById = new Map(revisions.map((revision) => [revision.revisionId, revision]));
        for (const revision of revisions) {
          const node = nodesByJobId.get(revision.toolJobId);
          if (!node || !node.artifactIds.includes(revision.artifactId)) {
            throw new ResultStudioRepositoryError(
              'revision_batch_graph_cohort_mismatch',
              'Every candidate Revision must be represented by its exact producing Job and Artifact in the supplied workflow graph.',
              {
                revisionId: revision.revisionId,
                toolJobId: revision.toolJobId,
                artifactId: revision.artifactId,
                graphId: workflowGraph.graphId,
              }
            );
          }
        }
        for (const edge of workflowGraph.edges) {
          const revision = revisionsById.get(edge.sourceRevisionId) || api.getRevision(edge.sourceRevisionId);
          if (!revision) {
            throw new ResultStudioRepositoryError(
              'revision_batch_graph_source_revision_missing',
              'Every workflow lineage edge must resolve to a candidate or already-persisted source Revision.',
              {
                sourceRevisionId: edge.sourceRevisionId,
                graphId: workflowGraph.graphId,
              }
            );
          }
          if (revision.projectId !== projectId
              || edge.fromNodeId !== `job:${revision.toolJobId}`
              || edge.sourceToolJobId !== revision.toolJobId
              || edge.sourceArtifactId !== revision.artifactId
              || edge.sourceOutputHash !== revision.outputHash) {
            throw new ResultStudioRepositoryError(
              'revision_batch_graph_edge_mismatch',
              'A workflow lineage edge must preserve its source Revision project, Job, Artifact and output hash.',
              {
                revisionId: revision.revisionId,
                graphId: workflowGraph.graphId,
                edge,
              }
            );
          }
        }
      }
      if (transition) {
        if (typeof transition !== 'object' || Array.isArray(transition)
            || !isCanonicalIdentifier(transition.changeSetId)
            || transition.changeSetId !== changeSetId
            || transition.to !== 'preview_ready') {
          throw new ResultStudioRepositoryError(
            'revision_batch_transition_invalid',
            'Atomic candidate registration can only transition its own ChangeSet to preview_ready.'
          );
        }
        const expectedJobRefs = [...new Set(revisions.map((revision) => revision.toolJobId))];
        if (!isCanonicalUniqueIdentifierArray(expectedJobRefs)) {
          throw new ResultStudioRepositoryError(
            'revision_batch_job_scope_invalid',
            'Every candidate Revision must bind one canonical producing Job before preview registration.'
          );
        }
        if (!isCanonicalUniqueIdentifierArray(transition.candidateArtifactRefs)
            || !isCanonicalUniqueIdentifierArray(transition.jobRefs)) {
          throw new ResultStudioRepositoryError(
            'revision_batch_transition_scope_invalid',
            'Candidate Revision and Job references must be non-empty, canonical and unique.'
          );
        }
        if (!sameStringSet(transition.candidateArtifactRefs, revisionIds)
            || !sameStringSet(transition.jobRefs, expectedJobRefs)) {
          throw new ResultStudioRepositoryError(
            'revision_batch_transition_cohort_mismatch',
            'Preview transition references must match the exact supplied Revision cohort and producing Jobs.',
            {
              expectedCandidateArtifactRefs: revisionIds,
              candidateArtifactRefs: transition.candidateArtifactRefs,
              expectedJobRefs,
              jobRefs: transition.jobRefs,
            }
          );
        }
        const transitionGraphRef = transition.validationSummary?.workflowGraph || null;
        if (!!workflowGraph !== !!transitionGraphRef
            || (workflowGraph && (transitionGraphRef.graphId !== workflowGraph.graphId
              || transitionGraphRef.sourceDigest !== workflowGraph.sourceDigest))) {
          throw new ResultStudioRepositoryError(
            'revision_batch_graph_transition_mismatch',
            'Preview transition must reference the exact workflow graph persisted with the candidate cohort.',
            {
              graphId: workflowGraph?.graphId || null,
              sourceDigest: workflowGraph?.sourceDigest || null,
              transitionGraphRef,
            }
          );
        }
        if (workflowGraph) {
          const graphJobIds = new Set(workflowGraph.nodes.map((node) => node.toolJobId));
          const missingJobRefs = transition.jobRefs.filter((jobId) => !graphJobIds.has(jobId));
          if (missingJobRefs.length > 0) {
            throw new ResultStudioRepositoryError(
              'revision_batch_graph_job_mismatch',
              'Every producing Job referenced by the preview transition must exist in the supplied workflow graph.',
              { graphId: workflowGraph.graphId, missingJobRefs }
            );
          }
        }
      }
      // Reserve the WAL writer before reading the existing cohort and family
      // ordinals. With a deferred transaction, two candidate workers can both
      // take a read snapshot and the loser then fails with SQLITE_BUSY_SNAPSHOT
      // when it attempts its first Revision write.
      const apply = immediateTransaction(() => {
        if (transition) {
          const existingCohort = api.listRevisionsByChangeSet(changeSetId);
          if (existingCohort.length > 0) {
            throw new ResultStudioRepositoryError(
              'revision_batch_existing_cohort',
              'Preview registration cannot add a partial cohort to a ChangeSet that already has Revisions.',
              {
                changeSetId,
                existingRevisionIds: existingCohort.map((revision) => revision.revisionId),
                suppliedRevisionIds: revisionIds,
              }
            );
          }
        }
        const inserted = revisions.map((revision) => insertRevision(revision));
        const storedGraph = workflowGraph ? persistWorkflowGraph(workflowGraph) : null;
        const transitionResult = transition
          ? api.transitionChangeSet(transition)
          : null;
        if (typeof beforeCommit === 'function') {
          beforeCommit({ revisions: inserted, workflowGraph: storedGraph, transition: transitionResult });
        }
        return {
          revisionIds: inserted.map((revision) => revision.revisionId),
          graphId: storedGraph && storedGraph.graphId,
          changeSetId: transitionResult && transitionResult.changeSet.changeSetId,
        };
      });
      const result = apply();
      return {
        revisions: result.revisionIds.map((revisionId) => api.getRevision(revisionId)),
        workflowGraph: result.graphId ? api.getWorkflowGraph(result.graphId) : null,
        changeSet: result.changeSetId ? api.getChangeSet(result.changeSetId) : null,
      };
    },

    getRevision(revisionId) {
      return rowToRevision(
        db.prepare('SELECT * FROM artifact_revisions WHERE revision_id = ?').get(revisionId)
      );
    },

    /**
     * Resolve only a Revision that was once a complete, formally adopted
     * ChangeSet cohort.  Preview, interrupted, validation-failed, abandoned,
     * never-adopted reverts and incomplete cohorts are intentionally excluded
     * from historical restore.
     */
    resolveRestorableRevision({ revisionId, projectId = null } = {}) {
      const revision = api.getRevision(revisionId);
      if (!revision || (projectId && revision.projectId !== projectId)) {
        throw new ResultStudioRepositoryError('revision_not_found', `Unknown Revision: ${revisionId}`);
      }
      const changeSet = api.getChangeSet(revision.changeSetId);
      if (!changeSet || changeSet.projectId !== revision.projectId) {
        throw new ResultStudioRepositoryError(
          'revision_restore_change_set_missing',
          'Revision does not belong to a durable ChangeSet in the same project.',
          { revisionId: revision.revisionId, changeSetId: revision.changeSetId }
        );
      }
      if (!['adopted', 'reverted'].includes(changeSet.status)) {
        throw new ResultStudioRepositoryError(
          'revision_restore_status_forbidden',
          `Revision cannot be restored from ChangeSet status ${changeSet.status}.`,
          { revisionId: revision.revisionId, changeSetId: changeSet.changeSetId, status: changeSet.status }
        );
      }
      if (!changeSet.adoptedAt) {
        throw new ResultStudioRepositoryError(
          'revision_restore_never_adopted',
          'A discarded preview was never a formal result and cannot be restored.',
          { revisionId: revision.revisionId, changeSetId: changeSet.changeSetId }
        );
      }
      const cohort = api.listRevisionsByChangeSet(changeSet.changeSetId);
      const cohortIds = cohort.map((entry) => entry.revisionId);
      const candidateIds = changeSet.candidateArtifactRefs;
      const complete = cohort.length > 0
        && sameStringSet(cohortIds, candidateIds)
        && cohort.every((entry) => entry.projectId === changeSet.projectId
          && entry.changeSetId === changeSet.changeSetId
          && entry.validationStatus !== 'blocked'
          && !!entry.sourceCommit
          && entry.sourceCommit === changeSet.candidateCommit);
      if (!complete) {
        throw new ResultStudioRepositoryError(
          'revision_restore_change_set_partial',
          'Revision belongs to an incomplete or incoherent ChangeSet cohort.',
          {
            revisionId: revision.revisionId,
            changeSetId: changeSet.changeSetId,
            candidateArtifactRefs: candidateIds,
            persistedRevisionIds: cohortIds,
          }
        );
      }
      return { revision, changeSet, cohort };
    },

    /**
     * Persist an exact independent replay proof and upgrade the complete
     * adopted source cohort to `verified` in one transaction.  The proof is
     * durable in ChangeSet validationSummary until a dedicated normalized
     * replay-proof migration is introduced; callers cannot upgrade a subset
     * or provide hashes that differ from either persisted Revision.
     */
    recordReplayProofAndVerifyCohort({
      projectId,
      changeSetId,
      replayPackageDigest,
      proofs,
      beforeCommit = null,
    } = {}) {
      if (!projectId || !changeSetId || !SHA256_PATTERN.test(String(replayPackageDigest || ''))
          || !Array.isArray(proofs) || proofs.length === 0) {
        throw new ResultStudioRepositoryError(
          'replay_proof_invalid',
          'Replay proof requires project, source ChangeSet, package digest and at least one output proof.'
        );
      }
      const apply = transaction(() => {
        const sourceChangeSet = api.getChangeSet(changeSetId);
        if (!sourceChangeSet || sourceChangeSet.projectId !== projectId || sourceChangeSet.status !== 'adopted'
            || !sourceChangeSet.adoptedAt) {
          throw new ResultStudioRepositoryError(
            'replay_proof_source_not_adopted',
            'Only a formally adopted ChangeSet cohort can receive a verified replay proof.',
            { projectId, changeSetId, status: sourceChangeSet && sourceChangeSet.status }
          );
        }
        const sourceCohort = api.listRevisionsByChangeSet(changeSetId);
        const sourceIds = sourceCohort.map((revision) => revision.revisionId);
        const proofSourceIds = proofs.map((proof) => proof && proof.sourceRevisionId);
        if (!sameStringSet(sourceIds, sourceChangeSet.candidateArtifactRefs)
            || !sameStringSet(sourceIds, proofSourceIds)) {
          throw new ResultStudioRepositoryError(
            'replay_proof_cohort_incomplete',
            'Replay proof must cover the exact complete adopted Revision cohort.',
            { sourceRevisionIds: sourceIds, candidateArtifactRefs: sourceChangeSet.candidateArtifactRefs, proofSourceRevisionIds: proofSourceIds }
          );
        }
        const normalizedProofs = [];
        const replayChangeSetIds = new Set();
        const replayRevisionIds = new Set();
        for (const proof of proofs) {
          const source = sourceCohort.find((revision) => revision.revisionId === proof.sourceRevisionId);
          const replay = api.getRevision(proof.replayRevisionId);
          if (!source || !replay || replay.projectId !== projectId || replay.revisionId === source.revisionId
              || replay.artifactFamilyId !== source.artifactFamilyId || replay.artifactId !== source.artifactId
              || !replay.parentRevisionIds.includes(source.revisionId)
              || replay.validationStatus === 'blocked'
              || replay.toolJobId !== proof.replayToolJobId || replay.toolJobId === source.toolJobId
              || proof.sourceOutputHash !== source.outputHash
              || proof.replayOutputHash !== replay.outputHash
              || proof.sourceOutputHash !== proof.replayOutputHash
              || !SHA256_PATTERN.test(String(proof.sourceOutputHash || ''))) {
            throw new ResultStudioRepositoryError(
              'replay_proof_output_mismatch',
              'Replay proof does not resolve to an independent byte-identical Revision output.',
              { sourceRevisionId: proof && proof.sourceRevisionId, replayRevisionId: proof && proof.replayRevisionId }
            );
          }
          replayChangeSetIds.add(replay.changeSetId);
          if (replayRevisionIds.has(replay.revisionId)) {
            throw new ResultStudioRepositoryError('replay_proof_duplicate_revision', 'A replay Revision cannot prove more than one source output.');
          }
          replayRevisionIds.add(replay.revisionId);
          normalizedProofs.push({
            sourceRevisionId: source.revisionId,
            replayRevisionId: replay.revisionId,
            sourceToolJobId: source.toolJobId,
            replayToolJobId: replay.toolJobId,
            artifactFamilyId: source.artifactFamilyId,
            artifactId: source.artifactId,
            sourceOutputHash: source.outputHash,
            replayOutputHash: replay.outputHash,
            exactMatch: true,
          });
        }
        if (replayChangeSetIds.size !== 1) {
          throw new ResultStudioRepositoryError(
            'replay_proof_mixed_change_set',
            'One independent replay ChangeSet must reproduce the complete source cohort.'
          );
        }
        const [replayChangeSetId] = replayChangeSetIds;
        const replayChangeSet = api.getChangeSet(replayChangeSetId);
        const replayCohortIds = api.listRevisionsByChangeSet(replayChangeSetId).map((revision) => revision.revisionId);
        if (!replayChangeSet || replayChangeSet.projectId !== projectId
            || !['preview_ready', 'adopted'].includes(replayChangeSet.status)
            || !sameStringSet(replayCohortIds, replayChangeSet.candidateArtifactRefs)
            || !sameStringSet(replayCohortIds, [...replayRevisionIds])) {
          throw new ResultStudioRepositoryError(
            'replay_proof_candidate_incomplete',
            'Replay proof must come from one complete preview/adopted replay cohort.',
            { replayChangeSetId, replayRevisionIds: [...replayRevisionIds], candidateArtifactRefs: replayChangeSet && replayChangeSet.candidateArtifactRefs }
          );
        }
        normalizedProofs.sort((left, right) => left.sourceRevisionId.localeCompare(right.sourceRevisionId));
        const replayProof = {
          replayProofVersion: 1,
          replayPackageDigest,
          sourceChangeSetId: changeSetId,
          replayChangeSetId,
          exactMatch: true,
          outputs: normalizedProofs,
        };
        const existingProof = sourceChangeSet.validationSummary?.replayProof || null;
        if (existingProof && toJson(existingProof) !== toJson(replayProof)) {
          throw new ResultStudioRepositoryError(
            'replay_proof_conflict',
            'The adopted ChangeSet is already bound to a different replay proof.'
          );
        }
        for (const revision of sourceCohort) {
          if (!['available', 'verified'].includes(revision.reproducibilityStatus)) {
            throw new ResultStudioRepositoryError(
              'replay_proof_source_unavailable',
              'Every source Revision must have replay material available before verification.',
              { revisionId: revision.revisionId, reproducibilityStatus: revision.reproducibilityStatus }
            );
          }
          db.prepare(`UPDATE artifact_revisions SET reproducibility_status = 'verified'
              WHERE revision_id = ? AND project_id = ? AND change_set_id = ?`)
            .run(revision.revisionId, projectId, changeSetId);
        }
        const validationSummary = { ...(sourceChangeSet.validationSummary || {}), replayProof };
        db.prepare('UPDATE scientific_change_sets SET validation_summary_json = ?, updated_at = ? WHERE change_set_id = ? AND status = ?')
          .run(toJson(validationSummary), nowIso(), changeSetId, 'adopted');
        if (typeof beforeCommit === 'function') {
          beforeCommit({ sourceChangeSet, sourceCohort, replayChangeSet, replayProof });
        }
        return { replayProof, idempotent: !!existingProof };
      });
      const result = apply();
      return {
        changeSet: api.getChangeSet(changeSetId),
        revisions: api.listRevisionsByChangeSet(changeSetId),
        replayProof: result.replayProof,
        idempotent: result.idempotent,
      };
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

    listRevisions({ artifactFamilyId, projectId = null, limit = 100, offset = 0, order = 'asc' } = {}) {
      const bounded = Number.isInteger(limit) && limit > 0 && limit <= 1000 ? limit : 100;
      const skipped = Number.isInteger(offset) && offset >= 0 ? offset : 0;
      const direction = order === 'desc' ? 'DESC' : 'ASC';
      const sql = projectId
        ? `SELECT * FROM artifact_revisions WHERE artifact_family_id = ? AND project_id = ?
            ORDER BY revision_ordinal ${direction} LIMIT ? OFFSET ?`
        : `SELECT * FROM artifact_revisions WHERE artifact_family_id = ?
            ORDER BY revision_ordinal ${direction} LIMIT ? OFFSET ?`;
      const args = projectId
        ? [artifactFamilyId, projectId, bounded, skipped]
        : [artifactFamilyId, bounded, skipped];
      return db.prepare(sql)
        .all(...args)
        .map(rowToRevision);
    },

    listProjectRevisions(projectId, { limit = 5000 } = {}) {
      const bounded = Number.isInteger(limit) && limit > 0 && limit <= 10000 ? limit : 5000;
      return db.prepare(`SELECT * FROM artifact_revisions WHERE project_id = ?
          ORDER BY created_at ASC LIMIT ?`)
        .all(projectId, bounded)
        .map(rowToRevision);
    },

    countProjectRevisions(projectId) {
      return Number(db.prepare('SELECT COUNT(*) AS count FROM artifact_revisions WHERE project_id = ?')
        .get(projectId)?.count || 0);
    },

    listAllProjectRevisions(projectId) {
      return db.prepare(`SELECT * FROM artifact_revisions WHERE project_id = ?
          ORDER BY created_at ASC`)
        .all(projectId)
        .map(rowToRevision);
    },

    getCurrentRevision(artifactFamilyId, projectId = null) {
      return rowToRevision(
        projectId
          ? db.prepare('SELECT * FROM artifact_revisions WHERE artifact_family_id = ? AND project_id = ? AND is_current = 1')
            .get(artifactFamilyId, projectId)
          : db.prepare('SELECT * FROM artifact_revisions WHERE artifact_family_id = ? AND is_current = 1')
            .get(artifactFamilyId)
      );
    },

    listCurrentRevisions(projectId) {
      return db.prepare('SELECT * FROM artifact_revisions WHERE project_id = ? AND is_current = 1')
        .all(projectId)
        .map(rowToRevision);
    },

    // ----------------------------------------------- durable Git/SQLite refs

    prepareRefTransaction(input = {}) {
      const operationId = String(input.operationId || '').trim();
      const projectId = String(input.projectId || '').trim();
      const changeSetId = String(input.changeSetId || '').trim();
      const operationKind = String(input.operationKind || '').trim();
      const sourceStatus = String(input.sourceStatus || '').trim();
      const targetStatus = String(input.targetStatus || '').trim();
      const refUpdates = Array.isArray(input.refUpdates) ? input.refUpdates.map((entry) => ({
        ref: String(entry?.ref || '').trim(),
        expectedOld: String(entry?.expectedOld || '').trim(),
        newOid: String(entry?.newOid || '').trim(),
      })) : [];
      const targetRevisionIds = Array.isArray(input.targetRevisionIds)
        ? input.targetRevisionIds.map((value) => String(value || '').trim())
        : [];
      const suppliedOwnerLease = input.ownerLease || getResultStudioRuntimeLease();
      const ownerLease = isResultStudioRuntimeLease(suppliedOwnerLease)
        && Number.isInteger(suppliedOwnerLease.ownerPid)
        ? {
          instanceId: String(suppliedOwnerLease.instanceId),
          startedAt: String(suppliedOwnerLease.startedAt),
          ownerPid: suppliedOwnerLease.ownerPid,
        }
        : null;
      const checkpointValidation = validateWorkspaceCheckpoint(input.checkpoint);
      if (!isCanonicalIdentifier(operationId) || !isCanonicalIdentifier(projectId)
          || !isCanonicalIdentifier(changeSetId) || !isCanonicalIdentifier(operationKind)
          || !sourceStatus || !targetStatus || !canTransitionChangeSet(sourceStatus, targetStatus).allowed
          || refUpdates.length === 0
          || new Set(refUpdates.map((entry) => entry.ref)).size !== refUpdates.length
          || refUpdates.some((entry) => !PETRI_REF_PATTERN.test(entry.ref)
            || !GIT_OID_PATTERN.test(entry.expectedOld)
            || !GIT_OID_PATTERN.test(entry.newOid)
            || entry.expectedOld === entry.newOid)
          || targetRevisionIds.some((value) => !isCanonicalIdentifier(value))
          || new Set(targetRevisionIds).size !== targetRevisionIds.length
          || !ownerLease
          || !checkpointValidation.ok) {
        throw new ResultStudioRepositoryError(
          'ref_transaction_invalid',
          'A durable ref transition requires one exact CAS cohort and a valid target checkpoint.'
        );
      }
      const checkpoint = checkpointValidation.checkpoint;
      if (checkpoint.projectId !== projectId || checkpoint.changeSetId !== changeSetId
          || checkpoint.changeSetStatus !== targetStatus) {
        throw new ResultStudioRepositoryError(
          'ref_transaction_checkpoint_mismatch',
          'The durable ref transition checkpoint does not describe its exact target state.'
        );
      }
      assertRefTransactionRevisionBindings({
        projectId,
        refUpdates,
        targetRevisionIds,
      }, (revisionId) => api.getRevision(revisionId));
      const timestamp = nowIso();
      const statusReason = input.statusReason == null ? null : String(input.statusReason);
      const immutableIntent = {
        contractVersion: 1,
        operationId,
        projectId,
        changeSetId,
        operationKind,
        sourceStatus,
        targetStatus,
        refUpdates,
        targetRevisionIds,
        checkpoint,
        ownerLease,
        statusReason,
        createdAt: timestamp,
      };
      const intentHash = computeResultRefTransactionHash(immutableIntent);
      const apply = immediateTransaction(() => {
        const current = api.getChangeSet(changeSetId);
        if (!current || current.projectId !== projectId || current.status !== sourceStatus) {
          throw new ResultStudioRepositoryError(
            'ref_transaction_source_conflict',
            'The ChangeSet no longer matches the prepared ref transition source state.',
            { expected: sourceStatus, actual: current?.status || null },
          );
        }
        const active = db.prepare(`SELECT * FROM result_ref_transactions
            WHERE project_id = ? AND state IN ('prepared', 'refs_applied')`)
          .all(projectId)
          .map(rowToRefTransaction)
          .map(assertRefTransactionIntegrity)[0] || null;
        if (active) {
          throw new ResultStudioRepositoryError(
            'ref_transaction_project_active',
            'The project already has an unfinished durable ref transition.',
            { operationId: active.operationId },
          );
        }
        db.prepare(`INSERT INTO result_ref_transactions (
            operation_id, contract_version, project_id, change_set_id, operation_kind, state,
            source_status, target_status, ref_updates_json, target_revision_ids_json,
            checkpoint_json, owner_lease_json, intent_hash, status_reason, failure_reason,
            created_at, updated_at, completed_at
          ) VALUES (?, 1, ?, ?, ?, 'prepared', ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL)`)
          .run(
            operationId, projectId, changeSetId, operationKind, sourceStatus, targetStatus,
            toJson(refUpdates), toJson(targetRevisionIds), toJson(checkpoint),
            toJson(ownerLease), intentHash, statusReason, timestamp, timestamp,
          );
      });
      apply();
      return api.getRefTransaction(operationId);
    },

    getRefTransaction(operationId) {
      return rowToRefTransaction(
        db.prepare('SELECT * FROM result_ref_transactions WHERE operation_id = ?').get(operationId)
      );
    },

    listActiveRefTransactions(projectId) {
      return db.prepare(`SELECT * FROM result_ref_transactions
          WHERE project_id = ? AND state IN ('prepared', 'refs_applied')
          ORDER BY created_at ASC, operation_id ASC`)
        .all(projectId)
        .map(rowToRefTransaction);
    },

    markRefTransactionRefsApplied(operationId) {
      const timestamp = nowIso();
      const result = db.prepare(`UPDATE result_ref_transactions
          SET state = 'refs_applied', updated_at = ?
          WHERE operation_id = ? AND state = 'prepared'`)
        .run(timestamp, operationId);
      const current = api.getRefTransaction(operationId);
      if (result.changes !== 1 && current?.state !== 'refs_applied') {
        throw new ResultStudioRepositoryError(
          'ref_transaction_state_conflict',
          'The durable ref transition is not waiting for Git ref acknowledgement.'
        );
      }
      return current;
    },

    abortRefTransaction(operationId, reason = null) {
      const timestamp = nowIso();
      const result = db.prepare(`UPDATE result_ref_transactions
          SET state = 'aborted', failure_reason = ?,
              updated_at = ?, completed_at = ?
          WHERE operation_id = ? AND state IN ('prepared', 'refs_applied')`)
        .run(reason == null ? null : String(reason), timestamp, timestamp, operationId);
      const current = api.getRefTransaction(operationId);
      if (result.changes !== 1 && current?.state !== 'aborted') {
        throw new ResultStudioRepositoryError(
          'ref_transaction_state_conflict',
          'The durable ref transition cannot be aborted from its current state.'
        );
      }
      return current;
    },

    finalizeRefTransaction(operationId) {
      const apply = immediateTransaction(() => {
        const intent = api.getRefTransaction(operationId);
        if (!intent) {
          throw new ResultStudioRepositoryError('ref_transaction_not_found', 'Unknown durable ref transition.');
        }
        if (intent.state === 'completed') return intent;
        assertRefTransactionIntegrity(intent);
        if (intent.state !== 'refs_applied') {
          throw new ResultStudioRepositoryError(
            'ref_transaction_state_conflict',
            'The durable ref transition has not acknowledged its Git ref cohort.'
          );
        }
        const checkpointValidation = validateWorkspaceCheckpoint(intent.checkpoint);
        if (!checkpointValidation.ok) {
          throw new ResultStudioRepositoryError(
            'ref_transaction_checkpoint_invalid',
            'The durable ref transition target checkpoint failed validation.'
          );
        }
        const targetRevisions = assertRefTransactionRevisionBindings(
          intent,
          (revisionId) => api.getRevision(revisionId),
        );
        const timestamp = nowIso();
        const statusUpdate = db.prepare(`UPDATE scientific_change_sets SET
            status = ?, status_reason = ?, updated_at = ?,
            adopted_at = CASE WHEN ? = 'adopted' THEN ? ELSE adopted_at END,
            reverted_at = CASE WHEN ? = 'reverted' THEN ? ELSE reverted_at END
          WHERE change_set_id = ? AND project_id = ? AND status = ?`)
          .run(
            intent.targetStatus, intent.statusReason, timestamp,
            intent.targetStatus, timestamp, intent.targetStatus, timestamp,
            intent.changeSetId, intent.projectId, intent.sourceStatus,
          );
        if (statusUpdate.changes !== 1) {
          throw new ResultStudioRepositoryError(
            'ref_transaction_source_conflict',
            'The ChangeSet advanced before the durable ref transition finalized.',
            { expected: intent.sourceStatus },
          );
        }
        for (const revision of targetRevisions) {
          db.prepare(`UPDATE artifact_revisions SET is_current = 0
              WHERE project_id = ? AND artifact_family_id = ? AND is_current = 1`)
            .run(intent.projectId, revision.artifactFamilyId);
          const target = db.prepare('UPDATE artifact_revisions SET is_current = 1 WHERE revision_id = ? AND project_id = ?')
            .run(revision.revisionId, intent.projectId);
          if (target.changes !== 1) {
            throw new ResultStudioRepositoryError(
              'ref_transaction_target_revision_conflict',
              'The target Revision could not become current atomically.'
            );
          }
        }
        const actualCurrentRevisionIds = api.listCurrentRevisions(intent.projectId)
          .map((revision) => revision.revisionId);
        if (!sameStringSet(actualCurrentRevisionIds, checkpointValidation.checkpoint.currentRevisionIds)) {
          throw new ResultStudioRepositoryError(
            'ref_transaction_checkpoint_current_mismatch',
            'The target checkpoint does not match the finalized current Revision set.'
          );
        }
        api.saveCheckpoint(checkpointValidation.checkpoint);
        const completed = db.prepare(`UPDATE result_ref_transactions
            SET state = 'completed', updated_at = ?, completed_at = ?
            WHERE operation_id = ? AND state IN ('prepared', 'refs_applied')`)
          .run(timestamp, timestamp, operationId);
        if (completed.changes !== 1) {
          throw new ResultStudioRepositoryError(
            'ref_transaction_state_conflict',
            'The durable ref transition changed while finalizing.'
          );
        }
        return api.getRefTransaction(operationId);
      });
      return apply();
    },

    // ------------------------------------------------------- adopt / revert

    /**
     * 采用一个 ChangeSet：状态转 adopted，并原子切换其候选 Revision 为 current。
     *
     * 幂等：已 adopted 时直接返回同一结果，不重复切换。
     * 原子：状态与 current 指针在同一事务内完成，异常退出不留"部分采用"。
     */
    adoptChangeSet({ changeSetId, candidateCommit = undefined, beforeCommit = null } = {}) {
      const current = api.getChangeSet(changeSetId);
      if (!current) {
        throw new ResultStudioRepositoryError('change_set_not_found', `Unknown ChangeSet: ${changeSetId}`);
      }
      if (current.status === 'adopted') {
        const revisions = api.listRevisionsByChangeSet(changeSetId);
        const revisionIds = revisions.map((revision) => revision.revisionId);
        const candidateArtifactRefs = current.candidateArtifactRefs;
        if (revisions.length === 0
            || !Array.isArray(candidateArtifactRefs)
            || (candidateArtifactRefs.length > 0
              && !sameStringSet(candidateArtifactRefs, revisionIds))) {
          throw new ResultStudioRepositoryError(
            'change_set_adoption_cohort_incoherent',
            'An adopted ChangeSet no longer has one complete candidate Revision cohort.',
            {
              changeSetId,
              candidateArtifactRefs,
              persistedRevisionIds: revisionIds,
            }
          );
        }
        const staleRevisions = revisions.filter((revision) => {
          const currentRevision = api.getCurrentRevision(revision.artifactFamilyId, revision.projectId);
          return !revision.isCurrent || !currentRevision || currentRevision.revisionId !== revision.revisionId;
        });
        if (staleRevisions.length > 0) {
          throw new ResultStudioRepositoryError(
            'change_set_adoption_not_current',
            'An adopted ChangeSet can be idempotent only while its exact Revision cohort is current.',
            {
              changeSetId,
              staleRevisionIds: staleRevisions.map((revision) => revision.revisionId),
              currentRevisionIds: revisions.map((revision) => (
                api.getCurrentRevision(revision.artifactFamilyId, revision.projectId)?.revisionId || null
              )),
            }
          );
        }
        return {
          changeSet: current,
          adoptedRevisionIds: revisionIds,
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
        const statusUpdate = db.prepare(`UPDATE scientific_change_sets SET
            status = 'adopted', adopted_at = ?, updated_at = ?,
            candidate_commit = COALESCE(?, candidate_commit)
          WHERE change_set_id = ? AND status = ?`)
          .run(timestamp, timestamp, candidateCommit === undefined ? null : candidateCommit, changeSetId, current.status);
        if (statusUpdate.changes !== 1) {
          throw new ResultStudioRepositoryError(
            'change_set_conflict',
            'ChangeSet changed concurrently during adopt.',
            { expected: current.status },
          );
        }
        for (const rev of revisions) {
          // 先清空同 family 的旧 current，再置新 current；
          // partial unique index 保证任何中间态都不会出现两个 current。
          db.prepare('UPDATE artifact_revisions SET is_current = 0 WHERE artifact_family_id = ? AND project_id = ? AND is_current = 1')
            .run(rev.artifactFamilyId, rev.projectId);
          db.prepare('UPDATE artifact_revisions SET is_current = 1 WHERE revision_id = ?').run(rev.revisionId);
        }
        if (typeof beforeCommit === 'function') {
          beforeCommit({ changeSet: current, revisions });
        }
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
     * 已采用 → 把每个 family 的 current 回退到候选声明的 exact same-family parent；
     *          历史 Revision 一律保留（计划 §3.2：不自动消失）。
     */
    revertChangeSet({ changeSetId, reason = null, beforeCommit = null } = {}) {
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
        const statusUpdate = db.prepare(`UPDATE scientific_change_sets SET
            status = 'reverted', status_reason = ?, reverted_at = ?, updated_at = ?
          WHERE change_set_id = ? AND status = ?`)
          .run(reason, timestamp, timestamp, changeSetId, current.status);
        if (statusUpdate.changes !== 1) {
          throw new ResultStudioRepositoryError(
            'change_set_conflict',
            'ChangeSet changed concurrently during revert.',
            { expected: current.status },
          );
        }
        if (wasAdopted) {
          for (const rev of revisions) {
            if (!rev.isCurrent) {
              throw new ResultStudioRepositoryError(
                'revert_revision_not_current',
                'An adopted ChangeSet can only be reverted while its exact Revision cohort is current.',
                { changeSetId, revisionId: rev.revisionId, artifactFamilyId: rev.artifactFamilyId }
              );
            }
            const sameFamilyParents = rev.parentRevisionIds
              .map((revisionId) => db.prepare('SELECT * FROM artifact_revisions WHERE revision_id = ?').get(revisionId))
              .filter((row) => row
                && row.project_id === rev.projectId
                && row.artifact_family_id === rev.artifactFamilyId
                && row.validation_status !== 'blocked');
            if (sameFamilyParents.length !== 1) {
              throw new ResultStudioRepositoryError(
                'revert_parent_unavailable',
                'Revert requires exactly one valid same-family parent recorded by the candidate Revision.',
                {
                  changeSetId,
                  revisionId: rev.revisionId,
                  parentRevisionIds: rev.parentRevisionIds,
                  sameFamilyParentIds: sameFamilyParents.map((row) => row.revision_id),
                }
              );
            }
            const previous = sameFamilyParents[0];
            db.prepare('UPDATE artifact_revisions SET is_current = 0 WHERE revision_id = ?').run(rev.revisionId);
            db.prepare('UPDATE artifact_revisions SET is_current = 1 WHERE revision_id = ?').run(previous.revision_id);
            restored.push(previous.revision_id);
          }
        }
        if (typeof beforeCommit === 'function') {
          beforeCommit({
            changeSet: current,
            revisions,
            restoredRevisions: restored.map((revisionId) => api.getRevision(revisionId)).filter(Boolean),
          });
        }
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
      const displayState = {
        ...(sel.displayState || {}),
        filterHash: sel.filterHash || null,
      };
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
            toJson(sel.filterExpression), toJson(sel.sort), toJson(sel.viewport), toJson(displayState),
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
            toJson(sel.sort), toJson(sel.viewport), toJson(displayState), sel.createdAt, sel.updatedAt
          );
      }
      return api.getSelection(sel.selectionId);
    },

    getSelection(selectionId) {
      return rowToSelection(
        db.prepare('SELECT * FROM result_selection_contexts WHERE selection_id = ?').get(selectionId)
      );
    },

    findLatestSelection({ projectId, conversationId = null, artifactId }) {
      if (!projectId || !artifactId) return null;
      let row = conversationId
        ? db.prepare(`SELECT * FROM result_selection_contexts
            WHERE project_id = ? AND conversation_id = ? AND artifact_id = ?
            ORDER BY updated_at DESC, rowid DESC LIMIT 1`).get(projectId, conversationId, artifactId)
        : db.prepare(`SELECT * FROM result_selection_contexts
            WHERE project_id = ? AND conversation_id IS NULL AND artifact_id = ?
            ORDER BY updated_at DESC, rowid DESC LIMIT 1`).get(projectId, artifactId);
      // A result can be selected before the first chat message creates a
      // conversation. Once that conversation exists, preserve the explicitly
      // project-scoped selection instead of making it appear to vanish. Never
      // fall back to a selection owned by another conversation.
      if (!row && conversationId) {
        row = db.prepare(`SELECT * FROM result_selection_contexts
            WHERE project_id = ? AND conversation_id IS NULL AND artifact_id = ?
            ORDER BY updated_at DESC, rowid DESC LIMIT 1`).get(projectId, artifactId);
      }
      return rowToSelection(row);
    },

    deleteSelection(selectionId) {
      const result = db.prepare('DELETE FROM result_selection_contexts WHERE selection_id = ?').run(selectionId);
      return { deleted: result.changes > 0 };
    },

    listProjectSelections(projectId, { limit = 5000 } = {}) {
      const bounded = Number.isInteger(limit) && limit > 0 && limit <= 10000 ? limit : 5000;
      return db.prepare(`SELECT * FROM result_selection_contexts WHERE project_id = ?
          ORDER BY updated_at DESC LIMIT ?`)
        .all(projectId, bounded)
        .map(rowToSelection);
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

    /**
     * Close or reconcile one restart-owned ChangeSet without exposing a
     * terminal ChangeSet alongside its stale checkpoint.  The expected hash
     * and status are compare-and-swap guards against a live process advancing
     * the same operation after the recovery scan.
     */
    applyRecoveryTransition({
      transition,
      checkpoint,
      expectedCheckpointHash,
      expectedChangeSetStatus,
      beforeCommit = null,
    } = {}) {
      if (!transition || !transition.changeSetId || !transition.to
          || !checkpoint || !checkpoint.checkpointId
          || checkpoint.changeSetId !== transition.changeSetId
          || !expectedCheckpointHash || !expectedChangeSetStatus) {
        throw new ResultStudioRepositoryError(
          'recovery_transition_invalid',
          'Atomic recovery requires one ChangeSet transition and its exact checkpoint.'
        );
      }
      const apply = transaction(() => {
        const storedChangeSet = api.getChangeSet(transition.changeSetId);
        const storedCheckpoint = api.getCheckpoint(checkpoint.checkpointId);
        const integrity = storedCheckpoint
          ? api.verifyCheckpointIntegrity(storedCheckpoint.checkpointId)
          : { matches: false };
        if (!storedChangeSet || storedChangeSet.status !== expectedChangeSetStatus) {
          throw new ResultStudioRepositoryError(
            'recovery_change_set_conflict',
            'ChangeSet advanced after the recovery scan.',
            {
              changeSetId: transition.changeSetId,
              expectedStatus: expectedChangeSetStatus,
              actualStatus: storedChangeSet?.status || null,
            }
          );
        }
        if (!storedCheckpoint
            || storedCheckpoint.projectId !== storedChangeSet.projectId
            || storedCheckpoint.changeSetId !== storedChangeSet.changeSetId
            || storedCheckpoint.checkpointHash !== expectedCheckpointHash
            || !integrity.matches) {
          throw new ResultStudioRepositoryError(
            'recovery_checkpoint_conflict',
            'Checkpoint advanced or failed integrity validation after the recovery scan.',
            { checkpointId: checkpoint.checkpointId, changeSetId: transition.changeSetId }
          );
        }
        const transitioned = api.transitionChangeSet(transition);
        if (checkpoint.projectId !== transitioned.changeSet.projectId
            || checkpoint.changeSetStatus !== transitioned.changeSet.status
            || (checkpoint.candidateCommit || null) !== (transitioned.changeSet.candidateCommit || null)) {
          throw new ResultStudioRepositoryError(
            'recovery_checkpoint_transition_mismatch',
            'Recovered checkpoint must describe the exact resulting ChangeSet state.'
          );
        }
        const savedCheckpoint = api.saveCheckpoint(checkpoint);
        if (typeof beforeCommit === 'function') {
          beforeCommit({ changeSet: transitioned.changeSet, checkpoint: savedCheckpoint });
        }
        return {
          changeSetId: transitioned.changeSet.changeSetId,
          checkpointId: savedCheckpoint.checkpointId,
          changed: transitioned.changed,
        };
      });
      const result = apply();
      return {
        changeSet: api.getChangeSet(result.changeSetId),
        checkpoint: api.getCheckpoint(result.checkpointId),
        changed: result.changed,
      };
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

    listProjectCheckpoints(projectId, { limit = 5000 } = {}) {
      const bounded = Number.isInteger(limit) && limit > 0 && limit <= 10000 ? limit : 5000;
      return db.prepare(`SELECT * FROM workspace_revision_checkpoints WHERE project_id = ?
          ORDER BY updated_at DESC LIMIT ?`)
        .all(projectId, bounded)
        .map(rowToCheckpoint);
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
      const pendingChangeSets = new Set(
        db.prepare("SELECT change_set_id FROM scientific_change_sets WHERE project_id = ? AND status IN ('draft', 'running', 'preview_ready')")
          .all(projectId).map((row) => row.change_set_id)
      );
      const referenced = new Set();
      for (const rev of all) {
        for (const parentId of rev.parentRevisionIds) referenced.add(parentId);
        for (const ref of rev.inputArtifactRefs) {
          if (ref && ref.artifactId) referenced.add(ref.artifactId);
        }
      }
      for (const selection of api.listProjectSelections(projectId)) {
        if (selection.revisionId) referenced.add(selection.revisionId);
      }
      for (const checkpoint of api.listProjectCheckpoints(projectId)) {
        for (const revisionId of checkpoint.currentRevisionIds || []) referenced.add(revisionId);
        const pendingRevisionIds = checkpoint.pendingPreview?.revisionIds;
        if (Array.isArray(pendingRevisionIds)) pendingRevisionIds.forEach((revisionId) => referenced.add(revisionId));
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
        if (pendingChangeSets.has(rev.changeSetId)) reasons.push('pending_change_set');
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
