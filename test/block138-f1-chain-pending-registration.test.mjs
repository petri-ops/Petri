// BLOCK-138 §9 方向 1（F1）契约测试 —— 链形成点注册 pending 信任层（HK-01 红绿先行·红侧）
//
// 被测契约（docs/block-138-artifact-plane-kernel-plan.md §9）：
//   plan/bind 与 selection 两条链形成点接入信任层注册——job 产物经
//   result-changeset-service 既有管线注册为 **pending ChangeSet + preview revisions**
//   （幂等；**绝不自动 adopt**，adopt 仍是人的审阅动作）；使下游 step 解锁、血缘边可形成。
//
// 语义依据（仓内已验证事实，本文件按其构造，不重复勘探）：
//   - insertRevision 强制 changeSetId 且写入 is_current=0
//     （core/shared-backend/result-studio-repository.js:139-183）
//   - validateLineage 仅要求 input.lineage.sourceRevisionId 经 repository.getRevision
//     解析到已持久化 Revision 行（core/shared-backend/result-workflow-graph.js:286-362）——
//     行存在即可 = pending 未 adopt 即可解锁血缘
//   - plan/bind 链形成点 = tool_run_tool op=bind_artifact
//     （core/petri-server/agent-tools/learning.js:769-813）
//   - selection 链形成点 = 裸 job artifact 的 context 解析
//     （core/petri-server/agent-tools/result-context-tools.js:150-179，无 Revision 即
//     context_artifact_not_open——AUDIT-LOG 🟡 2026-10-02 blocker B1 / attempt-3 实据）
//   - selection→enrichment 下游 lineage 形状 = tool_result_selection_run 所发
//     resultStudioInputLineage（core/petri-server/agent-tools/result-selection-tools.js:590-602，
//     kind:'selection'）
//
// 覆盖：
//   ① plan/bind 链：建 plan → 跑首步（job 带产物）→ bind 下游 → 下游 step ready
//      → 跑下游 → saveWorkflowGraph 后 graph 2 节点 1 边
//   ② 注册产物为 pending ChangeSet + preview revisions：断言未被 adopt、
//      is_current 语义不被本路径触碰
//   ③ 幂等：同 job 重复注册不翻倍
//   ④ selection→enrichment 场景的 lineage 可解析（pending revision 上锚定 selection）
//   ⑤ 补刃·plan 链 run 路径下游输入 lineage：op='run' 执行 plan 步骤时从 plan.lineage
//      解析 F1 注册 revision → 哈希校验上游物化字节 → 组 inputLineage 经既有
//      resultStudioInputLineage 选项传入执行器 → 下游 job manifest 输入带 lineage
//      且 buildAuthoritativeWorkflowGraph 出 ≥1 边
//   ⑥ 补刃·图落库：ensureChainRevisions 注册成功后以该 job 为 source 构建权威图并
//      saveWorkflowGraph 落库（persistWorkflowGraph 按 project+source_digest 幂等、
//      不覆写历史）——项目 graph 行存在且节点数随链增长（bind 1 节点 → 下游跑完 2 节点 1 边）
//
// 红绿协议：F1 未实现时本文件必须全红（红证据见 acceptance/block-138/）；
// F1 实现后须全绿。不测 adopt 语义/审阅流（§9 非范围）；
// 不做启发式无验证边（方向 2 已被用户拒绝）。
//
// 运行：node --test test/block138-f1-chain-pending-registration.test.mjs

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, relative } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { installWorkflowPackFixture } from './helpers/workflow-pack-fixture.mjs';

const require = createRequire(import.meta.url);
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workflowPack = installWorkflowPackFixture();

// ---------------------------------------------------------------------------
// 统一临时 DB 自举（BLOCK-49 惯例：PETRI_DB_PATH 须在 require db.js 前生效；
// 与 test/agent-workflow-phase6.test.mjs / test/result-selection-tools.test.mjs 同一修法）
// ---------------------------------------------------------------------------
const tempDbRoot = mkdtempSync(join(tmpdir(), 'petri-f1-chain-db-'));
const tempDbPath = join(tempDbRoot, 'petri.db');
const { runMigrations } = require(join(REPO_ROOT, 'src', 'migration-runner'));
await runMigrations(tempDbPath, join(REPO_ROOT, 'src', 'migrations'));
process.env.PETRI_DB_PATH = tempDbPath;
process.on('exit', () => {
  workflowPack.cleanup();
  try { rmSync(tempDbRoot, { recursive: true, force: true }); } catch { /* 尽力清理 */ }
});

const db = require(join(REPO_ROOT, 'core', 'petri-server', 'db.js'));
const learning = require(join(REPO_ROOT, 'core', 'petri-server', 'agent-tools', 'learning.js'));
const {
  resolveResultStudioContext,
} = require(join(REPO_ROOT, 'core', 'petri-server', 'agent-tools', 'result-context-tools.js'));
const pluginLoader = require(join(REPO_ROOT, 'core', 'petri-server', 'plugin-loader.js'));
const { createResultStudioRepository } = require(join(REPO_ROOT, 'core', 'shared-backend', 'result-studio-repository'));
const { buildAuthoritativeWorkflowGraph } = require(join(REPO_ROOT, 'core', 'shared-backend', 'result-workflow-graph'));
const { bindProjectRepository } = require(join(REPO_ROOT, 'core', 'shared-backend', 'git-repository-binding'));
const { computeExecutionProvenanceHash } = require(join(REPO_ROOT, 'core', 'shared-backend', 'execution-provenance'));
const { validateSelectionContext } = require(join(REPO_ROOT, 'core', 'shared-backend', 'result-studio-contracts'));
const pluginSdk = require(join(REPO_ROOT, 'core', 'shared-backend', 'result-studio-plugin-sdk'));

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

