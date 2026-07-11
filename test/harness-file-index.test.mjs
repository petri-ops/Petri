import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  detectFile,
  indexDirectory,
  readIndexCache,
  suggestInputBindings,
  writeIndexCache,
} from '../scripts/harness-file-index.mjs';

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-harness-index-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('detectFile detects DEG table headers and failure-repair useful hints', () => {
  withTempDir((dir) => {
    const file = path.join(dir, 'deg.csv');
    fs.writeFileSync(file, 'gene,log2FC,pvalue\nTP53,1.2,0.01\nEGFR,-2.1,0.001\n');
    const detected = detectFile(file);
    assert.equal(detected.kind, 'csv');
    assert.equal(detected.role, 'deg_table');
    assert.deepEqual(detected.table.headers, ['gene', 'log2FC', 'pvalue']);
    assert.equal(detected.table.hints.hasDegColumns, true);
    assert.equal(detected.table.columns[1].likelyType, 'number');
  });
});

test('detectFile infers rows_are_features expression matrix orientation', () => {
  withTempDir((dir) => {
    const file = path.join(dir, 'expr.csv');
    fs.writeFileSync(file, 'gene,S1,S2,S3\nA,1,2,3\nB,4,5,6\nC,7,8,9\n');
    const detected = detectFile(file);
    assert.equal(detected.role, 'expression_matrix');
    assert.equal(detected.table.matrixOrientation, 'rows_are_features');
    assert.equal(detected.table.columnCount, 4);
  });
});

test('detectFile infers rows_are_samples expression matrix orientation', () => {
  withTempDir((dir) => {
    const file = path.join(dir, 'sample_expr.csv');
    fs.writeFileSync(file, 'Sample,GENE001,GENE002,GENE003\nS1,1,2,3\nS2,4,5,6\nS3,7,8,9\n');
    const detected = detectFile(file);
    assert.equal(detected.role, 'expression_matrix');
    assert.equal(detected.table.matrixOrientation, 'rows_are_samples');
  });
});

test('indexDirectory builds metadata index and cache', () => {
  withTempDir((dir) => {
    fs.mkdirSync(path.join(dir, 'nested'));
    fs.writeFileSync(path.join(dir, 'groups.tsv'), 'sample\tgroup\nS1\tA\nS2\tB\n');
    fs.writeFileSync(path.join(dir, 'nested', 'notes.md'), '# Notes\nhello');
    const index = indexDirectory(dir);
    assert.equal(index.harnessIndexVersion, 1);
    assert.equal(index.fileCount, 2);
    assert.equal(index.byRole.sample_metadata, 1);
    assert.equal(index.byKind.text, 1);
    const cachePath = writeIndexCache(index, path.join(dir, '.biof3-harness-index.json'));
    const cached = readIndexCache(cachePath);
    assert.equal(cached.fileCount, 2);
    assert.ok(cached.entries.some((entry) => entry.relativePath === 'groups.tsv'));
  });
});

test('suggestInputBindings ranks files for plugin inputs', () => {
  withTempDir((dir) => {
    fs.writeFileSync(path.join(dir, 'demo_deg.csv'), 'gene,log2FC,pvalue\nTP53,1.2,0.01\n');
    fs.writeFileSync(path.join(dir, 'groups.tsv'), 'sample\tgroup\nS1\tA\n');
    const index = indexDirectory(dir, { hash: false });
    const suggestions = suggestInputBindings(
      {
        inputs: [
          { id: 'deg_table', label: '差异分析结果表', type: 'file', required: true, accept: '.csv' },
          { id: 'group_file', label: '样本分组文件', type: 'file', accept: '.csv,.tsv' },
        ],
      },
      index,
    );
    assert.equal(suggestions[0].selected.relativePath, 'demo_deg.csv');
    assert.equal(suggestions[1].selected.relativePath, 'groups.tsv');
    assert.ok(suggestions[0].selected.reasons.includes('role_deg_table'));
    assert.ok(suggestions[1].selected.reasons.includes('role_sample_metadata'));
  });
});
