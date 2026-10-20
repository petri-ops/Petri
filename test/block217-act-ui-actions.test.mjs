// ============================================================
// BLOCK-217 — act v2：核心去域 + pack ui_action 动态契约/执行/ack。
// 红绿先行：pack 在位 → 动作进入 act 描述并可执行；缺失/停用 → 动作消失；
// 未注册/无 surface/payload 过大 → fail-closed；执行只认 pack view surface。
// ============================================================
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'block217-act-ui-'));
const dataDir = path.join(tempRoot, 'data');
const packRoot = path.join(tempRoot, 'pack');
fs.mkdirSync(path.join(packRoot, 'ui'), { recursive: true });
fs.mkdirSync(path.join(packRoot, 'plugins'), { recursive: true });
fs.writeFileSync(path.join(packRoot, 'ui', 'lab.html'), '<!doctype html><title>lab</title>');
fs.writeFileSync(path.join(packRoot, 'plugins', 'installed.json'), '[]');

const Database = require('better-sqlite3');
const db = new Database(path.join(tempRoot, 'petri.db'));
for (const file of fs.readdirSync(path.join(root, 'src', 'migrations')).filter((f) => f.endsWith('.sql')).sort()) {
  db.exec(fs.readFileSync(path.join(root, 'src', 'migrations', file), 'utf8'));
}
db.close();
process.env.PETRI_DB_PATH = path.join(tempRoot, 'petri.db');
process.env.PETRI_LOCAL_DATA_DIR = dataDir;
// act-tools 依赖 agent_audit/copilot_settings；生产由 helpers/act-tool 幂等建表。
require('../core/petri-server/helpers/act-tool.js');

const packRegistry = require('../core/shared-backend/pack-registry.js');
const actTools = require('../core/petri-server/agent-tools/act-tools.js');
const browserDefs = require('../core/petri-server/agent-tools/tool-defs/browser.js');
const { getProviderToolDefs } = require('../core/petri-server/agent-tools/registry.js');
const { buildToolResultEvent } = require('../core/petri-server/agent-tools/tool-events.js');

function writePack({ enabled = true, actionSurface = 'lab' } = {}) {
  fs.writeFileSync(path.join(packRoot, 'pack.json'), JSON.stringify({
    packId: 'pack_fixture',
    name: 'Fixture Pack',
    version: '0.1.0',
    provides: {
      views: [{ id: 'lab', title: '实验台', entry: 'ui/lab.html' }],
      uiActions: [{ id: 'ping', label: 'Ping', surfaceId: actionSurface }],
    },
  }));
  packRegistry.writeInstalledPacks(dataDir, [{
    packId: 'pack_fixture',
    packRoot,
    version: '0.1.0',
    enabled,
    installedAt: new Date().toISOString(),
  }]);
}

function actDef() {
  return browserDefs.find((def) => def.function && def.function.name === 'act');
}

async function waitForPendingAck(timeoutMs = 1000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const token = [...actTools._pendingActAcks.keys()][0];
    if (token) return token;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error('pending ack token not registered');
}

test('BLOCK-217 act v2: core enum only domain-neutral actions', () => {
  const enums = actDef().function.parameters.properties.type.enum;
  assert.deepEqual(enums, [
    'rename_project', 'rename_dataset', 'rename_analysis',
    'update_analysis_params', 'open_tool', 'ui_action',
  ]);
  assert.equal(enums.includes('switch_result_tab'), false);
  assert.equal(enums.includes('update_figcode_editor'), false);
});

test('BLOCK-217 act v2: installed pack actions appear in provider description', () => {
  writePack();
  const def = getProviderToolDefs().find((item) => item.function && item.function.name === 'act');
  assert.match(def.function.description, /pack:pack_fixture:action:ping/);
  assert.match(def.function.description, /Ping/);
});

