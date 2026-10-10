// ============================================================
// src/plugin/manifest-source.js — manifest loading (built-in + remote)
//
// Extracted from src/plugin-manager.js by BLOCK-9.2 PHASE 3.
// Original location: lines 230-309 (getBuiltInManifest + getRemoteManifest).
//
// getBuiltInManifest: reads resources/built-in-plugins/manifest.json with
// schema validation. Throws on parse failure (fail-loud per Week 2 contract).
//
// getRemoteManifest: fetches the remote plugin store manifest over HTTPS
// with a 15s timeout; on network/timeout/error falls back to built-ins only.
// Merges remote + built-in with built-ins marked `_builtIn: true`, and
// normalizes legacy {url,checksum,size,platform} entries to the current
// BLOCK-158 商店面退役后本模块 = 运行时目录读面（BLOCK-158 前含 OSS 远程合并半边，已退役）。
// ============================================================

const fs = require('fs');
const path = require('path');
const {
  BUILT_IN_PLUGINS_DIR,
} = require('./paths');
const {
  validateManifest,
} = require('../plugin-schema');

function getBuiltInManifest() {
  try {
    // BLOCK-83 P4：内置发行清单拆分——运行时清单在 resources/runtime/（领域插件清单随领域包交付）。
    const p = path.join(BUILT_IN_PLUGINS_DIR, '..', 'runtime', 'manifest.json');
    if (fs.existsSync(p)) {
      const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
      const v = validateManifest(parsed);
      if (!v.valid) {
        const msg = `built-in manifest schema validation failed: ${v.issues.join('; ')}`;
        console.error('[plugin]', msg);
        throw new Error(msg);
      }
      return parsed;
    }
  } catch (e) {
    if (e instanceof SyntaxError) {
      const msg = `built-in manifest is not valid JSON: ${e.message}`;
      console.error('[plugin]', msg);
      throw new Error(msg);
    }
    if (e.message && e.message.startsWith('built-in manifest')) throw e;
    console.warn('[plugin] built-in manifest read failed:', e.message);
  }
  return { plugins: {}, version: '0.0.0' };
}

// BLOCK-158 商店面退役 — 原「远程 OSS + 内置」合并语义收敛为**运行时目录**单源：
// 只读 resources/runtime/manifest.json（biof3-r-runtime / biof3-py-runtime，
// 供给链 = 领域包一键安装的运行时下载）。OSS 远程插件清单抓取已随商店面退役，
// OSS bucket/清单基建不动（G1 恢复在线商店时在挂点重新合并 remote 半边即可）。
async function getRemoteManifest() {
  const builtIn = getBuiltInManifest();
  const plugins = {};
  if (builtIn.plugins) {
    for (const [id, info] of Object.entries(builtIn.plugins)) {
      plugins[id] = { ...info, _builtIn: true };
    }
  }
  return { version: builtIn.version, plugins };
}

module.exports = {
  getBuiltInManifest,
  getRemoteManifest,
};
