const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ARTIFACT_TRUTH_VERSION = 1;
const STAGED_INPUT_EXCLUSION_POLICY = 'server_staged_inputs_v1';
const SHA256_BUFFER_BYTES = 1024 * 1024;
const INTERNAL_FILES = new Set([
  'params.json',
  'run-script.R',
  'run-script.py',
  '_biof3-theme.R',
  'report-template.html',
  'manifest.json',
  'artifact-manifest.json',
  'provenance.json',
  'delivery-manifest.json',
]);
const INTERNAL_FILE_NAMES = new Set(Array.from(INTERNAL_FILES, (name) => name.toLowerCase()));

function isSafeFlatFilename(value) {
  return typeof value === 'string'
    && value.length > 0
    && !value.includes('\0')
    && !value.includes('/')
    && !value.includes('\\')
    && value !== '.'
    && value !== '..'
    && !path.isAbsolute(value)
    && !path.win32.isAbsolute(value)
    && !/^[A-Za-z]:/.test(value)
    && path.basename(value) === value;
}

function isInternalArtifactName(value) {
  return isSafeFlatFilename(value) && INTERNAL_FILE_NAMES.has(value.toLowerCase());
}

function artifactContentTypeHint(filePath) {
  const extension = path.extname(String(filePath || '')).toLowerCase();
  return extension || 'application/octet-stream';
}

function sha256File(filePath, io = fs) {
  const fd = io.openSync(filePath, 'r');
  try {
    return sha256FileDescriptor(fd, io);
  } finally {
    io.closeSync(fd);
  }
}

function sha256FileDescriptor(fd, io = fs) {
  const hash = crypto.createHash('sha256');
  const buffer = Buffer.allocUnsafe(SHA256_BUFFER_BYTES);
  let position = 0;
  while (true) {
    const bytesRead = io.readSync(fd, buffer, 0, buffer.length, position);
    if (bytesRead === 0) break;
    hash.update(buffer.subarray(0, bytesRead));
    position += bytesRead;
  }
  return hash.digest('hex');
}

function captureStagedInputSnapshots(filePaths = []) {
  return (filePaths || []).map((filePath) => {
    const resolvedPath = fs.realpathSync(filePath);
    const stat = fs.statSync(resolvedPath);
    if (!stat.isFile()) throw new Error(`staged_input_not_regular_file:${path.basename(resolvedPath)}`);
    return {
      path: resolvedPath,
      name: path.basename(resolvedPath),
      sizeBytes: stat.size,
      sha256: sha256File(resolvedPath),
    };
  });
}

function stagedInputMutationIssues(snapshots = []) {
  return (snapshots || []).flatMap((snapshot) => {
    let currentPath = null;
    let currentSize = null;
    let currentSha256 = null;
    try {
      currentPath = fs.realpathSync(snapshot.path);
      const stat = fs.statSync(currentPath);
      if (stat.isFile()) {
        currentSize = stat.size;
        currentSha256 = sha256File(currentPath);
      }
    } catch {}
    if (currentPath === snapshot.path
        && currentSize === snapshot.sizeBytes
        && currentSha256 === snapshot.sha256) return [];
    return [{
      code: 'staged_input_mutated',
      severity: 'error',
      recoverable: true,
      required: true,
      artifactId: null,
      artifactName: snapshot.name || null,
      message: `Server-staged input ${snapshot.name || 'unknown'} changed during tool execution.`,
      suggestedFix: '插件必须把派生产物写入独立输出文件，不能覆盖、删除或修改服务器暂存输入。',
    }];
  });
}

function artifactName(item) {
  if (!item || typeof item !== 'object') return '';
  const value = item.filename || item.name || item.path;
  return value ? path.basename(String(value)) : '';
}

function artifactId(item) {
  if (!item || typeof item !== 'object') return '';
  return String(item.id || '').trim();
}

function inferArtifactType(item, name) {
  const explicit = String((item && (item.type || item.kind)) || '').toLowerCase();
  if (explicit === 'image') return 'plot';
  if (explicit === 'dataframe') return 'table';
  if (explicit === 'html') return 'report';
  if (['report', 'plot', 'table', 'text', 'json', 'data', 'file'].includes(explicit)) {
    return explicit;
  }
  const lower = String(name || '').toLowerCase();
  if (/\.html?$/.test(lower)) return 'report';
  if (/\.(png|jpg|jpeg|gif|svg|webp|pdf)$/.test(lower)) return 'plot';
  if (/\.(csv|tsv|xlsx?)$/.test(lower)) return 'table';
  if (/\.json$/.test(lower)) return 'json';
  if (/\.(txt|log|md)$/.test(lower)) return 'text';
  return 'file';
}

