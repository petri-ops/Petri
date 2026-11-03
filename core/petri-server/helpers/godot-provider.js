'use strict';

/**
 * helpers/godot-provider.js — BLOCK-341 P1 Godot 发现与能力探针。
 *
 * 复用 Blender/ffmpeg 先例：用户自装引擎（PETRI_GODOT_BIN + 常见安装路径），
 * 缺席诚实 unavailable（不内置、不下载）。版本/headless/截图/movie 能力探针
 * 按版本分支（Godot 4.x CLI 随版本漂移，plan §5）。
 *
 * 探针实测（4.7.1 mac，BLOCK-341 P1 记录）：
 *   - --headless 脚本跑通但 viewport 无渲染（截图空）→ 截图/截图序列需要真显示驱动；
 *   - --write-movie：<file>.avi = AVI 容器；<file>.png = PNG 序列（frames%08d.png，
 *     落在输出路径同目录）+ 同名 .wav 音轨；--fixed-fps 被强制；
 *   - --quit-after N = N 个渲染帧后退出；主场景经 project.godot run/main_scene 或 --scene。
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

let cachedBinary = undefined;
let cachedCapability = undefined;

/** 二进制发现：env 优先 → PATH → 常见安装路径（mac/win/linux）。 */
function findGodotBinary() {
  if (cachedBinary !== undefined) return cachedBinary;
  const candidates = [];
  if (process.env.PETRI_GODOT_BIN) candidates.push(process.env.PETRI_GODOT_BIN);
  candidates.push(process.platform === 'win32' ? 'godot.exe' : 'godot');
  if (process.platform === 'darwin') {
    candidates.push('/Applications/Godot.app/Contents/MacOS/Godot');
    candidates.push('/opt/homebrew/bin/godot');
  }
  for (const candidate of candidates) {
    try {
      if (candidate.includes(path.sep)) {
        if (fs.existsSync(candidate)) {
          cachedBinary = candidate;
          return candidate;
        }
        continue;
      }
      const resolved = execFileSync(
        process.platform === 'win32' ? 'where' : 'which',
        [candidate],
        { encoding: 'utf8', timeout: 5000 },
      ).split(/\r?\n/).map((line) => line.trim()).find(Boolean);
      if (resolved && fs.existsSync(resolved)) {
        cachedBinary = resolved;
        return resolved;
      }
    } catch { /* try next */ }
  }
  cachedBinary = null;
  return null;
}

/** 测试注入：重置探测缓存。 */
function _resetGodotCache() {
  cachedBinary = undefined;
  cachedCapability = undefined;
}

/** 从版本字符串解析主版本号（4.x → 4；不可解析 → 0）。 */
function majorVersion(versionText) {
  const m = /(\d+)\.\d+/.exec(String(versionText || ''));
  return m ? parseInt(m[1], 10) : 0;
}

/**
 * 能力探针（带缓存；每次引擎升级后进程重启自然失效）。
 * @returns {{ok:true, bin, version, major, headless:boolean, writeMovie:boolean, screenshotScript:boolean}
 *           | {ok:false, code:'capability_unavailable', message}}
 */
function probeGodot() {
  if (cachedCapability) return cachedCapability;
  const bin = findGodotBinary();
  if (!bin) {
    cachedCapability = {
      ok: false,
      code: 'capability_unavailable',
      message: 'Godot 未安装或不在常见路径（PETRI_GODOT_BIN 可显式指定）——引擎桥诚实不可用（用户自装后复测）',
    };
    return cachedCapability;
  }
  let version = '';
  try {
    version = String(execFileSync(bin, ['--version'], { encoding: 'utf8', timeout: 15_000 })).trim();
  } catch (error) {
    cachedCapability = { ok: false, code: 'godot_version_failed', message: String((error && error.message) || error).slice(0, 200) };
    return cachedCapability;
  }
  const major = majorVersion(version);
  cachedCapability = {
    ok: true,
    bin,
    version,
    major,
    // 4.x：--headless 跑脚本（无渲染）；--write-movie 支持 avi/png 序列；非 headless 截图脚本可用
    headless: major >= 4,
    writeMovie: major >= 4,
    screenshotScript: major >= 4,
  };
  return cachedCapability;
}

module.exports = {
  findGodotBinary,
  probeGodot,
  _resetGodotCache,
};
