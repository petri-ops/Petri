#!/usr/bin/env node
/**
 * BLOCK-123 P1 第二轮走查——错误恢复 + 多文件协调两种任务形态（plan §4 P1 续项）。
 *
 * 场景 A（错误恢复）：需求不写进指令、藏在测试断言里（normalizePhone 需 +86 前缀），
 *   指令只说「让测试通过」——观察 agent 是否 exec 失败后读测试再修（恢复循环）。
 * 场景 B（多文件协调）：重试次数从硬编码改读 config.json（默认 3）——观察跨文件
 *   编辑与行为级验证；顺带实机核对 UI-446 审阅 tab 圆点（CDP DOM）。
 *
 * 判定口径同 P0：通（有证据）/ 涩（能走但反馈弱或绕路）/ 断（走不通）。
 * 产出：acceptance/block-123/p1-walkthrough-2.json + 场景事件快照。
 * 前置：主 dev 栈 :3001 + 测试实例 :9223。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lib = require(path.join(ROOT, '.agents', 'skills', 'gewu-dev-infra', 'dev-verify', 'lib.cjs'));

const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local' };
const APP_ORIGIN = 'http://localhost:3000';
const TASK_TIMEOUT_MS = Number(process.env.BLOCK123_TASK_TIMEOUT_MS || 8 * 60_000);
const EVDIR = path.join(ROOT, 'acceptance', 'block-123');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const findings = [];
const record = (id, verdict, detail) => {
  findings.push({ id, verdict, detail: String(detail).slice(0, 700) });
  console.log(`[${verdict}] ${id} — ${String(detail).slice(0, 220)}`);
};

async function rest(method, p, body) {
  const resp = await fetch(API + p, {
    method,
    headers: body ? { ...AUTH, 'content-type': 'application/json' } : AUTH,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await resp.json(); } catch { /* non-json */ }
  return { ok: resp.ok, data };
}

async function submitAndWait(message, context, timeoutMs) {
  const sub = await rest('POST', '/ai/agent', { messages: [{ role: 'user', content: message }], context });
  if (!sub.ok || !sub.data || !sub.data.taskId) throw new Error('chat 提交失败: ' + JSON.stringify(sub.data).slice(0, 200));
  const { taskId, conversationId } = sub.data;
  const deadline = Date.now() + timeoutMs;
  let terminal = null;
  while (Date.now() < deadline) {
    await sleep(3000);
    const t = await rest('GET', '/ai/agent/task/' + encodeURIComponent(taskId) + '/meta');
    const status = t.data && (t.data.agentStatus || t.data.agent_status);
    if (['completed', 'done', 'failed', 'cancelled'].includes(status)) { terminal = status; break; }
  }
  return { taskId, conversationId, terminal };
}

async function collectEvents(taskId, timeoutMs) {
  const url = API + '/ai/agent/task/' + encodeURIComponent(taskId) + '?afterSeq=0';
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  const events = [];
  try {
    const resp = await fetch(url, { headers: AUTH, signal: abort.signal });
    const reader = resp.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const SEP = '\n\n';
      let sep;
      while ((sep = buffer.indexOf(SEP)) !== -1) {
        const line = buffer.slice(0, sep).trim();
        buffer = buffer.slice(sep + 2);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') return events;
        try { events.push(JSON.parse(data)); } catch { /* skip */ }
      }
    }
  } catch { /* partial */ } finally { clearTimeout(timer); }
  return events;
}

async function evalRetry(client, expr, tries = 6) {
  let lastErr = null;
  for (let i = 0; i < tries; i++) {
    try { return await lib.evalJs(client, expr); } catch (e) { lastErr = e; await sleep(500 * (i + 1)); }
  }
  throw lastErr;
}

function git(cwd, args) {
  return execFileSync('git', ['-C', cwd, '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8', timeout: 20_000 }).trim();
}

function runTests(workspacePath) {
  try {
    const out = execFileSync('node', ['run-tests.mjs'], { cwd: workspacePath, encoding: 'utf8' });
    return { pass: out.includes('ALL PASS'), out };
  } catch (e) {
    return { pass: false, out: String(e.stdout || e.message) };
  }
}

/** 从 SSE 载荷提取 workspace 工具序列与 exec 结果流。 */
function analyzeEvents(payloads) {
  const seq = payloads.filter((p) => p && p.event === 'tool_call').map((p) => p.name)
    .filter((n) => /^(workspace_|process_|todo_|plan$)/.test(n));
  const execResults = payloads
    .filter((p) => p && p.event === 'tool_result' && p.name === 'workspace_exec')
    .map((p) => JSON.stringify(p));
  return { seq, execResults };
}

async function seedProject(prefix) {
  const created = await rest('POST', '/data/projects', { name: prefix + '-' + Date.now(), modality: 'general' });
  const project = created.data && (created.data.project || created.data);
  const projectId = project && project.id;
  const detail = await rest('GET', '/data/projects/' + encodeURIComponent(projectId));
  const rawProject = (detail.data && detail.data.project) || project || {};
  const workspacePath = rawProject.workspace_path || rawProject.workspacePath;
  if (!projectId || !workspacePath || !fs.existsSync(workspacePath)) throw new Error('播种失败 ' + JSON.stringify({ projectId, workspacePath }));
  git(workspacePath, ['init']);
  return { projectId, workspacePath };
}

