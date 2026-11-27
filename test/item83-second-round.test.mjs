/**
 * item83 第二轮返工 HK-01：产物落当前项目工作区 + 3D 双路径 + 生成类 ai_usage 记账。
 * 取证：conv_705d7a21-89a / msg_a810a45b-e62，params.mode='ark'/'local' 却同一 hyper3d_task_failed。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const AGENT_TOOLS = path.join(ROOT, 'core', 'petri-server', 'agent-tools');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'i83r2-'));
const dbPath = path.join(temp, 'petri.db');
process.env.PETRI_DB_PATH = dbPath;
process.env.PETRI_DECISION_CONFIG_PATH = path.join(temp, 'decision.json');
const Database = require_(path.join(ROOT, 'core', 'petri-server', 'node_modules', 'better-sqlite3'));
{
  const boot = new Database(dbPath);
  const migrations = path.join(ROOT, 'src', 'migrations');
  for (const f of fs.readdirSync(migrations).filter((f) => f.endsWith('.sql')).sort()) {
    boot.exec(fs.readFileSync(path.join(migrations, f), 'utf8'));
  }
  boot.close();
}
process.on('exit', () => { try { fs.rmSync(temp, { recursive: true, force: true }); } catch {} });

const { createGenerateHandler, resolveArtifactTarget, verifyGeneratedDescriptor } = require_(path.join(AGENT_TOOLS, 'generate-tools.js'));

function seedPack(root) {
  const pluginsDir = path.join(root, 'plugins', 'fake-plugin');
  fs.mkdirSync(pluginsDir, { recursive: true });
  fs.writeFileSync(path.join(pluginsDir, 'index.js'), `'use strict';
    const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
    module.exports.fakeGenerate = async (input, deps) => {
      fs.mkdirSync(deps.outDir, { recursive: true });
      const p = path.join(deps.outDir, 'artifact.png');
      fs.writeFileSync(p, 'png');
      return { path: p, sha256: crypto.createHash('sha256').update('png').digest('hex'), mime: 'image/png', source: { provider: 'ark', model: 'seedream', kind: 'generate.image' } };
    };`);
  fs.mkdirSync(path.join(root, 'registry'), { recursive: true });
  fs.writeFileSync(path.join(root, 'registry', 'generate-tools.json'), JSON.stringify({
    version: 'create-pack-registry/v1',
    tools: [{ id: 'generate.image', exportName: 'fakeGenerate', credentialProvider: 'ark', entry: 'plugins/fake-plugin/index.js' }],
  }));
}

test('HK-01 产物落当前项目工作区且跨项目隔离', async () => {
  const a = path.join(temp, 'ws-a');
  const b = path.join(temp, 'ws-b');
  fs.mkdirSync(a, { recursive: true });
  fs.mkdirSync(b, { recursive: true });
  const opts = { workspaceRootByProject: { p1: a, p2: b } };
  const ta = resolveArtifactTarget({ projectId: 'p1' }, 'generate.image', opts);
  const tb = resolveArtifactTarget({ projectId: 'p2' }, 'generate.image', opts);
  assert.equal(ta.scope, 'workspace');
  assert.equal(ta.outDir, path.join(a, 'generated', 'image'));
  assert.notEqual(ta.outDir, tb.outDir);
  assert.match(ta.urlFor(path.join(ta.outDir, 'x.png')), /^\/api\/workspaces\/p1\/file\?path=/);
  const descriptor = { path: path.join(b, 'generated', 'image', 'x.png'), url: tb.url };
  assert.throws(() => verifyGeneratedDescriptor(descriptor, ta.outDir, 'image'), /generated_path_out_of_controlled_dir/);

  const packRoot = path.join(temp, 'pack');
  seedPack(packRoot);
  const handler = createGenerateHandler('generate.image', {
    packRoot, apiKey: 'test-key', ...opts, fetch: async () => { throw new Error('unused'); },
  });
  const result = await handler({ prompt: 'x' }, { projectId: 'p1', conversationId: 'c1', taskId: 't1', userId: 'u1' });
  assert.equal(result.scope, 'workspace');
  assert.ok(result.path.startsWith(path.join(a, 'generated', 'image')));
  assert.match(result.url, /^\/api\/workspaces\/p1\/file\?path=/);
});

test('HK-01 3D local 路径不触发 Ark，产出本地近似 SceneSpec', async () => {
  let fetchCalled = false;
  const local = { called: false, result: null };
  const handler = createGenerateHandler('generate.model3d', {
    apiKey: 'test-key',
    workspaceRootByProject: { p1: path.join(temp, 'ws-a') },
    localRecipeRunner: async (args) => {
      local.called = true;
      local.result = args;
      return {
        ok: true,
        scene: { version: 'scene3d/v1', nodes: [] },
        written: { path: 'generated/model3d/local.scene3d.json' },
        source: { provider: 'local', mode: 'parametric-recipe', status: 'approximation', synthetic: true, label: '本地近似非 AI 生成' },
      };
    },
    fetch: async () => { fetchCalled = true; throw new Error('should not fetch'); },
  });
  const result = await handler({ prompt: '招财猫', params: { mode: 'local' } }, { projectId: 'p1' });
  assert.equal(local.called, true);
  assert.equal(fetchCalled, false);
  assert.equal(result.source.provider, 'local');
  assert.match(result.path, /\.scene3d\.json$/);
});

test('HK-01 生成成功必有 ai_usage 行，费用未知如实标注', async () => {
  const packRoot = path.join(temp, 'pack-usage');
  seedPack(packRoot);
  const { createGenerateHandler: make } = require_(path.join(AGENT_TOOLS, 'generate-tools.js'));
  const handler = make('generate.image', {
    packRoot, apiKey: 'test-key', dataDir: path.join(temp, 'data-usage'),
    fetch: async () => { throw new Error('unused'); },
  });
  await handler({ prompt: 'x' }, { projectId: 'p9', conversationId: 'c9', taskId: 't9', userId: 'u9' });
  const db = new Database(dbPath, { readonly: true });
  const rows = db.prepare("SELECT * FROM ai_usage WHERE conversation_id='c9'").all();
  db.close();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, 'generate.image');
  assert.equal(rows[0].cost_status, 'unknown');
  assert.equal(rows[0].cost_cny, null);
  assert.equal(rows[0].task_id, 't9');
  assert.ok(rows[0].latency_ms >= 0);
});

test('HK-01 Ark 失败有稳定 code，错误 message 进事件摘要', () => {
  const plugin = fs.readFileSync(path.join(ROOT, 'resources/built-in-packs/petri-pack-create/plugins/generate-model3d/index.js'), 'utf8');
  assert.match(plugin, /generate_ark_unauthorized/);
  assert.match(plugin, /generate_ark_not_subscribed/);
  const toolEvents = fs.readFileSync(path.join(AGENT_TOOLS, 'tool-events.js'), 'utf8');
  assert.match(toolEvents, /result\.message/);
});
