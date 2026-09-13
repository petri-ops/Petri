'use strict';

const crypto = require('crypto');
const fs = require('fs');

const MAX_QUERY_BYTES = 64 * 1024 * 1024;
const MAX_QUERY_ROWS = 250_000;
const MAX_QUERY_PAGE_ROWS = 250;
const MAX_FILTER_CLAUSES = 8;
const MAX_CACHED_QUERY_BYTES = 16 * 1024 * 1024;
const MAX_CACHED_TABLES = 2;
const FILTER_OPERATORS = new Set(['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'in', 'contains']);
const TABLE_CACHE = new Map();

class ResultStudioTableQueryError extends Error {
  constructor(code, message, detail = null) {
    super(message);
    this.name = 'ResultStudioTableQueryError';
    this.code = code;
    this.detail = detail;
  }
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function sha256(value) {
  const payload = Buffer.isBuffer(value)
    ? value
    : typeof value === 'string'
      ? value
      : JSON.stringify(stableValue(value));
  return crypto.createHash('sha256').update(payload).digest('hex');
}

function detectDelimiter(header, filePath) {
  if (/\.tsv$/i.test(filePath)) return '\t';
  return (header.match(/\t/g) || []).length > (header.match(/,/g) || []).length ? '\t' : ',';
}

function splitDelimitedLine(line, delimiter) {
  const cells = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') { current += '"'; index += 1; continue; }
      quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      cells.push(current);
      current = '';
    } else current += char;
  }
  cells.push(current);
  return cells;
}

function normalizeColumnNames(columns) {
  const seen = new Map();
  return columns.map((raw, index) => {
    const base = String(raw || '').trim() || (index === 0 ? 'row_id' : `column_${index + 1}`);
    const count = seen.get(base) || 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}_${count + 1}`;
  });
}

function parseScientificNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = String(value ?? '').trim();
  if (!text) return null;
  const ratio = text.match(/^(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)$/);
  if (ratio) {
    const denominator = Number(ratio[2]);
    return denominator === 0 ? null : Number(ratio[1]) / denominator;
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function inferColumnTypes(columns, rows) {
  return columns.map((field) => {
    const values = rows.slice(0, 200).map((row) => row[field]).filter((value) => String(value ?? '').trim() !== '');
    const numeric = values.length > 0 && values.every((value) => parseScientificNumber(value) !== null);
    return { field, type: numeric ? 'number' : 'string', sortable: true, filterable: true };
  });
}

function normalizeFilter(filterExpression, columns) {
  const known = new Set(columns);
  if (!filterExpression || typeof filterExpression !== 'object') return { logic: 'and', clauses: [] };
  const logic = filterExpression.logic === 'or' ? 'or' : 'and';
  const rawClauses = Array.isArray(filterExpression.clauses) ? filterExpression.clauses : [];
  if (rawClauses.length > MAX_FILTER_CLAUSES) {
    throw new ResultStudioTableQueryError('filter_too_complex', `At most ${MAX_FILTER_CLAUSES} filter clauses are allowed.`);
  }
  const clauses = rawClauses.map((clause) => {
    const field = String(clause?.field || '').trim();
    const op = String(clause?.op || '').trim();
    if (!known.has(field)) throw new ResultStudioTableQueryError('filter_field_unknown', `Unknown filter field: ${field}`);
    if (!FILTER_OPERATORS.has(op)) throw new ResultStudioTableQueryError('filter_operator_unknown', `Unknown filter operator: ${op}`);
    return { field, op, value: clause.value };
  });
  return { logic, clauses };
}

function normalizeSort(sort, columns) {
  const known = new Set(columns);
  const output = [];
  for (const item of Array.isArray(sort) ? sort.slice(0, 3) : []) {
    const field = String(item?.field || '').trim();
    if (!known.has(field)) throw new ResultStudioTableQueryError('sort_field_unknown', `Unknown sort field: ${field}`);
    output.push({ field, direction: item.direction === 'desc' ? 'desc' : 'asc' });
  }
  return output;
}

function compareValues(left, right) {
  const leftNumber = parseScientificNumber(left);
  const rightNumber = parseScientificNumber(right);
  if (leftNumber !== null && rightNumber !== null) return leftNumber - rightNumber;
  return String(left ?? '').localeCompare(String(right ?? ''), 'en', { numeric: true, sensitivity: 'base' });
}

function matchesClause(row, clause) {
  const raw = row[clause.field];
  switch (clause.op) {
    case 'contains': return String(raw ?? '').toLowerCase().includes(String(clause.value ?? '').toLowerCase());
    case 'in': return Array.isArray(clause.value) && clause.value.some((value) => compareValues(raw, value) === 0);
    default: {
      const cmp = compareValues(raw, clause.value);
      switch (clause.op) {
        case 'eq': return cmp === 0;
        case 'ne': return cmp !== 0;
        case 'lt': return cmp < 0;
        case 'lte': return cmp <= 0;
        case 'gt': return cmp > 0;
        case 'gte': return cmp >= 0;
        default: return false;
      }
    }
  }
}

function matchesFilter(row, filter) {
  if (filter.clauses.length === 0) return true;
  return filter.logic === 'or'
    ? filter.clauses.some((clause) => matchesClause(row, clause))
    : filter.clauses.every((clause) => matchesClause(row, clause));
}

function tableIdentity(filePath) {
  const realPath = fs.realpathSync(filePath);
  const stat = fs.statSync(realPath, { bigint: true });
  const size = Number(stat.size);
  return {
    realPath,
    size,
    key: JSON.stringify([
      realPath,
      String(stat.dev),
      String(stat.ino),
      String(stat.size),
      String(stat.mtimeNs),
      String(stat.ctimeNs),
    ]),
  };
}

function cacheTable(identity, table) {
  if (identity.size > MAX_CACHED_QUERY_BYTES) return;
  for (const [key, entry] of TABLE_CACHE) {
    if (entry.realPath === identity.realPath) TABLE_CACHE.delete(key);
  }
  TABLE_CACHE.set(identity.key, { realPath: identity.realPath, table });
  while (TABLE_CACHE.size > MAX_CACHED_TABLES) {
    TABLE_CACHE.delete(TABLE_CACHE.keys().next().value);
  }
}

function clearResultTableCache() {
  TABLE_CACHE.clear();
}

function readDelimitedTable(filePath) {
  const identity = tableIdentity(filePath);
  if (identity.size > MAX_QUERY_BYTES) {
    throw new ResultStudioTableQueryError('table_query_file_too_large', 'Table exceeds the bounded query budget.', { bytes: identity.size, maxBytes: MAX_QUERY_BYTES });
  }
  // artifact_truth_drift 契约必须逐次调用对「当前字节」成立：stat 身份键在
  // Windows 粗粒度时间戳下可能漏报同长度字节变化，因此命中缓存也要重读并复核
  // 哈希，只有字节一致才复用解析结构（缓存省的是解析，不是读取）。
  const rawBytes = fs.readFileSync(identity.realPath);
  const rawSha256 = sha256(rawBytes);
  const cached = TABLE_CACHE.get(identity.key);
  if (cached && cached.table.rawSha256 === rawSha256) {
    TABLE_CACHE.delete(identity.key);
    TABLE_CACHE.set(identity.key, cached);
    return cached.table;
  }
  const raw = rawBytes.toString('utf8');
  const lines = raw.split(/\r?\n/).filter((line) => line.length > 0);
  if (lines.length === 0) {
    const table = { columns: [], rows: [], rawSha256 };
    cacheTable(identity, table);
    return table;
  }
  if (lines.length - 1 > MAX_QUERY_ROWS) {
    throw new ResultStudioTableQueryError('table_query_row_limit', 'Table exceeds the bounded row query budget.', { rows: lines.length - 1, maxRows: MAX_QUERY_ROWS });
  }
  const delimiter = detectDelimiter(lines[0], identity.realPath);
  const columns = normalizeColumnNames(splitDelimitedLine(lines[0], delimiter));
  const rows = lines.slice(1).map((line, sourceIndex) => {
    const cells = splitDelimitedLine(line, delimiter);
    const row = { __sourceIndex: sourceIndex };
    columns.forEach((column, index) => { row[column] = cells[index] ?? ''; });
    return row;
  });
  const table = { columns, rows, rawSha256 };
  cacheTable(identity, table);
  return table;
}

function queryResultTable({
  filePath,
  expectedSha256 = null,
  filterExpression = null,
  sort = [],
  offset = 0,
  limit = 100,
  idField = null,
  includeEntityIds = false,
} = {}) {
  if (!filePath) throw new ResultStudioTableQueryError('table_path_required', 'filePath is required.');
  const table = readDelimitedTable(filePath);
  if (expectedSha256 !== null) {
    const expected = String(expectedSha256 || '').trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(expected)) {
      throw new ResultStudioTableQueryError(
        'artifact_truth_unavailable',
        'The table has no trusted SHA-256 in Artifact Truth.',
      );
    }
    if (table.rawSha256 !== expected) {
      throw new ResultStudioTableQueryError(
        'artifact_truth_drift',
        'The table bytes no longer match Artifact Truth.',
      );
    }
  }
  const filter = normalizeFilter(filterExpression, table.columns);
  const normalizedSort = normalizeSort(sort, table.columns);
  const boundedOffset = Number.isInteger(offset) && offset >= 0 ? offset : 0;
  const boundedLimit = Number.isInteger(limit) && limit > 0 && limit <= MAX_QUERY_PAGE_ROWS ? limit : 100;
  const matched = table.rows.filter((row) => matchesFilter(row, filter));
  if (normalizedSort.length > 0) {
    matched.sort((left, right) => {
      for (const spec of normalizedSort) {
        const compared = compareValues(left[spec.field], right[spec.field]);
        if (compared !== 0) return spec.direction === 'desc' ? -compared : compared;
      }
      return left.__sourceIndex - right.__sourceIndex;
    });
  }
  const stableIdField = idField && table.columns.includes(idField) ? idField : null;
  const entityIds = stableIdField
    ? [...new Set(matched.map((row) => String(row[stableIdField] ?? '').trim()).filter(Boolean))]
    : [];
  const page = matched.slice(boundedOffset, boundedOffset + boundedLimit).map((row) =>
    Object.fromEntries(table.columns.map((column) => [column, row[column]])));
  const filterHash = sha256({ filter, sort: normalizedSort, fileSha256: table.rawSha256, idField: stableIdField });
  const result = {
    tableQueryVersion: 1,
    columns: inferColumnTypes(table.columns, table.rows),
    rows: page,
    totalRows: table.rows.length,
    matchedCount: matched.length,
    offset: boundedOffset,
    nextOffset: boundedOffset + page.length < matched.length ? boundedOffset + page.length : null,
    limit: boundedLimit,
    virtualized: matched.length > page.length,
    filterExpression: filter,
    sort: normalizedSort,
    filterHash,
    selectionEvidence: {
      idField: stableIdField,
      entityIdsHash: entityIds.length > 0 ? sha256([...entityIds].sort()) : null,
      sampleEntityIds: entityIds.slice(0, 12),
      entityIdCount: entityIds.length,
    },
    caveat: 'RFC4180 multiline cells are not supported by the bounded scientific table reader.',
  };
  // 仅供受控后端派生链使用；HTTP table/query 永远不传这个开关，避免把 10 万 ID
  // 塞给 renderer 或 Agent。
  if (includeEntityIds === true) result.resolvedEntityIds = entityIds;
  return result;
}

module.exports = {
  MAX_CACHED_QUERY_BYTES,
  MAX_CACHED_TABLES,
  MAX_QUERY_BYTES,
  MAX_QUERY_ROWS,
  MAX_QUERY_PAGE_ROWS,
  ResultStudioTableQueryError,
  clearResultTableCache,
  normalizeColumnNames,
  parseScientificNumber,
  queryResultTable,
};
