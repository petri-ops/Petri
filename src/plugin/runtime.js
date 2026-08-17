// ============================================================
// src/plugin/runtime.js — runtime detection + version + status helpers
//
// Extracted from src/plugin-manager.js by BLOCK-9.2 PHASE 3.
// Original location: lines 311-321 (detectPlatform), 1029-1049
// (getRuntimeStatus), 1417-1431 (parseVersion / compareVersions).
//
// Platform detection, runtime bin presence (R / Python), and semver
// compare helpers. No side effects beyond fs.statSync for bin checks.
//
// Heavy-lifting install / uninstall / fix-r-paths orchestration stays
// in src/plugin-manager.js to keep the install orchestrators in one
// place (they share state paths, onProgress callbacks, and the
// addInstalledPlugin side effect).
// ============================================================

const fs = require('fs');
const path = require('path');
const { getRuntimeBinCandidates } = require('../platform-compat');
const { getPythonRuntimeExecutable } = require(path.join(__dirname, '..', '..', 'core', 'shared-backend', 'runtime-paths'));
const {
  RUNTIMES_DIR,
} = require('./paths');

function detectPlatform() {
  const platform = process.platform;
  const arch = process.arch;
  if (platform === 'win32' && arch === 'x64') return 'windows-x64';
  if (platform === 'darwin' && arch === 'arm64') return 'macos-arm64';
  if (platform === 'darwin' && arch === 'x64') return 'macos-x64';
  return `${platform}-${arch}`;
}

function getRuntimeStatus() {
  const rDir = path.join(RUNTIMES_DIR, 'R');
  const pyDir = path.join(RUNTIMES_DIR, 'Python');
  return {
    r: {
      // win32 上文件名是 `Rscript.exe`；existsSync 不像 shell 那样按 PATHEXT
      // 自动补后缀，硬编码 'Rscript' 会让已装好的 Windows R 树永远判为未安装
      // （用户实测：装完重启仍提示"R 运行时未安装"）。走平台感知 helper，
      // 与 r-executor 的 binPath / platform-compat 同源。
      installed: getRuntimeBinCandidates('r', process.platform).some(
        (name) => fs.existsSync(path.join(rDir, 'bin', name)),
      ),
      path: fs.existsSync(rDir) ? rDir : null,
    },
    python: {
      installed: !!getPythonRuntimeExecutable(pyDir),
      path: fs.existsSync(pyDir) ? pyDir : null,
    },
  };
}

function parseVersion(v) {
  return v.split('.').map((x) => parseInt(x, 10) || 0);
}

function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const da = pa[i] || 0;
    const db = pb[i] || 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}

module.exports = {
  detectPlatform,
  getRuntimeStatus,
  parseVersion,
  compareVersions,
};
