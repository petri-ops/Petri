import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  DATA_PROFILER_VERSION,
  profileData,
} = require('../core/shared-backend/data-profiler.js');

let root;

before(() => {
  root = mkdtempSync(join(tmpdir(), 'biof3-sdc1-profiler-'));
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

function input(relativePath, content, options) {
  const absolutePath = join(root, relativePath);
  writeFileSync(absolutePath, content);
  return profileData({ projectId: 'project_sdc1', relativePath, absolutePath, options });
}

test('profiles UTF-8 BOM CSV and keeps quoted delimiters inside one field', async () => {
  const result = await input('quoted.csv', '\uFEFFgene,value\nG1,"alpha,beta"\nG2,2\n');
  assert.equal(result.status, 'ok');
  assert.equal(result.snapshot.encoding, 'utf-8');
  assert.equal(result.snapshot.bom, true);
  assert.equal(result.snapshot.delimiter, ',');
  assert.deepEqual(result.observation.headers, ['gene', 'value']);
  assert.deepEqual(result.observation.sampleRows[1], ['G1', 'alpha,beta']);
  assert.equal(result.observation.profilerVersion, DATA_PROFILER_VERSION);
  assert.ok(result.observation.primitiveTypeCandidates[1].candidates.some((item) => item.candidate === 'number'));
  assert.ok(result.observation.orientationCandidates.every((item) => 'candidate' in item && 'confidence' in item && 'evidence' in item));
});

test('detects tab-separated TXT input and emits missing/duplicate signals as candidates', async () => {
  const result = await input('metadata.txt', 'sample\tgroup\nS1\tcontrol\nS2\tNA\nS2\tcase\n');
  assert.equal(result.status, 'ok');
  assert.equal(result.snapshot.delimiter, '\t');
  assert.deepEqual(result.observation.headers, ['sample', 'group']);
  assert.ok(result.observation.missingSignals[1].confidence > 0);
  assert.ok(result.observation.duplicateSignals.some((item) => item.candidate === 'duplicate_values'));
  assert.ok(result.observation.roleCandidates.every((item) => item.basis && item.evidence));
});

test('ranks structural counts-matrix file-role candidates without asserting scientific meaning', async () => {
  const result = await input('counts.csv', 'gene,S1,S2\nGeneA,10,12\nGeneB,0,8\nGeneC,4,5\n');
  assert.equal(result.status, 'ok');
  const candidates = result.observation.fileRoleCandidates;
  assert.equal(candidates[0].candidate, 'counts_matrix');
  assert.ok(candidates[0].confidence >= 0.7);
  assert.deepEqual(candidates.map((item) => item.candidate).sort(), [
    'counts_matrix', 'expression_matrix', 'sample_metadata',
  ]);
  for (const item of candidates) {
    assert.ok(item.confidence >= 0);
    assert.ok(item.evidence);
    assert.ok(item.basis);
    assert.equal(Object.keys(item).filter((key) => key === 'evidence').length, 1);
  }
});

test('recognizes common condition and replicate suffixes as sample-like matrix headers', async () => {
  const absolutePath = fileURLToPath(new URL(
    '../resources/built-in-plugins/deseq2/demo-data/demo-counts.csv',
    import.meta.url,
  ));
  const result = await profileData({
    projectId: 'project_sdc1',
    relativePath: 'data/counts.csv',
    absolutePath,
  });
  const counts = result.observation.fileRoleCandidates
    .find((item) => item.candidate === 'counts_matrix');
  assert.equal(result.status, 'ok');
  assert.ok(counts);
  assert.ok(counts.confidence >= 0.7);
  assert.equal(counts.evidence.headers.sampleHeaderCount, 4);
});

test('ranks structural sample metadata candidate for categorical metadata TSV', async () => {
  const result = await input('metadata.tsv', 'sample\tgroup\tbatch\nS1\tcontrol\tB1\nS2\tcase\tB2\nS3\tcontrol\tB1\n');
  assert.equal(result.status, 'ok');
  assert.equal(result.snapshot.delimiter, '\t');
  assert.equal(result.observation.fileRoleCandidates[0].candidate, 'sample_metadata');
  assert.ok(result.observation.fileRoleCandidates[0].confidence >= 0.7);
});

test('profiles SDC1-A counts and metadata fixtures with one actionable role and full hash', async () => {
  const fixtures = [
    { name: 'counts.csv', role: 'counts_matrix', dataRows: 4 },
    { name: 'metadata.csv', role: 'sample_metadata', dataRows: 4 },
  ];
  for (const fixture of fixtures) {
    const absolutePath = fileURLToPath(new URL(`./fixtures/sdc1-a/${fixture.name}`, import.meta.url));
    const bytes = readFileSync(absolutePath);
    const expectedHash = createHash('sha256').update(bytes).digest('hex');
    const result = await profileData({
      projectId: 'project_sdc1_a',
      relativePath: `fixtures/sdc1-a/${fixture.name}`,
      absolutePath,
    });
    assert.equal(result.status, 'ok');
    assert.equal(result.snapshot.hash, expectedHash);
    assert.equal(result.snapshot.sha256, expectedHash);
    assert.equal(result.snapshot.hash.length, 64);
    assert.equal(result.observation.sample.dataRowCount, fixture.dataRows);
    assert.equal(result.observation.sample.dataRows.length, fixture.dataRows);
    const actionable = result.observation.fileRoleCandidates.filter((item) => item.confidence >= 0.6);
    assert.deepEqual(actionable.map((item) => item.candidate), [fixture.role]);
    assert.equal(result.observation.fileRoleCandidates.filter((item) => item.candidate === fixture.role).length, 1);
  }
});

test('header-only files are blocked with an honest no-data-rows diagnostic', async () => {
  const result = await input('header-only.csv', 'gene,S1,S2\n');
  assert.equal(result.status, 'blocked');
  assert.ok(result.diagnosticCodes.includes('no_data_rows'));
  assert.equal(result.observation.sample.dataRowCount, 0);
  assert.ok(result.observation.fileRoleCandidates.length >= 3);
});

test('empty files are blocked with structured diagnostics', async () => {
  const result = await input('empty.csv', '');
  assert.equal(result.status, 'blocked');
  assert.equal(result.blocked, true);
  assert.ok(result.diagnosticCodes.includes('empty_file'));
  assert.equal(result.snapshot.hash.length, 64);
  assert.equal(result.observation.headers.length, 0);
});

test('too-wide rows are blocked without retaining all columns', async () => {
  const result = await input('wide.csv', 'a,b,c,d,e\n1,2,3,4,5\n', { maxColumns: 3 });
  assert.equal(result.status, 'blocked');
  assert.ok(result.diagnosticCodes.includes('too_wide'));
  assert.ok(result.observation.sampleRows[0].length <= 3);
  assert.equal(result.observation.sampleBounds.columns.truncated, true);
});

test('truncated rows and malformed quoting are blocked structurally', async () => {
  const result = await input('truncated.csv', 'a,b\n"unterminated,value\n', { maxRowBytes: 8 });
  assert.equal(result.status, 'blocked');
  assert.ok(result.diagnosticCodes.includes('truncated_row'));
  assert.ok(result.diagnosticCodes.includes('unterminated_quoted_field'));
  assert.ok(result.diagnostics.every((item) => item.code && item.severity));
});

test('unsupported UTF-8 is blocked after the complete stream is hashed', async () => {
  const result = await input('bad.csv', Buffer.from([0x67, 0x65, 0x6e, 0x65, 0x0a, 0xff]));
  assert.equal(result.status, 'blocked');
  assert.ok(result.diagnosticCodes.includes('unsupported_encoding'));
  assert.equal(result.snapshot.encoding, 'unsupported');
  assert.equal(result.snapshot.hash.length, 64);
});

test('hash changes when the source file changes', async () => {
  const relativePath = 'changing.tsv';
  const absolutePath = join(root, relativePath);
  writeFileSync(absolutePath, 'id\tvalue\nA\t1\n');
  const first = await profileData({ projectId: 'project_sdc1', relativePath, absolutePath });
  writeFileSync(absolutePath, 'id\tvalue\nA\t2\n');
  const second = await profileData({ projectId: 'project_sdc1', relativePath, absolutePath });
  assert.notEqual(first.snapshot.hash, second.snapshot.hash);
  assert.notEqual(first.snapshot.sha256, second.snapshot.sha256);
});