function artifactTypesCompatible(declaredType, detectedType) {
  if (!declaredType || declaredType === 'file' || !detectedType || detectedType === 'file') return true;
  if (declaredType === detectedType) return true;
  return new Set([declaredType, detectedType]).size === 2 &&
    ['data', 'table'].includes(declaredType) && ['data', 'table'].includes(detectedType);
}

function normalizeExcludedArtifactNames({
  resultDir,
  excludedArtifactPaths = [],
  trustedExcludedArtifactNames = [],
} = {}) {
  const names = new Set();
  const root = resultDir ? path.resolve(resultDir) : null;
  if (root) {
    for (const candidate of excludedArtifactPaths || []) {
      if (typeof candidate !== 'string' || !candidate || candidate.includes('\0')) continue;
      const resolved = path.resolve(candidate);
      if (path.dirname(resolved) !== root) continue;
      const name = path.basename(resolved);
      if (isSafeFlatFilename(name) && !isInternalArtifactName(name)) names.add(name);
    }
  }
  for (const candidate of trustedExcludedArtifactNames || []) {
    if (!isSafeFlatFilename(candidate) || isInternalArtifactName(candidate)) continue;
    names.add(candidate);
  }
  return names;
}

function listActualFiles(resultDir, excludedNames = new Set()) {
  if (!resultDir || !fs.existsSync(resultDir)) return [];
  return fs.readdirSync(resultDir, { withFileTypes: true })
    .filter((entry) =>
      entry.isFile() && !isInternalArtifactName(entry.name) && !excludedNames.has(entry.name)
    )
    .map((entry) => entry.name)
    .sort();
}

function collectDeclaredItems(result, excludedNames = new Set()) {
  const sources = [
    ['manifest.artifacts', result && result.manifest && result.manifest.artifacts],
    ['manifest.outputs', result && result.manifest && result.manifest.outputs],
    ['manifest.files', result && result.manifest && result.manifest.files],
    ['artifacts', result && result.artifacts],
    ['outputs', result && result.outputs],
    ['files', result && result.files],
  ];
  const byName = new Map();
  for (const [source, items] of sources) {
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      const name = artifactName(item);
      if (!name || isInternalArtifactName(name) || excludedNames.has(name)) continue;
      const current = byName.get(name) || {};
      byName.set(name, { ...current, ...item, name, filename: name, _source: source });
    }
  }
  return Array.from(byName.values());
}

function expectedMatch(expected, declared, actualFiles) {
  const expectedName = artifactName(expected);
  const expectedId = artifactId(expected);
  if (expectedName) {
    return declared.find((item) => artifactName(item) === expectedName) ||
      (actualFiles.includes(expectedName) ? { ...expected, name: expectedName, filename: expectedName } : null);
  }
  if (!expectedId) return null;
  const byId = declared.find((item) => artifactId(item) === expectedId);
  if (byId) return byId;
  const byStem = actualFiles.find((name) => path.parse(name).name === expectedId);
  return byStem ? { ...expected, name: byStem, filename: byStem } : null;
}

function sanitizeManifest(manifest, validNames) {
  if (!manifest || typeof manifest !== 'object') return manifest || null;
  const next = { ...manifest };
  for (const key of ['artifacts', 'outputs', 'files']) {
    if (Array.isArray(next[key])) {
      next[key] = next[key].filter((item) => validNames.has(artifactName(item)));
    }
  }
  if (Array.isArray(next.sections)) {
    next.sections = next.sections
      .map((section) => {
        const names = Array.isArray(section && section.artifactNames)
          ? section.artifactNames.filter((name) => validNames.has(path.basename(String(name))))
          : [];
        return { ...section, artifactNames: names };
      })
      .filter((section) => section.artifactNames.length > 0);
  }
  return next;
}

