import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const runner = require('../core/petri-server/helpers/workflow-runner.js');
const SOURCE = fs.readFileSync(path.resolve('resources/model3d/workflows/recipe-build.js'), 'utf8');

function root() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'n05-wf-'));
}

test('NEXT-05 workflow — recipe 经宿主原语 dryRun→execute，返回 manifest/mesh', async () => {
  const calls = [];
  const deps = {
    recipe: async (payload) => {
      calls.push(payload);
      if (payload.dryRun !== false) {
        return { ok: true, recipe: { id: 'box-enclosure', version: 1 }, scene: {}, hash: 'a'.repeat(64) };
      }
      return {
        ok: true,
        recipe: { id: 'box-enclosure', version: 1 },
        hash: 'b'.repeat(64),
        written: { path: 'model3d/recipes/box-enclosure.scene3d.json' },
        render: {
          ok: true,
          outDir: 'model3d/runs/run-1',
          manifest: 'model3d/runs/run-1/manifest.json',
          outputs: [{ path: 'scene.glb' }],
          report: { mesh: { watertight: true, nonManifoldEdges: 0 } },
        },
      };
    },
  };
  const run = runner.startWorkflowRun({
    source: SOURCE,
    args: { projectId: 'p_1', recipeId: 'box-enclosure', params: { width: 120 } },
    userId: 'u_1',
    deps,
    root: root(),
  });
  const result = await run.promise;
  assert.equal(result.status, 'completed');
  assert.deepEqual(calls.map((item) => item.dryRun), [true, false]);
  assert.equal(calls[0].projectId, undefined);
  assert.equal(calls[1].projectId, 'p_1');
  assert.equal(result.returned.manifest, 'model3d/runs/run-1/manifest.json');
  assert.equal(result.returned.mesh.watertight, true);
});

test('NEXT-05 workflow — 未注入 recipe 宿主时 fail-closed，不产生假成功', async () => {
  const run = runner.startWorkflowRun({
    source: SOURCE,
    args: { projectId: 'p_1', recipeId: 'box-enclosure' },
    userId: 'u_1',
    deps: {},
    root: root(),
  });
  const result = await run.promise;
  assert.equal(result.status, 'failed');
  assert.match(String(result.error), /recipe_host_unavailable|recipe_dry_run_failed/);
});

const RESUME_SCRIPT = `
export const meta = { name: 'recipe-resume', version: 1, budget: { maxAgents: 1, maxSteps: 6, timeoutMs: 60000 }, concurrency: 1 };
export default async function run(ctx) {
  const dry = await phase('dryRun', async () => recipe(ctx.recipeId, ctx.params, { dryRun: true }));
  const executed = await phase('execute', async () => {
    const outcome = await recipe(ctx.recipeId, ctx.params, { dryRun: false, projectId: ctx.projectId });
    if (budget.cancelled) throw new Error('workflow_cancelled');
    return outcome;
  });
  return { dry: dry && dry.ok, exec: executed && executed.ok };
}
`;

test('NEXT-05 workflow — recipe 取消后 resume 只重跑未完成 phase（前缀复用）', async () => {
  let executeStarted;
  const started = new Promise((resolve) => { executeStarted = resolve; });
  const wfRoot = root();
  const first = runner.startWorkflowRun({
    source: RESUME_SCRIPT,
    args: { projectId: 'p_1', recipeId: 'box-enclosure' },
    userId: 'u_1',
    root: wfRoot,
    deps: {
      recipe: async (payload) => {
        if (payload.dryRun !== false) return { ok: true, recipe: { id: 'x', version: 1 }, marker: 'dry' };
        executeStarted();
        return new Promise((resolve) => {
          payload.signal.addEventListener('abort', () => resolve({ ok: false, error: 'recipe_cancelled' }), { once: true });
        });
      },
    },
  });
  await started;
  await first.cancel();
  const cancelled = await first.promise;
  assert.equal(cancelled.status, 'cancelled');

  const calls = [];
  const second = runner.startWorkflowRun({
    source: RESUME_SCRIPT,
    args: { projectId: 'p_1', recipeId: 'box-enclosure' },
    userId: 'u_1',
    root: wfRoot,
    resumeFromRunId: first.runId,
    deps: {
      recipe: async (payload) => {
        calls.push(payload.dryRun);
        return { ok: true, recipe: { id: 'x', version: 1 }, marker: payload.dryRun === false ? 'execute' : 'dry-should-not-run' };
      },
    },
  });
  const resumed = await second.promise;
  assert.equal(resumed.status, 'completed');
  assert.deepEqual(calls, [false], 'dryRun phase 应复用，只有 execute 重跑');
  assert.equal(resumed.returned.dry, true);
  assert.equal(resumed.returned.exec, true);
});
