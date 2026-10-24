#!/usr/bin/env node
/**
 * BLOCK-252 — V-REM 实机腿：UI-544 源码 tab / UI-545 compare tab / UI-546 图形批注。
 *
 * 隔离栈（:3001 后端 + :3000 Vite + :9223 Electron 离屏 + 临时数据根），外加：
 *  · 真实 git 绑定项目 + 合成完成 job/产物/revision/changeset/血缘图（夹具，报告标 synthetic）；
 *  · 数据根里的夹具 pack（只声明 table 结果面，图像仍走核心面以便批注）。
 *
 * 前置：端口 3000/3001/9223 空闲（有人占着 fail-fast，绝不杀未知进程）。
 * 证据：acceptance/ui-544/、acceptance/ui-545/、acceptance/ui-546/ + 同份 acceptance/block-252/。
 */
import { spawn, execFileSync } from 'node:child_process';
import { createConnection } from 'node:net';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BACKEND_PORT = 3001;
const VITE_PORT = 3000;
const CDP_PORT = 9223;
const PACK_ID = 'ui252fixture';
const PROJECT_NAME = 'UI-252 V-REM 探针项目';
const JOB_ID = 'tj_ui252';
const BASE_JOB_ID = 'tj_ui252_base';
const PARENT_JOB_ID = 'tj_ui252_parent';
const TABLE_ARTIFACT = 'deg.csv';
const PLOT_ARTIFACT = 'deg.png';
const CHANGE_SET_ID = 'cs_ui252_candidate';
const REVISION_ID = 'rev_ui252_table_v2';
const SOURCE_MARKER = 'UI544_SOURCE_MARKER';
const FLOW_PATH = path.join(ROOT, '.agents', 'skills', 'petri-dev-infra', 'dev-verify', 'flows', 'ui544-546-pack-annotation-live.cjs');
const EVIDENCE = {
  ui544: path.join(ROOT, 'acceptance', 'ui-544'),
  ui545: path.join(ROOT, 'acceptance', 'ui-545'),
  ui546: path.join(ROOT, 'acceptance', 'ui-546'),
  block: path.join(ROOT, 'acceptance', 'block-252'),
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function portOpen(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
    socket.setTimeout(800, () => { socket.destroy(); resolve(false); });
  });
}

async function waitFor(fn, { timeoutMs, intervalMs = 500, label }) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    try { last = await fn(); } catch { last = null; }
    if (last) return last;
    await sleep(intervalMs);
  }
  throw new Error(`timeout waiting for ${label}: ${String(last).slice(0, 240)}`);
}

function killTree(pid) {
  if (!pid) return;
  try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); return; } catch {}
  try { process.kill(pid, 'SIGTERM'); } catch {}
}

async function waitHttp(url, timeoutMs, label) {
  return waitFor(async () => {
    const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return response.ok ? true : null;
  }, { timeoutMs, label });
}

/** 最小 PNG 编码（无第三方依赖）：真实位图，供结果面图像产物与批注宿主使用。 */
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([length, typeBytes, data, crc]);
}

function makePng(width, height, [red, green, blue]) {
  const zlib = require('node:zlib');
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x += 1) {
    row[1 + x * 3] = red;
    row[2 + x * 3] = green;
    row[3 + x * 3] = blue;
  }
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

const PNG_BYTES = makePng(320, 200, [200, 60, 60]);

