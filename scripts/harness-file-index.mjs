#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import {
  rankHarnessTaskPacks,
  selectHarnessTaskPack,
} from './harness-task-packs.mjs';

export { rankHarnessTaskPacks, selectHarnessTaskPack } from './harness-task-packs.mjs';

const moduleRequire = createRequire(import.meta.url);
const { createExecutionContext: createCanonicalExecutionContext } = moduleRequire(
  '../vendor/biof3-core/shared-backend/execution-context.js',
);

const DEFAULT_MAX_SAMPLE_BYTES = 256 * 1024;
const DEFAULT_MAX_FILES = 500;
const DEFAULT_CACHE_NAME = '.biof3-harness-index.json';
const SKIP_DIRS = new Set([
  '.git',
  '.cursor',
  'node_modules',
  'dist',
  'build',
  '.vite',
  '.cache',
  '__pycache__',
]);

const TEXT_EXTS = new Set(['.txt', '.md', '.log', '.r', '.py', '.js', '.ts', '.tsx', '.json']);
const TABLE_EXTS = new Set(['.csv', '.tsv', '.tab']);
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.svg', '.webp', '.pdf']);

function stableNow() {
  return new Date().toISOString();
}

function safeRelative(root, target) {
  const rel = path.relative(root, target);
  return rel || path.basename(target);
}

function normalizePath(inputPath) {
  return path.resolve(String(inputPath || '.'));
}

function normalizeCanonicalPath(inputPath) {
  const raw = String(inputPath || '/');
  const normalized = raw.replace(/\\/g, '/').replace(/\/+/g, '/');
  return normalized.startsWith('/') ? path.posix.normalize(normalized) : path.posix.normalize('/' + normalized);
}

function normalizePathMappings(mappings = []) {
  return mappings
    .map((mapping) => {
      const localRoot = mapping.localRoot || mapping.hostRoot || mapping.root;
      const canonicalRoot = mapping.canonicalRoot || mapping.mountRoot || mapping.containerRoot;
      if (!localRoot || !canonicalRoot) return null;
      return {
        localRoot: normalizePath(localRoot),
        canonicalRoot: normalizeCanonicalPath(canonicalRoot),
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.localRoot.length - a.localRoot.length);
}

function relativePosix(fromRoot, targetPath) {
  return path.relative(fromRoot, targetPath).split(path.sep).filter(Boolean).join('/');
}

function mapLocalToCanonical(localPath, mappings = []) {
  const normalized = normalizePath(localPath);
  const mapping = mappings.find(
    (item) => normalized === item.localRoot || normalized.startsWith(item.localRoot + path.sep),
  );
  if (!mapping) return normalized.replace(/\\/g, '/');
  const rel = relativePosix(mapping.localRoot, normalized);
  return normalizeCanonicalPath(rel ? path.posix.join(mapping.canonicalRoot, rel) : mapping.canonicalRoot);
}

function mapCanonicalToLocal(canonicalPath, mappings = []) {
  const normalized = normalizeCanonicalPath(canonicalPath);
  const mapping = mappings.find(
    (item) => normalized === item.canonicalRoot || normalized.startsWith(item.canonicalRoot + '/'),
  );
  if (!mapping) return normalizePath(normalized);
  const rel = path.posix.relative(mapping.canonicalRoot, normalized);
  return normalizePath(rel ? path.join(mapping.localRoot, ...rel.split('/').filter(Boolean)) : mapping.localRoot);
}

function pathExists(inputPath) {
  try {
    return !!inputPath && fs.existsSync(inputPath);
  } catch {
    return false;
  }
}

function defaultDataDir() {
  return (
    process.env.BIOF3_LOCAL_DATA_DIR ||
    path.join(process.env.HOME || process.cwd(), 'Documents', 'BioF3-Local')
  );
}

function defaultJobsDir(dataDir = defaultDataDir()) {
  return (
    process.env.BIOF3_TOOL_JOBS_DIR ||
    path.join(process.env.BIOF3_LOCAL_RESULTS_DIR || path.join(dataDir, 'results'), 'tool-jobs')
  );
}

function safeJoinUnder(root, ...parts) {
  const normalizedRoot = normalizePath(root);
  const target = path.resolve(normalizedRoot, ...parts.map((part) => String(part || '')));
  if (target !== normalizedRoot && !target.startsWith(normalizedRoot + path.sep)) return null;
  return target;
}

function safeProjectSlug(name) {
  const slug = String(name || 'project')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || 'project';
}

function defaultProjectWorkspacePath(project, dataDir = defaultDataDir()) {
  const shortId = String(project?.id || 'local').replace(/^p_/, '').slice(0, 8);
  return path.join(dataDir, 'projects', `${safeProjectSlug(project?.name)}-${shortId}`);
}

function normalizeRuntimeName(runtime) {
  const value = typeof runtime === 'object' && runtime ? runtime.type || runtime.name : runtime;
  const name = String(value || 'shell').toLowerCase();
  if (['rscript', 'r'].includes(name)) return 'r';
  if (['python3', 'py', 'python'].includes(name)) return 'python';
  return name || 'shell';
}

function normalizeRuntimeCheck(runtime, value) {
  const name = normalizeRuntimeName(runtime);
  if (value && typeof value === 'object') {
    return {
      runtime: name,
      ready: value.ready !== false,
      command: value.command || value.path || null,
      reason: value.reason || null,
    };
  }
  return {
    runtime: name,
    ready: value !== false,
    command: null,
    reason: value === false ? 'runtime_not_configured' : null,
  };
}

function readSqliteRow(dbPath, sql, params = []) {
  if (!dbPath || !pathExists(dbPath)) return null;
  try {
    const require = createRequire(import.meta.url);
    const Database = require('better-sqlite3');
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      return db.prepare(sql).get(...params) || null;
    } finally {
      db.close();
    }
  } catch (error) {
    return {
      __dbError: error.message,
    };
  }
}

function inferKind(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (TABLE_EXTS.has(ext)) return ext === '.tsv' || ext === '.tab' ? 'tsv' : 'csv';
  if (ext === '.json') return 'json';
  if (IMAGE_EXTS.has(ext)) return 'binary';
  if (TEXT_EXTS.has(ext)) return 'text';
  if (['.rds', '.h5', '.h5ad', '.mtx', '.gz', '.zip', '.parquet', '.xlsx', '.xls'].includes(ext)) {
    return 'binary';
  }
  return 'unknown';
}

function inferRole(filePath, detection = {}) {
  const name = path.basename(filePath).toLowerCase();
  const headers = detection.table?.headers?.map((h) => h.toLowerCase()) || [];
  if (/manifest\.json$/.test(name)) return 'manifest';
  if (/summary|readme/.test(name)) return 'summary';
  if (headers.includes('gene') && (headers.includes('pvalue') || headers.includes('p_val'))) return 'deg_table';
  if (headers.includes('sample') && headers.includes('group')) return 'sample_metadata';
  if (/count|expr|expression|matrix/.test(name)) return 'expression_matrix';
  if (/group|metadata|meta|coldata|sample/.test(name)) return 'sample_metadata';
  if (/deg|diff|marker|result/.test(name)) return 'result_table';
  return detection.kind === 'csv' || detection.kind === 'tsv' ? 'table' : detection.kind;
}

function readSample(filePath, maxBytes = DEFAULT_MAX_SAMPLE_BYTES) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const stat = fs.fstatSync(fd);
    const length = Math.min(stat.size, maxBytes);
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, 0);
    return buffer.toString('utf8').replace(/^\uFEFF/, '');
  } finally {
    fs.closeSync(fd);
  }
}

function hashFile(filePath, maxBytes = 20 * 1024 * 1024) {
  const stat = fs.statSync(filePath);
  const hash = crypto.createHash('sha256');
  if (stat.size <= maxBytes) {
    hash.update(fs.readFileSync(filePath));
    return { sha256: hash.digest('hex'), mode: 'full' };
  }
  const fd = fs.openSync(filePath, 'r');
  try {
    const chunkSize = 1024 * 1024;
    const first = Buffer.alloc(chunkSize);
    const last = Buffer.alloc(chunkSize);
    fs.readSync(fd, first, 0, chunkSize, 0);
    fs.readSync(fd, last, 0, chunkSize, Math.max(0, stat.size - chunkSize));
    hash.update(first);
    hash.update(last);
    hash.update(String(stat.size));
    return { sha256: hash.digest('hex'), mode: 'sampled' };
  } finally {
    fs.closeSync(fd);
  }
}