// ---------------------------------------------------------------------------
// 中性测试插件（runtime 生成，不落仓库 fixture）：带可过
// validateResultStudioDescriptor 的 resultStudio descriptor（含 golden fixture 实算
// digest，算法同 test/fixtures/neutral-plugins/regen-golden.cjs），供注册管线的
// descriptor 路径与单产物路径都可用。
// ---------------------------------------------------------------------------
function writeChainPlugin(pluginsDir, spec) {
  const pluginDir = join(pluginsDir, spec.id);
  mkdirSync(join(pluginDir, 'scripts'), { recursive: true });
  mkdirSync(join(pluginDir, 'golden-revisions'), { recursive: true });
  const plugin = {
    id: spec.id,
    pluginManifestVersion: 1,
    title: spec.title,
    version: '1.0.0',
    language: 'r',
    description: `BLOCK-138 F1 契约测试中性插件：${spec.title}`,
    runtime: { r: '>=4.1.0' },
    platform: ['macos-arm64', 'linux-x64', 'windows-x64'],
    supportedPlatforms: ['macos-arm64', 'linux-x64', 'windows-x64'],
    packages: { r: {} },
    inputs: spec.inputs,
    outputs: spec.outputs,
    artifacts: spec.outputs.map((output) => ({ ...output, label: output.label || output.id })),
    sourcePolicy: 'builtin-canonical',
  };
  const resultStudio = {
    contractVersion: 1,
    descriptorVersion: 1,
    semanticType: spec.semanticType,
    entity: spec.entity,
    source: { strategy: 'execution_snapshot_per_artifact', entryPoint: `scripts/${spec.id}.R` },
    independentScriptPathTemplate: 'analysis/scripts/{artifactFamilyId}/{revisionId}/{artifactId}.R',
    inputBindings: spec.inputBindings,
    parameters: {},
    parameterImpacts: {},
    actions: spec.actions,
    artifacts: spec.outputs.map((output) => ({
      id: output.id,
      type: output.type,
      filename: output.filename,
      interaction: 'interactive',
    })),
    interactionMappings: spec.interactionMappings,
    validator: {
      id: `${spec.id}_truth_v1`,
      checks: ['artifact_truth_valid', 'output_sha256'],
    },
    goldenFixture: { path: 'golden-revisions/result-studio-v1.json' },
    upgradePolicy: {
      sameMajor: 'compatible_if_contract_digests_match',
      contractDrift: 'migration_required',
      missingMigration: 'read_only_legacy',
    },
  };
  const scriptContent = `# ${spec.title} — test stub\nprint("${spec.id}")\n`;
  writeFileSync(join(pluginDir, 'plugin.json'), `${JSON.stringify(plugin, null, 2)}\n`);
  writeFileSync(join(pluginDir, 'tool-definition.json'), `${JSON.stringify({ id: spec.id, language: 'r', title: spec.title, inputs: spec.inputs, outputs: spec.outputs, resultStudio }, null, 2)}\n`);
  writeFileSync(join(pluginDir, `scripts`, `${spec.id}.R`), scriptContent);
  // golden fixture digest 用核心 SDK 实算（regen-golden.cjs 同款）
  const raw = pluginSdk.normalizeResultStudioDescriptor(resultStudio);
  const golden = {
    schemaVersion: 1,
    pluginId: spec.id,
    pluginVersion: plugin.version,
    descriptorVersion: raw.descriptorVersion,
    sourceScriptSha256: pluginSdk.digest(readFileSync(join(pluginDir, raw.source.entryPoint))),
    inputBindingDigest: pluginSdk.digest(raw.inputBindings),
    artifactContractDigest: pluginSdk.digest(raw.artifacts),
    revisionSourceStrategy: raw.source.strategy,
    independentScriptPathTemplate: raw.independentScriptPathTemplate,
    expectedArtifactIds: raw.artifacts.map((artifact) => artifact.id),
  };
  writeFileSync(join(pluginDir, 'golden-revisions', 'result-studio-v1.json'), `${JSON.stringify(golden, null, 2)}\n`);
  return {
    id: spec.id,
    version: plugin.version,
    language: 'r',
    pluginDir,
    scriptPath: join(pluginDir, 'scripts'),
  };
}

const F1_PLUGINS_DIR = mkdtempSync(join(tmpdir(), 'petri-f1-chain-plugins-'));
process.on('exit', () => {
  try { rmSync(F1_PLUGINS_DIR, { recursive: true, force: true }); } catch { /* 尽力清理 */ }
});
globalThis._petriPlugins = new Map();
for (const plugin of [
  writeChainPlugin(F1_PLUGINS_DIR, {
    id: 'chain-metrics',
    title: '链首差异指标（中性）',
    semanticType: 'chain_deg_metrics',
    entity: { type: 'gene_row', idField: 'gene', fields: { gene: 'string', log2FoldChange: 'number', padj: 'number' } },
    inputs: [{ id: 'counts', label: 'counts 表', type: 'file', required: true, accept: '.csv' }],
    outputs: [{ id: 'deg_table', filename: 'deg_table.csv', type: 'table', label: 'DEG 表' }],
    inputBindings: [{ inputId: 'counts', required: true, acceptsArtifactTypes: ['table'], semanticRole: 'input_measurements' }],
    actions: ['select_genes', 'derive_enrichment_input', 'recompute'],
    interactionMappings: [{ artifactId: 'deg_table', mode: 'table', entityType: 'gene', idField: 'gene' }],
  }),
  writeChainPlugin(F1_PLUGINS_DIR, {
    id: 'chain-enrich',
    title: '链下游富集（中性）',
    semanticType: 'chain_enrichment',
    entity: { type: 'pathway_row', idField: 'ID', fields: { ID: 'string', pvalue: 'number' } },
    inputs: [{ id: 'deg_table', label: 'DEG 表', type: 'file', required: true, accept: '.csv' }],
    outputs: [{ id: 'enrichment_table', filename: 'enrichment_table.csv', type: 'table', label: '富集表' }],
    inputBindings: [{ inputId: 'deg_table', required: true, acceptsArtifactTypes: ['table'], semanticRole: 'input_measurements' }],
    actions: ['recompute'],
    interactionMappings: [{ artifactId: 'enrichment_table', mode: 'table', entityType: 'pathway', idField: 'ID' }],
  }),
  // bulk-rna-core 模板 deg-standardization 步的 toolCandidates——plan 链 run 路径
  // 需要 plan 把该步投影到已注册工具（learning.js:859 toolId = step.toolId）。
  writeChainPlugin(F1_PLUGINS_DIR, {
    id: 'deg-standardizer',
    title: '链下游标准化（中性）',
    semanticType: 'chain_deg_standardized',
    entity: { type: 'gene_row', idField: 'gene', fields: { gene: 'string', log2FoldChange: 'number', padj: 'number' } },
    inputs: [{ id: 'deg_results', label: 'DEG 结果', type: 'file', required: true, accept: '.csv' }],
    outputs: [{ id: 'deg_standardized', filename: 'deg_standardized.csv', type: 'table', label: '标准化 DEG 表' }],
    inputBindings: [{ inputId: 'deg_results', required: true, acceptsArtifactTypes: ['table'], semanticRole: 'input_measurements' }],
    actions: ['recompute'],
    interactionMappings: [{ artifactId: 'deg_standardized', mode: 'table', entityType: 'gene', idField: 'gene' }],
  }),
]) {
  globalThis._petriPlugins.set(plugin.id, plugin);
}

