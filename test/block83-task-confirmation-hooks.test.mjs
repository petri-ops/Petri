import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hooks = require('../core/shared-backend/task-confirmation-hooks');
const { createScientificTaskConfirmationHook } = require('../core/shared-backend/scientific-task-confirmation');

const PAYLOAD = { persistedTask: { status: 'confirmed' }, projectId: 'p1', toolId: 't1', params: {} };

test('BLOCK-83 D3 zero registered hooks means zero-confirmation pass-through', () => {
  hooks.__resetTaskConfirmationHooksForTest();
  assert.deepEqual(hooks.listTaskConfirmationHooks(), []);
  assert.deepEqual(hooks.runTaskConfirmationHooks(PAYLOAD), { ok: true });
});

test('BLOCK-83 D3 registered hook veto propagates its error and first veto wins', () => {
  hooks.__resetTaskConfirmationHooksForTest();
  let secondConsulted = false;
  hooks.registerTaskConfirmationHook({
    id: 'veto-hook',
    validateTaskExecution: () => ({ ok: false, error: 'domain_gate_vetoed' }),
  });
  hooks.registerTaskConfirmationHook({
    id: 'second-hook',
    validateTaskExecution: () => { secondConsulted = true; return { ok: true }; },
  });
  const gate = hooks.runTaskConfirmationHooks(PAYLOAD);
  assert.equal(gate.ok, false);
  assert.equal(gate.error, 'domain_gate_vetoed');
  assert.equal(gate.hookId, 'veto-hook');
  assert.equal(secondConsulted, false);

  assert.equal(hooks.unregisterTaskConfirmationHook('veto-hook'), true);
  assert.equal(hooks.runTaskConfirmationHooks(PAYLOAD).ok, true);
  hooks.__resetTaskConfirmationHooksForTest();
});

test('BLOCK-83 D3 hook throwing is fail-closed with the thrown message', () => {
  hooks.__resetTaskConfirmationHooksForTest();
  hooks.registerTaskConfirmationHook({
    id: 'throwing-hook',
    validateTaskExecution: () => { throw new Error('hook exploded'); },
  });
  const gate = hooks.runTaskConfirmationHooks(PAYLOAD);
  assert.equal(gate.ok, false);
  assert.equal(gate.error, 'hook exploded');
  hooks.__resetTaskConfirmationHooksForTest();
});

test('BLOCK-83 D3 hook shape is validated at registration', () => {
  hooks.__resetTaskConfirmationHooksForTest();
  assert.throws(() => hooks.registerTaskConfirmationHook(null), /task_confirmation_hook_required/);
  assert.throws(() => hooks.registerTaskConfirmationHook({ id: '' }), /task_confirmation_hook_id_required/);
  assert.throws(() => hooks.registerTaskConfirmationHook({ id: 'x' }), /task_confirmation_hook_validate_required/);
});

test('BLOCK-83 D3 scientific confirmation joins the registry only through its factory', () => {
  hooks.__resetTaskConfirmationHooksForTest();
  const hook = createScientificTaskConfirmationHook();
  assert.equal(hook.id, 'scientific-task-confirmation');
  assert.equal(typeof hook.validateTaskExecution, 'function');
  // 未确认任务 → 原契约理由码经注册表原样传播。
  hooks.registerTaskConfirmationHook(hook);
  const gate = hooks.runTaskConfirmationHooks({ persistedTask: { status: 'draft' }, projectId: 'p1', toolId: 't1', params: {} });
  assert.equal(gate.ok, false);
  assert.equal(gate.error, 'scientific_task_not_confirmed');
  assert.equal(gate.hookId, 'scientific-task-confirmation');
  hooks.__resetTaskConfirmationHooksForTest();
});

test('BLOCK-83 D3 plugin-loader bridge registers the scientific hook for RS plugins (interim composition)', () => {
  hooks.__resetTaskConfirmationHooksForTest();
  const { normalizePluginManifest } = require('../core/petri-server/plugin-loader');
  const pluginDir = path.join(root, 'test/fixtures/neutral-plugins/sample-metrics');
  const plugin = { ...JSON.parse(fs.readFileSync(path.join(pluginDir, 'plugin.json'))), pluginDir };
  const toolDefinition = JSON.parse(fs.readFileSync(path.join(pluginDir, 'tool-definition.json')));
  const manifest = normalizePluginManifest(plugin, toolDefinition);
  assert.equal(manifest.resultStudioValidation.valid, true);
  assert.ok(hooks.listTaskConfirmationHooks().includes('scientific-task-confirmation'));
});

test('BLOCK-83 D3 source gate: generic layers must not require the domain contract directly', () => {
  const dbSource = fs.readFileSync(path.join(root, 'core/petri-server/db.js'), 'utf8');
  const learningSource = fs.readFileSync(path.join(root, 'core/petri-server/agent-tools/learning.js'), 'utf8');
  const loaderSource = fs.readFileSync(path.join(root, 'core/petri-server/plugin-loader.js'), 'utf8');
  assert.ok(!dbSource.includes("require('../shared-backend/scientific-task-confirmation')"), 'db.js must go through the hook registry');
  assert.ok(!learningSource.includes("require('../../shared-backend/scientific-task-confirmation')"), 'learning.js must go through the hook registry');
  assert.ok(dbSource.includes('runTaskConfirmationHooks'));
  assert.ok(learningSource.includes('runTaskConfirmationHooks'));
  // 过渡装配只允许存在于 plugin-loader（P3/P4 随生信包迁出）。
  assert.ok(loaderSource.includes('ensureScientificTaskConfirmationHookRegistered'));
});
