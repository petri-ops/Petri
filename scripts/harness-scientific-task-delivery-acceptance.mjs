#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-hrt5-acceptance-'));
const keepWorkspace = process.env.BIOF3_HRT5_KEEP_WORKSPACE === '1';
const visualFixture = process.env.BIOF3_HRT5_VISUAL_FIXTURE === '1';
process.env.BIOF3_DB_PATH = path.join(tempRoot, 'hrt5.db');
process.env.BIOF3_LOCAL_DATA_DIR = path.join(tempRoot, 'local-data');
process.env.BIOF3_LOCAL_RESULTS_DIR = path.join(tempRoot, 'local-results');
const localRHome = path.join(os.homedir(), 'Documents', 'BioF3-Local', 'runtimes', 'R');
if (fs.existsSync(path.join(localRHome, 'bin', 'Rscript'))) process.env.BIOF3_R_HOME = localRHome;

const require = createRequire(import.meta.url);
const db = require('../core/biof3-server/db');
const pluginLoader = require('../core/biof3-server/plugin-loader');
const { tool_run_tool } = require('../core/biof3-server/agent-tools/learning');
const { confirmScientificTask } = require('../core/shared-backend/scientific-task-confirmation');
const { createDeliveryManifest, writeDeliveryManifest } = require('../core/shared-backend/delivery-manifest');
const { resolveProjectRunLayout } = require('../core/shared-backend/project-run-layout');

const cases = [
  {
    id: 'metadata-validation', toolId: 'sample-metadata-validator',
    params: { counts: 'resources/built-in-plugins/sample-metadata-validator/demo-data/demo-counts.csv', metadata: 'resources/built-in-plugins/sample-metadata-validator/demo-data/demo-metadata.csv', sample_column: 'sample', design_column: 'condition', reference_group: 'WT', treatment_group: 'KO', min_replicates: 2 },
    deliverables: ['validated_metadata', 'sample_alignment', 'design_summary', 'report'],
  },
  {
    id: 'expression-qc', toolId: 'expression-qc',
    params: { counts: 'resources/built-in-plugins/expression-qc/demo-data/demo-counts.csv', metadata: 'resources/built-in-plugins/expression-qc/demo-data/demo-metadata.csv', min_count: 10, min_samples: 2, transformation: 'none' },
    deliverables: ['qc_summary', 'sample_library_size', 'pca', 'validated_counts', 'report'],
  },
  {
    id: 'deg-standardization', toolId: 'deg-standardizer',
    params: { deg_results: 'resources/built-in-plugins/deg-standardizer/demo-data/demo-deg-results.csv', gene_col: 'gene', effect_col: 'log2FoldChange', pval_col: 'pvalue', padj_col: 'padj', padj_threshold: 0.05, effect_threshold: 1, source_method: 'DESeq2' },
    deliverables: ['deg_standardized', 'deg_up', 'deg_down', 'ranked_genes', 'filter_summary', 'report'],
  },
];