// 夹具自检：三个中性插件的 resultStudio descriptor 必须真实可解析
// （否则 F1 descriptor 路径无法工作，属测试夹具缺陷而非被测契约）。
for (const pluginId of ['chain-metrics', 'chain-enrich', 'deg-standardizer']) {
  const manifest = pluginLoader.getPluginManifest(pluginId);
  assert.ok(manifest, `夹具自检：插件 ${pluginId} manifest 应可解析`);
  assert.equal(
    manifest.resultStudioValidation?.valid,
    true,
    `夹具自检：插件 ${pluginId} resultStudio descriptor 应通过 SDK 校验：${JSON.stringify(manifest.resultStudioValidation?.errors || [])}`,
  );
  assert.ok(manifest.resultStudio, `夹具自检：插件 ${pluginId} 应投影出 resultStudio descriptor`);
}

// ---------------------------------------------------------------------------
// Job 夹具：真实文件 + 签名 executionProvenance（与生产 run_plugin_script 产物同构，
// 构造方式与 test/result-changeset-service.test.mjs 的 signedExecutionProvenance 一致）
// ---------------------------------------------------------------------------
function fabricateChainJob(fx, { toolId, name, outputs, inputs = [], params = {} }) {
  const job = db.createToolJob({
    toolId,
    userId: fx.userId,
    projectId: fx.projectId,
    conversationId: fx.conversationId,
    params,
    status: 'running',
    name,
  });
  assert.ok(job?.id, '夹具：tool_job 应能落库');
  const jobRoot = join(fx.workspaceRoot, 'results', 'jobs', job.id);
  mkdirSync(join(jobRoot, 'snapshot'), { recursive: true });

  const scriptAbs = join(jobRoot, 'snapshot', `${toolId}.R`);
  const scriptContent = `# ${name}\nprint("${toolId}")\n`;
  writeFileSync(scriptAbs, scriptContent);

  const normalizedParams = {};
  const inputSnapshots = inputs.map((input) => {
    const inputDir = join(jobRoot, 'input', input.id);
    mkdirSync(inputDir, { recursive: true });
    const inputAbs = join(inputDir, input.filename);
    writeFileSync(inputAbs, input.bytes);
    normalizedParams[input.id] = { inputRef: relative(fx.workspaceRoot, inputAbs), sha256: sha256(input.bytes) };
    return {
      id: input.id,
      role: input.role || 'table',
      relativePath: relative(fx.workspaceRoot, inputAbs),
      sha256: sha256(input.bytes),
      sizeBytes: Buffer.byteLength(input.bytes),
      sourceArtifactRef: input.sourceArtifactRef || null,
      lineage: input.lineage && typeof input.lineage === 'object' ? { ...input.lineage } : null,
    };
  });

  const artifactRecords = [];
  const provenanceArtifacts = [];
  for (const output of outputs) {
    const outputDir = join(jobRoot, 'output');
    mkdirSync(outputDir, { recursive: true });
    const outputAbs = join(outputDir, output.filename);
    writeFileSync(outputAbs, output.bytes);
    const outputHash = sha256(output.bytes);
    artifactRecords.push({
      id: output.id,
      name: output.filename,
      path: outputAbs,
      type: output.type,
      sha256: outputHash,
    });
    provenanceArtifacts.push({ id: output.id, filename: output.filename, type: output.type, sha256: outputHash });
  }

  const provenance = {
    executionProvenanceVersion: 1,
    toolJobId: job.id,
    projectId: fx.projectId,
    plugin: { id: toolId, version: '1.0.0', language: 'r', manifestFingerprint: null, packageConstraints: {} },
    runtime: { name: 'r', command: null, version: '4.1.0', versionSource: 'runtime_probe', readiness: true },
    params: { normalized: normalizedParams, sha256: sha256(JSON.stringify(normalizedParams)) },
    inputs: inputSnapshots,
    script: { snapshotPath: scriptAbs, sha256: sha256(scriptContent), entryPoint: `${toolId}.R` },
    command: null,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    artifacts: provenanceArtifacts,
  };
  provenance.provenanceHash = computeExecutionProvenanceHash(provenance);

  db.updateToolJob(job.id, {
    status: 'completed',
    resultJson: {
      artifactTruth: { status: 'valid', blocking: false, validCount: outputs.length },
      artifacts: artifactRecords,
      executionProvenance: provenance,
    },
    completedAt: Date.now(),
  });
  return db.getToolJob(job.id);
}

// ---------------------------------------------------------------------------
// 场景夹具：临时工作区（managed git）+ 真实 project 行 + 真实 repository + 首步 job
// ---------------------------------------------------------------------------
const F1_USER = 'f1-chain-user';

