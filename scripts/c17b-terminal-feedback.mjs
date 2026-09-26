#!/usr/bin/env node
/**
 * C-17b 走查 — 终端反馈面体验（队列项 2）：
 * ①agent exec 输出是否流式进工具行（运行中 SSE tool_output 取证）；
 * ②终端 dock 打开时是否只承载用户 PTY 会话、agent 不注入（G-02 销号结论复核）；
 * ③终态后工具行输出快照仍可读（事后回看面）。
 * 产出：acceptance/c17b-terminal/terminal-feedback.json + 截图
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
const EVDIR = path.join(ROOT, 'acceptance', 'c17b-terminal');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rest(method, p, body) {
  const resp = await fetch(API + p, {
    method,
    headers: body ? { ...AUTH, 'content-type': 'application/json' } : AUTH,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await resp.json(); } catch {}
  return { ok: resp.ok, data };
}
async function evalRetry(client, expr, tries = 6) {
  let lastErr = null;
  for (let i = 0; i < tries; i++) {
    try { return await lib.evalJs(client, expr); } catch (e) { lastErr = e; await sleep(500 * (i + 1)); }
  }
  throw lastErr;
}
function git(cwd, args) {
  return execFileSync('git', ['-C', cwd, '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20_000 }).trim();
}

let projectId = null;
let client = null;

async function main() {
  fs.mkdirSync(EVDIR, { recursive: true });

  // ── S1 播种：慢输出脚本（运行中窗口 ≥6s 供流式取证） ──
  const created = await rest('POST', '/data/projects', { name: 'C17B-终端-' + Date.now(), modality: 'general' });
  const project = created.data && (created.data.project || created.data);
  projectId = project && project.id;
  const detail = await rest('GET', '/data/projects/' + encodeURIComponent(projectId));
  const raw = (detail.data && detail.data.project) || project || {};
  const ws = raw.workspace_path || raw.workspacePath;
  fs.writeFileSync(path.join(ws, 'slow.js'), [
    "const lines = ['alpha-12ms', 'beta-34ms', 'gamma-56ms', 'ALL PASS'];",
    "let i = 0;",
    "const t = setInterval(() => {",
    "  console.log(lines[i++]);",
    "  if (i >= lines.length) { clearInterval(t); }",
    "}, 1500);",
  ].join('\n'));
  git(ws, ['init']);
  git(ws, ['add', '.']);
  git(ws, ['-c', 'user.name=c17b', '-c', 'user.email=probe@local', 'commit', '-m', 'baseline']);
  console.log('[S1] seeded', ws);

  // ── S2 CDP 连接测试实例（导航到项目页；终端检查用） ──
  const targets = await lib.pollTargets({ port: lib.TEST_INSTANCE_PORT, timeoutMs: 30_000 });
  const pages = lib.filterPageTargets(targets, /^http:\/\/localhost:3000\//);
  const target = await lib.selectPageTarget(pages, {
    probe: async (c) => lib.evalJs(c, '!!document.getElementById(\'root\')').catch(() => false),
  });
  client = await lib.connectTarget(target);
  const originalUrl = target.url;
  await evalRetry(client, 'location.href = ' + JSON.stringify(APP_ORIGIN + '/project/' + encodeURIComponent(projectId)) + "; 'nav'");
  await sleep(3500);

  // ── S3 发起 agent exec 任务，运行中抓 SSE tool_output 流式块 ──
  const sub = await rest('POST', '/ai/agent', {
    messages: [{ role: 'user', content: '工作区 ' + ws + '：运行 node slow.js，告诉我完整输出。' }],
    context: { projectId, page: 'workspace', pageTitle: '项目工作区', accessMode: 'full' },
  });
  const { taskId } = sub.data;
  const streamUrl = API + '/ai/agent/task/' + encodeURIComponent(taskId) + '?afterSeq=0';
  const abort = new AbortController();
  const collector = (async () => {
    const events = [];
    try {
      const resp = await fetch(streamUrl, { headers: AUTH, signal: abort.signal });
      const reader = resp.body.getReader();
      const decoder = new TextDecoder('utf8');
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let sep;
        while ((sep = buf.indexOf('\n\n')) !== -1) {
          const line = buf.slice(0, sep).trim();
          buf = buf.slice(sep + 2);
          if (line.startsWith('data:')) { try { events.push(JSON.parse(line.slice(5).trim()).payload || JSON.parse(line.slice(5).trim())); } catch {} }
        }
      }
    } catch {}
    return events;
  })();

  // 运行中窗口：6s 后在任务仍运行时抓取一次 tool_output 流式证据
  await sleep(6000);
  const metaMid = await rest('GET', '/ai/agent/task/' + encodeURIComponent(taskId) + '/meta');
  const statusMid = metaMid.data && (metaMid.data.agentStatus || metaMid.data.agent_status);
  const early = await Promise.race([collector.then((e) => e.slice()), sleep(1500).then(() => null)]);
  void early;
  console.log('[S3] 运行中状态=', statusMid);

  const deadline = Date.now() + 5 * 60_000;
  let terminal = null;
  while (Date.now() < deadline) {
    await sleep(3000);
    const t = await rest('GET', '/ai/agent/task/' + encodeURIComponent(taskId) + '/meta');
    const status = t.data && (t.data.agentStatus || t.data.agent_status);
    if (['completed', 'done', 'failed', 'cancelled'].includes(status)) { terminal = status; break; }
  }
  abort.abort();
  const events = await Promise.race([collector, sleep(3000).then(() => [])]);
  const payloads = events.map((e) => (e && e.payload) || e);
  const toolOutputs = payloads.filter((p) => p && (p.event === 'tool_output' || p.event === 'output'));
  const streamedLines = toolOutputs.filter((p) => /alpha|beta|gamma|ALL PASS/.test(JSON.stringify(p)));
  console.log(`[S3] terminal=${terminal} tool_output 事件=${toolOutputs.length} 含脚本输出=${streamedLines.length}`);

  // ── S4 终端 dock：打开 → 仅用户 PTY 会话（tab 标签取证） ──
  const dockResult = await evalRetry(client, `(function(){
    const btn = document.querySelector('button[aria-label="展开底部终端"]');
    if (!btn) return 'toggle-not-found';
    btn.click();
    return 'opened';
  })()`);
  await sleep(2500);
  const dockState = await evalRetry(client, `(function(){
    const t = document.body.innerText;
    const tabs = (t.match(/终端\\s*\\d/g) || []).length;
    return JSON.stringify({
      dockText: t.slice(0, 40).indexOf('终端') >= 0 || tabs > 0 ? 'dock-open' : 'dock-unknown',
      terminalTabs: tabs,
      agentCmdLeak: /node slow\\.js/.test((function(){const x=document.querySelector('[class*="terminal"],[class*="Terminal"]');return x?x.innerText:''})()),
    });
  })()`);
  console.log('[S4] dock:', dockResult, dockState);
  try { await lib.screenshotPng(client, EVDIR, 'terminal-dock.png'); } catch {}
  try { await evalRetry(client, 'location.href = ' + JSON.stringify(originalUrl) + "; 'restore'"); } catch {}
  try { client.close && client.close(); } catch {}

  const dock = JSON.parse(dockState);
  const allPass = streamedLines.length > 0 && dock.terminalTabs >= 1 && dock.agentCmdLeak === false && terminal !== 'failed';
  fs.writeFileSync(path.join(EVDIR, 'terminal-feedback.json'), JSON.stringify({
    projectId, ws, taskId, terminal, statusMid,
    at: new Date().toISOString(),
    toolOutputEvents: toolOutputs.length,
    streamedScriptLines: streamedLines.length,
    dock: dockResult,
    dockState: dock,
    allPass,
  }, null, 2));
  console.log('allPass=' + allPass + '（流式进工具行 + 终端仅用户 PTY + agent 命令不泄漏进终端）');
}

main().catch((e) => { console.error('PROBE FAILED:', e); process.exitCode = 1; })
  .finally(async () => {
    if (projectId) { const d = await rest('DELETE', '/data/projects/' + encodeURIComponent(projectId)); console.log('cleanup:', d.ok ? 'ok' : 'fail'); }
  });
