/**
 * BLOCK-329 — 转盘 mp4 外部 ffmpeg 合成回退契约。
 *
 * 钉住四件事：
 * ①**窄触发**：只有「Blender movie 能力缺席 + 序列帧在盘」才代偿；Blender 原生出片、真渲染失败
 *    （movie_render_failed）、用户显式关闭（PETRI_MODEL3D_FFMPEG_FALLBACK=0）都不介入——
 *    代偿错位会把「真失败」伪装成「平台差异」，静默出图=欺骗。
 * ②**真跑 ffmpeg**：用合成 PNG 序列实跑一遍，产物是合法 mp4（ISO-BMFF `ftyp`）且帧清单临时文件被清理。
 * ③**接线位置**：provider 在读 report 之后、登记 outputs 之前补片，并把来源写进 `videoSource`；
 *    失败时 Blender 的原因码 `videoError` 不被覆盖（另记 `ffmpegError`）。
 * ④**单一源**：输出名/fps 来自 Blender 报告与既有常量，JS 侧不另立一份帧率或文件名真相。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const turntable = require(resolve(root, 'core/petri-server/helpers/ffmpeg-turntable.js'));

const read = (relative) => fs.readFileSync(resolve(root, relative), 'utf8');
const hasFfmpeg = Boolean(turntable.findFfmpegBinary());

// —— 最小合法 PNG 生成（只为本测造 2 张尺寸相同、像素不同的帧；不引第三方图像库）——
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function png(size, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolor
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (size * 3 + 1);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < size; x += 1) {
      const offset = rowStart + 1 + x * 3;
      raw[offset] = rgb[0];
      raw[offset + 1] = rgb[1];
      raw[offset + 2] = rgb[2];
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function withFallbackEnv(value, fn) {
  const previous = process.env.PETRI_MODEL3D_FFMPEG_FALLBACK;
  if (value === undefined) delete process.env.PETRI_MODEL3D_FFMPEG_FALLBACK;
  else process.env.PETRI_MODEL3D_FFMPEG_FALLBACK = value;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.PETRI_MODEL3D_FFMPEG_FALLBACK;
    else process.env.PETRI_MODEL3D_FFMPEG_FALLBACK = previous;
  }
}

test('BLOCK-329 — shouldFallback 只认「能力缺席 + 帧在盘」这一种情况', () => {
  const stills = ['/tmp/turntable-frame-001.png', '/tmp/turntable-frame-002.png'];
  const absentCapability = { requested: 8, frames: 8, stills, video: null, movieCapability: 'unavailable', videoError: 'movie_format_unavailable' };

  assert.equal(turntable.shouldFallback(absentCapability), true, 'macOS 5.2.3 实测形态：缺席 + 8 帧在盘');

  assert.equal(turntable.shouldFallback({ ...absentCapability, video: '/x/turntable.mp4' }), false,
    'Blender 原生已出片：本模块永不介入');
  assert.equal(turntable.shouldFallback({ ...absentCapability, movieCapability: 'unknown', videoError: 'movie_render_failed' }), false,
    '真渲染失败不代偿（代偿会把失败伪装成平台差异）');
  assert.equal(turntable.shouldFallback({ ...absentCapability, movieCapability: 'available' }), false,
    '能力可用却没出片=执行异常，不是能力缺席');
  assert.equal(turntable.shouldFallback({ ...absentCapability, stills: [] }), false,
    '没有帧就没有可合成的素材');
  assert.equal(turntable.shouldFallback({ ...absentCapability, stills: undefined }), false);
  assert.equal(turntable.shouldFallback(null), false);
  assert.equal(turntable.shouldFallback(undefined), false);
  assert.equal(turntable.shouldFallback({ requested: 0, stills: [], movieCapability: null }), false,
    '未请求转盘的场景零介入');

  withFallbackEnv('0', () => {
    assert.equal(turntable.shouldFallback(absentCapability), false, 'PETRI_MODEL3D_FFMPEG_FALLBACK=0 可关');
  });
  withFallbackEnv(undefined, () => {
    assert.equal(turntable.shouldFallback(absentCapability), true, '默认开（用户 2026-11-02 裁决允许外部 ffmpeg）');
  });
});

test('BLOCK-329 — composeTurntable 用真实 ffmpeg 把帧序列合成合法 mp4', { skip: hasFfmpeg ? false : '本机无 ffmpeg' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-b329-compose-'));
  try {
    const stills = [
      path.join(dir, 'turntable-frame-001.png'),
      path.join(dir, 'turntable-frame-002.png'),
      path.join(dir, 'turntable-frame-003.png'),
    ];
    fs.writeFileSync(stills[0], png(16, [200, 40, 40]));
    fs.writeFileSync(stills[1], png(16, [40, 200, 40]));
    fs.writeFileSync(stills[2], png(16, [40, 40, 200]));

    const result = await turntable.composeTurntable({ outDir: dir, stills, fps: 12 });
    assert.equal(result.ok, true, JSON.stringify(result).slice(0, 400));
    assert.equal(result.videoSource, 'ffmpeg', '来源必须留痕，面板/成果面才能区分是谁出的片');
    assert.equal(result.video, path.join(dir, 'turntable.mp4'), '输出名与 Blender 原生同名（turntable.mp4）');
    assert.ok(fs.existsSync(result.video));
    const bytes = fs.readFileSync(result.video);
    assert.equal(bytes.subarray(4, 8).toString('ascii'), 'ftyp', '必须是 ISO-BMFF，不是改名 PNG');
    assert.ok(bytes.length > 500, `产物过小=${bytes.length}`);
    assert.equal(fs.existsSync(path.join(dir, 'turntable-frames.txt')), false, '临时帧清单必须清理');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('BLOCK-329 — composeTurntable 无可用帧时如实失败，不产出空壳 mp4', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-b329-empty-'));
  try {
    assert.equal((await turntable.composeTurntable({ outDir: dir, stills: [] })).error, 'no_stills');
    assert.equal((await turntable.composeTurntable({
      outDir: dir,
      stills: [path.join(dir, 'gone-001.png')],
    })).error, 'no_stills', '登记了但盘上不存在 = 无素材');
    assert.equal(fs.existsSync(path.join(dir, 'turntable.mp4')), false, '失败不得留半成品');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('BLOCK-329 — provider 接线位置：读 report 后补片、登记 outputs 前完成、失败不覆盖 Blender 原因', () => {
  const provider = read('core/petri-server/helpers/blender-provider.js');

  assert.match(provider, /require\('\.\/ffmpeg-turntable'\)/, '回退能力走独立 helper，不塞回 provider');
  assert.match(provider, /const report = JSON\.parse\(fs\.readFileSync\(reportPath, 'utf8'\)\);\s*\n\s*await applyTurntableVideoFallback/,
    '必须在拿到 report 之后立刻补片——outputs 的 describe 在下面，晚一步 mp4 就登记不到');
  assert.match(provider, /async function applyTurntableVideoFallback\(\{ report, outDir, signal \}\)/);
  assert.match(provider, /if \(!shouldFallback\(turntable\)\)/);
  assert.match(provider, /composeTurntable\(\{ outDir, stills: turntable\.stills, fps: turntable\.fps, signal \}\)/,
    'outDir/fps 直接取 Blender 报告与 outDir，不另立 JS 侧真相');
  assert.match(provider, /turntable\.videoSource = composed\.videoSource/);
  assert.match(provider, /turntable\.blenderVideoError = turntable\.videoError/, '本机 Blender 不出片的事实要留痕');
  assert.match(provider, /turntable\.videoError = null/);
  assert.match(provider, /turntable\.ffmpegError = composed\.error/);
  assert.doesNotMatch(provider, /report\.turntable\.videoError\s*=\s*composed/, '失败路径不得把 Blender 原因码改写成 ffmpeg 的');

  // ④ 单一源：帧率/文件名不在 JS 另写一份
  assert.doesNotMatch(provider, /fps:\s*12\b/, 'fps 取报告，不硬编码');
  const python = read('resources/model3d/blender_scene.py');
  const stem = python.match(/TURNTABLE_VIDEO_STEM = '([^']+)'/)?.[1];
  assert.ok(stem, 'python 侧视频 stem 常量仍在');
  const helper = read('core/petri-server/helpers/ffmpeg-turntable.js');
  assert.match(helper, new RegExp(`stem = '${stem}'`), `合成输出名必须与 Blender 原生 stem 同名（${stem}.mp4）`);
});
