'use strict';

/**
 * RW-01-3D-ARTIFACT-REVISION — model3d 导出产物接入成果面真值的桥。
 *
 * 职责（docs/rw-01-3d-artifact-revision-plan.md §1.3）：
 * 1. stampModel3DJobResult：给 model3d 导出作业结果盖 executionProvenance（自证哈希，
 *    复用 shared-backend/execution-provenance 内核）+ artifactTruth——使导出作业成为
 *    内核 lineage 投影承认的「有效 Artifact Truth 作业」。
 * 2. registerModel3DExportRevision：manifest → createChangeSet（base=工作区 HEAD）
 *    + appendRevisionBatch（每个 3D 导出格式一条 revision，parametersHash=sceneHash 溯源）
 *    + validation.ok 时 adoptChangeSet（revision 转正为 current）。
 *
 * 真值边界：artifact_revisions 是导出产物 revision 唯一真值；SceneSpec 的 .history/
 * 文件级修订是场景编辑线源真相（对象不同，不双写）；本桥不建第二执行器、不建手动
 * lineage 登记 API（图一律由内核 buildAuthoritativeWorkflowGraph 从作业真值投影）。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const {
  createExecutionProvenance,
  attachProvenanceToResult,
} = require('./execution-provenance');
const { buildAuthoritativeWorkflowGraph } = require('./result-workflow-graph');

const MODEL3D_EXPORT_EXTENSIONS = new Set(['.glb', '.gltf', '.stl', '.obj']);
const BLENDER_SCENE_SCRIPT_RELATIVE_PATH = 'resources/model3d/blender_scene.py';

function randomId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function resolveWorkspaceHeadCommit(workspaceRoot) {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: workspaceRoot, encoding: 'utf8' });
  const commit = String(result.stdout || '').trim();
  return result.status === 0 && /^[a-f0-9]{40}$/.test(commit) ? commit : null;
}

/** 产物身份：3D 导出格式按扩展名（跨 outDir 稳定，family 随场景文件走）；渲染图按文件名。
 * 内核 uq_rs_revisions_family_current 对 family 全局唯一（无项目列）⇒ 身份必须带 projectId 前缀，
 * 否则跨项目同名场景路径在 current 位与 ordinal 位双双相撞。 */
function model3dArtifactIdentity(projectId, sceneRelativePath, outputRelativePath) {
  const ext = path.extname(outputRelativePath).toLowerCase();
  if (MODEL3D_EXPORT_EXTENSIONS.has(ext)) {
    return { id: `model3d:${projectId}:${sceneRelativePath}:${ext.slice(1)}`, isModel: true };
  }
  return { id: `model3d:${projectId}:${sceneRelativePath}:render:${path.basename(outputRelativePath)}`, isModel: false };
}

/**
 * 给 model3d 导出作业结果盖 executionProvenance + artifactTruth。
 * outputs = blender-provider 形状（{path: 工作区相对路径, sha256, bytes}）。
 */
function stampModel3DJobResult({ result, toolJobId, projectId, workspaceRoot, manifest, sceneRelativePath }) {
  if (!result || typeof result !== 'object') throw new Error('model3d_stamp_result_required');
  if (!toolJobId) throw new Error('model3d_stamp_tool_job_id_required');
  const outputs = Array.isArray(result.outputs) && result.outputs.length > 0
    ? result.outputs
    : (Array.isArray(manifest?.outputs) ? manifest.outputs : []);
  const sceneScriptPath = path.join(workspaceRoot, BLENDER_SCENE_SCRIPT_RELATIVE_PATH);
  const artifacts = outputs.map((output) => {
    const identity = model3dArtifactIdentity(projectId, sceneRelativePath, output.path);
    return {
      id: identity.id,
      filename: path.basename(output.path),
      type: path.extname(output.path).replace('.', '') || null,
      path: path.join(workspaceRoot, output.path),
    };
  });
  const outputRelativeByArtifactId = new Map(outputs.map((output) => (
    [model3dArtifactIdentity(projectId, sceneRelativePath, output.path).id, output.path]
  )));
  const provenance = createExecutionProvenance({
    toolJobId,
    projectId: projectId || null,
    plugin: { id: 'model3d_export', version: manifest?.recipeVersion ?? null, language: 'python' },
    params: { sceneRelativePath: sceneRelativePath || null },
    inputs: [],
    runtime: { name: manifest?.provider || 'blender', version: manifest?.providerVersion || null, ready: true },
    runScriptPath: fs.existsSync(sceneScriptPath) ? sceneScriptPath : null,
    command: null,
    artifacts,
    startedAt: null,
    completedAt: manifest?.generatedAt || new Date().toISOString(),
  });
  const validationOk = manifest?.validation?.ok === true;
  // attachProvenanceToResult 以 result.artifacts 为源重写 artifacts/outputs/files——
  // 先把带 id 的产物清单挂上再盖章（与脚本作业收尾同构）。
  const staged = {
    ...result,
    artifacts: artifacts.map((artifact) => ({
      id: artifact.id,
      filename: artifact.filename,
      type: artifact.type,
      path: outputRelativeByArtifactId.get(artifact.id) || null,
    })),
  };
  const stamped = attachProvenanceToResult(staged, provenance);
  stamped.artifactTruth = {
    status: validationOk ? 'valid' : 'blocked',
    blocking: !validationOk,
    validatorId: 'model3d-manifest/v1',
    manifestSchema: manifest?.schema || null,
  };
  return stamped;
}

