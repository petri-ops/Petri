#!/usr/bin/env node
/**
 * BLOCK-337 P6 — 治理运行时实机腿（隔离后端 + 真 HTTP + mock 上游抓 system prompt 字节）。
 *
 * 为什么这样组：P2 的接线点在 chat 路由与 agent-runner 的 context 组装（服务端从
 * projects 表派生 workspacePath），不抓「上游实际收到的 system prompt」就无法证明
 * 「项目打开即装载」端到端成立，也无法证明客户端伪造路径骗不挂治理包。
 *
 * 覆盖（P6 验收：四类工作区 + 并行校验 + 收口落账对账）：
 *   L1 隔离后端全链：四类工作区（受治理仓/生信/code-light/blank）各建项目 → 真 HTTP
 *      chat → mock 上游捕获 system → 断言各自规则包装载正确且互不泄漏；
 *   L2 反伪造：客户端伪造 workspacePath 指向真受治理仓 → 治理段必须缺席（服务端
 *      只认 projects 表派生值）；
 *   L3 并行门：真 docs-governance 校验器对不相交/相交两造判定 + 真仓 --check 冒烟；
 *   L4 收口 phase：真 workflow runner + 真 closeout-host 子进程跑 closeout-gates
 *      （便宜门子集）→ ready + journal 落行 + 三块落账草稿与人工手写逐字段对账；
 *   L5 P7③：坡道观察行 → 真 REST 复盘 decision=misfire → 账本桥 → 渲染降级 observe 档。
 *
 * 用法：node scripts/block337-governance-live.mjs
 * 证据：acceptance/block-337/block337-p6-live-<platform>.json
 */
import { spawn, execFileSync } from 'node:child_process';
import http from 'node:http';
import { createConnection } from 'node:net';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLATFORM = process.platform;
const EVIDENCE = path.join(ROOT, 'acceptance', 'block-337');
const AUTH = { Authorization: 'Bearer desktop-local' };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const { startWorkflowRun } = require(path.join(ROOT, 'core/petri-server/helpers/workflow-runner.js'));
const { createCloseoutHost } = require(path.join(ROOT, 'core/petri-server/helpers/closeout-host.js'));
const { ledgerEntriesFromRows } = require(path.join(ROOT, 'core/shared-backend/governance/observation-bridge.js'));
const { createRuleLedger } = require(path.join(ROOT, 'core/shared-backend/governance/rule-lifecycle.js'));
const { renderGovernanceRuntimeSection } = require(path.join(ROOT, 'core/shared-backend/governance/workspace-rules.js'));

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

async function findFreePort(start = 3191, tries = 20) {
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
    name: 'governance-live',
    block: 'BLOCK-337',
    phase: 'P6',
    platform: PLATFORM,
    startedAt: extra.startedAt,
    finishedAt: new Date().toISOString(),
    backend: extra.backend || null,
    assertions,
    allPass: assertions.every((item) => item.pass),
    passed: assertions.filter((item) => item.pass).length,
    total: assertions.length,
    note: 'G0 开发期常态 · 不外推 packaged/Provider/GA',
  };
  const file = path.join(EVIDENCE, `block337-p6-live-${PLATFORM}.json`);
  fs.writeFileSync(file, JSON.stringify(report, null, 2), 'utf8');
  return file;
}

const startedAt = new Date().toISOString();
let backend = null;
let mockUpstream = null;
let apiBase = null;

/** mock 上游：记录请求体（system 全文），SSE / JSON 双形态应答。 */
function startMockUpstream() {
  const captured = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      let parsed = null;
      try { parsed = JSON.parse(body); } catch { parsed = { raw: body }; }
      captured.push(parsed);
      if (parsed && parsed.stream === true) {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' } }] })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      } else {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          id: 'block337-live',
          choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'ok' } }],
          usage: { prompt_tokens: 10, completion_tokens: 1 },
        }));
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({
      port: server.address().port,
      captured,
      stop: () => { try { server.close(); } catch { /* closed */ } },
    }));
  });
}