function f1Fixture(context) {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'petri-f1-chain-ws-'));
  context.after(() => {
    try { rmSync(workspaceRoot, { recursive: true, force: true }); } catch { /* 尽力清理 */ }
  });
  const project = db.createProject({
    name: `F1 链形成点契约 ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    workspacePath: workspaceRoot,
  });
  db.setProjectUserId(project.id, F1_USER);
  // 预建 managed git 仓（与 test/result-changeset-service.test.mjs fixture 同款），
  // 注册管线的 commitVirtualFiles/resolveBaseCommit 因此可用。
  const binding = bindProjectRepository({ workspaceRoot, projectId: project.id });
  assert.equal(binding.status, 'ready', '夹具：managed git 绑定应成功');
  const repository = createResultStudioRepository(db.getDatabase());
  const conversationId = `conv_f1_${Math.random().toString(36).slice(2, 8)}`;
  const fx = {
    workspaceRoot,
    projectId: project.id,
    userId: F1_USER,
    conversationId,
    repository,
    adapter: binding.adapter,
    ctx: { userId: F1_USER, projectId: project.id, conversationId },
  };
  // 首步 job：deseq2 位（真实产物文件 + valid Artifact Truth + 签名 provenance）
  fx.upstreamJob = fabricateChainJob(fx, {
    toolId: 'chain-metrics',
    name: '链首差异分析',
    params: { counts: 'inputs/counts.csv' },
    outputs: [{
      id: 'deg_table',
      filename: 'deg_table.csv',
      type: 'table',
      bytes: 'gene,log2FoldChange,padj\nTP53,2,0.01\nEGFR,1.5,0.02\nMYC,-2,0.03\nKRAS,0.2,0.9\n',
    }],
  });
  fx.currentRevisionsBefore = repository.listCurrentRevisions(fx.projectId);
  return fx;
}

async function f1PlanAndBind(fx) {
  const planned = await learning.tool_run_tool({ op: 'plan', templateId: 'bulk-rna-core' }, fx.ctx);
  assert.equal(planned.ok, true, `op=plan 应成功（夹具前置）：${JSON.stringify(planned).slice(0, 300)}`);
  const bound = await learning.tool_run_tool({
    op: 'bind_artifact',
    workflowPlan: planned.plan,
    fromToolJobId: fx.upstreamJob.id,
    fromStepId: 'differential',
    toStepId: 'deg-standardization',
    inputId: 'deg_results',
    artifactId: 'deg_table',
  }, fx.ctx);
  assert.equal(bound.ok, true, `bind_artifact 应成功（链形成点动作，attempt-2 已验的既有行为）：${JSON.stringify(bound).slice(0, 300)}`);
  return { planned, bound };
}

function assertPendingPreviewRegistration(fx, revision, label) {
  // F1 契约②：注册产物 = pending ChangeSet + preview revisions，绝不自动 adopt。
  assert.ok(revision, `${label}：链形成点应注册 ArtifactRevision（F1 未实现时此处红）`);
  const changeSet = fx.repository.getChangeSet(revision.changeSetId);
  assert.ok(changeSet, `${label}：Revision 必须落在既有 changeset 管线的 ChangeSet 内`);
  assert.equal(changeSet.projectId, fx.projectId, `${label}：ChangeSet 应属于当前项目`);
  assert.equal(changeSet.status, 'preview_ready', `${label}：注册必须是 pending preview（审阅队列可见），不得直接进入任何终态`);
  assert.equal(changeSet.adoptedAt, null, `${label}：绝不自动 adopt——adoptedAt 必须为空`);
  assert.ok(
    fx.repository.listChangeSets({ projectId: fx.projectId, status: 'preview_ready' })
      .some((item) => item.changeSetId === changeSet.changeSetId),
    `${label}：pending ChangeSet 应出现在项目审阅队列（listChangeSets status=preview_ready）`,
  );
  const cohort = fx.repository.listRevisionsByChangeSet(changeSet.changeSetId);
  assert.ok(cohort.some((item) => item.revisionId === revision.revisionId), `${label}：注册 Revision 应在其 ChangeSet cohort 内`);
  for (const item of cohort) {
    assert.equal(item.isCurrent, false, `${label}：preview revision is_current 必须为 0（is_current 只能由 adopt 翻转）`);
    assert.notEqual(item.validationStatus, 'blocked', `${label}：valid Artifact Truth 注册不应落 blocked`);
  }
  assert.deepEqual(
    fx.repository.listCurrentRevisions(fx.projectId),
    fx.currentRevisionsBefore,
    `${label}：is_current 语义不被本路径触碰——项目 current Revision 集合必须与注册前逐字节一致`,
  );
  assert.equal(
    fx.repository.getCurrentRevision(revision.artifactFamilyId, fx.projectId) || null,
    null,
    `${label}：注册 family 不得出现 current Revision（未 adopt）`,
  );
  return changeSet;
}

// ---------------------------------------------------------------------------
// ① plan/bind 链：建 plan → 跑首步 → bind 下游（注册）→ 下游 ready → 跑下游
//    → saveWorkflowGraph 后 graph 2 节点 1 边
// ---------------------------------------------------------------------------
test('F1 契约① plan/bind 链：bind 链形成点注册 pending revision 后，下游可跑且 saveWorkflowGraph 产生 2 节点 1 边', async (context) => {
  const fx = f1Fixture(context);
  const { bound } = await f1PlanAndBind(fx);

  // F1 契约：链形成点（bind）已把首步产物注册进信任层
  const revision = fx.repository.findRevisionByJobArtifact({
    projectId: fx.projectId,
    toolJobId: fx.upstreamJob.id,
    artifactId: 'deg_table',
  });
  assert.ok(revision, 'F1 契约①：bind 下游时首步 job 产物（deg_table）必须已注册为 ArtifactRevision（当前代码缺注册 → 红）');
  const changeSet = assertPendingPreviewRegistration(fx, revision, '契约①');

  // 既有行为（attempt-2 已验）：bind 后下游 step 在 plan 投影中 ready
  const status = await learning.tool_run_tool({ op: 'status', workflowPlan: bound.plan }, fx.ctx);
  assert.equal(status.ok, true, 'op=status 应成功（既有行为）');
  const downstreamStep = status.plan.steps.find((step) => step.id === 'deg-standardization');
  assert.equal(downstreamStep.status, 'ready', '下游 step 应 ready（既有 plan 层行为）');
  assert.ok(status.readyStepIds.includes('deg-standardization'), '下游 step 应在 readyStepIds');

  // 跑下游：下游 job 携带指向 pending revision 的服务端 lineage（生产 lineage 合同）
  const upstreamArtifact = fx.upstreamJob.result.artifacts.find((artifact) => artifact.id === 'deg_table');
  const upstreamHash = upstreamArtifact.sha256;
  const downstreamJob = fabricateChainJob(fx, {
    toolId: 'chain-enrich',
    name: '链下游标准化',
    params: {},
    inputs: [{
      id: 'deg_results',
      filename: 'deg_table.csv',
      bytes: readFileSync(upstreamArtifact.path),
      lineage: {
        lineageVersion: 1,
        kind: 'artifact',
        sourceRevisionId: revision.revisionId,
        sourceToolJobId: fx.upstreamJob.id,
        sourceArtifactId: 'deg_table',
        sourceOutputHash: upstreamHash,
        materializationHash: upstreamHash,
      },
    }],
    outputs: [{
      id: 'enrichment_table',
      filename: 'enrichment_table.csv',
      type: 'table',
      bytes: 'ID,pvalue\nGO:0001,0.01\n',
    }],
  });

  // saveWorkflowGraph：权威图从持久化 Job/Revision 真相投影（生产同款两步）
  const graph = buildAuthoritativeWorkflowGraph({
    projectId: fx.projectId,
    sourceToolJobId: fx.upstreamJob.id,
    jobs: db.listProjectToolJobsForWorkflow(fx.projectId),
    repository: fx.repository,
    requiredToolJobIds: [downstreamJob.id],
  });
  assert.equal(
    graph.ok,
    true,
    `血缘边必须能经 pending revision 解析形成（validateLineage 只要求 Revision 行存在）：${JSON.stringify(graph.diagnostics || [])}`,
  );
  const saved = fx.repository.saveWorkflowGraph(graph.graph);
  assert.equal(saved.validationStatus, 'valid');
  assert.equal(saved.nodes.length, 2, `graph 应为 2 节点：${JSON.stringify(saved.nodes.map((node) => node.id))}`);
  assert.equal(saved.edges.length, 1, `graph 应为 1 边：${JSON.stringify(saved.edges)}`);
  assert.equal(saved.edges[0].kind, 'artifact');
  assert.equal(saved.edges[0].fromNodeId, `job:${fx.upstreamJob.id}`);
  assert.equal(saved.edges[0].toNodeId, `job:${downstreamJob.id}`);
  assert.equal(saved.edges[0].sourceRevisionId, revision.revisionId, '边必须解析到链形成点注册的 pending revision');
  assertPendingPreviewRegistration(fx, revision, '契约①(saveWorkflowGraph 后)');
  assert.equal(changeSet.status, 'preview_ready', '图持久化（saveWorkflowGraph）不得触碰 pending ChangeSet 状态');
});

// ---------------------------------------------------------------------------
// ② 注册产物为 pending ChangeSet + preview revisions：未被 adopt、is_current 不被触碰
// ---------------------------------------------------------------------------
test('F1 契约② 链形成点注册 = pending ChangeSet + preview revisions：绝不自动 adopt，is_current 语义不被触碰', async (context) => {
  const fx = f1Fixture(context);
  await f1PlanAndBind(fx);

  const revision = fx.repository.findRevisionByJobArtifact({
    projectId: fx.projectId,
    toolJobId: fx.upstreamJob.id,
    artifactId: 'deg_table',
  });
  assert.ok(revision, 'F1 契约②：bind 链形成点必须注册 ArtifactRevision（当前代码缺注册 → 红）');
  const changeSet = assertPendingPreviewRegistration(fx, revision, '契约②');

  assert.notEqual(changeSet.status, 'adopted', '绝不自动 adopt：状态不得是 adopted');
  assert.notEqual(changeSet.status, 'reverted', '注册路径不得把候选直接 revert');
  assert.equal(revision.isCurrent, false, 'preview revision 不得是 current（insertRevision 恒写 0，adopt 才翻转）');
  assert.ok(revision.revisionId, '注册 Revision 必须有持久化 id');
  assert.ok(revision.outputHash, '注册 Revision 必须带产物 hash');
  assert.equal(revision.toolJobId, fx.upstreamJob.id, '注册 Revision 必须回指产生它的 tool job');
});

// ---------------------------------------------------------------------------
// ③ 幂等：同 job 重复注册不翻倍
// ---------------------------------------------------------------------------
test('F1 契约③ 幂等：同 job 重复触发链形成点注册，Revision/ChangeSet 均不翻倍', async (context) => {
  const fx = f1Fixture(context);
  const { bound } = await f1PlanAndBind(fx);
  const samePlan = bound.plan;

  const revision = fx.repository.findRevisionByJobArtifact({
    projectId: fx.projectId,
    toolJobId: fx.upstreamJob.id,
    artifactId: 'deg_table',
  });
  assert.ok(revision, 'F1 契约③：首次 bind 应注册 ArtifactRevision（当前代码缺注册 → 红）');
  const changeSetBefore = fx.repository.getChangeSet(revision.changeSetId);
  const jobRevisionsBefore = fx.repository.listProjectRevisions(fx.projectId)
    .filter((item) => item.toolJobId === fx.upstreamJob.id)
    .map((item) => item.revisionId)
    .sort();
  const changeSetCountBefore = fx.repository.listChangeSets({ projectId: fx.projectId }).length;

  // 同一 plan、同一 job 重复 bind（bindVerifiedArtifact 契约允许幂等 re-bind）
  // → 信任层注册必须幂等
  const rebound = await learning.tool_run_tool({
    op: 'bind_artifact',
    workflowPlan: samePlan,
    fromToolJobId: fx.upstreamJob.id,
    fromStepId: 'differential',
    toStepId: 'deg-standardization',
    inputId: 'deg_results',
    artifactId: 'deg_table',
  }, fx.ctx);
  assert.equal(rebound.ok, true, '重复 bind_artifact 应幂等成功（既有 bind 契约）');

  const rerevision = fx.repository.findRevisionByJobArtifact({
    projectId: fx.projectId,
    toolJobId: fx.upstreamJob.id,
    artifactId: 'deg_table',
  });
  assert.equal(rerevision.revisionId, revision.revisionId, '重复注册必须返回同一 Revision（确定性 id / 幂等）');
  const jobRevisionsAfter = fx.repository.listProjectRevisions(fx.projectId)
    .filter((item) => item.toolJobId === fx.upstreamJob.id)
    .map((item) => item.revisionId)
    .sort();
  assert.deepEqual(jobRevisionsAfter, jobRevisionsBefore, '重复注册不得新增该 job 的 Revision 行');
  assert.equal(
    fx.repository.listChangeSets({ projectId: fx.projectId }).length,
    changeSetCountBefore,
    '重复注册不得新增 ChangeSet',
  );
  const changeSetAfter = fx.repository.getChangeSet(changeSetBefore.changeSetId);
  assert.equal(changeSetAfter.status, 'preview_ready', '重复注册不得把 pending ChangeSet 推向 adopted');
  assert.equal(changeSetAfter.adoptedAt, null, '重复注册不得产生 adoptedAt');
  assertPendingPreviewRegistration(fx, rerevision, '契约③');
});

// ---------------------------------------------------------------------------
// ④ selection→enrichment 场景：selection 链形成点注册 pending revision 后，
//    tool_result_selection_run 所发 kind:'selection' lineage（result-selection-tools.js:590-602
//    原形状）可解析成权威图边并持久化。
//    注：不整测 tool_result_selection_run 本体——其 selection 兼容门要求 source revision
//    为 current（result-selection-tools.js:446-456），属 adopt/current 语义（§9 非范围）；
//    本契约只钉信任层语义：pending revision 存在 ⇒ selection lineage 可解析、边可形成。
// ---------------------------------------------------------------------------
test('F1 契约④ selection→enrichment：selection 链形成点注册 pending revision 后，selection lineage 可解析并持久化为 1 边', async (context) => {
  const fx = f1Fixture(context);

  // selection 链形成点：用户在主画布打开裸 job 产物（AUDIT attempt-3 的拒开点
  // result-context-tools.js:168-179）。F1 后此处把产物注册 pending 并解析出 Revision。
  const resolved = resolveResultStudioContext({
    userId: fx.userId,
    projectId: fx.projectId,
    conversationId: fx.conversationId,
    activeArtifact: { jobId: fx.upstreamJob.id, name: 'deg_table.csv' },
  }, {
    repository: fx.repository,
    getProject: (id) => db.getProject(id),
    getToolJob: (id) => db.getToolJob(id),
  });
  assert.equal(
    resolved.ok,
    true,
    `F1 契约④：selection 链形成点必须为裸 job 产物注册 pending Revision 并放行 context（当前代码 context_artifact_not_open → 红）；诊断=${JSON.stringify(resolved.diagnostics || [])}`,
  );
  const revision = resolved.revision;
  assert.ok(revision, 'context 应解析出链形成点注册的 Revision');
  assert.equal(revision.artifactId, 'deg_table');
  assertPendingPreviewRegistration(fx, revision, '契约④');

  // 在 pending revision 上锚定 SelectionContext（真实 repository + 真实契约校验）
  const validated = validateSelectionContext({
    selectionId: `sel_f1${Math.random().toString(36).slice(2, 10)}`,
    projectId: fx.projectId,
    conversationId: fx.conversationId,
    artifactId: 'deg_table',
    revisionId: revision.revisionId,
    entityType: 'gene',
    entityIds: ['TP53', 'EGFR', 'MYC'],
    displayState: { durable: true },
  });
  assert.equal(validated.ok, true, `SelectionContext 应通过契约校验：${JSON.stringify(validated.errors || [])}`);
  const selection = fx.repository.saveSelection(validated.selection);
  assert.equal(selection.revisionId, revision.revisionId, 'selection 应锚定在 pending preview revision 上');

  // 下游 enrichment job：其 provenance input 携带 tool_result_selection_run 所发的
  // resultStudioInputLineage 原形状（kind:'selection' + selectionId/selectionHash +
  // materializationHash=gene-list 物化 hash），executor truth 与生产同构（真实 job 行）。
  const selectionDir = join(fx.workspaceRoot, 'analysis', 'selections', selection.selectionId);
  mkdirSync(selectionDir, { recursive: true });
  const geneListAbs = join(selectionDir, 'gene-list.csv');
  const geneListBytes = 'gene\n"TP53"\n"EGFR"\n"MYC"\n';
  writeFileSync(geneListAbs, geneListBytes);
  const materializationHash = sha256(geneListBytes);
  const downstreamJob = fabricateChainJob(fx, {
    toolId: 'chain-enrich',
    name: 'selection→enrichment 下游',
    params: { deg_table: geneListAbs, species: 'human', gene_id_type: 'auto', analysis_type: 'all' },
    inputs: [{
      id: 'deg_table',
      filename: 'gene-list.csv',
      bytes: geneListBytes,
      lineage: {
        lineageVersion: 1,
        kind: 'selection',
        sourceRevisionId: revision.revisionId,
        sourceToolJobId: revision.toolJobId,
        sourceArtifactId: revision.artifactId,
        sourceOutputHash: revision.outputHash,
        selectionId: selection.selectionId,
        selectionHash: selection.entityIdsHash,
        materializationHash,
      },
    }],
    outputs: [{
      id: 'enrichment_table',
      filename: 'enrichment_table.csv',
      type: 'table',
      bytes: 'ID,pvalue\nGO:0001,0.01\n',
    }],
  });

  // saveWorkflowGraph：权威图从持久化 Job/Revision/Selection 真相投影（生产同款两步）
  const graph = buildAuthoritativeWorkflowGraph({
    projectId: fx.projectId,
    sourceToolJobId: revision.toolJobId,
    jobs: db.listProjectToolJobsForWorkflow(fx.projectId),
    repository: fx.repository,
    requiredToolJobIds: [downstreamJob.id],
  });
  assert.equal(
    graph.ok,
    true,
    `selection lineage 必须能经 pending revision 解析形成边（validateLineage 只要求 Revision/Selection 行存在）：${JSON.stringify(graph.diagnostics || [])}`,
  );
  const saved = fx.repository.saveWorkflowGraph(graph.graph);
  assert.equal(saved.validationStatus, 'valid');
  assert.equal(saved.nodes.length, 2, `graph 应为 2 节点：${JSON.stringify(saved.nodes.map((node) => node.id))}`);
  assert.equal(saved.edges.length, 1, `graph 应为 1 边：${JSON.stringify(saved.edges)}`);
  assert.equal(saved.edges[0].kind, 'selection', 'selection→enrichment 边的 kind 必须是 selection');
  assert.equal(saved.edges[0].sourceRevisionId, revision.revisionId, '边必须解析到 selection 链形成点注册的 pending revision');
  assert.equal(saved.edges[0].selectionId, selection.selectionId);
  assertPendingPreviewRegistration(fx, revision, '契约④(下游成边后)');
});

// ---------------------------------------------------------------------------
// plan 链假执行器（契约⑤/⑥共用）：patch mcp/registry 的 callTool——只替 R 执行。
// manifest/provenance 组装走生产代码：collectExecutionInputs（按 inputId 挂
// inputLineage 选项）+ createExecutionProvenance（签名 provenance），与
// run-plugin-script.js:291-317 provenanceFor 同构，job 落库 completed。
// ---------------------------------------------------------------------------
function installChainRunFakeExecutor(fx, context, captured) {
  const registryModule = require(join(REPO_ROOT, 'core', 'petri-server', 'mcp', 'registry'));
  const { collectExecutionInputs } = require(join(REPO_ROOT, 'core', 'shared-backend', 'artifact-manifest'));
  const { createExecutionProvenance } = require(join(REPO_ROOT, 'core', 'shared-backend', 'execution-provenance'));
  const originalCallTool = registryModule.callTool;
  registryModule.callTool = async function fakeChainRunCallTool(toolId, params, options = {}) {
    captured.calls.push({ toolId, params, options });
    const manifest = pluginLoader.getPluginManifest(toolId);
    const job = db.createToolJob({
      toolId,
      userId: options.userId,
      projectId: options.projectId,
      conversationId: options.conversationId,
      params,
      status: 'running',
      name: `${toolId}（契约⑤ plan 链假执行：生产 manifest 管线 + R 执行替身）`,
    });
    assert.ok(job?.id, '假执行器：tool_job 应能落库');
    const jobDir = join(fx.workspaceRoot, 'results', 'jobs', job.id);
    const outputDir = join(jobDir, 'output');
    mkdirSync(outputDir, { recursive: true });
    const runScriptAbs = join(jobDir, 'run-script.R');
    const runScriptBytes = `# ${toolId} fake run\nprint("${toolId}")\n`;
    writeFileSync(runScriptAbs, runScriptBytes);
    // 生产同款（run-plugin-script.js:301-306）：inputs 由 collectExecutionInputs 组装，
    // resultStudioInputLineage 选项按 inputId 挂 lineage。
    const inputs = collectExecutionInputs({
      inputDefinitions: (manifest && Array.isArray(manifest.inputs)) ? manifest.inputs : [],
      params,
      jobDir,
      inputLineage: options.resultStudioInputLineage || null,
    });
    const artifactRecords = [];
    for (const output of (manifest && Array.isArray(manifest.outputs)) ? manifest.outputs : []) {
      const outputAbs = join(outputDir, output.filename);
      writeFileSync(outputAbs, `gene,log2FoldChange,padj\nTP53,2,0.01\nEGFR,1.5,0.02\n`);
      artifactRecords.push({
        id: output.id,
        name: output.filename,
        path: outputAbs,
        type: output.type,
        sha256: sha256(readFileSync(outputAbs)),
      });
    }
    const provenance = createExecutionProvenance({
      toolJobId: job.id,
      projectId: options.projectId,
      plugin: { id: toolId, version: '1.0.0', language: 'r' },
      params,
      runtime: { name: 'r', ready: true },
      runScriptPath: runScriptAbs,
      command: null,
      artifacts: artifactRecords,
      inputs,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });
    db.updateToolJob(job.id, {
      status: 'completed',
      resultJson: {
        artifactTruth: { status: 'valid', blocking: false, validCount: artifactRecords.length },
        artifacts: artifactRecords,
        executionProvenance: provenance,
      },
      completedAt: Date.now(),
    });
    return {
      content: [{ type: 'text', text: JSON.stringify({ ok: true, toolId, jobId: job.id }) }],
      isError: false,
      toolJobId: job.id,
    };
  };
  context.after(() => {
    registryModule.callTool = originalCallTool;
  });
  return registryModule;
}

