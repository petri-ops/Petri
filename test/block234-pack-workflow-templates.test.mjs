/**
 * BLOCK-234 — Q-DOMAIN P4-C S2：agent workflow 模板下沉 pack。
 * 钉住装载器边界：启用/停用、路径逃逸、坏形状 fail-closed、多包覆盖稳定，
 * 以及 agent-workflow 的 list/create 确实消费 pack 数据。
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { loadAgentWorkflowTemplates } = require(path.join(ROOT, 'core/shared-backend/pack-workflow-templates.js'));
const agentWorkflow = require(path.join(ROOT, 'core/shared-backend/agent-workflow.js'));

const tempDirs = [];
after(() => {
  for (const dir of tempDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

function makePack(dataDir, packId, templates, extra = {}) {
  const packRoot = path.join(dataDir, packId);
  fs.mkdirSync(packRoot, { recursive: true });
  fs.writeFileSync(path.join(packRoot, 'pack.json'), JSON.stringify({
    packId,
    provides: extra.provides === undefined
      ? { agentWorkflowTemplates: 'workflow-templates.json' }
      : extra.provides,
  }));
  if (templates !== null) {
    fs.writeFileSync(path.join(packRoot, 'workflow-templates.json'), JSON.stringify(templates));
  }
  return { packId, packRoot, enabled: extra.enabled !== false, version: '1.0.0' };
}

function withPacks(packs) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-b234-pack-'));
  tempDirs.push(dataDir);
  fs.mkdirSync(path.join(dataDir, 'packs'), { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'packs', 'installed.json'), JSON.stringify(packs));
  const previous = process.env.PETRI_LOCAL_DATA_DIR;
  process.env.PETRI_LOCAL_DATA_DIR = dataDir;
  return () => {
    if (previous === undefined) delete process.env.PETRI_LOCAL_DATA_DIR;
    else process.env.PETRI_LOCAL_DATA_DIR = previous;
  };
}

function template(id, title = id) {
  return {
    id,
    title,
    description: `${title} description`,
    steps: [
      { id: 'first', toolCandidates: ['tool-a'], dependsOn: [] },
      {
        id: 'second',
        toolCandidates: ['tool-b'],
        dependsOn: ['first'],
        inputBindings: [{ inputId: 'in', fromStepId: 'first', artifactType: 'table' }],
      },
    ],
  };
}

test('启用包的模板被装载；停用包被忽略', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-b234-pack-'));
  tempDirs.push(dataDir);
  const enabled = makePack(dataDir, 'a-enabled', [template('enabled')]);
  const disabled = makePack(dataDir, 'b-disabled', [template('disabled')], { enabled: false });
  const restore = withPacks([enabled, disabled]);
  try {
    const { templates, warnings } = loadAgentWorkflowTemplates();
    assert.deepEqual(templates.map((item) => item.id), ['enabled']);
    assert.deepEqual(warnings, []);
  } finally {
    restore();
  }
});

test('路径逃逸拒绝装载并留 warning', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-b234-pack-'));
  tempDirs.push(dataDir);
  const pack = makePack(dataDir, 'escape', null, { provides: { agentWorkflowTemplates: '../escape.json' } });
  fs.writeFileSync(path.join(dataDir, 'escape.json'), JSON.stringify([template('escaped')]));
  const restore = withPacks([pack]);
  try {
    const { templates, warnings } = loadAgentWorkflowTemplates();
    assert.deepEqual(templates, []);
    assert.ok(warnings.some((warning) => warning.code === 'path_outside_pack'), JSON.stringify(warnings));
  } finally {
    restore();
  }
});

test('坏模板整条跳过，合法模板继续装载；未知依赖 fail-closed', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-b234-pack-'));
  tempDirs.push(dataDir);
  const badMissingSteps = { id: 'bad-missing', title: 'bad', steps: [] };
  const badDependency = {
    id: 'bad-dependency',
    title: 'bad',
    steps: [{ id: 'only', toolCandidates: ['tool-a'], dependsOn: ['missing'] }],
  };
  const pack = makePack(dataDir, 'mixed', [badMissingSteps, template('good'), badDependency]);
  const restore = withPacks([pack]);
  try {
    const { templates, warnings } = loadAgentWorkflowTemplates();
    assert.deepEqual(templates.map((item) => item.id), ['good']);
    assert.ok(warnings.some((warning) => warning.code === 'template_steps_missing'));
    assert.ok(warnings.some((warning) => warning.code === 'step_dependency_invalid'));
  } finally {
    restore();
  }
});

test('多包同 id 覆盖按 packId 稳定后者胜出并留 warning', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-b234-pack-'));
  tempDirs.push(dataDir);
  const a = makePack(dataDir, 'a-pack', [template('same', 'A')]);
  const b = makePack(dataDir, 'b-pack', [template('same', 'B')]);
  const restore = withPacks([b, a]);
  try {
    const { templates, warnings } = loadAgentWorkflowTemplates();
    assert.equal(templates.length, 1);
    assert.equal(templates[0].title, 'B');
    assert.ok(warnings.some((warning) => warning.code === 'template_overridden'));
  } finally {
    restore();
  }
});

test('list/create 消费 pack 模板：可用性投影与计划生成', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-b234-pack-'));
  tempDirs.push(dataDir);
  const pack = makePack(dataDir, 'workflow', [template('solo', 'Solo')]);
  const restore = withPacks([pack]);
  try {
    const partial = agentWorkflow.listAgentWorkflowTemplates(['tool-a']);
    assert.equal(partial.length, 1);
    assert.equal(partial[0].id, 'solo');
    assert.equal(partial[0].stepCount, 2);
    assert.equal(partial[0].supportedStepCount, 1);
    assert.equal(partial[0].available, false);

    const full = agentWorkflow.listAgentWorkflowTemplates(['tool-a', 'tool-b']);
    assert.equal(full[0].available, true);

    const plan = agentWorkflow.createAgentWorkflowPlan({
      templateId: 'solo',
      availableToolIds: ['tool-a', 'tool-b'],
      initialInputs: { file: 'x' },
    });
    assert.equal(plan.steps[0].status, 'ready');
    assert.deepEqual(plan.steps[0].inputs, { file: 'x' });
    assert.equal(plan.steps[1].status, 'waiting_for_artifact');
  } finally {
    restore();
  }
});
