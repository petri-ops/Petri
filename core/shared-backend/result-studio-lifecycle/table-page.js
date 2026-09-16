'use strict';

// BLOCK-92 Wave C-7 — 候选表渐进分页读取簇外迁（原 lifecycle 1328-1679 行，
// 纯搬运零行为变化）：delimited 记录扫描/解码 + readTablePage。

const fs = require('fs');
const {
  RESULT_STUDIO_LIFECYCLE_VERSION,
  MAX_TABLE_PAGE_ROWS,
  MAX_TABLE_PAGE_BYTES,
  ResultStudioLifecycleError,
  hashFileDescriptor,
} = require('./internal');

function detectDelimiter(header, filePath) {
  if (/\.tsv$/i.test(filePath)) return '\t';
  let quoted = false;
  let atFieldStart = true;
  let commaCount = 0;
  let tabCount = 0;
  for (let index = 0; index < header.length; index += 1) {
    const char = header[index];
    if (quoted) {
      if (char !== '"') continue;
      if (header[index + 1] === '"') { index += 1; continue; }
      quoted = false;
      continue;
    }
    if (char === '"' && atFieldStart) {
      quoted = true;
      atFieldStart = false;
      continue;
    }
    if (char === ',' || char === '\t') {
      if (char === ',') commaCount += 1;
      else tabCount += 1;
      atFieldStart = true;
      continue;
    }
    atFieldStart = false;
  }
  return tabCount > commaCount ? '\t' : ',';
}

function splitDelimitedLine(line, delimiter, errorPrefix = 'table_record') {
  const cells = [];
  let current = '';
  let quoted = false;
  let closedQuote = false;
  let atFieldStart = true;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char !== '"') { current += char; continue; }
      if (line[index + 1] === '"') { current += '"'; index += 1; continue; }
      quoted = false;
      closedQuote = true;
      continue;
    }
    if (closedQuote) {
      if (char === delimiter) {
        cells.push(current);
        current = '';
        closedQuote = false;
        atFieldStart = true;
        continue;
      }
      throw new ResultStudioLifecycleError(
        `${errorPrefix}_invalid_quoted_field`,
        'A closing quote must be followed by a delimiter or the end of the record.',
      );
    }
    if (char === delimiter) {
      cells.push(current);
      current = '';
      atFieldStart = true;
      continue;
    }
    if (char === '"') {
      if (!atFieldStart) {
        throw new ResultStudioLifecycleError(
          `${errorPrefix}_invalid_quote`,
          'A quote in an unquoted field is not valid RFC4180 data.',
        );
      }
      quoted = true;
      atFieldStart = false;
      continue;
    }
    if (char === '\r' || char === '\n') {
      throw new ResultStudioLifecycleError(
        `${errorPrefix}_invalid_line_ending`,
        'Record separators are only valid inside quoted fields or between records.',
      );
    }
    current += char;
    atFieldStart = false;
  }
  if (quoted) {
    throw new ResultStudioLifecycleError(
      `${errorPrefix}_incomplete_quoted_record`,
      'The delimited record ended before its quoted field was closed.',
    );
  }
  cells.push(current);
  return cells;
}

const TABLE_READ_CHUNK_BYTES = 64 * 1024;
const MAX_TABLE_HEADER_BYTES = 256 * 1024;
const MAX_TABLE_RECORD_BYTES = MAX_TABLE_PAGE_BYTES;

function scanDelimitedRecord(buffer, delimiter = null) {
  let quoted = false;
  let atFieldStart = true;
  const isDelimiter = (byte) => byte === 0x2c || byte === 0x09;
  const selectedDelimiter = delimiter === '\t' ? 0x09 : delimiter === ',' ? 0x2c : null;
  for (let index = 0; index < buffer.length; index += 1) {
    const byte = buffer[index];
    if (quoted) {
      if (byte !== 0x22) continue;
      if (buffer[index + 1] === 0x22) { index += 1; continue; }
      quoted = false;
      continue;
    }
    if (byte === 0x22 && atFieldStart) {
      quoted = true;
      atFieldStart = false;
      continue;
    }
    const delimiterMatch = selectedDelimiter === null ? isDelimiter(byte) : byte === selectedDelimiter;
    if (delimiterMatch) {
      atFieldStart = true;
      continue;
    }
    if (byte === 0x0a) {
      const contentEnd = index > 0 && buffer[index - 1] === 0x0d ? index - 1 : index;
      return { complete: true, contentEnd, consumedBytes: index + 1, quoted: false };
    }
    atFieldStart = false;
  }
  return { complete: false, contentEnd: buffer.length, consumedBytes: buffer.length, quoted };
}

