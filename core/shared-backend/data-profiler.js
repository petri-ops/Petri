'use strict';

/**
 * SDC-1 bounded, read-only profiler for delimited text files.
 *
 * This module deliberately reports observations and candidates.  It does not
 * bind a file to a scientific profile and it never mutates the input file.
 * The input stream is consumed once: the complete stream is hashed while a
 * bounded prefix/sample is parsed by the small CSV state machine below.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DATA_PROFILER_VERSION = 'sdc-1.data-profiler.v1';
const SNAPSHOT_VERSION = 'sdc-1.snapshot.v1';
const SUPPORTED_EXTENSIONS = Object.freeze(['.csv', '.tsv', '.txt']);

const DEFAULT_LIMITS = Object.freeze({
  maxSampleRows: 50,
  maxColumns: 256,
  maxRowBytes: 512 * 1024,
  maxCellBytes: 64 * 1024,
  maxProbeBytes: 64 * 1024,
});

const HARD_LIMITS = Object.freeze({
  maxSampleRows: 2000,
  maxColumns: 4096,
  maxRowBytes: 8 * 1024 * 1024,
  maxCellBytes: 2 * 1024 * 1024,
  maxProbeBytes: 256 * 1024,
});

const BLOCKING_CODES = new Set([
  'invalid_input',
  'unsupported_file_type',
  'file_not_found',
  'not_a_regular_file',
  'permission_denied',
  'read_error',
  'empty_file',
  'empty_dataset',
  'no_data_rows',
  'unsupported_encoding',
  'malformed_csv',
  'unterminated_quoted_field',
  'quote_in_unquoted_field',
  'characters_after_closing_quote',
  'too_wide',
  'truncated_row',
  'truncated_cell',
  'file_changed_during_read',
]);

function clampLimit(value, fallback, maximum) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 1) return fallback;
  return Math.min(Math.floor(number), maximum);
}

function normalizeLimits(input = {}) {
  const options = input.options && typeof input.options === 'object' ? input.options : {};
  const limits = input.limits && typeof input.limits === 'object' ? input.limits : {};
  // Accept both an options/limits bag and direct top-level limits.  The latter
  // keeps the public call shape small for callers that only need one bound.
  const merged = { ...input, ...limits, ...options };
  return {
    maxSampleRows: clampLimit(
      merged.maxSampleRows ?? merged.sampleRows,
      DEFAULT_LIMITS.maxSampleRows,
      HARD_LIMITS.maxSampleRows,
    ),
    maxColumns: clampLimit(
      merged.maxColumns ?? merged.sampleColumns,
      DEFAULT_LIMITS.maxColumns,
      HARD_LIMITS.maxColumns,
    ),
    maxRowBytes: clampLimit(
      merged.maxRowBytes ?? merged.rowBytes,
      DEFAULT_LIMITS.maxRowBytes,
      HARD_LIMITS.maxRowBytes,
    ),
    maxCellBytes: clampLimit(
      merged.maxCellBytes ?? merged.cellBytes,
      DEFAULT_LIMITS.maxCellBytes,
      HARD_LIMITS.maxCellBytes,
    ),
    maxProbeBytes: clampLimit(
      merged.maxProbeBytes ?? merged.probeBytes,
      DEFAULT_LIMITS.maxProbeBytes,
      HARD_LIMITS.maxProbeBytes,
    ),
  };
}

function diagnostic(code, severity, message, details = {}) {
  return { code, severity, message, ...details };
}

function isBlockingDiagnostic(item) {
  return item && (item.severity === 'blocked' || BLOCKING_CODES.has(item.code));
}

function isMissingValue(value) {
  if (value === null || value === undefined) return true;
  const normalized = String(value).trim().toLowerCase();
  return normalized === '' || normalized === 'na' || normalized === 'n/a'
    || normalized === 'null' || normalized === 'none' || normalized === 'nan'
    || normalized === '.';
}

function finiteNumber(value) {
  if (isMissingValue(value)) return false;
  const text = String(value).trim();
  if (text === '' || !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) return false;
  const number = Number(text);
  return Number.isFinite(number);
}

function integerValue(value) {
  if (isMissingValue(value)) return false;
  return /^[+-]?\d+$/.test(String(value).trim());
}

function booleanValue(value) {
  if (isMissingValue(value)) return false;
  return /^(?:true|false|yes|no|0|1)$/i.test(String(value).trim());
}

function dateValue(value) {
  if (isMissingValue(value)) return false;
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}(?:[T ][0-9]{2}:[0-9]{2}(?::[0-9]{2}(?:\.\d+)?)?(?:Z|[+-][0-9]{2}:?[0-9]{2})?)?$/.test(text)) {
    return false;
  }
  return !Number.isNaN(Date.parse(text));
}

function classifyPrimitiveCandidates(values) {
  const nonMissing = values.filter((value) => !isMissingValue(value));
  const sampleCount = values.length;
  const missingCount = sampleCount - nonMissing.length;
  const observedValues = nonMissing.length;
  const predicates = [
    ['integer', integerValue],
    ['number', finiteNumber],
    ['boolean', booleanValue],
    ['date', dateValue],
  ];
  const candidates = predicates.map(([candidate, predicate]) => {
    const matchingValues = nonMissing.filter(predicate).length;
    const confidence = observedValues === 0 ? 0 : matchingValues / observedValues;
    return {
      candidate,
      confidence: Number(confidence.toFixed(4)),
      evidence: {
        observedValues,
        matchingValues,
        missingValues: missingCount,
        sampleCount,
      },
      basis: `matched ${matchingValues}/${observedValues || 0} non-missing sampled values`,
    };
  });
  const typedMatches = new Set(
    predicates.flatMap(([candidate, predicate]) => nonMissing.filter(predicate).map(() => candidate)),
  );
  const stringMatches = nonMissing.filter((value) => {
    if (typedMatches.size === 0) return true;
    return !predicates.some(([, predicate]) => predicate(value));
  }).length;
  candidates.push({
    candidate: 'string',
    confidence: Number((observedValues === 0 ? 0 : stringMatches / observedValues).toFixed(4)),
    evidence: {
      observedValues,
      matchingValues: stringMatches,
      missingValues: missingCount,
      sampleCount,
    },
    basis: `non-missing values not matching a narrower primitive candidate: ${stringMatches}/${observedValues || 0}`,
  });
  return candidates.sort((left, right) => right.confidence - left.confidence);
}

class Utf8Validator {
  constructor() {
    this.expected = 0;
    this.codePoint = 0;
    this.minimum = 0;
    this.invalid = false;
    this.invalidByte = null;
  }

  feed(byte, offset) {
    if (this.invalid) return;
    if (this.expected === 0) {
      if (byte <= 0x7f) return;
      if (byte >= 0xc2 && byte <= 0xdf) {
        this.expected = 1;
        this.codePoint = byte & 0x1f;
        this.minimum = 0x80;
        return;
      }
      if (byte >= 0xe0 && byte <= 0xef) {
        this.expected = 2;
        this.codePoint = byte & 0x0f;
        this.minimum = 0x800;
        return;
      }
      if (byte >= 0xf0 && byte <= 0xf4) {
        this.expected = 3;
        this.codePoint = byte & 0x07;
        this.minimum = 0x10000;
        return;
      }
      this.invalid = true;
      this.invalidByte = { byte, offset };
      return;
    }
    if (byte < 0x80 || byte > 0xbf) {
      this.invalid = true;
      this.invalidByte = { byte, offset };
      return;
    }
    this.codePoint = (this.codePoint << 6) | (byte & 0x3f);
    this.expected -= 1;
    if (this.expected === 0 && (this.codePoint < this.minimum || this.codePoint > 0x10ffff
      || (this.codePoint >= 0xd800 && this.codePoint <= 0xdfff))) {
      this.invalid = true;
      this.invalidByte = { byte, offset, codePoint: this.codePoint };
    }
  }

  finish() {
    if (!this.invalid && this.expected !== 0) {
      this.invalid = true;
      this.invalidByte = { reason: 'truncated_utf8_sequence' };
    }
    return !this.invalid;
  }
}

function countDelimitersOutsideQuotes(buffer, delimiterCode) {
  let inQuotes = false;
  let count = 0;
  let rowCount = 0;
  let fieldsInRow = 1;
  let rowsWithDelimiter = 0;
  for (let index = 0; index < buffer.length; index += 1) {
    const byte = buffer[index];
    if (byte === 0x22) {
      if (inQuotes && buffer[index + 1] === 0x22) {
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (inQuotes) continue;
    if (byte === delimiterCode) {
      count += 1;
      fieldsInRow += 1;
    } else if (byte === 0x0a || byte === 0x0d) {
      rowCount += 1;
      if (fieldsInRow > 1) rowsWithDelimiter += 1;
      fieldsInRow = 1;
    }
  }
  if (fieldsInRow > 1) rowsWithDelimiter += 1;
  return { count, rowCount, rowsWithDelimiter };
}

function detectDelimiter(buffer, extension, requestedDelimiter) {
  if (requestedDelimiter === ',' || requestedDelimiter === '\t') return requestedDelimiter;
  const candidates = [',', '\t', ';', '|'];
  const scores = candidates.map((delimiter) => {
    const result = countDelimitersOutsideQuotes(buffer, delimiter.charCodeAt(0));
    const extensionBonus = extension === '.tsv' && delimiter === '\t' ? 2
      : extension === '.csv' && delimiter === ',' ? 2 : 0;
    const consistency = result.rowsWithDelimiter > 0
      ? result.rowsWithDelimiter / Math.max(result.rowCount, 1) : 0;
    return {
      delimiter,
      ...result,
      score: result.count * (1 + consistency) + extensionBonus,
    };
  });
  scores.sort((left, right) => right.score - left.score || right.count - left.count);
  return scores[0].count > 0 ? scores[0].delimiter : null;
}

class DelimitedStateMachine {
  constructor(delimiter, limits) {
    this.delimiter = delimiter;
    this.delimiterCode = delimiter ? delimiter.charCodeAt(0) : null;
    this.limits = limits;
    this.quotesEnabled = delimiter !== null;
    this.inQuotes = false;
    this.quoteClosed = false;
    this.justEndedCR = false;
    this.fieldAtStart = true;
    this.fieldParts = [];
    this.fieldLength = 0;
    this.fieldTruncated = false;
    this.rowFields = [];
    this.fieldCount = 0;
    this.rowBytes = 0;
    this.rowHasBytes = false;
    this.rowTruncated = false;
    this.rows = [];
    this.totalRows = 0;
    this.minColumns = null;
    this.maxColumns = 0;
    this.tooWide = false;
    this.truncatedRow = false;
    this.truncatedCell = false;
    this.malformed = false;
    this.issueCodes = new Set();
  }

  issue(code) {
    this.issueCodes.add(code);
    if (code === 'too_wide') this.tooWide = true;
    if (code === 'truncated_row') {
      this.truncatedRow = true;
      this.rowTruncated = true;
    }
    if (code === 'truncated_cell') {
      this.truncatedCell = true;
      this.fieldTruncated = true;
    }
    if (code !== 'too_wide' && code !== 'truncated_row' && code !== 'truncated_cell') this.malformed = true;
  }

  markRowByte() {
    this.rowBytes += 1;
    if (this.rowBytes > this.limits.maxRowBytes) this.issue('truncated_row');
  }

  appendFieldByte(byte) {
    if (this.fieldLength < this.limits.maxCellBytes) {
      this.fieldParts.push(byte);
    } else {
      this.issue('truncated_cell');
    }
    this.fieldLength += 1;
  }

  finishField() {
    this.fieldCount += 1;
    if (this.fieldCount > this.limits.maxColumns) this.issue('too_wide');
    if (this.fieldCount <= this.limits.maxColumns) {
      const value = Buffer.from(this.fieldParts).toString('utf8');
      this.rowFields.push(value);
    }
    this.fieldParts = [];
    this.fieldLength = 0;
    this.fieldTruncated = false;
    this.fieldAtStart = true;
  }

  finishRow() {
    if (!this.rowHasBytes && this.fieldCount === 0 && this.fieldLength === 0) return;
    this.finishField();
    const columnCount = this.fieldCount;
    this.totalRows += 1;
    this.minColumns = this.minColumns === null ? columnCount : Math.min(this.minColumns, columnCount);
    this.maxColumns = Math.max(this.maxColumns, columnCount);
    if (this.rows.length < this.limits.maxSampleRows) {
      this.rows.push(this.rowFields.slice());
    }
    this.rowFields = [];
    this.fieldCount = 0;
    this.rowBytes = 0;
    this.rowHasBytes = false;
    this.rowTruncated = false;
    this.fieldAtStart = true;
    this.justEndedCR = false;
  }

  consume(buffer) {
    for (let index = 0; index < buffer.length; index += 1) {
      let byte = buffer[index];
      if (this.justEndedCR) {
        if (byte === 0x0a) {
          this.justEndedCR = false;
          continue;
        }
        this.justEndedCR = false;
      }

      if (this.inQuotes) {
        this.markRowByte();
        this.rowHasBytes = true;
        if (byte === 0x22) {
          this.inQuotes = false;
          this.quoteClosed = true;
        } else {
          this.appendFieldByte(byte);
        }
        continue;
      }

      if (this.quoteClosed) {
        this.markRowByte();
        this.rowHasBytes = true;
        if (this.quotesEnabled && byte === 0x22) {
          this.appendFieldByte(byte);
          this.inQuotes = true;
          this.quoteClosed = false;
          this.fieldAtStart = false;
        } else if (this.quotesEnabled && byte === this.delimiterCode) {
          this.quoteClosed = false;
          this.finishField();
        } else if (this.quotesEnabled && byte === 0x0a) {
          this.quoteClosed = false;
          this.finishRow();
        } else if (this.quotesEnabled && byte === 0x0d) {
          this.quoteClosed = false;
          this.finishRow();
          this.justEndedCR = true;
        } else {
          this.issue('characters_after_closing_quote');
          this.quoteClosed = false;
          this.fieldAtStart = false;
          this.appendFieldByte(byte);
        }
        continue;
      }

      this.markRowByte();
      this.rowHasBytes = true;
      if (byte === 0x0a) {
        this.finishRow();
      } else if (byte === 0x0d) {
        this.finishRow();
        this.justEndedCR = true;
      } else if (this.quotesEnabled && byte === this.delimiterCode) {
        this.finishField();
      } else if (this.quotesEnabled && byte === 0x22) {
        if (this.fieldAtStart) {
          this.inQuotes = true;
          this.fieldAtStart = false;
        } else {
          this.issue('quote_in_unquoted_field');
          this.appendFieldByte(byte);
          this.fieldAtStart = false;
        }
      } else {
        this.appendFieldByte(byte);
        this.fieldAtStart = false;
      }
    }
  }

  finish() {
    if (this.inQuotes) this.issue('unterminated_quoted_field');
    if (this.quoteClosed) this.quoteClosed = false;
    if (this.rowHasBytes || this.fieldCount > 0 || this.fieldLength > 0) this.finishRow();
    return this;
  }
}

function candidate(candidateName, confidence, evidence, basis) {
  return {
    candidate: candidateName,
    confidence: Number(Math.max(0, Math.min(1, confidence)).toFixed(4)),
    evidence,
    basis,
  };
}

function ratio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}

function buildObservation(machine, limits, delimiter, diagnostics) {
  const rawRows = machine.rows;
  const firstRow = rawRows[0] || [];
  const secondRow = rawRows[1] || [];
  const firstNonMissing = firstRow.filter((value) => !isMissingValue(value));
  const firstStringish = firstNonMissing.filter((value) => !finiteNumber(value)).length;
  const secondNonMissing = secondRow.filter((value) => !isMissingValue(value));
  const secondNumeric = secondNonMissing.filter(finiteNumber).length;
  const width = machine.maxColumns || firstRow.length || 0;
  const firstHeaderNames = firstRow.filter((value) => /(?:^|[_ .-])(id|name|gene|sample|group|condition|value|count|status|type)(?:$|[_ .-])/i.test(String(value)));
  const oneRowHeaderSignal = firstNonMissing.length > 0 && (
    firstHeaderNames.length > 0 || ratio(firstStringish, firstNonMissing.length) >= 0.5
  );
  const likelyHeader = firstRow.length > 0 && (
    (rawRows.length < 2 && oneRowHeaderSignal)
      || (ratio(firstStringish, firstNonMissing.length) >= 0.5 && (
        ratio(secondNumeric, secondNonMissing.length) >= 0.5
        || ratio(firstHeaderNames.length, firstNonMissing.length) >= 0.5
      ))
  );
  const rawHeaders = firstRow.map((value) => String(value ?? ''));
  const headers = firstRow.map((value, index) => {
    const text = String(value ?? '');
    return text.trim() === '' ? `column_${index + 1}` : text;
  });
  const projectedHeaders = likelyHeader
    ? headers
    : firstRow.map((_, index) => `column_${index + 1}`);
  const dataRows = likelyHeader ? rawRows.slice(1) : rawRows;
  const sampledDataRows = dataRows.slice(0, limits.maxSampleRows);
  const maxSampleColumns = sampledDataRows.reduce((max, row) => Math.max(max, row.length), 0);

  const headerNames = new Map();
  const duplicateSignals = [];
  (likelyHeader ? headers : []).forEach((header, index) => {
    const normalized = header.trim().toLowerCase();
    if (!normalized) return;
    const previous = headerNames.get(normalized);
    if (previous !== undefined) {
      duplicateSignals.push(candidate(
        'duplicate_header_names',
        1,
        { columnIndexes: [previous, index], header },
        'the sampled header row contains the same normalized name more than once',
      ));
    } else {
      headerNames.set(normalized, index);
    }
  });

  const primitiveTypeCandidates = [];
  const primitiveTypeCandidatesByColumn = {};
  const primitiveTypeCandidatesByHeader = {};
  const missingSignals = [];
  for (let columnIndex = 0; columnIndex < width; columnIndex += 1) {
    const values = sampledDataRows.map((row) => row[columnIndex] ?? '');
    const missingCount = values.filter(isMissingValue).length;
    const nonMissingValues = values.filter((value) => !isMissingValue(value));
    const header = projectedHeaders[columnIndex] || `column_${columnIndex + 1}`;
    const typeCandidates = classifyPrimitiveCandidates(values);
    const typeEntry = {
      columnIndex,
      header,
      candidates: typeCandidates,
    };
    primitiveTypeCandidates.push(typeEntry);
    primitiveTypeCandidatesByColumn[String(columnIndex)] = typeCandidates;
    primitiveTypeCandidatesByHeader[header] = typeCandidates;
    missingSignals.push(candidate(
      'missing_values_present',
      ratio(missingCount, values.length),
      {
        columnIndex,
        header,
        sampledValues: values.length,
        missingValues: missingCount,
        nonMissingValues: nonMissingValues.length,
      },
      `missing-like tokens matched ${missingCount}/${values.length} sampled values`,
    ));

    const seen = new Map();
    let duplicateCount = 0;
    for (const value of nonMissingValues) {
      const key = String(value);
      if (seen.has(key)) duplicateCount += 1;
      else seen.set(key, true);
    }
    if (duplicateCount > 0) {
      duplicateSignals.push(candidate(
        'duplicate_values',
        ratio(duplicateCount, nonMissingValues.length),
        {
          columnIndex,
          header,
          sampledValues: nonMissingValues.length,
          duplicateValues: duplicateCount,
          uniqueValues: seen.size,
        },
        'exact duplicate values were observed in the sampled column',
      ));
    }
  }

  const totalCells = sampledDataRows.reduce((sum, row) => sum + row.length, 0);
  const numericCells = sampledDataRows.reduce(
    (sum, row) => sum + row.filter((value) => !isMissingValue(value) && finiteNumber(value)).length,
    0,
  );
  const firstColumnValues = sampledDataRows.map((row) => row[0]).filter((value) => !isMissingValue(value));
  const firstColumnUnique = new Set(firstColumnValues.map((value) => String(value))).size;
  const consistentRows = rawRows.filter((row) => row.length === width).length;
  const numericRatio = ratio(numericCells, totalCells);
  const numericValues = sampledDataRows.flatMap((row) => row.filter((value) => !isMissingValue(value) && finiteNumber(value)));
  const integerCells = numericValues.filter(integerValue).length;
  const integerRatio = ratio(integerCells, numericValues.length);
  const uniquenessRatio = ratio(firstColumnUnique, firstColumnValues.length);
  const normalizedHeaders = projectedHeaders.map((header) => String(header).trim().toLowerCase());
  const featureHeaderCount = normalizedHeaders.filter((header) => /(?:^|[_ .-])(gene|feature|transcript|ensembl|symbol|identifier|id)(?:$|[_ .-])/.test(header)).length;
  const sampleHeaderCount = normalizedHeaders.filter((header) => /(?:^|[_ .-])(sample|subject|patient|cell)(?:$|[_ .-])/.test(header)
    || /^s(?:ample)?[_ .-]?\d+$/i.test(header)
    || /^[a-z][a-z0-9.-]*[_-]\d+$/i.test(header)).length;
  const metadataHeaderCount = normalizedHeaders.filter((header) => /(?:^|[_ .-])(sample|subject|patient|group|condition|treatment|status|batch|pair|replicate)(?:$|[_ .-])/.test(header)).length;
  const featureHeaderRatio = ratio(featureHeaderCount, Math.max(width, 1));
  const sampleHeaderRatio = ratio(sampleHeaderCount, Math.max(width, 1));
  const metadataHeaderRatio = ratio(metadataHeaderCount, Math.max(width, 1));
  const rowWidthStability = ratio(consistentRows, rawRows.length);
  const rowToColumnRatio = ratio(dataRows.length, Math.max(width, 1));
  const matrixDimensionSignal = Math.min(1, rowToColumnRatio);
  const orientationCandidates = [
    candidate(
      'rows_are_records',
      ratio(consistentRows, rawRows.length),
      {
        sampledRows: rawRows.length,
        consistentWidthRows: consistentRows,
        observedColumnCount: width,
      },
      'candidate based on stable row width; this is a structural observation only',
    ),
    candidate(
      'rows_are_features_columns_samples',
      Math.min(1, numericRatio * 0.6 + uniquenessRatio * 0.25 + (rawRows.length >= width ? 0.15 : 0)),
      {
        sampledRows: dataRows.length,
        observedColumns: width,
        numericCellRatio: Number(numericRatio.toFixed(4)),
        firstColumnUniquenessRatio: Number(uniquenessRatio.toFixed(4)),
      },
      'candidate for a feature-by-sample matrix; no scientific meaning is asserted',
    ),
    candidate(
      'rows_are_samples_columns_features',
      Math.min(1, numericRatio * 0.6 + (width > dataRows.length ? 0.25 : 0) + (uniquenessRatio * 0.1)),
      {
        sampledRows: dataRows.length,
        observedColumns: width,
        numericCellRatio: Number(numericRatio.toFixed(4)),
        firstColumnUniquenessRatio: Number(uniquenessRatio.toFixed(4)),
      },
      'candidate for a sample-by-feature matrix; no scientific meaning is asserted',
    ),
  ].sort((left, right) => right.confidence - left.confidence);

  // These are file-shape hypotheses only.  The evidence intentionally stays
  // within the profiler's structural boundary: headers, numeric/integer
  // ratios, dimensions and stable row width.  No scientific profile is bound.
  const fileRoleEvidence = {
    headers: {
      observedColumns: width,
      featureHeaderCount,
      sampleHeaderCount,
      metadataHeaderCount,
    },
    sampledDataRows: dataRows.length,
    numericCellRatio: Number(numericRatio.toFixed(4)),
    integerCellRatioAmongNumeric: Number(integerRatio.toFixed(4)),
    rowToColumnRatio: Number(rowToColumnRatio.toFixed(4)),
    rowWidthStability: Number(rowWidthStability.toFixed(4)),
  };
  const fileRoleCandidates = [
    candidate(
      'counts_matrix',
      featureHeaderRatio * 0.3
        + numericRatio * 0.15
        + integerRatio * 0.35
        + sampleHeaderRatio * 0.1
        + rowWidthStability * 0.05
        + matrixDimensionSignal * 0.05,
      fileRoleEvidence,
      'candidate from feature/sample-like headers, numeric and integer ratios, matrix dimensions, and stable row width; scientific meaning is unresolved',
    ),
    candidate(
      'expression_matrix',
      featureHeaderRatio * 0.3
        + numericRatio * 0.35
        + (1 - integerRatio) * 0.25
        + rowWidthStability * 0.05
        + matrixDimensionSignal * 0.05,
      fileRoleEvidence,
      'candidate from feature-like headers, numeric values that are not exclusively integer-like, matrix dimensions, and stable row width; scale/normalization is unresolved',
    ),
    candidate(
      'sample_metadata',
      metadataHeaderRatio * 0.45
        + (1 - numericRatio) * 0.2
        + rowWidthStability * 0.15
        + matrixDimensionSignal * 0.2,
      fileRoleEvidence,
      'candidate from sample/condition-like headers, non-numeric value ratio, table dimensions, and stable row width; experimental design is unresolved',
    ),
  ].sort((left, right) => right.confidence - left.confidence);

  const firstHeader = String(projectedHeaders[0] || '').toLowerCase();
  const featureNameSignal = /gene|feature|transcript|ensembl|symbol|id/.test(firstHeader);
  const sampleNameSignal = /sample|subject|patient|cell/.test(firstHeader);
  const roleCandidates = [
    candidate(
      'feature_identifier_column',
      Math.min(1, uniquenessRatio * 0.55 + (featureNameSignal ? 0.4 : 0)),
      {
        firstColumnHeader: projectedHeaders[0] || null,
        firstColumnUniquenessRatio: Number(uniquenessRatio.toFixed(4)),
        namePatternMatched: featureNameSignal,
      },
      'candidate from first-column uniqueness and a header name pattern; identifier namespace is unresolved',
    ),
    candidate(
      'sample_identifier_column',
      Math.min(1, uniquenessRatio * 0.55 + (sampleNameSignal ? 0.4 : 0)),
      {
        firstColumnHeader: projectedHeaders[0] || null,
        firstColumnUniquenessRatio: Number(uniquenessRatio.toFixed(4)),
        namePatternMatched: sampleNameSignal,
      },
      'candidate from first-column uniqueness and a header name pattern; sample role is unresolved',
    ),
    candidate(
      'tabular_records',
      ratio(consistentRows, rawRows.length),
      { consistentWidthRows: consistentRows, sampledRows: rawRows.length, observedColumns: width },
      'candidate based on structural row/column regularity only',
    ),
  ].sort((left, right) => right.confidence - left.confidence);

  const sampleRows = rawRows.map((row) => row.slice());
  const observation = {
    profilerVersion: DATA_PROFILER_VERSION,
    version: DATA_PROFILER_VERSION,
    schemaVersion: 1,
    sample: {
      rows: sampleRows,
      dataRows: sampledDataRows.map((row) => row.slice()),
      rowCount: sampleRows.length,
      totalRowCount: machine.totalRows,
      dataRowCount: Math.max(0, machine.totalRows - (likelyHeader ? 1 : 0)),
      columnCount: width,
      bounds: {
        rows: { min: 0, max: limits.maxSampleRows, observed: sampleRows.length, truncated: machine.totalRows > limits.maxSampleRows },
        columns: { min: 0, max: limits.maxColumns, observed: maxSampleColumns, truncated: machine.maxColumns > limits.maxColumns },
      },
    },
    sampleRows,
    sampleRowCount: sampleRows.length,
    sampledRowCount: sampleRows.length,
    totalRowCount: machine.totalRows,
    sampleBounds: {
      rows: { min: 0, max: limits.maxSampleRows, observed: sampleRows.length, truncated: machine.totalRows > limits.maxSampleRows },
      columns: { min: 0, max: limits.maxColumns, observed: maxSampleColumns, truncated: machine.maxColumns > limits.maxColumns },
    },
    rowBounds: {
      min: machine.totalRows === 0 ? 0 : 1,
      max: machine.totalRows,
      observed: machine.totalRows,
      sampled: sampleRows.length,
    },
    columnBounds: {
      min: machine.minColumns || 0,
      max: machine.maxColumns,
      observed: width,
      sampled: maxSampleColumns,
    },
    headers: projectedHeaders,
    rawHeaders,
    headerCandidate: candidate(
      'header_present',
      likelyHeader ? (rawRows.length > 1 ? 0.85 : 0.55) : 0.25,
      {
        firstRowNonMissing: firstNonMissing.length,
        firstRowStringish: firstStringish,
        secondRowNumeric: secondNumeric,
        sampledRows: rawRows.length,
      },
      'candidate inferred from the first two sampled rows; it is not a semantic fact',
    ),
    primitiveTypeCandidates,
    primitiveTypes: primitiveTypeCandidates,
    primitiveTypeCandidatesByColumn,
    primitiveTypeCandidatesByHeader,
    missingSignals,
    missingnessSignals: missingSignals,
    duplicateSignals,
    duplicateValueSignals: duplicateSignals,
    orientationCandidates,
    orientation: orientationCandidates,
    fileRoleCandidates,
    roleCandidates,
    roles: roleCandidates,
    diagnostics: diagnostics.slice(),
  };
  return observation;
}

function validateInput(input) {
  const value = input && typeof input === 'object' ? input : {};
  const projectId = typeof value.projectId === 'string' ? value.projectId.trim() : '';
  const relativePath = typeof value.relativePath === 'string' ? value.relativePath.trim() : '';
  const absolutePath = typeof value.absolutePath === 'string' ? value.absolutePath : '';
  const errors = [];
  if (!projectId) errors.push('projectId is required');
  if (!relativePath || path.posix.isAbsolute(relativePath) || path.win32.isAbsolute(relativePath)
    || relativePath.split(/[\\/]/).includes('..')) {
    errors.push('relativePath must be a non-empty project-relative path');
  }
  if (!absolutePath || !path.isAbsolute(absolutePath)) errors.push('absolutePath must be an absolute path');
  return { value, projectId, relativePath, absolutePath, errors };
}

function baseSnapshot(projectId, relativePath, stat = null, fields = {}) {
  return {
    projectId: projectId || null,
    relativePath: relativePath || null,
    size: stat ? stat.size : null,
    mtime: stat ? stat.mtimeMs : null,
    mtimeIso: stat ? stat.mtime.toISOString() : null,
    modifiedAt: stat ? stat.mtimeMs : null,
    hash: null,
    sha256: null,
    version: SNAPSHOT_VERSION,
    schemaVersion: 1,
    encoding: 'unknown',
    delimiter: null,
    ...fields,
  };
}

function emptyObservation(diagnostics = []) {
  return {
    profilerVersion: DATA_PROFILER_VERSION,
    version: DATA_PROFILER_VERSION,
    schemaVersion: 1,
    sample: { rows: [], dataRows: [], rowCount: 0, totalRowCount: 0, dataRowCount: 0, columnCount: 0, bounds: {
      rows: { min: 0, max: 0, observed: 0, truncated: false },
      columns: { min: 0, max: 0, observed: 0, truncated: false },
    } },
    sampleRows: [],
    sampleRowCount: 0,
    sampledRowCount: 0,
    totalRowCount: 0,
    sampleBounds: { rows: { min: 0, max: 0, observed: 0, truncated: false }, columns: { min: 0, max: 0, observed: 0, truncated: false } },
    rowBounds: { min: 0, max: 0, observed: 0, sampled: 0 },
    columnBounds: { min: 0, max: 0, observed: 0, sampled: 0 },
    headers: [],
    headerCandidate: null,
    primitiveTypeCandidates: [],
    primitiveTypes: [],
    primitiveTypeCandidatesByColumn: {},
    primitiveTypeCandidatesByHeader: {},
    missingSignals: [],
    missingnessSignals: [],
    duplicateSignals: [],
    duplicateValueSignals: [],
    orientationCandidates: [],
    orientation: [],
    fileRoleCandidates: [],
    roleCandidates: [],
    roles: [],
    diagnostics: diagnostics.slice(),
  };
}

function resultForFailure(projectId, relativePath, diagnostics, stat = null, fields = {}) {
  const allDiagnostics = diagnostics.map((item) => ({ ...item }));
  const snapshot = baseSnapshot(projectId, relativePath, stat, fields);
  return {
    status: 'blocked',
    blocked: true,
    snapshot,
    observation: emptyObservation(allDiagnostics),
    diagnostics: allDiagnostics,
    diagnosticCodes: allDiagnostics.map((item) => item.code),
  };
}

async function profileData(input, runtimeOptions = undefined) {
  const request = input && typeof input === 'object' ? { ...input } : {};
  if (runtimeOptions && typeof runtimeOptions === 'object') {
    request.options = { ...(request.options || {}), ...runtimeOptions };
  }
  const validation = validateInput(request);
  const { projectId, relativePath, absolutePath } = validation;
  if (validation.errors.length > 0) {
    return resultForFailure(projectId, relativePath, [
      diagnostic('invalid_input', 'blocked', validation.errors.join('; '), { fields: validation.errors }),
    ]);
  }

  const extension = path.extname(relativePath).toLowerCase();
  let stat;
  try {
    stat = await fs.promises.stat(absolutePath);
  } catch (error) {
    const code = error && error.code === 'ENOENT' ? 'file_not_found'
      : error && (error.code === 'EACCES' || error.code === 'EPERM') ? 'permission_denied' : 'read_error';
    return resultForFailure(projectId, relativePath, [
      diagnostic(code, 'blocked', `Unable to inspect input file: ${error.message}`, { errno: error.code || null }),
    ]);
  }
  if (!stat.isFile()) {
    return resultForFailure(projectId, relativePath, [
      diagnostic('not_a_regular_file', 'blocked', 'absolutePath does not identify a regular file'),
    ], stat);
  }
  if (!SUPPORTED_EXTENSIONS.includes(extension)) {
    return resultForFailure(projectId, relativePath, [
      diagnostic('unsupported_file_type', 'blocked', `Only CSV, TSV and TXT inputs are supported: ${extension || '(no extension)'}`, {
        supportedExtensions: SUPPORTED_EXTENSIONS.slice(),
      }),
    ], stat);
  }

  const limits = normalizeLimits(request);
  const hash = crypto.createHash('sha256');
  const utf8 = new Utf8Validator();
  const probeParts = [];
  let probeLength = 0;
  let parser = null;
  let readBytes = 0;
  let streamError = null;
  let byteOffset = 0;
  let zeroByteCount = 0;
  const stream = fs.createReadStream(absolutePath, { highWaterMark: 64 * 1024 });
  const requestedDelimiter = request.options && request.options.delimiter
    ? request.options.delimiter : request.delimiter;

  function initializeParser(buffer) {
    const hasUtf8Bom = buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf;
    const delimiter = detectDelimiter(
      hasUtf8Bom ? buffer.subarray(3) : buffer,
      extension,
      requestedDelimiter,
    );
    parser = new DelimitedStateMachine(delimiter, limits);
    parser.consume(hasUtf8Bom ? buffer.subarray(3) : buffer);
    return hasUtf8Bom;
  }

  let hasUtf8Bom = false;
  try {
    for await (const chunk of stream) {
      hash.update(chunk);
      readBytes += chunk.length;
      for (let index = 0; index < chunk.length; index += 1) {
        if (chunk[index] === 0) zeroByteCount += 1;
      }
      for (let index = 0; index < chunk.length; index += 1) {
        utf8.feed(chunk[index], byteOffset);
        byteOffset += 1;
      }
      if (parser) {
        parser.consume(chunk);
        continue;
      }
      const remaining = limits.maxProbeBytes - probeLength;
      if (remaining > 0) {
        const part = chunk.subarray(0, remaining);
        probeParts.push(part);
        probeLength += part.length;
      }
      if (probeLength >= limits.maxProbeBytes) {
        hasUtf8Bom = initializeParser(Buffer.concat(probeParts, probeLength));
        const consumed = Math.min(chunk.length, remaining);
        if (chunk.length > consumed) parser.consume(chunk.subarray(consumed));
      }
    }
  } catch (error) {
    streamError = error;
  }

  const probe = Buffer.concat(probeParts, probeLength);
  if (!parser) hasUtf8Bom = initializeParser(probe);
  parser.finish();
  const digest = streamError ? null : hash.digest('hex');
  if (streamError) {
    const code = streamError.code === 'EACCES' || streamError.code === 'EPERM' ? 'permission_denied' : 'read_error';
    return resultForFailure(projectId, relativePath, [
      diagnostic(code, 'blocked', `Unable to read input file: ${streamError.message}`, { errno: streamError.code || null, bytesRead: readBytes }),
    ], stat, { hash: digest, sha256: digest });
  }

  const diagnostics = [];
  let encoding = 'utf-8';
  let bom = hasUtf8Bom;
  if (probe.length >= 2 && ((probe[0] === 0xff && probe[1] === 0xfe) || (probe[0] === 0xfe && probe[1] === 0xff))) {
    encoding = 'unsupported';
    diagnostics.push(diagnostic('unsupported_encoding', 'blocked', 'UTF-16 byte-order marks are not supported; expected UTF-8', {
      detectedBom: probe.subarray(0, 2).toString('hex'),
    }));
  } else if (!utf8.finish()) {
    encoding = 'unsupported';
    diagnostics.push(diagnostic('unsupported_encoding', 'blocked', 'Input is not valid UTF-8', {
      invalidByte: utf8.invalidByte,
    }));
  } else if (readBytes > 0 && zeroByteCount / readBytes > 0.05) {
    // UTF-16 without a BOM often survives byte-level UTF-8 validation because
    // NUL bytes are legal ASCII.  A high NUL ratio is therefore an encoding
    // candidate, never a semantic fact, and is blocked for safe handling.
    encoding = 'unsupported';
    diagnostics.push(diagnostic('unsupported_encoding', 'blocked', 'Input contains a high NUL-byte ratio consistent with an unsupported text encoding', {
      zeroByteCount,
      bytesRead: readBytes,
    }));
  }
  if (readBytes !== stat.size) {
    diagnostics.push(diagnostic('file_changed_during_read', 'blocked', 'File size changed while it was being profiled', {
      statSize: stat.size,
      bytesRead: readBytes,
    }));
  }
  if (readBytes === 0) diagnostics.push(diagnostic('empty_file', 'blocked', 'Input file is empty'));
  if (parser.totalRows === 0 && readBytes > 0) diagnostics.push(diagnostic('empty_dataset', 'blocked', 'No delimited rows were observed'));
  if (parser.issueCodes.has('too_wide')) diagnostics.push(diagnostic('too_wide', 'blocked', `A row exceeded the ${limits.maxColumns}-column bound`, {
    maxColumns: limits.maxColumns,
  }));
  if (parser.issueCodes.has('truncated_row')) diagnostics.push(diagnostic('truncated_row', 'blocked', `A row exceeded the ${limits.maxRowBytes}-byte bound`, {
    maxRowBytes: limits.maxRowBytes,
  }));
  if (parser.issueCodes.has('truncated_cell')) diagnostics.push(diagnostic('truncated_cell', 'blocked', `A cell exceeded the ${limits.maxCellBytes}-byte bound`, {
    maxCellBytes: limits.maxCellBytes,
  }));
  if (parser.issueCodes.has('unterminated_quoted_field')) diagnostics.push(diagnostic('unterminated_quoted_field', 'blocked', 'A quoted field was not closed before end of file'));
  if (parser.issueCodes.has('quote_in_unquoted_field')) diagnostics.push(diagnostic('quote_in_unquoted_field', 'blocked', 'A quote appeared inside an unquoted field'));
  if (parser.issueCodes.has('characters_after_closing_quote')) diagnostics.push(diagnostic('characters_after_closing_quote', 'blocked', 'Unexpected characters followed a closing quote'));
  if (parser.totalRows === 1 && parser.rows[0] && parser.rows[0].every((value) => isMissingValue(value))) {
    diagnostics.push(diagnostic('empty_dataset', 'blocked', 'Only an empty row was observed'));
  }
  if (parser.totalRows > limits.maxSampleRows) {
    diagnostics.push(diagnostic('sample_truncated', 'warning', `Only the first ${limits.maxSampleRows} rows were retained`, {
      totalRows: parser.totalRows,
      sampledRows: parser.rows.length,
    }));
  }
  if (parser.maxColumns > limits.maxColumns) {
    // Keep the diagnostic generated above as the authoritative blocked signal.
    if (!diagnostics.some((item) => item.code === 'too_wide')) diagnostics.push(diagnostic('too_wide', 'blocked', 'Observed columns exceeded the configured bound'));
  }
  if (parser.malformed && !diagnostics.some((item) => item.code === 'malformed_csv')) {
    diagnostics.push(diagnostic('malformed_csv', 'blocked', 'CSV/TSV quoting rules were not satisfied'));
  }
  if (parser.totalRows > 0 && parser.maxColumns === 1 && parser.delimiter === null) {
    diagnostics.push(diagnostic('delimiter_not_detected', 'warning', 'No supported delimiter was observed; treating each line as one field'));
  }

  const delimiter = parser.delimiter;
  const observation = buildObservation(parser, limits, delimiter, diagnostics);
  if (parser.totalRows > 0 && observation.sample.dataRowCount === 0
    && observation.headerCandidate && observation.headerCandidate.confidence >= 0.5) {
    const noDataRows = diagnostic('no_data_rows', 'blocked', 'A header-like row was observed but no data rows were available', {
      headerColumns: observation.headers.length,
    });
    diagnostics.push(noDataRows);
    observation.diagnostics.push(noDataRows);
  }
  const snapshot = baseSnapshot(projectId, relativePath, stat, {
    hash: digest,
    sha256: digest,
    encoding,
    bom,
    encodingDetails: {
      candidate: encoding,
      confidence: encoding === 'utf-8' ? 1 : 0,
      evidence: { utf8Validator: encoding === 'utf-8', bom },
      basis: encoding === 'utf-8' ? 'complete stream passed the UTF-8 validator' : 'stream failed the supported UTF-8 checks',
      bom,
    },
    delimiter,
    delimiterDetails: {
      candidate: delimiter,
      confidence: delimiter === null ? 0 : 1,
      evidence: { extension, sampledBytes: probe.length, quoteAware: true },
      basis: delimiter === null ? 'no supported delimiter observed in the bounded probe' : 'quote-aware delimiter observation in the bounded probe',
    },
  });
  const blocked = diagnostics.some(isBlockingDiagnostic);
  return {
    status: blocked ? 'blocked' : 'ok',
    blocked,
    snapshot,
    observation,
    diagnostics,
    diagnosticCodes: diagnostics.map((item) => item.code),
  };
}

module.exports = {
  DATA_PROFILER_VERSION,
  SNAPSHOT_VERSION,
  SUPPORTED_EXTENSIONS,
  DEFAULT_LIMITS,
  profileData,
  profileDataFile: profileData,
  profileDataSnapshot: profileData,
  createDataProfile: profileData,
};