/**
 * 把一次 model3d 导出登记为成果面真值。
 * 返回 { ok, idempotent?, changeSet, revisions, graph, provenance, stampedJob, adopted, error? }。
 */
function registerModel3DExportRevision({ repository, job, manifest, sceneRelativePath, workspaceRoot, outputs }) {
  if (!repository || !job?.id || !manifest || !sceneRelativePath || !workspaceRoot) {
    return { ok: false, error: { code: 'model3d_register_input_invalid' } };
  }
  const projectId = job.project_id || job.projectId || null;
  if (!projectId) return { ok: false, error: { code: 'model3d_register_project_required' } };
  const effectiveOutputs = Array.isArray(outputs) && outputs.length > 0
    ? outputs
    : (Array.isArray(manifest.outputs) ? manifest.outputs : []);
  const modelOutputs = effectiveOutputs.filter((output) => (
    MODEL3D_EXPORT_EXTENSIONS.has(path.extname(output.path).toLowerCase())
  ));
  if (modelOutputs.length === 0) {
    return { ok: false, error: { code: 'model3d_register_no_model_outputs' } };
  }

  // 幂等：同一作业（toolJobId）+ 同一产物（artifactId）已有 revision 即返回既有真值。
  const probed = repository.findRevisionByJobArtifact({
    projectId,
    toolJobId: job.id,
    artifactId: model3dArtifactIdentity(projectId, sceneRelativePath, modelOutputs[0].path).id,
  });
  if (probed) {
    const existing = modelOutputs
      .map((output) => model3dArtifactIdentity(projectId, sceneRelativePath, output.path).id)
      .map((artifactId) => repository.findRevisionByJobArtifact({ projectId, toolJobId: job.id, artifactId }))
      .filter(Boolean);
    return {
      ok: true,
      idempotent: true,
      revisions: existing,
      changeSet: existing[0] ? repository.getChangeSet(existing[0].changeSetId) : null,
      adopted: existing[0] ? repository.getChangeSet(existing[0].changeSetId)?.status === 'adopted' : false,
    };
  }

  const stampedResult = stampModel3DJobResult({
    result: { outputs: effectiveOutputs },
    toolJobId: job.id,
    projectId,
    workspaceRoot,
    manifest,
    sceneRelativePath,
  });
  const stampedJob = {
    ...job,
    tool_id: job.tool_id || 'model3d_export',
    status: 'completed',
    result: stampedResult,
  };
  const validationOk = manifest?.validation?.ok === true;
  const baseCommit = resolveWorkspaceHeadCommit(workspaceRoot);
  if (!baseCommit) {
    return { ok: false, error: { code: 'workspace_head_unavailable' } };
  }

  const changeSetId = randomId('cs_model3d');
  let changeSet;
  try {
    changeSet = repository.createChangeSet({
      changeSetId,
      projectId,
      conversationId: job.conversation_id || null,
      baseCommit,
      workingBranchRef: `refs/heads/model3d/${manifest.sceneHash ? String(manifest.sceneHash).slice(0, 12) : 'scene'}`,
      createdBy: 'agent',
      intentRef: 'model3d_export_registration',
    });
  } catch (error) {
    return { ok: false, error: { code: 'model3d_change_set_invalid', message: error.message } };
  }
  // 合法链 draft → running → preview_ready（appendRevisionBatch 携带 preview_ready 迁移）。
  repository.transitionChangeSet({ changeSetId, to: 'running', reason: 'model3d_export_registration' });

  const revisionInputs = modelOutputs.map((output) => {
    const identity = model3dArtifactIdentity(projectId, sceneRelativePath, output.path);
    const current = repository.getCurrentRevision(identity.id, projectId);
    const sceneScriptPath = path.join(workspaceRoot, BLENDER_SCENE_SCRIPT_RELATIVE_PATH);
    return {
      revisionId: randomId('rev_model3d'),
      projectId,
      artifactFamilyId: identity.id,
      artifactId: identity.id,
      parentRevisionIds: current ? [current.revisionId] : [],
      sourceCommit: baseCommit,
      sourceScriptRef: {
        relativePath: BLENDER_SCENE_SCRIPT_RELATIVE_PATH,
        sha256: fs.existsSync(sceneScriptPath) ? require('./execution-provenance').hashFile(sceneScriptPath) : null,
        entryPoint: path.basename(BLENDER_SCENE_SCRIPT_RELATIVE_PATH),
        artifactId: identity.id,
        rendererId: job.tool_id || 'model3d_export',
        language: 'python',
        origin: 'canonical_plugin',
      },
      inputArtifactRefs: [],
      parametersRef: sceneRelativePath,
      parametersHash: manifest.sceneHash || null,
      toolJobId: job.id,
      outputPath: output.path,
      outputHash: output.sha256 || null,
      validationStatus: validationOk ? 'valid' : 'blocked',
      reproducibilityStatus: 'available',
      changeSetId,
    };
  });

  let graph = null;
  if (validationOk) {
    const projection = buildAuthoritativeWorkflowGraph({
      projectId,
      sourceToolJobId: job.id,
      jobs: [stampedJob],
      repository,
      requiredToolJobIds: [job.id],
      stagedRevisions: revisionInputs,
    });
    if (!projection || projection.ok !== true || !projection.graph) {
      return {
        ok: false,
        error: { code: 'model3d_workflow_graph_invalid', diagnostics: projection?.diagnostics || [] },
      };
    }
    graph = projection.graph;
  }

  let batch;
  try {
    batch = repository.appendRevisionBatch({
      revisions: revisionInputs,
      workflowGraph: graph,
      transition: {
        changeSetId,
        to: 'preview_ready',
        // 内核 cohort 完整性不变量：revision.sourceCommit === changeSet.candidateCommit
        // （restore 前置校验 revision_restore_change_set_partial）。3D 导出以工作区 HEAD
        // 为候选锚（产物即事实，无独立候选提交）。
        candidateCommit: baseCommit,
        changedPaths: effectiveOutputs.map((output) => output.path),
        jobRefs: [job.id],
        candidateArtifactRefs: revisionInputs.map((revision) => revision.revisionId),
        validationSummary: {
          artifactTruthStatus: validationOk ? 'valid' : 'blocked',
          manifestSchema: manifest.schema || null,
          sceneHash: manifest.sceneHash || null,
          provider: manifest.provider || null,
          workflowGraph: graph
            ? { graphId: graph.graphId, sourceDigest: graph.sourceDigest }
            : null,
          // 历史恢复资格校验（restore_formal_artifact_count_mismatch）读这三个字段——
          // 与科学流 commitCandidateCohort 的 summary 形状一致。
          formalArtifactCount: revisionInputs.length,
          formalArtifactCohort: revisionInputs.map((revision) => ({
            toolJobId: revision.toolJobId,
            artifactId: revision.artifactId,
            outputHash: revision.outputHash,
          })),
          validatorIds: ['model3d-manifest/v1'],
        },
      },
    });
  } catch (error) {
    return { ok: false, error: { code: 'model3d_revision_batch_invalid', message: error.message } };
  }

  let adopted = false;
  if (validationOk) {
    repository.adoptChangeSet({ changeSetId });
    adopted = true;
  }

  return {
    ok: true,
    changeSet: repository.getChangeSet(changeSetId),
    revisions: batch.revisions,
    graph,
    provenance: stampedResult.executionProvenance,
    stampedJob,
    adopted,
  };
}

module.exports = {
  MODEL3D_EXPORT_EXTENSIONS,
  BLENDER_SCENE_SCRIPT_RELATIVE_PATH,
  model3dArtifactIdentity,
  resolveWorkspaceHeadCommit,
  stampModel3DJobResult,
  registerModel3DExportRevision,
};
