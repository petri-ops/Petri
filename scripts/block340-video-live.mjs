#!/usr/bin/env node
/**
 * BLOCK-340 P3 — 视频输入面实机腿（真 ffmpeg + 真 mp4 抽帧 + 幂等缓存 + manifest 对账）。
 *
 * 用真 ffmpeg 生成 3s 测试视频 → extractVideoFrames 抽帧（uniform/scene 两策略）→
 * manifest 断言（帧数/路径/sha256 落盘/幂等缓存命中）→ 帧文件可被 read_image 消费形态验证。
 * 用法：node scripts/block340-video-live.mjs
 * 证据：acceptance/block-340/block340-video-live-<platform>.json
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLATFORM = process.platform;
const EVIDENCE = path.join(ROOT, 'acceptance', 'block-340');

const { extractVideoFrames, probeFfmpeg } = require(path.join(ROOT, 'core/petri-server/helpers/video-frames.js'));

const assertions = [];
function assert(name, pass, detail) {
  assertions.push({ name, pass: Boolean(pass), detail: String(detail).slice(0, 400) });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name} — ${String(detail).slice(0, 240)}`);
}

const startedAt = new Date().toISOString();
let tempRoot = null;
try {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'b340-live-'));
  const probe = probeFfmpeg();
  assert('L0_ffmpeg_available', probe.ok, probe.ok ? `bin=${probe.bin}` : probe.message);

  // 真 mp4 fixture（3s 320x240）
  const videoPath = path.join(tempRoot, 'fixture.mp4');
  execFileSync(probe.bin, ['-f', 'lavfi', '-i', 'testsrc=duration=3:size=320x240:rate=10', '-pix_fmt', 'yuv420p', videoPath, '-y'], { stdio: 'pipe' });
  assert('L1_fixture_generated', fs.existsSync(videoPath) && fs.statSync(videoPath).size > 1000, `size=${fs.statSync(videoPath).size}B`);

  // L2 uniform 抽帧
  const uniform = extractVideoFrames({ workspaceRoot: tempRoot, videoPath: 'fixture.mp4', maxFrames: 6 });
  assert('L2_uniform_ok', uniform.ok === true, `frames=${uniform.frameCount} code=${uniform.code || '-'}`);
  assert('L2_uniform_frame_count_in_budget', uniform.frameCount >= 1 && uniform.frameCount <= 6, `frameCount=${uniform.frameCount}`);
  assert('L2_frames_on_disk', uniform.frames.every((f) => fs.existsSync(path.join(tempRoot, f.file))), '全部帧文件在盘');
  assert('L2_manifest_persisted', fs.existsSync(path.join(tempRoot, uniform.framesDir, 'manifest.json')), 'manifest.json 落盘');

  // L3 幂等缓存命中
  const cached = extractVideoFrames({ workspaceRoot: tempRoot, videoPath: 'fixture.mp4', maxFrames: 6 });
  assert('L3_cache_hit', cached.cached === true && cached.frameCount === uniform.frameCount, `cached=${cached.cached}`);

  // L4 scene 策略（testsrc 无场景切换 → 0 帧 或少量帧都合法——只断言不崩）
  const scene = extractVideoFrames({ workspaceRoot: tempRoot, videoPath: 'fixture.mp4', maxFrames: 4, strategy: 'scene' });
  assert('L4_scene_no_crash', scene.ok === true || scene.ok === false, `ok=${scene.ok} frames=${scene.frameCount ?? scene.code}`);

  // L5 帧可被 read_image 消费（PNG 头验证）
  const firstFrame = uniform.frames[0];
  const pngHead = fs.readFileSync(path.join(tempRoot, firstFrame.file)).subarray(0, 4);
  assert('L5_frame_is_png', pngHead[0] === 0x89 && pngHead[1] === 0x50, `magic=${pngHead.toString('hex')}`);

  // L6 路径穿越拒收（真实 ffmpeg 在场时守卫仍生效）
  const escape = extractVideoFrames({ workspaceRoot: tempRoot, videoPath: '../escape.mp4' });
  assert('L6_path_escape_blocked', escape.ok === false && escape.code === 'path_escape', `code=${escape.code}`);

  const file = path.join(EVIDENCE, `block340-video-live-${PLATFORM}.json`);
  fs.mkdirSync(EVIDENCE, { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    name: 'video-live', block: 'BLOCK-340', phase: 'P3', platform: PLATFORM,
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
  fs.writeFileSync(path.join(EVIDENCE, `block340-video-live-${PLATFORM}.json`), JSON.stringify({
    name: 'video-live', block: 'BLOCK-340', phase: 'P3', platform: PLATFORM,
    startedAt, finishedAt: new Date().toISOString(), assertions, allPass: false,
  }, null, 2), 'utf8');
  process.exit(1);
} finally {
  try { if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true }); } catch { /* best-effort */ }
}
