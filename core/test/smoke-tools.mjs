#!/usr/bin/env node
/**
 * BioF3 Tool Smoke Tests — runs each online tool with its demo data,
 * polls until completion, and emits an aggregate Feishu notification.
 *
 * Triggers the X-BioF3-Smoke-Test header so all jobs are tagged is_test_run=1
 * and excluded from admin UI / analytics / daily digest.
 *
 * Usage:
 *   BIOF3_URL=https://biof3.com/api/r \
 *   BIOF3_SMOKE_USER=__smoke_test__ \
 *   BIOF3_SMOKE_PASS=xxx \
 *   SMOKE_TEST_TOKEN=xxx \
 *   node test/smoke-tools.mjs
 *
 * Or run only specific tools:
 *   node test/smoke-tools.mjs deseq2 go-kegg
 *
 * Exit code:
 *   0 = all passed
 *   1 = one or more failed
 *   2 = setup error (login failed, no token, etc.)
 *
 * On completion, sends an aggregated Feishu card via /api/internal/notify
 * (requires server-side endpoint or direct webhook — see NOTIFY section).
 */

import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---- Config ----
const BASE = (process.env.BIOF3_URL || 'http://localhost:3001').replace(/\/$/, '');
const USER = process.env.BIOF3_SMOKE_USER || '__smoke_test__';
const PASS = process.env.BIOF3_SMOKE_PASS;
const TOKEN = process.env.SMOKE_TEST_TOKEN;
const POLL_TIMEOUT_MS = parseInt(process.env.SMOKE_POLL_TIMEOUT_MS || '300000', 10);
const POLL_INTERVAL_MS = parseInt(process.env.SMOKE_POLL_INTERVAL_MS || '2000', 10);

if (!PASS) {
  console.error('FATAL: BIOF3_SMOKE_PASS env var required');
  process.exit(2);
}
if (!TOKEN) {
  console.error('FATAL: SMOKE_TEST_TOKEN env var required');
  process.exit(2);
}

