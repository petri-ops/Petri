/**
 * BLOCK-234 — Q-DOMAIN P4-C S4：methods 模板/引文下沉 pack。
 * 钉住：Python 等价模板按类型从 pack 装载并替换占位符；报告引文由 pack 提供；
 * 无包时诚实降级（不伪造引文、不内联领域包名）。
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installMethodsPackFixture } from './helpers/methods-pack-fixture.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pack = installMethodsPackFixture();
after(() => pack.cleanup());

const methods = require(path.join(ROOT, 'core/petri-server/helpers/methods-export.js'));
const packMethods = require(path.join(ROOT, 'core/petri-server/helpers/pack-methods.js'));

function renderReport() {
  return methods._buildReportHtml({
    user: null,
    methods: null,
    language: 'zh',
    analyses: [],
    datasets: [],
    plans: [],
    plotsByAnalysisId: {},
    generatedAt: '2026-10-21T00:00:00.000Z',
  });
}

test('Python 等价模板从 pack 装载并替换 QC/降维占位符', () => {
  const output = methods._pythonEquivalent({
    type: 'scrna_standard',
    params: {
      minCells: 5,
      minFeatures: 300,
      maxFeatures: 6000,
      maxMtPercent: 15,
      nPCs: 30,
      resolution: 0.8,
      species: 'human',
    },
  });
  assert.match(output, /min_cells=5/);
  assert.match(output, /min_genes=300/);
  assert.match(output, /n_genes_by_counts < 6000/);
  assert.match(output, /pct_counts_mt < 15/);
  assert.match(output, /n_comps=30/);
  assert.match(output, /resolution=0\.8/);
  assert.match(output, /startswith\("MT-"\)/);
  assert.match(output, /write_h5ad\("result\.h5ad"\)/);
});

test('DEG 模板替换分组占位符', () => {
  const output = methods._pythonEquivalent({
    type: 'deg',
    params: { group1: 'treated', group2: 'control' },
  });
  assert.match(output, /groups=\["treated"\]/);
  assert.match(output, /reference="control"/);
  assert.match(output, /group="treated"/);
});

test('recluster 复用标准模板；未知类型走通用 fallback', () => {
  const recluster = methods._pythonEquivalent({ type: 'recluster', params: {} });
  assert.match(recluster, /n_comps=20/);
  assert.match(recluster, /resolution=0\.5/);
  const fallback = methods._pythonEquivalent({ type: 'unknown-type', params: {} });
  assert.match(fallback, /not yet built into Petri/);
  assert.doesNotMatch(fallback, /scanpy|squidpy|liana/);
});

test('报告引文由 pack 提供；无包时省略参考文献段', () => {
  const citations = packMethods.getReportCitations();
  assert.equal(citations.length, 13);
  assert.match(citations[0], /Hao Y/);
  const html = renderReport();
  assert.match(html, /参考文献/);
  assert.match(html, /Hao Y/);

  const previous = process.env.PETRI_LOCAL_DATA_DIR;
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-b234-empty-'));
  try {
    process.env.PETRI_LOCAL_DATA_DIR = empty;
    assert.deepEqual(packMethods.getReportCitations(), []);
    const noPackHtml = renderReport();
    assert.doesNotMatch(noPackHtml, /参考文献/);
    assert.match(methods._pythonEquivalent({ type: 'deg', params: {} }), /not yet built into Petri/);
  } finally {
    if (previous === undefined) delete process.env.PETRI_LOCAL_DATA_DIR;
    else process.env.PETRI_LOCAL_DATA_DIR = previous;
    fs.rmSync(empty, { recursive: true, force: true });
  }
});
