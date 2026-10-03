'use strict';

/**
 * BLOCK-138 §9 方向 1（F1）——链形成点 pending 信任层注册。
 *
 * chat/agent 分析链产物从不进入 RS Revision 生命周期 → validateLineage
 * （result-workflow-graph.js）要求 input.lineage.sourceRevisionId 经
 * repository.getRevision 解析到已持久化 ArtifactRevision → 三条血缘路径全断
 * （AUDIT-LOG 🟡 2026-10-02 blocker B1/B3）。本原语在链形成点把已完成 Job 的
 * 可证明产物经**既有 changeset 管线**注册为 **pending ChangeSet + preview
 * revisions**：幂等（确定性 id）；**绝不自动 adopt**——adopt 仍是人的审阅动作，
 * is_current 只能由 adoptChangeSet/durable ref 翻转（insertRevision 恒写 0）。
 *
 * 与 baseline-cohort 的区别：本原语面向裸 job（无 descriptor 要求，产物证明=
 * result.artifacts ∩ executionProvenance.artifacts 且文件 hash 一致），使用独立
 * 确定性 id 盐（'chain-preview-v1'）与独立 intentRef（'chain-preview:…'），
 * 与 baseline 资格机械（inspectBaselineArtifactCohort 的 preview 修复路径）
 * 完全不相交，杜绝任何间接自动 adopt。注册后 ChangeSet 停在 preview_ready，
 * 进入项目审阅队列等待人工裁决（用户已知情语义后果）。
 *
 * 契约测试：test/block138-f1-chain-pending-registration.test.mjs。
 */

const fs = require('fs');
const path = require('path');
const { stableStringify } = require('../canonical-json');
const {
  MAX_PARAMETERS_BYTES,
  MAX_SCRIPT_BYTES,
  ResultChangeSetError,
  deterministicId,
  hashFile,
  projectRelativeOutput,
  safeSegment,
  sha256,
  stableJson,
} = require('./internal');
const {
  resolveBaseCommit,
  saveResultEditCheckpoint,
  startResultEditChangeSet,
  transitionResultEditWithCheckpoint,
} = require('./checkpoints');
const { buildAuthoritativeWorkflowGraph } = require('../result-workflow-graph');

const CHAIN_PREVIEW_INTENT_REF_PREFIX = 'chain-preview:';

/**
 * 补刃第二件：注册成功后以该 job 为 source 构建权威工作流图并落库
 * （attempt-5 实证：changesets preview_ready 在而 result_workflow_graphs 0 行，
 * /lineage 投影端点读不到图）。buildAuthoritativeWorkflowGraph 只读
 * Job/Revision/Selection 真值；repository.saveWorkflowGraph（persistWorkflowGraph）
 * 按 project+source_digest 幂等、不覆写历史行。落图是附加语义：依赖未注入
 * （既有单测假 repository）或 build/save 失败时只如实返回原因，绝不回滚注册、
 * 绝不向宿主抛错。
 */
function persistChainWorkflowGraph({ repository, projectId, toolJobId, listProjectToolJobs }) {
  if (!repository || typeof repository.saveWorkflowGraph !== 'function'
      || typeof listProjectToolJobs !== 'function') {
    return { ok: false, reason: 'chain_preview_graph_persist_unavailable' };
  }
  try {
    const graph = buildAuthoritativeWorkflowGraph({
      projectId,
      sourceToolJobId: toolJobId,
      jobs: listProjectToolJobs(projectId),
      repository,
    });
    if (!graph || graph.ok !== true || !graph.graph) {
      return { ok: false, reason: 'chain_preview_graph_build_failed' };
    }
    repository.saveWorkflowGraph(graph.graph);
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: (error && error.code) || 'chain_preview_graph_persist_failed' };
  }
}

/** 把落图结果并进 ensureChainRevisions 的成功返回（附加键，不改变既有字段语义）。 */
function withChainGraphPersist(result, persistInput) {
  const persist = persistChainWorkflowGraph(persistInput);
  return {
    ...result,
    graphPersisted: persist.ok === true,
    ...(persist.ok === true ? {} : { graphPersistReason: persist.reason }),
  };
}

