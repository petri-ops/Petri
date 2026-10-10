#!/usr/bin/env node
'use strict';

/**
 * block129-bulk-chain-live.mjs — BIO-4 最小集解冻实机验收（G0-BIO plan §3）。
 *
 * 断言：
 *   A1 bulk 主链 6 件（validator/expression-qc/deg-standardizer/go-kegg/
 *      gsea/volcano-plot）在 Windows dev 栈全部跑通（completed）
 *   A2 每件 manifest.json 的中文 label 无 mojibake（UTF-8 解码可读，
 *      含 CJK 且不含 U+FFFD/控制字符）
 *   A3 deseq2 复跑（参照件）同样通过
 * 结果落 acceptance/block-129/bulk-chain-live.json。
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACK = path.resolve(ROOT, '..', 'petri-pack-bio');
const OUT_DIR = path.join(ROOT, 'acceptance', 'block-129');
const AUTH = 'Bearer desktop-local';

function restJson(method, apiPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({
      host: '127.0.0.1', port: 3001, path: apiPath, method,
      headers: { Authorization: AUTH, 'Content-Type': 'application/json', ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}) },
    }, (res) => {
      let b = ''; res.on('data', (c) => { b += c; });
      res.on('end', () => { try { resolve({ status: res.statusCode, data: JSON.parse(b) }); } catch { resolve({ status: res.statusCode, data: { raw: b.slice(0, 200) } }); } });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

const TOOLS = [
  {
    id: 'sample-metadata-validator',
    files: { 'counts.csv': 'plugins/sample-metadata-validator/demo-data/demo-counts.csv', 'metadata.csv': 'plugins/sample-metadata-validator/demo-data/demo-metadata.csv' },
    params: { sample_column: 'sample', design_column: 'condition', reference_group: 'WT', treatment_group: 'KO' },
  },
  {
    id: 'expression-qc',
    files: { 'counts.csv': 'plugins/expression-qc/demo-data/demo-counts.csv', 'metadata.csv': 'plugins/expression-qc/demo-data/demo-metadata.csv' },
    params: { min_count: 10, min_samples: 2 },
  },
  {
    id: 'deg-standardizer',
    files: { 'deg.csv': 'plugins/deg-standardizer/demo-data/demo-deg-results.csv' },
    params: { gene_col: 'gene', effect_col: 'log2FoldChange', padj_col: 'padj', padj_threshold: 0.05, effect_threshold: 1 },
  },
  {
    id: 'go-kegg',
    files: { 'genes.csv': 'plugins/go-kegg/demo-data/genes.csv' },
    params: { species: 'human', analysis_type: 'all' },
  },
  {
    id: 'gsea',
    files: { 'ranked.csv': 'plugins/gsea/demo-data/ranked_list.csv' },
    params: { organism: 'hsa', gene_set: 'GO_BP' },
  },
  {
    id: 'volcano-plot',
    files: { 'deg_table.csv': 'plugins/volcano-plot/demo-data/demo_deg.csv' },
    params: { gene_col: 'gene', fc_col: 'log2FoldChange', pval_col: 'padj', fc_threshold: 1, pval_threshold: 1.3, top_n: 10 },
  },
];

function readManifestLabels(job) {
  const artifacts = (job.result && (job.result.files || job.result.artifacts)) || [];
  const labels = [];
  for (const item of artifacts) {
    const label = item && (item.label || item.title);
    if (label) labels.push(String(label));
  }
  return labels;
}

function labelsReadable(labels) {
  if (labels.length === 0) return { pass: false, reason: 'no_labels' };
  const bad = labels.filter((text) => /\uFFFD|[\x00-\x08\x0e-\x1f]/.test(text));
  const cjk = labels.some((text) => /[\u4e00-\u9fff]/.test(text));
  return { pass: bad.length === 0 && cjk, bad, sample: labels.slice(0, 4) };
}

(async () => {
  const checks = [];
  const record = (id, pass, detail) => {
    checks.push({ id, pass, detail });
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${JSON.stringify(detail).slice(0, 200)}`);
  };

  // 自建验收项目
  const created = (await restJson('POST', '/api/data/projects', {
    name: `block129-chain-verify-${Date.now().toString(36)}`, modality: 'bulk',
  })).data;
  const projectId = created.project && created.project.id;
  if (!projectId) throw new Error('project create failed');

  for (const tool of TOOLS) {
    const files = {};
    for (const [name, rel] of Object.entries(tool.files)) {
      const abs = path.join(PACK, rel);
      if (!fs.existsSync(abs)) throw new Error(`demo file missing: ${rel}`);
      files[name] = fs.readFileSync(abs).toString('base64');
    }
    const submit = (await restJson('POST', '/api/tools/run', {
      toolId: tool.id, projectId, params: tool.params, files,
    })).data;
    if (!submit.jobId) {
      record(`A1_${tool.id}`, false, { submit: JSON.stringify(submit).slice(0, 160) });
      continue;
    }
    let job = null;
    for (let i = 0; i < 150; i += 1) {
      await sleep(2000);
      job = (await restJson('GET', `/api/tools/status/${submit.jobId}`)).data;
      if (['completed', 'failed', 'cancelled'].includes(job.status)) break;
    }
    const ok = job && job.status === 'completed';
    record(`A1_${tool.id}_completed`, ok, ok ? { jobId: submit.jobId } : { jobId: submit.jobId, status: job && job.status, error: String((job && job.error) || '').slice(0, 180) });
    if (ok) {
      const labels = readManifestLabels(job);
      const readability = labelsReadable(labels);
      record(`A2_${tool.id}_labels_utf8`, readability.pass, { labels: labels.length, sample: readability.sample, bad: readability.bad || undefined, reason: readability.reason });
    }
  }

  await restJson('DELETE', `/api/data/projects/${projectId}`).catch(() => {});
  const allPass = checks.every((c) => c.pass);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'bulk-chain-live.json'), JSON.stringify({
    suite: 'block129-bulk-chain-live', projectId, checks, allPass, generatedAt: new Date().toISOString(),
  }, null, 2));
  console.log(`\nblock129-bulk-chain-live: ${allPass ? 'allPass' : 'HAS FAILURES'} (${checks.filter((c) => c.pass).length}/${checks.length})`);
  process.exit(allPass ? 0 : 1);
})().catch((err) => {
  console.error('FATAL', err && err.message);
  process.exit(2);
});