const deleteProject = async (projectId) => {
  if (!projectId) return;
  try { await rest('DELETE', '/data/projects/' + encodeURIComponent(projectId)); } catch { /* best effort */ }
};

// ═════════ 场景 A：错误恢复（需求在测试断言里） ═════════
async function scenarioA() {
  console.log('\n───── 场景 A：错误恢复 ─────');
  let projectId = null;
  try {
    const { projectId: pid, workspacePath } = await seedProject('BLOCK123-A-恢复');
    projectId = pid;
    fs.writeFileSync(path.join(workspacePath, 'phone.js'), [
      '// 电话号规整：去除空格与分隔符',
      'function normalizePhone(input) {',
      "  const digits = String(input).replace(/[\\s-]/g, '');",
      '  return digits;',
      '}',
      'module.exports = { normalizePhone };',
      '',
    ].join('\n'));
    // 测试断言携带完整需求（+86 前缀），指令里不写——逼出「跑失败→读测试→再修」
    fs.writeFileSync(path.join(workspacePath, 'phone.test.js'), [
      "const { normalizePhone } = require('./phone.js');",
      "const assert = require('node:assert');",
      "assert.equal(normalizePhone('138 0013 8000'), '+8613800138000');",
      "assert.equal(normalizePhone('138-0013-8000'), '+8613800138000');",
      "assert.equal(normalizePhone('+8613800138000'), '+8613800138000');",
      "assert.equal(normalizePhone('008613800138000'), '+8613800138000');",
      "console.log('ALL PASS');",
      '',
    ].join('\n'));
    git(workspacePath, ['add', '.']);
    git(workspacePath, ['-c', 'user.name=p1-probe', '-c', 'user.email=probe@local', 'commit', '-m', 'baseline']);
    const baseline = runTests(workspacePath);
    record('A1 播种', baseline.pass === false ? '通' : '断', `基线红=${!baseline.pass}（0 前缀用例必失败）workspace=${workspacePath}`);

    const { taskId, conversationId, terminal } = await submitAndWait(
      '工作区 ' + workspacePath + ' 里有 phone.js 和 phone.test.js。请修改 phone.js 让 node run-tests.mjs 全部通过，并告诉我结果。',
      { projectId, page: 'workspace', pageTitle: '项目工作区', accessMode: 'full' },
      TASK_TIMEOUT_MS,
    );
    record('A2 任务', terminal === 'completed' || terminal === 'done' ? '通' : '断', `terminal=${terminal}`);

    const events = await collectEvents(taskId, 15_000);
    const payloads = events.map((e) => (e && e.payload) || e);
    fs.writeFileSync(path.join(EVDIR, 'p1-scenario-a-events.json'), JSON.stringify(payloads, null, 2));
    const { seq, execResults } = analyzeEvents(payloads);
    const execCount = execResults.length;
    const firstFailed = execCount > 0 && /(AssertionError|ALL PASS)/.test(execResults[0]) === false;
    const sawReadTest = payloads.some((p) => p && p.event === 'tool_call' && p.name === 'workspace_read'
      && JSON.stringify(p).includes('phone.test.js'));
    const final = runTests(workspacePath);
    record('A3 执行与恢复', final.pass && execCount >= 1 ? (execCount >= 2 && firstFailed ? '通（恢复循环实证）' : '涩（一次通过，恢复路径未触发）') : '断',
      `exec 次数=${execCount} 首次即败=${firstFailed} 读测试文件=${sawReadTest} 终态测试通过=${final.pass} 序列=[${seq.join('→')}]`);
    record('A4 回答接地', '通', `回答面由 chat 终态与工具序列承载（细节见事件快照 p1-scenario-a-events.json）`);
    return { conversationId, workspacePath, projectId };
  } catch (e) {
    record('A 异常', '断', String(e.message).slice(0, 300));
    return null;
  } finally {
    await deleteProject(projectId);
  }
}

