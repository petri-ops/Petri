/**
 * RW-01-3D-ARTIFACT-REVISION — model3d 产物接入成果面真值的桥契约（红绿先行）。
 *
 * 覆盖 docs/rw-01-3d-artifact-revision-plan.md §5 G1 的后端三件：
 * 1. stampModel3DJobResult：导出作业结果盖 executionProvenance（自证哈希）+ artifactTruth
 * 2. registerModel3DExportRevision：manifest → createChangeSet + appendRevisionBatch（含图）+ adopt
 * 3. 内核不变量：revision 落图（cohort 匹配）、幂等去重、blocked 产物不 adopt
 *
 * 全部使用临时目录真实 better-sqlite3 + 真实临时产物文件；不访问网络、不依赖 Blender 二进制。
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { execSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const { ensureResultStudioSchema } = require('../core/shared-backend/result-studio-schema');
const { ensureResultRefTransactionSchema } = require('../core/shared-backend/result-ref-transaction-schema');
const { ensureResultWorkflowGraphSchema } = require('../core/shared-backend/result-workflow-graph');
const { createResultStudioRepository } = require('../core/shared-backend/result-studio-repository');
const { verifyExecutionProvenance } = require('../core/shared-backend/execution-provenance');
const { buildAuthoritativeWorkflowGraph } = require('../core/shared-backend/result-workflow-graph');
const {
  stampModel3DJobResult,
  registerModel3DExportRevision,
} = require('../core/shared-backend/model3d-revision-bridge');

function sha256Of(text) {
  // 确定性假 sha：内容真实存在即可，不必是真实加密哈希（hashFile 会重算）。
  return require('node:crypto').createHash('sha256').update(text).digest('hex');
}

function makeRepo(context) {
  const root = mkdtempSync(join(tmpdir(), 'petri-rw01-'));
  const db = new Database(join(root, 'test.db'));
  context.after(() => { try { db.close(); } catch { /* already closed */ } rmSync(root, { recursive: true, force: true }); });
  ensureResultStudioSchema(db);
  ensureResultWorkflowGraphSchema(db);
  ensureResultRefTransactionSchema(db);
  // change-set 的 baseCommit 锚定工作区 HEAD：夹具工作区必须是真 git 仓库。
  execSync('git init -q && git config user.email t@petri.local && git config user.name t && git commit -qm init --allow-empty', { cwd: root, stdio: 'ignore' });
  const repo = createResultStudioRepository(db, { ensureSchema: false });
  return { db, repo, root };
}

/** 在临时工作区落真实导出产物文件（GLB/STL/OBJ），返回 blender-provider 形状的 outputs。 */
function makeOutputs(workspaceRoot, sceneSlug) {
  const outDir = join(workspaceRoot, 'model3d', 'runs', `${sceneSlug}-r1`);
  mkdirSync(outDir, { recursive: true });
  for (const ext of ['glb', 'stl', 'obj']) {
    writeFileSync(join(outDir, `${sceneSlug}.${ext}`), `${sceneSlug}:${ext}:bytes`);
  }
  const outputs = ['glb', 'stl', 'obj'].map((ext) => ({
    path: `model3d/runs/${sceneSlug}-r1/${sceneSlug}.${ext}`,
    sha256: sha256Of(`${sceneSlug}:${ext}:bytes`),
    bytes: `${sceneSlug}:${ext}:bytes`.length,
  }));
  return { outputs, outDirRelative: `model3d/runs/${sceneSlug}-r1` };
}

function makeManifest(sceneHash, outputs, overrides = {}) {
  return {
    schema: 'model3d-manifest/v1',
    generatedAt: '2026-10-30T00:00:00.000Z',
    sceneHash,
    taskSpecId: null,
    workflowRunId: null,
    recipeId: 'box-enclosure',
    recipeVersion: 1,
    provider: 'blender',
    providerVersion: '4.5.0',
    inputHashes: {},
    validation: { ok: true, watertight: true, nonManifoldEdges: 0 },
    outputs,
    ...overrides,
  };
}

/** 已完成并盖章的作业行（tools-executor 收尾后的形状）。 */
function stampedJobRow(jobId, projectId, stampedResult) {
  return {
    id: jobId,
    tool_id: 'model3d_export',
    project_id: projectId,
    user_id: 'agent',
    status: 'completed',
    params: {},
    result: stampedResult,
  };
}