/** 注入不完整（既有单测的假 repository 等）时零副作用跳过，绝不让宿主路径抛错。 */
function chainRepositoryCapability(repository) {
  return Boolean(repository
    && typeof repository.findRevisionByJobArtifact === 'function'
    && typeof repository.getChangeSet === 'function'
    && typeof repository.listRevisionsByChangeSet === 'function'
    && typeof repository.listCurrentRevisions === 'function'
    && typeof repository.startChangeSetWithCheckpoint === 'function'
    && typeof repository.appendRevisionBatch === 'function'
    && typeof repository.transitionChangeSet === 'function');
}

function chainFailure(repository, projectId, changeSetId, error) {
  try {
    const current = repository.getChangeSet(changeSetId);
    if (current && current.status === 'running') {
      transitionResultEditWithCheckpoint({
        repository,
        projectId,
        conversationId: null,
        changeSetId,
        to: 'validation_failed',
        stage: 'failed',
        recovery: (error && error.code) || 'chain_preview_failed',
        transition: {
          reason: (error && error.code) || 'chain_preview_failed',
          validationSummary: { error: (error && error.code) || 'chain_preview_failed' },
        },
      });
    }
  } catch { /* 保留原始失败；恢复扫描看到遗留状态 */ }
  return {
    ok: false,
    registered: false,
    idempotent: false,
    reason: (error && error.code) || 'chain_preview_failed',
  };
}

/**
 * 把一个已完成 Job 的可证明产物注册为 pending ChangeSet + preview revisions。
 *
 * @param {object} input { projectId, toolJobId, artifactId?, workspaceRoot? }
 * @param {object} dependencies { repository, getToolJob, getProject?, adapter?, bindProjectRepository? }
 * @returns {{ ok: boolean, registered: boolean, idempotent: boolean, reason?: string,
 *             changeSetId?: string, revision?: object|null, revisions?: object[] }}
 *   永不抛错：宿主（链形成点）以附加方式消费结果，注册失败时系统保持既有
 *   fail-closed 行为（下游血缘仍不可解析），不阻断已完成的执行/绑定。
 */