function seedWorkspace(workspace) {
  const files = {
    'analysis/scripts/rev_source/artifact.R': `ui252_marker <- "${SOURCE_MARKER}"\nplot(0)\n`,
    'analysis/scripts/rev_source/parameters.json': '{\n  "color": "red"\n}\n',
    'analysis/scripts/rev_candidate/artifact.R': `ui252_marker <- "${SOURCE_MARKER}"\nplot(1)\n`,
    'analysis/scripts/rev_candidate/parameters.json': '{\n  "color": "blue"\n}\n',
    'analysis/snapshot.R': `ui252_marker <- "${SOURCE_MARKER}"\nplot(1)\n`,
    'analysis/snapshot-base.R': `ui252_marker <- "${SOURCE_MARKER}"\nplot(0)\n`,
  };
  fs.mkdirSync(workspace, { recursive: true });
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(workspace, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, 'utf8');
  }
  const outDir = path.join(workspace, 'results', 'jobs', JOB_ID, 'output');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, TABLE_ARTIFACT), 'gene,logfc\nA,1.2\nB,-0.8\nC,0.4\n', 'utf8');
  fs.writeFileSync(path.join(outDir, PLOT_ARTIFACT), PNG_BYTES);
  fs.mkdirSync(path.join(workspace, 'results', 'jobs', PARENT_JOB_ID, 'output'), { recursive: true });
  fs.writeFileSync(path.join(workspace, 'results', 'jobs', PARENT_JOB_ID, 'output', 'parent.csv'), 'gene\nA\n', 'utf8');
  return files;
}