function splitLine(line, delimiter) {
  const cells = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const next = line[i + 1];
    if (ch === '"' && quoted && next === '"') {
      current += '"';
      i++;
      continue;
    }
    if (ch === '"') {
      quoted = !quoted;
      continue;
    }
    if (ch === delimiter && !quoted) {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  cells.push(current.trim());
  return cells;
}

function detectDelimiter(text, explicitKind) {
  if (explicitKind === 'tsv') return '\t';
  const firstLines = text.split(/\r?\n/).slice(0, 8).filter(Boolean);
  const commaScore = firstLines.reduce((sum, line) => sum + splitLine(line, ',').length, 0);
  const tabScore = firstLines.reduce((sum, line) => sum + splitLine(line, '\t').length, 0);
  return tabScore > commaScore ? '\t' : ',';
}

function isNumeric(value) {
  if (value == null) return false;
  const text = String(value).trim();
  if (!text || ['na', 'nan', 'null', 'none'].includes(text.toLowerCase())) return false;
  return Number.isFinite(Number(text));
}

function summarizeTable(text, kind) {
  const delimiter = detectDelimiter(text, kind);
  const lines = text.split(/\r?\n/).filter((line) => line.trim()).slice(0, 80);
  if (!lines.length) {
    return {
      delimiter,
      headers: [],
      sampleRows: [],
      rowSampleCount: 0,
      columnCount: 0,
      columns: [],
      matrixOrientation: 'unknown',
    };
  }

  const rows = lines.map((line) => splitLine(line, delimiter));
  const headers = rows[0] || [];
  const dataRows = rows.slice(1);
  const columnCount = headers.length;
  const columns = headers.map((header, index) => {
    const values = dataRows.map((row) => row[index] ?? '');
    const missing = values.filter((value) => !String(value).trim()).length;
    const numeric = values.filter(isNumeric).length;
    return {
      name: header || `column_${index + 1}`,
      index,
      sampleValues: values.slice(0, 5),
      missingCount: missing,
      numericRatio: values.length ? numeric / values.length : 0,
      likelyType: values.length && numeric / values.length > 0.8 ? 'number' : 'string',
    };
  });

  const firstColumn = columns[0];
  const numericColumns = columns.slice(1).filter((col) => col.numericRatio > 0.8).length;
  const stringColumns = columns.filter((col) => col.likelyType === 'string').length;
  let matrixOrientation = 'unknown';
  const firstHeader = String(headers[0] || '').toLowerCase();
  if (
    columnCount >= 4 &&
    /sample|cell|barcode/.test(firstHeader) &&
    numericColumns >= Math.max(2, columnCount - 2)
  ) {
    matrixOrientation = 'rows_are_samples';
  } else if (columnCount >= 4 && firstColumn?.likelyType === 'string' && numericColumns >= Math.max(2, columnCount - 2)) {
    matrixOrientation = 'rows_are_features';
  } else if (columnCount >= 4 && stringColumns <= 2 && numericColumns >= Math.max(2, columnCount - 2)) {
    matrixOrientation = 'rows_are_samples';
  }

  return {
    delimiter,
    headers,
    sampleRows: dataRows.slice(0, 8),
    rowSampleCount: dataRows.length,
    columnCount,
    columns,
    matrixOrientation,
    hints: {
      hasSampleGroupColumns:
        headers.map((h) => h.toLowerCase()).includes('sample') &&
        headers.map((h) => h.toLowerCase()).includes('group'),
      hasDegColumns:
        headers.some((h) => /^gene$|symbol|gene_name/i.test(h)) &&
        headers.some((h) => /log2?fc|avg_log2fc/i.test(h)) &&
        headers.some((h) => /p[_-]?val|pvalue|padj/i.test(h)),
    },
  };
}

function summarizeJson(text) {
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return { valid: true, rootType: 'array', length: parsed.length, keys: [] };
    }
    if (parsed && typeof parsed === 'object') {
      return { valid: true, rootType: 'object', keys: Object.keys(parsed).slice(0, 50) };
    }
    return { valid: true, rootType: typeof parsed, keys: [] };
  } catch (error) {
    return { valid: false, error: error.message };
  }
}

function summarizeText(text) {
  const lines = text.split(/\r?\n/);
  return {
    lineCountSample: lines.length,
    preview: lines.slice(0, 12).join('\n').slice(0, 2000),
  };
}

export function detectFile(filePath, options = {}) {
  const absPath = normalizePath(filePath);
  const stat = fs.statSync(absPath);
  if (!stat.isFile()) throw new Error(`Not a file: ${absPath}`);
  const kind = inferKind(absPath);
  const hash = options.hash === false ? null : hashFile(absPath);
  const base = {
    path: absPath,
    name: path.basename(absPath),
    ext: path.extname(absPath).toLowerCase(),
    kind,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    hash,
    inspectedAt: stableNow(),
  };

  if (kind === 'binary' || stat.size === 0) {
    return { ...base, role: inferRole(absPath, { kind }), readable: false };
  }

  const sampleText = readSample(absPath, options.maxSampleBytes || DEFAULT_MAX_SAMPLE_BYTES);
  const detection = { kind, readable: true };
  if (kind === 'csv' || kind === 'tsv') {
    detection.table = summarizeTable(sampleText, kind);
  } else if (kind === 'json') {
    detection.json = summarizeJson(sampleText);
    detection.text = summarizeText(sampleText);
  } else {
    detection.text = summarizeText(sampleText);
  }
  return {
    ...base,
    ...detection,
    role: inferRole(absPath, detection),
  };
}

export function walkDirectory(rootPath, options = {}) {
  const root = normalizePath(rootPath);
  const maxFiles = options.maxFiles || DEFAULT_MAX_FILES;
  const files = [];
  const stack = [root];
  while (stack.length && files.length < maxFiles) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        if (entry.name.startsWith('.') && options.includeHidden !== true) continue;
        stack.push(fullPath);
      } else if (entry.isFile()) {
        if (entry.name.startsWith('.') && options.includeHidden !== true) continue;
        files.push(fullPath);
        if (files.length >= maxFiles) break;
      }
    }
  }
  return files.sort();
}

export function indexDirectory(rootPath, options = {}) {
  const root = normalizePath(rootPath);
  const startedAt = stableNow();
  const files = walkDirectory(root, options);
  const cachePath = typeof options.cache === 'string' ? options.cache : options.cachePath;
  const cache =
    cachePath && fs.existsSync(path.isAbsolute(cachePath) ? cachePath : path.join(root, cachePath))
      ? (() => {
          try {
            const resolvedCachePath = path.isAbsolute(cachePath) ? cachePath : path.join(root, cachePath);
            const loaded = readIndexCache(resolvedCachePath);
            return loaded && normalizePath(loaded.root) === root ? loaded : null;
          } catch {
            return null;
          }
        })()
      : null;
  const cachedEntries = new Map(
    (cache?.entries || []).map((entry) => [
      entry.relativePath || safeRelative(root, entry.path || entry.name || ''),
      entry,
    ])
  );
  const entries = [];
  const errors = [];
  const seenRelativePaths = new Set();
  let reusedEntries = 0;
  let updatedEntries = 0;
  for (const file of files) {
    const relativePath = safeRelative(root, file);
    seenRelativePaths.add(relativePath);
    try {
      const stat = fs.statSync(file);
      const cached = cachedEntries.get(relativePath);
      const canReuse =
        cached &&
        cached.size === stat.size &&
        cached.mtimeMs === stat.mtimeMs &&
        (options.hash === false || cached.hash || !options.hash);
      if (canReuse) {
        entries.push({
          ...cached,
          path: file,
          relativePath,
          inspectedAt: cached.inspectedAt || startedAt,
        });
        reusedEntries += 1;
        continue;
      }
      const detection = detectFile(file, options);
      entries.push({
        ...detection,
        relativePath,
      });
      updatedEntries += 1;
    } catch (error) {
      errors.push({ path: file, error: error.message });
    }
  }

  const byKind = {};
  const byRole = {};
  for (const entry of entries) {
    byKind[entry.kind] = (byKind[entry.kind] || 0) + 1;
    byRole[entry.role] = (byRole[entry.role] || 0) + 1;
  }
  const removedEntries = cache
    ? (cache.entries || []).filter((entry) => {
        const rel = entry.relativePath || safeRelative(root, entry.path || entry.name || '');
        return !seenRelativePaths.has(rel);
      }).length
    : 0;

  return {
    harnessIndexVersion: 1,
    root,
    createdAt: startedAt,
    fileCount: entries.length,
    truncated: files.length >= (options.maxFiles || DEFAULT_MAX_FILES),
    byKind,
    byRole,
    entries,
    errors,
    cacheStats: cache
      ? {
          cachePath: path.isAbsolute(cachePath) ? normalizePath(cachePath) : path.join(root, cachePath),
          hit: true,
          reusedEntries,
          updatedEntries,
          removedEntries,
          sourceCreatedAt: cache.createdAt || null,
        }
      : {
          hit: false,
          reusedEntries: 0,
          updatedEntries: entries.length,
          removedEntries: 0,
        },
  };
}

