import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Windows 纪律：ESM 动态 import 不能吃绝对路径（ERR_UNSUPPORTED_ESM_URL_SCHEME），
// 必须转 file:// URL（TEST-INFRA-DEBT 轻量包，与 agent-runner 系测试同修）。
const profiler = await import(pathToFileURL(resolve(process.cwd(), 'core/shared-backend/data-profiler.js')).href);
const { profileData } = profiler.default || profiler;
const FIXTURES = resolve(process.cwd(), 'test/fixtures/sdc');

async function profileFixture(name, mimeType) {
  const absolutePath = resolve(FIXTURES, name);
  const buffer = await readFile(absolutePath);
  const info = await stat(absolutePath);
  return profileData({
    projectId: 'sdc-test',
    relativePath: name,
    absolutePath,
    mimeType,
    size: info.size,
    mtime: info.mtimeMs,
  });
}

function firstRole(profile, role) {
  return profile.observation.fileRoleCandidates.find((c) => c.candidate === role);
}

function bestTypeForHeader(profile, header) {
  const col = profile.observation.primitiveTypes.find((c) => c.header === header);
  if (!col) return null;
  return col.candidates.slice().sort((a, b) => b.confidence - a.confidence)[0]?.candidate;
}

test('SDC-1.A counts_matrix.csv: wide counts matrix profile', async () => {
  const profile = await profileFixture('counts_matrix.csv', 'text/csv');
  assert.equal(profile.status, 'ok');
  assert.equal(profile.blocked, false);
  assert.equal(profile.snapshot.encoding, 'utf-8');
  assert.equal(profile.snapshot.delimiter, ',');
  assert.ok(profile.observation.headers.includes('sample_A'));
  const counts = firstRole(profile, 'counts_matrix');
  assert.ok(counts, `expected counts_matrix role, got ${JSON.stringify(profile.observation.fileRoleCandidates.map(c => c.candidate))}`);
  assert.ok(counts.confidence >= 0.70, `counts confidence ${counts.confidence}`);
});

test('SDC-1.B sample_metadata.tsv: long sample metadata profile', async () => {
  const profile = await profileFixture('sample_metadata.tsv', 'text/tab-separated-values');
  assert.equal(profile.status, 'ok');
  assert.equal(profile.snapshot.delimiter, '\t');
  assert.ok(profile.observation.headers.includes('sample_id'));
  const meta = firstRole(profile, 'sample_metadata');
  assert.ok(meta, `expected sample_metadata role, got ${JSON.stringify(profile.observation.fileRoleCandidates.map(c => c.candidate))}`);
  assert.ok(meta.confidence >= 0.70, `metadata confidence ${meta.confidence}`);
});

test('SDC-1.C expression_matrix.tsv: tsv with expression_matrix role', async () => {
  const profile = await profileFixture('expression_matrix.tsv', 'text/tab-separated-values');
  assert.equal(profile.status, 'ok');
  const expr = firstRole(profile, 'expression_matrix');
  assert.ok(expr, `expected expression_matrix role, got ${JSON.stringify(profile.observation.fileRoleCandidates.map(c => c.candidate))}`);
});

test('SDC-1.D counts_matrix.csv: delimiter detected as comma', async () => {
  const profile = await profileFixture('counts_matrix.csv', 'text/csv');
  assert.equal(profile.status, 'ok');
  assert.equal(profile.snapshot.delimiter, ',');
  assert.ok(profile.observation.headers.includes('gene'));
});

test('SDC-1.E expression_matrix.tsv: delimiter detected as tab', async () => {
  const profile = await profileFixture('expression_matrix.tsv', 'text/tab-separated-values');
  assert.equal(profile.status, 'ok');
  assert.equal(profile.snapshot.delimiter, '\t');
});

test('SDC-1.F latin1_encoded.csv: blocked due to unsupported encoding', async () => {
  const profile = await profileFixture('latin1_encoded.csv', 'text/csv');
  assert.equal(profile.status, 'blocked');
  assert.equal(profile.blocked, true);
  assert.ok(profile.diagnosticCodes.includes('unsupported_encoding'), `codes: ${profile.diagnosticCodes.join(',')}`);
});

test('SDC-1.G ambiguous_delimiter.csv: multiple file role candidates -> ambiguous role situation', async () => {
  const profile = await profileFixture('ambiguous_delimiter.csv', 'text/csv');
  assert.equal(profile.status, 'ok');
  assert.ok(profile.observation.fileRoleCandidates.length >= 2, 'expected ambiguous role candidates');
});

test('SDC-1.H ID column detection in sample_metadata', async () => {
  const profile = await profileFixture('sample_metadata.tsv', 'text/tab-separated-values');
  assert.equal(profile.status, 'ok');
  const idRole = profile.observation.roles.find(
    (r) => (r.candidate === 'feature_identifier_column' || r.candidate === 'sample_identifier_column') && r.confidence >= 0.9,
  );
  assert.ok(idRole, `expected identifier role, got ${JSON.stringify(profile.observation.roles.map(r => r.candidate))}`);
  const sampleIdType = bestTypeForHeader(profile, 'sample_id');
  assert.equal(sampleIdType, 'string');
});

test('SDC-1.I missing value detection', async () => {
  const profile = await profileFixture('counts_matrix.csv', 'text/csv');
  assert.equal(profile.status, 'ok');
  const totalMissing = profile.observation.missingnessSignals.reduce(
    (s, sig) => s + (sig.confidence > 0 ? 1 : 0),
    0,
  );
  assert.equal(totalMissing, 0, 'fixture has no missing values');
});

test('SDC-1.J duplicate value detection', async () => {
  const profile = await profileFixture('sample_metadata.tsv', 'text/tab-separated-values');
  assert.equal(profile.status, 'ok');
  const duplicateCols = profile.observation.duplicateSignals.filter(
    (sig) => sig.confidence > 0,
  );
  assert.ok(duplicateCols.length >= 1, 'expected at least one column with duplicate values');
});

test('SDC-1.K structure report contains required fields', async () => {
  const profile = await profileFixture('counts_matrix.csv', 'text/csv');
  assert.ok(profile.snapshot.delimiter);
  assert.ok(profile.snapshot.encoding);
  assert.ok(profile.snapshot.sha256);
  assert.ok(Array.isArray(profile.observation.primitiveTypes));
  assert.ok(Array.isArray(profile.observation.fileRoleCandidates));
  assert.ok(Array.isArray(profile.diagnostics));
});