function insertJob(db, { id, name, resultJson, projectId, conversationId }) {
  db.prepare(
    `INSERT OR REPLACE INTO tool_jobs
      (id, user_id, tool_id, params_json, status, created_at, name, completed_at, project_id, conversation_id, result_json)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(id, 'local-user', 'ui252-tool', '{}', 'completed', Date.now(), name, Date.now(), projectId, conversationId || null, JSON.stringify(resultJson));
}

function seedResultChain({ dbPath, workspace, projectId, conversationId }) {
  const {
    bindProjectRepository,
  } = require('../core/shared-backend/git-repository-binding.js');
  const { createResultStudioRepository } = require('../core/shared-backend/result-studio-repository.js');
  const { sha256 } = require('../core/shared-backend/result-changeset-service.js');
  const { workflowGraphDigest } = require('../core/shared-backend/result-workflow-graph.js');

  const candidateScriptPath = 'analysis/scripts/rev_candidate/artifact.R';
  const candidateParamsPath = 'analysis/scripts/rev_candidate/parameters.json';
  const baseScriptPath = candidateScriptPath;
  const baseParamsPath = candidateParamsPath;
  const candidateScript = fs.readFileSync(path.join(workspace, candidateScriptPath), 'utf8');
  const candidateParams = fs.readFileSync(path.join(workspace, candidateParamsPath), 'utf8');
  // 工作树里放的是候选内容；base/root 内容通过 git 虚拟文件提交固定。
  const baseScript = `ui252_marker <- "${SOURCE_MARKER}"\nplot(0)\n`;
  const baseParams = '{\n  "color": "red"\n}\n';
  const rootScript = `ui252_marker <- "${SOURCE_MARKER}"\nplot(-1)\n`;
  const rootParams = '{\n  "color": "grey"\n}\n';
  const snapshotPath = path.join(workspace, 'analysis', 'snapshot.R');

  const tablePath = path.join(workspace, 'results', 'jobs', JOB_ID, 'output', TABLE_ARTIFACT);
  const plotPath = path.join(workspace, 'results', 'jobs', JOB_ID, 'output', PLOT_ARTIFACT);
  const tableHash = sha256(fs.readFileSync(tablePath));
  const plotHash = sha256(fs.readFileSync(plotPath));

  const binding = bindProjectRepository({ workspaceRoot: workspace, projectId });
  if (binding.status !== 'ready' || !binding.adapter) {
    throw new Error(`git_bind_failed: ${binding.status} ${binding.reason || ''}`);
  }
  const adapter = binding.adapter;
  const root = adapter.commitVirtualFiles({
    ref: 'refs/heads/petri/main',
    expectedOld: '0'.repeat(40),
    message: 'UI-252 root',
    files: [
      { path: candidateScriptPath, content: rootScript },
      { path: candidateParamsPath, content: rootParams },
    ],
  });
  const base = adapter.commitVirtualFiles({
    parentCommit: root.commit,
    ref: 'refs/heads/petri/base',
    expectedOld: '0'.repeat(40),
    message: 'UI-252 base',
    files: [
      { path: baseScriptPath, content: baseScript },
      { path: baseParamsPath, content: baseParams },
    ],
  });
  const candidate = adapter.commitVirtualFiles({
    parentCommit: base.commit,
    ref: 'refs/heads/petri/changeset/cs_ui252_candidate',
    expectedOld: '0'.repeat(40),
    message: 'UI-252 candidate',
    files: [
      { path: candidateScriptPath, content: candidateScript },
      { path: candidateParamsPath, content: candidateParams },
    ],
  });

  const db = new Database(dbPath);
  try {
    const result = {
      artifactTruth: { status: 'valid', blocking: false, validCount: 2 },
      tool: { language: 'r' },
      artifacts: [
        {
          id: 'art_ui252_table', name: TABLE_ARTIFACT, filename: TABLE_ARTIFACT,
          path: tablePath, type: 'table',
          validation: { status: 'valid' }, sha256: tableHash,
        },
        {
          id: 'art_ui252_plot', name: PLOT_ARTIFACT, filename: PLOT_ARTIFACT,
          path: plotPath, type: 'plot',
          validation: { status: 'valid' }, sha256: plotHash,
        },
      ].filter(Boolean),
      executionProvenance: {
        toolJobId: JOB_ID,
        projectId,
        script: { snapshotPath, sha256: sha256(candidateScript) },
        artifacts: [
          { id: 'art_ui252_table', sha256: tableHash },
          { id: 'art_ui252_plot', sha256: plotHash },
        ],
        inputs: [],
        plugin: { id: 'ui252-tool', version: '0.0.0', language: 'r' },
        runtime: { name: 'R', version: '4.4.1', readiness: 'ready' },
      },
    };
    insertJob(db, { id: JOB_ID, name: 'UI-252 结果链', projectId, conversationId, resultJson: result });
    // 基版 job 的 provenance 必须与 v1 的 base 脚本同哈希（source 投影逐版校验）。
    insertJob(db, {
      id: BASE_JOB_ID,
      name: 'UI-252 基版',
      projectId,
      conversationId,
      resultJson: {
        ...result,
        executionProvenance: {
          ...result.executionProvenance,
          toolJobId: BASE_JOB_ID,
          script: { snapshotPath: path.join(workspace, 'analysis', 'snapshot-base.R'), sha256: sha256(baseScript) },
        },
      },
    });
    insertJob(db, {
      id: PARENT_JOB_ID,
      name: 'UI-252 上游',
      projectId,
      conversationId,
      resultJson: { artifactTruth: { status: 'valid' }, artifacts: [{ id: 'art_ui252_parent', name: 'parent.csv', path: 'results/jobs/tj_ui252_parent/output/parent.csv', type: 'table' }] },
    });

    const repository = createResultStudioRepository(db, { ensureSchema: false });
    const revisionBase = (kind) => ({
      projectId,
      artifactFamilyId: kind === 'table' ? 'fam_ui252_table' : 'fam_ui252_plot',
      artifactId: kind === 'table' ? 'art_ui252_table' : 'art_ui252_plot',
      toolJobId: BASE_JOB_ID,
      outputPath: kind === 'table' ? `results/jobs/${JOB_ID}/output/${TABLE_ARTIFACT}` : `results/jobs/${JOB_ID}/output/${PLOT_ARTIFACT}`,
      outputHash: kind === 'table' ? tableHash : plotHash,
      validationStatus: 'valid',
      reproducibilityStatus: 'available',
      sourceScriptRef: {
        relativePath: baseScriptPath,
        sha256: sha256(baseScript),
        entryPoint: 'artifact.R',
        artifactId: kind === 'table' ? 'art_ui252_table' : 'art_ui252_plot',
        rendererId: 'plugin:table',
        language: 'r',
        origin: 'project_materialized',
      },
      parametersRef: baseParamsPath,
      parametersHash: sha256(baseParams),
      inputArtifactRefs: [],
    });
    const revisionCandidate = (kind) => ({
      ...revisionBase(kind),
      toolJobId: JOB_ID,
      outputPath: kind === 'table' ? `results/jobs/${JOB_ID}/output/${TABLE_ARTIFACT}` : `results/jobs/${JOB_ID}/output/${PLOT_ARTIFACT}`,
      sourceScriptRef: {
        relativePath: candidateScriptPath,
        sha256: sha256(candidateScript),
        entryPoint: 'artifact.R',
        artifactId: kind === 'table' ? 'art_ui252_table' : 'art_ui252_plot',
        rendererId: 'plugin:table',
        language: 'r',
        origin: 'project_materialized',
      },
      parametersRef: candidateParamsPath,
      parametersHash: sha256(candidateParams),
    });

    repository.createChangeSet({
      changeSetId: 'cs_ui252_base', projectId, baseCommit: root.commit,
      workingBranchRef: 'refs/heads/petri/base', createdBy: 'agent',
    });
    repository.transitionChangeSet({ changeSetId: 'cs_ui252_base', to: 'running' });
    repository.appendRevisionBatch({
      revisions: [
        { ...revisionBase('table'), revisionId: 'rev_ui252_table_v1', parentRevisionIds: [], sourceCommit: base.commit, changeSetId: 'cs_ui252_base' },
        { ...revisionBase('plot'), revisionId: 'rev_ui252_plot_v1', parentRevisionIds: [], sourceCommit: base.commit, changeSetId: 'cs_ui252_base' },
      ],
      transition: {
        changeSetId: 'cs_ui252_base', to: 'preview_ready', candidateCommit: base.commit,
        changedPaths: [
          { relativePath: candidateScriptPath, changeType: 'modified', beforeHash: sha256(rootScript), afterHash: sha256(baseScript) },
          { relativePath: candidateParamsPath, changeType: 'modified', beforeHash: sha256(rootParams), afterHash: sha256(baseParams) },
        ],
        jobRefs: [BASE_JOB_ID], candidateArtifactRefs: ['rev_ui252_table_v1', 'rev_ui252_plot_v1'],
        validationSummary: { artifactTruthStatus: 'valid', formalArtifactCount: 2 },
      },
    });
    repository.adoptChangeSet({ changeSetId: 'cs_ui252_base', candidateCommit: base.commit });

    // 单节点图：artifactIds 必须按字典序（integrity 校验 sorted-unique）。
    const graphNodes = [{
      id: `job:${JOB_ID}`,
      toolJobId: JOB_ID,
      toolId: 'ui252-tool',
      artifactIds: ['art_ui252_plot', 'art_ui252_table'],
      provenanceHash: sha256('ui252_provenance'),
      dependsOn: [],
    }];
    const sourceDigest = workflowGraphDigest({ projectId, rootToolJobId: JOB_ID, nodes: graphNodes, edges: [] });
    const workflowGraph = {
      graphId: `wfg_${sourceDigest.slice(0, 24)}`,
      contractVersion: 1,
      projectId,
      rootToolJobId: JOB_ID,
      sourceDigest,
      nodes: graphNodes,
      edges: [],
      validationStatus: 'valid',
    };
    repository.createChangeSet({
      changeSetId: CHANGE_SET_ID, projectId, baseCommit: base.commit,
      workingBranchRef: 'refs/heads/petri/changeset/cs_ui252_candidate', createdBy: 'agent',
      parentArtifactRefs: ['rev_ui252_table_v1', 'rev_ui252_plot_v1'],
    });
    repository.transitionChangeSet({ changeSetId: CHANGE_SET_ID, to: 'running' });
    repository.appendRevisionBatch({
      revisions: [
        { ...revisionCandidate('table'), revisionId: 'rev_ui252_table_v2', parentRevisionIds: ['rev_ui252_table_v1'], sourceCommit: candidate.commit, changeSetId: CHANGE_SET_ID },
        { ...revisionCandidate('plot'), revisionId: 'rev_ui252_plot_v2', parentRevisionIds: ['rev_ui252_plot_v1'], sourceCommit: candidate.commit, changeSetId: CHANGE_SET_ID },
      ],
      workflowGraph,
      transition: {
        changeSetId: CHANGE_SET_ID, to: 'preview_ready', candidateCommit: candidate.commit,
        changedPaths: [
          { relativePath: candidateScriptPath, changeType: 'added', beforeHash: sha256(baseScript), afterHash: sha256(candidateScript) },
          { relativePath: candidateParamsPath, changeType: 'added', beforeHash: sha256(baseParams), afterHash: sha256(candidateParams) },
        ],
        jobRefs: [JOB_ID], candidateArtifactRefs: ['rev_ui252_table_v2', 'rev_ui252_plot_v2'],
        validationSummary: {
          artifactTruthStatus: 'valid', formalArtifactCount: 2,
          workflowGraph: { graphId: workflowGraph.graphId, sourceDigest },
        },
      },
    });
    repository.adoptChangeSet({ changeSetId: CHANGE_SET_ID, candidateCommit: candidate.commit });
    const current = repository.findRevisionByJobArtifact({ projectId, toolJobId: JOB_ID, artifactId: 'art_ui252_table' });
    if (!current || current.revisionId !== REVISION_ID) {
      throw new Error(`revision_seed_failed: ${current && current.revisionId}`);
    }
  } finally {
    db.close();
  }
}

function writeFixturePack(dataDir) {
  const packRoot = path.join(dataDir, 'ui252-fixture-pack');
  fs.rmSync(packRoot, { recursive: true, force: true });
  fs.mkdirSync(path.join(packRoot, 'ui'), { recursive: true });
  fs.writeFileSync(path.join(packRoot, 'pack.json'), JSON.stringify({
    packId: PACK_ID,
    name: 'UI-252 Fixture Pack',
    version: '0.0.0',
    provides: {
      resultSurfaces: [
        {
          id: 'result',
          title: 'UI-252 结果面',
          entry: 'ui/result.html',
          artifactTypes: ['table'],
          modes: ['result', 'code', 'compare', 'history'],
          tabs: [
            { id: 'revisions-source', label: '源码' },
            { id: 'compare', label: '比较' },
            ],
        },
        {
          // 只读 tab 面也声明 plot：切到 code/compare 时核心 shell 会重选首选产物
          // （图像优先），若不声明 plot 则 pack tab 永远 no_matching_surface；
          // 不声明 result 模式，图像结果仍走核心面以便批注（UI-546）。
          id: 'result-plot',
          title: 'UI-252 图像结果面',
          entry: 'ui/result.html',
          artifactTypes: ['plot'],
          modes: ['code', 'compare', 'history'],
          tabs: [
            { id: 'revisions-source', label: '源码' },
            { id: 'compare', label: '比较' },
            ],
        },
      ],
    },
  }, null, 2), 'utf8');
  fs.writeFileSync(path.join(packRoot, 'ui', 'result.html'), `<!doctype html>
<html><head><meta charset="utf-8"><title>UI-252 fixture result</title>
<style>
body{font:14px/1.5 system-ui;padding:24px;background:#0f172a;color:#e2e8f0}
h1{font-size:18px;margin:0 0 12px}pre{white-space:pre-wrap;background:#111827;padding:12px;border-radius:8px}
table{border-collapse:collapse;width:100%}td,th{border:1px solid #334155;padding:6px 10px;text-align:left}
</style></head>
<body><h1 id="out">UI252_PACK_BOOT</h1>
<script>
function mount(tab, tabData, payload) {
  // 幂等渲染：host 会在 ready/data 变化时多次推 context，旧内容必须被替换而不是追加。
  document.body.innerHTML = '';
  document.body.setAttribute('data-tab', tab || '');
  var out = document.createElement('h1'); out.id = 'out';
  document.body.appendChild(out);
  if (tab === 'revisions-source') {
    out.textContent = 'UI544_SOURCE_READY len=' + String(tabData.text || '').length;
    var pre = document.createElement('pre'); pre.textContent = String(tabData.text || ''); document.body.appendChild(pre);
  } else if (tab === 'compare') {
    out.textContent = 'UI545_COMPARE_READY files=' + ((tabData.files || []).length);
    var table = document.createElement('table');
    var head = document.createElement('tr');
    ['文件', '状态', '新增', '删除'].forEach(function(label){ var th=document.createElement('th'); th.textContent=label; head.appendChild(th); });
    table.appendChild(head);
    (tabData.files || []).forEach(function(file){
      var row = document.createElement('tr');
      [file.path, file.status, file.added == null ? '—' : String(file.added), file.removed == null ? '—' : String(file.removed)].forEach(function(value){
        var cell = document.createElement('td'); cell.textContent = value; row.appendChild(cell);
      });
      table.appendChild(row);
    });
    document.body.appendChild(table);
  } else {
    var artifact = payload.artifact || {};
    out.textContent = 'UI544_RESULT_READY ' + String(artifact.name || '') + ' ' + String((payload.resultData && payload.resultData.status) || '');
  }
}
window.addEventListener('message', function(event){
  var data = event.data || {};
  if (data.type !== 'petri:surface-context') return;
  var payload = data.payload || {};
  mount(payload.tab || '', payload.tabData || {}, payload);
});
try { parent.postMessage({ type: 'petri:ready' }, '*'); } catch (e) {}
</script>
</body></html>`, 'utf8');
  const packRegistry = require('../core/shared-backend/pack-registry.js');
  packRegistry.writeInstalledPacks(dataDir, [{
    packId: PACK_ID,
    packRoot,
    version: '0.0.0',
    requiresRuntimes: [],
    installedAt: new Date().toISOString(),
  }]);
  return packRoot;
}

async function main() {
  const startedAt = new Date().toISOString();
  for (const [port, name] of [[BACKEND_PORT, 'backend'], [VITE_PORT, 'vite'], [CDP_PORT, 'cdp']]) {
    if (await portOpen(port)) throw new Error(`${name} 端口 :${port} 已被占用；请先停止现有 dev/测试实例（本脚本不杀未知进程）`);
  }
  const roundSuffix = process.env.PETRI_B252_DARK === '1' ? 'dark' : 'light';
  for (const dir of Object.values(EVIDENCE)) {
    fs.mkdirSync(dir, { recursive: true });
    // 只清本轮后缀的旧截图/provenance，保留另一轮证据。
    for (const name of fs.readdirSync(dir)) {
      if (name.endsWith(`-${roundSuffix}.png`) || name === `ui544-546-screenshots-${roundSuffix}.json`) {
        fs.rmSync(path.join(dir, name), { force: true });
      }
    }
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-ui252-live-'));
  const dataDir = path.join(tempRoot, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(tempRoot, 'petri.db');
  const userDataDir = path.join(tempRoot, 'electron-user-data');
  fs.mkdirSync(userDataDir, { recursive: true });

  const bootDb = new Database(dbPath);
  const migrationsDir = path.join(ROOT, 'src', 'migrations');
  for (const file of fs.readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort()) {
    bootDb.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
  }
  bootDb.close();

  let backend = null;
  let vite = null;
  let electron = null;
  let workspace = null;
  let flowResult = null;
  const assertions = [];
  const assert = (name, pass, detail = '') => {
    const ok = Boolean(pass);
    assertions.push({ name, pass: ok, detail: String(detail).slice(0, 700) });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name} — ${String(detail).slice(0, 240)}`);
  };

  try {
    backend = spawn(process.execPath, [path.join(ROOT, 'core', 'petri-server', 'server.js')], {
      env: { ...process.env, PETRI_DB_PATH: dbPath, PETRI_LOCAL_DATA_DIR: dataDir, R_SERVER_PORT: String(BACKEND_PORT) },
      stdio: ['ignore', 'pipe', 'pipe'], cwd: ROOT,
    });
    backend.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      if (text.includes('Error')) console.log('  [backend:ERR]', text.slice(0, 200));
    });
    await waitHttp(`http://127.0.0.1:${BACKEND_PORT}/api/health`, 30_000, 'backend health');

    const rest = async (method, endpoint, body) => {
      const response = await fetch(`http://127.0.0.1:${BACKEND_PORT}/api${endpoint}`, {
        method,
        headers: { 'content-type': 'application/json', Authorization: 'Bearer desktop-local' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, data: await response.json().catch(() => null) };
    };

    const project = await rest('POST', '/data/projects', { name: PROJECT_NAME });
    const projectId = project.data?.project?.id;
    assert('E1_project_created', Boolean(projectId), `projectId=${projectId} status=${project.status}`);
    if (!projectId) throw new Error('project_create_failed');
    const detail = await rest('GET', `/data/projects/${projectId}`);
    workspace = detail.data?.project?.workspace_path || null;
    assert('E1b_workspace_resolved', Boolean(workspace), String(workspace));
    if (!workspace) throw new Error('workspace_path_missing');
    seedWorkspace(workspace);
    const conversation = await rest('POST', '/ai/conversations', { title: 'UI-252 结果会话', projectId });
    const conversationId = conversation.data?.conversation?.id || null;
    assert('E1c_conversation_created', Boolean(conversationId), `conversationId=${conversationId} status=${conversation.status}`);
    seedResultChain({ dbPath, workspace, projectId, conversationId });
    const compareSeed = await rest('GET', `/result-studio/changesets/${CHANGE_SET_ID}/compare`);
    const compareFiles = Array.isArray(compareSeed.data?.changeSet?.changedPaths) ? compareSeed.data.changeSet.changedPaths : [];
    assert('E2_result_chain_seeded', compareSeed.status === 200 && compareFiles.length >= 2,
      `job=${JOB_ID} changeSet=${CHANGE_SET_ID} revision=${REVISION_ID} status=${compareSeed.status} files=${compareFiles.length}`);
    const interaction = await rest('GET', `/result-studio/interaction?jobId=${JOB_ID}&artifact=${encodeURIComponent(TABLE_ARTIFACT)}`);
    assert('E2b_interaction_revision_projection',
      interaction.status === 200 && interaction.data?.revision?.revisionId === REVISION_ID,
      `status=${interaction.status} revision=${interaction.data?.revision?.revisionId} family=${interaction.data?.revision?.artifactFamilyId} body=${JSON.stringify(interaction.data).slice(0, 420)}`);
    const source = await rest('GET', `/result-studio/revisions/${REVISION_ID}/source?projectId=${encodeURIComponent(projectId)}`);
    assert('E2c_source_projection',
      source.status === 200 && String(source.data?.content || '').includes(SOURCE_MARKER),
      `status=${source.status} body=${JSON.stringify(source.data).slice(0, 360)}`);
    writeFixturePack(dataDir);
    const contributions = await rest('GET', '/packs/contributions');
    const pack = (contributions.data?.packs || []).find((item) => item.packId === PACK_ID);
    const surface = pack && (pack.resultSurfaces || []).find((item) => item.id === 'result');
    assert('E3_fixture_pack_tabs_visible', Boolean(surface && (surface.tabs || []).length >= 2),
      `packs=${(contributions.data?.packs || []).length} tabs=${JSON.stringify(surface && surface.tabs)}`);

    vite = spawn(process.execPath, [
      path.join(ROOT, 'frontend', 'node_modules', 'vite', 'bin', 'vite.js'),
      '--port', String(VITE_PORT), '--strictPort',
    ], { cwd: path.join(ROOT, 'frontend'), stdio: ['ignore', 'pipe', 'pipe'] });
    vite.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      if (text.includes('Error')) console.log('  [vite:ERR]', text.slice(0, 200));
    });
    await waitHttp(`http://127.0.0.1:${VITE_PORT}/`, 60_000, 'vite');

    const electronEnv = {
      ...process.env,
      PETRI_TEST_INSTANCE: '1',
      PETRI_ELECTRON_USER_DATA_DIR: userDataDir,
      PETRI_DB_PATH: dbPath,
      PETRI_LOCAL_DATA_DIR: dataDir,
      R_SERVER_PORT: String(BACKEND_PORT),
      PETRI_ELECTRON_LOG_PATH: path.join(tempRoot, 'electron.log'),
    };
    delete electronEnv.ELECTRON_RUN_AS_NODE;
    electron = spawn(process.execPath, [
      path.join(ROOT, 'node_modules', 'electron', 'cli.js'), '.', '--dev', `--remote-debugging-port=${CDP_PORT}`,
    ], { cwd: ROOT, env: electronEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    electron.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      if (text.includes('Error')) console.log('  [electron:ERR]', text.slice(0, 200));
    });
    await waitFor(async () => {
      const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`, { signal: AbortSignal.timeout(2000) });
      const targets = await response.json();
      const pages = Array.isArray(targets) ? targets.filter((target) => target.type === 'page' && String(target.url).includes('test=1')) : [];
      return pages.length > 0 ? true : null;
    }, { timeoutMs: 90_000, intervalMs: 1000, label: 'electron test target' });
    assert('E4_isolated_stack', true, `backend :${BACKEND_PORT} / vite :${VITE_PORT} / cdp :${CDP_PORT} / data=${tempRoot}`);

    const flow = require(FLOW_PATH);
    process.env.PETRI_B252_PROJECT_ID = String(projectId);
    process.env.PETRI_B252_JOB_ID = JOB_ID;
    process.env.PETRI_B252_TABLE_ARTIFACT = TABLE_ARTIFACT;
    process.env.PETRI_B252_PLOT_ARTIFACT = PLOT_ARTIFACT;
    process.env.PETRI_B252_CHANGESET_ID = CHANGE_SET_ID;
    process.env.PETRI_B252_BASE_CHANGESET_ID = 'cs_ui252_base';
    process.env.PETRI_B252_REVISION_ID = REVISION_ID;
    process.env.PETRI_B252_SOURCE_MARKER = SOURCE_MARKER;
    process.env.PETRI_B252_PACK_ID = PACK_ID;
    process.env.PETRI_B252_TABLE_ARTIFACT_ID = 'art_ui252_table';
    process.env.PETRI_B252_PLOT_ARTIFACT_ID = 'art_ui252_plot';
    process.env.PETRI_B252_VIEWED_PLOT_REVISION = 'rev_ui252_plot_v1';
    await flow.run({ assert });
    flowResult = { assertions, allPass: assertions.every((item) => item.pass) };
  } catch (error) {
    assertions.push({ name: 'FATAL', pass: false, detail: error && error.stack ? error.stack : String(error) });
    flowResult = { assertions, allPass: false };
    console.error(error);
    process.exitCode = 1;
  } finally {
    killTree(electron && electron.pid);
    killTree(backend && backend.pid);
    killTree(vite && vite.pid);
    await sleep(600);
    try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch { /* Windows 句柄延迟 */ }
    const report = {
      name: 'ui544-546-pack-annotation-live',
      darkMode: process.env.PETRI_B252_DARK === '1',
      synthetic: { jobId: JOB_ID, changeSetId: CHANGE_SET_ID, revisionId: REVISION_ID, packId: PACK_ID },
      startedAt,
      finishedAt: new Date().toISOString(),
      assertions,
      allPass: Boolean(flowResult && flowResult.allPass),
    };
    const jsonName = report.darkMode ? 'ui544-546-v-rem-live-dark.json' : 'ui544-546-v-rem-live.json';
    for (const dir of Object.values(EVIDENCE)) {
      fs.writeFileSync(path.join(dir, jsonName), JSON.stringify(report, null, 2));
    }
    for (const dir of [EVIDENCE.ui544, EVIDENCE.ui545, EVIDENCE.ui546]) {
      for (const name of fs.readdirSync(dir)) {
        if (!name.endsWith('.png')) continue;
        fs.copyFileSync(path.join(dir, name), path.join(EVIDENCE.block, name));
      }
    }
    console.log(`\n${report.allPass ? 'ALL PASS' : 'FAILED'} ${assertions.filter((item) => item.pass).length}/${assertions.length}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
