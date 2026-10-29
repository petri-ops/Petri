export const meta = {
  name: 'model3d-recipe-build',
  version: 1,
  budget: { maxAgents: 1, maxSteps: 6, timeoutMs: 300000 },
  concurrency: 1,
};

// NEXT-05 — 五类 recipe 的统一工作流模板。
// args: { projectId, recipeId, params, path?, formats?, views? }
export default async function run(ctx) {
  const recipeId = ctx && ctx.recipeId;
  const params = (ctx && ctx.params) || {};
  const projectId = ctx && ctx.projectId;
  const targetPath = ctx && ctx.path;
  const formats = ctx && ctx.formats ? ctx.formats : ['glb'];
  const views = ctx && ctx.views ? ctx.views : ['front', 'top', 'side', 'iso'];

  const dryRun = await phase('dryRun', async () => recipe(recipeId, params, { dryRun: true }));
  if (!dryRun || dryRun.ok !== true) throw new Error((dryRun && dryRun.error) || 'recipe_dry_run_failed');
  if (!projectId) throw new Error('project_required');

  const executed = await phase('execute', async () => {
    const outcome = await recipe(recipeId, params, {
      dryRun: false,
      projectId,
      path: targetPath,
      render: true,
      views,
      formats,
    });
    if (budget.cancelled) throw new Error('workflow_cancelled');
    return outcome;
  });
  if (budget.cancelled) return { cancelled: true };
  if (!executed || executed.ok !== true) throw new Error((executed && executed.error) || 'recipe_execute_failed');
  if (!executed.render || executed.render.ok === false) throw new Error((executed.render && executed.render.error) || 'recipe_export_failed');

  return {
    recipeId: dryRun.recipe && dryRun.recipe.id,
    recipeVersion: dryRun.recipe && dryRun.recipe.version,
    sceneHash: executed.hash,
    written: executed.written,
    outDir: executed.render.outDir,
    manifest: executed.render.manifest,
    outputs: executed.render.outputs,
    mesh: executed.render.report && executed.render.report.mesh,
  };
}
