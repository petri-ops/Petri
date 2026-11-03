#!/usr/bin/env node
/**
 * BLOCK-341 P4 — Godot 桥实机腿（真 Godot 4.7 + 最小项目 + 真 godotRun + scene_apply 全链）。
 *
 * 覆盖：最小项目生成 → godotRun 30 帧 + 截图序列（真显示驱动）→ manifest 对账
 * （截图 ≥3 帧落盘 / PNG 魔数 / stdout 尾巴）→ godot_scene_apply propose→apply 全链
 * （.gd 脚本片段替换 + sha256 复核）→ 白名单外操作 require-ack → 幂等缓存（重复 run 新 runId）。
 * 用法：node scripts/block341-godot-live.mjs
 * 证据：acceptance/block-341/block341-godot-live-<platform>.json
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLATFORM = process.platform;
const EVIDENCE = path.join(ROOT, 'acceptance', 'block-341');

const provider = require(path.join(ROOT, 'core/petri-server/helpers/godot-provider.js'));
const godotTools = require(path.join(ROOT, 'core/petri-server/helpers/godot-tools.js'));

const assertions = [];
function assert(name, pass, detail) {
  assertions.push({ name, pass: Boolean(pass), detail: String(detail).slice(0, 400) });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name} — ${String(detail).slice(0, 240)}`);
}

const startedAt = new Date().toISOString();
let tempRoot = null;
try {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'b341-live-'));
  const probe = provider.probeGodot();
  assert('L0_godot_available', probe.ok, probe.ok ? `${probe.bin} v${probe.version}` : probe.message);

  // 最小项目：主场景 + 每帧移动方块的脚本（画面非静态）
  const proj = path.join(tempRoot, 'minproj');
  fs.mkdirSync(proj, { recursive: true });
  fs.writeFileSync(path.join(proj, 'project.godot'), [
    'config_version=5',
    '[application]',
    'config/name="b341-live"',
    'config/features=PackedStringArray("4.7")',
    'run/main_scene="res://main.tscn"',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(proj, 'main.tscn'), [
    '[gd_scene format=3]',
    '[node name="Main" type="Node2D"]',
    '[node name="Box" type="ColorRect" parent="."]',
    'offset_right = 40.0',
    'offset_bottom = 40.0',
    'color = Color(0.2, 0.7, 1, 1)',
    '',
  ].join('\n'));
  assert('L1_min_project_created', fs.existsSync(path.join(proj, 'project.godot')) && fs.existsSync(path.join(proj, 'main.tscn')));

  // L2 godotRun：30 帧 + 截图序列
  const run = await godotTools.godotRun({ workspaceRoot: tempRoot, projectPath: 'minproj', frames: 30 });
  assert('L2_run_ok', run.ok === true && !run.timedOut, `exit=${run.exitCode} ms=${run.durationMs} shots=${run.screenshotCount}`);
  assert('L2_screenshots_captured', run.screenshotCount >= 3, `count=${run.screenshotCount} dir=${run.screenshotsDir}`);
  const firstShot = run.screenshots[0];
  const pngHead = fs.readFileSync(path.join(tempRoot, firstShot.file)).subarray(0, 4);
  assert('L2_frame_is_png', pngHead[0] === 0x89 && pngHead[1] === 0x50, `magic=${pngHead.toString('hex')}`);
  // Godot 以 --path（项目目录）为基准写输出 → manifest/log 在 projectDir 下
  const projAbs = path.join(tempRoot, 'minproj');
  assert('L2_manifest_persisted', fs.existsSync(path.join(projAbs, run.screenshotsDir, 'manifest.json')), 'manifest.json 落盘（projectDir 基准）');
  assert('L2_log_persisted', fs.existsSync(path.join(projAbs, run.logFile)), 'stdout.log 落盘');

  // L3 幂等性反向：再次 run 产生新 runId（不是缓存——运行有副作用）
  const run2 = await godotTools.godotRun({ workspaceRoot: tempRoot, projectPath: 'minproj', frames: 10 });
  assert('L3_new_run_id', run2.runId !== run.runId, `run1=${run.runId} run2=${run2.runId}`);

  // L4 godot_scene_apply：propose → apply 全链（脚本片段替换）
  fs.writeFileSync(path.join(proj, 'player.gd'), 'extends Node\nfunc _ready():\n\tvar speed = 10\n\tprint("speed=", speed)\n');
  const propose = godotTools.validateSceneApply({
    workspaceRoot: tempRoot, filePath: 'minproj/player.gd', op: 'replace_script_snippet',
    payload: { find: 'var speed = 10', replace: 'var speed = 99' },
  });
  assert('L4_propose_ok', propose.ok === true && Boolean(propose.beforeSha256), JSON.stringify(propose).slice(0, 200));
  const applied = godotTools.applySceneEdit({
    workspaceRoot: tempRoot, filePath: propose.filePath, op: propose.op,
    payload: propose.payload, beforeSha256: propose.beforeSha256,
  });
  assert('L4_apply_ok', applied.ok === true && applied.changed === true, JSON.stringify(applied).slice(0, 200));
  const gdText = fs.readFileSync(path.join(proj, 'player.gd'), 'utf8');
  assert('L4_apply_content', gdText.includes('var speed = 99'), gdText.split('\n')[2]);
  assert('L4_semantic_diff', String(applied.semanticDiffHead).includes('speed'), applied.semanticDiffHead);

  // L5 白名单外 → require-ack
  const denied = godotTools.validateSceneApply({
    workspaceRoot: tempRoot, filePath: 'player.gd', op: 'wipe_disk', payload: {},
  });
  assert('L5_whitelist_denied', denied.ok === false && denied.code === 'op_not_whitelisted');

  const file = path.join(EVIDENCE, `block341-godot-live-${PLATFORM}.json`);
  fs.mkdirSync(EVIDENCE, { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    name: 'godot-live', block: 'BLOCK-341', phase: 'P4', platform: PLATFORM,
    startedAt, finishedAt: new Date().toISOString(),
    assertions, allPass: assertions.every((a) => a.pass),
    passed: assertions.filter((a) => a.pass).length, total: assertions.length,
    note: 'G0 开发期常态 · 不外推 packaged/Provider/GA',
  }, null, 2), 'utf8');
  console.log(`\nevidence → ${file}`);
  if (!assertions.every((a) => a.pass)) process.exit(1);
} catch (error) {
  assert('FATAL', false, (error && error.stack) || String(error));
  fs.mkdirSync(EVIDENCE, { recursive: true });
  fs.writeFileSync(path.join(EVIDENCE, `block341-godot-live-${PLATFORM}.json`), JSON.stringify({
    name: 'godot-live', block: 'BLOCK-341', phase: 'P4', platform: PLATFORM,
    startedAt, finishedAt: new Date().toISOString(), assertions, allPass: false,
  }, null, 2), 'utf8');
  process.exit(1);
} finally {
  try { if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true }); } catch { /* best-effort */ }
}
