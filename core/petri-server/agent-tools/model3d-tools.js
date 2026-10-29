'use strict';

/**
 * agent-tools/model3d-tools.js — NEXT-04A SceneSpec / Three.js / Blender 工具面。
 *
 * SceneSpec 是源真相；Three.js 负责交互预览，Blender 是可选本地执行后端。
 * 所有写操作限制在项目工作区，不接受任意脚本/URL/shader。
 */

const fs = require('node:fs');
const path = require('node:path');
const db = require('../db');
const scene3d = require('../helpers/scene3d');
const sceneStore = require('../helpers/model3d-scene-store');
const { runModel3DRecipe } = require('../helpers/model3d-recipe-runner');
const blender = require('../helpers/blender-provider');
const { runModel3DReview } = require('../helpers/model3d-review');
const {
  authorizeProject,
} = require('./workspace-tools/internals');

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
  const allowed = new Set(['glb', 'stl', 'obj']);
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
  const capability = await blender.probeBlender();
  if (capability.status !== 'ready') {
    return {
      ok: false,
      error: 'capability_unavailable',
      reason: capability.reason,
      message: 'Blender 未安装或不可用；Three.js 预览仍可用，构建/渲染/导出需本地 Blender。',
    };
  }
  const result = await blender.runBlenderScene({
    scene: resolved.scene,
    workspaceRoot: workspace.root,
    views: Array.isArray(args.views) ? args.views : ['front', 'top', 'side', 'iso'],
    formats: args.renderOnly ? [] : normalizeFormats(args.formats),
  });
  return { ...result, provider: { status: capability.status, version: capability.version } };
}

async function tool_model3d_render(args = {}, ctx = {}) {
  const result = await runProvider({ ...args, renderOnly: true }, ctx);
  if (result.ok === false) return result;
  return {
    ok: true,
    provider: 'blender',
    providerVersion: result.provider?.version || null,
    scene: result.sceneHashFile,
    outDir: result.outDir,
    report: result.report,
    outputs: result.outputs,
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
  return {
    ok: true,
    sceneHash,
    provider: 'blender',
    providerVersion: result.provider?.version || null,
    outDir: result.outDir,
    manifest: path.relative(workspace.root, manifestPath).replace(/\\/g, '/'),
    report: result.report,
    outputs: result.outputs,
    durationMs: result.durationMs,
  };
}

async function tool_model3d_visual_qa(args = {}, ctx = {}) {
  const workspace = await projectWorkspace(ctx);
  if (workspace.error) return workspace.error;
  return runModel3DReview({
    scene: args.scene,
    workspaceRoot: workspace.root,
    userId: ctx.userId,
    views: Array.isArray(args.views) ? args.views : ['front', 'top', 'side', 'iso'],
  });
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
};
