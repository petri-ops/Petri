#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

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
  const entries = [];
  const errors = [];
  for (const file of files) {
    try {
      const detection = detectFile(file, options);
      entries.push({
        ...detection,
        relativePath: safeRelative(root, detection.path),
      });
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
          return {
            relativePath: entry.relativePath,
            path: entry.path,
            role: entry.role,
            kind: entry.kind,
            score: scored.score,
            reasons: scored.reasons,
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
    else if (item === '--max-files') args.maxFiles = Number(argv[++i]) || DEFAULT_MAX_FILES;
    else if (item === '--no-hash') args.hash = false;
    else if (item === '--include-hidden') args.includeHidden = true;
    else args._.push(item);
  }
  return args;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const target = normalizePath(args._[0] || '.');
  const stat = fs.statSync(target);
  const result = stat.isDirectory()
    ? indexDirectory(target, args)
    : detectFile(target, args);
  if (args.forManifest && stat.isDirectory()) {
    const manifest = JSON.parse(fs.readFileSync(normalizePath(args.forManifest), 'utf8'));
    result.inputSuggestions = suggestInputBindings(manifest, result);
  }
  if (args.cache && stat.isDirectory()) {
    const cachePath = args.cache === true ? undefined : args.cache;
    const written = writeIndexCache(result, path.isAbsolute(cachePath) ? cachePath : path.join(target, cachePath));
    console.error(`[harness:index] wrote ${written}`);
  }
  console.log(JSON.stringify(result, null, 2));
}