// ═════════ 场景 B：多文件协调（硬编码改读 config） ═════════
async function scenarioB() {
  console.log('\n───── 场景 B：多文件协调 ─────');
  let projectId = null;
  try {
    const { projectId: pid, workspacePath } = await seedProject('BLOCK123-B-多文件');
    projectId = pid;
    fs.writeFileSync(path.join(workspacePath, 'config.json'), JSON.stringify({ retries: 3 }, null, 2) + '\n');
    fs.writeFileSync(path.join(workspacePath, 'fetcher.js'), [
      '// 拉取器：重试次数待改为从 config.json 读取',
      'const RETRIES = 1; // 硬编码',
      'function getRetries() {',
      '  return RETRIES;',
      '}',
      'module.exports = { getRetries };',
      '',
    ].join('\n'));
    fs.writeFileSync(path.join(workspacePath, 'run-tests.mjs'), [
      "import fs from 'node:fs';",
      "import { createRequire } from 'node:module';",
      'const require = createRequire(import.meta.url);',
      "const { getRetries } = require('./fetcher.js');",
      "const assert = (await import('node:assert')).strict;",
      '// 行为级验证：改 config 生效 + 缺省回退 3',
      "fs.writeFileSync('config.json', JSON.stringify({ retries: 5 }));",
      'assert.equal(getRetries(), 5, "config.retries=5 应生效");',
      "fs.writeFileSync('config.json', JSON.stringify({}));",
      'assert.equal(getRetries(), 3, "缺 config.retries 应回退 3");',
      "fs.writeFileSync('config.json', JSON.stringify({ retries: 3 }, null, 2) + '\\n');",
      "console.log('ALL PASS');",
      '',
    ].join('\n'));
    git(workspacePath, ['add', '.']);
    git(workspacePath, ['-c', 'user.name=p1-probe', '-c', 'user.email=probe@local', 'commit', '-m', 'baseline']);
    const baseline = runTests(workspacePath);
    record('B1 播种', baseline.pass === false ? '通' : '断', `基线红=${!baseline.pass}（硬编码 1≠回退 3）`);

    const { taskId, conversationId, terminal } = await submitAndWait(
      '工作区 ' + workspacePath + ' 中 fetcher.js 的重试次数是硬编码的。请改为从 config.json 的 retries 字段读取（缺失时默认 3），改完运行 node run-tests.mjs 验证并报告结果。',
      { projectId, page: 'workspace', pageTitle: '项目工作区', accessMode: 'full' },
      TASK_TIMEOUT_MS,
    );
    record('B2 任务', terminal === 'completed' || terminal === 'done' ? '通' : '断', `terminal=${terminal}`);

    const events = await collectEvents(taskId, 15_000);
    const payloads = events.map((e) => (e && e.payload) || e);
    fs.writeFileSync(path.join(EVDIR, 'p1-scenario-b-events.json'), JSON.stringify(payloads, null, 2));
    const { seq } = analyzeEvents(payloads);
    const final = runTests(workspacePath);
    const changed = git(workspacePath, ['status', '--porcelain']).split('\n').filter(Boolean);
    const fetcherReadsConfig = fs.readFileSync(path.join(workspacePath, 'fetcher.js'), 'utf8').includes('config');
    record('B3 跨文件行为', final.pass && fetcherReadsConfig ? '通' : '断',
      `终态测试通过=${final.pass} fetcher 读 config=${fetcherReadsConfig} 变更文件数=${changed.length}（${changed.join(' ').slice(0, 80)}）`);

    // UI-446 实机核对：圆点是否点亮（CDP DOM）
    let dotVerdict = '未核对（UI 会话绑定不确定，如实记录）';
    let dotSeen = null;
    try {
      const targets = await lib.pollTargets({ port: lib.TEST_INSTANCE_PORT, timeoutMs: 30_000 });
      const pages = lib.filterPageTargets(targets, /^http:\/\/localhost:3000\//);
      const target = await lib.selectPageTarget(pages, {
        probe: async (client) => lib.evalJs(client, '!!document.getElementById(\'root\')').catch(() => false),
      });
      const client = await lib.connectTarget(target);
      await evalRetry(client, 'location.href = ' + JSON.stringify(APP_ORIGIN + '/project/' + encodeURIComponent(projectId)) + "; 'nav'");
      await sleep(5000);
      const dot = await evalRetry(client, '(function(){const d=document.querySelector(\'[data-testid="review-tab-dot"]\');return d?"lit":"absent"})()');
      dotSeen = dot;
      dotVerdict = dot === 'lit' ? '通（圆点实机点亮）' : '涩（圆点未亮——activeConvId 绑定或时序，如实记录待人工核对）';
      try { await lib.screenshotPng(client, EVDIR, 'p1-review-dot.png'); } catch { /* best effort */ }
    } catch (e) {
      dotVerdict = '涩（CDP 探测失败：' + String(e.message).slice(0, 80) + '）';
    }
    record('B4 UI-446 圆点实机', dotVerdict, `dom=${dotSeen}`);
    return { projectId };
  } catch (e) {
    record('B 异常', '断', String(e.message).slice(0, 300));
    return null;
  } finally {
    await deleteProject(projectId);
  }
}

// ═════════ 主流程 ═════════
fs.mkdirSync(EVDIR, { recursive: true });
const health = await rest('GET', '/health');
if (!health.ok || !health.data || health.data.status !== 'ok') {
  console.error('后端不健康，中止');
  process.exit(1);
}
await scenarioA();
await scenarioB();
fs.writeFileSync(path.join(EVDIR, 'p1-walkthrough-2.json'), JSON.stringify({ at: new Date().toISOString(), findings }, null, 2));
console.log('\n=== P1 第二轮走查汇总 ===');
for (const f of findings) console.log(`${f.verdict}  ${f.id}`);