// ---- Tool fixtures (mirror src/pages/tools/index.tsx loadDemoForForm) ----
// Each tool defines:
//   files: {<key>: <demo-data-filename>}  (will be base64-encoded)
//   params: {<key>: <value>}              (matches loadDemoForForm setParams)
//   expectedOutputs: [<filename>, ...]    (must exist in output/ for pass)
const TOOL_FIXTURES = {
  deseq2: {
    files: {
      counts: 'demo-counts.csv',
      coldata: 'demo-coldata.csv',
    },
    params: { design: 'condition', contrast_ref: 'Control', contrast_treat: 'Treatment' },
    expectedOutputs: [
      'deg_table.csv',
      'volcano.png',
      'volcano.pdf',
      'pca.png',
      'pca.pdf',
      'heatmap.png',
      'heatmap.pdf',
      'library_size.png',
      'library_size.pdf',
      'dispersion.png',
      'dispersion.pdf',
      'ma_plot.png',
      'ma_plot.pdf',
      'sample_distance.png',
      'sample_distance.pdf',
      'vst_matrix.csv',
      'coldata_info.csv',
      'dispersion_data.csv',
      'report.html',
    ],
  },
  'go-kegg': {
    files: { genes: 'genes.csv' },
    params: {
      species: 'human',
      analysis_type: 'all',
      gene_id_type: 'SYMBOL',
      padj_cutoff: '0.05',
      lfc_cutoff: '1',
      enrich_pvalue: '0.05',
      enrich_qvalue: '0.2',
      top_n: '20',
    },
    expectedOutputs: [
      'go_bp_results.csv',
      'kegg_results.csv',
      'go_bp_dotplot.png',
      'go_bp_dotplot.pdf',
      'kegg_dotplot.png',
      'kegg_dotplot.pdf',
      'ego_bp.rds',
      'kegg_res.rds',
    ],
  },
  gsea: {
    files: { ranked_list: 'ranked_list.csv' },
    params: { organism: 'hsa', gene_set: 'GO_BP', min_size: '15', max_size: '500' },
    expectedOutputs: [
      'gsea_results.csv',
      'gsea_dotplot.png',
      'gsea_dotplot.pdf',
      'gsea_waterfall.png',
      'gsea_waterfall.pdf',
      'gsea_ridge.png',
      'gsea_ridge.pdf',
      'gsea_res.rds',
      'ranked_gene_list.csv',
    ],
  },
  'km-survival': {
    files: {
      expression: 'expression.csv',
      clinical: 'clinical.csv',
    },
    params: { gene: 'TP53', cutoff_method: 'median', time_col: 'OS.time', event_col: 'OS' },
    expectedOutputs: [
      'km_curve.png',
      'km_curve.pdf',
      'forest_plot.png',
      'forest_plot.pdf',
      'roc_curve.png',
      'roc_curve.pdf',
      'expression_dist.png',
      'expression_dist.pdf',
      'cox_results.csv',
      'survival_data.csv',
    ],
  },
  'lasso-cox': {
    files: {
      expression: 'expression.csv',
      clinical: 'clinical.csv',
    },
    params: { train_ratio: '0.7', seed: '42' },
    expectedOutputs: [
      'risk_scores.csv',
      'signature_genes.csv',
      'signature_expr_matrix.csv',
      'lasso_cv_fit.rds',
      'lasso_cv.png',
      'lasso_cv.pdf',
      'coef_barplot.png',
      'coef_barplot.pdf',
      'km_curve.png',
      'km_curve.pdf',
      'roc_curve.png',
      'roc_curve.pdf',
      'risk_triple.png',
      'risk_triple.pdf',
    ],
  },
  'bindea-immune': {
    files: {
      tpm_matrix: 'tpm_matrix.csv',
      group_file: 'group.csv',
    },
    params: { method: 'ssgsea' },
    expectedOutputs: [
      'immune_scores_normalized.csv',
      'immune_scores_raw.csv',
      'barplot_composition.png',
      'barplot_composition.pdf',
      'correlation_heatmap.png',
      'correlation_heatmap.pdf',
      'lollipop_scores.png',
      'lollipop_scores.pdf',
      'boxplot_group.png',
      'boxplot_group.pdf',
      'report.html',
    ],
  },
  wgcna: {
    files: { expression: 'expression.csv', traits: 'traits.csv' },
    params: {
      min_module_size: '30',
      merge_cut_height: '0.25',
      network_type: 'signed',
    },
    expectedOutputs: [
      'module_assignment.csv',
      'hub_genes.csv',
      'module_trait_corr.csv',
      'sft_results.csv',
      'sample_dendrogram.png',
      'sample_dendrogram.pdf',
      'soft_threshold.png',
      'soft_threshold.pdf',
      'gene_dendrogram.png',
      'gene_dendrogram.pdf',
      'module_size_barplot.png',
      'module_size_barplot.pdf',
      'module_trait_heatmap.png',
      'module_trait_heatmap.pdf',
      'module_eigengenes.png',
      'module_eigengenes.pdf',
      'hub_gene_table.png',
      'hub_gene_table.pdf',
      'gs_mm_scatter.png',
      'gs_mm_scatter.pdf',
      'network.rds',
      'report.html',
    ],
  },
  complexheatmap: {
    files: { matrix: 'matrix.csv', annotation: 'annotation.csv' },
    params: {
      z_score: 'TRUE',
      cluster_rows: 'TRUE',
      cluster_columns: 'TRUE',
      clustering_distance: 'pearson',
      clustering_method: 'ward.D2',
      color_scheme: 'div',
      top_n_label: '20',
    },
    expectedOutputs: ['heatmap_main.png', 'heatmap_main.pdf', 'matrix_zscore.csv', 'report.html'],
  },
  cellchat: {
    files: { expression: 'expression.csv', meta: 'meta.csv' },
    params: {
      species: 'human',
      signaling_db: 'Secreted Signaling',
      min_cells_per_group: '10',
      top_pathways_to_visualize: '5',
    },
    expectedOutputs: [
      'network_circle_weight.png',
      'network_circle_weight.pdf',
      'lr_significant.csv',
      'report.html',
    ],
  },
  'maftools-mutation': {
    files: { maf_file: 'maf_file', clinical: 'clinical' },
    params: {
      genome: 'hg19',
      top_n_oncoplot: '20',
      lollipop_top_n: '2',
      n_signatures: '3',
    },
    expectedOutputs: [
      'oncoplot.png',
      'oncoplot.pdf',
      'gene_summary.csv',
      'maf_summary.png',
      'mutation_signature.png',
      'signature_contributions.csv',
      'report.html',
    ],
  },
  'seurat-standard': {
    files: { matrix: 'pbmc3k_demo.csv' },
    params: {
      species: 'human',
      min_features: '200',
      max_features: '2500',
      max_mt: '5',
      nfeatures: '2000',
      dims: '10',
      resolution: '0.5',
      top_n_markers: '10',
    },
    expectedOutputs: [
      'markers_table.csv',
      'qc_metrics.csv',
      'umap_coords.csv',
      'qc_violin.png',
      'qc_violin.pdf',
      'umap_clusters.png',
      'umap_clusters.pdf',
      'hvg_plot.png',
      'hvg_plot.pdf',
      'markers_heatmap.png',
      'markers_heatmap.pdf',
      'markers_violin.png',
      'markers_violin.pdf',
      'feature_plot.png',
      'feature_plot.pdf',
      'seurat_obj.rds',
      'report.html',
    ],
  },
};

