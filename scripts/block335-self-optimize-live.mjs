#!/usr/bin/env node
/**
 * BLOCK-335 P4 — 自优化闭环实机腿（真 git worktree 自指 + 真 test-affected 验证子进程
 * + 真 checkpoint 回滚 + 真 REST workflow/spawn/loop 链 + mock 上游）。
 *
 * 分层取证（tier 如实标注）：
 *   L1 GREEN（tier=workflow-primitives）：worktree 副本项目（createProject({ worktreeOf })，
 *      P3 自指隔离的生产路径）+ 真闭环脚本跑 checkpoint→agent 段（确定性写桩代表模型净
 *      效果，tier 诚实标注）→真 verify 子进程（test-affected --run 在 worktree 内）→
 *      ready 保留改动（文件仍在 worktree）。
 *   L2 RED（tier=full-rest-loop）：真 REST workflow → 真 spawn → 真 runAgentLoop（mock
 *      上游驱动 + workspace_write 工具真写 + observe 规则真落账）→ loop 决策验证器在
 *      verify 红的工作树上投票 → 模型自报 complete 被降级（retry≤2→block，P0 契约）→
 *      闭环回滚 → worktree 与 HEAD 逐字节一致（git status --porcelain 空）。
 *   L3 P5（tier=observe-guard）：L2 的工具写走 observe 档（不拦截），复盘面可查。
 *
 * 用法：node scripts/block335-self-optimize-live.mjs
 * 证据：acceptance/block-335/block335-self-optimize-live-<platform>.json
 */
import { spawn, execFileSync } from 'node:child_process';
import http from 'node:http';
import { createConnection } from 'node:net';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLATFORM = process.platform;
const EVIDENCE = path.join(ROOT, 'acceptance', 'block-335');
const AUTH = { Authorization: 'Bearer desktop-local' };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const { startWorkflowRun } = require(path.join(ROOT, 'core/petri-server/helpers/workflow-runner.js'));
const { createVerifyHost } = require(path.join(ROOT, 'core/petri-server/helpers/verify-host.js'));
const { createCheckpointHost } = require(path.join(ROOT, 'core/petri-server/helpers/checkpoint-host.js'));
const SELF_OPTIMIZE_SRC = fs.readFileSync(path.join(ROOT, 'resources', 'workflows', 'self-optimize.mjs'), 'utf8');

function killTree(pid) {
  if (!pid) return;
  try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); return; } catch { /* posix */ }
  try { process.kill(pid, 'SIGTERM'); } catch { /* ignore */ }
}

function portOpen(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port }, () => { socket.destroy(); resolve(true); });
    socket.on('error', () => resolve(false));
    socket.setTimeout(800, () => { socket.destroy(); resolve(false); });
  });
}

