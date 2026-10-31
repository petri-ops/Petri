'use strict';

/**
 * agent-tools/model3d-tools.js — NEXT-04A SceneSpec / Three.js / Blender 工具面。
 *
 * SceneSpec 是源真相；Three.js 负责交互预览，Blender 是可选本地执行后端。
 * 所有写操作限制在项目工作区，不接受任意脚本/URL/shader。
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const db = require('../db');
const scene3d = require('../helpers/scene3d');
const sceneStore = require('../helpers/model3d-scene-store');
const { DEFAULT_RENDER_VIEWS, normalizeTurntable } = require('../helpers/model3d-views');
const { runModel3DRecipe } = require('../helpers/model3d-recipe-runner');
const blender = require('../helpers/blender-provider');
const { runModel3DReview } = require('../helpers/model3d-review');
const bomHelper = require('../helpers/model3d-bom');
const assets = require('../helpers/model3d-assets');
const cadExchange = require('../helpers/cad-exchange');
const { createCadDrawing } = require('../helpers/model3d-cad-drawing');
const { createModel3DSharePackage } = require('../helpers/model3d-share-package');
const { buildModel3dArtifactRecords } = require('../helpers/model3d-artifact-projection');
const {
  authorizeProject,
} = require('./workspace-tools/internals');
const { createResultStudioRepository } = require('../../shared-backend/result-studio-repository');
const { registerModel3DExportRevision } = require('../../shared-backend/model3d-revision-bridge');

async function projectWorkspace(ctx = {}) {
  const projectId = typeof ctx.projectId === 'string' ? ctx.projectId.trim() : '';
  if (!projectId) return { error: { ok: false, error: 'project_required', message: '3D 操作需要项目工作区。' } };
  const project = db.getProject(projectId);
  if (!project) return { error: { ok: false, error: 'project_not_found' } };
  try {
    authorizeProject(project, ctx.userId, db);
  } catch (error) {
    return { error: { ok: false, error: error.code || 'permission_denied', message: error.message } };
  }
  return { project, root: project.workspace_path };
}

function requireScene(args) {
  if (!args || typeof args.scene !== 'object') return { error: { ok: false, error: 'scene_required' } };
  const validated = scene3d.validateSceneSpec(args.scene);
  if (!validated.ok) return { error: { ok: false, ...validated } };
  return { scene: args.scene, stats: validated.stats };
}

async function tool_model3d_inspect(args = {}) {
  const checked = requireScene(args);
  if (checked.error) return checked.error;
  const resolved = scene3d.resolveSceneSpec(checked.scene);
  if (!resolved.ok) return resolved;
  return {
    ok: true,
    sceneHash: scene3d.hashSceneSpec(checked.scene),
    meta: checked.scene.metadata || {},
    stats: checked.stats,
    nodes: resolved.scene.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      dimensions: node.dimensions || null,
      transform: node.transform || null,
    })),
    constraints: checked.scene.constraints || [],
    appliedConstraints: resolved.appliedConstraints,
  };
}

async function tool_model3d_validate(args = {}) {
  const checked = requireScene(args);
  if (checked.error) return checked.error;
  return {
    ok: true,
    sceneHash: scene3d.hashSceneSpec(checked.scene),
    stats: checked.stats,
    blender: await blender.probeBlender(),
  };
}

async function tool_model3d_propose(args = {}) {
  const checked = requireScene(args);
  if (checked.error) return checked.error;
  const proposed = scene3d.applySceneOperations(checked.scene, args.operations);
  if (!proposed.ok) return proposed;
  return {
    ok: true,
    proposal: true,
    scene: proposed.scene,
    beforeHash: proposed.beforeHash,
    afterHash: proposed.afterHash,
    message: '候选变更已校验，尚未写盘。用户批准后再调用 model3d_apply。',
  };
}

async function tool_model3d_apply(args = {}, ctx = {}) {
  const workspace = await projectWorkspace(ctx);
  if (workspace.error) return workspace.error;
  const checked = requireScene(args);
  if (checked.error) return checked.error;
  const relativePath = typeof args.path === 'string' && args.path.trim()
    ? args.path.trim()
    : 'model3d/scene.scene3d.json';
  const applied = await sceneStore.applyOperations({
    workspaceRoot: workspace.root,
    relativePath,
    scene: args.scene,
    operations: args.operations,
    expectedHash: args.expectedHash || null,
    reason: args.reason || 'agent_apply',
  });
  return applied;
}

function normalizeFormats(formats) {
  const allowed = new Set(['glb', 'stl', 'obj', 'fbx', 'usdz', 'step']);
  const list = (Array.isArray(formats) ? formats : ['glb'])
    .map((item) => String(item).toLowerCase())
    .filter((item) => allowed.has(item));
  return list.length > 0 ? [...new Set(list)] : ['glb'];
}

async function runProvider(args, ctx) {
  const workspace = await projectWorkspace(ctx);
  if (workspace.error) return workspace.error;
  const checked = requireScene(args);
  if (checked.error) return checked.error;
  const resolved = scene3d.resolveSceneSpec(checked.scene);
  if (!resolved.ok) return resolved;
  // 转盘参数是输出请求（不进 SceneSpec/hash）；边界只在 helpers/model3d-views 声明一处。
  const requestedTurntable = normalizeTurntable(args.turntable);
  if (!requestedTurntable.ok) return { ok: false, error: requestedTurntable.error };
  const capability = await blender.probeBlender();
  if (capability.status !== 'ready') {
    return {
      ok: false,
      error: 'capability_unavailable',
      reason: capability.reason,
      message: 'Blender 未安装或不可用；Three.js 预览仍可用，构建/渲染/导出需本地 Blender。',
    };
  }
  const requestedFormats = args.renderOnly ? [] : normalizeFormats(args.formats);
  const wantsStep = requestedFormats.includes('step');
  const blenderFormats = requestedFormats.filter((format) => format !== 'step');
  if (wantsStep && !blenderFormats.includes('stl')) blenderFormats.push('stl');
  const result = await blender.runBlenderScene({
    scene: resolved.scene,
    workspaceRoot: workspace.root,
    views: Array.isArray(args.views) ? args.views : [...DEFAULT_RENDER_VIEWS],
    formats: blenderFormats,
    turntable: requestedTurntable.turntable,
    lineart: args.lineart === true,
  });
  if (!result.ok || !wantsStep) {
    return { ...result, provider: { status: capability.status, version: capability.version } };
  }
  const stlOutput = (result.outputs || []).find((item) => String(item.path || '').toLowerCase().endsWith('.stl'));
  if (!stlOutput) {
    return { ...result, ok: false, error: 'stl_required_for_step', provider: { status: capability.status, version: capability.version } };
  }
  let stlBytes;
  try {
    stlBytes = fs.readFileSync(path.join(workspace.root, stlOutput.path));
  } catch (error) {
    return { ...result, ok: false, error: 'step_source_unreadable', message: error.message, provider: { status: capability.status, version: capability.version } };
  }
  const converted = await cadExchange.stlToStep({ bytes: stlBytes });
  if (!converted.ok) {
    return {
      ...result,
      ok: false,
      error: converted.error,
      message: converted.message || 'STL→STEP conversion failed.',
      provider: { status: capability.status, version: capability.version },
    };
  }
  const stepPath = path.join(workspace.root, result.outDir, 'scene.step');
  fs.writeFileSync(stepPath, converted.step);
  const stepRel = path.relative(workspace.root, stepPath).replace(/\\/g, '/');
  const stepOutput = {
    path: stepRel,
    sha256: crypto.createHash('sha256').update(converted.step).digest('hex'),
    bytes: Buffer.byteLength(converted.step),
    format: 'step',
    derivedFrom: stlOutput.path,
    faceted: true,
  };
  return {
    ...result,
    outputs: [...(result.outputs || []), stepOutput],
    cad: {
      kernel: converted.summary.kernel,
      kernelVersion: converted.summary.kernelVersion,
      schema: converted.summary.schema,
      faceted: true,
      solidCount: converted.summary.solidCount,
      source: stlOutput.path,
      step: stepOutput,
      volumeMm3: converted.summary.volumeMm3,
      bbox: converted.summary.bbox,
    },
    provider: { status: capability.status, version: capability.version },
  };
}

async function tool_model3d_render(args = {}, ctx = {}) {
  const result = await runProvider({ ...args, renderOnly: true }, ctx);
  if (result.ok === false) return result;
  const workspace = await projectWorkspace(ctx);
  if (workspace.error) return workspace.error;
  const relative = (value) => (value ? path.relative(workspace.root, value).replace(/\\/g, '/') : value);
  const lineart = result.report?.lineart ? {
    ...result.report.lineart,
    views: Object.fromEntries(Object.entries(result.report.lineart.views || {}).map(([view, value]) => [view, relative(value)])),
  } : null;
  return {
    ok: true,
    provider: 'blender',
    providerVersion: result.provider?.version || null,
    scene: result.sceneHashFile,
    outDir: result.outDir,
    report: result.report,
    lineart,
    outputs: result.outputs,
    frameAssets: result.frameAssets || [],
    durationMs: result.durationMs,
  };
}

async function tool_model3d_export(args = {}, ctx = {}) {
  const result = await runProvider(args, ctx);
  if (result.ok === false) return result;
  const workspace = await projectWorkspace(ctx);
  if (workspace.error) return workspace.error;
  const sceneHash = scene3d.hashSceneSpec(args.scene);
  const manifest = scene3d.buildExportManifest({
    sceneHash,
    taskSpecId: args.taskSpecId || null,
    workflowRunId: args.workflowRunId || null,
    recipeId: args.recipeId || null,
    recipeVersion: args.recipeVersion ?? null,
    provider: 'blender',
    providerVersion: result.provider?.version || null,
    inputHashes: {},
    validation: {
      ok: result.report?.ok === true,
      watertight: result.report?.mesh?.watertight === true,
      nonManifoldEdges: result.report?.mesh?.nonManifoldEdges ?? null,
    },
    outputs: result.outputs || [],
  });
  const manifestPath = path.join(workspace.root, result.outDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  // RW-01 导出即登记：真实作业记录 → 盖章 → 成果面真值桥（change-set + revision + lineage 图）。
  // fail-open：登记失败不吞导出结果——导出文件与 manifest 已是事实，登记错误如实随结果上报。
  let resultStudio = null;
  try {
    const repository = createResultStudioRepository(db.getDatabase());
    const job = db.createToolJob({
      toolId: 'model3d_export',
      userId: ctx.userId || 'agent',
      params: { sceneHash, recipeId: args.recipeId || null, outDir: result.outDir },
      status: 'running',
      name: 'model3d_export 3D 导出',
      projectId: ctx.projectId,
      conversationId: ctx.conversationId || null,
    });
    if (job && job.id) {
      const registration = registerModel3DExportRevision({
        repository,
        job: {
          id: job.id,
          tool_id: 'model3d_export',
          project_id: ctx.projectId,
          user_id: ctx.userId || 'agent',
          params: {},
          conversation_id: ctx.conversationId || null,
        },
        manifest,
        // 产物家族身份锚：调用方声明的稳定场景源文件路径（真实编辑线产物）优先；
        // 内联场景无锚时回退 run 目录场景副本（身份随 run，不跨导出 stack）。
        sceneRelativePath: (typeof args.scenePath === 'string' && args.scenePath.trim())
          ? args.scenePath.trim()
          : (result.sceneHashFile || null),
        workspaceRoot: workspace.root,
        outputs: result.outputs || [],
      });
      if (registration.ok) {
        resultStudio = {
          registered: true,
          idempotent: registration.idempotent === true,
          adopted: registration.adopted === true,
          toolJobId: job.id,
          revisions: (registration.revisions || []).map((revision) => ({
            revisionId: revision.revisionId,
            artifactId: revision.artifactId,
            artifactFamilyId: revision.artifactFamilyId,
            outputPath: revision.outputPath,
            outputHash: revision.outputHash,
            validationStatus: revision.validationStatus,
          })),
          graphId: registration.graph?.graphId || null,
          changeSetId: registration.changeSet?.changeSetId || null,
        };
      } else {
        resultStudio = { registered: false, toolJobId: job.id, error: registration.error };
      }
      // artifacts/files 投影：/tools/status 下钻链（CommandCenterJobsWall handleDrill）
      // 读 result_json.artifacts[].name——缺位即「无产物可下钻」（RW-06 代行评估抓真）；
      // url 走项目工作区读面（model3d 产物在 workspace model3d/runs/，不在 tool run
      // output 布局，缺 url 时结果面回落 /api/tools/file/<job>/<name> 必然 404——UI-638）。
      const artifacts = buildModel3dArtifactRecords(ctx.projectId, result.outputs);
      const jobResult = {
        ok: true,
        sceneHash,
        outDir: result.outDir,
        outputs: result.outputs,
        artifacts,
        files: artifacts.map((item) => ({ ...item })),
        resultStudio,
      };
      db.updateToolJob(job.id, { status: 'completed', resultJson: JSON.stringify(jobResult), completedAt: Date.now() });
    } else {
      resultStudio = { registered: false, error: { code: 'model3d_job_create_failed' } };
    }
  } catch (error) {
    resultStudio = { registered: false, error: { code: 'model3d_register_failed', message: error.message } };
  }

  return {
    ok: true,
    sceneHash,
    provider: 'blender',
    providerVersion: result.provider?.version || null,
    outDir: result.outDir,
    manifest: path.relative(workspace.root, manifestPath).replace(/\\/g, '/'),
    report: result.report,
    outputs: result.outputs,
    cad: result.cad || null,
    frameAssets: result.frameAssets || [],
    durationMs: result.durationMs,
    resultStudio,
  };
}

async function tool_model3d_visual_qa(args = {}, ctx = {}) {
  const workspace = await projectWorkspace(ctx);
  if (workspace.error) return workspace.error;
  return runModel3DReview({
    scene: args.scene,
    workspaceRoot: workspace.root,
    userId: ctx.userId,
    views: Array.isArray(args.views) ? args.views : [...DEFAULT_RENDER_VIEWS],
  });
}

async function tool_model3d_share(args = {}, ctx = {}) {
  const workspace = await projectWorkspace(ctx);
  if (workspace.error) return workspace.error;
  if (typeof args.scenePath !== 'string' || typeof args.manifestPath !== 'string') {
    return { ok: false, error: 'share_scene_and_manifest_required' };
  }
  return createModel3DSharePackage({
    workspaceRoot: workspace.root,
    scenePath: args.scenePath,
    manifestPath: args.manifestPath,
    outputs: args.outputs,
    packageName: args.name,
  });
}

async function tool_model3d_asset(args = {}, ctx = {}) {
  const action = String(args.action || 'list');
  if (action === 'list') {
    const workspace = await projectWorkspace(ctx);
    if (workspace.error) return workspace.error;
    return assets.listAssets({ workspaceRoot: workspace.root, query: args.query, limit: args.limit });
  }
  if (action === 'get') {
    const workspace = await projectWorkspace(ctx);
    if (workspace.error) return workspace.error;
    return assets.getAsset({ workspaceRoot: workspace.root, assetId: args.assetId });
  }
  if (action === 'drawing') {
    const workspace = await projectWorkspace(ctx);
    if (workspace.error) return workspace.error;
    return createCadDrawing({
      workspaceRoot: workspace.root,
      sourcePath: args.sourcePath,
      views: args.views,
      width: args.width,
      height: args.height,
      showHidden: args.showHidden,
    });
  }
  if (action === 'generate') {
    const workspace = await projectWorkspace(ctx);
    if (workspace.error) return workspace.error;
    return assets.generateAndImport({ workspaceRoot: workspace.root, prompt: args.prompt, name: args.name });
  }
  if (action !== 'import') return { ok: false, error: 'asset_action_invalid' };
  const workspace = await projectWorkspace(ctx);
  if (workspace.error) return workspace.error;
  if (cadExchange.cadFormatForPath(args.sourcePath)) {
    return assets.importCadAsset({
      workspaceRoot: workspace.root,
      sourcePath: args.sourcePath,
      name: args.name,
      provenance: args.provenance,
    });
  }
  return assets.importMeshAsset({
    workspaceRoot: workspace.root,
    sourcePath: args.sourcePath,
    name: args.name,
    provenance: args.provenance,
  });
}

async function tool_model3d_bom(args = {}, ctx = {}) {
  const workspace = await projectWorkspace(ctx);
  if (workspace.error) return workspace.error;
  const checked = requireScene(args);
  if (checked.error) return checked.error;
  const resolved = scene3d.resolveSceneSpec(checked.scene);
  if (!resolved.ok) return resolved;
  const capability = await blender.probeBlender();
  if (capability.status !== 'ready') {
    return { ok: false, error: 'capability_unavailable', reason: capability.reason };
  }
  const run = await blender.runBlenderScene({
    scene: resolved.scene,
    workspaceRoot: workspace.root,
    views: [],
    formats: [],
  });
  if (!run.ok) return run;
  const bom = bomHelper.buildBom(
    checked.scene,
    run.report,
    { defaultDensityKgM3: Number.isFinite(args.defaultDensityKgM3) ? args.defaultDensityKgM3 : undefined },
  );
  if (!bom.ok) return bom;
  const artifacts = bomHelper.writeBomArtifacts({
    workspaceRoot: workspace.root,
    bom,
    runId: `bom-${Date.now().toString(36)}`,
  });
  if (!artifacts.ok) return artifacts;
  return {
    ok: true,
    schema: bom.schema,
    sceneHash: bom.sceneHash,
    totals: bom.totals,
    rows: bom.rows,
    assumptions: bom.assumptions,
    mesh: bom.mesh,
    dir: artifacts.dir,
    files: artifacts.files,
    artifacts: buildModel3dArtifactRecords(ctx.projectId, artifacts.files),
    manifest: artifacts.manifest,
    csv: artifacts.csv,
    markdown: artifacts.markdown,
  };
}

async function tool_model3d_recipe(args = {}, ctx = {}) {
  if (args.dryRun !== false) {
    return runModel3DRecipe({ recipeId: args.recipeId, params: args.params, dryRun: true });
  }
  const workspace = await projectWorkspace(ctx);
  if (workspace.error) return workspace.error;
  return runModel3DRecipe({
    recipeId: args.recipeId,
    params: args.params,
    workspaceRoot: workspace.root,
    relativePath: args.path,
    dryRun: false,
    render: args.render,
    views: args.views,
    formats: args.formats,
  });
}

module.exports = {
  tool_model3d_inspect,
  tool_model3d_validate,
  tool_model3d_propose,
  tool_model3d_apply,
  tool_model3d_render,
  tool_model3d_export,
  tool_model3d_visual_qa,
  tool_model3d_recipe,
  tool_model3d_bom,
  tool_model3d_asset,
  tool_model3d_share,
};