async function rest(method, requestPath, body) {
  const response = await fetch(apiBase + requestPath, {
    method,
    headers: body ? { ...AUTH, 'content-type': 'application/json' } : AUTH,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(120_000),
  });
  let data = null;
  try { data = await response.json(); } catch { /* SSE / non-json */ }
  return { ok: response.ok, status: response.status, data };
}

/** system prompt 抓取：agent 主调用把静态前缀与动态上下文拆成**两条 system 消息**
 * （BLOCK-212 前缀缓存形态），治理段在第二条——逐捕获拼接全部 system 消息再取最长；
 * 会话创建还会先发一个标题 mini 调用；all=true 时返回全部（供缺席断言）。 */
function capturedSystem(captured, fromIndex, { all = false } = {}) {
  const systems = [];
  for (let i = fromIndex; i < captured.length; i += 1) {
    const body = captured[i];
    const messages = body && Array.isArray(body.messages) ? body.messages : null;
    if (!messages) continue;
    const joined = messages
      .filter((m) => m.role === 'system')
      .map((m) => String(m.content || ''))
      .join('\n');
    if (joined) systems.push(joined);
  }
  if (all) return systems;
  if (systems.length === 0) return null;
  return systems.reduce((longest, text) => (text.length > longest.length ? text : longest), '');
}

/** 经生产主聊天路径（POST /api/ai/agent → runAgentLoop → buildSystemPromptParts）抓取
 * mock 上游收到的 system prompt；agent 循环首轮调用即携带治理段。探针消息必须是
 * 真任务形态——高置信闲聊会走 chitchat 快路径绕过主 prompt（BLOCK-339 P6 同款抓真）。 */
async function agentOnce(projectId, extraContext = {}) {
  const from = mockUpstream.captured.length;
  const submitted = await rest('POST', '/ai/agent', {
    messages: [{
      role: 'user',
      content: '读取本项目 docs/AUDIT-LOG.md 的未决广播行，逐条给出处置建议，然后列出本轮你装载的工作区治理规则清单与依据文件。',
    }],
    context: { page: 'desktop-project', ...(projectId ? { projectId } : {}), ...extraContext },
  });
  const taskId = submitted.data && submitted.data.taskId;
  assert('L1_agent_task_submitted', submitted.ok && Boolean(taskId),
    `status=${submitted.status} taskId=${taskId || '无'}`);
  await waitFor(() => (mockUpstream.captured.length > from ? true : null), { timeoutMs: 45_000, intervalMs: 300, label: 'mock upstream capture' });
  await sleep(4000); // agent 循环继续跑（工具轮/终态）；让主 prompt 落进捕获
  return { taskId, system: capturedSystem(mockUpstream.captured, from), allSystems: capturedSystem(mockUpstream.captured, from, { all: true }) };
}