// ---------------------------------------------------------------------------
// ⑤ 补刃·plan 链 run 路径下游输入 lineage：op='run' 执行 plan 步骤时解析 plan.lineage
//    → F1 注册 revision → 上游物化字节哈希校验 → inputLineage 经既有
//    resultStudioInputLineage 选项传入 → 下游 job manifest 输入带 lineage
//    且 buildAuthoritativeWorkflowGraph 出 ≥1 边。
// ---------------------------------------------------------------------------
test('F1 补刃⑤ plan 链 run：下游 job manifest 输入带 lineage（经 resultStudioInputLineage 选项）且权威图 ≥1 边', async (context) => {
  const fx = f1Fixture(context);
  const { bound } = await f1PlanAndBind(fx);
  const upstreamRevision = fx.repository.findRevisionByJobArtifact({
    projectId: fx.projectId,
    toolJobId: fx.upstreamJob.id,
    artifactId: 'deg_table',
  });
  assert.ok(upstreamRevision, '夹具前置：bind 应已注册上游 revision（F1 既有行为）');
  const expectedLineage = {
    lineageVersion: 1,
    kind: 'artifact',
    sourceRevisionId: upstreamRevision.revisionId,
    sourceToolJobId: fx.upstreamJob.id,
    sourceArtifactId: 'deg_table',
    sourceOutputHash: upstreamRevision.outputHash,
    materializationHash: upstreamRevision.outputHash,
  };

  const captured = { calls: [] };
  installChainRunFakeExecutor(fx, context, captured);

  const run = await learning.tool_run_tool({
    op: 'run',
    workflowPlan: bound.plan,
    stepId: 'deg-standardization',
  }, fx.ctx);
  assert.equal(run.ok, true, `op=run plan 步骤应执行成功（假执行器承接 R 执行）：${JSON.stringify(run).slice(0, 300)}`);
  assert.ok(run.toolJobId, 'op=run 应透传 toolJobId');
  assert.equal(captured.calls.length, 1, '假执行器应恰好承接一次下游执行');
  assert.equal(captured.calls[0].toolId, 'deg-standardizer');

  // ⑤a：run 路径把 plan 链解析出的 inputLineage 经既有选项传入执行器
  // （当前代码只透传 ctx.resultStudioInputLineage=null → 此处红）
  assert.deepEqual(
    captured.calls[0].options.resultStudioInputLineage,
    { deg_results: expectedLineage },
    'F1 补刃⑤a：plan 链 run 必须把 bound 上游的 lineage 经 resultStudioInputLineage 传入执行器（当前代码缺解析 → 红）',
  );

  // ⑤b：下游 job 持久化 manifest 输入带 lineage（生产 collectExecutionInputs 挂载，
  // 与 attempt-5 实证缺 metadata 的形状互为镜像）。materializationHash 必须=输入文件
  // 实际字节哈希=上游产物哈希（kind='artifact' 精确交接合同）。
  const downstreamJob = db.getToolJob(run.toolJobId);
  const manifestInput = (downstreamJob.result.executionProvenance.inputs || [])
    .find((input) => input.id === 'deg_results');
  assert.ok(manifestInput, '下游 job manifest 应含 deg_results 输入');
  assert.deepEqual(
    manifestInput.lineage,
    expectedLineage,
    'F1 补刃⑤b：下游 job manifest 输入必须携带 lineage 元数据（当前代码 lineage=null → 红）',
  );
  assert.equal(manifestInput.sha256, expectedLineage.materializationHash, 'manifest 输入 sha256 必须等于 materializationHash');

  // ⑤c：权威图从持久化真相解析出 ≥1 边（当前代码 manifest 无 lineage → 0 边 → 红）
  const graph = buildAuthoritativeWorkflowGraph({
    projectId: fx.projectId,
    sourceToolJobId: fx.upstreamJob.id,
    jobs: db.listProjectToolJobsForWorkflow(fx.projectId),
    repository: fx.repository,
    requiredToolJobIds: [run.toolJobId],
  });
  assert.equal(
    graph.ok,
    true,
    `权威图必须能经下游 manifest lineage 解析成边：${JSON.stringify(graph.diagnostics || [])}`,
  );
  assert.ok(graph.graph.edges.length >= 1, `权威图应 ≥1 边：${JSON.stringify(graph.graph.edges)}`);
  assert.equal(graph.graph.edges[0].kind, 'artifact');
  assert.equal(graph.graph.edges[0].sourceRevisionId, upstreamRevision.revisionId, '边必须解析到链形成点注册的 pending revision');
  assert.equal(graph.graph.edges[0].toNodeId, `job:${run.toolJobId}`);
});

