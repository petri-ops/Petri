// ============================================================
// src/plugin/zip.js — zip extraction wrapper
//
// Extracted from src/plugin-manager.js by BLOCK-9.2 PHASE 3.
// Original location: lines 434-438.
//
// Pure Node implementation wrapper around extract-zip, avoiding any
// dependency on system unzip / PowerShell.
//
// POST-S7 H1/B-06——不可信 zip 的条目级校验（零新增依赖）：
// extract-zip 2.0.1 自身已挡 `../` 越界（realpath + '..' 检查）并跳过 __MACOSX/，
// 但它**不限制条目数、总解压字节与符号链接条目**——一个 42KB 的压缩炸弹可以解出几 GB，
// 一个指向 /etc 的 symlink 条目可以让后续读盘越过插件目录。故在 onEntry 钩子上补三道
// fail-closed 闸（抛错即中止整次解压，不留半截目录）：
//   zip_entry_limit_exceeded  条目数超上限
//   zip_total_bytes_exceeded  累计解压字节超上限
//   zip_symlink_entry_rejected 条目为符号链接
//   zip_entry_path_invalid    条目名绝对路径 / 盘符 / 空名
// 红线：不新建解压器（仍用 extract-zip），只在既有单入口上加校验。
// ============================================================

const fs = require('fs');
const extractZip = require('extract-zip');

const DEFAULT_MAX_ENTRIES = 20000;
const DEFAULT_MAX_TOTAL_BYTES = 512 * 1024 * 1024;

const IFMT = 0o170000;
const IFLNK = 0o120000;

function entryPathProblem(entryName) {
  if (typeof entryName !== 'string' || entryName.trim() === '') return 'empty_entry_name';
  if (entryName.startsWith('/')) return 'absolute_entry_path';
  if (/^[a-zA-Z]:[\\/]/.test(entryName)) return 'drive_letter_entry_path';
  const normalized = entryName.split('\\').join('/');
  if (normalized.split('/').includes('..')) return 'traversal_entry_path';
  return null;
}

/**
 * 解压插件 zip 到目录，带条目级 fail-closed 校验。
 * @param {string} zipPath
 * @param {string} destDir
 * @param {{ maxEntries?: number, maxTotalBytes?: number }} [options]
 * @returns {Promise<{ destDir: string, entries: number, totalBytes: number }>}
 */
async function extractZipFile(zipPath, destDir, options = {}) {
  const maxEntries = Number.isFinite(options.maxEntries) && options.maxEntries > 0
    ? options.maxEntries : DEFAULT_MAX_ENTRIES;
  const maxTotalBytes = Number.isFinite(options.maxTotalBytes) && options.maxTotalBytes > 0
    ? options.maxTotalBytes : DEFAULT_MAX_TOTAL_BYTES;

  fs.mkdirSync(destDir, { recursive: true });
  let entries = 0;
  let totalBytes = 0;

  await extractZip(zipPath, {
    dir: destDir,
    onEntry(entry) {
      entries += 1;
      const problem = entryPathProblem(entry.fileName);
      if (problem) {
        const error = new Error(`zip_entry_path_invalid: ${problem} (${entry.fileName})`);
        error.reasonCode = 'zip_entry_path_invalid';
        error.detail = { entry: entry.fileName, problem };
        throw error;
      }
      const mode = (entry.externalFileAttributes >> 16) & 0xffff;
      if ((mode & IFMT) === IFLNK) {
        const error = new Error(`zip_symlink_entry_rejected: ${entry.fileName}`);
        error.reasonCode = 'zip_symlink_entry_rejected';
        error.detail = { entry: entry.fileName };
        throw error;
      }
      if (entries > maxEntries) {
        const error = new Error(`zip_entry_limit_exceeded: >${maxEntries}`);
        error.reasonCode = 'zip_entry_limit_exceeded';
        error.detail = { maxEntries, entries };
        throw error;
      }
      totalBytes += Number(entry.uncompressedSize) || 0;
      if (totalBytes > maxTotalBytes) {
        const error = new Error(`zip_total_bytes_exceeded: >${maxTotalBytes}`);
        error.reasonCode = 'zip_total_bytes_exceeded';
        error.detail = { maxTotalBytes, totalBytes };
        throw error;
      }
    },
  });
  return { destDir, entries, totalBytes };
}

module.exports = {
  extractZipFile,
};
