const fs = require('fs');
const path = require('path');

const ARTIFACT_TRUTH_VERSION = 1;
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

function listActualFiles(resultDir) {
  if (!resultDir || !fs.existsSync(resultDir)) return [];
  return fs.readdirSync(resultDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !INTERNAL_FILES.has(entry.name))
    .map((entry) => entry.name)
    .sort();
}

function collectDeclaredItems(result) {
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
      if (!name || INTERNAL_FILES.has(name)) continue;
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
} = {}) {
  const actualFiles = listActualFiles(resultDir);
  const actualSet = new Set(actualFiles);
  const declared = collectDeclaredItems(result);
  const expected = Array.isArray(expectedArtifacts) ? expectedArtifacts : [];
  const requiredNames = new Set();
  const issues = [];

  for (const item of expected) {
    const required = item && item.required !== false;
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
      required,
      preview: item.preview !== false,
      download: item.download !== false,
    };
    delete normalized._source;
    if (typeof canonicalizePath === 'function') {
      normalized.canonicalPath = item.canonicalPath || canonicalizePath(filePath);
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
  artifactName,
  inferArtifactType,
  artifactTypesCompatible,
  reconcileArtifactTruth,
};
