#!/usr/bin/env node
'use strict';

/**
 * BLOCK-57 P3 — 跨机复现对账实证：同一分析（sample-metadata-validator，同输入
 * 同参数）分别在 dell（远程）与本机执行，逐文件 sha256 比对，产出一致性声明。
 * 环境差异（R 版本/OS）如实记录不掩盖；report.html 等含时间戳产物允许差异并
 * 单列呈现。
 * 证据：acceptance/block-57/p3-replay-compare.json
 */
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');
const DEV_DB = path.join(ROOT, '.petri-dev-user-data', 'data', 'petri.db');
process.env.PETRI_DB_PATH = DEV_DB;
process.env.PETRI_LOCAL_DATA_DIR = path.join(ROOT, '.petri-dev-user-data', 'data');
process.env.PETRI_BETTER_SQLITE3_ROOT = path.join(ROOT, 'core', 'petri-server', 'node_modules');

const learning = require(ROOT + '/core/petri-server/agent-tools/learning');
const Database = require(ROOT + '/core/petri-server/node_modules/better-sqlite3');

const PROJECT_ID = 'p_mtlnsv0f_xpjb';
const CONV_ID = 'conv_05dc94bc-561';
const PROJECT_DIR = path.join(ROOT, '.petri-dev-user-data', 'data', 'projects', 'block52-p3-09031507-mtlnsv0f');
const INPUTS = {
  counts: path.join(PROJECT_DIR, 'inputs', 'counts.csv'),
  metadata: path.join(PROJECT_DIR, 'inputs', 'coldata.csv'),
};
const PARAMS = {
  counts: INPUTS.counts,
  metadata: INPUTS.metadata,
  reference_group: 'Control',
  treatment_group: 'Treatment',
  min_replicates: 2,
};

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

const BUNDLE_FILES = new Set([
  'run-script.R', 'run-script.py', 'params.json', '_petri-theme.R',
  'report-template.html', 'state.json', 'exit.json', 'transfer-manifest.json',
  'provenance.json', 'remote-runner.log',
]);

function dirArtifactHashes(dir) {
  // 产物采集 = jobDir 根目录（排除 bundle 与运行时文件）∪ output/。
  // 本地跑产物在根（插件约定）；dell 跑经 agent 归拢后在 output/。
  const hashes = {};
  for (const f of fs.readdirSync(dir)) {
    if (BUNDLE_FILES.has(f)) continue;
    const p = path.join(dir, f);
    if (fs.statSync(p).isFile()) hashes[f] = sha256(p);
  }
  const outDir = path.join(dir, 'output');
  if (fs.existsSync(outDir)) {
    for (const f of fs.readdirSync(outDir)) {
      const p = path.join(outDir, f);
      if (fs.statSync(p).isFile()) hashes[f] = sha256(p);
    }
  }
  return hashes;
}

function provenanceExecutionTarget(jobDir) {
  try {
    const p = JSON.parse(fs.readFileSync(path.join(jobDir, 'provenance.json'), 'utf8'));
    return p.executionTarget || null;
  } catch {
    return null;
  }
}

