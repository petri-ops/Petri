import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { validateUploadedFiles } = require('../core/r-server/helpers/tools-executor')._test;

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
