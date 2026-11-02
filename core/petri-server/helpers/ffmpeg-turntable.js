/**
 * helpers/ffmpeg-turntable.js — BLOCK-329 转盘 mp4 外部 ffmpeg 合成回退（RULING-03 同型：
 * 外部可执行，默认探测、缺失如实报、不静默下载）。
 *
 * 触发条件（窄）：Blender 自身出片能力缺席（Python 报 movieCapability='unavailable'——
 * macOS 5.2.3 无头把 movie 格式从动态枚举摘掉）且序列帧已出盘。Blender 原生出片成功时
 * 本模块永不介入（videoSource='blender' 零变化）。
 *
 * 合规：复用 Blender 已出盘的 PNG 序列（不重渲染）；输出与 Blender 原生同名
 * （turntable.mp4）同 fps；产物打 videoSource='ffmpeg' 留痕，面板/成果面可区分来源。
 * 用户裁决 2026-11-02「其它几项都确定开整」（mac mp4 ffmpeg 合成，此前 AUDIT-LOG 🟡 待裁）。
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');

let cachedBinary;

/** 发现 ffmpeg：PETRI_FFMPEG_BIN 优先，其次 PATH（与 findBlenderBinary 同款探测口径）。 */
function findFfmpegBinary() {
  if (cachedBinary !== undefined) return cachedBinary;
  const candidates = [];
  if (process.env.PETRI_FFMPEG_BIN) candidates.push(process.env.PETRI_FFMPEG_BIN);
  candidates.push(process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  for (const candidate of candidates) {
    try {
      if (candidate.includes(path.sep) && fs.existsSync(candidate)) {
        cachedBinary = candidate;
        return candidate;
      }
      if (!candidate.includes(path.sep)) {
        const resolved = execFileSync(
          process.platform === 'win32' ? 'where' : 'which',
          [candidate],
          { encoding: 'utf8', timeout: 5000 },
        ).split(/\r?\n/).map((line) => line.trim()).find(Boolean);
        if (resolved && fs.existsSync(resolved)) {
          cachedBinary = resolved;
          return resolved;
        }
      }
    } catch { /* try next */ }
  }
  cachedBinary = null;
  return null;
}

/** 测试注入：重置探测缓存。 */
function _resetFfmpegCache() {
  cachedBinary = undefined;
}

/**
 * 是否该介入：Blender 出片缺席 + 序列帧在盘 + 用户未显式关闭。
 * PETRI_MODEL3D_FFMPEG_FALLBACK=0 可关（默认开——用户裁决允许外部 ffmpeg）。
 */
function shouldFallback(turntableReport) {
  if (process.env.PETRI_MODEL3D_FFMPEG_FALLBACK === '0') return false;
  if (!turntableReport || typeof turntableReport !== 'object') return false;
  if (turntableReport.video) return false; // Blender 原生已出片
  if (turntableReport.movieCapability !== 'unavailable') return false; // 真失败不代偿（静默出图=欺骗）
  const stills = Array.isArray(turntableReport.stills) ? turntableReport.stills : [];
  return stills.length > 0;
}

/**
 * 用已出盘 PNG 序列合成 mp4。
 * @returns {Promise<{ok:true, video:string, videoSource:'ffmpeg', binary:string}|{ok:false, error:string, message?:string}>}
 */
async function composeTurntable({ outDir, stills, fps, stem = 'turntable', timeoutMs = 120_000, signal } = {}) {
  const binary = findFfmpegBinary();
  if (!binary) return { ok: false, error: 'ffmpeg_not_installed' };
  const frames = (Array.isArray(stills) ? stills : []).filter((p) => typeof p === 'string' && fs.existsSync(p));
  if (frames.length === 0) return { ok: false, error: 'no_stills' };
  // 以 concat demuxer 吃显式帧清单（不依赖 glob 模式与帧名假设；帧序=Blender 报告顺序）
  const listPath = path.join(outDir, `${stem}-frames.txt`);
  const safe = (p) => p.replace(/'/g, "'\\''");
  fs.writeFileSync(listPath, frames.map((p) => `file '${safe(path.resolve(p))}'\nduration ${1 / Math.max(1, Number(fps) || 12)}`).join('\n') + '\n');
  const output = path.join(outDir, `${stem}.mp4`);
  const args = [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'concat', '-safe', '0', '-i', listPath,
    '-r', String(Math.max(1, Number(fps) || 12)),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '23',
    // libx264 要求偶数尺寸；渲染尺寸可能为奇数 → 缩放到偶数
    '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
    '-movflags', '+faststart',
    output,
  ];
  const result = await new Promise((resolve) => {
    const child = spawn(binary, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    let settled = false;
    const finish = (payload) => { if (!settled) { settled = true; resolve(payload); } };
    const timer = setTimeout(() => { try { child.kill(); } catch { /* gone */ } finish({ code: 124, stderr: `${stderr}\nffmpeg_timeout` }); }, timeoutMs);
    if (timer.unref) timer.unref();
    const abort = () => { try { child.kill(); } catch { /* gone */ } finish({ code: 130, stderr: `${stderr}\nffmpeg_cancelled` }); };
    if (signal) { if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true }); }
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', (error) => { clearTimeout(timer); signal?.removeEventListener('abort', abort); finish({ code: 1, stderr: `${stderr}\n${error.message}` }); });
    child.on('close', (code) => { clearTimeout(timer); signal?.removeEventListener('abort', abort); finish({ code: code ?? 1, stderr }); });
  });
  try { fs.unlinkSync(listPath); } catch { /* keep going */ }
  if (result.code !== 0 || !fs.existsSync(output)) {
    return {
      ok: false,
      error: result.code === 124 ? 'ffmpeg_timeout' : result.code === 130 ? 'ffmpeg_cancelled' : 'ffmpeg_failed',
      message: String(result.stderr || '').slice(-1500),
    };
  }
  return { ok: true, video: output, videoSource: 'ffmpeg', binary };
}

module.exports = { findFfmpegBinary, shouldFallback, composeTurntable, _resetFfmpegCache };
