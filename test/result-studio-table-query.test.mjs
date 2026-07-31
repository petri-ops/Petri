import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  clearResultTableCache,
  queryResultTable,
} = require('../core/shared-backend/result-studio-table-query');

function tableFile(context, rows = 100) {
  const root = join(tmpdir(), `biof3-rs-p2-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(root, { recursive: true });
  context.after(() => import('node:fs').then(({ rmSync }) => rmSync(root, { recursive: true, force: true })));
  const file = join(root, 'deg.csv');
  const body = ['gene,log2FoldChange,padj,class'];
  for (let index = 0; index < rows; index += 1) {
    body.push(`G${String(index).padStart(6, '0')},${(index % 9) - 4},${(index % 100) / 100},${index % 2 ? 'Up' : 'Down'}`);
  }
  writeFileSync(file, `${body.join('\n')}\n`);
  return file;
}

test('RS-P2 table query filters and sorts the complete table while returning one bounded page', (context) => {
  const filePath = tableFile(context, 1000);
  const result = queryResultTable({
    filePath,
    idField: 'gene',
    filterExpression: { logic: 'and', clauses: [{ field: 'padj', op: 'lt', value: 0.05 }] },
    sort: [{ field: 'log2FoldChange', direction: 'desc' }],
    offset: 0,
    limit: 20,
  });
  assert.equal(result.totalRows, 1000);
  assert.equal(result.matchedCount, 50);
  assert.equal(result.rows.length, 20);
  assert.equal(result.virtualized, true);
  assert.match(result.filterHash, /^[a-f0-9]{64}$/);
  assert.match(result.selectionEvidence.entityIdsHash, /^[a-f0-9]{64}$/);
  assert.equal(result.selectionEvidence.entityIdCount, 50);
  assert.equal(result.rows[0].log2FoldChange, '4');
});

test('RS-P2 100k-row query keeps the renderer payload bounded and authoritative', (context) => {
  const filePath = tableFile(context, 100_000);
  const result = queryResultTable({ filePath, idField: 'gene', offset: 50_000, limit: 80 });
  assert.equal(result.totalRows, 100_000);
  assert.equal(result.matchedCount, 100_000);
  assert.equal(result.rows.length, 80);
  assert.equal(result.nextOffset, 50_080);
  assert.equal(result.selectionEvidence.entityIdCount, 100_000);
  assert.equal(JSON.stringify(result).length < 50_000, true);
});

test('RS-P2 normalizes R row-name columns without pretending row numbers are identities', (context) => {
  const root = join(tmpdir(), `biof3-rs-p2-row-${process.pid}-${Date.now()}`);
  mkdirSync(root, { recursive: true });
  context.after(() => import('node:fs').then(({ rmSync }) => rmSync(root, { recursive: true, force: true })));
  const filePath = join(root, 'matrix.csv');
  writeFileSync(filePath, ',S1,S2\nG1,1,2\nG2,3,4\n');
  const result = queryResultTable({ filePath, idField: 'row_id' });
  assert.deepEqual(result.columns.map((column) => column.field), ['row_id', 'S1', 'S2']);
  assert.deepEqual(result.selectionEvidence.sampleEntityIds, ['G1', 'G2']);
});

test('RS-P2 rejects unknown fields instead of silently returning a misleading selection', (context) => {
  const filePath = tableFile(context, 10);
  assert.throws(() => queryResultTable({
    filePath,
    filterExpression: { logic: 'and', clauses: [{ field: 'missing', op: 'eq', value: 'x' }] },
  }), (error) => error.code === 'filter_field_unknown');
});

test('P6 parsed-table cache invalidates when immutable Artifact bytes change', (context) => {
  clearResultTableCache();
  const filePath = tableFile(context, 20);
  const before = queryResultTable({
    filePath,
    idField: 'gene',
    filterExpression: { logic: 'and', clauses: [{ field: 'gene', op: 'contains', value: 'G000001' }] },
  });
  assert.equal(before.matchedCount, 1);
  const original = readFileSync(filePath, 'utf8');
  writeFileSync(filePath, original.replace('G000001', 'X000001'));
  const after = queryResultTable({
    filePath,
    idField: 'gene',
    filterExpression: { logic: 'and', clauses: [{ field: 'gene', op: 'contains', value: 'G000001' }] },
  });
  assert.equal(after.matchedCount, 0);
  assert.notEqual(after.filterHash, before.filterHash);
});

test('P6 table query binds the bytes it parsed to the expected Artifact Truth hash', (context) => {
  clearResultTableCache();
  const filePath = tableFile(context, 20);
  const expectedSha256 = createHash('sha256').update(readFileSync(filePath)).digest('hex');
  assert.equal(queryResultTable({ filePath, expectedSha256 }).totalRows, 20);

  writeFileSync(filePath, readFileSync(filePath, 'utf8').replace('G000001', 'X000001'));
  assert.throws(
    () => queryResultTable({ filePath, expectedSha256 }),
    (error) => error.code === 'artifact_truth_drift',
  );
  assert.throws(
    () => queryResultTable({ filePath, expectedSha256: 'not-a-sha' }),
    (error) => error.code === 'artifact_truth_unavailable',
  );
});
