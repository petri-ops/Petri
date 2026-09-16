'use strict';

const fs = require('fs');
const path = require('path');
const { isInternalArtifactName, isSafeFlatFilename } = require('../artifact-truth');
const { createVerifiedFileSnapshot } = require('../verified-file-snapshot');
const { parseStoredToolResult } = require('./tool-result-misc');

function declaredResultFilenames(result) {
  const names = new Set();
  const manifest = result && result.manifest;
  const sources = [
    result && result.artifacts,
    result && result.outputs,
    result && result.files,
    Array.isArray(manifest) ? manifest : null,
    manifest && manifest.artifacts,
    manifest && manifest.outputs,
    manifest && manifest.files,
  ];
  for (const items of sources) {
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      const candidate = typeof item === 'string'
        ? item
        : item && typeof item === 'object'
          ? item.filename || item.name || item.file
          : null;
      if (!isSafeFlatFilename(candidate) || isInternalArtifactName(candidate)) continue;
      names.add(candidate);
    }
  }
  return names;
}

function resolveStoredArtifactTruthBinding(result, filename) {
  const truth = result && result.artifactTruth;
  if (!truth) return { ok: true, expectedSha256: null, legacy: true };
  if (truth.blocking === true || !['valid', 'degraded'].includes(truth.status)) {
    return { ok: false, error: 'artifact_truth_unavailable' };
  }
  const artifacts = Array.isArray(result.artifacts) ? result.artifacts : [];
  const matches = artifacts.filter((artifact) => {
    if (!artifact || typeof artifact !== 'object') return false;
    const name = artifact.filename || artifact.name || artifact.path;
    return isSafeFlatFilename(path.basename(String(name || '')))
      && path.basename(String(name || '')) === filename;
  });
  if (matches.length !== 1) {
    return {
      ok: false,
      error: matches.length > 1 ? 'artifact_identity_ambiguous' : 'artifact_truth_unavailable',
    };
  }
  const expectedSha256 = String(matches[0].sha256 || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expectedSha256)) {
    return { ok: false, error: 'artifact_truth_unavailable' };
  }
  return { ok: true, expectedSha256, legacy: false };
}

function exactLegacyResultRoots(jobId, jobsDir) {
  if (!isSafeFlatFilename(String(jobId || '')) || !jobsDir) return [];
  const toolRoot = path.resolve(jobsDir, String(jobId));
  const mcpRoot = path.resolve(path.dirname(jobsDir), 'mcp-tool-jobs', String(jobId));
  return [toolRoot, path.join(toolRoot, 'output'), mcpRoot, path.join(mcpRoot, 'output')];
}

function isRealPathInside(root, target) {
  const relative = path.relative(root, target);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..'
    && !path.isAbsolute(relative);
}

function expectedPhysicalResultRoot({ job, layout, jobsDir, resultDir }) {
  if (job.project_id) {
    if (!layout?.workspaceRoot || !layout.jobRoot || !layout.outputDir) return null;
    const realWorkspace = fs.realpathSync(layout.workspaceRoot);
    const realJobRoot = fs.realpathSync(layout.jobRoot);
    if (!isRealPathInside(realWorkspace, realJobRoot)) return null;
    if (resultDir === path.resolve(layout.jobRoot)) return realJobRoot;
    const realOutputDir = fs.realpathSync(layout.outputDir);
    return path.dirname(realOutputDir) === realJobRoot ? realOutputDir : null;
  }

  const legacyRoots = exactLegacyResultRoots(job.id, jobsDir);
  const index = legacyRoots.indexOf(resultDir);
  if (index === -1) return null;
  const legacyBase = index < 2
    ? path.resolve(jobsDir)
    : path.resolve(path.dirname(jobsDir), 'mcp-tool-jobs');
  const realBase = fs.realpathSync(legacyBase);
  return path.join(realBase, String(job.id), ...(index % 2 === 1 ? ['output'] : []));
}