try {
  // ---------- 隔离库（后端进程不跑 src/migrations，桌面主进程职责；block336 同款预建） ----------
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-b337-live-'));
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

  // ---------- mock 上游（先起，端口进 profile） ----------
  mockUpstream = await startMockUpstream();

  // ---------- 隔离后端 ----------
  const port = await findFreePort();
  apiBase = `http://127.0.0.1:${port}/api`;
  backend = spawn(process.execPath, [path.join(ROOT, 'core', 'petri-server', 'server.js')], {
    env: { ...process.env, PETRI_DB_PATH: dbPath, PETRI_LOCAL_DATA_DIR: dataDir, R_SERVER_PORT: String(port) },
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
  assert('L0_isolated_backend_and_mock_upstream', true, `backend :${port} + mock upstream :${mockUpstream.port}`);

  // ---------- 模型 profile 指向 mock 上游（走真 ai-settings 存储 + credential store）。
  // ① bindings 含 embed：否则检索层回落真实 dashscope 端点，隔离环境网络挂起会卡死链路
  //   （探针实测）；对 mock 的 embed 应答解析失败→检索空块，chat 照常。
  // ② chat_model_presets 与 model_profiles 必须同 id：agent 链按 preset id 直查
  //   profile（id 不同 → 「模型配置不存在」fail-fast，实机探针抓真）。 ----------
  const settingsRes = await rest('POST', '/ai/settings', {
    chat_model_presets: [{
      id: 'p-b337-live',
      label: 'b337 live mock',
      provider: 'deepseek',
      model: 'block337-live',
      baseUrl: `http://127.0.0.1:${mockUpstream.port}`,
    }],
    active_chat_model_id: 'p-b337-live',
    model_profiles: [{
      id: 'p-b337-live',
      provider: 'deepseek',
      protocol: 'openai',
      model: 'block337-live',
      baseUrl: `http://127.0.0.1:${mockUpstream.port}`,
      capabilities: {},
    }],
    model_role_bindings: { chat: 'p-b337-live', agent: 'p-b337-live', embed: 'p-b337-live' },
    credential_updates: { deepseek: 'sk-block337-live' },
  });
  const dropped = (settingsRes.data && settingsRes.data.diagnostics) || [];
  assert('L0_model_profile_seeded', settingsRes.ok && !dropped.some((item) => String(item).includes('model_profiles')),
    `status=${settingsRes.status} dropped=${JSON.stringify(dropped)}`);

  // ---------- L1 四类工作区 ----------
  const softwareWs = path.join(tempRoot, 'ws-software');
  const bioWs = path.join(tempRoot, 'ws-bio');
  const codeWs = path.join(tempRoot, 'ws-code');
  const blankWs = path.join(tempRoot, 'ws-blank');
  for (const dir of [softwareWs, bioWs, codeWs, blankWs]) fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(softwareWs, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(softwareWs, 'docs', 'DOC-REGISTRY.json'), '{"documents":[]}');
  fs.writeFileSync(path.join(softwareWs, 'AGENTS.md'), '# agents\n');
  fs.writeFileSync(
    path.join(softwareWs, 'docs', 'AUDIT-LOG.md'),
    [
      '# 审计广播台',
      '| 状态 | 日期 | 事项 | 归属 |',
      '| --- | --- | --- | --- |',
      '| 🔴 | 2026-11-03 | 实机腿种下的阻塞广播行（fixture） | BLOCK-337 |',
      '| 🟡 | 2026-11-03 | 登记待办不算开工前置（fixture） | BLOCK-337 |',
      '',
    ].join('\n')
  );
  fs.writeFileSync(path.join(bioWs, 'counts.csv'), 'gene,count\nA,1\n');
  fs.writeFileSync(path.join(codeWs, 'package.json'), '{}');
  fs.mkdirSync(path.join(codeWs, '.git'), { recursive: true });
  fs.writeFileSync(path.join(blankWs, 'notes.txt'), 'nothing here');

  const projects = {};
  for (const [key, wsPath] of [['software', softwareWs], ['bio', bioWs], ['code', codeWs], ['blank', blankWs]]) {
    const created = await rest('POST', '/data/projects', { name: `b337 ${key}`, workspacePath: wsPath });
    const project = (created.data && created.data.project) || {};
    projects[key] = project.id;
    assert(`L1_project_${key}`, created.ok && Boolean(projects[key]) && project.workspace_path === wsPath,
      `status=${created.status} id=${projects[key]} path=${project.workspace_path}`);
  }

  const softwareChat = await agentOnce(projects.software);
  assert('L1_software_governed_loaded', softwareChat.system && softwareChat.system.includes('工作区治理（自动装载：受治理软件仓')
    && softwareChat.system.includes('[必须]'),
    `sysLen=${softwareChat.system && softwareChat.system.length}`);
  assert('L1_software_audit_prerequisite', softwareChat.system && softwareChat.system.includes('开工前置')
    && softwareChat.system.includes('实机腿种下的阻塞广播行'),
    'auditSource 的 🔴 行注入为开工前置');
  assert('L1_software_no_bio_leak', softwareChat.system && !softwareChat.system.includes('自动装载：生信分析项目'),
    '软件仓不得挂生信包');

  const bioChat = await agentOnce(projects.bio);
  assert('L1_bio_pack_loaded', bioChat.system && bioChat.system.includes('自动装载：生信分析项目')
    && bioChat.system.includes('[必须]'), `sysLen=${bioChat.system && bioChat.system.length}`);
  assert('L1_bio_no_software_leak', bioChat.system && !bioChat.system.includes('自动装载：受治理软件仓')
    && !bioChat.system.includes('closeout 全绿'),
    '生信项目不得看到 Petri 工程纪律');

  const codeChat = await agentOnce(projects.code);
  assert('L1_code_light_loaded', codeChat.system && codeChat.system.includes('自动装载：普通代码仓'),
    `sysLen=${codeChat.system && codeChat.system.length}`);

  const blankChat = await agentOnce(projects.blank);
  assert('L1_blank_zero_rules', blankChat.system && !blankChat.system.includes('工作区治理（自动装载'),
    '未识别工作区=零规则零注入（合法默认）');

  // ---------- L2 反伪造：客户端伪造 workspacePath 指向真受治理仓 ----------
  const forgedChat = await agentOnce(projects.blank, { workspacePath: ROOT });
  const forgedAll = (forgedChat.allSystems || []).join('\n');
  assert('L2_forged_workspace_path_stripped', forgedAll.length > 0 && !forgedAll.includes('工作区治理（自动装载'),
    `客户端伪造路径不得骗挂治理包（服务端只认 projects 表派生值；捕获 system ${forgedChat.allSystems.length} 次）`);
  const forgedNoProject = await agentOnce(null, { workspacePath: ROOT });
  const forgedNoProjAll = (forgedNoProject.allSystems || []).join('\n');
  assert('L2_forged_without_project_stripped', forgedNoProjAll.length > 0 && !forgedNoProjAll.includes('工作区治理（自动装载'),
    '无 projectId 时客户端路径同样剥除');

  // ---------- L3 并行门（真校验器 + 真仓冒烟） ----------
  const { validateDocumentRegistry } = await import(path.join(ROOT, 'scripts', 'docs-governance.mjs'));
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-b337-par-'));
  fs.mkdirSync(path.join(fixtureRoot, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(fixtureRoot, 'docs', 'wp-a.md'), '# A\n');
  fs.writeFileSync(path.join(fixtureRoot, 'docs', 'wp-b.md'), '# B\n');
  const coverage = { managedRoots: ['docs'], excludedPrefixes: [], requireRegistration: false };
  const wp = (id, overrides = {}) => ({
    id, path: `docs/wp-${id.slice(3).toLowerCase()}.md`, kind: 'work-package', status: 'active',
    canonical: false, archivePolicy: 'archive_when_superseded',
    truthDomain: `td-${id.toLowerCase()}`, touchSurface: [`src/${id.toLowerCase()}/**`], sharedBaselines: [],
    ...overrides,
  });
  const disjoint = await validateDocumentRegistry(
    { schemaVersion: 1, coverage, documents: [wp('WP-A'), wp('WP-B')] },
    { rootDir: fixtureRoot }
  );
  assert('L3_disjoint_parallel_allowed', !disjoint.some((item) => item.code.startsWith('PARALLEL_')),
    `codes=${JSON.stringify(disjoint.map((item) => item.code))}`);
  const intersecting = await validateDocumentRegistry(
    { schemaVersion: 1, coverage, documents: [wp('WP-A'), wp('WP-B', { truthDomain: 'td-wp-a' })] },
    { rootDir: fixtureRoot }
  );
  assert('L3_intersecting_parallel_blocked',
    intersecting.some((item) => item.code === 'PARALLEL_CONTRACT_CONFLICT' && item.message.includes('same_truth_domain')),
    '同真相域两 active 包必须 FAIL（相交自动排队）');
  const realCheck = await new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'docs-governance.mjs'), '--check'], { cwd: ROOT });
    child.on('close', (code) => resolve(code));
    child.on('error', () => resolve(-1));
  });
  assert('L3_real_repo_docs_check_pass', realCheck === 0, `docs-governance --check exit=${realCheck}（新门在单 active 包时休眠）`);

  // ---------- L4 收口 phase：真 runner + 真 closeout-host 子进程 ----------
  const workflowsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-b337-wf-'));
  const ledgerPayload = {
    nextStepBrief: {
      suggestion: '337 收口后按队列进 335（就绪，缺首批题）',
      waveOrder: 'Q 波次全收口；337 → 335（P4-REM 最后、Q4b 单列）',
      blueprint: {
        qMatrix: '✅74 / 🟡21 / 🔴0 / ⛔7 = 102',
        competitiveness: 'BLOCK-322 3D 可交付段收口，余 RULING-02/04 待裁决',
        resultStudio: 'implemented_unverified / experimental（G0 常态）',
        uiLedger: '449 verified / 26 in_progress',
        activePackages: 'BLOCK-337 治理运行时化（第二批）',
      },
    },
    auditLogRow: {
      headline: '✅ BLOCK-337 第二批收口（P2 调用侧/P3 registry 并行门/P4 closeout/P5 落账/P6 实机/P7③）',
      date: '2026-11-03',
      detail: '实机四腿全绿（acceptance/block-337/）',
      domain: 'BLOCK-337 / P6',
    },
    handoffResume: {
      packageId: 'BLOCK-337',
      phase: 'P6-COMPLETED',
      entry: 'docs/block-337-governance-runtime-plan.md §3',
      evidence: 'acceptance/block-337/block337-p6-live-darwin.json',
    },
  };
  // 人工手写期望（对账基准：判定与措辞由人写，机器只渲染结构）
  const handWritten = {
    nextStepBrief: [
      'Jev 单一建议：337 收口后按队列进 335（就绪，缺首批题）',
      '母纲波次顺序：Q 波次全收口；337 → 335（P4-REM 最后、Q4b 单列）',
      '蓝图 / 全局计划进展：',
      '- 母纲 Q-MATRIX：✅74 / 🟡21 / 🔴0 / ⛔7 = 102',
      '- 竞争力纲 / 成熟度蓝图：BLOCK-322 3D 可交付段收口，余 RULING-02/04 待裁决',
      '- Result Studio：implemented_unverified / experimental（G0 常态）',
      '- UI 台账：449 verified / 26 in_progress',
      '- 当前 active 工作包：BLOCK-337 治理运行时化（第二批）',
    ].join('\n'),
    auditLogRow: '| ✅ BLOCK-337 第二批收口（P2 调用侧/P3 registry 并行门/P4 closeout/P5 落账/P6 实机/P7③） | 2026-11-03 | 实机四腿全绿（acceptance/block-337/） | BLOCK-337 / P6 |',
    handoffResume: [
      '- 工作包：BLOCK-337',
      '- 阶段：P6-COMPLETED',
      '- 恢复入口：docs/block-337-governance-runtime-plan.md §3',
      '- 证据：acceptance/block-337/block337-p6-live-darwin.json',
    ].join('\n'),
  };
  const closeoutScript = [
    "export const meta = { name: 'b337-closeout', version: 1, budget: { maxAgents: 1, maxSteps: 8, timeoutMs: 600000 }, concurrency: 1 };",
    'export default async function run(args) {',
    '  const verdict = await closeout(args);',
    "  log('closeout verdict', verdict && verdict.verdict);",
    '  return verdict;',
    '}',
  ].join('\n');
  const run = startWorkflowRun({
    source: closeoutScript,
    args: { gates: ['gate:code-size'], noTests: true, ledger: ledgerPayload },
    userId: 'b337-live',
    deps: { closeout: createCloseoutHost({ cwd: ROOT }) },
    root: workflowsRoot,
  });
  const runResult = await run.promise;
  assert('L4_closeout_phase_completed', runResult.status === 'completed', `status=${runResult.status} error=${runResult.error || '无'}`);
  assert('L4_closeout_verdict_ready', runResult.returned && runResult.returned.verdict === 'ready'
    && runResult.returned.exitCode === 0,
    `verdict=${runResult.returned && runResult.returned.verdict} exit=${runResult.returned && runResult.returned.exitCode}`);
  const journalFile = path.join(workflowsRoot, run.runId, 'journal.jsonl');
  const journalRows = fs.existsSync(journalFile)
    ? fs.readFileSync(journalFile, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
    : [];
  const closeoutRow = journalRows.find((row) => row.kind === 'closeout');
  assert('L4_journal_closeout_row', Boolean(closeoutRow) && closeoutRow.status === 'ready' && closeoutRow.hasLedgerDraft === true,
    `rows=${journalRows.map((row) => row.kind).join(',')}`);
  const draft = (runResult.returned && runResult.returned.ledgerDraft) || {};
  assert('L4_reconcile_next_step_brief', draft.nextStepBrief === handWritten.nextStepBrief,
    `draft=${JSON.stringify(draft.nextStepBrief || '').slice(0, 120)}`);
  assert('L4_reconcile_audit_log_row', draft.auditLogRow === handWritten.auditLogRow,
    `draft=${JSON.stringify(draft.auditLogRow || '').slice(0, 120)}`);
  assert('L4_reconcile_handoff_resume', draft.handoffResume === handWritten.handoffResume,
    `draft=${JSON.stringify(draft.handoffResume || '').slice(0, 120)}`);

  // ---------- L5 P7③：坡道观察 → REST 复盘 misfire → 账本桥 → 渲染 observe 档 ----------
  // 表由 store 的 ensureSchema 懒建（后端没写过观察时不存在）；脚本侧经**真 store**的
  // 首次查询触发建表（单一 schema 真相，不在 fixture 里手抄 DDL）。
  {
    process.env.PETRI_DB_PATH = dbPath;
    const store = require(path.join(ROOT, 'core/petri-server/helpers/policy-observation-store.js'));
    await store.unreviewedCount();
  }
  const Database = require('better-sqlite3');
  {
    const db = new Database(dbPath);
    db.prepare(
      `INSERT INTO policy_observations
         (kind, rule_id, tool_name, fingerprint, guard_key, sample_preview, hits, first_seen_at, last_seen_at)
       VALUES ('rule-observe', 'software-governed::ui-ledger-sync', 'workspace_exec', 'fp-live-1', 'rule:live', '{}', 5, ?, ?)`
    ).run(new Date().toISOString(), new Date().toISOString());
    db.close();
  }
  const pending = await rest('GET', '/ai/policy-observations');
  const pendingRow = (pending.data && pending.data.unreviewed || []).find((row) => row.ruleId === 'software-governed::ui-ledger-sync');
  assert('L5_observation_visible', Boolean(pendingRow) && pendingRow.hits === 5, `hits=${pendingRow && pendingRow.hits}`);
  const reviewed = await rest('POST', '/ai/policy-observations/review', { ids: [pendingRow.id], decision: 'misfire' });
  assert('L5_review_decision_misfire', reviewed.ok && reviewed.data && reviewed.data.updated === 1,
    `status=${reviewed.status} body=${JSON.stringify(reviewed.data)}`);
  {
    const db = new Database(dbPath, { readonly: true });
    const row = db.prepare('SELECT hits, review_decision FROM policy_observations WHERE id = ?').get(pendingRow.id);
    db.close();
    assert('L5_decision_persisted', row && row.review_decision === 'misfire' && row.hits === 5,
      `hits=${row && row.hits} decision=${row && row.review_decision}`);
    const entries = ledgerEntriesFromRows([{ ruleId: 'software-governed::ui-ledger-sync', hits: row.hits, reviewDecision: row.review_decision }]);
    const ledger = createRuleLedger({ entries });
    const status = ledger.status('software-governed', 'ui-ledger-sync');
    assert('L5_ledger_downgrade', status.mode === 'observe' && status.misfires === 5,
      `mode=${status.mode} misfires=${status.misfires}`);
    const section = renderGovernanceRuntimeSection({ workspacePath: softwareWs, ledgerEntries: entries });
    assert('L5_render_observe_mode', section.includes('[观察·待复盘] ') && section.includes('同一次提交同步实现审计台账')
      && section.includes('- [必须] '),
      '降级规则按观察档渲染，其余规则保持 [必须]');
  }

  const file = writeReport({ startedAt, backend: { port, pid: backend.pid, mockUpstreamPort: mockUpstream.port } });
  console.log(`\nevidence → ${file}`);
  if (!assertions.every((item) => item.pass)) process.exit(1);
} catch (error) {
  assert('FATAL', false, (error && error.stack) || String(error));
  writeReport({ startedAt });
  process.exit(1);
} finally {
  if (backend) killTree(backend.pid);
  if (mockUpstream) mockUpstream.stop();
}