function readDelimitedRecord(handle, {
  startOffset,
  fileSize,
  maxBytes,
  delimiter = null,
  errorPrefix,
  io = fs,
}) {
  if (startOffset >= fileSize) return null;
  let raw = Buffer.alloc(0);
  while (raw.length < maxBytes + 2 && startOffset + raw.length < fileSize) {
    const remaining = Math.min(
      TABLE_READ_CHUNK_BYTES,
      maxBytes + 2 - raw.length,
      fileSize - startOffset - raw.length,
    );
    const chunk = Buffer.alloc(remaining);
    const bytesRead = io.readSync(handle, chunk, 0, remaining, startOffset + raw.length);
    if (bytesRead <= 0) break;
    raw = Buffer.concat([raw, chunk.subarray(0, bytesRead)]);
    const scanned = scanDelimitedRecord(raw, delimiter);
    if (scanned.complete) {
      if (scanned.contentEnd > maxBytes) {
        throw new ResultStudioLifecycleError(
          `${errorPrefix}_too_large`,
          `The delimited ${errorPrefix === 'table_header' ? 'header' : 'record'} exceeds its bounded byte budget.`,
        );
      }
      return {
        buffer: raw.subarray(0, scanned.contentEnd),
        nextOffset: startOffset + scanned.consumedBytes,
      };
    }
  }
  const scanned = scanDelimitedRecord(raw, delimiter);
  if (raw.length > maxBytes) {
    throw new ResultStudioLifecycleError(
      `${errorPrefix}_too_large`,
      `The delimited ${errorPrefix === 'table_header' ? 'header' : 'record'} exceeds its bounded byte budget.`,
    );
  }
  if (scanned.quoted) {
    throw new ResultStudioLifecycleError(
      `${errorPrefix}_incomplete_quoted_record`,
      'The delimited record ended before its quoted field was closed.',
    );
  }
  return { buffer: raw, nextOffset: startOffset + raw.length };
}

function decodeDelimitedRecord(buffer, errorPrefix) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw new ResultStudioLifecycleError(
      `${errorPrefix}_invalid_utf8`,
      'The delimited record is not valid UTF-8.',
    );
  }
}

function descriptorIdentity(stat) {
  return {
    dev: stat.dev,
    ino: stat.ino,
    size: stat.size,
    mtimeNs: stat.mtimeNs,
    ctimeNs: stat.ctimeNs,
  };
}

