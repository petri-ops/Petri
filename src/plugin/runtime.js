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
// BLOCK-152 P 轨收敛：宿主→平台键推导单源。静态 require（不用上方 path.join
// 形态）让 quality:arch 真实裁决这条 src→core/shared-backend 边——R5 只拦
// core/biof3-server，core/shared-backend 合法（2026-10-09 实测绿，见工作包留痕）。
const { deriveHostPlatform } = require('../../core/shared-backend/host-platform');
const {
  RUNTIMES_DIR,
} = require('./paths');

/**
 * 平台键推导（BLOCK-152 起薄委托 core/shared-backend/host-platform.js 单源，
 * 原 BLOCK-9.2 本地副本已删）。语义统一到 canonical：win32 任何 arch 都映射
 * windows-x64 键（此前本地副本在 win32+arm64 落空出伪造键 win32-arm64，
 * 匹配不到任何 manifest artifact，必然 ARTIFACT_MISSING）；其余宿主行为不变。
 * 键约定 canonical = src/plugin-schema.js PLATFORM_IDS（block149 锚守护）。
 */
function detectPlatform() {
  return deriveHostPlatform();
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



module.exports = {
  detectPlatform,
  getRuntimeStatus,
};
