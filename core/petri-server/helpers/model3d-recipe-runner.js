'use strict';

const fs = require('node:fs');
const path = require('node:path');
const scene3d = require('./scene3d');
const { DEFAULT_RENDER_VIEWS } = require('./model3d-views');
const blender = require('./blender-provider');
const sceneStore = require('./model3d-scene-store');
const recipes = require('./model3d-recipes');

function normalizeFormats(formats) {
  const allowed = new Set(['glb', 'stl', 'obj']);
  const list = (Array.isArray(formats) ? formats : [])
    .map((item) => String(item).toLowerCase())
    .filter((item) => allowed.has(item));
  return list.length > 0 ? [...new Set(list)] : ['glb'];
}

async function runModel3DRecipe({
  recipeId,
  params,
  workspaceRoot,
  relativePath,
  dryRun = true,
  render,
  views,
  formats,
  signal,
} = {}) {
  const built = recipes.buildRecipe(recipeId, params);
  if (!built.ok) return built;
  if (dryRun) {
    return {
      ...built,
      dryRun: true,
      message: 'recipe 已生成候选 SceneSpec；未写盘、未渲染。确认后再以 dryRun=false 执行。',
    };
  }
  if (!workspaceRoot) return { ok: false, error: 'project_required' };
  if (signal?.aborted) return { ok: false, error: 'recipe_cancelled' };
  const targetPath = typeof relativePath === 'string' && relativePath.trim()
    ? relativePath.trim()
    : `model3d/recipes/${built.recipe.id}.scene3d.json`;
  const written = await sceneStore.writeScene({
    workspaceRoot,
    relativePath: targetPath,
    scene: built.scene,
    reason: `recipe:${built.recipe.id}@${built.recipe.version}`,
  });
  if (!written.ok) return written;
  const result = {
    ...built,
    dryRun: false,
    written: { path: written.path, beforeHash: written.beforeHash, afterHash: written.afterHash, revision: written.revision },
  };
  const renderWanted = render !== false;
  const outputFormats = Array.isArray(formats)
    ? normalizeFormats(formats)
    : (renderWanted ? ['glb'] : []);
  if (!renderWanted && outputFormats.length === 0) return result;
  const capability = await blender.probeBlender();
  if (capability.status !== 'ready') {
    return { ...result, render: { ok: false, error: 'capability_unavailable', reason: capability.reason } };
  }
  const resolved = scene3d.resolveSceneSpec(built.scene);
  if (!resolved.ok) return { ...result, render: { ok: false, error: resolved.error, errors: resolved.errors } };
  const run = await blender.runBlenderScene({
    scene: resolved.scene,
    workspaceRoot,
    views: renderWanted ? (Array.isArray(views) ? views : [...DEFAULT_RENDER_VIEWS]) : [],
    formats: outputFormats,
    signal,
  });
  if (!run.ok) return { ...result, render: run };
  const manifest = scene3d.buildExportManifest({
    sceneHash: built.hash,
    recipeId: built.recipe.id,
    recipeVersion: built.recipe.version,
    provider: 'blender',
    providerVersion: capability.version,
    inputHashes: {},
    validation: {
      ok: run.report?.ok === true,
      watertight: run.report?.mesh?.watertight === true,
      nonManifoldEdges: run.report?.mesh?.nonManifoldEdges ?? null,
    },
    outputs: run.outputs || [],
  });
  const manifestPath = path.join(workspaceRoot, run.outDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return {
    ...result,
    render: {
      outDir: run.outDir,
      report: run.report,
      outputs: run.outputs,
      manifest: path.relative(workspaceRoot, manifestPath).replace(/\\/g, '/'),
      durationMs: run.durationMs,
    },
  };
}

module.exports = { runModel3DRecipe };
