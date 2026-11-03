'use strict';

/**
 * helpers/video-frames.js — BLOCK-340 P1 视频抽帧 helper（read_video 工具与聊天附件共用）。
 *
 * 复用 BLOCK-329 ffmpeg 二进制发现模式（findFfmpegBinary，零新依赖）；缺席诚实降级。
 * 抽帧策略：均匀步长（默认）或场景变化阈值（ffmpeg scene 滤镜）。
 * 帧落项目 `.petri/frames/<sha256>/` + manifest（源 sha256 / 帧清单 / 参数 / 时长）。
 * 帧数预算：默认 ≤8、硬顶 ≤16（plan P0——入 model-surface 计量基线）。
 * 抽帧不改工作区源文件（readOnly）。
 */

const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { findFfmpegBinary } = require('./ffmpeg-turntable');

const DEFAULT_MAX_FRAMES = 8;
const HARD_CAP_FRAMES = 16;
const VIDEO_EXT_RE = /\.(mp4|mov|webm|mkv|avi)$/i;
const FRAME_FORMAT = 'png';

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/** 视频扩展名判定（P2 附件面同源）。 */
function isVideoPath(filePath) {
  return VIDEO_EXT_RE.test(String(filePath || ''));
}

/** ffmpeg 能力探测（复用 329 模式；缺席 → 诚实 unavailable）。 */
function probeFfmpeg() {
  const bin = findFfmpegBinary();
  if (!bin) return { ok: false, code: 'capability_unavailable', message: 'ffmpeg 未安装或不在 PATH 中——视频抽帧诚实不可用（用户自装后复测）' };
  return { ok: true, bin };
}

/**
 * 抽帧主入口。
 * @param {{workspaceRoot: string, videoPath: string, maxFrames?: number,
 *   strategy?: 'uniform'|'scene'}} options
 * @returns {Promise<object>} manifest（frames / sourceSha256 / durationSec / params）或 { ok: false, code, message }
 */
function extractVideoFrames({ workspaceRoot, videoPath, maxFrames, strategy = 'uniform' }) {
  const probe = probeFfmpeg();
  if (!probe.ok) return probe;

  const cap = Math.min(Math.max(1, Number(maxFrames) || DEFAULT_MAX_FRAMES), HARD_CAP_FRAMES);
  if (!['uniform', 'scene'].includes(strategy)) return { ok: false, code: 'invalid_strategy', message: `strategy 须为 uniform | scene，收到 ${strategy}` };

  const resolved = path.resolve(workspaceRoot, videoPath);
  if (!resolved.startsWith(path.resolve(workspaceRoot) + path.sep) && resolved !== path.resolve(workspaceRoot)) {
    return { ok: false, code: 'path_escape', message: '视频路径必须在工作区内' };
  }
  if (!isVideoPath(resolved)) {
    return { ok: false, code: 'unsupported_format', message: '仅支持 mp4 / mov / webm / mkv / avi' };
  }
  if (!fs.existsSync(resolved)) {
    return { ok: false, code: 'video_not_found', message: `视频不存在: ${videoPath}` };
  }

  const sourceBuf = fs.readFileSync(resolved);
  const sourceSha = sha256(sourceBuf);
  const framesDir = path.join(workspaceRoot, '.petri', 'frames', sourceSha);
  fs.mkdirSync(framesDir, { recursive: true });

  // 已有同源 manifest → 幂等返回（不重复抽帧）
  const manifestPath = path.join(framesDir, 'manifest.json');
  if (fs.existsSync(manifestPath)) {
    try {
      const prev = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      if (prev.maxFrames >= cap && prev.strategy === strategy) {
        return { ok: true, ...prev, cached: true };
      }
    } catch { /* 损坏 manifest → 重抽 */ }
  }

  // ffprobe 取时长
  let durationSec = 0;
  try {
    const ffprobe = probe.bin.replace(/ffmpeg$/, 'ffprobe').replace(/ffmpeg\.exe$/, 'ffprobe.exe');
    const out = execFileSync(ffprobe, ['-v', 'quiet', '-show_entries', 'format=duration', '-of', 'csv=p=0', resolved], { encoding: 'utf8', timeout: 15_000 });
    durationSec = parseFloat(out.trim()) || 0;
  } catch { /* ffprobe 缺席或失败 → durationSec=0（manifest 如实标注） */ }

  // 构造 ffmpeg 抽帧参数
  const framePrefix = path.join(framesDir, 'frame-%03d.' + FRAME_FORMAT);
  let ffmpegArgs;
  if (strategy === 'scene') {
    // 场景变化阈值：大于阈值 0.3 的场景切换点抽帧；超 cap 时 ffmpeg 自动停止
    ffmpegArgs = ['-i', resolved, '-vf', `select='gt(scene,0.3)'`, `-frames:v`, String(cap), '-fps_mode', 'vfr', framePrefix, '-y'];
  } else {
    // 均匀步长：按帧数等分时长取帧
    const fps = durationSec > 0 ? (cap / durationSec) : 1;
    ffmpegArgs = ['-i', resolved, '-vf', `fps=${fps}`, `-frames:v`, String(cap), framePrefix, '-y'];
  }

  try {
    execFileSync(probe.bin, ffmpegArgs, { timeout: 60_000, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (error) {
    return { ok: false, code: 'ffmpeg_failed', message: String((error && error.message) || error).slice(0, 300) };
  }

  // 收集帧文件（排序保证确定性）
  const frames = fs.readdirSync(framesDir)
    .filter((f) => f.endsWith('.' + FRAME_FORMAT))
    .sort()
    .map((f) => {
      const fp = path.join(framesDir, f);
      return { file: path.join('.petri', 'frames', sourceSha, f), sha256: sha256(fs.readFileSync(fp)), sizeBytes: fs.statSync(fp).size };
    });

  const manifest = {
    ok: true,
    sourcePath: videoPath,
    sourceSha256: sourceSha,
    durationSec,
    strategy,
    maxFrames: cap,
    frames,
    frameCount: frames.length,
    framesDir: path.join('.petri', 'frames', sourceSha),
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  return manifest;
}

module.exports = {
  DEFAULT_MAX_FRAMES,
  HARD_CAP_FRAMES,
  VIDEO_EXT_RE,
  FRAME_FORMAT,
  isVideoPath,
  probeFfmpeg,
  extractVideoFrames,
};
