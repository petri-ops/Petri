'use strict';

/**
 * block131（BIO-5 P1）— 上传域校验执行化契约。
 *
 * 差距（G0-BIO plan §2.4）：artifact-profiles.js 声明了 counts-matrix/
 * sample-metadata 的域规则（非负整数/唯一基因名/样本对齐），但核心上传
 * 路径只做通用 CSV 嗅探——值级校验外包给（当时休眠的）validator 插件。
 * 本包把两条 profile 的值级规则执行在上传路径（fail-closed+可操作提示）。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const {
  validateDomainUploads,
} = require('../core/petri-server/helpers/upload-domain-validation.js');

function withFiles(files, run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'block131-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(dir, name), content);
    }
    return run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('valid counts matrix and metadata pass with no findings', () => {
  const result = withFiles({
    'counts.csv': 'gene,WT_1,WT_2,KO_1,KO_2\nGene_A,100,110,200,210\nGene_B,50,55,45,50\n',
    'metadata.csv': 'sample,condition,batch\nWT_1,WT,b1\nWT_2,WT,b1\nKO_1,KO,b2\nKO_2,KO,b2\n',
  }, (dir) => validateDomainUploads(dir, ['counts.csv', 'metadata.csv']));
  assert.deepEqual(result.findings, []);
});

test('counts matrix: duplicate gene ids and negative or fractional values are rejected with actionable pointers', () => {
  const result = withFiles({
    'counts.csv': 'gene,WT_1,WT_2\nGene_A,100,110\nGene_A,50,55\nGene_B,-3,2.5\n',
  }, (dir) => validateDomainUploads(dir, ['counts.csv']));
  const codes = result.findings.map((f) => f.code);
  assert.ok(codes.includes('feature_ids_unique'), JSON.stringify(result.findings));
  assert.ok(codes.includes('counts_non_negative_integer'), JSON.stringify(result.findings));
  const dup = result.findings.find((f) => f.code === 'feature_ids_unique');
  assert.ok(dup.message.includes('Gene_A'), 'duplicate id named in message');
  const bad = result.findings.find((f) => f.code === 'counts_non_negative_integer');
  assert.ok(/-3|2\.5/.test(bad.message), 'offending values named in message');
});

test('counts matrix: duplicate sample columns are rejected', () => {
  const result = withFiles({
    'counts.csv': 'gene,WT_1,WT_1\nGene_A,100,110\n',
  }, (dir) => validateDomainUploads(dir, ['counts.csv']));
  assert.ok(result.findings.some((f) => f.code === 'sample_names_unique'), JSON.stringify(result.findings));
});

test('metadata: duplicate sample ids and missing condition are rejected', () => {
  const result = withFiles({
    'metadata.csv': 'sample,condition\nWT_1,WT\nWT_1,\n',
  }, (dir) => validateDomainUploads(dir, ['metadata.csv']));
  const codes = result.findings.map((f) => f.code);
  assert.ok(codes.includes('sample_ids_unique'), JSON.stringify(result.findings));
  assert.ok(codes.includes('condition_not_missing'), JSON.stringify(result.findings));
});

test('metadata: sample overlap against the bound matrix is enforced', () => {
  const result = withFiles({
    'counts.csv': 'gene,WT_1,WT_2\nGene_A,100,110\n',
    'metadata.csv': 'sample,condition\nWT_1,WT\nKO_9,KO\n',
  }, (dir) => validateDomainUploads(dir, ['counts.csv', 'metadata.csv']));
  assert.ok(result.findings.some((f) => f.code === 'sample_overlap_required' && /KO_9/.test(f.message)),
    JSON.stringify(result.findings));
});

test('non-domain files are left to the generic sniffer (no fabricated findings)', () => {
  const result = withFiles({
    'deg_table.csv': 'gene,log2FC,padj\nX,2.5,1e-8\n',
  }, (dir) => validateDomainUploads(dir, ['deg_table.csv']));
  assert.deepEqual(result.findings, []);
});

test('handleToolRun wiring: domain validation runs after the generic sniffer and fails closed', () => {
  const src = fs.readFileSync(path.join(ROOT, 'core/petri-server/helpers/tools-executor.js'), 'utf8');
  assert.ok(src.includes('validateDomainUploads'), 'executor must call the domain validator');
  const callOrder = src.indexOf('validateUploadedFiles(toolId');
  const domainOrder = src.indexOf('validateDomainUploads(');
  assert.ok(callOrder >= 0 && domainOrder > callOrder, 'domain validation must run after the generic sniffer');
});
