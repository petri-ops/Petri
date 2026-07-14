#!/usr/bin/env node
/**
 * test/demo-data.test.mjs — Week 3 first-success path
 *
 * Asserts every built-in tool's demo fixture under resources/demo-data/<tool>/
 * is present, well-formed, and gives the corresponding R script something
 * meaningful to call. Pure local test — no r-server needed.
 *
 * Coverage:
 *   • deseq2          — demo-counts.csv + demo-coldata.csv
 *   • volcano-plot    — demo_deg.csv (gene, log2FC, pvalue)
 *   • go-kegg         — genes.csv (single column gene list, ≥3 genes)
 *   • gsea            — ranked_list.csv (≥100 gene,score rows)
 *   • km-survival     — expression.csv + clinical.csv (≥30 common samples)
 *   • lasso-cox       — expression.csv + clinical.csv (≥30 common samples)
 *   • bindea-immune   — tpm_matrix.csv + group.csv (≥10 samples/group)
 *   • cellchat        — expression.csv + meta.csv (≥3 cell types, <5000 cells)
 *   • complexheatmap  — matrix.csv + annotation.csv (≤5000×500)
 *
 *   seurat-standard / wgcna / maftools-mutation — DEFERRED (need real
 *   external datasets like PBMC 3k, TCGA-BRCA, TCGA-LAML MAF). See
 *   docs/first-success-path.md for the worker task list.
 *
 * Exit codes:
 *   0   all checks pass
 *   1   at least one assertion failed (with reason on stderr)
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const DEMO = join(REPO_ROOT, 'resources', 'demo-data');

let failed = 0;
const toolFails = new Map();
function assert(cond, msg, tool = null) {
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
    console.error(`  ✗ ${msg}`);
    failed++;
    if (tool) toolFails.set(tool, (toolFails.get(tool) || 0) + 1);
  }
}
function section(label) {
  console.log(`\n• ${label}`);
}

console.log('test/demo-data — Week 3 first-success path');

// ─── deseq2 ────────────────────────────────────────────────
section('deseq2 — counts + coldata (10 genes × 4 samples)');
{
  const DIR = join(DEMO, 'deseq2');
  const COUNTS = join(DIR, 'demo-counts.csv');
  const COLDATA = join(DIR, 'demo-coldata.csv');
  assert(existsSync(COUNTS), 'exists at resources/demo-data/deseq2/demo-counts.csv', 'deseq2');
  assert(existsSync(COLDATA), 'exists at resources/demo-data/deseq2/demo-coldata.csv', 'deseq2');
  if (!existsSync(COUNTS) || !existsSync(COLDATA)) { console.error('  (skipping deseq2 content checks — files missing)'); } else {

  const countsText = readFileSync(COUNTS, 'utf8');
  assert(countsText.length > 0, 'non-empty', 'deseq2');
  const lines = countsText.trim().split(/\r?\n/);
  const header = lines[0].split(',');
  assert(header[0] === 'gene', 'header starts with `gene`', 'deseq2');
  const sampleCols = header.slice(1);
  assert(sampleCols.length >= 4, `has ≥4 sample columns (got ${sampleCols.length})`, 'deseq2');
  const rows = lines.slice(1);
  assert(rows.length >= 5, `has ≥5 data rows (got ${rows.length})`, 'deseq2');

  let allInts = true;
  let up = 0, down = 0;
  const wtIdx = sampleCols.indexOf('WT_1') + 1;
  const wt2Idx = sampleCols.indexOf('WT_2') + 1;
  const koIdx = sampleCols.indexOf('KO_1') + 1;
  const ko2Idx = sampleCols.indexOf('KO_2') + 1;
  for (const row of rows) {
    const cells = row.split(',');
    if (cells.length !== header.length) { allInts = false; continue; }
    for (let i = 1; i < cells.length; i++) {
      if (!/^\d+$/.test(cells[i])) { allInts = false; break; }
    }
    const wt = (Number(cells[wtIdx]) + Number(cells[wt2Idx])) / 2;
    const ko = (Number(cells[koIdx]) + Number(cells[ko2Idx])) / 2;
    if (ko > wt * 1.5) up++;
    if (wt > ko * 1.5) down++;
  }
  assert(allInts, 'every sample cell is an integer', 'deseq2');
  assert(up >= 3, `≥3 up-in-KO genes (got ${up})`, 'deseq2');
  assert(down >= 3, `≥3 down-in-KO genes (got ${down})`, 'deseq2');

  const colText = readFileSync(COLDATA, 'utf8');
  const colLines = colText.trim().split(/\r?\n/);
  assert(colLines[0] === 'sample,condition', 'header is exactly `sample,condition`', 'deseq2');
  const conds = new Map();
  for (let i = 1; i < colLines.length; i++) {
    const [s, c] = colLines[i].split(',');
    conds.set(c, (conds.get(c) || 0) + 1);
  }
  assert(conds.size >= 2, `≥2 unique conditions (got ${[...conds.keys()].join(',')})`, 'deseq2');
  let allHaveTwo = true;
  for (const [c, n] of conds) if (n < 2) allHaveTwo = false;
  assert(allHaveTwo, 'each condition has ≥2 samples', 'deseq2');
  }
}

// ─── volcano-plot ─────────────────────────────────────────
section('volcano-plot — deg table (25 rows: gene, log2FC, pvalue)');
{
  const F = join(DEMO, 'volcano-plot', 'demo_deg.csv');
  assert(existsSync(F), 'exists at resources/demo-data/volcano-plot/demo_deg.csv', 'volcano-plot');
  if (!existsSync(F)) { console.error('  (skipping volcano-plot content checks — file missing)'); }
  else {
  const text = readFileSync(F, 'utf8');
  const lines = text.trim().split(/\r?\n/);
  const header = lines[0].split(',').map((h) => h.replace(/"/g, '').trim());
  assert(header[0] === 'gene', `header[0] === 'gene' (got ${header[0]})`, 'volcano-plot');
  assert(header[1] === 'log2FC', `header[1] === 'log2FC' (got ${header[1]})`, 'volcano-plot');
  assert(header[2] === 'pvalue', `header[2] === 'pvalue' (got ${header[2]})`, 'volcano-plot');
  const rows = lines.slice(1);
  assert(rows.length >= 10, `≥10 data rows (got ${rows.length})`, 'volcano-plot');
  let numeric = 0, upSig = 0, downSig = 0;
  for (const row of rows) {
    const c = row.split(',').map((v) => v.replace(/"/g, '').trim());
    if (!isNaN(Number(c[1])) && !isNaN(Number(c[2]))) numeric++;
    if (Number(c[1]) > 1 && Number(c[2]) < 0.05) upSig++;
    if (Number(c[1]) < -1 && Number(c[2]) < 0.05) downSig++;
  }
  assert(numeric === rows.length, `log2FC + pvalue are numeric (got ${numeric}/${rows.length})`, 'volcano-plot');
  assert(upSig >= 3, `≥3 up-significant genes (got ${upSig})`, 'volcano-plot');
  assert(downSig >= 3, `≥3 down-significant genes (got ${downSig})`, 'volcano-plot');
  }
}

// ─── go-kegg ──────────────────────────────────────────────
section('go-kegg — gene list (single column, ≥3 genes)');
{
  const F = join(DEMO, 'go-kegg', 'genes.csv');
  assert(existsSync(F), 'exists at resources/demo-data/go-kegg/genes.csv', 'go-kegg');
  if (!existsSync(F)) { console.error('  (skipping go-kegg content checks — file missing)'); }
  else {
  const lines = readFileSync(F, 'utf8').trim().split(/\r?\n/);
  assert(lines[0] === 'gene', `header === 'gene' (got '${lines[0]}')`, 'go-kegg');
  const genes = lines.slice(1).map((l) => l.trim()).filter(Boolean);
  assert(genes.length >= 3, `≥3 genes (got ${genes.length})`, 'go-kegg');
  assert(new Set(genes).size === genes.length, 'no duplicate gene symbols', 'go-kegg');
  }
}

// ─── gsea ─────────────────────────────────────────────────
section('gsea — ranked list (≥100 gene,score rows)');
{
  const F = join(DEMO, 'gsea', 'ranked_list.csv');
  assert(existsSync(F), 'exists at resources/demo-data/gsea/ranked_list.csv', 'gsea');
  if (!existsSync(F)) { console.error('  (skipping gsea content checks — file missing)'); }
  else {
  const lines = readFileSync(F, 'utf8').trim().split(/\r?\n/);
  const header = lines[0].split(',');
  assert(header[0] === 'gene', `header[0] === 'gene' (got ${header[0]})`, 'gsea');
  assert(header.length >= 2, `≥2 columns (got ${header.length})`, 'gsea');
  const rows = lines.slice(1);
  assert(rows.length >= 100, `≥100 rows (got ${rows.length})`, 'gsea');
  let numeric = 0;
  for (const row of rows) {
    const c = row.split(',');
    if (!isNaN(Number(c[1]))) numeric++;
  }
  assert(numeric === rows.length, `score column numeric (got ${numeric}/${rows.length})`, 'gsea');
  }
}

// ─── km-survival & lasso-cox (similar shape) ──────────────
function checkSurvival(tool, exprFile, clinFile) {
  const EXPR = join(DEMO, tool, exprFile);
  const CLIN = join(DEMO, tool, clinFile);
  assert(existsSync(EXPR), `exists at resources/demo-data/${tool}/${exprFile}`, tool);
  assert(existsSync(CLIN), `exists at resources/demo-data/${tool}/${clinFile}`, tool);
  if (!existsSync(EXPR) || !existsSync(CLIN)) return;
  const exprHeader = readFileSync(EXPR, 'utf8').trim().split(/\r?\n/)[0].split(',');
  const clinHeader = readFileSync(CLIN, 'utf8').trim().split(/\r?\n/)[0].split(',');
  const samplesExpr = exprHeader.slice(1);
  const samplesClin = clinHeader[0] === 'sample'
    ? readFileSync(CLIN, 'utf8').trim().split(/\r?\n/).slice(1).map((l) => l.split(',')[0])
    : [];
  const common = samplesExpr.filter((s) => samplesClin.includes(s));
  assert(samplesExpr.length >= 30, `expression has ≥30 samples (got ${samplesExpr.length})`, tool);
  assert(common.length >= 30, `≥30 common samples between expr + clinical (got ${common.length})`, tool);
  assert(clinHeader.includes('OS.time'), `clinical has OS.time column (got ${clinHeader.join(',')})`, tool);
  assert(clinHeader.includes('OS'), `clinical has OS (event) column (got ${clinHeader.join(',')})`, tool);
}
section('km-survival — expression + clinical (≥30 common samples)');
checkSurvival('km-survival', 'expression.csv', 'clinical.csv');
section('lasso-cox — expression + clinical (≥30 common samples)');
checkSurvival('lasso-cox', 'expression.csv', 'clinical.csv');

// ─── bindea-immune ────────────────────────────────────────
section('bindea-immune — tpm_matrix + group (≥10/group)');
{
  const TPM = join(DEMO, 'bindea-immune', 'tpm_matrix.csv');
  const GRP = join(DEMO, 'bindea-immune', 'group.csv');
  assert(existsSync(TPM), 'exists at resources/demo-data/bindea-immune/tpm_matrix.csv', 'bindea-immune');
  assert(existsSync(GRP), 'exists at resources/demo-data/bindea-immune/group.csv', 'bindea-immune');
  if (existsSync(TPM) && existsSync(GRP)) {
  const tpmLines = readFileSync(TPM, 'utf8').trim().split(/\r?\n/);
  assert(tpmLines[0].startsWith('gene,'), 'tpm_matrix header starts with `gene,`', 'bindea-immune');
  assert(tpmLines.length >= 30, `tpm_matrix has ≥30 genes (got ${tpmLines.length - 1})`, 'bindea-immune');
  const tpmSamples = tpmLines[0].split(',').slice(1);
  assert(tpmSamples.length >= 20, `tpm_matrix has ≥20 samples (got ${tpmSamples.length})`, 'bindea-immune');
  const grpLines = readFileSync(GRP, 'utf8').trim().split(/\r?\n/);
  assert(grpLines[0] === 'sample,group', 'group header is sample,group', 'bindea-immune');
  const groupCounts = new Map();
  for (let i = 1; i < grpLines.length; i++) {
    const [s, g] = grpLines[i].split(',');
    groupCounts.set(g, (groupCounts.get(g) || 0) + 1);
  }
  assert(groupCounts.size >= 2, `≥2 unique groups (got ${[...groupCounts.keys()].join(',')})`, 'bindea-immune');
  for (const [g, n] of groupCounts) {
    assert(n >= 10, `group '${g}' has ≥10 samples (got ${n})`, 'bindea-immune');
  }
  }
}

// ─── cellchat ─────────────────────────────────────────────
section('cellchat — expression + meta (≥3 cell types, ≤5000 cells)');
{
  const EXP = join(DEMO, 'cellchat', 'expression.csv');
  const META = join(DEMO, 'cellchat', 'meta.csv');
  assert(existsSync(EXP), 'exists at resources/demo-data/cellchat/expression.csv', 'cellchat');
  assert(existsSync(META), 'exists at resources/demo-data/cellchat/meta.csv', 'cellchat');
  if (existsSync(EXP) && existsSync(META)) {
  const expHeader = readFileSync(EXP, 'utf8').trim().split(/\r?\n/)[0].split(',');
  const cells = expHeader.slice(1);
  assert(cells.length <= 5000, `≤5000 cells (got ${cells.length})`, 'cellchat');
  assert(cells.length >= 50, `≥50 cells for CellChat stability (got ${cells.length})`, 'cellchat');
  const metaLines = readFileSync(META, 'utf8').trim().split(/\r?\n/);
  assert(metaLines[0] === 'cell_id,cell_type', `meta header is cell_id,cell_type (got ${metaLines[0]})`, 'cellchat');
  const types = new Set();
  for (let i = 1; i < metaLines.length; i++) {
    const [, t] = metaLines[i].split(',');
    types.add(t);
  }
  assert(types.size >= 3, `≥3 cell types (got ${types.size}: ${[...types].join(',')})`, 'cellchat');
  }
}

// ─── complexheatmap ───────────────────────────────────────
section('complexheatmap — matrix + annotation (≤5000 rows × ≤500 cols)');
{
  const M = join(DEMO, 'complexheatmap', 'matrix.csv');
  const A = join(DEMO, 'complexheatmap', 'annotation.csv');
  assert(existsSync(M), 'exists at resources/demo-data/complexheatmap/matrix.csv', 'complexheatmap');
  assert(existsSync(A), 'exists at resources/demo-data/complexheatmap/annotation.csv', 'complexheatmap');
  if (existsSync(M) && existsSync(A)) {
  const mLines = readFileSync(M, 'utf8').trim().split(/\r?\n/);
  const mHeader = mLines[0].split(',');
  assert(mHeader[0] === 'feature', `matrix header[0] === 'feature' (got ${mHeader[0]})`, 'complexheatmap');
  const nRows = mLines.length - 1;
  const nCols = mHeader.length - 1;
  assert(nRows <= 5000, `matrix rows ≤5000 (got ${nRows})`, 'complexheatmap');
  assert(nCols <= 500, `matrix cols ≤500 (got ${nCols})`, 'complexheatmap');
  assert(nRows >= 5 && nCols >= 10, `matrix has ≥5 rows × ≥10 cols (got ${nRows}×${nCols})`, 'complexheatmap');
  const aLines = readFileSync(A, 'utf8').trim().split(/\r?\n/);
  assert(aLines[0].startsWith('sample,'), `annotation header starts with 'sample,' (got ${aLines[0]})`, 'complexheatmap');
  const annoHeader = aLines[0].split(',');
  assert(annoHeader.length <= 7, `annotation has ≤7 columns (got ${annoHeader.length})`, 'complexheatmap');
  }
}

// ─── summary ──────────────────────────────────────────────
console.log('');
if (failed > 0) {
  console.error(`${failed} assertion(s) failed`);
  const byTool = [...toolFails.entries()].sort((a, b) => b[1] - a[1]);
  for (const [tool, n] of byTool) console.error(`  - ${tool}: ${n} failure(s)`);
  console.error('\nDeferred tools (need external datasets, see docs/first-success-path.md):');
  console.error('  - seurat-standard (PBMC 3k, ~16 MB)');
  console.error('  - wgcna (TCGA-BRCA, large)');
  console.error('  - maftools-mutation (TCGA-LAML MAF, ~64 KB gz)');
  process.exit(1);
}
console.log('all demo-data assertions passed.');