test('BLOCK-217 act v2: disabled/absent pack hides all actions (fail-closed)', async () => {
  writePack({ enabled: false });
  const def = getProviderToolDefs().find((item) => item.function && item.function.name === 'act');
  assert.doesNotMatch(def.function.description, /pack:pack_fixture:action:ping/);
  const result = await actTools.tool_act(
    { type: 'ui_action', actionId: 'pack:pack_fixture:action:ping' },
    { userId: 'local' }
  );
  assert.equal(result.error, 'unknown_ui_action');
  assert.deepEqual(result.available, []);
});

test('BLOCK-217 act v2: unknown action lists available actions and never waits for ack', async () => {
  writePack();
  const result = await actTools.tool_act(
    { type: 'ui_action', actionId: 'pack:pack_fixture:action:missing' },
    { userId: 'local' }
  );
  assert.equal(result.error, 'unknown_ui_action');
  assert.ok(result.available.includes('pack:pack_fixture:action:ping'));
});

test('BLOCK-217 act v2: action pointing at a missing view is rejected', async () => {
  writePack({ actionSurface: 'missing-view' });
  const result = await actTools.tool_act(
    { type: 'ui_action', actionId: 'pack:pack_fixture:action:ping' },
    { userId: 'local' }
  );
  assert.equal(result.error, 'ui_action_surface_unavailable');
});

test('BLOCK-217 act v2: valid pack action returns routing payload and waits for ack', async () => {
  writePack();
  const pending = actTools.tool_act(
    { type: 'ui_action', actionId: 'pack:pack_fixture:action:ping', payload: { cluster: '5' } },
    { userId: 'local' }
  );
  const token = await waitForPendingAck();
  assert.equal(actTools._ackActToken(token, { ok: true, info: { message: 'iframe done' } }), true);
  const result = await pending;
  assert.equal(result.ok, true);
  assert.equal(result.type, 'ui_action');
  assert.equal(result.uiAction.actionId, 'pack:pack_fixture:action:ping');
  assert.equal(result.uiAction.surfaceId, 'pack:pack_fixture:lab');
  assert.deepEqual(result.uiAction.payload, { cluster: '5' });
  assert.match(result.ackToken, /^ack_/);
  assert.ok(result.ackExpiresAt > Date.now());
  // 直接调用 tool_act 时 _ackPromise 由 loop-orchestrator 消费/删除；此处只断言返回路由载荷。
  assert.equal(result._payloadBytes, undefined, 'internal payload size must not leak');
});

test('BLOCK-217 act v2: tool_result projects uiAction/ackExpiresAt without legacy sc fields', () => {
  const evt = buildToolResultEvent({
    tool: 'act',
    callId: 'call_1',
    status: 'success',
    data: {
      ok: true,
      type: 'ui_action',
      uiAction: {
        actionId: 'pack:pack_fixture:action:ping',
        label: 'Ping',
        surfaceId: 'pack:pack_fixture:lab',
        packId: 'pack_fixture',
        payload: { cluster: '5' },
      },
      ackToken: 'ack_1',
      ackExpiresAt: 123456,
    },
  }, { type: 'ui_action' }, { iteration: 2 });
  assert.equal(evt.uiAction.actionId, 'pack:pack_fixture:action:ping');
  assert.equal(evt.ackToken, 'ack_1');
  assert.equal(evt.ackExpiresAt, 123456);
  assert.equal(evt.actType, 'ui_action');
  assert.equal(evt.scTab, undefined);
});

test('BLOCK-217 act v2: oversized payload is rejected before dispatch', async () => {
  writePack();
  const result = await actTools.tool_act(
    {
      type: 'ui_action',
      actionId: 'pack:pack_fixture:action:ping',
      payload: { blob: 'x'.repeat(9 * 1024) },
    },
    { userId: 'local' }
  );
  assert.equal(result.error, 'ui_action_payload_too_large');
});

test('BLOCK-217 act v2: retired action types are rejected', async () => {
  const result = await actTools.tool_act({ type: 'focus_cluster', cluster: '5' }, { userId: 'local' });
  assert.equal(result.error, 'unknown_act');
});

test.after(() => {
  try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch { /* Windows handles */ }
});
