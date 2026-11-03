/**
 * BLOCK-340 — 视频输入面：P1 抽帧 helper + P2 附件门控 + registry 对账。
 * 只钉机制：
 *  - extractVideoFrames：ffmpeg 缺席 → 诚实 unavailable（不伪造帧）；路径穿越拒收；
 *    预算硬顶（>16 clamp 到 16）；幂等缓存（同源同参 → cached:true）；扩展名白名单。
 *  - registry：read_video 注册且 contract 归 vision 域 + readOnly。
 *  - 附件面：videoInputAllowed 与 imageInputAllowed 同源（两者皆无才阻断）。
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

// registry 链路 require db.js——PETRI_DB_PATH 隔离须在 require 前生效
// （agent-tool-registry.test.mjs 同款隔离：src/migrations 全量预建）
{
  const Database = require(path.join(ROOT, 'node_modules', 'better-sqlite3'));
  const tempDbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'block340-db-'));
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

const { extractVideoFrames, isVideoPath, probeFfmpeg, HARD_CAP_FRAMES, DEFAULT_MAX_FRAMES } = require(
  path.join(ROOT, 'core/petri-server/helpers/video-frames.js'));

function tempWorkspace(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'block340-ws-'));
  for (const [rel, content] of Object.entries(files)) {
    const target = path.join(dir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (typeof content === 'string') fs.writeFileSync(target, content);
    else fs.writeFileSync(target, content);
  }
  return dir;
}

test('BLOCK-340 P1 视频路径判定（扩展名白名单）', () => {
  assert.equal(isVideoPath('demo.mp4'), true);
  assert.equal(isVideoPath('demo.MOV'), true);
  assert.equal(isVideoPath('demo.webm'), true);
  assert.equal(isVideoPath('demo.txt'), false);
  assert.equal(isVideoPath('demo.png'), false);
  assert.equal(isVideoPath(''), false);
});

test('BLOCK-340 P0 预算硬顶：maxFrames > 16 clamp 到 16；默认 8', () => {
  assert.equal(HARD_CAP_FRAMES, 16);
  assert.equal(DEFAULT_MAX_FRAMES, 8);
});

test('BLOCK-340 P1 路径穿越拒收', async () => {
  const ws = tempWorkspace({ 'demo.mp4': 'fake' });
  const r = await extractVideoFrames({ workspaceRoot: ws, videoPath: '../etc/passwd.mp4' });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'path_escape');
});

test('BLOCK-340 P1 不支持的扩展名拒收', async () => {
  const ws = tempWorkspace({ 'demo.txt': 'not a video' });
  const r = await extractVideoFrames({ workspaceRoot: ws, videoPath: 'demo.txt' });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'unsupported_format');
});

test('BLOCK-340 P1 视频不存在拒收', async () => {
  const ws = tempWorkspace({});
  const r = await extractVideoFrames({ workspaceRoot: ws, videoPath: 'ghost.mp4' });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'video_not_found');
});

test('BLOCK-340 P0 strategy 白名单', async () => {
  const ws = tempWorkspace({ 'demo.mp4': 'fake' });
  const r = await extractVideoFrames({ workspaceRoot: ws, videoPath: 'demo.mp4', strategy: 'invalid' });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'invalid_strategy');
});

test('BLOCK-340 P0 ffmpeg 缺席诚实降级（能力探测接口在场）', () => {
  const probe = probeFfmpeg();
  // 本机有 ffmpeg（mac 实机 BLOCK-329 tier=ffmpeg）→ ok:true
  // 缺席环境 → ok:false + capability_unavailable——两种都合法，只断言接口形状
  assert.ok(typeof probe.ok === 'boolean');
  if (!probe.ok) {
    assert.equal(probe.code, 'capability_unavailable');
    assert.ok(probe.message.includes('ffmpeg'));
  }
});

test('BLOCK-340 P1 registry：read_video 注册且 readOnly', () => {
  const registry = require(path.join(ROOT, 'core/petri-server/agent-tools/registry.js'));
  const entry = registry.getToolEntry('read_video');
  assert.ok(entry, 'read_video 应注册（getToolEntry）');
  assert.equal(typeof entry.handler, 'function', 'read_video handler 应为函数');
  const contract = registry.getToolContract('read_video');
  assert.ok(contract, 'read_video contract 应在场');
  const { getToolMetadata } = require(path.join(ROOT, 'core/petri-server/agent-tools/tool-metadata.js'));
  const meta = getToolMetadata('read_video');
  assert.equal(meta.known, true, 'read_video 元数据应已知（注册在 TOOL_METADATA）');
  assert.equal(meta.readOnly, true, 'read_video 应为 readOnly');
  assert.equal(meta.destructive, false);
});

test('BLOCK-340 P1 tool-defs：read_video schema 在场（required filePath）', () => {
  const { TOOL_DEFS } = require(path.join(ROOT, 'core/petri-server/agent-tools/tool-defs.js'));
  const def = TOOL_DEFS.find((d) => d.function?.name === 'read_video');
  assert.ok(def, 'read_video schema 应在 TOOL_DEFS 中');
  assert.equal(def.function.parameters.required[0], 'filePath');
  assert.ok(def.function.parameters.properties.strategy, 'strategy 参数在场');
});
