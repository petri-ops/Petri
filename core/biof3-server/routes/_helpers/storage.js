'use strict';

/**
 * routes/_helpers/storage.js — 文件存储共享 helper
 *
 * 抽自 `core/biof3-server/routes/result-studio.js` PHASE 2.1a 拆分 commit。
 * 类别：文件系统读取 / hashing / 表格抽样 / 路径包含性检查。
 *   - hashFile(filePath)                              → sha256 流式哈希
 *   - resolveWorkspaceFileForRevision(workspaceRoot, revision) → 包含性检查
 *   - openVerifiedRevisionArtifact(workspaceRoot, revision)    → snapshot open
 *   - readTableSample(absolutePath, fileName)         → 表格抽样
 *   - detectDelimiter(headerLine, fileName)           → csv/tsv 嗅探
 *   - splitCsvLine(line, delimiter)                   → 简单 csv parser
 *   - ID_INFERENCE_SAMPLE_ROWS / MAX_READ_BYTES       → 上限常量
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { isPathContained } = require('../../../shared-backend/project-run-layout');
const {
  createVerifiedFileSnapshot,
} = require('../../helpers/verified-file-snapshot');

/** 用于 ID 推断的抽样上限。够判定唯一性，又不至于把大文件全读进内存。 */
const ID_INFERENCE_SAMPLE_ROWS = 500;

/** 单个 artifact 的读取上限（字节）。超过则只读前缀做抽样。 */
const MAX_READ_BYTES = 8 * 1024 * 1024;

function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  const handle = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(1024 * 1024);
    let bytesRead;
    do {
      bytesRead = fs.readSync(handle, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(handle);
  }
  return hash.digest('hex');
}

function resolveWorkspaceFileForRevision(workspaceRoot, revision) {
  const workspace = fs.realpathSync(workspaceRoot);
  const target = fs.realpathSync(path.join(workspace, revision.outputPath));
  if (!isPathContained(workspace, target)) throw Object.assign(new Error('Revision output escaped the project.'), { code: 'revision_output_escape' });
  return target;
}

async function openVerifiedRevisionArtifact(workspaceRoot, revision, deps = {}) {
  const snapshotFactory = deps.createVerifiedFileSnapshot || createVerifiedFileSnapshot;
  let fd = null;
  try {
    const workspace = fs.realpathSync(workspaceRoot);
    const artifactPath = fs.realpathSync(path.join(workspace, revision.outputPath));
    if (!isPathContained(workspace, artifactPath)) throw new Error('artifact_path_escape');
    const noFollow = Number.isInteger(fs.constants.O_NOFOLLOW) ? fs.constants.O_NOFOLLOW : 0;
    fd = fs.openSync(artifactPath, fs.constants.O_RDONLY | noFollow);
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) throw new Error('artifact_not_file');
    if (!revision.outputHash) throw new Error('artifact_hash_mismatch');
    const sourceFd = fd;
    fd = null;
    const snapshot = await snapshotFactory(sourceFd, {
      expectedIdentity: {
        dev: stat.dev,
        ino: stat.ino,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        ctimeMs: stat.ctimeMs,
      },
      expectedSha256: revision.outputHash,
    });
    return {
      fd: snapshot.fd,
      stat: snapshot.stat,
      verification: snapshot.verification,
      artifactPath,
    };
  } catch (error) {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch {}
    }
    if (error?.code === 'verified_snapshot_hash_mismatch') throw new Error('artifact_hash_mismatch');
    throw error;
  }
}

function detectDelimiter(headerLine, fileName) {
  if (/\.tsv$/i.test(fileName)) return '\t';
  const tabs = (headerLine.match(/\t/g) || []).length;
  const commas = (headerLine.match(/,/g) || []).length;
  return tabs > commas ? '\t' : ',';
}

function splitCsvLine(line, delimiter) {
  const cells = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      // 连续两个引号是转义的字面引号
      if (quoted && line[index + 1] === '"') { current += '"'; index += 1; continue; }
      quoted = !quoted;
      continue;
    }
    if (char === delimiter && !quoted) { cells.push(current.trim()); current = ''; continue; }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

/**
 * 读取表格 artifact 并抽样。
 *
 * 返回真实总行数（在读全的前提下）与抽样行对象；文件被截断时明确标记，
 * 避免把"前缀里唯一"当成"整表唯一"。
 */
function readTableSample(absolutePath, fileName) {
  const stat = fs.statSync(absolutePath);
  const truncated = stat.size > MAX_READ_BYTES;
  let raw;
  if (truncated) {
    const handle = fs.openSync(absolutePath, 'r');
    try {
      const buffer = Buffer.alloc(MAX_READ_BYTES);
      const read = fs.readSync(handle, buffer, 0, MAX_READ_BYTES, 0);
      raw = buffer.slice(0, read).toString('utf8');
    } finally {
      fs.closeSync(handle);
    }
    // 丢弃末尾可能被截断的半行
    const lastBreak = raw.lastIndexOf('\n');
    if (lastBreak > 0) raw = raw.slice(0, lastBreak);
  } else {
    raw = fs.readFileSync(absolutePath, 'utf8');
  }

  const lines = raw.split(/\r?\n/).filter((line) => line.trim() !== '');
  if (lines.length === 0) return { columns: [], rows: [], rowCount: 0, truncated };

  const delimiter = detectDelimiter(lines[0], fileName);
  const columns = splitCsvLine(lines[0], delimiter);
  const dataLines = lines.slice(1);
  const rows = dataLines.slice(0, ID_INFERENCE_SAMPLE_ROWS).map((line) => {
    const cells = splitCsvLine(line, delimiter);
    const row = {};
    columns.forEach((column, index) => { row[column] = cells[index]; });
    return row;
  });

  return {
    columns,
    rows,
    // 文件被截断时行数只是下界，不能当权威总数。
    rowCount: truncated ? null : dataLines.length,
    truncated,
  };
}

module.exports = {
  hashFile,
  resolveWorkspaceFileForRevision,
  openVerifiedRevisionArtifact,
  readTableSample,
  detectDelimiter,
  splitCsvLine,
  ID_INFERENCE_SAMPLE_ROWS,
  MAX_READ_BYTES,
};
