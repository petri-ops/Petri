#!/usr/bin/env node
/**
 * BLOCK-123 P0 — 通用编码 harness 端到端任务对账探针（plan §4 六环节走查协议）。
 *
 * 任务语义：临时项目 + 带 bug 的小脚本（git 基线）→ 真实 chat 指令「修 bug 并跑测试」→
 * 观察 agent 是否走通 workspace_read → workspace_replace/write → workspace_exec 全链，
 * 以及 UI 反馈面（文件树/审阅 tab/chat 回答）在每一环节是否给到可用反馈。
 *
 * 判定口径：每环节 通（有证据）/ 涩（能走但绕路或反馈弱，记具体表现）/ 断（走不通，记现场）。
 * 产出：acceptance/block-123/p0-walkthrough.json（机器）+ p0-walkthrough.log.txt（人读）。
 * 前置：主 dev 栈 :3001 + Vite :3000 + 测试实例 CDP :9223（start-test-instance.sh）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lib = require(path.join(ROOT, '.agents', 'skills', 'petri-dev-infra', 'dev-verify', 'lib.cjs'));

const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local' };
const APP_ORIGIN = 'http://localhost:3000';
const TASK_TIMEOUT_MS = Number(process.env.BLOCK123_TASK_TIMEOUT_MS || 8 * 60_000);
const EVDIR = path.join(ROOT, 'acceptance', 'block-123');

const stages = [];
const record = (stage, verdict, detail) => {
  stages.push({ stage, verdict, detail: String(detail).slice(0, 600) });
  console.log(`[${verdict}] ${stage} — ${String(detail).slice(0, 200)}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  } catch { /* timeout: return partial */ } finally { clearTimeout(timer); }
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
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
}

// ── 播种物：带 bug 的 utils.js + 普通断言测试 ──
const UTILS_JS = [
  '// demo: 简单算术工具',
  'function add(a, b) { return a + b; }',
  'function divide(a, b) {',
  '  // TODO: divide by zero 应该抛错（当前 bug：返回 Infinity/NaN）',
  '  return a / b;',
  '}',
  'module.exports = { add, divide };',
  '',
].join('\n');
const UTILS_TEST_JS = [
  "const { add, divide } = require('./utils.js');",
  "const assert = require('node:assert');",
  'assert.equal(add(2, 3), 5);',
  "assert.throws(() => divide(1, 0), /zero|除以零|divisor/i, 'divide(1,0) 应抛除零错误');",
  "assert.throws(() => divide(5, 0), /zero|除以零|divisor/i);",
  "console.log('all tests passed');",
  '',
].join('\n');

let projectId = null;
let cdpClient = null;
let originalUrl = null;

