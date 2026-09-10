'use strict';

/**
 * helpers/project-storage.js — BLOCK-78 P2-③ 项目结果库占用（纯逻辑层）
 *
 * - walkSize：本地目录递归求 size（限深限文件数，超限 truncated:true 诚实降级）；
 * - parseDuOutput：`du -sb` 输出 → 字节数（首列；解析失败 0）；
 * - createStorageCache：60s TTL 合并缓存（fresh/stale 与资源快照同语义）。
 */

const fsp = require('fs/promises');

const WALK_DEFAULTS = { maxDepth: 8, maxFiles: 5000 };
const TTL_MS_DEFAULT = 60000;

/** 递归求目录字节数；符号链接不跟随。超限截断并 truncated:true。 */
async function walkSize(dirPath, { maxDepth = WALK_DEFAULTS.maxDepth, maxFiles = WALK_DEFAULTS.maxFiles, _depth = 0, _state } = {}) {
  const state = _state || { files: 0, truncated: false };
  let bytes = 0;
  if (_depth > maxDepth || state.truncated) {
    state.truncated = true;
    return { bytes, truncated: state.truncated };
  }
  let dirents;
  try {
    dirents = await fsp.readdir(dirPath, { withFileTypes: true });
  } catch {
    state.truncated = true;
    return { bytes, truncated: true };
  }
  for (const dirent of dirents) {
    if (state.files >= maxFiles) { state.truncated = true; break; }
    const full = pathJoin(dirPath, dirent.name);
    if (dirent.isSymbolicLink()) continue;
    if (dirent.isDirectory()) {
      state.files += 1;
      const sub = await walkSize(full, { maxDepth, maxFiles, _depth: _depth + 1, _state: state });
      bytes += sub.bytes;
      if (state.truncated) break;
    } else if (dirent.isFile()) {
      state.files += 1;
      try {
        const st = await fsp.stat(full);
        bytes += st.size;
      } catch { /* 可读性竞争：跳过该文件 */ }
    }
  }
  return { bytes, truncated: state.truncated };
}

function pathJoin(a, b) {
  return a.endsWith('/') || a.endsWith('\\') ? `${a}${b}` : `${a}/${b}`;
}

/** `du -sb` 输出 → 字节数（首列；解析失败 0，不伪造）。 */
function parseDuOutput(stdout) {
  const m = String(stdout || '').trim().split('\n')[0].match(/^(\d+)\s/);
  return m ? Number(m[1]) : 0;
}

function createStorageCache({ ttlMs = TTL_MS_DEFAULT, now = () => Date.now() } = {}) {
  const entries = new Map();
  return {
    getFresh(projectId) {
      const entry = entries.get(projectId);
      if (!entry) return null;
      if (now() - entry.at >= ttlMs) return null;
      return entry.payload;
    },
    getStale(projectId) {
      const entry = entries.get(projectId);
      return entry ? entry.payload : null;
    },
    put(projectId, payload) {
      entries.set(projectId, { at: now(), payload });
    },
    clear() {
      entries.clear();
    },
  };
}

module.exports = { walkSize, parseDuOutput, createStorageCache, WALK_DEFAULTS, TTL_MS_DEFAULT };