// ---- HTTP helpers ----
async function request(path, opts = {}) {
  const url = BASE + path;
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  const r = await fetch(url, { ...opts, headers });
  const text = await r.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: r.status, json, text };
}

let JWT = null;
async function login() {
  // The server mounts auth at both /api/auth and (depending on nginx) /api/r/auth.
  // Try the standard path first.
  const candidates = ['/api/auth/login', '/auth/login'];
  for (const p of candidates) {
    const r = await request(p, {
      method: 'POST',
      body: JSON.stringify({ username: USER, password: PASS }),
    });
    if (r.status === 200 && r.json && r.json.token) {
      JWT = r.json.token;
      return JWT;
    }
  }
  throw new Error(
    'login failed: tried ' + candidates.join(', ') + ' — last response was non-200 / no token'
  );
}

async function fetchDemoFile(toolId, filename) {
  // Fetch as ArrayBuffer so we can handle both text and binary (gzip MAF, h5, etc.)
  const url = BASE + `/api/tools/demo-data/${toolId}/${filename}`;
  const r = await fetch(url);
  if (r.status !== 200) throw new Error(`demo-data/${toolId}/${filename} → ${r.status}`);
  const ab = await r.arrayBuffer();
  return Buffer.from(ab);
}

function b64(buf) {
  // Accept either Buffer (binary) or string (text)
  if (Buffer.isBuffer(buf)) return buf.toString('base64');
  return Buffer.from(buf, 'utf-8').toString('base64');
}