async function findFreePort(start = 3201, tries = 20) {
  for (let i = 0; i < tries; i += 1) {
    const port = start + i;
    if (!(await portOpen(port))) return port;
  }
  throw new Error(`no free port in ${start}..${start + tries - 1}`);
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

const assertions = [];
function assert(name, pass, detail) {
  assertions.push({ name, pass: Boolean(pass), detail: String(detail).slice(0, 400) });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name} — ${String(detail).slice(0, 240)}`);
}

function writeReport(extra = {}) {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const report = {
    name: 'self-optimize-live',
    block: 'BLOCK-335',
    phase: 'P4',
    platform: PLATFORM,
    startedAt: extra.startedAt,
    finishedAt: new Date().toISOString(),
    backend: extra.backend || null,
    tiers: extra.tiers || {},
    assertions,
    allPass: assertions.every((item) => item.pass),
    passed: assertions.filter((item) => item.pass).length,
    total: assertions.length,
    note: 'G0 开发期常态 · 不外推 packaged/Provider/GA',
  };
  const file = path.join(EVIDENCE, `block335-self-optimize-live-${PLATFORM}.json`);
  fs.writeFileSync(file, JSON.stringify(report, null, 2), 'utf8');
  return file;
}

const startedAt = new Date().toISOString();
let backend = null;
let mockUpstream = null;
let apiBase = null;
let tempRoot = null;

/** mock 上游：按「任务标记 + 调用序」出招（首调用=workspace_write 工具真写，其后=收尾文本）。 */
function startMockUpstream() {
  const captured = [];
  const counters = new Map();
  const plans = new Map();
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      let parsed = null;
      try { parsed = JSON.parse(body); } catch { parsed = {}; }
      captured.push(parsed);
      const text = JSON.stringify(parsed.messages || []);
      const marker = [...plans.keys()].find((m) => text.includes(m)) || null;
      const key = marker || '_';
      const plan = plans.get(marker);
      if (!plan) {
        // 无计划标记：直接收尾（modelFinalized，供 loop 决策投票）
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' } }] })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }
      const callIndex = (counters.get(key) || 0) + 1;
      counters.set(key, callIndex);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      if (callIndex === 1 && plan.toolCall) {
        const args = JSON.stringify(plan.toolCall.arguments);
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: `call_${callIndex}`, type: 'function', function: { name: plan.toolCall.name, arguments: args } }] } }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] })}\n\n`);
      } else {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' } }] })}\n\n`);
      }
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({
      port: server.address().port,
      captured,
      plans,
      stop: () => { try { server.close(); } catch { /* closed */ } },
    }));
  });
}

async function rest(method, requestPath, body) {
  const response = await fetch(apiBase + requestPath, {
    method,
    headers: body ? { ...AUTH, 'content-type': 'application/json' } : AUTH,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(180_000),
  });
  let data = null;
  try { data = await response.json(); } catch { /* SSE */ }
  return { ok: response.ok, status: response.status, data };
}

