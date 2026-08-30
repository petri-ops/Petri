'use strict';

/**
 * routes/_helpers/workspace-file-index.js — workspace 文件索引（PHASE 2.2a）
 *
 * 抽自 `core/biof3-server/routes/harness.js` PHASE 2 拆分。供 harness/file-references
 * 子域使用，未来也可能被 harness workspace tools 复用：
 *   - dangerousPathSegment / isBackupSegment（路径分类 helper）
 *   - normalizeRelativePath（路径标准化 helper）
 *   - relativeWorkspacePathForAbsolute（绝对 → workspace 相对）
 *   - buildWorkspaceFileNameIndex（49 行递归扫描）
 *   - findUniqueWorkspaceFileByName（按文件名查唯一文件）
 *   - combinedUniqueCount / combinedAmbiguousCount（live + backup 聚合）
 *
 * 依赖：仅 require 上层 `helpers/chat-file-references`（isRealPathInsideRoot）。
 */

const fs = require('fs');
const path = require('path');
const { isRealPathInsideRoot } = require('../../helpers/chat-file-references');

const DEFAULT_MAX_ENTRIES = 50000;

function normalizeRelativePath(value) {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/\/{2,}/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
}

function dangerousPathSegment(segment) {
  return /(^|\/|\\)(node_modules|\.git|\.env|\.ssh|\.biof3-secrets|\.venv|venv|__pycache__|\.Rproj\.user|\.quarto|\.cache|\.next|\.vite|\.parquet|\.ipynb_checkpoints|\.pytest_cache|\.mypy_cache|\.ruff_cache|\.tox|target|dist|build|out|\.direnv|\.idea|\.vscode|\.history)(?=\/|$|\\)/i.test(segment);
}

// Directories we treat as "snapshots" — useful to humans but noise to the
// resolver. Their entries are indexed under a shadow `byNameBackup` map so we
// can still resolve unambiguous names that only exist in a snapshot, but a
// name that lives in both the live workspace and a snapshot resolves to the
// live path only.
function isBackupSegment(segment) {
  return /(^|\/|\\)(results_backup(?:_\d+)*|.*_backup|.*_bak|.*\.bak|.*_old|.*_snapshot)(?=\/|$|\\)/i.test(segment);
}

function relativeWorkspacePathForAbsolute(workspacePath, absolutePath) {
  if (!workspacePath || !absolutePath) return null;
  try {
    const realRoot = fs.realpathSync(workspacePath);
    const realTarget = fs.realpathSync(absolutePath);
    if (!isRealPathInsideRoot(realRoot, realTarget) || !fs.statSync(realTarget).isFile()) return null;
    const relative = normalizeRelativePath(path.relative(realRoot, realTarget));
    return relative && !dangerousPathSegment(relative) ? relative : null;
  } catch {
    return null;
  }
}

function buildWorkspaceFileNameIndex(workspacePath, maxEntries = DEFAULT_MAX_ENTRIES) {
  const byName = new Map();
  const byNameBackup = new Map();
  if (!workspacePath) return { byName, byNameBackup, visited: 0, skipped: 0, maxEntries };
  const maxPerDir = 2000;
  let visited = 0;
  let skipped = 0;
  let overCapDirs = 0;
  let backupDirs = 0;
  const visit = (dir, relativeDir = '') => {
    if (visited >= maxEntries) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.length > maxPerDir) {
      // Single directory with thousands of files (e.g. barcode matrices,
      // raw FASTQ dumps, large node_modules) — skip it instead of letting
      // it crowd out the workspace entries the chat actually references.
      overCapDirs += 1;
      skipped += entries.length;
      return;
    }
    for (const entry of entries) {
      if (visited >= maxEntries) return;
      visited += 1;
      const relative = normalizeRelativePath(path.join(relativeDir, entry.name));
      if (!relative || dangerousPathSegment(relative)) {
        skipped += 1;
        continue;
      }
      const isBackup = isBackupSegment(relative);
      if (entry.isDirectory()) {
        if (isBackup) backupDirs += 1;
        visit(path.join(dir, entry.name), relative);
      } else if (entry.isFile()) {
        const target = isBackup ? byNameBackup : byName;
        const matches = target.get(entry.name) || [];
        matches.push(relative);
        target.set(entry.name, matches);
      }
    }
  };
  visit(workspacePath);
  return { byName, byNameBackup, visited, skipped, maxEntries, overCapDirs, backupDirs };
}

function findUniqueWorkspaceFileByName(index, backupIndex, fileName) {
  // All indexed paths live inside the user's `projects.workspace_path` —
  // there is no separate "live vs backup" concept: the user owns the whole
  // workspace. When the same bare filename appears in multiple places we
  // prefer the *shallowest* match (shortest relative path / fewest segments)
  // because that is almost always the artifact the agent most recently
  // produced or the one the user is actively working on. Ties on depth are
  // broken alphabetically so the result is deterministic across runs.
  const candidates = [];
  const push = (map) => {
    if (!map || typeof map.get !== 'function') return;
    const matches = map.get(fileName) || [];
    for (const m of matches) candidates.push(m);
  };
  push(index);
  push(backupIndex);
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  candidates.sort((a, b) => {
    const da = a.split('/').filter(Boolean).length;
    const db = b.split('/').filter(Boolean).length;
    if (da !== db) return da - db;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return candidates[0];
}

function combinedUniqueCount(liveMap, backupMap) {
  const seen = new Set();
  let count = 0;
  const tally = (map) => {
    if (!map || typeof map.entries !== 'function') return;
    for (const [name, matches] of map.entries()) {
      if (seen.has(name)) continue;
      seen.add(name);
      if (matches.length === 1) count += 1;
    }
  };
  tally(liveMap);
  tally(backupMap);
  return count;
}

function combinedAmbiguousCount(liveMap, backupMap) {
  const seen = new Set();
  let count = 0;
  const tally = (map) => {
    if (!map || typeof map.entries !== 'function') return;
    for (const [name, matches] of map.entries()) {
      if (seen.has(name)) continue;
      seen.add(name);
      if (matches.length > 1) count += 1;
    }
  };
  tally(liveMap);
  tally(backupMap);
  return count;
}

module.exports = {
  normalizeRelativePath,
  dangerousPathSegment,
  isBackupSegment,
  relativeWorkspacePathForAbsolute,
  buildWorkspaceFileNameIndex,
  findUniqueWorkspaceFileByName,
  combinedUniqueCount,
  combinedAmbiguousCount,
  DEFAULT_MAX_ENTRIES,
};
