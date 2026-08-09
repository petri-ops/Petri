'use strict';

/**
 * Result Studio candidate validation is descriptor-driven and fail-closed.
 * Artifact Truth proves that declared files exist; this module additionally
 * proves their exact bytes and the scientific invariants named by the plugin.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { isPathContained } = require('./project-run-layout');
const { resolveExecutionInputPath } = require('./execution-provenance');

const RESULT_PLUGIN_VALIDATOR_VERSION = 1;
const MAX_SEMANTIC_BYTES = 64 * 1024 * 1024;
const MAX_SEMANTIC_ROWS = 500_000;
const SHA256 = /^[a-f0-9]{64}$/;
const SUPPORTED_CHECKS = new Set([
  'artifact_truth_valid',
  'script_sha256',
  'input_sha256',
  'output_sha256',
  'stable_gene_id',
  'stable_term_id',
  'empty_result_is_valid',
  'finite_statistics',
  'symmetric_matrix',
]);

function hashFile(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function trimmed(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function diagnostic(code, message, detail = null) {
  return { code, message, ...(detail == null ? {} : { detail }) };
}

function resultOf(job) {
  if (!job) return {};
  if (job.result && typeof job.result === 'object') return job.result;
  try { return JSON.parse(job.result_json || '{}'); } catch { return {}; }
}

function detectDelimiter(raw) {
  let quoted = false;
  let commas = 0;
  let tabs = 0;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (char === '"') {
      if (quoted && raw[index + 1] === '"') index += 1;
      else quoted = !quoted;
    } else if (!quoted && (char === '\n' || char === '\r')) break;
    else if (!quoted && char === ',') commas += 1;
    else if (!quoted && char === '\t') tabs += 1;
  }
  return tabs > commas ? '\t' : ',';
}

function parseDelimitedRecords(raw, delimiter) {
  const records = [];
  let record = [];
  let cell = '';
  let quoted = false;
  let quoteClosed = false;
  const pushRecord = () => {
    record.push(cell);
    records.push(record);
    record = [];
    cell = '';
    quoteClosed = false;
  };
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (quoted) {
      if (char === '"' && raw[index + 1] === '"') { cell += '"'; index += 1; }
      else if (char === '"') { quoted = false; quoteClosed = true; }
      else cell += char;
      continue;
    }
    if (quoteClosed) {
      if (char === delimiter) { record.push(cell); cell = ''; quoteClosed = false; continue; }
      if (char === '\n' || char === '\r') {
        if (char === '\r' && raw[index + 1] === '\n') index += 1;
        pushRecord();
        continue;
      }
      return { ok: false, reason: 'characters_after_closing_quote' };
    }
    if (char === '"') {
      if (cell.length > 0) return { ok: false, reason: 'quote_inside_unquoted_cell' };
      quoted = true;
    } else if (char === delimiter) {
      record.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && raw[index + 1] === '\n') index += 1;
      pushRecord();
    } else cell += char;
  }
  if (quoted) return { ok: false, reason: 'unterminated_quote' };
  if (cell.length > 0 || record.length > 0 || quoteClosed) pushRecord();
  while (records.length > 0 && records[records.length - 1].every((value) => value === '')) records.pop();
  return { ok: true, records };
}

function normalizeColumns(values) {
  const columns = values.map((value, index) => {
    const normalized = String(value || '').replace(/^\uFEFF/, '').trim();
    return normalized || (index === 0 ? 'row_id' : '');
  });
  if (columns.length === 0 || columns.some((value) => !value)) return null;
  const folded = columns.map((value) => value.toLowerCase());
  return new Set(folded).size === folded.length ? columns : null;
}

function readExactTable(filePath) {
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) return { ok: false, reason: 'semantic_output_not_file' };
  if (stat.size > MAX_SEMANTIC_BYTES) return { ok: false, reason: 'semantic_output_too_large' };
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = parseDelimitedRecords(raw, detectDelimiter(raw));
  if (!parsed.ok) return parsed;
  if (parsed.records.length === 0) return { ok: false, reason: 'semantic_table_empty_file' };
  if (parsed.records.length - 1 > MAX_SEMANTIC_ROWS) return { ok: false, reason: 'semantic_table_row_limit' };
  const columns = normalizeColumns(parsed.records[0]);
  if (!columns) return { ok: false, reason: 'semantic_table_header_invalid' };
  const rows = [];
  for (const values of parsed.records.slice(1)) {
    if (values.length !== columns.length) return { ok: false, reason: 'semantic_table_row_shape_invalid' };
    rows.push(Object.fromEntries(columns.map((column, index) => [column, values[index]])));
  }
  return { ok: true, columns, rows };
}

function exactProjectFile(workspaceRoot, filePath) {
  if (!workspaceRoot || !filePath || !path.isAbsolute(filePath)) return null;
  try {
    const root = fs.realpathSync(workspaceRoot);
    const target = fs.realpathSync(filePath);
    return isPathContained(root, target) && fs.statSync(target).isFile() ? target : null;
  } catch { return null; }
}

function collectFormalArtifacts({ descriptor, result, workspaceRoot, diagnostics }) {
  const formal = [];
  const descriptors = Array.isArray(descriptor?.artifacts) ? descriptor.artifacts : [];
  const descriptorIds = new Set();
  for (const artifactDescriptor of descriptors) {
    const artifactId = trimmed(artifactDescriptor && artifactDescriptor.id);
    if (!artifactId || descriptorIds.has(artifactId)) {
      diagnostics.push(diagnostic('validator_artifact_descriptor_invalid', 'Plugin formal Artifact ids must be non-empty and unique.'));
      continue;
    }
    descriptorIds.add(artifactId);
    const artifacts = (Array.isArray(result.artifacts) ? result.artifacts : [])
      .filter((artifact) => artifact && artifact.id === artifactId);
    if (artifacts.length === 0) {
      if (artifactDescriptor.required !== false) {
        diagnostics.push(diagnostic(
          'validator_formal_artifact_missing',
          'A required descriptor formal Artifact is absent from the completed Job.',
          { artifactId }
        ));
      }
      continue;
    }
    const provenanceArtifacts = (Array.isArray(result.executionProvenance?.artifacts)
      ? result.executionProvenance.artifacts : [])
      .filter((artifact) => artifact && artifact.id === artifactId);
    if (artifacts.length !== 1 || provenanceArtifacts.length !== 1) {
      diagnostics.push(diagnostic(
        'validator_formal_artifact_ambiguous',
        'A produced formal Artifact must occur exactly once in result and provenance.',
        { artifactId }
      ));
      continue;
    }
    const filePath = exactProjectFile(workspaceRoot, artifacts[0].path);
    const recordedHash = trimmed(provenanceArtifacts[0].sha256);
    if (!filePath || !SHA256.test(recordedHash)) {
      diagnostics.push(diagnostic(
        'validator_formal_artifact_untrusted',
        'A produced formal Artifact lacks a contained file or provenance hash.',
        { artifactId }
      ));
      continue;
    }
    const expectedFilename = trimmed(artifactDescriptor.filename);
    if (expectedFilename && path.basename(filePath) !== expectedFilename) {
      diagnostics.push(diagnostic(
        'validator_formal_artifact_filename_mismatch',
        'A formal Artifact path does not match the descriptor filename.',
        { artifactId, expectedFilename, actualFilename: path.basename(filePath) }
      ));
      continue;
    }
    const sha256 = hashFile(filePath);
    if (sha256 !== recordedHash) {
      diagnostics.push(diagnostic(
        'validator_output_hash_mismatch',
        'A formal Artifact no longer matches execution provenance.',
        { artifactId }
      ));
      continue;
    }
    formal.push({
      artifactId,
      type: trimmed(artifactDescriptor.type) || trimmed(artifacts[0].type) || null,
      filename: trimmed(artifactDescriptor.filename) || path.basename(filePath),
      path: filePath,
      sha256,
    });
  }
  if (formal.length === 0) {
    diagnostics.push(diagnostic('validator_formal_artifacts_missing', 'The Job produced no formal Result Studio Artifact.'));
  }
  return formal;
}

function validateScriptHash({ result, expectedScriptSha256, diagnostics }) {
  const actual = trimmed(result.executionProvenance?.script?.sha256);
  if (!SHA256.test(trimmed(expectedScriptSha256)) || actual !== expectedScriptSha256) {
    diagnostics.push(diagnostic('validator_script_hash_mismatch', 'Executed script bytes do not match the materialized candidate source.'));
  }
}

function validateInputHashes({ descriptor, result, rawParams, workspaceRoot, diagnostics }) {
  const inputs = Array.isArray(result.executionProvenance?.inputs) ? result.executionProvenance.inputs : [];
  const byId = new Map();
  for (const input of inputs) {
    const inputId = trimmed(input && input.id);
    if (!inputId || byId.has(inputId) || !SHA256.test(trimmed(input && input.sha256))) {
      diagnostics.push(diagnostic('validator_input_provenance_invalid', 'Execution inputs require unique ids and SHA-256 hashes.', { inputId: inputId || null }));
      continue;
    }
    byId.set(inputId, input);
    const normalized = result.executionProvenance?.params?.normalized?.[inputId];
    if (!normalized || typeof normalized !== 'object' || normalized.sha256 !== input.sha256) {
      diagnostics.push(diagnostic('validator_normalized_input_hash_mismatch', 'Normalized parameters do not bind the exact input hash.', { inputId }));
    }
    const suppliedPath = rawParams && typeof rawParams[inputId] === 'string'
      ? rawParams[inputId]
      : null;
    const trustedInput = suppliedPath && path.isAbsolute(suppliedPath)
      ? {
        path: exactProjectFile(workspaceRoot, suppliedPath),
        source: 'explicit_parameter',
        reason: 'explicit_parameter_unavailable',
      }
      : resolveExecutionInputPath({
        workspaceRoot,
        input,
        sourceParams: rawParams || {},
        provenance: result.executionProvenance,
      });
    const filePath = trustedInput.path;
    if (!filePath || hashFile(filePath) !== input.sha256) {
      diagnostics.push(diagnostic('validator_input_hash_mismatch', 'A candidate input file changed or escaped the project.', {
        inputId,
        source: trustedInput.source || trustedInput.reason,
      }));
    }
  }
  for (const binding of Array.isArray(descriptor?.inputBindings) ? descriptor.inputBindings : []) {
    if (binding?.required === true && !byId.has(trimmed(binding.inputId))) {
      diagnostics.push(diagnostic('validator_required_input_missing', 'A required descriptor input is absent from execution provenance.', { inputId: trimmed(binding.inputId) || null }));
    }
  }
}

function artifactTable(artifactId, formalById, tableCache, diagnostics) {
  if (tableCache.has(artifactId)) return tableCache.get(artifactId);
  const artifact = formalById.get(artifactId);
  if (!artifact) return null;
  let table;
  try { table = readExactTable(artifact.path); }
  catch { table = { ok: false, reason: 'semantic_table_unreadable' }; }
  if (!table.ok) {
    diagnostics.push(diagnostic('validator_semantic_table_invalid', 'A semantic table cannot be parsed exactly.', { artifactId, reason: table.reason }));
    tableCache.set(artifactId, null);
    return null;
  }
  tableCache.set(artifactId, table);
  return table;
}

function validateStableIds({ descriptor, kind, allowEmpty, formalById, tableCache, diagnostics }) {
  const expectedEntity = kind === 'gene' ? 'gene' : 'pathway';
  const mappings = (Array.isArray(descriptor?.interactionMappings) ? descriptor.interactionMappings : [])
    .filter((mapping) => mapping?.mode === 'table' && mapping.entityType === expectedEntity);
  let checked = 0;
  for (const mapping of mappings) {
    if (!formalById.has(mapping.artifactId)) continue;
    const table = artifactTable(mapping.artifactId, formalById, tableCache, diagnostics);
    if (!table) continue;
    const idField = trimmed(mapping.idField || mapping.rowIdField);
    if (!idField || !table.columns.includes(idField)) {
      diagnostics.push(diagnostic('validator_stable_id_field_missing', 'The declared stable identifier column is absent.', { artifactId: mapping.artifactId, idField: idField || null }));
      continue;
    }
    if (table.rows.length === 0 && allowEmpty) { checked += 1; continue; }
    const ids = table.rows.map((row) => trimmed(row[idField]));
    if (ids.some((value) => !value) || new Set(ids).size !== ids.length) {
      diagnostics.push(diagnostic('validator_stable_id_invalid', 'Stable entity identifiers must be non-empty and unique.', { artifactId: mapping.artifactId, idField }));
      continue;
    }
    checked += 1;
  }
  if (checked === 0) diagnostics.push(diagnostic('validator_stable_id_artifact_missing', `No formal ${kind} table was available for stable-id validation.`));
}

function validateFiniteStatistics({ descriptor, formalById, tableCache, diagnostics }) {
  const fields = descriptor?.entity?.fields && typeof descriptor.entity.fields === 'object'
    ? descriptor.entity.fields : {};
  const numericFields = Object.entries(fields)
    .filter(([, type]) => String(type).startsWith('number'));
  let checked = 0;
  for (const artifact of formalById.values()) {
    if (artifact.type !== 'table') continue;
    const table = artifactTable(artifact.artifactId, formalById, tableCache, diagnostics);
    if (!table) continue;
    const present = numericFields.filter(([field]) => table.columns.includes(field));
    if (present.length === 0) continue;
    for (const row of table.rows) {
      for (const [field, type] of present) {
        const raw = String(row[field] ?? '').trim();
        // R serializes an NA scalar as the literal `NA` in CSV by default.
        // Treat it as null only when the descriptor explicitly admits null;
        // required numerics and other non-finite spellings remain fail-closed.
        if ((!raw || raw === 'NA') && String(type).includes('|null')) continue;
        if (!raw) {
          diagnostics.push(diagnostic('validator_statistic_missing', 'A required declared numeric statistic is missing.', { artifactId: artifact.artifactId, field }));
          continue;
        }
        const value = Number(raw);
        if (!Number.isFinite(value)) {
          diagnostics.push(diagnostic('validator_statistic_not_finite', 'A declared numeric statistic is missing or non-finite.', { artifactId: artifact.artifactId, field }));
          continue;
        }
        if (/(?:^|_)(?:pvalue|padj|p_adjust)$|^significance$/i.test(field) && (value < 0 || value > 1)) {
          diagnostics.push(diagnostic('validator_probability_out_of_range', 'A declared probability statistic is outside [0, 1].', { artifactId: artifact.artifactId, field }));
        }
      }
    }
    checked += 1;
  }
  if (checked === 0) diagnostics.push(diagnostic('validator_statistics_artifact_missing', 'No formal table exposed the descriptor-declared numeric statistics.'));
}

function validateSymmetricMatrices({ descriptor, formalById, tableCache, diagnostics }) {
  const mappings = Array.isArray(descriptor?.interactionMappings) ? descriptor.interactionMappings : [];
  const targets = new Map();
  for (const mapping of mappings.filter((entry) => entry?.mode === 'matrix')) {
    const artifactId = trimmed(mapping.dataArtifactId || mapping.artifactId);
    if (artifactId && formalById.get(artifactId)?.type === 'table') targets.set(artifactId, mapping);
  }
  let checked = 0;
  for (const [artifactId, mapping] of targets) {
    const table = artifactTable(artifactId, formalById, tableCache, diagnostics);
    if (!table) continue;
    const rowIdField = trimmed(mapping.rowIdField) || 'row_id';
    if (!table.columns.includes(rowIdField)) {
      diagnostics.push(diagnostic('validator_matrix_row_id_missing', 'The symmetric matrix row identifier is absent.', { artifactId, rowIdField }));
      continue;
    }
    const columns = table.columns.filter((column) => column !== rowIdField);
    const rowIds = table.rows.map((row) => trimmed(row[rowIdField]));
    if (columns.length === 0 || table.rows.length !== columns.length
        || rowIds.some((value) => !value) || new Set(rowIds).size !== rowIds.length
        || new Set(columns).size !== columns.length
        || columns.some((column) => !rowIds.includes(column))) {
      diagnostics.push(diagnostic('validator_matrix_shape_invalid', 'A symmetric matrix must be square with identical unique row and column ids.', { artifactId }));
      continue;
    }
    const rowsById = new Map(table.rows.map((row) => [trimmed(row[rowIdField]), row]));
    let valid = true;
    for (const rowId of rowIds) {
      for (const columnId of columns) {
        const left = Number(rowsById.get(rowId)[columnId]);
        const right = Number(rowsById.get(columnId)[rowId]);
        const scale = Math.max(1, Math.abs(left), Math.abs(right));
        if (!Number.isFinite(left) || !Number.isFinite(right) || Math.abs(left - right) > 1e-10 * scale) {
          valid = false;
          break;
        }
      }
      if (!valid) break;
    }
    if (!valid) {
      diagnostics.push(diagnostic('validator_matrix_not_symmetric', 'Matrix values are non-finite or not symmetric within exact numeric tolerance.', { artifactId }));
      continue;
    }
    checked += 1;
  }
  if (checked === 0) diagnostics.push(diagnostic('validator_symmetric_matrix_missing', 'No formal descriptor-declared symmetric matrix was validated.'));
}

function validateResultStudioCandidate({
  descriptor,
  job,
  workspaceRoot,
  expectedScriptSha256,
  rawParams = null,
} = {}) {
  const diagnostics = [];
  const validator = descriptor?.validator;
  const checks = Array.isArray(validator?.checks) ? [...new Set(validator.checks.map(trimmed).filter(Boolean))] : [];
  if (!trimmed(validator?.id) || checks.length === 0) {
    diagnostics.push(diagnostic('validator_descriptor_missing', 'The plugin does not declare an executable Result Studio validator.'));
  }
  for (const check of checks) {
    if (!SUPPORTED_CHECKS.has(check)) diagnostics.push(diagnostic('validator_check_unsupported', 'The plugin requested an unsupported validation check.', { check }));
  }
  const result = resultOf(job);
  if (!job || job.status !== 'completed') diagnostics.push(diagnostic('validator_job_incomplete', 'Only a completed candidate Job can be validated.'));
  if (checks.includes('artifact_truth_valid')
      && (result.artifactTruth?.status !== 'valid' || result.artifactTruth?.blocking === true)) {
    diagnostics.push(diagnostic('validator_artifact_truth_invalid', 'Candidate Artifact Truth is not valid.'));
  }
  const formalArtifacts = collectFormalArtifacts({ descriptor, result, workspaceRoot, diagnostics });
  if (checks.includes('script_sha256')) validateScriptHash({ result, expectedScriptSha256, diagnostics });
  if (checks.includes('input_sha256')) {
    validateInputHashes({ descriptor, result, rawParams: rawParams || job?.params || {}, workspaceRoot, diagnostics });
  }
  const formalById = new Map(formalArtifacts.map((artifact) => [artifact.artifactId, artifact]));
  const tableCache = new Map();
  const allowEmpty = checks.includes('empty_result_is_valid');
  if (checks.includes('stable_gene_id')) {
    validateStableIds({ descriptor, kind: 'gene', allowEmpty: false, formalById, tableCache, diagnostics });
  }
  if (checks.includes('stable_term_id')) {
    validateStableIds({ descriptor, kind: 'term', allowEmpty, formalById, tableCache, diagnostics });
  }
  if (checks.includes('finite_statistics')) {
    validateFiniteStatistics({ descriptor, formalById, tableCache, diagnostics });
  }
  if (checks.includes('symmetric_matrix')) {
    validateSymmetricMatrices({ descriptor, formalById, tableCache, diagnostics });
  }
  const ok = diagnostics.length === 0;
  return {
    resultPluginValidatorVersion: RESULT_PLUGIN_VALIDATOR_VERSION,
    ok,
    status: ok ? 'valid' : 'blocked',
    validatorId: trimmed(validator?.id) || null,
    checks,
    diagnostics,
    formalArtifacts,
    validationStatus: ok ? 'valid' : 'invalid',
    // A semantic validator proves the candidate, not an independent replay.
    // Repository code may upgrade this only after exact ReplayPackage proof.
    reproducibilityStatus: 'available',
    exactReplayVerified: false,
  };
}

module.exports = {
  RESULT_PLUGIN_VALIDATOR_VERSION,
  MAX_SEMANTIC_BYTES,
  MAX_SEMANTIC_ROWS,
  SUPPORTED_CHECKS,
  validateResultStudioCandidate,
};