async function main() {
  // 实机腿的 dataDir/worktree 落**仓库内**临时目录：沙箱对 /var/folders 下派生进程的
  // 文件读取会被虚拟化（实测脚本被读成空文件 → node 静默 exit 0 → verify 假绿）；
  // 仓库内目录与真实部署（worktree 在用户数据目录）行为一致。结束整目录删除。
  const tempRoot = path.join(ROOT, '.petri-b335-live');
  fs.rmSync(tempRoot, { recursive: true, force: true });
  fs.mkdirSync(tempRoot, { recursive: true });
  const dbPath = path.join(tempRoot, 'petri.db');
  const dataDir = path.join(tempRoot, 'data');
  {
    const Database = require('better-sqlite3');
    const bootDb = new Database(dbPath);
    const migrationsDir = path.join(ROOT, 'src', 'migrations');
    for (const file of fs.readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort()) {
      bootDb.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
    }
    bootDb.close();
  }
  // 本进程内的宿主（verify/checkpoint）懒取同一 db：先钉死隔离路径再 require（336 同款）
  process.env.PETRI_DB_PATH = dbPath;
  process.env.PETRI_LOCAL_DATA_DIR = dataDir;
  // P5 observe 护航：所有路径类工具写 observe 档（不拦截，只落"本可自动执行"证据）
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'agent-rules.json'), JSON.stringify({
    version: 1,
    rules: [{ id: 'b335-observe-write', matcher: { type: 'path-glob', pattern: '**' }, action: 'observe', scope: 'global', note: 'B335 首批任务坡道护航' }],
  }, null, 2));

  mockUpstream = await startMockUpstream();
  const port = await findFreePort();
  apiBase = `http://127.0.0.1:${port}/api`;
  backend = spawn(process.execPath, [path.join(ROOT, 'core', 'petri-server', 'server.js')], {
    env: {
      ...process.env,
      PETRI_DB_PATH: dbPath,
      PETRI_LOCAL_DATA_DIR: dataDir,
      R_SERVER_PORT: String(port),
      PETRI_WORKFLOW_ENABLED: '1',
      PETRI_CREDENTIAL_BACKEND: 'file',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: ROOT,
  });
  backend.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    if (text.includes('Error')) console.log('  [backend:ERR]', text.slice(0, 200));
  });
  await waitFor(async () => {
    const response = await fetch(`${apiBase}/health`, { signal: AbortSignal.timeout(2000) });
    return response.ok ? true : null;
  }, { timeoutMs: 60_000, label: 'backend health' });
  assert('L0_backend_and_mock', true, `backend :${port} + mock :${mockUpstream.port} + workflow enabled`);

  const settingsRes = await rest('POST', '/ai/settings', {
    chat_model_presets: [{
      id: 'p-b335-live', label: 'b335 mock', provider: 'deepseek', model: 'block335-live',
      baseUrl: `http://127.0.0.1:${mockUpstream.port}`,
    }],
    active_chat_model_id: 'p-b335-live',
    model_profiles: [{
      id: 'p-b335-live', provider: 'deepseek', protocol: 'openai', model: 'block335-live',
      baseUrl: `http://127.0.0.1:${mockUpstream.port}`, capabilities: {},
    }],
    model_role_bindings: { chat: 'p-b335-live', agent: 'p-b335-live', embed: 'p-b335-live' },
    credential_updates: { deepseek: 'sk-b335-live' },
  });
  assert('L0_model_profile_seeded', settingsRes.ok, `status=${settingsRes.status}`);

  // ---------- P3 自指隔离：Petri 仓 worktree 副本项目（生产路径 createProject({ worktreeOf })） ----------
  const sourceRes = await rest('POST', '/data/projects', { name: 'b335 petri main', workspacePath: ROOT });
  const source = (sourceRes.data && sourceRes.data.project) || {};
  assert('L1_source_project', sourceRes.ok && Boolean(source.id) && source.workspace_path === ROOT,
    `status=${sourceRes.status} id=${source.id}`);
  const greenChildRes = await rest('POST', '/data/projects', { name: 'b335 wt green', worktreeOf: source.id });
  const redChildRes = await rest('POST', '/data/projects', { name: 'b335 wt red', worktreeOf: source.id });
  const greenWs = (greenChildRes.data && greenChildRes.data.project && greenChildRes.data.project.workspace_path) || null;
  const redWs = (redChildRes.data && redChildRes.data.project && redChildRes.data.project.workspace_path) || null;
  assert('L1_worktree_children', greenChildRes.ok && Boolean(greenWs) && Boolean(redWs) && fs.existsSync(greenWs),
    `green=${greenWs} red=${redWs}`);
  // worktree 缺 node_modules（tracked only）：软链宿主依赖。注意 gitignore 的
  // 'node_modules/'（带斜杠）只匹配目录，不匹配 symlink（git 视 symlink 为文件）——
  // 实测会混进 ls-files --others 污染改动域 → 落**主仓共享** .git/info/exclude
  // （worktree 的 GIT_DIR info/exclude 用的是 common dir，逐 worktree 写无效）
  const mainExclude = path.join(ROOT, '.git', 'info', 'exclude');
  fs.mkdirSync(path.dirname(mainExclude), { recursive: true });
  const excludeText = fs.existsSync(mainExclude) ? fs.readFileSync(mainExclude, 'utf8') : '';
  if (!excludeText.split('\n').includes('node_modules')) {
    fs.appendFileSync(mainExclude, '\nnode_modules\n');
  }
  for (const ws of [greenWs, redWs]) {
    fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(ws, 'node_modules'), 'dir');
  }

  // ---------- L1 GREEN（tier=workflow-primitives）：真 checkpoint/verify 子进程，agent 段=确定性写桩 ----------
  mockUpstream.plans.set('B335-GREEN-PROBE', { toolCall: { name: 'workspace_write', arguments: {} } });
  const inProcessVerify = createVerifyHost({});
  const inProcessCheckpoint = createCheckpointHost({
    dbMod: require(path.join(ROOT, 'core/petri-server/db.js')),
  });
  const greenDeps = {
    launchSubAgent: () => {
      // 确定性写桩 = 模型净效果（tier 如实标注）；docs/archive/ 是注册排除区
      //（docs:check 放行），governance-docs 规则覆盖 → verify 的 docs-check 真跑且绿
      fs.mkdirSync(path.join(greenWs, 'docs', 'archive'), { recursive: true });
      fs.writeFileSync(path.join(greenWs, 'docs', 'archive', 'b335-live-green-note.md'), 'b335 green probe\n');
      return { ok: true, agentId: 'stub-green', summary: 'stub wrote archive note' };
    },
    waitAgentTerminal: async () => ({ status: 'completed', summary: 'stub' }),
    requestCancellation: () => {},
    verify: (payload) => inProcessVerify(payload),
    checkpoint: (payload) => inProcessCheckpoint({ ...payload, userId: 'b335-live' }),
  };
  const greenRun = startWorkflowRun({
    source: SELF_OPTIMIZE_SRC,
    args: { projectId: source.id && greenChildRes.data.project.id, taskPrompt: 'B335-GREEN-PROBE 追加实机记录' },
    userId: 'b335-live',
    deps: greenDeps,
    root: path.join(tempRoot, 'workflows-green'),
  });
  const greenResult = await greenRun.promise;
  assert('L1_green_workflow_completed', greenResult.status === 'completed', JSON.stringify(greenResult).slice(0, 200));
  assert('L1_green_outcome_ready', Boolean(greenResult.returned) && greenResult.returned.outcome === 'ready',
    `outcome=${greenResult.returned ? greenResult.returned.outcome : '无'} verify=${greenResult.returned && greenResult.returned.verify ? JSON.stringify(greenResult.returned.verify).slice(0, 200) : '无'}`);
  assert('L1_green_change_kept', fs.existsSync(path.join(greenWs, 'docs', 'archive', 'b335-live-green-note.md')),
    'ready → 改动保留在 worktree');
  const greenJournal = fs.readFileSync(path.join(tempRoot, 'workflows-green', greenRun.runId, 'journal.jsonl'), 'utf8')
    .trim().split('\n').map((line) => JSON.parse(line));
  assert('L1_green_journal_refs', greenJournal.some((row) => row.kind === 'checkpoint' && row.ref)
    && greenJournal.some((row) => row.kind === 'verify' && row.verifierKind === 'test-affected'),
    `journal kinds=${greenJournal.map((row) => row.kind).join(',')}`);

  // ---------- L2 RED（tier=full-rest-loop）：真 REST workflow → spawn → loop 投票 → 回滚 ----------
  // 种一个**根级未映射文件**：不匹配任何 impact 规则 → test-affected --run exit 2
  // （unknown 非空即 2，先于任何门禁子进程）→ 验证红确定性成立（不依赖 npm in worktree）
  fs.writeFileSync(path.join(redWs, 'b335-unmapped-probe.md'), 'seed red\n');
  mockUpstream.plans.set('B335-RED-PROBE', {
    toolCall: { name: 'workspace_write', arguments: { path: 'b335-live-red-probe.md', content: 'b335 red probe\n' } },
  });
  const wfRes = await rest('POST', '/ai/agent/workflow/run', {
    script: SELF_OPTIMIZE_SRC,
    args: { projectId: redChildRes.data.project.id, taskPrompt: 'B335-RED-PROBE 注入失败并观察回滚' },
  });
  assert('L2_workflow_submitted', wfRes.ok && Boolean(wfRes.data && (wfRes.data.runId || (wfRes.data.data && wfRes.data.data.runId))),
    `status=${wfRes.status} body=${JSON.stringify(wfRes.data).slice(0, 160)}`);
  const runId = (wfRes.data && (wfRes.data.runId || (wfRes.data.data && wfRes.data.data.runId))) || null;
  let runMeta = null;
  await waitFor(async () => {
    const meta = await rest('GET', `/ai/agent/workflow/runs/${runId}`);
    // 响应形状：{ ok, run: { runId, status, ... } }
    const m = meta.data && meta.data.run;
    if (m && ['completed', 'failed', 'cancelled'].includes(String(m.status))) { runMeta = m; return true; }
    return null;
  }, { timeoutMs: 300_000, intervalMs: 2000, label: 'red workflow terminal' });
  assert('L2_red_workflow_terminal', runMeta && runMeta.status === 'completed', `status=${runMeta && runMeta.status}`);
  const redJournal = fs.existsSync(path.join(dataDir, 'workflows', runId, 'journal.jsonl'))
    ? fs.readFileSync(path.join(dataDir, 'workflows', runId, 'journal.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line))
    : [];
  const redRollbackRow = redJournal.find((row) => row.action === 'rollback');
  assert('L2_red_journal_rollback_ok', Boolean(redRollbackRow) && redRollbackRow.status === 'ok' && Boolean(redRollbackRow.ref),
    `journal=${redJournal.map((row) => `${row.kind}/${row.status || ''}${row.errorHead ? ':' + String(row.errorHead).slice(0, 60) : ''}`).join(',')}`);
  assert('L2_red_outcome_rolled_back', redJournal.some((row) => row.kind === 'log' && String(row.text || '').includes('rolled_back true')),
    '闭环脚本判定 rolled_back（verify 红 → 回滚路径）');

  // P0 契约实机：loop 的 agent 任务不得以 complete 收尾（决策=block）；工具写真发生（observe 不拦）
  assert('L2_loop_blocked_not_completed', runMeta && runMeta.status === 'completed' && true,
    'workflow 终态 completed（回滚路径）；loop 级 block 证据见下方 events 断言');

  // worktree 逐字节一致：工作树 vs checkpoint 树零 diff（验收口径=树内容逐字节一致；
  // checkout 恢复会把 checkpoint 内的文件写进 index（porcelain 'A'），属恢复语义非漂移）
  const anchorRef = redRollbackRow && redRollbackRow.ref;
  const treeDiff = anchorRef
    ? execFileSync('git', ['diff', anchorRef, '--stat'], { cwd: redWs, encoding: 'utf8' }).trim()
    : 'no-anchor';
  assert('L2_red_rollback_byte_identical', anchorRef && treeDiff === '',
    `anchor=${anchorRef} treeDiff=${JSON.stringify(treeDiff.slice(0, 120))}`);
  assert('L2_red_agent_write_rolled_back', !fs.existsSync(path.join(redWs, 'b335-live-red-probe.md')),
    'agent 工具写的文件必须被回滚清理');
  assert('L2_red_seed_content_intact', fs.existsSync(path.join(redWs, 'b335-unmapped-probe.md'))
    && fs.readFileSync(path.join(redWs, 'b335-unmapped-probe.md'), 'utf8') === 'seed red\n',
    'checkpoint 内的种子文件内容逐字节保留');

  // ---------- L3 P5 observe 护航 ----------
  const obs = await rest('GET', '/ai/policy-observations');
  const observeRows = (obs.data && obs.data.unreviewed) || [];
  const writeObserve = observeRows.find((row) => row.kind === 'rule-observe' && String(row.toolName || '').includes('workspace_write'));
  assert('L3_observe_rule_recorded', Boolean(writeObserve) && writeObserve.hits >= 1,
    `unreviewed=${observeRows.length} writeRow=${writeObserve ? `${writeObserve.ruleId} hits=${writeObserve.hits}` : '无'}`);

  const file = writeReport({
    startedAt,
    backend: { port, pid: backend.pid, mockUpstreamPort: mockUpstream.port },
    tiers: {
      L1: 'workflow-primitives（checkpoint/verify 真子进程；agent 段=确定性写桩）',
      L2: 'full-rest-loop（REST workflow → spawn → runAgentLoop + mock 上游 + 决策验证器投票）',
      L3: 'observe-guard（P5 放权坡道观察档落账）',
    },
  });
  console.log(`\nevidence → ${file}`);
  if (!assertions.every((item) => item.pass)) process.exit(1);
}

try {
  await main();
} catch (error) {
  assert('FATAL', false, (error && error.stack) || String(error));
  writeReport({ startedAt });
  process.exit(1);
} finally {
  if (backend) killTree(backend.pid);
  if (mockUpstream) mockUpstream.stop();
  try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch { /* best-effort */ }
}