function resultFileIdentity(stat) {
  return {
    dev: stat.dev,
    ino: stat.ino,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs,
  };
}

function hasSameResultFileIdentity(stat, identity) {
  return Boolean(
    identity
      && stat.dev === identity.dev
      && stat.ino === identity.ino
      && stat.size === identity.size
      && stat.mtimeMs === identity.mtimeMs
      && stat.ctimeMs === identity.ctimeMs,
  );
}

/**
 * Resolve a private artifact only from the current Job's persisted declaration.
 * The stored result root must be one of this Job's exact server-derived roots;
 * realpath containment prevents a declared symlink from escaping that root.
 */
function resolveAuthorizedToolResultFile({ job, filename, layout = null, jobsDir }) {
  if (!isSafeFlatFilename(filename) || isInternalArtifactName(filename)) {
    return { ok: false, error: 'bad_path' };
  }
  const result = parseStoredToolResult(job);
  if (!result || !declaredResultFilenames(result).has(filename)) {
    return { ok: false, error: 'file_not_found' };
  }
  const truthBinding = resolveStoredArtifactTruthBinding(result, filename);
  if (!truthBinding.ok) return truthBinding;

  const storedResultDir = typeof result.resultDir === 'string'
    ? result.resultDir
    : typeof result.outputDir === 'string'
      ? result.outputDir
      : null;
  if (!storedResultDir || path.resolve(storedResultDir) !== storedResultDir) {
    return { ok: false, error: 'file_not_found' };
  }

  const allowedRoots = job.project_id
    ? [layout && layout.jobRoot, layout && layout.outputDir]
      .filter(Boolean)
      .map((root) => path.resolve(root))
    : exactLegacyResultRoots(job.id, jobsDir);
  const resultDir = path.resolve(storedResultDir);
  if (!allowedRoots.includes(resultDir)) {
    return { ok: false, error: 'file_not_found' };
  }

  try {
    const realRoot = fs.realpathSync(resultDir);
    const expectedRealRoot = expectedPhysicalResultRoot({ job, layout, jobsDir, resultDir });
    if (realRoot !== expectedRealRoot || !fs.statSync(realRoot).isDirectory()) {
      return { ok: false, error: 'file_not_found' };
    }
    const candidate = path.join(resultDir, filename);
    if (path.dirname(candidate) !== resultDir) return { ok: false, error: 'bad_path' };
    const realFile = fs.realpathSync(candidate);
    const fileStat = fs.statSync(realFile);
    if (path.dirname(realFile) !== realRoot || !fileStat.isFile()) {
      return { ok: false, error: 'file_not_found' };
    }
    return {
      ok: true,
      filePath: realFile,
      resultDir,
      fileIdentity: resultFileIdentity(fileStat),
      expectedSha256: truthBinding.expectedSha256,
    };
  } catch {
    return { ok: false, error: 'file_not_found' };
  }
}

/**
 * Open exactly the file that passed the authorization realpath checks. Sending
 * the path through Express after that check would re-resolve it and allow a
 * rename/symlink race. The caller owns the returned descriptor on success.
 */
async function openVerifiedAuthorizedToolResultFile(resolved) {
  if (!resolved || !resolved.ok || !resolved.filePath || !resolved.fileIdentity) {
    return { ok: false, error: 'file_not_found' };
  }

  let fd = null;
  try {
    const noFollow = Number.isInteger(fs.constants.O_NOFOLLOW) ? fs.constants.O_NOFOLLOW : 0;
    fd = fs.openSync(resolved.filePath, fs.constants.O_RDONLY | noFollow);
    const openedStat = fs.fstatSync(fd);
    if (!openedStat.isFile() || !hasSameResultFileIdentity(openedStat, resolved.fileIdentity)) {
      fs.closeSync(fd);
      return { ok: false, error: 'file_not_found' };
    }
    const sourceFd = fd;
    fd = null;
    const snapshot = await createVerifiedFileSnapshot(sourceFd, {
      expectedIdentity: resolved.fileIdentity,
      expectedSha256: resolved.expectedSha256,
    });
    return {
      ok: true,
      fd: snapshot.fd,
      stat: snapshot.stat,
      verification: snapshot.verification,
      actualSha256: resolved.expectedSha256 ? snapshot.sha256 : null,
    };
  } catch (error) {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch {}
    }
    if (error?.code === 'verified_snapshot_hash_mismatch') {
      return { ok: false, error: 'artifact_truth_drift' };
    }
    return { ok: false, error: 'file_not_found' };
  }
}