function ensureChainRevisions(input = {}, dependencies = {}) {
  const repository = dependencies.repository;
  // 1) 能力闸：repository 不具备既有管线 API（注入假 repository 的单测环境）→ 零副作用跳过。
  if (!chainRepositoryCapability(repository)) {
    return { ok: false, registered: false, idempotent: false, reason: 'chain_preview_repository_unavailable' };
  }
  const projectId = String(input.projectId || '').trim();
  const toolJobId = String(input.toolJobId || '').trim();
  const requestedArtifactId = String(input.artifactId || '').trim();
  const getToolJob = typeof dependencies.getToolJob === 'function' ? dependencies.getToolJob : null;
  if (!projectId || !toolJobId || !getToolJob) {
    return { ok: false, registered: false, idempotent: false, reason: 'chain_preview_context_missing' };
  }
  const sourceJob = getToolJob(toolJobId);
  if (!sourceJob || String(sourceJob.project_id || sourceJob.projectId || '') !== projectId
      || sourceJob.status !== 'completed') {
    return { ok: false, registered: false, idempotent: false, reason: 'chain_preview_source_job_invalid' };
  }
  const result = sourceJob.result && typeof sourceJob.result === 'object' ? sourceJob.result : {};
  if (!result.artifactTruth || result.artifactTruth.status !== 'valid' || result.artifactTruth.blocking === true) {
    return { ok: false, registered: false, idempotent: false, reason: 'chain_preview_artifact_truth_invalid' };
  }
  const workspaceRoot = path.resolve(String(input.workspaceRoot
    || (typeof dependencies.getProject === 'function'
      ? (dependencies.getProject(projectId) || {}).workspace_path
      : '') || ''));
  if (!workspaceRoot) {
    return { ok: false, registered: false, idempotent: false, reason: 'chain_preview_workspace_missing' };
  }

  // 2) 可证明产物：result.artifacts ∩ provenance.artifacts，且磁盘文件 hash 与 provenance 一致。
  const provenance = result.executionProvenance && typeof result.executionProvenance === 'object'
    ? result.executionProvenance
    : {};
  const provenanceByArtifactId = new Map(
    (Array.isArray(provenance.artifacts) ? provenance.artifacts : [])
      .filter((item) => item && String(item.id || '').trim())
      .map((item) => [String(item.id), item])
  );
  const provable = [];
  const seenArtifactIds = new Set();
  for (const artifact of Array.isArray(result.artifacts) ? result.artifacts : []) {
    const artifactId = String(artifact && artifact.id || '').trim();
    if (!artifactId || seenArtifactIds.has(artifactId)) continue;
    const provenanceArtifact = provenanceByArtifactId.get(artifactId);
    const outputHash = String(provenanceArtifact && provenanceArtifact.sha256 || '').trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(outputHash)) continue;
    let filePath = null;
    try {
      filePath = fs.realpathSync(artifact.path);
      if (!fs.statSync(filePath).isFile()) continue;
    } catch {
      continue;
    }
    if (hashFile(filePath) !== outputHash) continue;
    seenArtifactIds.add(artifactId);
    provable.push({ artifactId, artifact, filePath, outputHash });
  }
  if (provable.length === 0) {
    return { ok: false, registered: false, idempotent: false, reason: 'chain_preview_artifacts_unprovable' };
  }

  // 3) 幂等快路径：全部可证明产物已有 Revision → 直接返回，零 git/Revision 写副作用
  //    （权威图落库按 source_digest 幂等：首跑补落、重跑零新行）。
  const existingByArtifactId = new Map(provable.map((entry) => [entry.artifactId,
    repository.findRevisionByJobArtifact({ projectId, toolJobId, artifactId: entry.artifactId })]));
  if (provable.every((entry) => existingByArtifactId.get(entry.artifactId))) {
    const revisions = provable.map((entry) => existingByArtifactId.get(entry.artifactId));
    return withChainGraphPersist({
      ok: true,
      registered: false,
      idempotent: true,
      changeSetId: revisions[0].changeSetId,
      revision: requestedArtifactId
        ? revisions.find((revision) => revision.artifactId === requestedArtifactId) || null
        : revisions[0],
      revisions,
    }, { repository, projectId, toolJobId, listProjectToolJobs: dependencies.listProjectToolJobs });
  }

  const toolId = String(sourceJob.tool_id || sourceJob.toolId || '').trim() || 'unknown-tool';
  const language = String(provenance.plugin && provenance.plugin.language || '').toLowerCase() === 'python'
    ? 'python'
    : 'r';
  const extension = language === 'python' ? 'py' : 'R';

  // 4) 脚本快照：链形成点只有 job 可证明来源；快照缺失/漂移 → fail-closed 不注册。
  const scriptSnapshotPath = provenance.script && provenance.script.snapshotPath;
  const expectedScriptSha256 = String(provenance.script && provenance.script.sha256 || '').trim().toLowerCase();
  let scriptContent = null;
  if (scriptSnapshotPath) {
    try { scriptContent = fs.readFileSync(scriptSnapshotPath, 'utf8'); } catch { scriptContent = null; }
  }
  if (typeof scriptContent !== 'string' || !scriptContent
      || Buffer.byteLength(scriptContent) > MAX_SCRIPT_BYTES
      || (expectedScriptSha256 && sha256(scriptContent) !== expectedScriptSha256)) {
    return { ok: false, registered: false, idempotent: false, reason: 'chain_preview_script_unavailable' };
  }
  const scriptSha256 = sha256(scriptContent);

  // 5) 归一化参数（可选）：有则随 cohort 一起提交，供后续审阅/复现参考。
  const parameters = provenance.params && typeof provenance.params.normalized === 'object'
    && provenance.params.normalized !== null && !Array.isArray(provenance.params.normalized)
    ? provenance.params.normalized
    : null;
  let parametersContent = null;
  let parametersHash = null;
  if (parameters) {
    parametersContent = stableJson(parameters);
    if (Buffer.byteLength(parametersContent) <= MAX_PARAMETERS_BYTES) {
      parametersHash = sha256(parametersContent);
    } else {
      parametersContent = null;
    }
  }

  // 6) Git adapter：宿主未注入时按项目工作区自绑 managed 仓（与 verifyImmutableRevision 同源）。
  const bindRepository = dependencies.bindProjectRepository
    || require('../git-repository-binding').bindProjectRepository;
  let adapter = dependencies.adapter || null;
  if (!adapter) {
    const binding = bindRepository({ workspaceRoot, projectId });
    if (!binding || binding.status !== 'ready' || !binding.adapter) {
      return {
        ok: false,
        registered: false,
        idempotent: false,
        reason: 'chain_preview_repository_binding_unavailable',
      };
    }
    adapter = binding.adapter;
  }

  // 7) 确定性 id（独立盐，绝不与 baseline 资格机械相交）。
  const cohortDigest = sha256(stableStringify(provable
    .map((entry) => ({ artifactId: entry.artifactId, sha256: entry.outputHash }))
    .sort((left, right) => left.artifactId.localeCompare(right.artifactId))));
  const changeSetId = deterministicId('cs', 'chain-preview-v1', projectId, toolJobId, cohortDigest);
  const workingBranchRef = `refs/heads/biof3/chain-preview/${safeSegment(changeSetId, 'change_set_id')}`;

  try {
    const existingChangeSet = repository.getChangeSet(changeSetId);
    let changeSet = existingChangeSet;
    if (existingChangeSet && repository.listRevisionsByChangeSet(changeSetId).length > 0) {
      // 同内容 cohort 已存在 → 必须逐字节一致才允许幂等返回（绝不覆盖、绝不 adopt）。
      const expectedRevisionIds = provable.map((entry) => deterministicId(
        'rev', 'chain-preview-v1', changeSetId, entry.artifactId, entry.outputHash
      )).sort();
      const persistedRevisionIds = repository.listRevisionsByChangeSet(changeSetId)
        .map((revision) => revision.revisionId).sort();
      const matches = expectedRevisionIds.length === persistedRevisionIds.length
        && expectedRevisionIds.every((revisionId, index) => revisionId === persistedRevisionIds[index]);
      if (!matches || !['preview_ready'].includes(existingChangeSet.status)) {
        return { ok: false, registered: false, idempotent: false, reason: 'chain_preview_cohort_conflict' };
      }
      const revisions = provable.map((entry) => repository.findRevisionByJobArtifact({
        projectId, toolJobId, artifactId: entry.artifactId,
      }));
      return withChainGraphPersist({
        ok: true,
        registered: false,
        idempotent: true,
        changeSetId,
        revision: requestedArtifactId
          ? revisions.find((revision) => revision && revision.artifactId === requestedArtifactId) || null
          : revisions[0] || null,
        revisions,
      }, { repository, projectId, toolJobId, listProjectToolJobs: dependencies.listProjectToolJobs });
    }

    const baseCommit = resolveBaseCommit(adapter, projectId);
    if (!changeSet) {
      const started = startResultEditChangeSet({
        repository,
        stage: 'change_set',
        changeSet: {
          changeSetId,
          projectId,
          conversationId: null,
          intentRef: `${CHAIN_PREVIEW_INTENT_REF_PREFIX}${toolJobId}`,
          baseCommit,
          workingBranchRef,
          createdBy: 'agent',
          parentArtifactRefs: [],
        },
      });
      changeSet = started.changeSet;
    } else if (changeSet.status === 'draft') {
      changeSet = transitionResultEditWithCheckpoint({
        repository,
        projectId,
        conversationId: null,
        changeSetId,
        to: 'running',
        stage: 'change_set',
      }).changeSet;
    }
    if (changeSet.status !== 'running') {
      return { ok: false, registered: false, idempotent: false, reason: 'chain_preview_status_invalid' };
    }

    let candidateCommit = adapter.revParse(workingBranchRef);
    if (!candidateCommit) {
      const managedFiles = [];
      for (const entry of provable) {
        const artifactFamilyId = deterministicId('af', projectId, toolJobId, entry.artifactId);
        const revisionId = deterministicId('rev', 'chain-preview-v1', changeSetId, entry.artifactId, entry.outputHash);
        const managedBase = path.posix.join('analysis/scripts', artifactFamilyId, revisionId);
        managedFiles.push({ path: path.posix.join(managedBase, `${safeSegment(entry.artifactId, 'artifact_id')}.${extension}`), content: scriptContent });
        if (parametersContent) {
          managedFiles.push({ path: path.posix.join(managedBase, 'parameters.json'), content: parametersContent });
        }
      }
      candidateCommit = adapter.commitVirtualFiles({
        parentCommit: baseCommit,
        ref: workingBranchRef,
        expectedOld: '0'.repeat(40),
        message: `BioF3 chain preview ${toolJobId} (${provable.length} artifacts)`,
        files: managedFiles,
      }).commit;
    }

    const revisionInputs = provable.map((entry) => {
      const artifactFamilyId = deterministicId('af', projectId, toolJobId, entry.artifactId);
      const revisionId = deterministicId('rev', 'chain-preview-v1', changeSetId, entry.artifactId, entry.outputHash);
      const managedBase = path.posix.join('analysis/scripts', artifactFamilyId, revisionId);
      const scriptRelativePath = path.posix.join(managedBase, `${safeSegment(entry.artifactId, 'artifact_id')}.${extension}`);
      return {
        revisionId,
        projectId,
        artifactFamilyId,
        artifactId: entry.artifactId,
        parentRevisionIds: [],
        sourceCommit: candidateCommit,
        sourceScriptRef: {
          relativePath: scriptRelativePath,
          sha256: scriptSha256,
          entryPoint: path.posix.basename(scriptRelativePath),
          artifactId: entry.artifactId,
          rendererId: `${toolId}:${entry.artifactId}`,
          language,
          origin: 'project_materialized',
        },
        inputArtifactRefs: [],
        parametersRef: parametersContent ? path.posix.join(managedBase, 'parameters.json') : null,
        parametersHash,
        toolJobId,
        outputPath: projectRelativeOutput(workspaceRoot, entry.artifact),
        outputHash: entry.outputHash,
        validationStatus: 'valid',
        reproducibilityStatus: 'available',
        changeSetId,
      };
    });

    repository.appendRevisionBatch({
      revisions: revisionInputs,
      transition: {
        changeSetId,
        to: 'preview_ready',
        candidateCommit,
        changedPaths: revisionInputs.flatMap((revision) => {
          const paths = [{
            relativePath: revision.sourceScriptRef.relativePath,
            changeType: 'added',
            beforeHash: null,
            afterHash: scriptSha256,
          }];
          if (revision.parametersRef) {
            paths.push({
              relativePath: revision.parametersRef,
              changeType: 'added',
              beforeHash: null,
              afterHash: parametersHash,
            });
          }
          return paths;
        }),
        jobRefs: [toolJobId],
        candidateArtifactRefs: revisionInputs.map((revision) => revision.revisionId),
        validationSummary: {
          chainPreview: true,
          artifactTruthStatus: 'valid',
          formalArtifactCount: revisionInputs.length,
          formalArtifactCohort: revisionInputs.map((revision) => ({
            toolJobId,
            artifactId: revision.artifactId,
            outputHash: revision.outputHash,
          })),
        },
      },
      beforeCommit: () => {
        saveResultEditCheckpoint({
          repository,
          projectId,
          conversationId: null,
          changeSetId,
          candidateCommit,
          stage: 'preview_ready',
          recovery: 'awaiting_user_decision',
        });
      },
    });

    // 信任层红线：注册到此为止——绝不调用 adoptChangeSet / durable ref。
    // ChangeSet 停在 preview_ready，等待人的审阅动作。
    const revisions = revisionInputs.map((revision) => repository.getRevision(revision.revisionId));
    return withChainGraphPersist({
      ok: true,
      registered: true,
      idempotent: false,
      changeSetId,
      revision: requestedArtifactId
        ? revisions.find((revision) => revision.artifactId === requestedArtifactId) || null
        : revisions[0] || null,
      revisions,
    }, { repository, projectId, toolJobId, listProjectToolJobs: dependencies.listProjectToolJobs });
  } catch (error) {
    if (error instanceof ResultChangeSetError && error.code === 'chain_preview_cohort_conflict') {
      return { ok: false, registered: false, idempotent: false, reason: error.code };
    }
    return chainFailure(repository, projectId, changeSetId, error);
  }
}

module.exports = {
  CHAIN_PREVIEW_INTENT_REF_PREFIX,
  ensureChainRevisions,
};
