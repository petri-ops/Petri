import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  resolveUploadedFiles,
  writeUploadedFiles,
  validateUploadedFiles,
} = require('../core/biof3-server/helpers/tools-executor')._test;

function jobWithFile(name, content) {
  const jobDir = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-input-validation-'));
  fs.writeFileSync(path.join(jobDir, name), content);
  return jobDir;
}

test('GO/KEGG accepts its one-column gene-list demo contract', () => {
  const jobDir = jobWithFile('genes.csv', 'gene\nTP53\nBRCA1\n');
  const error = validateUploadedFiles('go-kegg', jobDir, {
    'genes.csv': Buffer.from('gene\nTP53\nBRCA1\n').toString('base64'),
  });
  assert.equal(error, null);
});

test('GSEA still rejects a one-column ranked-list input', () => {
  const jobDir = jobWithFile('ranked_list.csv', 'gene\nTP53\nBRCA1\n');
  const error = validateUploadedFiles('gsea', jobDir, {
    'ranked_list.csv': Buffer.from('gene\nTP53\nBRCA1\n').toString('base64'),
  });
  assert.match(error, /只检测到 1 列/);
});

test('tool uploads reject unsafe file maps before any upload file is written', (t) => {
  const jobDir = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-upload-path-'));
  const outsidePath = path.join(path.dirname(jobDir), 'outside.csv');
  const encoded = Buffer.from('gene\nTP53\n').toString('base64');
  t.after(() => fs.rmSync(jobDir, { recursive: true, force: true }));
  t.after(() => fs.rmSync(outsidePath, { force: true }));

  const atomicFailure = writeUploadedFiles(jobDir, {
    'safe.csv': encoded,
    '../outside.csv': encoded,
  });
  assert.equal(atomicFailure.ok, false);
  assert.equal(fs.existsSync(path.join(jobDir, 'safe.csv')), false, 'preflight must prevent partial writes');
  assert.equal(fs.existsSync(outsidePath), false, 'traversal must not write outside the job directory');

  for (const key of ['/tmp/absolute.csv', 'nested/input.csv', 'nested\\input.csv', '..', 'nul\0name.csv']) {
    const result = writeUploadedFiles(jobDir, { [key]: encoded });
    assert.equal(result.ok, false, key);
    assert.equal(fs.existsSync(outsidePath), false, key);
  }

  for (const key of ['manifest.json', 'artifact-manifest.json', 'params.json', 'run-script.R']) {
    const result = writeUploadedFiles(jobDir, { [key]: encoded });
    assert.equal(result.ok, false, key);
    assert.equal(fs.existsSync(path.join(jobDir, key)), false, key);
  }

  const unsafeValue = writeUploadedFiles(jobDir, { 'unsafe.csv': { base64: encoded } });
  assert.equal(unsafeValue.ok, false);
  assert.equal(fs.existsSync(path.join(jobDir, 'unsafe.csv')), false);
  assert.equal(writeUploadedFiles(jobDir, [encoded]).ok, false, 'arrays are not file maps');
  assert.equal(writeUploadedFiles(jobDir, new Map([['unsafe.csv', encoded]])).ok, false, 'non-plain objects are not file maps');
  assert.match(validateUploadedFiles('go-kegg', jobDir, { '../outside.csv': encoded }), /上传文件/);
});

test('tool uploads retain flat valid filenames and validation resolves the same path', (t) => {
  const jobDir = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-upload-flat-'));
  const encoded = Buffer.from('gene\nTP53\nBRCA1\n').toString('base64');
  t.after(() => fs.rmSync(jobDir, { recursive: true, force: true }));

  const resolved = resolveUploadedFiles(jobDir, { 'genes.csv': encoded });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.entries[0].filePath, path.join(jobDir, 'genes.csv'));
  assert.equal(writeUploadedFiles(jobDir, { 'genes.csv': encoded }).ok, true);
  assert.equal(fs.readFileSync(path.join(jobDir, 'genes.csv'), 'utf8'), 'gene\nTP53\nBRCA1\n');
  assert.equal(validateUploadedFiles('go-kegg', jobDir, { 'genes.csv': encoded }), null);
});