/**
 * The tools HTTP contract accepts a flat `filename -> base64` map. Tool
 * scripts resolve their inputs directly from the job root; directory uploads
 * are not part of that contract. Resolve every key before writing so a bad
 * key cannot escape the job sandbox or leave a partial upload behind.
 */
function resolveUploadedFilePath(jobDir, key) {
  if (typeof jobDir !== 'string' || !jobDir || jobDir.includes('\0')) {
    return { ok: false, error: '上传目录无效。' };
  }
  if (typeof key !== 'string' || !key || key.includes('\0')) {
    return { ok: false, error: '上传文件名无效。' };
  }

  // Reject both platform separator syntaxes. This is deliberately stricter
  // than a containment-only check because nested upload paths are unsupported.
  if (
    key.includes('/') ||
    key.includes('\\') ||
    key === '.' ||
    key === '..' ||
    path.isAbsolute(key) ||
    path.win32.isAbsolute(key) ||
    /^[A-Za-z]:/.test(key)
  ) {
    return { ok: false, error: '上传文件名不能包含路径。' };
  }
  if (isInternalArtifactName(key)) {
    return { ok: false, error: '上传文件名与任务内部控制文件冲突。' };
  }

  const root = path.resolve(jobDir);
  const filePath = path.resolve(root, key);
  if (path.dirname(filePath) !== root) {
    return { ok: false, error: '上传文件路径超出任务目录。' };
  }
  return { ok: true, filePath, key };
}

function resolveUploadedFiles(jobDir, files) {
  if (files === undefined || files === null) return { ok: true, entries: [] };
  if (typeof files !== 'object' || Array.isArray(files) || Buffer.isBuffer(files)) {
    return { ok: false, error: '上传文件必须是文件名到 Base64 内容的映射。' };
  }
  const prototype = Object.getPrototypeOf(files);
  if (prototype !== Object.prototype && prototype !== null) {
    return { ok: false, error: '上传文件必须是文件名到 Base64 内容的映射。' };
  }

  const entries = [];
  for (const [key, fileData] of Object.entries(files)) {
    const resolved = resolveUploadedFilePath(jobDir, key);
    if (!resolved.ok) return resolved;
    if (typeof fileData !== 'string') {
      return { ok: false, error: `文件 "${key}" 的上传内容无效。` };
    }
    entries.push({ ...resolved, fileData });
  }
  return { ok: true, entries };
}

function writeUploadedFiles(jobDir, files) {
  const resolved = resolveUploadedFiles(jobDir, files);
  if (!resolved.ok) return resolved;

  for (const entry of resolved.entries) {
    fs.writeFileSync(entry.filePath, Buffer.from(entry.fileData, 'base64'));
  }
  return resolved;
}

