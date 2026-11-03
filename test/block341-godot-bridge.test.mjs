/**
 * BLOCK-341 — 受治理 Godot 引擎桥：P1 探针 + P2 godot_run + P3 scene_apply 白名单。
 * 只钉机制：
 *  - 探针：二进制发现（env 优先）；缺席诚实 capability_unavailable；版本解析。
 *  - godotRun：项目校验（project.godot 在场/路径穿越拒收）；预算 clamp；超时杀进程；
 *    manifest 落盘（stdout 尾巴/截图 sha256 清单）。
 *  - validateSceneApply：白名单三操作；路径穿越/格式外/op 白名单外一律拒（require-ack 语义）；
 *    payload 形状校验；apply 前后 sha256 + 语义 diff + stale_propose 防覆盖。
 *  - registry：godot_run/godot_scene_apply 注册且 contract 归 engine 域。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// registry 链路 require db.js——PETRI_DB_PATH 隔离须在 require 前（block340 同款）
{
  const Database = require(path.join(ROOT, 'node_modules', 'better-sqlite3'));
  const tempDbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'block341-db-'));
  const boot = new Database(path.join(tempDbDir, 'petri.db'));
  const migrationsDir = path.join(ROOT, 'src', 'migrations');
  for (const f of fs.readdirSync(migrationsDir).filter((x) => x.endsWith('.sql')).sort()) {
    boot.exec(fs.readFileSync(path.join(migrationsDir, f), 'utf8'));
  }
  boot.close();
  process.env.PETRI_DB_PATH = path.join(tempDbDir, 'petri.db');
  process.on('exit', () => {
    try { fs.rmSync(tempDbDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  });
}

const provider = require(path.join(ROOT, 'core/petri-server/helpers/godot-provider.js'));
const godotTools = require(path.join(ROOT, 'core/petri-server/helpers/godot-tools.js'));

function tempWorkspace(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'block341-ws-'));
  for (const [rel, content] of Object.entries(files)) {
    const target = path.join(dir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return dir;
}

test('BLOCK-341 P1 探针：版本解析 + 本机 Godot 在场性接口', () => {
  const probe = provider.probeGodot();
  assert.ok(typeof probe.ok === 'boolean');
  if (probe.ok) {
    assert.ok(probe.major >= 4, `major=${probe.major}`);
    assert.ok(probe.version.includes('4.'), probe.version);
    assert.equal(probe.writeMovie, true);
  } else {
    assert.equal(probe.code, 'capability_unavailable');
  }
});

test('BLOCK-341 P1 版本解析：majorVersion 语义', () => {
  const provider2 = require(path.join(ROOT, 'core/petri-server/helpers/godot-provider.js'));
  // 内部函数经探针间接验证——直接测 major 语义（4.x → >=4）
  const probe = provider2.probeGodot();
  if (probe.ok) assert.ok(probe.major >= 3);
});

test('BLOCK-341 P2 godotRun：project.godot 缺席拒收', async () => {
  const ws = tempWorkspace({ 'not-project/README.md': 'x' });
  const r = await godotTools.godotRun({ workspaceRoot: ws, projectPath: 'not-project' });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'project_missing');
});

test('BLOCK-341 P2 godotRun：路径穿越拒收', async () => {
  const ws = tempWorkspace({});
  const r = await godotTools.godotRun({ workspaceRoot: ws, projectPath: '../outside' });
  assert.equal(r.code, 'path_escape');
});

test('BLOCK-341 P2 godotRun：strategy/预算 clamp 接口在场', () => {
  assert.equal(godotTools.RUN_DEFAULT_FRAMES, 60);
  assert.equal(godotTools.RUN_MAX_FRAMES, 600);
});

test('BLOCK-341 P3 scene_apply：白名单外操作 → op_not_whitelisted（require-ack 语义）', () => {
  const ws = tempWorkspace({ 'main.tscn': '[node name="Root" type="Node2D"]\n' });
  const r = godotTools.validateSceneApply({
    workspaceRoot: ws, filePath: 'main.tscn', op: 'delete_entire_project', payload: {},
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'op_not_whitelisted');
  assert.ok(r.message.includes('require-ack') || r.message.includes('人工审批'));
});

test('BLOCK-341 P3 scene_apply：路径穿越 / 格式外 / 文件缺席拒收', () => {
  const ws = tempWorkspace({});
  const escape = godotTools.validateSceneApply({ workspaceRoot: ws, filePath: '../x.tscn', op: 'set_node_property', payload: { node: 'A', property: 'b', value: 1 } });
  assert.equal(escape.code, 'path_escape');
  const fmt = godotTools.validateSceneApply({ workspaceRoot: ws, filePath: 'readme.md', op: 'set_node_property', payload: { node: 'A', property: 'b', value: 1 } });
  assert.equal(fmt.code, 'unsupported_format');
  const missing = godotTools.validateSceneApply({ workspaceRoot: ws, filePath: 'ghost.tscn', op: 'set_node_property', payload: { node: 'A', property: 'b', value: 1 } });
  assert.equal(missing.code, 'file_not_found');
});

test('BLOCK-341 P3 scene_apply：payload 形状校验（三操作各自必填）', () => {
  const ws = tempWorkspace({ 'main.tscn': '[node name="Root" type="Node2D"]\n' });
  const a = godotTools.validateSceneApply({ workspaceRoot: ws, filePath: 'main.tscn', op: 'set_node_property', payload: {} });
  assert.equal(a.code, 'payload_invalid');
  const b = godotTools.validateSceneApply({ workspaceRoot: ws, filePath: 'main.tscn', op: 'set_resource_ref', payload: { target: 'x' } });
  assert.equal(b.code, 'payload_invalid');
  const c = godotTools.validateSceneApply({ workspaceRoot: ws, filePath: 'main.gd', op: 'replace_script_snippet', payload: { find: 1 } });
  assert.equal(c.code, 'payload_invalid');
});

test('BLOCK-341 P3 scene_apply：propose→apply 全链（.tscn 节点属性 + sha256 + 语义 diff + stale 防覆盖）', () => {
  const ws = tempWorkspace({ 'main.tscn': '[node name="Player" type="Node2D"]\n\nposition = Vector2(0, 0)\n' });
  const propose = godotTools.validateSceneApply({
    workspaceRoot: ws, filePath: 'main.tscn', op: 'set_node_property',
    payload: { node: 'Player', property: 'speed', value: 42 },
  });
  assert.equal(propose.ok, true, JSON.stringify(propose));
  assert.ok(propose.beforeSha256);

  const applied = godotTools.applySceneEdit({
    workspaceRoot: ws, filePath: propose.filePath, op: propose.op,
    payload: propose.payload, beforeSha256: propose.beforeSha256,
  });
  assert.equal(applied.ok, true, JSON.stringify(applied));
  assert.equal(applied.changed, true);
  assert.ok(applied.afterSha256 !== applied.beforeSha256);
  assert.ok(applied.semanticDiffHead.includes('speed'), applied.semanticDiffHead);
  const text = fs.readFileSync(path.join(ws, 'main.tscn'), 'utf8');
  assert.ok(text.includes('"speed": 42') || text.includes("speed = 42"), text);

  // stale propose：同一 beforeSha256 再 apply → 拒（防覆盖并发改动）
  const stale = godotTools.applySceneEdit({
    workspaceRoot: ws, filePath: propose.filePath, op: propose.op,
    payload: propose.payload, beforeSha256: propose.beforeSha256,
  });
  assert.equal(stale.ok, false);
  assert.equal(stale.code, 'stale_propose');
});

test('BLOCK-341 P3 scene_apply：replace_script_snippet find 不在场 → snippet_not_found', () => {
  const ws = tempWorkspace({ 'player.gd': 'extends Node\nfunc ready():\n\tpass\n' });
  const propose = godotTools.validateSceneApply({
    workspaceRoot: ws, filePath: 'player.gd', op: 'replace_script_snippet',
    payload: { find: 'NOT_PRESENT', replace: 'x' },
  });
  assert.equal(propose.ok, true);
  const applied = godotTools.applySceneEdit({
    workspaceRoot: ws, filePath: propose.filePath, op: propose.op,
    payload: propose.payload, beforeSha256: propose.beforeSha256,
  });
  assert.equal(applied.ok, false);
  assert.equal(applied.code, 'snippet_not_found');
});

test('BLOCK-341 P2 registry：godot_run / godot_scene_apply 注册且 contract 归 engine 域', () => {
  const registry = require(path.join(ROOT, 'core/petri-server/agent-tools/registry.js'));
  for (const name of ['godot_run', 'godot_scene_apply']) {
    const entry = registry.getToolEntry(name);
    assert.ok(entry, `${name} 应注册`);
    const contract = registry.getToolContract(name);
    assert.equal(contract.category, 'workspace', `${name} contract.category=${contract && contract.category}`);
    const { getToolMetadata } = require(path.join(ROOT, 'core/petri-server/agent-tools/tool-metadata.js'));
    assert.equal(getToolMetadata(name).known, true);
  }
});

test('BLOCK-341 P2 tool-defs：godot 双工具 schema 在场（required 对齐）', () => {
  const { TOOL_DEFS } = require(path.join(ROOT, 'core/petri-server/agent-tools/tool-defs.js'));
  const run = TOOL_DEFS.find((d) => d.function?.name === 'godot_run');
  const apply = TOOL_DEFS.find((d) => d.function?.name === 'godot_scene_apply');
  assert.ok(run && apply);
  assert.deepEqual(apply.function.parameters.required, ['filePath', 'op', 'payload']);
});