function hashFile(filePath) { return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex'); }
function fileInputs(params) {
  return Object.entries(params).filter(([, value]) => typeof value === 'string' && fs.existsSync(path.join(repoRoot, value))).map(([role, relativePath]) => {
    const absolute = path.join(repoRoot, relativePath);
    return { role, relativePath, sha256: hashFile(absolute), sizeBytes: fs.statSync(absolute).size };
  });
}

async function main() {
  const project = db.createProject({ name: 'HRT-5 acceptance', modality: 'bulk', workspacePath: path.join(tempRoot, 'project') });
  db.setProjectUserId(project.id, 'acceptance-user');
  const discovery = pluginLoader.loadPluginsFromSources({ builtInDir: path.join(repoRoot, 'resources', 'built-in-plugins') });
  if (!discovery.ok) throw new Error('plugin_discovery_failed');
  const results = [];
  for (const item of cases) {
    const absoluteParams = Object.fromEntries(Object.entries(item.params).map(([key, value]) => [key, typeof value === 'string' && fs.existsSync(path.join(repoRoot, value)) ? path.join(repoRoot, value) : value]));
    const taskSpec = {
      schemaVersion: 1,
      taskId: `hrt5_${item.id}`,
      projectId: project.id,
      conversationId: 'hrt5_acceptance_conversation',
      originalRequest: `HRT-5 acceptance: ${item.id}`,
      question: { domain: 'bulk RNA-seq', analysisUnit: 'sample/gene', questionType: item.id },
      inputs: fileInputs(item.params),
      design: { groups: ['WT', 'KO'], contrast: { reference: 'WT', treatment: 'KO' } },
      method: { category: 'bulk RNA-seq' },
      requestedDeliverables: item.deliverables,
      execution: { accessMode: 'full', automationMode: 'confirm' },
      status: 'ready_for_confirmation',
    };
    const plan = { status: 'ready_for_confirmation', recommendation: { toolId: item.toolId } };
    const inputHashes = Object.fromEntries(taskSpec.inputs.map((input) => [input.relativePath, input.sha256]));
    const confirmed = confirmScientificTask({ taskSpec, plan, confirmation: { userId: 'acceptance-user', inputHashes, method: 'bulk RNA-seq', params: absoluteParams, requestedDeliverables: item.deliverables, riskAcknowledged: true } });
    if (!confirmed.ok) throw new Error(`${item.id}: confirmation_failed`);
    db.saveScientificTaskSpec({ spec: confirmed.spec, specHash: confirmed.taskSpecHash, confirmation: confirmed.confirmation });
    const run = await tool_run_tool({ op: 'run', toolId: item.toolId, params: absoluteParams, scientificTaskRef: { taskId: confirmed.spec.taskId, version: 1 } }, { userId: 'acceptance-user', projectId: project.id });
    if (!run.ok || !run.toolJobId) throw new Error(`${item.id}: run_failed: ${run.message || run.error}`);
    const task = db.getScientificTaskSpec(confirmed.spec.taskId, 1);
    const job = db.getToolJob(run.toolJobId);
    const layout = resolveProjectRunLayout({ projectId: project.id, toolJobId: job.id, db, userId: 'acceptance-user', ensureDirs: true });
    const delivery = createDeliveryManifest({ taskRecord: task, job, projectRoot: layout.workspaceRoot, findings: { limitations: ['脱敏 demo fixture，仅验证工程交付链，不形成真实生物学结论。'] } });
    const written = writeDeliveryManifest({ manifest: delivery, outputPath: path.join(layout.outputDir, 'delivery-manifest.json'), projectRoot: layout.workspaceRoot });
    const currentResult = JSON.parse(job.result_json || '{}');
    db.updateToolJob(job.id, {
      resultJson: { ...currentResult, deliveryManifest: delivery, deliveryManifestRef: written },
    });
    results.push({ id: item.id, toolId: item.toolId, toolJobId: job.id, jobStatus: job.status, artifactTruth: JSON.parse(job.result_json).artifactTruth?.status || null, artifactCount: delivery.artifacts.length, deliveryStatus: delivery.status, deliveryManifestHash: delivery.manifestHash, deliveryRelativePath: written.relativePath, reproducibility: delivery.artifacts.map((artifact) => artifact.reproducibility.status) });
  }
  const report = { schemaVersion: 1, privacy: 'repository_demo_data_only', generatedAt: new Date().toISOString(), pluginDiscovery: discovery.summary, cases: results, passed: results.every((item) => item.jobStatus === 'completed' && item.artifactTruth === 'valid' && item.deliveryStatus === 'valid') };
  const target = path.join(repoRoot, 'acceptance', 'harness-scientific-task', 'hrt5-delivery-acceptance.json');
  fs.writeFileSync(target, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (visualFixture && report.passed) {
    const visualStates = [
      {
        status: 'valid',
        conclusion: '结果、产物和复现证据均通过交付校验。',
        cautions: [],
      },
      {
        status: 'degraded',
        conclusion: '已有可审阅结果，但有一个解释项需要人工复核。',
        cautions: ['PCA 分组趋势需要结合批次信息复核。'],
      },
      {
        status: 'blocked',
        conclusion: '结果未通过交付校验，不能作为完成结果交付。',
        cautions: ['示例阻断：缺少经确认的比较组定义。'],
      },
    ];
    results.forEach((item, index) => {
      const job = db.getToolJob(item.toolJobId);
      const result = JSON.parse(job.result_json || '{}');
      const state = visualStates[index];
      db.updateToolJob(job.id, {
        resultJson: {
          ...result,
          deliveryManifest: {
            ...result.deliveryManifest,
            status: state.status,
            summary: {
              ...(result.deliveryManifest?.summary || {}),
              conclusion: state.conclusion,
              cautions: state.cautions,
            },
          },
        },
      });
    });
    console.log(JSON.stringify({
      visualFixture: true,
      tempRoot,
      dbPath: process.env.BIOF3_DB_PATH,
      projectId: project.id,
      jobs: results.map((item, index) => ({
        id: item.toolJobId,
        status: visualStates[index].status,
      })),
    }, null, 2));
  }
  if (!report.passed) process.exitCode = 1;
}

try {
  await main();
} finally {
  if (!keepWorkspace) fs.rmSync(tempRoot, { recursive: true, force: true });
}