async function submitJob(toolId, fixture) {
  // Fetch demo files in parallel as Buffers, then base64 encode
  const fileBufs = await Promise.all(
    Object.entries(fixture.files).map(async ([key, fn]) => [key, await fetchDemoFile(toolId, fn)])
  );
  const files = Object.fromEntries(fileBufs.map(([key, buf]) => [key, b64(buf)]));

  const r = await request('/api/tools/run', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${JWT}`,
      'X-BioF3-Smoke-Test': TOKEN,
    },
    body: JSON.stringify({ toolId, params: fixture.params, files }),
  });
  if (r.status !== 200 || !r.json || !r.json.ok) {
    throw new Error(`submit ${toolId} → ${r.status}: ${(r.text || '').slice(0, 300)}`);
  }
  if (!r.json.isTestRun)
    throw new Error(
      `server did not recognize smoke test header (isTestRun=false). Check SMOKE_TEST_TOKEN env on server.`
    );
  return r.json.jobId;
}

async function pollUntilDone(jobId, deadline) {
  while (Date.now() < deadline) {
    const r = await request(`/api/tools/status/${jobId}`, {
      headers: { Authorization: `Bearer ${JWT}` },
    });
    if (r.status === 200 && r.json) {
      const s = r.json.status;
      if (s === 'completed' || s === 'failed' || s === 'cancelled') return r.json;
    }
    await new Promise((rs) => setTimeout(rs, POLL_INTERVAL_MS));
  }
  throw new Error(`poll timeout (${POLL_TIMEOUT_MS / 1000}s)`);
}

function checkExpectedOutputs(job, expected) {
  const files = job.result_json ? safeParse(job.result_json) : job.result || {};
  const actualNames = (files.files || []).map((f) => f.name || '');
  const missing = expected.filter((e) => !actualNames.includes(e));
  return { actualNames, missing };
}
function safeParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

// ---- Per-tool runner ----
async function runOne(toolId) {
  const fixture = TOOL_FIXTURES[toolId];
  if (!fixture) return { toolId, ok: false, error: 'unknown tool fixture', durationMs: 0 };
  const t0 = Date.now();
  try {
    const jobId = await submitJob(toolId, fixture);
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    const job = await pollUntilDone(jobId, deadline);
    const dur = Date.now() - t0;
    if (job.status === 'completed') {
      const { missing, actualNames } = checkExpectedOutputs(job, fixture.expectedOutputs);
      if (missing.length) {
        return {
          toolId,
          ok: false,
          jobId,
          error: `missing outputs: ${missing.join(',')} (got: ${actualNames.join(',') || 'none'})`,
          durationMs: dur,
        };
      }
      return { toolId, ok: true, jobId, durationMs: dur };
    }
    return {
      toolId,
      ok: false,
      jobId,
      error: (job.error || `status=${job.status}`).slice(0, 500),
      durationMs: dur,
    };
  } catch (e) {
    return { toolId, ok: false, error: e.message, durationMs: Date.now() - t0 };
  }
}

// ---- Notification ----
// Calls a server-side endpoint to emit the smoke test notification (uses
// the same notify-feishu module). This way the script doesn't need direct
// webhook URL access.
async function notifyAggregate(summary) {
  const r = await request('/api/internal/smoke-test-result', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${JWT}`,
      'X-BioF3-Smoke-Test': TOKEN,
    },
    body: JSON.stringify(summary),
  });
  if (r.status !== 200) {
    console.warn('aggregate notify failed:', r.status, (r.text || '').slice(0, 200));
  }
}

// ---- Main ----
async function main() {
  const args = process.argv.slice(2);
  const requested = args.length ? args : Object.keys(TOOL_FIXTURES);
  const unknown = requested.filter((t) => !TOOL_FIXTURES[t]);
  if (unknown.length) {
    console.error('Unknown tool(s):', unknown.join(','));
    process.exit(2);
  }

  console.log(`[smoke] Logging in as ${USER} at ${BASE}...`);
  await login();
  console.log(`[smoke] Login OK. Running ${requested.length} tools: ${requested.join(', ')}`);

  const t0 = Date.now();
  const results = [];
  for (const toolId of requested) {
    process.stdout.write(`  [${toolId}] running...`);
    const r = await runOne(toolId);
    results.push(r);
    if (r.ok) console.log(` ✓ ${(r.durationMs / 1000).toFixed(1)}s`);
    else console.log(` ✗ ${(r.durationMs / 1000).toFixed(1)}s — ${r.error}`);
  }
  const totalMs = Date.now() - t0;
  const passCount = results.filter((r) => r.ok).length;
  const failCount = results.length - passCount;

  console.log('');
  console.log(
    `[smoke] Total: ${passCount}/${results.length} passed in ${(totalMs / 1000).toFixed(1)}s`
  );

  // Aggregated notification
  await notifyAggregate({
    ok: failCount === 0,
    totalCount: results.length,
    passCount,
    failCount,
    durationMs: totalMs,
    failures: results.filter((r) => !r.ok).map((r) => ({ toolId: r.toolId, error: r.error })),
    successes: results
      .filter((r) => r.ok)
      .map((r) => ({ toolId: r.toolId, durationMs: r.durationMs })),
  });

  process.exit(failCount === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('[smoke] fatal:', e.message);
  process.exit(2);
});