function validateUploadedFiles(toolId, jobDir, files) {
  const resolvedFiles = resolveUploadedFiles(jobDir, files);
  if (!resolvedFiles.ok) return resolvedFiles.error;
  const csvTools = [
    'deseq2',
    'go-kegg',
    'gsea',
    'km-survival',
    'lasso-cox',
    'bindea-immune',
    'wgcna',
    'complexheatmap',
  ];

  for (const { key, filePath } of resolvedFiles.entries) {
    if (!fs.existsSync(filePath)) continue;

    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(4096);
    const bytesRead = fs.readSync(fd, buf, 0, 4096, 0);
    fs.closeSync(fd);
    const head = buf.slice(0, bytesRead).toString('utf-8');

    if (csvTools.includes(toolId) && head.includes('\0')) {
      return `文件 "${key}" 似乎是二进制文件（如 Excel .xlsx），请转换为 CSV 或 TSV 格式后重新上传。提示：在 Excel 中"另存为" → 选择 CSV (UTF-8) 格式。`;
    }

    if (csvTools.includes(toolId)) {
      const lines = head.split(/\r?\n/).filter((line) => line.trim());
      if (lines.length < 2) {
        return `文件 "${key}" 内容为空或只有表头，需要至少包含 1 行数据。`;
      }
      const firstLine = lines[0];
      const sep = firstLine.includes('\t') ? '\t' : ',';
      const headerCols = firstLine.split(sep).length;
      // GO/KEGG explicitly accepts a one-column gene list (`gene` header);
      // the other CSV tools require at least two columns.
      const acceptsSingleColumnGeneList = toolId === 'go-kegg';
      if (headerCols < 2 && !acceptsSingleColumnGeneList) {
        return `文件 "${key}" 只检测到 1 列。请确认分隔符是逗号(CSV)或制表符(TSV)，不是分号或空格。`;
      }
      const dataCols = lines[1].split(sep).length;
      if (Math.abs(dataCols - headerCols) > 1) {
        return `文件 "${key}" 格式异常：表头有 ${headerCols} 列，但第一行数据有 ${dataCols} 列。请检查 CSV 格式是否正确。`;
      }
    }

    const stat = fs.statSync(filePath);
    if (
      stat.size > 100 * 1024 * 1024 &&
      toolId !== 'seurat-standard' &&
      toolId !== 'cellchat'
    ) {
      return `文件 "${key}" 大小为 ${Math.round(stat.size / 1024 / 1024)}MB，超过推荐上限(100MB)。大文件可能导致分析超时。建议：筛选基因或样本后重试。`;
    }
  }
  return null;
}

function hydrateExecutionJob(row) {
  if (!row || typeof row !== 'object') return null;
  let params = {};
  try {
    params = row.params_json
      ? (typeof row.params_json === 'string' ? JSON.parse(row.params_json) : row.params_json)
      : {};
  } catch {
    params = {};
  }
  return { ...row, params };
}

/**
 * Plugin scripts historically use either `<job>/output` or the isolated Job
 * root as their result directory. Both locations are server-owned; select one
 * only from a produced manifest or an exact declared artifact filename.
 */
function resolveProducedResultDirectory({ jobDir, outputDir, expectedArtifacts = [] }) {
  const resultRoots = [path.resolve(outputDir), path.resolve(jobDir)];
  const manifestNames = ['manifest.json', 'artifact-manifest.json'];
  for (const root of resultRoots) {
    for (const name of manifestNames) {
      const candidate = path.join(root, name);
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return { resultDir: root, manifestPath: candidate, reason: 'manifest' };
      }
    }
  }
  const declaredNames = expectedArtifacts
    .map((artifact) => artifact && (artifact.filename || artifact.name))
    .filter((name) => typeof name === 'string' && name === path.basename(name) && !name.includes('\0'));
  for (const root of resultRoots) {
    if (declaredNames.some((name) => {
      const candidate = path.join(root, name);
      return fs.existsSync(candidate) && fs.statSync(candidate).isFile();
    })) {
      return { resultDir: root, manifestPath: path.join(root, 'manifest.json'), reason: 'declared_artifact' };
    }
  }
  return {
    resultDir: path.resolve(outputDir),
    manifestPath: path.join(path.resolve(outputDir), 'manifest.json'),
    reason: 'standard_default',
  };
}


module.exports = {
  declaredResultFilenames,
  resolveStoredArtifactTruthBinding,
  resolveAuthorizedToolResultFile,
  openVerifiedAuthorizedToolResultFile,
  resolveUploadedFilePath,
  resolveUploadedFiles,
  writeUploadedFiles,
  validateUploadedFiles,
  hydrateExecutionJob,
  resolveProducedResultDirectory,
};
