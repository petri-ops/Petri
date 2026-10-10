'use strict';

/**
 * BLOCK-146 B 轨（审视发现 #7）契约测试——HK-01 红绿先行。
 *
 * 域校验主路径化：validateDomainUploads（小数 counts/重复基因名/样本级规则，
 * 单源=helpers/upload-domain-validation.js）此前只在 HTTP multipart 直跑路径
 * （tools-executor.js handleToolRun）调用；agent run_tool（MCP/会话）与
 * UI 表单链（AnalysisLaunchPanel 组装 prompt → 会话 → run_tool →
 * _runPluginScript）不触发——小数 counts 被脚本静默 round 后出假成功。
 *
 * 本契约：_runPluginScript 的 file 输入暂存段（1b）对暂存进 jobDir 的
 * file 型输入执行同源域校验（复用单源模块，规则体零复制）；findings 非空 →
 * 中文 fail-closed（带文件名+规则名），tool_jobs failed + 不派生脚本进程；
 * 合法数据/非域语义文件零影响；HTTP multipart 既有路径行为不变（对照钉住）。
 *
 * 触发识别（取舍留痕）：输入无域语义标注机制（tool-definition 无 profile
 * 字段，已核 pack 仓全部 tool-definition.json），按在册插件输入白名单起版
 * ——暂存名=<input_id><ext>，由单源模块的文件名约定（counts、coldata、
 * metadata 前缀）识别域文件；deseq2 在册输入 ids=counts/coldata 均命中。
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

const PLUGIN_DESEQ2LIKE = 'block146dom'; // deseq2 型：counts + coldata 语义 file 输入
const PLUGIN_DEGLIKE = 'block146deg'; // 对照：deg_table 输入（非域语义命名）

// ── 共享 harness（形态与 test/block146-bundle-failfast-required-input.test.mjs
// 同构——A 轨同批建立的 _runPluginScript agent 路径测试装置）──
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-block146b-'));
process.env.PETRI_DB_PATH = path.join(tempDir, 'petri.db');
process.env.PETRI_LOCAL_DATA_DIR = path.join(tempDir, 'local-data');
const { runMigrations } = require('../src/migration-runner');
await runMigrations(process.env.PETRI_DB_PATH, path.join(ROOT, 'src', 'migrations'));
const dbMod = require('../core/petri-server/db.js');
const db = dbMod.getAsyncDatabase();

function makePlugin(id, toolDefinition, scriptExt, scriptLines) {
  const pluginDir = path.join(tempDir, 'plugins', id);
  fs.mkdirSync(path.join(pluginDir, 'scripts'), { recursive: true });
  fs.writeFileSync(
    path.join(pluginDir, 'plugin.json'),
    JSON.stringify({ id, name: id, version: '0.0.1', language: 'python' }),
  );
  fs.writeFileSync(path.join(pluginDir, 'tool-definition.json'), JSON.stringify(toolDefinition));
  const scriptPath = path.join(pluginDir, 'scripts', id + scriptExt);
  fs.writeFileSync(scriptPath, scriptLines.join('\n') + '\n');
  return { pluginDir, scriptPath };
}

// 脚本以 JS 内容落地（执行器钉 node 自身，扩展名不影响执行）：写 started 标记
// 后正常退出——若 #7 缺失，坏 counts 作业会走到 completed（红：假成功）。
const RUN_SCRIPT = [
  "const fs = require('fs');",
  "const path = require('path');",
  "const jobDir = process.argv[2];",
  "try { fs.mkdirSync(path.join(jobDir, 'output'), { recursive: true }); } catch {}",
  "fs.writeFileSync(path.join(jobDir, 'output', 'started.marker'), 'ran');",
  '',
];

const deseq2LikePlugin = makePlugin(
  PLUGIN_DESEQ2LIKE,
  {
    id: PLUGIN_DESEQ2LIKE,
    name: PLUGIN_DESEQ2LIKE,
    version: '0.0.1',
    language: 'python',
    inputs: [
      { id: 'counts', type: 'file', required: true, label: 'counts 矩阵' },
      { id: 'coldata', type: 'file', required: true, label: '样本信息表' },
    ],
    outputs: [],
  },
  '.py',
  RUN_SCRIPT,
);
const degLikePlugin = makePlugin(
  PLUGIN_DEGLIKE,
  {
    id: PLUGIN_DEGLIKE,
    name: PLUGIN_DEGLIKE,
    version: '0.0.1',
    language: 'python',
    inputs: [{ id: 'deg_table', type: 'file', required: true, label: '差异表' }],
    outputs: [],
  },
  '.py',
  RUN_SCRIPT,
);

globalThis._petriPlugins = new Map();
for (const [id, meta] of [
  [PLUGIN_DESEQ2LIKE, deseq2LikePlugin],
  [PLUGIN_DEGLIKE, degLikePlugin],
]) {
  globalThis._petriPlugins.set(id, {
    id,
    pluginDir: meta.pluginDir,
    language: 'python',
    // plugin-loader 契约：scriptPath = scripts 目录（getScriptForTool /
    // computePluginFingerprint 都按目录消费）；脚本文件路径单独放 scriptFile。
    scriptPath: path.dirname(meta.scriptPath),
    scriptFile: meta.scriptPath,
  });
}

// 执行器注册表钉 node 自身：binPath 存在 → runtime preflight 通过（BLOCK-66 门）。
const executorsMod = require('../core/shared-backend/executors');
executorsMod.getExecutor = (lang) => ({
  name: lang,
  binPath: process.execPath,
  buildSpawnCommand: (script, jobDir) => ({ cmd: process.execPath, args: [script, jobDir] }),
  checkPackageInstalled: () => ({ checked: true, missing: [] }),
  getRuntimeVersion: () => 'block146b-test-node',
});

const agentSeams = () => ({
  resolveJobLayout: ({ toolJobId }) => {
    const jobDir = path.join(tempDir, 'tool-jobs', toolJobId);
    fs.mkdirSync(path.join(jobDir, 'output'), { recursive: true });
    return { jobDir, outputDir: path.join(jobDir, 'output') };
  },
  createMcpExecutionContext: () => ({ context: {}, canonicalizePath: (p) => p }),
  runPluginToolRemote: async () => { throw new Error('remote seam must not be used'); },
});

function writeInput(name, content) {
  const filePath = path.join(tempDir, 'inputs', name);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return filePath;
}

async function runAgent(pluginId, args, userId) {
  const { _runPluginScript } = require('../core/petri-server/mcp/registry/run-plugin-script.js');
  const meta = globalThis._petriPlugins.get(pluginId);
  const result = await _runPluginScript(
    dbMod, null, meta, meta.scriptFile, args, userId,
    null, null, null, null, agentSeams(),
  );
  const row = result.toolJobId
    ? await db.prepare('SELECT status, error FROM tool_jobs WHERE id = ?').get(result.toolJobId)
    : null;
  return { result, row };
}

function assertNoProcessSpawned(toolJobId) {
  const marker = path.join(tempDir, 'tool-jobs', toolJobId, 'output', 'started.marker');
  assert.equal(fs.existsSync(marker), false, '域校验失败时不得派生脚本进程');
}

// ── #7 主契约：agent 路径小数 counts → 中文 fail-closed ──────────────────────

test('#7 agent 路径：小数/负数 counts + 重复基因名 → 中文 fail-closed（规则名+文件名入文案，不派生进程）', async () => {
  const countsPath = writeInput(
    'counts.csv',
    'gene,WT_1,WT_2\nGene_A,100.5,110\nGene_A,50,55\nGene_B,-3,2.5\n',
  );
  const coldataPath = writeInput(
    'coldata.csv',
    'sample,condition\nWT_1,WT\nWT_2,KO\n',
  );
  const { result, row } = await runAgent(
    PLUGIN_DESEQ2LIKE,
    { counts: countsPath, coldata: coldataPath },
    'b7decimal',
  );

  assert.equal(result.isError, true,
    '小数 counts 在 agent 主执行链必须 fail-closed（当前被静默 round 后假成功——审视发现 #7）');
  const text = result.content && result.content[0] && result.content[0].text || '';
  assert.ok(text.includes('counts_non_negative_integer'), '文案携带规则名 counts_non_negative_integer');
  assert.ok(text.includes('feature_ids_unique'), '文案携带规则名 feature_ids_unique');
  assert.ok(text.includes('counts.csv'), '文案携带文件名 counts.csv');
  assert.ok(text.includes('非负整数'), '文案为中文可操作形态（UI-457 同源消息体）');
  assert.ok(text.includes('Gene_A'), '文案点名重复基因');
  assert.equal(row.status, 'failed', 'tool_jobs 落 failed');
  assert.ok(String(row.error || '').includes('counts_non_negative_integer'), 'tool_jobs.error 携带规则名');
  assertNoProcessSpawned(result.toolJobId);
});

test('#7 agent 路径：样本级规则（coldata 样本与矩阵不对齐）→ 中文 fail-closed', async () => {
  const countsPath = writeInput(
    'counts.csv',
    'gene,WT_1,WT_2\nGene_A,100,110\n',
  );
  const coldataPath = writeInput(
    'coldata.csv',
    'sample,condition\nWT_1,WT\nKO_9,KO\n',
  );
  const { result, row } = await runAgent(
    PLUGIN_DESEQ2LIKE,
    { counts: countsPath, coldata: coldataPath },
    'b7overlap',
  );

  assert.equal(result.isError, true, '样本不对齐必须 fail-closed');
  const text = result.content && result.content[0] && result.content[0].text || '';
  assert.ok(text.includes('sample_overlap_required'), '文案携带规则名 sample_overlap_required');
  assert.ok(text.includes('coldata.csv'), '文案携带文件名 coldata.csv');
  assert.ok(text.includes('KO_9'), '文案点名未对齐样本');
  assert.equal(row.status, 'failed', 'tool_jobs 落 failed');
  assertNoProcessSpawned(result.toolJobId);
});

// ── 对照：合法/非域语义输入零影响 ────────────────────────────────────────────

test('#7 对照：合法整数 counts + 对齐 coldata → completed（主链零影响）', async () => {
  const countsPath = writeInput(
    'counts.csv',
    'gene,WT_1,WT_2\nGene_A,100,110\nGene_B,50,55\n',
  );
  const coldataPath = writeInput(
    'coldata.csv',
    'sample,condition\nWT_1,WT\nWT_2,KO\n',
  );
  const { result, row } = await runAgent(
    PLUGIN_DESEQ2LIKE,
    { counts: countsPath, coldata: coldataPath },
    'b7valid',
  );
  assert.equal(result.isError, false, '合法数据不得被误拒');
  assert.equal(row.status, 'completed', '合法数据照常 completed');
});

test('#7 对照：非域语义文件输入（deg_table，含小数）不做域校验照常执行（不虚构 findings）', async () => {
  const degPath = writeInput(
    'deg.csv',
    'gene,log2FC,padj\nX,2.5,1e-8\n',
  );
  const { result, row } = await runAgent(
    PLUGIN_DEGLIKE,
    { deg_table: degPath },
    'b7deg',
  );
  assert.equal(result.isError, false, '非域语义命名输入不做域校验');
  assert.equal(row.status, 'completed', 'deg 型输入照常 completed');
});

// ── HTTP multipart 既有路径行为不变（B 轨只加不改）──────────────────────────

test('#7 HTTP 对照：坏 counts multipart 直跑仍 400 domain_validation_failed（既有行为不变）', async () => {
  const { createToolsExecutor } = require('../core/petri-server/helpers/tools-executor.js');
  const jobsDir = path.join(tempDir, 'tool-jobs-http');
  fs.mkdirSync(jobsDir, { recursive: true });
  const scriptsDir = path.join(tempDir, 'tool-scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });
  const executor = createToolsExecutor({
    db,
    dbMod,
    config: {
      localResultsDir: tempDir,
      mkdirSandbox: (p) => fs.mkdirSync(p, { recursive: true }),
    },
    notify: { toolJobFailed() {}, toolJobCompleted() {} },
    jobsDir,
    scriptsDir,
    publicDemoJobIds: new Set(),
    safeJoinUnder: (root, p) => path.join(root, p),
    getUserId: () => 'block146b-user',
    isSmokeTestRequest: () => true,
  });

  const badCounts = Buffer.from('gene,WT_1,WT_2\nGene_A,100.5,110\n', 'utf8').toString('base64');
  const res = {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.body = obj; return this; },
  };
  await executor.handleToolRun(
    {
      body: { toolId: PLUGIN_DESEQ2LIKE, files: { 'counts.csv': badCounts }, params: {} },
      headers: {},
      isInternal: false,
      requestId: 'block146b-http',
    },
    res,
  );
  assert.equal(res.statusCode, 400, 'HTTP multipart 路径保持 400 fail-closed');
  assert.equal(res.body && res.body.error, 'domain_validation_failed', '错误码不变');
  const message = String((res.body && res.body.message) || '');
  assert.ok(message.includes('非负整数'), '消息仍为中文可操作形态');
  assert.ok(Array.isArray(res.body.findings) && res.body.findings.length > 0, 'findings[] 结构不变');
});
