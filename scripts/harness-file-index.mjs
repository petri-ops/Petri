#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

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
    wantsDeg: /deg|差异|differential|de(seq)?2|log2?fc|p-?value/.test(text),
    wantsExpression: /expr|expression|表达|矩阵|count/.test(text),
    wantsGroup: /group|metadata|sample|分组|样本/.test(text),
  };
}

export function rankHarnessToolsForRequest(requestText, manifests = [], index = {}, options = {}) {
  const hints = requestIntentHints(requestText);
  const minRequiredBindings = options.minRequiredBindings ?? true;
  return manifests
    .map((manifest) => {
      const toolText = textForTool(manifest);
      const inputSuggestions = suggestInputBindings(manifest, index, { minScore: options.minInputScore ?? 25 });
      const requiredFileInputs = inputSuggestions.filter((binding) => binding.required);
      const missingRequired = requiredFileInputs.filter((binding) => !binding.selected);
      let score = 0;
      const reasons = [];

      if (hints.wantsVolcano && /volcano|火山/.test(toolText)) {
        score += 80;
        reasons.push('intent_volcano');
      }
      if (hints.wantsPca && /\bpca\b|主成分|降维/.test(toolText)) {
        score += 80;
        reasons.push('intent_pca');
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

export function repairHarnessParams(manifest, index, params = {}, options = {}) {
  const repairedParams = { ...params };
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
      });
    }
  }

  const degInput = fileInputs(manifest).find((input) => /deg|差异/.test(textForInput(input)));
  if (degInput) {
    const entry = firstSelectedEntry(index, selectedByInput.get(degInput.id));
    const columnRepair = inferColumnMappings(entry, ['gene', 'log2FC', 'pvalue']);
    if (Object.keys(columnRepair.mappings).length) {
      repairedParams.columnMappings = {
        ...(repairedParams.columnMappings || {}),
        [degInput.id]: columnRepair.mappings,
      };
      repairs.push({
        code: 'column_alias_mapped',
        inputId: degInput.id,
        mappings: columnRepair.mappings,
        missing: columnRepair.missing,
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
      });
    }
  }

  return {
    ok: warnings.length === 0,
    repairedParams,
    repairs,
    warnings,
    inputSuggestions,
  };
}

export function summarizeIndexForPrompt(index, options = {}) {
  const maxEntries = options.maxEntries ?? 40;
  return {
    harnessIndexVersion: index?.harnessIndexVersion || 1,
    root: index?.root,
    fileCount: index?.fileCount || 0,
    truncated: !!index?.truncated,
    byKind: index?.byKind || {},
    byRole: index?.byRole || {},
    entries: (index?.entries || []).slice(0, maxEntries).map((entry) => ({
      relativePath: entry.relativePath,
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

  return {
    id: 'local',
    dataDir,
    jobsDir,
    dbPath,
    resolveScope(options = {}) {
      const scope = String(options.scope || (options.jobId ? 'job' : options.projectId ? 'project' : 'path'));

      if (scope === 'path' || scope === 'workspace') {
        const target = normalizePath(options.path || options._?.[0] || '.');
        return {
          scope: 'path',
          id: null,
          target,
          partition: 'workspace',
          platform: 'local',
          exists: pathExists(target),
        };
      }

      if (scope === 'project') {
        if (options.projectPath || options.workspacePath || options.path) {
          const target = normalizePath(options.projectPath || options.workspacePath || options.path);
          return {
            scope,
            id: options.projectId || null,
            target,
            partition: 'project',
            platform: 'local',
            exists: pathExists(target),
          };
        }
        if (!options.projectId) throw new Error('project scope requires --project-id or --project-path');
        const row = readSqliteRow(dbPath, 'SELECT id, name, workspace_path FROM projects WHERE id = ?', [
          options.projectId,
        ]);
        if (row?.__dbError) throw new Error(`Cannot read project from db: ${row.__dbError}`);
        if (!row) throw new Error(`Project not found: ${options.projectId}`);
        const target = row.workspace_path || defaultProjectWorkspacePath(row, dataDir);
        return {
          scope,
          id: row.id,
          target,
          partition: 'project',
          platform: 'local',
          exists: pathExists(target),
          source: { dbPath, name: row.name, workspacePath: row.workspace_path || null },
        };
      }

      if (scope === 'job' || scope === 'artifact') {
        if (!options.jobId) throw new Error(`${scope} scope requires --job-id`);
        const jobRoot = safeJoinUnder(jobsDir, options.jobId);
        if (!jobRoot) throw new Error(`Invalid job id: ${options.jobId}`);
        const target = scope === 'artifact' ? path.join(jobRoot, 'output') : jobRoot;
        return {
          scope,
          id: options.jobId,
          target,
          partition: scope === 'artifact' ? 'artifact' : 'job',
          platform: 'local',
          exists: pathExists(target),
          source: { jobsDir, jobRoot },
        };
      }

      if (scope === 'dataset') {
        if (options.datasetPath || options.path) {
          const target = normalizePath(options.datasetPath || options.path);
          return {
            scope,
            id: options.datasetId || null,
            target,
            partition: 'dataset',
            platform: 'local',
            exists: pathExists(target),
          };
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
        return {
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
        };
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

export function indexHarnessScope(options = {}) {
  const resolved = resolveHarnessScope(options);
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
