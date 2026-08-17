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
// per-platform artifacts contract via normalizeRemotePluginEntry.
// ============================================================

const fs = require('fs');
const path = require('path');
const https = require('https');
const {
  BUILT_IN_PLUGINS_DIR,
  MANIFEST_URL,
} = require('./paths');
const {
  normalizeRemotePluginEntry,
  validateManifest,
} = require('../plugin-schema');

function getBuiltInManifest() {
  try {
    const p = path.join(BUILT_IN_PLUGINS_DIR, 'manifest.json');
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

// 合并远程 + 内置 manifest（内置插件标记 _builtIn: true）
async function getRemoteManifest() {
  const builtIn = getBuiltInManifest();
  const builtInPlugins = {};
  if (builtIn.plugins) {
    for (const [id, info] of Object.entries(builtIn.plugins)) {
      builtInPlugins[id] = { ...info, _builtIn: true };
    }
  }
  // 尝试远程
  const remote = await new Promise((resolve) => {
    let buf = '';
    const req = https.get(MANIFEST_URL, { timeout: 15000 }, (res) => {
      if (res.statusCode !== 200) {
        return resolve({ plugins: {} });
      }
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(buf));
        } catch {
          resolve({ plugins: {} });
        }
      });
    });
    req.on('error', () => resolve({ plugins: {} }));
    req.on('timeout', () => {
      try {
        req.destroy();
      } catch {}
      resolve({ plugins: {} });
    });
  });
  // 合并：远程优先，但先把旧版 {url, checksum, size, platform} 条目规范化
  // 为当前 per-platform artifacts 契约。否则旧 OSS 清单会整条覆盖内置
  // Runtime 条目，导致 selectArtifact 在全新用户首装时失败。
  const mergedPlugins = { ...builtInPlugins };
  for (const [id, info] of Object.entries(remote.plugins || {})) {
    mergedPlugins[id] = normalizeRemotePluginEntry(id, info, builtInPlugins[id]);
  }
  const merged = {
    version: remote.version || builtIn.version,
    plugins: mergedPlugins,
  };
  // 规范化后的合并结果必须满足当前契约。远程失败时仍保留内置 fallback。
  if (remote.plugins && Object.keys(remote.plugins).length > 0) {
    const v = validateManifest(merged);
    if (!v.valid) {
      console.warn(`[plugin] remote manifest validation failed: ${v.issues.join('; ')}`);
    }
  }
  return merged;
}

module.exports = {
  getBuiltInManifest,
  getRemoteManifest,
};