function reconcileArtifactTruth({
  result = {},
  resultDir,
  expectedArtifacts = [],
  canonicalizePath = null,
  excludedArtifactPaths = [],
  trustedExcludedArtifactNames = [],
  stagedInputSnapshots = [],
  trustedStagedInputVerification = null,
} = {}) {
  const excludedNames = normalizeExcludedArtifactNames({
    resultDir,
    excludedArtifactPaths,
    trustedExcludedArtifactNames,
  });
  const unfilteredActualFiles = listActualFiles(resultDir);
  const unfilteredDeclared = collectDeclaredItems(result);
  const actualFiles = listActualFiles(resultDir, excludedNames);
  const actualSet = new Set(actualFiles);
  const declared = collectDeclaredItems(result, excludedNames);
  const expected = Array.isArray(expectedArtifacts) ? expectedArtifacts : [];
  const requiredNames = new Set();
  const inputMutationIssues = stagedInputSnapshots.length > 0
    ? stagedInputMutationIssues(stagedInputSnapshots)
    : trustedStagedInputVerification?.integrity === 'mutated'
      ? [{
          code: 'staged_input_mutated',
          severity: 'error',
          recoverable: true,
          required: true,
          artifactId: null,
          artifactName: null,
          message: 'A server-staged input changed during tool execution.',
          suggestedFix: '从受信执行路径重新运行任务，插件不得修改服务器暂存输入。',
        }]
      : [];
  const issues = [...inputMutationIssues];

  for (const item of expected) {
    const required = item && item.required !== false;
    const excludedMatch = expectedMatch(item, unfilteredDeclared, unfilteredActualFiles);
    const excludedName = artifactName(excludedMatch);
    if (excludedName && excludedNames.has(excludedName)) {
      issues.push({
        code: 'artifact_input_output_collision',
        severity: 'error',
        recoverable: true,
        required,
        artifactId: artifactId(item) || null,
        artifactName: excludedName,
        message: `Declared output ${excludedName} is the server-staged input file for this Job.`,
        suggestedFix: '让插件将输出写到不同文件名或独立 output 目录后重新执行任务。',
      });
      continue;
    }
    const match = expectedMatch(item, declared, actualFiles);
    if (match) {
      const name = artifactName(match);
      if (required && name) requiredNames.add(name);
      const declaredIndex = declared.findIndex((entry) => artifactName(entry) === name);
      if (declaredIndex >= 0) {
        // The runtime may discover a file before the plugin output contract is
        // applied. Preserve runtime fields, but restore the stable contract id,
        // label and type so downstream delivery coverage never depends on a
        // generated artifact_N identifier.
        declared[declaredIndex] = { ...declared[declaredIndex], ...item, name, filename: name };
      } else {
        declared.push({ ...match, ...item, name, filename: name });
      }
      continue;
    }
    if (required) {
      issues.push({
        code: 'required_artifact_missing',
        severity: 'error',
        recoverable: true,
        required: true,
        artifactId: artifactId(item) || null,
        artifactName: artifactName(item) || null,
        message: `Required artifact ${artifactId(item) || artifactName(item) || 'unknown'} was not produced.`,
        suggestedFix: '检查工具输出约定和运行日志，修复后重新执行任务。',
      });
    }
  }

  const declaredNames = new Set(declared.map(artifactName).filter(Boolean));
  for (const name of actualFiles) {
    if (!declaredNames.has(name)) declared.push({ name, filename: name, _source: 'disk' });
  }

  const validArtifacts = [];
  for (const [index, item] of declared.entries()) {
    const name = artifactName(item);
    if (!name) continue;
    const required = requiredNames.has(name) || item.required === true;
    const filePath = path.join(resultDir, name);
    if (!actualSet.has(name) || !fs.existsSync(filePath)) {
      issues.push({
        code: required ? 'required_artifact_missing' : 'artifact_missing',
        severity: required ? 'error' : 'warning',
        recoverable: true,
        required,
        artifactId: artifactId(item) || null,
        artifactName: name,
        source: item._source || null,
        message: `${required ? 'Required' : 'Declared'} artifact ${name} does not exist on disk.`,
        suggestedFix: required
          ? '检查工具输出约定和运行日志，修复后重新执行任务。'
          : '从 manifest 中移除失效声明，或重新生成该可选产物。',
      });
      continue;
    }
    let stat = null;
    try { stat = fs.statSync(filePath); } catch {}
    if (!stat || !stat.isFile() || stat.size === 0) {
      issues.push({
        code: required ? 'required_artifact_empty' : 'artifact_empty',
        severity: required ? 'error' : 'warning',
        recoverable: true,
        required,
        artifactId: artifactId(item) || null,
        artifactName: name,
        source: item._source || null,
        message: `${required ? 'Required' : 'Declared'} artifact ${name} is empty or unreadable.`,
        suggestedFix: '检查运行日志并重新生成该产物。',
      });
      continue;
    }
    const type = inferArtifactType(item, name);
    const declaredRawType = String((item && (item.type || item.kind)) || '').toLowerCase();
    const declaredType = declaredRawType ? inferArtifactType(item, '') : '';
    const detectedType = inferArtifactType(null, name);
    if (!artifactTypesCompatible(declaredType, detectedType)) {
      issues.push({
        code: 'artifact_type_mismatch',
        severity: required ? 'error' : 'warning',
        recoverable: true,
        required,
        artifactId: artifactId(item) || null,
        artifactName: name,
        source: item._source || null,
        message: `Artifact ${name} is declared as ${declaredType} but detected as ${detectedType}.`,
        suggestedFix: '修正 manifest 的 artifact type，或让工具输出符合声明类型的文件。',
      });
    }
    const label = item.label || item.title || name;
    const normalized = {
      ...item,
      id: artifactId(item) || `artifact_${index + 1}`,
      name,
      filename: name,
      type,
      label,
      title: item.title || label,
      path: filePath,
      size: stat.size,
      sha256: sha256File(filePath),
      required,
      preview: item.preview !== false,
      download: item.download !== false,
    };
    delete normalized._source;
    if (typeof canonicalizePath === 'function') {
      const rawCanonical = item.canonicalPath || canonicalizePath(filePath);
      normalized.canonicalPath =
        typeof rawCanonical === 'string' ? rawCanonical.split(path.sep).join('/') : rawCanonical;
    }
    validArtifacts.push(normalized);
  }

  const uniqueIssues = Array.from(new Map(
    issues.map((issue) => [`${issue.code}:${issue.artifactId || ''}:${issue.artifactName || ''}`, issue])
  ).values());
  const blocking = uniqueIssues.some((issue) => issue.severity === 'error');
  const validNames = new Set(validArtifacts.map((item) => item.name));
  const artifactTruth = {
    artifactTruthVersion: ARTIFACT_TRUTH_VERSION,
    status: blocking ? 'blocked' : uniqueIssues.length > 0 ? 'degraded' : 'valid',
    blocking,
    resultDir: resultDir ? path.resolve(resultDir) : null,
    declaredCount: declaredNames.size,
    actualCount: actualFiles.length,
    validCount: validArtifacts.length,
    issueCount: uniqueIssues.length,
    excludedInputCount: excludedNames.size,
    excludedInputNames: Array.from(excludedNames).sort(),
    exclusionPolicy: excludedNames.size > 0 ? STAGED_INPUT_EXCLUSION_POLICY : null,
    stagedInputSnapshotCount: stagedInputSnapshots.length > 0
      ? stagedInputSnapshots.length
      : Number(trustedStagedInputVerification?.snapshotCount || 0),
    stagedInputIntegrity: stagedInputSnapshots.length > 0
      ? inputMutationIssues.length > 0 ? 'mutated' : 'verified'
      : trustedStagedInputVerification?.integrity || null,
    checkedAt: new Date().toISOString(),
  };
  const cleanResult = {
    ...result,
    artifactSchemaVersion: result.artifactSchemaVersion || 1,
    artifactTruth,
    artifactDiagnostics: uniqueIssues,
    artifacts: validArtifacts,
    outputs: validArtifacts.map((item) => ({ ...item })),
    files: validArtifacts.map((item) => ({ ...item })),
    manifest: sanitizeManifest(result.manifest, validNames),
  };
  return { result: cleanResult, artifacts: validArtifacts, issues: uniqueIssues, artifactTruth, blocking };
}

module.exports = {
  ARTIFACT_TRUTH_VERSION,
  SHA256_BUFFER_BYTES,
  STAGED_INPUT_EXCLUSION_POLICY,
  artifactName,
  artifactContentTypeHint,
  inferArtifactType,
  artifactTypesCompatible,
  isInternalArtifactName,
  isSafeFlatFilename,
  normalizeExcludedArtifactNames,
  captureStagedInputSnapshots,
  stagedInputMutationIssues,
  sha256FileDescriptor,
  sha256File,
  reconcileArtifactTruth,
};