const SCENE_REL = 'model3d/recipes/box-enclosure.scene3d.json';

test('RW01 stamp：导出结果盖自证 provenance + artifactTruth，verifyExecutionProvenance 通过', (context) => {
  const { root } = makeRepo(context);
  const { outputs } = makeOutputs(root, 'enclosure');
  const baseResult = { ok: true, outDir: 'model3d/runs/enclosure-r1', outputs };

  const stamped = stampModel3DJobResult({
    result: baseResult,
    toolJobId: 'job_rw01stamp00001',
    projectId: 'project_rw01',
    workspaceRoot: root,
    manifest: makeManifest(sha256Of('scene'), outputs),
    sceneRelativePath: SCENE_REL,
  });

  assert.equal(stamped.executionProvenance.executionProvenanceVersion, 1);
  assert.equal(stamped.executionProvenance.toolJobId, 'job_rw01stamp00001');
  assert.equal(stamped.executionProvenance.projectId, 'project_rw01');
  assert.ok(verifyExecutionProvenance(stamped.executionProvenance).ok, 'provenance 哈希必须自洽');
  // artifacts：三个导出物都带 id 与真实 sha256（内核 validCompletedJob 的硬要求）
  assert.equal(stamped.executionProvenance.artifacts.length, 3);
  for (const artifact of stamped.executionProvenance.artifacts) {
    assert.match(artifact.id, /^model3d:/);
    assert.match(artifact.sha256, /^[a-f0-9]{64}$/);
  }
  assert.equal(stamped.artifactTruth?.status, 'valid');
  assert.equal(stamped.artifactTruth?.blocking, false);
  // 原有字段保留（不吞工具结果）；outputs/files 经内核 attachProvenanceToResult 重写为带溯源注解的产物清单
  assert.equal(stamped.ok, true);
  assert.equal(stamped.outputs.length, 3);
  for (const annotated of stamped.outputs) {
    assert.match(annotated.id, /^model3d:/);
    assert.equal(annotated.provenance?.toolJobId, 'job_rw01stamp00001');
  }
});

test('RW01 register：manifest → change-set(adopted) + 每 format 一条 revision + 图落库，revision 为 current', (context) => {
  const { repo, root } = makeRepo(context);
  const sceneHash = sha256Of('scene-a');
  const { outputs } = makeOutputs(root, 'enclosure');
  const manifest = makeManifest(sceneHash, outputs);
  const jobId = 'job_rw01reg000001';
  const projectId = 'project_rw01';

  const outcome = registerModel3DExportRevision({
    repository: repo,
    job: { id: jobId, tool_id: 'model3d_export', project_id: projectId, user_id: 'agent', params: {} },
    manifest,
    sceneRelativePath: SCENE_REL,
    workspaceRoot: root,
    outputs,
  });

  assert.equal(outcome.ok, true, JSON.stringify(outcome.error || null));
  // change-set 已采纳
  assert.equal(outcome.changeSet.status, 'adopted');
  assert.equal(outcome.changeSet.projectId, projectId);
  // glb/stl/obj 各一条 revision（一 family 一产物），字段来自 manifest
  assert.equal(outcome.revisions.length, 3);
  const glb = outcome.revisions.find((r) => r.artifactId.endsWith(':glb'));
  assert.ok(glb, '必须有 glb revision');
  assert.equal(glb.toolJobId, jobId);
  assert.equal(glb.outputPath, `model3d/runs/enclosure-r1/enclosure.glb`);
  assert.equal(glb.outputHash, outputs[0].sha256);
  assert.equal(glb.validationStatus, 'valid');
  assert.equal(glb.reproducibilityStatus, 'available');
  assert.equal(glb.parametersHash, sceneHash, 'parametersHash 必须携带 sceneHash 溯源');
  assert.equal(glb.parametersRef, SCENE_REL);
  assert.ok(glb.sourceScriptRef && glb.sourceScriptRef.relativePath === 'resources/model3d/blender_scene.py');
  // revision 已 current（adopt 语义）
  const current = repo.getCurrentRevision(glb.artifactFamilyId, projectId);
  assert.equal(current.revisionId, glb.revisionId);
  assert.equal(current.isCurrent, true);
  // 图已落库：节点含本作业且 artifactIds 覆盖 revision
  const graph = repo.findWorkflowGraph({ projectId, sourceDigest: outcome.graph.sourceDigest });
  assert.ok(graph, 'workflow graph 必须持久化');
  const node = graph.nodes.find((n) => n.toolJobId === jobId);
  assert.ok(node, '图必须含导出作业节点');
  for (const revision of outcome.revisions) {
    assert.ok(node.artifactIds.includes(revision.artifactId), `节点 artifactIds 必须含 ${revision.artifactId}`);
  }
});