// ---------------------------------------------------------------------------
// ⑥ 补刃·图落库：ensureChainRevisions 注册成功后以该 job 为 source 构建权威图并
//    saveWorkflowGraph 落库（attempt-5 实证：changesets ×3 在而 graph 0 行，
//    /lineage 读不到图）。断言：bind 后项目 graph 行存在（1 节点）→ 下游跑完后
//    节点数随链增长（2 节点 1 边），历史行不覆写。
// ---------------------------------------------------------------------------
test('F1 补刃⑥ ensureChainRevisions 注册成功后权威图落库：graph 行存在且节点数随链增长', async (context) => {
  const fx = f1Fixture(context);
  assert.equal(
    fx.repository.listProjectWorkflowGraphs(fx.projectId).length, 0,
    '夹具前置：bind 前项目应无 graph 行',
  );

  // bind 链形成点 → ensureChainRevisions 成功 → 图落库（attempt-5 死点：只注册不落图）
  const { bound } = await f1PlanAndBind(fx);
  const graphsAfterBind = fx.repository.listProjectWorkflowGraphs(fx.projectId);
  assert.equal(
    graphsAfterBind.length, 1,
    `F1 补刃⑥：bind 注册成功后项目必须落库权威图（当前代码 0 行 → 红）：${JSON.stringify(graphsAfterBind.length)}`,
  );
  assert.equal(graphsAfterBind[0].rootToolJobId, fx.upstreamJob.id, 'bind 后图以首步 job 为根');
  assert.equal(graphsAfterBind[0].nodes.length, 1, 'bind 后图为单节点（仅首步 job）');
  assert.equal(graphsAfterBind[0].validationStatus, 'valid');

  // 下游跑完（假执行器）→ run 链形成点注册下游 job → 图节点数随链增长
  const captured = { calls: [] };
  installChainRunFakeExecutor(fx, context, captured);
  const run = await learning.tool_run_tool({
    op: 'run',
    workflowPlan: bound.plan,
    stepId: 'deg-standardization',
  }, fx.ctx);
  assert.equal(run.ok, true, `op=run plan 步骤应执行成功：${JSON.stringify(run).slice(0, 300)}`);

  const graphsAfterRun = fx.repository.listProjectWorkflowGraphs(fx.projectId);
  const grown = graphsAfterRun.find((graph) => graph.nodes.length === 2);
  assert.ok(
    grown,
    `F1 补刃⑥：下游链形成点注册后图节点数必须随链增长到 2（当前代码无落库 → 红）：${JSON.stringify(graphsAfterRun.map((graph) => graph.nodes.length))}`,
  );
  assert.equal(grown.edges.length, 1, `增长图应为 1 边：${JSON.stringify(grown.edges)}`);
  assert.equal(grown.edges[0].kind, 'artifact');
  // 勘误（红侧规格修正）：rootToolJobId 的平台权威语义=拓扑根（唯一无入边上游），
  // 由 buildAuthoritativeWorkflowGraph 写死（result-workflow-graph.js:671 authoritativeRootJobId）
  // 并由 persistWorkflowGraph 的 content-addressed integrity 校验强制
  // （result-studio-repository.js:70-82，digest 按 rootToolJobId+nodes+edges 重算——
  // root=source 的行根本落不了库）。2 节点 1 边链的权威根=首步上游 job；
  // 下游在图内由 nodes/edges 断言钉死（lineage 闭包含上游=上游为根）。
  assert.equal(grown.rootToolJobId, fx.upstreamJob.id, '增长图以权威上游根为根（拓扑根=唯一无入边首步 job，下游经 lineage 闭包含入）');
  assert.ok(
    grown.nodes.some((node) => node.id === `job:${run.toolJobId}`),
    '增长图必须包含下游 job 节点（/lineage 投影按包含目标 job 的图查找）',
  );
  // 不覆写历史：bind 时的 1 节点图行仍在（persistWorkflowGraph 按 project+source_digest 幂等）
  assert.ok(
    graphsAfterRun.some((graph) => graph.nodes.length === 1 && graph.rootToolJobId === fx.upstreamJob.id),
    'bind 时的 1 节点历史图行不得被覆写',
  );
});
