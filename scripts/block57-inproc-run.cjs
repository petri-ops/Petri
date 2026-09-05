#!/usr/bin/env node
'use strict';

/**
 * BLOCK-57 UI-290 收尾（确定性）：进程内直调 run_tool——与模型同一代码路径
 * （learning.tool_run_tool → 会话目标注入 → callTool 远程分支），绕开
 * flash-lite 模型是否配合调工具的抽风问题。作业落真实 dev 库并绑定会话，
 * UI 作业库徽章据此可验。
 */
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
const DEV_DB = path.join(ROOT, '.biof3-dev-user-data', 'data', 'biof3.db');
process.env.BIOF3_DB_PATH = DEV_DB;
process.env.BIOF3_LOCAL_DATA_DIR = path.join(ROOT, '.biof3-dev-user-data', 'data');
process.env.BIOF3_BETTER_SQLITE3_ROOT = path.join(ROOT, 'core', 'biof3-server', 'node_modules');

const learning = require(ROOT + '/core/biof3-server/agent-tools/learning');
const Database = require(ROOT + '/core/biof3-server/node_modules/better-sqlite3');

const PROJECT_ID = 'p_mtlnsv0f_xpjb';
const CONV_ID = 'conv_05dc94bc-561';
const USER_ID = 'local-user';
const PROJECT_DIR = path.join(ROOT, '.biof3-dev-user-data', 'data', 'projects', 'block52-p3-09031507-mtlnsv0f');

async function main() {
  const db = new Database(DEV_DB, { readonly: true });
  const dell = db.prepare("SELECT id, alias FROM execution_targets WHERE alias='dell'").get();
  db.close();
  if (!dell) throw new Error('dell target not in dev DB');
  console.log('[inproc] dell target:', dell.id);

  const ctx = {
    userId: USER_ID,
    projectId: PROJECT_ID,
    conversationId: CONV_ID,
    accessMode: 'full',
    allowExecution: true,
    executionTargetId: dell.id,
  };
  const args = {
    op: 'run',
    toolId: 'sample-metadata-validator',
    params: {
      counts: path.join(PROJECT_DIR, 'inputs', 'counts.csv'),
      metadata: path.join(PROJECT_DIR, 'inputs', 'coldata.csv'),
      reference_group: 'Control',
      treatment_group: 'Treatment',
      min_replicates: 2,
    },
  };

  console.log('[inproc] invoking run_tool (in-process, dell)...');
  const result = await learning.tool_run_tool(args, ctx);
  console.log('[inproc] result:', JSON.stringify({
    ok: result.ok,
    error: result.error || null,
    toolJobId: result.toolJobId || null,
    needApproval: result.needApproval || false,
    automationDecision: result.automationDecision || null,
  }));

  // 轮询作业终态（callTool 远程分支同步执行——返回即已终态，但留缓冲）
  const rdb = new Database(DEV_DB, { readonly: true });
  const deadline = Date.now() + 120000;
  let row = null;
  while (Date.now() < deadline) {
    row = rdb.prepare('SELECT id, status, execution_target_id, substr(error,1,120) AS err FROM tool_jobs ORDER BY created_at DESC LIMIT 1').get();
    if (row && row.execution_target_id === dell.id && !['pending', 'running'].includes(row.status)) break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.log('[inproc] job:', JSON.stringify(row));
  const pass = row && row.execution_target_id === dell.id && row.status === 'completed';
  console.log(`[inproc] ${pass ? 'PASS' : 'FAIL'} — 会话注入 + callTool 远程分支 + completed`);
  process.exit(pass ? 0 : 1);
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
