#!/usr/bin/env node
'use strict';

/**
 * BLOCK-52 P3 setup — 在 dev 运行库中构造一个真实的 volcano-plot Job。
 *
 * 复用 G0-RS-P4R corpus 的确定性路径（run_tool → tool_job → artifact truth），
 * 但不落 disposable root：项目与 Job 直接进入 dev 运行库
 * （PETRI_DB_PATH / PETRI_LOCAL_DATA_DIR 由 dev Electron 注入，继承自当前环境），
 * 供实机 CDP 测试在 ResultView 中引用其结果图。
 *
 * 用法：
 *   node scripts/block52-p3-setup.cjs            # 创建项目 + 跑 volcano-plot
 * 输出（最后一行 JSON）：{ projectId, toolJobId, artifact, ok }
 */

const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');

async function main() {
  const db = require(path.join(REPO_ROOT, 'core/petri-server/db.js'));
  const { getOrCreateActiveConversation } = require(
    path.join(REPO_ROOT, 'core/petri-server/helpers/conversations.js'),
  );
  const { tool_run_tool: runTool } = require(
    path.join(REPO_ROOT, 'core/petri-server/agent-tools/learning.js'),
  );

  const CORPUS_USER = 'local-user';
  const project = db.createProject({
    name: `block52-p3-${new Date().toISOString().slice(5, 16).replace(/[^0-9]/g, '')}`,
    description: 'BLOCK-52 P3 fine-tune closed-loop live corpus',
    modality: 'bulk',
    userId: CORPUS_USER,
  });
  db.setProjectUserId(project.id, CORPUS_USER);
  // UI 的 handleOpenResult 要求 Job 有可信会话归属（conversation_id），
  // 无会话的结果会被拒绝打开（project-workspace.tsx L1484）。
  const conversation = getOrCreateActiveConversation(CORPUS_USER, {
    projectId: project.id,
    titleHint: 'BLOCK-52 P3 live corpus',
    page: 'project-workspace',
  });

  const degTable = path.join(
    REPO_ROOT,
    'resources/built-in-plugins/volcano-plot/demo-data/demo_deg.csv',
  );
  // RS 基线校验器要求输入文件位于项目 workspace 内（external 输入按
  // 「escaped the project」阻断），因此把 demo DEG 表拷进 workspace 再跑。
  const fs = require('fs');
  const degTableInWorkspace = path.join(project.workspace_path, 'inputs', 'demo_deg.csv');
  fs.mkdirSync(path.dirname(degTableInWorkspace), { recursive: true });
  fs.copyFileSync(degTable, degTableInWorkspace);
  const startedAt = Date.now();
  const result = await runTool(
    {
      op: 'run',
      toolId: 'volcano-plot',
      params: {
        deg_table: degTableInWorkspace,
        gene_col: 'gene',
        lfc_col: 'log2FC',
        pval_col: 'padj',
        fc_threshold: 1,
        pval_threshold: 1.3,
        top_n: 10,
      },
    },
    { userId: CORPUS_USER, accessMode: 'full', allowExecution: true, projectId: project.id, conversationId: conversation.id },
  );

  const artifacts = (result && result.result && result.result.artifacts) || [];
  const png = artifacts.find(
    (a) => a && /\.png$/i.test(String(a.path || a.file || a.name || '')),
  );
  const record = {
    ok: Boolean(result && result.ok),
    projectId: project.id,
    conversationId: conversation.id,
    toolJobId: (result && result.toolJobId) || null,
    artifact: png ? path.basename(String(png.path || png.file || png.name)) : null,
    artifactTruth: (result && result.result && result.result.artifactTruth
      && result.result.artifactTruth.status) || null,
    artifactCount: artifacts.length,
    durationMs: Date.now() - startedAt,
    error: result && result.ok ? null : (result && (result.message || result.error)) || 'unknown_failure',
  };
  process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
  if (!record.ok || !record.artifact) process.exitCode = 1;
}

main().catch((error) => {
  console.error('[block52-p3-setup] failed:', error && error.stack || error);
  process.exit(1);
});
