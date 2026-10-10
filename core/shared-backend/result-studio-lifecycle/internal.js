'use strict';

// BLOCK-92 Wave C-7 — 共享常量与哈希/私有路径原语外迁（原 lifecycle 24-90，
// 纯搬运零行为变化）。主文件与 gc/table-page 子模块统一从此引入。

const crypto = require('crypto');
const fs = require('fs');
const { ResultStudioPrivatePathError } = require('../result-studio-private-path');

const RESULT_STUDIO_LIFECYCLE_VERSION = 1;
const ZERO_OID = '0'.repeat(40);
const DEFAULT_GC_MIN_AGE_MS = 24 * 60 * 60 * 1000;
const GC_SOURCE_REF_PREFIX = 'refs/heads/petri/result-sources/';
const GC_CHANGESET_REF_PREFIX = 'refs/heads/petri/changeset/';
const SAFE_CHANGESET_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MAX_STORAGE_FILES = 10000;
const MAX_TABLE_PAGE_ROWS = 200;
const MAX_TABLE_PAGE_BYTES = 1024 * 1024;
const DEFAULT_MAX_PREVIEW_MEMORY_BYTES = 4 * 1024 * 1024 * 1024;
const DARWIN_APFS_FS_TYPE = 26;

class ResultStudioLifecycleError extends Error {
  constructor(code, message, detail = null) {
    super(message);
    this.name = 'ResultStudioLifecycleError';
    this.code = code;
    this.detail = detail;
  }
}

function guardPrivatePath(operation) {
  try {
    return operation();
  } catch (error) {
    if (error instanceof ResultStudioPrivatePathError) {
      throw new ResultStudioLifecycleError(error.code, error.message, error.detail);
    }
    throw error;
  }
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function hashFileDescriptor(handle, io = fs) {
  const hash = crypto.createHash('sha256');
  const buffer = Buffer.alloc(1024 * 1024);
  let position = 0;
  while (true) {
    const read = io.readSync(handle, buffer, 0, buffer.length, position);
    if (read <= 0) break;
    hash.update(buffer.subarray(0, read));
    position += read;
  }
  return hash.digest('hex');
}


function expectedGcChangeSetRef(changeSetId) {
  const normalized = String(changeSetId || '').trim();
  return SAFE_CHANGESET_ID_PATTERN.test(normalized)
    ? `${GC_CHANGESET_REF_PREFIX}${normalized}`
    : null;
}

function hashFile(filePath) {
  const handle = fs.openSync(filePath, 'r');
  try {
    return hashFileDescriptor(handle);
  } finally {
    fs.closeSync(handle);
  }
}


module.exports = {
  RESULT_STUDIO_LIFECYCLE_VERSION,
  ZERO_OID,
  DEFAULT_GC_MIN_AGE_MS,
  GC_SOURCE_REF_PREFIX,
  GC_CHANGESET_REF_PREFIX,
  SAFE_CHANGESET_ID_PATTERN,
  MAX_STORAGE_FILES,
  MAX_TABLE_PAGE_ROWS,
  MAX_TABLE_PAGE_BYTES,
  DEFAULT_MAX_PREVIEW_MEMORY_BYTES,
  DARWIN_APFS_FS_TYPE,
  ResultStudioLifecycleError,
  guardPrivatePath,
  sha256,
  hashFileDescriptor,
  hashFile,
  expectedGcChangeSetRef,
};