function normalizeAcceptList(input = {}) {
  const accept = input.accept || input.extensions || input.fileTypes || '';
  if (Array.isArray(accept)) return accept.map((item) => String(item).toLowerCase());
  return String(accept)
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function textForInput(input = {}) {
  return [input.id, input.label, input.name, input.description]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export function scoreEntryForInput(input, entry) {
  if (!entry || !input) return { score: 0, reasons: [] };
  const inputType = String(input.type || '').toLowerCase();
  if (inputType && inputType !== 'file' && inputType !== 'path') return { score: 0, reasons: [] };

  let score = 0;
  const reasons = [];
  const acceptList = normalizeAcceptList(input);
  const ext = String(entry.ext || '').toLowerCase();
  const role = String(entry.role || '').toLowerCase();
  const inputText = textForInput(input);
  const headers = entry.table?.headers?.map((header) => String(header).toLowerCase()) || [];

  if (acceptList.length) {
    const accepted = acceptList.some((item) => {
      if (item.startsWith('.')) return item === ext;
      if (item.includes('/')) return item.includes(entry.kind);
      return item === entry.kind || item === ext.replace(/^\./, '');
    });
    if (!accepted) return { score: 0, reasons: ['extension_mismatch'] };
    score += 20;
    reasons.push('accepted_extension');
  }

  if (inputText.includes('deg') || inputText.includes('差异')) {
    if (role === 'deg_table') {
      score += 55;
      reasons.push('role_deg_table');
    } else if (entry.table?.hints?.hasDegColumns) {
      score += 45;
      reasons.push('deg_columns_detected');
    }
  }

  if (/expr|expression|matrix|表达|矩阵|count/.test(inputText)) {
    if (role === 'expression_matrix') {
      score += 55;
      reasons.push('role_expression_matrix');
    } else if (entry.table?.matrixOrientation && entry.table.matrixOrientation !== 'unknown') {
      score += 35;
      reasons.push(`matrix_${entry.table.matrixOrientation}`);
    }
  }

  if (/group|metadata|sample|分组|样本/.test(inputText)) {
    if (role === 'sample_metadata') {
      score += 55;
      reasons.push('role_sample_metadata');
    } else if (entry.table?.hints?.hasSampleGroupColumns) {
      score += 45;
      reasons.push('sample_group_columns_detected');
    }
  }

  if (headers.length) {
    const inputTokens = inputText.split(/[^a-z0-9_\u4e00-\u9fa5]+/).filter(Boolean);
    const matchingHeaders = headers.filter((header) => inputTokens.some((token) => token.length > 2 && header.includes(token)));
    if (matchingHeaders.length) {
      score += Math.min(20, matchingHeaders.length * 5);
      reasons.push('header_name_overlap');
    }
  }

  if (entry.readable) {
    score += 5;
    reasons.push('readable');
  }

  return { score, reasons };
}

export function suggestInputBindings(manifest, index, options = {}) {
  const minScore = options.minScore ?? 25;
  const maxCandidates = options.maxCandidates ?? 5;
  const preferredPaths = new Set(
    (options.preferredPaths || []).map((value) => normalizePath(String(value))).filter(Boolean),
  );
  const inputs = manifest?.inputs || manifest?.inputSchema?.properties || [];
  const normalizedInputs = Array.isArray(inputs)
    ? inputs
    : Object.entries(inputs).map(([id, value]) => ({ id, ...value }));

  return normalizedInputs
    .filter((input) => ['file', 'path'].includes(String(input.type || '').toLowerCase()))
    .map((input) => {
      const candidates = (index?.entries || [])
        .map((entry) => {
          const scored = scoreEntryForInput(input, entry);
          const entryPaths = [entry.relativePath, entry.path, entry.canonicalPath]
            .filter(Boolean)
            .map((value) => normalizePath(String(value)));
          const preferred = scored.score > 0 && entryPaths.some((value) =>
            preferredPaths.has(value) || [...preferredPaths].some((preferredPath) => value.endsWith('/' + preferredPath))
          );
          return {
            relativePath: entry.relativePath,
            path: entry.path,
            role: entry.role,
            kind: entry.kind,
            canonicalPath: entry.canonicalPath,
            score: scored.score + (preferred ? 100 : 0),
            reasons: preferred ? ['active_artifact_preferred', ...scored.reasons] : scored.reasons,
          };
        })
        .filter((candidate) => candidate.score >= minScore)
        .sort((a, b) => b.score - a.score || a.relativePath.localeCompare(b.relativePath))
        .slice(0, maxCandidates);
      return {
        inputId: input.id,
        label: input.label || input.name || input.id,
        required: input.required === true,
        selected: candidates[0] || null,
        candidates,
      };
    });
}

function textForTool(manifest = {}) {
  const inputText = (manifest.inputs || [])
    .map((input) => textForInput(input))
    .filter(Boolean)
    .join(' ');
  const outputText = (manifest.outputs || manifest.artifacts || [])
    .map((output) => [output.id, output.label, output.name, output.type].filter(Boolean).join(' '))
    .join(' ');
  return [
    manifest.id,
    manifest.name,
    manifest.title,
    manifest.subtitle,
    manifest.category,
    manifest.description,
    manifest.longDescription,
    inputText,
    outputText,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function requestIntentHints(requestText) {
  const text = String(requestText || '').toLowerCase();
  return {
    wantsVolcano: /volcano|火山/.test(text),
    wantsPca: /\bpca\b|主成分|降维/.test(text),
    wantsCorrelation: /correlation|相关|共表达|heatmap|热图/.test(text),
    wantsDeg: /deg|差异|differential|de(seq)?2|log2?fc|p-?value/.test(text),
    wantsExpression: /expr|expression|表达|矩阵|count/.test(text),
    wantsGroup: /group|metadata|sample|分组|样本/.test(text),
  };
}

export function rankHarnessToolsForRequest(requestText, manifests = [], index = {}, options = {}) {
  const hints = requestIntentHints(requestText);
  const taskPacks = rankHarnessTaskPacks(requestText);
  const minRequiredBindings = options.minRequiredBindings ?? true;
  return manifests
    .map((manifest) => {
      const toolText = textForTool(manifest);
      const inputSuggestions = suggestInputBindings(manifest, index, { minScore: options.minInputScore ?? 25 });
      const requiredFileInputs = inputSuggestions.filter((binding) => binding.required);
      const missingRequired = requiredFileInputs.filter((binding) => !binding.selected);
      let score = 0;
      const reasons = [];
      for (const pack of taskPacks) {
        const candidateIndex = pack.toolIds.findIndex(
          (toolId) => toolId === manifest.id || toolId === manifest.name,
        );
        if (candidateIndex >= 0) {
          score += pack.score + Math.max(0, pack.toolIds.length - candidateIndex);
          reasons.push(`task_pack_${pack.id}`);
        }
      }

      if (hints.wantsVolcano && /volcano|火山/.test(toolText)) {
        score += 80;
        reasons.push('intent_volcano');
      }
      if (hints.wantsPca && /\bpca\b|主成分|降维/.test(toolText)) {
        score += 80;
        reasons.push('intent_pca');
      }
      if (hints.wantsCorrelation && /correlation|相关|共表达|heatmap|热图/.test(toolText)) {
        score += 80;
        reasons.push('intent_correlation');
      }
      if (hints.wantsDeg && /deg|差异|differential|log2?fc|p-?value/.test(toolText)) {
        score += 35;
        reasons.push('intent_deg');
      }
      if (hints.wantsExpression && /expr|expression|表达|矩阵|count/.test(toolText)) {
        score += 35;
        reasons.push('intent_expression');
      }
      if (hints.wantsGroup && /group|metadata|sample|分组|样本/.test(toolText)) {
        score += 20;
        reasons.push('intent_group');
      }

      for (const binding of inputSuggestions) {
        if (!binding.selected) continue;
        const selectedScore = Number(binding.selected.score || 0);
        score += Math.min(40, Math.round(selectedScore / 2));
        reasons.push(`input_${binding.inputId}_matched`);
      }

      if (missingRequired.length) {
        score -= minRequiredBindings ? 120 : 40;
        reasons.push('missing_required_file_inputs');
      }

      return {
        toolId: manifest.id || manifest.name,
        title: manifest.title || manifest.name || manifest.id,
        score,
        reasons,
        inputSuggestions,
        missingRequired: missingRequired.map((binding) => binding.inputId),
      };
    })
    .filter((ranked) => ranked.toolId)
    .sort((a, b) => b.score - a.score || String(a.toolId).localeCompare(String(b.toolId)));
}

const COLUMN_ALIASES = {
  gene: ['gene', 'symbol', 'gene_name', 'geneid', 'gene_id', 'genes'],
  log2FC: ['log2fc', 'logfc', 'avg_log2fc', 'avg_logfc', 'foldchange', 'fold_change'],
  pvalue: ['pvalue', 'p_val', 'p.val', 'p-value', 'pvalue_adj_raw', 'padj', 'adj_p_val', 'qvalue'],
  sample: ['sample', 'sample_id', 'sampleid', 'cell', 'cell_id', 'barcode'],
  group: ['group', 'condition', 'class', 'label', 'cluster', 'treatment'],
};

function normalizeColumnName(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export function inferColumnMappings(entry, requiredColumns = []) {
  const headers = entry?.table?.headers || [];
  const normalizedHeaders = headers.map((header) => ({
    raw: header,
    normalized: normalizeColumnName(header),
  }));
  const mappings = {};
  const missing = [];
  for (const required of requiredColumns) {
    const aliases = COLUMN_ALIASES[required] || [required];
    const normalizedAliases = aliases.map(normalizeColumnName);
    const matched = normalizedHeaders.find((header) => normalizedAliases.includes(header.normalized));
    if (matched) mappings[required] = matched.raw;
    else missing.push(required);
  }
  return { mappings, missing };
}

function fileInputs(manifest = {}) {
  return (manifest.inputs || []).filter((input) => ['file', 'path'].includes(String(input.type || '').toLowerCase()));
}

function numberInputs(manifest = {}) {
  return (manifest.inputs || []).filter((input) => String(input.type || '').toLowerCase() === 'number');
}

function firstSelectedEntry(index, binding) {
  if (!binding?.selected) return null;
  return (index.entries || []).find((entry) => entry.relativePath === binding.selected.relativePath) || null;
}

function availableFeatureCount(entry) {
  if (!entry?.table) return null;
  if (entry.table.matrixOrientation === 'rows_are_features') return entry.table.rowSampleCount;
  if (entry.table.matrixOrientation === 'rows_are_samples') return Math.max(0, (entry.table.columnCount || 0) - 1);
  if (entry.role === 'deg_table') return entry.table.rowSampleCount;
  return entry.table.rowSampleCount || null;
}

function availableSampleCount(entry) {
  if (!entry?.table) return null;
  if (entry.table.matrixOrientation === 'rows_are_samples') return entry.table.rowSampleCount;
  if (entry.table.matrixOrientation === 'rows_are_features') return Math.max(0, (entry.table.columnCount || 0) - 1);
  return entry.table.rowSampleCount || null;
}

function normalizeDetectPatterns(detect) {
  if (!detect) return [];
  if (Array.isArray(detect)) return detect.flatMap((item) => normalizeDetectPatterns(item));
  return [detect];
}

function failureModeMatchesIssue(failureMode, issue = {}) {
  if (!failureMode || !issue) return false;
  if (issue.code && failureMode.code === issue.code) return true;
  const haystack = [issue.code, issue.message, issue.detail, issue.suggestedFix]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (!haystack) return false;
  for (const pattern of normalizeDetectPatterns(failureMode.detect)) {
    if (!pattern) continue;
    if (pattern instanceof RegExp) {
      if (pattern.test(haystack)) return true;
      continue;
    }
    const text = String(pattern).trim();
    if (!text) continue;
    if (text.startsWith('/') && text.endsWith('/')) {
      try {
        if (new RegExp(text.slice(1, -1), 'i').test(haystack)) return true;
      } catch {
        /* ignore invalid pattern */
      }
      continue;
    }
    if (haystack.includes(text.toLowerCase())) return true;
  }
  return false;
}

function failureModeByCode(manifest = {}, code) {
  const modes = Array.isArray(manifest.failureModes) ? manifest.failureModes : [];
  return modes.find((mode) => mode && mode.code === code) || null;
}

function failureModeForIssue(manifest = {}, issue = {}) {
  const modes = Array.isArray(manifest.failureModes) ? manifest.failureModes : [];
  return modes.find((mode) => failureModeMatchesIssue(mode, issue)) || null;
}

function normalizeDiagnosticIssue(manifest, issue) {
  const failureMode = failureModeForIssue(manifest, issue) || failureModeByCode(manifest, issue.code);
  return {
    code: issue.code,
    severity: issue.severity || (failureMode?.recoverable === false ? 'error' : 'warning'),
    recoverable: issue.recoverable ?? failureMode?.recoverable ?? true,
    inputId: issue.inputId || null,
    message: issue.message || failureMode?.title || issue.code,
    detail: issue.detail || failureMode?.description || null,
    suggestedFix: issue.suggestedFix || failureMode?.suggestedFix || null,
    failureMode: failureMode
      ? {
          code: failureMode.code,
          title: failureMode.title,
          recoverable: failureMode.recoverable !== false,
        }
      : null,
  };
}

function diagnosticIssueFromRepairWarning(manifest, warning) {
  if (!warning || !warning.code) return null;
  return normalizeDiagnosticIssue(manifest, {
    ...warning,
    severity: warning.code === 'missing_required_columns' ? 'error' : 'warning',
    message: warning.code,
  });
}

function expectedMatrixOrientation(input = {}) {
  const text = textForInput(input);
  if (/行\s*=\s*基因|rows?\s*=\s*genes?|gene.*列\s*=\s*样本|基因.*样本/.test(text)) return 'rows_are_features';
  if (/行\s*=\s*样本|rows?\s*=\s*samples?|sample.*列\s*=\s*基因|样本.*基因/.test(text)) return 'rows_are_samples';
  return null;
}

function selectedEntryForFileInput(index, params, input, selectedByInput) {
  const bindingEntry = firstSelectedEntry(index, selectedByInput.get(input.id));
  if (bindingEntry) return bindingEntry;
  const value = params?.[input.id];
  if (!value) return null;
  const normalizedValue = String(value);
  return (
    (index.entries || []).find(
      (entry) =>
        entry.relativePath === normalizedValue ||
        entry.path === normalizedValue ||
        entry.canonicalPath === normalizedValue ||
        path.basename(entry.path || '') === path.basename(normalizedValue),
  ) || null
  );
}

function extractFirstColumnValues(entry, maxValues = 64) {
  const rows = Array.isArray(entry?.table?.sampleRows) ? entry.table.sampleRows : [];
  const values = [];
  for (const row of rows.slice(0, maxValues)) {
    if (!Array.isArray(row)) continue;
    const value = String(row[0] ?? '').trim();
    if (value) values.push(value);
  }
  return Array.from(new Set(values));
}

function tableColumnIndex(headers, name) {
  if (!name) return -1;
  const normalized = normalizeColumnName(name);
  return (headers || []).findIndex((header) => normalizeColumnName(header) === normalized);
}

function parseNumericCell(value) {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  const lower = text.toLowerCase();
  if (['na', 'nan', 'null', 'none', 'inf', '-inf'].includes(lower)) return null;
  const numeric = Number(text);
  return Number.isFinite(numeric) ? numeric : null;
}

function uniqueActions(actions) {
  const seen = new Set();
  const out = [];
  for (const action of actions) {
    if (!action || !action.id) continue;
    if (seen.has(action.id)) continue;
    seen.add(action.id);
    out.push(action);
  }
  return out;
}

function buildHarnessNextActions(manifest, diagnostics = {}, options = {}) {
  const issues = Array.isArray(diagnostics.issues) ? diagnostics.issues : [];
  const severity = diagnostics.status || (issues.some((issue) => issue.severity === 'error') ? 'blocked' : issues.length ? 'needs_review' : 'ready');
  const actions = [];
  const push = (action) => actions.push(action);
  const toolName = manifest?.title || manifest?.name || manifest?.id || '当前工具';

  if (severity === 'ready') {
    push({
      id: 'run',
      label: `开始运行 ${toolName}`,
      reason: '当前输入和运行时看起来可执行。',
      recommended: true,
    });
    push({
      id: 'inspect_output',
      label: '预览输入摘要',
      reason: '在正式运行前再看一眼当前文件摘要。',
      recommended: false,
    });
    return uniqueActions(actions);
  }

  if (severity === 'needs_review') {
    push({
      id: 'repair',
      label: `修复 ${toolName} 参数`,
      reason: '存在可恢复问题，建议先让 Harness 自动修复再继续。',
      recommended: true,
    });
    push({
      id: 'inspect_inputs',
      label: '检查当前输入文件',
      reason: '确认工具选择和文件角色匹配。',
      recommended: false,
    });
  }

  if (severity === 'blocked') {
    push({
      id: 'change_inputs',
      label: '更换或补充输入文件',
      reason: '当前任务存在阻塞项，可能需要切换到别的文件或重新整理数据。',
      recommended: true,
    });
    push({
      id: 'fix_runtime',
      label: '检查运行时配置',
      reason: '如果是 runtime 不可用，需要先恢复运行环境。',
      recommended: issues.some((issue) => issue.code === 'runtime_not_ready') || false,
    });
  }

  for (const issue of issues) {
    if (!issue || !issue.code) continue;
    switch (issue.code) {
      case 'missing_required_file_inputs':
        push({
          id: `resolve_${issue.inputId || 'missing_input'}`,
          label: `补全 ${issue.inputId || '缺失'} 输入`,
          reason: issue.suggestedFix || issue.message,
          recommended: true,
        });
        break;
      case 'matrix_orientation_mismatch':
        push({
          id: 'transpose_or_reselect',
          label: '确认表达矩阵方向',
          reason: issue.suggestedFix || issue.detail || issue.message,
          recommended: true,
        });
        break;
      case 'sample_group_mismatch':
        push({
          id: 'align_group_samples',
          label: '对齐分组文件样本名',
          reason: issue.suggestedFix || issue.detail || issue.message,
          recommended: true,
        });
        break;
      case 'invalid_numeric_values':
        push({
          id: 'clean_numeric_columns',
          label: '清理数值列异常值',
          reason: issue.suggestedFix || issue.detail || issue.message,
          recommended: true,
        });
        break;
      case 'empty_significant_set':
        push({
          id: 'relax_thresholds',
          label: '适当放宽阈值',
          reason: issue.suggestedFix || issue.detail || issue.message,
          recommended: true,
        });
        break;
      case 'runtime_not_ready':
        push({
          id: 'configure_runtime',
          label: '配置对应运行时',
          reason: issue.suggestedFix || issue.detail || issue.message,
          recommended: true,
        });
        break;
      default:
        break;
    }
  }

  if (options.includeInspect !== false) {
    push({
      id: 'inspect_summary',
      label: '查看文件摘要',
      reason: '在再次执行前快速查看 Harness 给出的结构化摘要。',
      recommended: severity !== 'ready',
    });
  }

  return uniqueActions(actions);
}

export function diagnoseHarnessRunReadiness(manifest, index, params = {}, options = {}) {
  const inputSuggestions = options.inputSuggestions || suggestInputBindings(manifest, index);
  const repair = options.repair || repairHarnessParams(manifest, index, params, { inputSuggestions });
  const selectedByInput = new Map(inputSuggestions.map((binding) => [binding.inputId, binding]));
  const issues = [];

  for (const input of fileInputs(manifest)) {
    const entry = selectedEntryForFileInput(index, repair.repairedParams, input, selectedByInput);
    if (input.required && !entry && !repair.repairedParams[input.id]) {
      issues.push(
        normalizeDiagnosticIssue(manifest, {
          code: 'missing_required_file_inputs',
          severity: 'error',
          recoverable: true,
          inputId: input.id,
          message: `缺少必需输入文件：${input.label || input.id}`,
          suggestedFix: '请提供该文件，或让 Harness 根据当前项目文件重新推荐候选输入。',
        }),
      );
      continue;
    }

    const expectedOrientation = expectedMatrixOrientation(input);
    if (
      expectedOrientation &&
      entry?.table?.matrixOrientation &&
      entry.table.matrixOrientation !== 'unknown' &&
      entry.table.matrixOrientation !== expectedOrientation
    ) {
      issues.push(
        normalizeDiagnosticIssue(manifest, {
          code: 'matrix_orientation_mismatch',
          severity: 'warning',
          recoverable: true,
          inputId: input.id,
          message: `表达矩阵方向可能不符合 ${manifest.title || manifest.id} 预期`,
          detail: `预期 ${expectedOrientation}，当前探测为 ${entry.table.matrixOrientation}`,
        }),
      );
    }

    if (/expr|expression|matrix|表达|矩阵|count/.test(textForInput(input)) && entry?.table) {
      const featureCount = availableFeatureCount(entry) || 0;
      const sampleCount = availableSampleCount(entry) || 0;
      if (featureCount < 2 || sampleCount < 2) {
        issues.push(
          normalizeDiagnosticIssue(manifest, {
            code: /pca/i.test(textForTool(manifest)) ? 'too_few_samples_or_features' : 'insufficient_numeric_genes',
            severity: 'error',
            recoverable: false,
            inputId: input.id,
            message: '表达矩阵可计算的样本或特征数量不足',
            detail: `features=${featureCount}, samples=${sampleCount}`,
          }),
        );
      }
    }
  }

  const matrixInputs = fileInputs(manifest).filter((input) => /expr|expression|matrix|表达|矩阵|count/.test(textForInput(input)));
  const sampleGroupInput = fileInputs(manifest).find((input) => {
    const text = textForInput(input);
    return (
      /group|metadata|分组/.test(text) &&
      !/expr|expression|matrix|表达|矩阵|count/.test(text)
    );
  });
  const exprInput = matrixInputs[0] || null;
  if (exprInput && sampleGroupInput) {
    const exprEntry = selectedEntryForFileInput(index, repair.repairedParams, exprInput, selectedByInput);
    const groupEntry = selectedEntryForFileInput(index, repair.repairedParams, sampleGroupInput, selectedByInput);
    if (
      exprEntry &&
      groupEntry &&
      exprEntry.table?.matrixOrientation === 'rows_are_samples' &&
      groupEntry.table?.rowSampleCount
    ) {
      const exprKeys = new Set(extractFirstColumnValues(exprEntry));
      const groupKeys = new Set(extractFirstColumnValues(groupEntry));
      const overlap = [...exprKeys].filter((key) => groupKeys.has(key));
      if (exprKeys.size > 0 && groupKeys.size > 0 && overlap.length === 0) {
        issues.push(
          normalizeDiagnosticIssue(manifest, {
            code: 'sample_group_mismatch',
            severity: 'warning',
            recoverable: true,
            inputId: sampleGroupInput.id,
            message: '分组文件与表达矩阵样本名无法对齐',
            detail: `expr_matrix=${exprInput.id}, group_file=${sampleGroupInput.id}`,
            suggestedFix: '请让分组文件的 sample 列与表达矩阵样本名对齐，或重新选择当前项目里的分组文件。',
          }),
        );
      }
    }
  }

  const degInput = fileInputs(manifest).find((input) => /deg|差异|volcano|火山/.test(textForInput(input)));
  if (degInput) {
    const degEntry = selectedEntryForFileInput(index, repair.repairedParams, degInput, selectedByInput);
    if (degEntry?.table?.headers?.length && Array.isArray(degEntry.table.sampleRows)) {
      const mapped = repair.repairedParams?.columnMappings?.[degInput.id] || {};
      const inferred = inferColumnMappings(degEntry, ['gene', 'log2FC', 'pvalue']);
      const columnMap = {
        gene: mapped.gene || inferred.mappings.gene,
        log2FC: mapped.log2FC || inferred.mappings.log2FC,
        pvalue: mapped.pvalue || inferred.mappings.pvalue,
      };
      const log2fcIdx = tableColumnIndex(degEntry.table.headers, columnMap.log2FC);
      const pvalueIdx = tableColumnIndex(degEntry.table.headers, columnMap.pvalue);
      const rows = degEntry.table.sampleRows;
      const validRows = [];
      const invalidRows = [];
      for (const row of rows) {
        if (!Array.isArray(row)) continue;
        const log2fc = parseNumericCell(row[log2fcIdx]);
        const pvalue = parseNumericCell(row[pvalueIdx]);
        if (log2fc == null || pvalue == null) {
          invalidRows.push(row);
          continue;
        }
        validRows.push({ log2fc, pvalue });
      }
      if (invalidRows.length > 0 && invalidRows.length >= Math.max(1, Math.floor(rows.length / 3))) {
        issues.push(
          normalizeDiagnosticIssue(manifest, {
            code: 'invalid_numeric_values',
            severity: validRows.length === 0 ? 'error' : 'warning',
            recoverable: true,
            inputId: degInput.id,
            message: '差异分析表中存在非数值或不可解析值',
            detail: `log2FC=${columnMap.log2FC || 'missing'}, pvalue=${columnMap.pvalue || 'missing'}`,
            suggestedFix: '请清理 log2FC / pvalue 列中的空值、NA、文本和无穷大，再重新运行。',
          }),
        );
      } else if (validRows.length > 0) {
        const fcThreshold = Number(repair.repairedParams?.fc_threshold ?? params.fc_threshold ?? 1);
        const pvalThreshold = Number(repair.repairedParams?.pval_threshold ?? params.pval_threshold ?? 1.3);
        const pCutoff = Math.pow(10, -pvalThreshold);
        const significantCount = validRows.filter(
          (row) => Math.abs(row.log2fc) >= fcThreshold && row.pvalue <= pCutoff,
        ).length;
        if (significantCount === 0) {
          issues.push(
            normalizeDiagnosticIssue(manifest, {
              code: 'empty_significant_set',
              severity: 'warning',
              recoverable: true,
              inputId: degInput.id,
              message: '当前阈值下未找到显著基因',
              detail: `fc_threshold=${fcThreshold}, pval_threshold=${pvalThreshold}, validRows=${validRows.length}`,
              suggestedFix: '可适度降低阈值，或确认当前差异分析结果本身是否足够显著。',
            }),
          );
        }
      }
    }
  }

  for (const warning of repair.warnings || []) {
    const issue = diagnosticIssueFromRepairWarning(manifest, warning);
    if (issue) issues.push(issue);
  }

  const runtimeReady = options.executionContext?.runtimeReady || options.runtimeReady || null;
  if (runtimeReady && runtimeReady.ready === false) {
    issues.push(
      normalizeDiagnosticIssue(manifest, {
        code: 'runtime_not_ready',
        severity: 'error',
        recoverable: true,
        message: `${runtimeReady.runtime || manifest.language || 'runtime'} 运行时不可用`,
        detail: runtimeReady.reason || null,
        suggestedFix: '请安装或配置对应运行时，然后重新执行该工具。',
      }),
    );
  }

  const errors = issues.filter((issue) => issue.severity === 'error');
  const status = errors.length ? 'blocked' : issues.length ? 'needs_review' : 'ready';
  return {
    ok: errors.length === 0,
    status,
    readiness: status === 'needs_review' ? 'recoverable' : status,
    toolId: manifest?.id || manifest?.name || null,
    repairs: repair.repairs || [],
    warnings: repair.warnings || [],
    issues,
    repairedParams: repair.repairedParams,
    inputSuggestions,
    nextActions: buildHarnessNextActions(manifest, {
      status,
      issues,
    }, options),
  };
}

export function repairHarnessParams(manifest, index, params = {}, options = {}) {
  const repairedParams = {
    ...params,
    ...(params.columnMappings
      ? {
          columnMappings: Object.fromEntries(
            Object.entries(params.columnMappings).map(([key, value]) => [
              key,
              value && typeof value === 'object' ? { ...value } : value,
            ]),
          ),
        }
      : {}),
  };
  const repairs = [];
  const warnings = [];
  const inputSuggestions = options.inputSuggestions || suggestInputBindings(manifest, index);
  const selectedByInput = new Map(inputSuggestions.map((binding) => [binding.inputId, binding]));

  for (const input of fileInputs(manifest)) {
    const binding = selectedByInput.get(input.id);
    if (!repairedParams[input.id] && binding?.selected) {
      repairedParams[input.id] = options.useAbsolutePaths ? binding.selected.path : binding.selected.relativePath;
      repairs.push({
        code: 'file_input_prefilled',
        inputId: input.id,
        value: repairedParams[input.id],
        reason: binding.selected.reasons,
        origin: 'harness_default',
        applied: true,
        confirmationRequired: false,
      });
    }
  }

  const degInput = fileInputs(manifest).find((input) => /deg|差异/.test(textForInput(input)));
  if (degInput) {
    const entry = firstSelectedEntry(index, selectedByInput.get(degInput.id));
    const columnRepair = inferColumnMappings(entry, ['gene', 'log2FC', 'pvalue']);
    const existingMappings = repairedParams.columnMappings?.[degInput.id] || {};
    const inferredMappings = Object.fromEntries(
      Object.entries(columnRepair.mappings).filter(([key]) => !existingMappings[key]),
    );
    if (Object.keys(inferredMappings).length) {
      repairedParams.columnMappings = {
        ...(repairedParams.columnMappings || {}),
        [degInput.id]: {
          ...inferredMappings,
          ...existingMappings,
        },
      };
      repairs.push({
        code: 'column_alias_mapped',
        inputId: degInput.id,
        mappings: inferredMappings,
        missing: columnRepair.missing,
        origin: 'harness_inference',
        applied: true,
        confirmationRequired: false,
      });
    }
    if (columnRepair.missing.length) {
      warnings.push({
        code: 'missing_required_columns',
        inputId: degInput.id,
        missing: columnRepair.missing,
      });
    }
  }

  for (const input of numberInputs(manifest)) {
    const id = input.id;
    const hadParam = repairedParams[id] != null;
    const current = hadParam ? repairedParams[id] : input.default;
    if (current == null || !Number.isFinite(Number(current))) continue;
    let next = Number(current);
    const original = next;
    if (typeof input.min === 'number') next = Math.max(input.min, next);
    if (typeof input.max === 'number') next = Math.min(input.max, next);

    if (/top[_-]?n/i.test(id)) {
      const likelyMatrixBinding =
        selectedByInput.get('expr_matrix') ||
        inputSuggestions.find((binding) => /expr|matrix|表达|矩阵/.test(String(binding.label || '').toLowerCase()));
      const likelyDegBinding = selectedByInput.get('deg_table');
      const entry = firstSelectedEntry(index, likelyMatrixBinding || likelyDegBinding);
      const maxFeatures = availableFeatureCount(entry);
      if (maxFeatures && next > maxFeatures) next = maxFeatures;
    }

    if (/n[_-]?components/i.test(id)) {
      const binding = selectedByInput.get('expr_matrix');
      const entry = firstSelectedEntry(index, binding);
      const maxComponents = Math.max(1, Math.min(availableSampleCount(entry) || next, availableFeatureCount(entry) || next));
      if (next > maxComponents) next = maxComponents;
    }

    if (next !== original || !hadParam) {
      repairedParams[id] = next;
      repairs.push({
        code: next !== original && hadParam ? 'number_param_clamped' : 'number_default_filled',
        inputId: id,
        from: hadParam ? original : null,
        to: next,
        origin: hadParam ? 'user_value_adjustment' : 'manifest_default',
        applied: true,
        confirmationRequired: hadParam && next !== original,
      });
    }
  }

  return {
    ok: warnings.length === 0,
    proposalVersion: 1,
    repairedParams,
    repairs,
    warnings,
    inputSuggestions,
    audit: {
      userParams: { ...params },
      changedUserInputs: repairs
        .filter((repair) => repair.confirmationRequired)
        .map((repair) => repair.inputId),
      confirmationRequired: repairs.some((repair) => repair.confirmationRequired),
    },
  };
}

const HARNESS_WORKFLOW_STAGES = ['inspect', 'infer', 'select', 'repair', 'confirm', 'run', 'verify', 'report'];

export function createHarnessWorkflowPlan(options = {}) {
  const manifest = options.manifest || null;
  const index = options.index || { entries: [] };
  const requestText = String(options.requestText || '');
  const manifests = options.manifests || (manifest ? [manifest] : []);
  const rankedTools = options.rankedTools || rankHarnessToolsForRequest(requestText, manifests, index, options);
  const taskPack = selectHarnessTaskPack(requestText);
  const taskPackTool = taskPack
    ? rankedTools.find((item) => taskPack.toolIds.includes(item.toolId))
    : null;
  const selectedToolId =
    options.toolId || manifest?.id || taskPackTool?.toolId || null;
  const selectedManifest = manifest || manifests.find((item) => item?.id === selectedToolId) || null;
  const inputSuggestions = options.inputSuggestions || (selectedManifest
    ? suggestInputBindings(selectedManifest, index, { preferredPaths: options.preferredPaths || [] })
    : []);
  const repair = options.repair || (selectedManifest
    ? repairHarnessParams(selectedManifest, index, options.params || {}, {
        inputSuggestions,
        useAbsolutePaths: options.useAbsolutePaths === true,
      })
    : null);
  const diagnostics = options.diagnostics || (selectedManifest
    ? diagnoseHarnessRunReadiness(selectedManifest, index, options.params || {}, {
        inputSuggestions,
        repair,
        executionContext: options.executionContext,
      })
    : null);
  const readiness = diagnostics?.status === 'blocked'
    ? 'blocked'
    : diagnostics?.status === 'needs_review'
      ? 'recoverable'
      : selectedManifest
        ? 'ready'
        : 'blocked';
  const confirmationRequired = !!repair?.audit?.confirmationRequired || readiness === 'recoverable';
  const runnable = readiness !== 'blocked' && !!selectedManifest;
  const statusFor = (stage) => {
    if (['inspect', 'infer'].includes(stage)) return 'completed';
    if (stage === 'select') return selectedManifest ? 'completed' : 'blocked';
    if (stage === 'repair') return repair ? 'completed' : 'blocked';
    if (stage === 'confirm') return confirmationRequired ? 'pending' : runnable ? 'completed' : 'blocked';
    return runnable ? 'pending' : 'blocked';
  };

  return {
    harnessWorkflowVersion: 1,
    requestText,
    taskPack,
    toolId: selectedToolId,
    readiness,
    runnable,
    confirmationRequired,
    executionContext: options.executionContext || null,
    inputSuggestions,
    repair,
    diagnostics,
    stages: HARNESS_WORKFLOW_STAGES.map((id) => ({ id, status: statusFor(id) })),
  };
}

export function summarizeIndexForPrompt(index, options = {}) {
  const maxEntries = options.maxEntries ?? 40;
  return {
    harnessIndexVersion: index?.harnessIndexVersion || 1,
    root: index?.root,
    canonicalRoot: index?.canonicalRoot,
    fileCount: index?.fileCount || 0,
    truncated: !!index?.truncated,
    byKind: index?.byKind || {},
    byRole: index?.byRole || {},
    entries: (index?.entries || []).slice(0, maxEntries).map((entry) => ({
      relativePath: entry.relativePath,
      canonicalPath: entry.canonicalPath,
      kind: entry.kind,
      role: entry.role,
      size: entry.size,
      readable: entry.readable,
      table: entry.table
        ? {
            headers: entry.table.headers,
            columnCount: entry.table.columnCount,
            rowSampleCount: entry.table.rowSampleCount,
            matrixOrientation: entry.table.matrixOrientation,
            hints: entry.table.hints,
            columns: (entry.table.columns || []).slice(0, 12).map((column) => ({
              name: column.name,
              likelyType: column.likelyType,
              numericRatio: column.numericRatio,
              missingCount: column.missingCount,
            })),
          }
        : undefined,
      json: entry.json
        ? {
            valid: entry.json.valid,
            rootType: entry.json.rootType,
            keys: entry.json.keys,
          }
        : undefined,
    })),
    errors: index?.errors || [],
  };
}

function datasetPathFromValue(value, dataDir = defaultDataDir()) {
  if (!value) return null;
  const raw = String(value);
  if (raw.startsWith('file://')) return new URL(raw).pathname;
  if (path.isAbsolute(raw)) return raw;
  const storageCandidates = [
    path.join(dataDir, 'uploads', raw),
    path.join(dataDir, 'results', raw),
    path.join(dataDir, raw),
  ];
  return storageCandidates.find(pathExists) || null;
}

export function createLocalHarnessPlatform(platformOptions = {}) {
  const dataDir = normalizePath(platformOptions.dataDir || defaultDataDir());
  const jobsDir = normalizePath(platformOptions.jobsDir || defaultJobsDir(dataDir));
  const dbPath = platformOptions.dbPath || process.env.BIOF3_DB_PATH || path.join(dataDir, 'biof3.db');
  const runtimeChecks = platformOptions.runtimeChecks || {};
  const pathMappings = normalizePathMappings(
    platformOptions.pathMappings ||
      [
        platformOptions.canonicalRoot
          ? {
              localRoot: platformOptions.localRoot || dataDir,
              canonicalRoot: platformOptions.canonicalRoot,
            }
          : null,
      ].filter(Boolean),
  );

  const decorateScope = (scopeInfo) => ({
    ...scopeInfo,
    canonicalTarget: mapLocalToCanonical(scopeInfo.target, pathMappings),
  });

  return {
    id: 'local',
    dataDir,
    jobsDir,
    dbPath,
    pathMappings,
    canonicalizePath(inputPath) {
      return mapLocalToCanonical(inputPath, pathMappings);
    },
    resolveCanonicalPath(inputPath) {
      return mapCanonicalToLocal(inputPath, pathMappings);
    },
    checkRuntimeReady(runtime = 'shell') {
      const name = normalizeRuntimeName(runtime);
      if (Object.prototype.hasOwnProperty.call(runtimeChecks, name)) {
        return normalizeRuntimeCheck(name, runtimeChecks[name]);
      }
      if (name === 'shell') {
        return { runtime: name, ready: true, command: process.env.SHELL || 'sh', reason: null };
      }
      if (name === 'r') {
        const rHome = process.env.BIOF3_R_HOME || process.env.R_HOME;
        const command = platformOptions.rscriptPath || process.env.RSCRIPT_PATH || (rHome ? path.join(rHome, 'bin', 'Rscript') : null);
        return {
          runtime: name,
          ready: !!(command && pathExists(command)),
          command,
          reason: command && pathExists(command) ? null : 'r_runtime_not_found',
        };
      }
      if (name === 'python') {
        const pyHome = process.env.BIOF3_PY_HOME;
        const pyCandidates = pyHome
          ? [path.join(pyHome, 'bin', 'python3'), path.join(pyHome, 'bin', 'python'), path.join(pyHome, 'python.exe')]
          : [];
        const command =
          platformOptions.pythonPath ||
          process.env.PYTHON ||
          process.env.PYTHON_PATH ||
          pyCandidates.find(pathExists) ||
          null;
        return {
          runtime: name,
          ready: !!(command && pathExists(command)),
          command,
          reason: command && pathExists(command) ? null : 'python_runtime_not_found',
        };
      }
      return { runtime: name, ready: false, command: null, reason: 'unsupported_runtime' };
    },
    createExecutionContext(input = {}) {
      const scopeInfo =
        input.scopeInfo ||
        (input.scope && typeof input.scope === 'object' ? input.scope : null) ||
        this.resolveScope(input);
      const manifestRuntime =
        typeof input.manifest?.runtime === 'string' ? input.manifest.runtime : null;
      const runtime = normalizeRuntimeName(
        input.runtime || input.manifest?.language || manifestRuntime || 'shell',
      );
      const runtimeReady = this.checkRuntimeReady(runtime);
      const canonicalTarget = scopeInfo.canonicalTarget || this.canonicalizePath(scopeInfo.target);
      const execution = createCanonicalExecutionContext({
        jobId: input.jobId || (scopeInfo.scope === 'job' ? scopeInfo.id : null),
        toolId: input.manifest?.id || input.manifest?.name || null,
        platform: 'local',
        runtime,
        runtimeReady,
        mode: 'local',
        workDir: scopeInfo.target,
        localRoot: scopeInfo.target,
        canonicalRoot: canonicalTarget,
      }).context;
      return { ...execution, scope: scopeInfo };
    },
    resolveScope(options = {}) {
      const scope = String(options.scope || (options.jobId ? 'job' : options.projectId ? 'project' : 'path'));

      if (scope === 'path' || scope === 'workspace') {
        const target = normalizePath(options.path || options._?.[0] || '.');
        return decorateScope({
          scope: 'path',
          id: null,
          target,
          partition: 'workspace',
          platform: 'local',
          exists: pathExists(target),
        });
      }

      if (scope === 'project') {
        if (options.projectPath || options.workspacePath || options.path) {
          const target = normalizePath(options.projectPath || options.workspacePath || options.path);
          return decorateScope({
            scope,
            id: options.projectId || null,
            target,
            partition: 'project',
            platform: 'local',
            exists: pathExists(target),
          });
        }
        if (!options.projectId) throw new Error('project scope requires --project-id or --project-path');
        const row = readSqliteRow(dbPath, 'SELECT id, name, workspace_path FROM projects WHERE id = ?', [
          options.projectId,
        ]);
        if (row?.__dbError) throw new Error(`Cannot read project from db: ${row.__dbError}`);
        if (!row) throw new Error(`Project not found: ${options.projectId}`);
        const target = row.workspace_path || defaultProjectWorkspacePath(row, dataDir);
        return decorateScope({
          scope,
          id: row.id,
          target,
          partition: 'project',
          platform: 'local',
          exists: pathExists(target),
          source: { dbPath, name: row.name, workspacePath: row.workspace_path || null },
        });
      }

      if (scope === 'job' || scope === 'artifact') {
        if (!options.jobId) throw new Error(`${scope} scope requires --job-id`);
        const jobRoot = safeJoinUnder(jobsDir, options.jobId);
        if (!jobRoot) throw new Error(`Invalid job id: ${options.jobId}`);
        const target = scope === 'artifact' ? path.join(jobRoot, 'output') : jobRoot;
        return decorateScope({
          scope,
          id: options.jobId,
          target,
          partition: scope === 'artifact' ? 'artifact' : 'job',
          platform: 'local',
          exists: pathExists(target),
          source: { jobsDir, jobRoot },
        });
      }

      if (scope === 'dataset') {
        if (options.datasetPath || options.path) {
          const target = normalizePath(options.datasetPath || options.path);
          return decorateScope({
            scope,
            id: options.datasetId || null,
            target,
            partition: 'dataset',
            platform: 'local',
            exists: pathExists(target),
          });
        }
        if (!options.datasetId) throw new Error('dataset scope requires --dataset-id or --dataset-path');
        const row = readSqliteRow(
          dbPath,
          'SELECT id, name, oss_url, meta_url, features_url FROM datasets WHERE id = ?',
          [options.datasetId],
        );
        if (row?.__dbError) throw new Error(`Cannot read dataset from db: ${row.__dbError}`);
        if (!row) throw new Error(`Dataset not found: ${options.datasetId}`);
        const target =
          datasetPathFromValue(row.oss_url, dataDir) ||
          datasetPathFromValue(row.meta_url, dataDir) ||
          datasetPathFromValue(row.features_url, dataDir);
        if (!target) {
          throw new Error(`Dataset has no local indexable path: ${options.datasetId}`);
        }
        return decorateScope({
          scope,
          id: row.id,
          target,
          partition: 'dataset',
          platform: 'local',
          exists: pathExists(target),
          source: {
            dbPath,
            name: row.name,
            ossUrl: row.oss_url || null,
            metaUrl: row.meta_url || null,
            featuresUrl: row.features_url || null,
          },
        });
      }

      throw new Error(`Unsupported harness index scope: ${scope}`);
    },
  };
}

export function resolveHarnessScope(options = {}) {
  const platform = options.platform || createLocalHarnessPlatform(options);
  if (!platform || typeof platform.resolveScope !== 'function') {
    throw new Error('Harness platform must provide resolveScope(options)');
  }
  return platform.resolveScope(options);
}

export function createHarnessExecutionContext(options = {}) {
  const platform = options.platform || createLocalHarnessPlatform(options);
  if (!platform || typeof platform.createExecutionContext !== 'function') {
    throw new Error('Harness platform must provide createExecutionContext(options)');
  }
  return platform.createExecutionContext(options);
}

export function indexHarnessScope(options = {}) {
  const platform = options.platform || createLocalHarnessPlatform(options);
  const resolved = resolveHarnessScope({ ...options, platform });
  if (!resolved.exists) throw new Error(`Scope target does not exist: ${resolved.target}`);
  const stat = fs.statSync(resolved.target);
  const index = stat.isDirectory()
    ? indexDirectory(resolved.target, options)
    : {
        harnessIndexVersion: 1,
        root: path.dirname(resolved.target),
        createdAt: stableNow(),
        fileCount: 1,
        truncated: false,
        byKind: {},
        byRole: {},
        entries: [
          {
            ...detectFile(resolved.target, options),
            relativePath: path.basename(resolved.target),
          },
        ],
        errors: [],
      };
  if (!stat.isDirectory()) {
    const entry = index.entries[0];
    index.byKind[entry.kind] = 1;
    index.byRole[entry.role] = 1;
  }
  if (typeof platform.canonicalizePath === 'function') {
    index.canonicalRoot = platform.canonicalizePath(index.root);
    index.entries = (index.entries || []).map((entry) => ({
      ...entry,
      canonicalPath: platform.canonicalizePath(entry.path),
    }));
  }
  return {
    scope: resolved,
    index,
    promptSummary: summarizeIndexForPrompt(index, options),
  };
}

export function writeIndexCache(index, cachePath) {
  const target = normalizePath(cachePath || path.join(index.root, DEFAULT_CACHE_NAME));
  fs.writeFileSync(target, JSON.stringify(index, null, 2));
  return target;
}

export function readIndexCache(cachePath) {
  return JSON.parse(fs.readFileSync(normalizePath(cachePath), 'utf8'));
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const item = argv[i];
    if (item === '--cache') args.cache = argv[++i] || DEFAULT_CACHE_NAME;
    else if (item === '--for-manifest') args.forManifest = argv[++i];
    else if (item === '--repair-params') args.repairParams = argv[++i] || '{}';
    else if (item === '--scope') args.scope = argv[++i];
    else if (item === '--project-id') args.projectId = argv[++i];
    else if (item === '--project-path') args.projectPath = argv[++i];
    else if (item === '--workspace-path') args.workspacePath = argv[++i];
    else if (item === '--job-id') args.jobId = argv[++i];
    else if (item === '--dataset-id') args.datasetId = argv[++i];
    else if (item === '--dataset-path') args.datasetPath = argv[++i];
    else if (item === '--data-dir') args.dataDir = argv[++i];
    else if (item === '--jobs-dir') args.jobsDir = argv[++i];
    else if (item === '--db-path') args.dbPath = argv[++i];
    else if (item === '--prompt-summary') args.promptSummary = true;
    else if (item === '--max-files') args.maxFiles = Number(argv[++i]) || DEFAULT_MAX_FILES;
    else if (item === '--no-hash') args.hash = false;
    else if (item === '--include-hidden') args.includeHidden = true;
    else args._.push(item);
  }
  return args;
}

function readJsonArgument(value) {
  const raw = String(value || '{}');
  if (raw.trim().startsWith('{') || raw.trim().startsWith('[')) return JSON.parse(raw);
  return JSON.parse(fs.readFileSync(normalizePath(raw), 'utf8'));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  if (args._[0] && !args.path) args.path = args._[0];
  const scoped = indexHarnessScope(args);
  const result = args.promptSummary
    ? scoped.promptSummary
    : {
        ...scoped.index,
        scope: scoped.scope,
      };
  let manifest = null;
  let inputSuggestions = null;
  if (args.forManifest && fs.statSync(scoped.scope.target).isDirectory()) {
    manifest = JSON.parse(fs.readFileSync(normalizePath(args.forManifest), 'utf8'));
    inputSuggestions = suggestInputBindings(manifest, scoped.index);
  }
  if (inputSuggestions && !args.promptSummary) {
    result.inputSuggestions = inputSuggestions;
  }
  if (args.repairParams) {
    if (!manifest) throw new Error('--repair-params requires --for-manifest');
    const params = readJsonArgument(args.repairParams);
    const repair = repairHarnessParams(manifest, scoped.index, params, { inputSuggestions });
    if (args.promptSummary) {
      result.repair = repair;
    } else {
      result.paramRepair = repair;
    }
  } else if (args.forManifest && !args.promptSummary && !inputSuggestions) {
    const manifest = JSON.parse(fs.readFileSync(normalizePath(args.forManifest), 'utf8'));
    result.inputSuggestions = suggestInputBindings(manifest, result);
  }
  if (args.cache && fs.statSync(scoped.scope.target).isDirectory()) {
    const cachePath = args.cache === true ? undefined : args.cache;
    const cachePayload = args.promptSummary ? scoped.promptSummary : scoped.index;
    const written = writeIndexCache(
      cachePayload,
      path.isAbsolute(cachePath) ? cachePath : path.join(scoped.scope.target, cachePath)
    );
    console.error(`[harness:index] wrote ${written}`);
  }
  console.log(JSON.stringify(result, null, 2));
}