try {
  fs.mkdirSync(EVDIR, { recursive: true });
  // ── S1 播种 ──
  const health = await rest('GET', '/health');
  if (!health.ok || !health.data || health.data.status !== 'ok') throw new Error('后端不健康: ' + JSON.stringify(health.data).slice(0, 120));
  const created = await rest('POST', '/data/projects', { name: 'BLOCK123-走验-' + Date.now(), modality: 'general' });
  const project = created.data && (created.data.project || created.data);
  projectId = project && project.id;
  if (!projectId) throw new Error('项目创建失败: ' + JSON.stringify(created.data).slice(0, 140));
  const detail = await rest('GET', '/data/projects/' + encodeURIComponent(projectId));
  const rawProject = (detail.data && detail.data.project) || project || {};
  const workspacePath = rawProject.workspace_path || rawProject.workspacePath;
  if (!workspacePath || !fs.existsSync(workspacePath)) throw new Error('workspace 未解析: ' + String(workspacePath));
  fs.writeFileSync(path.join(workspacePath, 'utils.js'), UTILS_JS);
  fs.writeFileSync(path.join(workspacePath, 'utils.test.js'), UTILS_TEST_JS);
  git(workspacePath, ['init']);
  git(workspacePath, ['add', '.']);
  git(workspacePath, ['-c', 'user.name=p0-probe', '-c', 'user.email=probe@local', 'commit', '-m', 'baseline: buggy divide']);
  // 基线确认：测试当前是红的（bug 在场）
  let baselineRed = false;
  try { execFileSync('node', ['utils.test.js'], { cwd: workspacePath }); } catch { baselineRed = true; }
  record('S1 播种', '通', `projectId=${projectId} workspace=${workspacePath} 基线红=${baselineRed}`);

  // ── S2 指令（真实模型）──
  const instruction =
    '工作区 ' + workspacePath + ' 里有两个文件 utils.js 和 utils.test.js。' +
    'utils.js 的 divide 函数有 bug：divide(1, 0) 返回 Infinity 而不是抛错。' +
    '请修复这个 bug（除数为 0 时抛出包含 zero 的错误），然后运行 node utils.test.js 验证，' +
    '并告诉我测试是否全部通过。';
  const started = Date.now();
  const { taskId, conversationId, terminal } = await submitAndWait(
    instruction,
    { projectId, page: 'workspace', pageTitle: '项目工作区', accessMode: 'full' },
    TASK_TIMEOUT_MS,
  );
  record('S2 指令', terminal === 'completed' || terminal === 'done' ? '通' : '断',
    `taskId=${taskId} terminal=${terminal} 耗时=${Math.round((Date.now() - started) / 1000)}s`);

  // ── S3 读取与编辑（SSE 工具序列取证）──
  const events = await collectEvents(taskId, 15_000);
  const payloads = events.map((e) => (e && e.payload) || e);
  const toolSeq = payloads
    .filter((p) => p && p.event === 'tool_call')
    .map((p) => p.name)
    .filter((n) => /^workspace_|^process_|^todo_|^plan$/.test(n));
  fs.writeFileSync(path.join(EVDIR, 'p0-events.json'), JSON.stringify(payloads, null, 2));
  const sawRead = toolSeq.some((n) => n === 'workspace_read' || n === 'workspace_search' || n === 'workspace_find');
  const sawEdit = toolSeq.some((n) => n === 'workspace_write' || n === 'workspace_replace');
  record('S3 读取与编辑', sawRead && sawEdit ? '通' : (sawEdit ? '涩' : '断'),
    `工具序列=[${toolSeq.join(' → ')}] 读=${sawRead} 编辑=${sawEdit}`);

  // ── S4 执行验证 ──
  const sawExec = toolSeq.some((n) => n === 'workspace_exec' || n === 'workspace_exec_background');
  const fixedUtils = fs.readFileSync(path.join(workspacePath, 'utils.js'), 'utf8');
  let testPassNow = false;
  let testOutput = '';
  try {
    testOutput = execFileSync('node', ['utils.test.js'], { cwd: workspacePath, encoding: 'utf8' });
    testPassNow = testOutput.includes('all tests passed');
  } catch (e) { testOutput = String(e.stdout || e.message); }
  record('S4 执行验证', sawExec && testPassNow ? '通' : (testPassNow ? '涩' : '断'),
    `agent 调 exec=${sawExec} 盘面已修复=${/throw/.test(fixedUtils)} 探针复跑测试通过=${testPassNow} 输出=${testOutput.trim().slice(0, 80)}`);

  // ── S5 反馈面（CDP 实机）──
  const targets = await lib.pollTargets({ port: lib.TEST_INSTANCE_PORT, timeoutMs: 30_000 });
  const pages = lib.filterPageTargets(targets, /^http:\/\/localhost:3000\//);
  if (!pages.length) throw new Error('测试实例无应用页面目标——请先 bash scripts/start-test-instance.sh');
  const target = await lib.selectPageTarget(pages, {
    probe: async (client) => lib.evalJs(client, '!!document.getElementById(\'root\')').catch(() => false),
  });
  const client = await lib.connectTarget(target);
  cdpClient = client;
  originalUrl = target.url;
  await evalRetry(client, 'location.href = ' + JSON.stringify(APP_ORIGIN + '/project/' + encodeURIComponent(projectId)) + '; \'navigating\'');
  await sleep(4000);
  const uiProbe = await evalRetry(client, `(function(){
    const t = document.body.innerText;
    return JSON.stringify({
      fileTreeHasUtils: t.indexOf('utils.js') >= 0,
      reviewTabPresent: t.indexOf('审阅') >= 0,
      changedHint: (t.match(/\\d+\\s*(个变更|changed|修改)/) || [null])[0],
      diffVisible: t.indexOf('-') >= 0 && (t.indexOf('divide') >= 0),
      terminalTab: t.indexOf('终端') >= 0
    });
  })()`);
  let ui = {};
  try { ui = JSON.parse(uiProbe); } catch { /* keep empty */ }
  let shotOk = false;
  try {
    await lib.screenshotPng(client, EVDIR, 'p0-workspace.png');
    shotOk = fs.existsSync(path.join(EVDIR, 'p0-workspace.png'));
  } catch { /* 截图失败不阻塞 */ }
  record('S5 反馈面', ui.fileTreeHasUtils && ui.reviewTabPresent ? '通' : '涩',
    `DOM 探针=${JSON.stringify(ui)}（截图=${shotOk ? '有' : '无'}；选择器为最佳猜测，涩/断表现见截图与 innerText 取证）`);
  const bodyText = await evalRetry(client, 'document.body.innerText.slice(0, 3000)');
  fs.writeFileSync(path.join(EVDIR, 'p0-workspace-innertext.txt'), String(bodyText));

  // ── S6 审阅与提交 ──
  const gitStatus = git(workspacePath, ['status', '--porcelain']);
  const diffStat = git(workspacePath, ['diff', '--stat']);
  const commitProbe = await evalRetry(client, `(function(){
    const t = document.body.innerText;
    return JSON.stringify({
      hasAccept: t.indexOf('接受') >= 0 || t.indexOf('采纳') >= 0,
      hasReject: t.indexOf('拒绝') >= 0 || t.indexOf('驳回') >= 0,
      hasCommit: t.indexOf('提交') >= 0,
      hasDiffView: !!document.querySelector('.cm-diff, [class*="diff"], [class*="Diff"]')
    });
  })()`);
  let s6 = {};
  try { s6 = JSON.parse(commitProbe); } catch { /* keep empty */ }
  const gitSeesChange = /M\s+utils\.js/.test(gitStatus) || gitStatus.includes('utils.js');
  record('S6 审阅与提交', gitSeesChange && s6.hasDiffView ? '通' : (gitSeesChange ? '涩' : '断'),
    `git 识别变更=${gitSeesChange}（${gitStatus.split('\n')[0] || 'clean'}）diff stat=${diffStat.replace(/\n/g, ' ')} DOM=${JSON.stringify(s6)}`);

  // ── 汇总 ──
  const summary = { projectId, workspacePath, taskId, conversationId, at: new Date().toISOString(), stages };
  fs.writeFileSync(path.join(EVDIR, 'p0-walkthrough.json'), JSON.stringify(summary, null, 2));
  console.log('\n=== P0 走查汇总 ===');
  for (const s of stages) console.log(`${s.verdict}  ${s.stage}`);
} finally {
  // ── 清理必达 ──
  const marks = [];
  if (projectId) {
    const d = await rest('DELETE', '/data/projects/' + encodeURIComponent(projectId));
    marks.push('project=' + d.ok);
  }
  if (cdpClient && originalUrl) {
    try {
      await evalRetry(cdpClient, 'location.href = ' + JSON.stringify(originalUrl) + "; 'restoring'");
      marks.push('restored=true');
    } catch { marks.push('restored=eval_failed'); }
  }
  console.log('cleanup:', marks.join(' '));
}