function sameDescriptorIdentity(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function artifactTruthDrift() {
  return new ResultStudioLifecycleError(
    'artifact_truth_drift',
    'The table bytes changed or no longer match Revision Artifact Truth.',
  );
}

function readTablePage({
  filePath,
  expectedSha256 = null,
  cursor = 0,
  limit = 100,
  io = fs,
} = {}) {
  const boundedLimit = Number.isInteger(limit) && limit > 0 && limit <= MAX_TABLE_PAGE_ROWS ? limit : 100;
  if (!Number.isInteger(cursor) || cursor < 0) {
    throw new ResultStudioLifecycleError('table_cursor_invalid', 'The table cursor must be a non-negative byte offset.');
  }
  const expected = expectedSha256 === null
    ? null
    : String(expectedSha256 || '').trim().toLowerCase();
  if (expected !== null && !/^[a-f0-9]{64}$/.test(expected)) {
    throw new ResultStudioLifecycleError(
      'artifact_truth_unavailable',
      'The table has no trusted SHA-256 in Revision Artifact Truth.',
    );
  }
  const boundedCursor = cursor;
  const noFollow = Number.isInteger(io.constants?.O_NOFOLLOW) ? io.constants.O_NOFOLLOW : 0;
  const handle = io.openSync(filePath, io.constants.O_RDONLY | noFollow);
  try {
    const initialStat = io.fstatSync(handle, { bigint: true });
    if (!initialStat.isFile()) {
      throw new ResultStudioLifecycleError('table_file_invalid', 'The table Artifact is not a regular file.');
    }
    const fileSize = Number(initialStat.size);
    if (!Number.isSafeInteger(fileSize) || fileSize < 0) {
      throw new ResultStudioLifecycleError('table_file_too_large', 'The table size exceeds the supported byte range.');
    }
    if (boundedCursor > fileSize) {
      throw new ResultStudioLifecycleError('table_cursor_invalid', 'The table cursor is beyond the end of the file.');
    }
    const initialIdentity = descriptorIdentity(initialStat);
    const initialSha256 = hashFileDescriptor(handle, io);
    if (expected !== null && initialSha256 !== expected) throw artifactTruthDrift();

    let page = null;
    let readFailure = null;
    try {
      const headerRecord = readDelimitedRecord(handle, {
        startOffset: 0,
        fileSize,
        maxBytes: MAX_TABLE_HEADER_BYTES,
        errorPrefix: 'table_header',
        io,
      });
      if (!headerRecord) {
        throw new ResultStudioLifecycleError('table_header_missing', 'The table does not contain a header record.');
      }
      const header = decodeDelimitedRecord(headerRecord.buffer, 'table_header');
      const delimiter = detectDelimiter(header, filePath);
      const columns = splitDelimitedLine(header, delimiter, 'table_header');
      const bodyStart = headerRecord.nextOffset;
      if (boundedCursor !== 0 && boundedCursor < bodyStart) {
        throw new ResultStudioLifecycleError('table_cursor_invalid', 'The table cursor points inside the header record.');
      }
      if (boundedCursor !== 0 && boundedCursor < fileSize) {
        const previousByte = Buffer.alloc(1);
        io.readSync(handle, previousByte, 0, 1, boundedCursor - 1);
        if (previousByte[0] !== 0x0a) {
          throw new ResultStudioLifecycleError('table_cursor_invalid', 'The table cursor is not positioned at a complete record boundary.');
        }
      }
      const rows = [];
      let recordCursor = boundedCursor === 0 ? bodyStart : boundedCursor;
      let nextCursor = null;
      while (rows.length < boundedLimit && recordCursor < fileSize) {
        const recordStart = recordCursor;
        const record = readDelimitedRecord(handle, {
          startOffset: recordStart,
          fileSize,
          maxBytes: MAX_TABLE_RECORD_BYTES,
          delimiter,
          errorPrefix: 'table_record',
          io,
        });
        if (!record) break;
        const parsed = splitDelimitedLine(
          decodeDelimitedRecord(record.buffer, 'table_record'),
          delimiter,
          'table_record',
        );
        const candidateRows = [...rows, parsed];
        const candidateBytes = Buffer.byteLength(JSON.stringify({ columns, rows: candidateRows }));
        if (candidateBytes > MAX_TABLE_PAGE_BYTES) {
          if (rows.length === 0) {
            throw new ResultStudioLifecycleError('table_page_too_large', 'A single table record exceeds the bounded response budget.');
          }
          nextCursor = recordStart;
          break;
        }
        rows.push(parsed);
        recordCursor = record.nextOffset;
        nextCursor = recordCursor < fileSize ? recordCursor : null;
      }
      page = {
        tablePageVersion: 1,
        columns,
        rows,
        cursor: boundedCursor,
        nextCursor,
        limit: boundedLimit,
        totalRows: null,
        totalRowsIsUnknown: true,
        virtualized: nextCursor !== null,
        caveat: 'RFC4180 records are parsed within bounded header, record, and response byte budgets; total row count remains unknown until the final page.',
      };
    } catch (error) {
      readFailure = error;
    }

    let integrityFailure = null;
    try {
      const finalStat = io.fstatSync(handle, { bigint: true });
      const finalSha256 = hashFileDescriptor(handle, io);
      if (!sameDescriptorIdentity(initialIdentity, descriptorIdentity(finalStat))
          || finalSha256 !== initialSha256
          || (expected !== null && finalSha256 !== expected)) {
        integrityFailure = artifactTruthDrift();
      }
    } catch (error) {
      integrityFailure = error instanceof ResultStudioLifecycleError
        ? error
        : artifactTruthDrift();
    }
    if (integrityFailure) throw integrityFailure;
    if (readFailure) throw readFailure;
    return page;
  } finally {
    io.closeSync(handle);
  }
}


module.exports = {
  detectDelimiter,
  splitDelimitedLine,
  scanDelimitedRecord,
  readDelimitedRecord,
  decodeDelimitedRecord,
  descriptorIdentity,
  sameDescriptorIdentity,
  readTablePage,
};