async function runOnce(label, executionTargetId, db) {
  const ctx = {
    userId: 'local-user',
    projectId: PROJECT_ID,
    conversationId: CONV_ID,
    accessMode: 'full',
    allowExecution: true,
    ...(executionTargetId ? { executionTargetId } : {}),
  };
  const args = { op: 'run', toolId: 'sample-metadata-validator', params: { ...PARAMS } };
  const result = await learning.tool_run_tool(args, ctx);
  if (!result.ok && !result.toolJobId) throw new Error(`${label}: ${result.message || result.error}`);
  const jobId = result.toolJobId;
  const deadline = Date.now() + 180000;
  let row = null;
  while (Date.now() < deadline) {
    row = db.prepare('SELECT id, status, execution_target_id FROM tool_jobs WHERE id=?').get(jobId);
    if (row && !['pending', 'running'].includes(row.status)) break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (!row || !['completed', 'failed'].includes(row.status)) throw new Error(`${label}: job not terminal: ${JSON.stringify(row)}`);
  // 作业目录随项目 workspace：<workspace_path>/results/jobs/<jobId>
  const proj = new Database(DEV_DB, { readonly: true }).prepare('SELECT workspace_path FROM projects WHERE id=?').get(PROJECT_ID);
  const jobDir = path.join(proj.workspace_path, 'results', 'jobs', jobId);
  if (!fs.existsSync(jobDir)) throw new Error(`${label}: jobDir not found at ${jobDir}`);
  return {
    label,
    jobId,
    status: row.status,
    executionTargetId: row.execution_target_id || null,
    jobDir,
    hashes: dirArtifactHashes(jobDir),
    executionTarget: provenanceExecutionTarget(jobDir),
  };
}

(async () => {
  console.log('[p3] 运行 A：dell 远程执行...');
  const A = await runOnce('dell', (new Database(DEV_DB, { readonly: true })).prepare("SELECT id FROM execution_targets WHERE alias='dell'").get().id, new Database(DEV_DB, { readonly: true }));
  console.log(`[p3] A: ${A.jobId} ${A.status}`);

  console.log('[p3] 运行 B：本机执行...');
  const B = await runOnce('local', null, new Database(DEV_DB, { readonly: true }));
  console.log(`[p3] B: ${B.jobId} ${B.status}`);

  if (A.status !== 'completed' || B.status !== 'completed') {
    throw new Error(`存在非 completed 作业：A=${A.status} B=${B.status}`);
  }

  const files = Array.from(new Set([...Object.keys(A.hashes), ...Object.keys(B.hashes)])).sort();
  const compare = files.map((f) => ({
    file: f,
    inDell: f in A.hashes,
    inLocal: f in B.hashes,
    match: A.hashes[f] === B.hashes[f],
    dellSha256: A.hashes[f] || null,
    localSha256: B.hashes[f] || null,
  }));
  const dataArtifacts = compare.filter((c) => /\.(csv|json)$/i.test(c.file));
  compare.filter((c) => /\.(html|png|svg)$/i.test(c.file));
  const dataMatch = dataArtifacts.length > 0 && dataArtifacts.every((c) => c.match && c.inDell && c.inLocal);

  const evidence = {
    block: 'BLOCK-57',
    part: 'P3 跨机复现对账',
    at: new Date().toISOString(),
    runs: {
      dell: { jobId: A.jobId, status: A.status, executionTarget: A.executionTarget },
      local: { jobId: B.jobId, status: B.status, executionTarget: B.executionTarget },
    },
    environmentDiff: {
      dell: {
        os: A.executionTarget && A.executionTarget.nodeOs,
        hostname: A.executionTarget && A.executionTarget.hostname,
        rVersion: A.executionTarget && A.executionTarget.runtime && A.executionTarget.runtime.version,
        packagesCount: A.executionTarget && A.executionTarget.environment && A.executionTarget.environment.packagesCount,
        packagesSha256: A.executionTarget && A.executionTarget.environment && A.executionTarget.environment.packagesSha256,
      },
      local: {
        rVersion: B.executionTarget && B.executionTarget.runtime && B.executionTarget.runtime.version,
        note: '本机（macOS，Petri 内嵌 R）',
      },
    },
    perFile: compare,
    dataArtifactsMatch: dataMatch,
    presentationalNote: 'report.html 含生成时间戳，跨环境字节差异属预期，如实单列',
  };
  fs.writeFileSync(path.join(ROOT, 'acceptance', 'block-57', 'p3-replay-compare.json'), JSON.stringify(evidence, null, 2));
  for (const c of compare) {
    console.log(`${c.match && c.inDell && c.inLocal ? 'MATCH' : 'DIFF '} ${c.file}`);
  }
  console.log(`\nP3 结论：数据产物对账 ${dataMatch ? '一致' : '存在差异（如实记录）'}；一致性声明已写入 acceptance/block-57/p3-replay-compare.json`);
  process.exit(0);
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