test('RW01 dedupe：同作业重复登记返回既有 revision，不产生第二份真值', (context) => {
  const { repo, root } = makeRepo(context);
  const { outputs } = makeOutputs(root, 'enclosure');
  const manifest = makeManifest(sha256Of('scene-b'), outputs);
  const input = {
    repository: repo,
    job: { id: 'job_rw01dup000001', tool_id: 'model3d_export', project_id: 'project_rw01', user_id: 'agent', params: {} },
    manifest,
    sceneRelativePath: SCENE_REL,
    workspaceRoot: root,
    outputs,
  };
  const first = registerModel3DExportRevision(input);
  assert.equal(first.ok, true);
  const second = registerModel3DExportRevision(input);
  assert.equal(second.ok, true);
  assert.equal(second.idempotent, true);
  assert.deepEqual(second.revisions.map((r) => r.revisionId), first.revisions.map((r) => r.revisionId));
  // 每条 family 的 revision 总数不变
  for (const revision of first.revisions) {
    const listed = repo.listRevisions({ artifactFamilyId: revision.artifactFamilyId, projectId: revision.projectId });
    assert.equal(listed.length, 1);
  }
});

test('RW01 blocked：manifest.validation.ok=false 时如实登记 blocked 且不 adopt', (context) => {
  const { repo, root } = makeRepo(context);
  const { outputs } = makeOutputs(root, 'leaky');
  const manifest = makeManifest(sha256Of('scene-c'), outputs, {
    validation: { ok: false, watertight: false, nonManifoldEdges: 4 },
  });
  const outcome = registerModel3DExportRevision({
    repository: repo,
    job: { id: 'job_rw01blk000001', tool_id: 'model3d_export', project_id: 'project_rw01', user_id: 'agent', params: {} },
    manifest,
    sceneRelativePath: SCENE_REL,
    workspaceRoot: root,
    outputs,
  });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.changeSet.status, 'preview_ready');
  for (const revision of outcome.revisions) {
    assert.equal(revision.validationStatus, 'blocked');
    const current = repo.getCurrentRevision(revision.artifactFamilyId, revision.projectId);
    assert.equal(current, null, 'blocked 产物不得成为 current');
  }
});

test('RW01 lineage：盖章作业 + staged revisions 可被内核投影为含 3D 产物的权威图', (context) => {
  const { repo, root } = makeRepo(context);
  const { outputs } = makeOutputs(root, 'lineage');
  const manifest = makeManifest(sha256Of('scene-d'), outputs);
  const jobId = 'job_rw01lin000001';
  const projectId = 'project_rw01';
  const outcome = registerModel3DExportRevision({
    repository: repo,
    job: { id: jobId, tool_id: 'model3d_export', project_id: projectId, user_id: 'agent', params: {} },
    manifest,
    sceneRelativePath: SCENE_REL,
    workspaceRoot: root,
    outputs,
  });
  assert.equal(outcome.ok, true);

  // 内核独立复投影（与桥内部同输入）：作业真值 = 盖章后的 result
  const projection = buildAuthoritativeWorkflowGraph({
    projectId,
    sourceToolJobId: jobId,
    jobs: [outcome.stampedJob],
    repository: repo,
    requiredToolJobIds: [jobId],
    stagedRevisions: [],
  });
  assert.equal(projection.ok, true, JSON.stringify(projection.diagnostics || null));
  const node = projection.graph.nodes.find((n) => n.toolJobId === jobId);
  assert.ok(node, '3D 导出作业必须投影为图节点');
  assert.equal(node.artifactIds.length, 3);
  // 提交后的 revision 可被血缘解析（revision 真值在库）
  const found = repo.findRevisionByJobArtifact({ projectId, toolJobId: jobId, artifactId: outcome.revisions[0].artifactId });
  assert.ok(found, 'findRevisionByJobArtifact 必须能解析 3D revision');
  assert.equal(found.outputHash, outcome.revisions[0].outputHash);
});
