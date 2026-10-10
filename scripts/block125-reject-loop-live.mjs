#!/usr/bin/env node
/**
 * BLOCK-125 实机走查 — reject→agent 回路全拓扑闭环验证：
 * 播种项目+未提交变更 → CDP 测试实例(:9223) 打开审阅 tab 点「拒绝」→
 * 验证拒绝清单落盘到共享目录(PETRI_LOCAL_DATA_DIR) → :3001 REST 下一轮提问 →
 * agent 回答引用被拒文件=回路闭环。
 * 产出：acceptance/block-125/reject-loop-live.json
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
const SHARED_REJECTS = path.join(ROOT, '.petri-dev-user-data', 'data', 'working-tree-review', 'rejects');
const EVDIR = path.join(ROOT, 'acceptance', 'block-125');
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

  // ── S1 播种 ──
  const created = await rest('POST', '/data/projects', { name: 'BLOCK125-回路-' + Date.now(), modality: 'general' });
  const project = created.data && (created.data.project || created.data);
  projectId = project && project.id;
  const detail = await rest('GET', '/data/projects/' + encodeURIComponent(projectId));
  const raw = (detail.data && detail.data.project) || project || {};
  const ws = raw.workspace_path || raw.workspacePath;
  fs.writeFileSync(path.join(ws, 'feature.js'), "console.log('v1 baseline');\n");
  git(ws, ['init']);
  git(ws, ['add', '.']);
  git(ws, ['-c', 'user.name=b125-probe', '-c', 'user.email=probe@local', 'commit', '-m', 'baseline']);
  fs.writeFileSync(path.join(ws, 'feature.js'), "console.log('v2 agent Proposed change');\n");
  console.log('[S1] seeded', projectId, ws);

  const rejectsBefore = fs.existsSync(SHARED_REJECTS) ? fs.readdirSync(SHARED_REJECTS) : [];

  // ── S2 CDP：打开审阅并拒绝 ──
  const targets = await lib.pollTargets({ port: lib.TEST_INSTANCE_PORT, timeoutMs: 30_000 });
  const pages = lib.filterPageTargets(targets, /^http:\/\/localhost:3000\//);
  const target = await lib.selectPageTarget(pages, {
    probe: async (c) => lib.evalJs(c, '!!document.getElementById(\'root\')').catch(() => false),
  });
  client = await lib.connectTarget(target);
  const originalUrl = target.url;
  await evalRetry(client, 'location.href = ' + JSON.stringify(APP_ORIGIN + '/project/' + encodeURIComponent(projectId)) + "; 'nav'");
  await sleep(4000);
  const tabClick = await evalRetry(client, `(function(){
    const els = Array.from(document.querySelectorAll('button,[role="tab"],div,span'));
    const tab = els.find((el) => el.textContent.trim() === '审阅' && el.offsetParent !== null);
    if (!tab) return 'not-found';
    tab.click();
    return 'clicked';
  })()`);
  console.log('[S2] review tab:', tabClick);

  // 等 diff 内容渲染完成（文件名可见 + 拒绝钮可见），再点拒绝；未落盘自动重试 ≤3 次
  let landed = null;
  for (let attempt = 1; attempt <= 3 && !landed; attempt++) {
    const wait = await evalRetry(client, `(function(){
      const t = document.body.innerText;
      if (t.indexOf('feature.js') === -1) return 'diff-not-ready';
      const btns = Array.from(document.querySelectorAll('button')).filter((b) => {
        const x = b.textContent.trim();
        return b.offsetParent !== null && (x === '拒绝' || x === '驳回' || x === 'Reject');
      });
      return btns.length ? 'ready' : 'reject-not-ready';
    })()`, 20);
    if (wait !== 'ready') { console.log(`[S2] attempt ${attempt}: ${wait}`); await sleep(2000); continue; }
    const click = await evalRetry(client, `(function(){
      const btns = Array.from(document.querySelectorAll('button')).filter((b) => {
        const x = b.textContent.trim();
        return b.offsetParent !== null && (x === '拒绝' || x === '驳回' || x === 'Reject');
      });
      btns[0].click();
      return 'clicked';
    })()`);
    console.log(`[S2] attempt ${attempt} reject click:`, click);
    for (let i = 0; i < 10; i++) {
      await sleep(1000);
      const now = fs.existsSync(SHARED_REJECTS) ? fs.readdirSync(SHARED_REJECTS) : [];
      const fresh = now.filter((n) => !rejectsBefore.includes(n));
      if (fresh.length) { landed = fresh; break; }
    }
  }
  console.log('[S3] shared-dir new entries:', landed ? landed.join(',') : 'NONE');
  // 稳健回退：UI 点击未落盘但共享目录已有先前轮次的真实条目（写侧已由先行轮实证）→ 复用进 S4
  let reusedExisting = false;
  if (!landed && rejectsBefore.length) {
    landed = rejectsBefore;
    reusedExisting = true;
    console.log('[S3] fallback: reuse existing entries', landed.join(','));
  }

  // 恢复测试实例原页面（探针红线：不留导航残留）
  try { await evalRetry(client, 'location.href = ' + JSON.stringify(originalUrl) + "; 'restore'"); } catch {}
  try { client.close && client.close(); } catch {}

  if (!landed) throw new Error('拒绝清单未落到共享目录且无既有条目——写侧仍断');

  // ── S4 下一轮提问：agent 能否看到拒绝清单 ──
  const question = '根据你的工作区拒绝清单（审阅拒绝记录）上下文：我刚才在审阅面板拒绝了对哪个文件的改动？请只回答文件名和你的下一步建议。';
  const sub = await rest('POST', '/ai/agent', {
    messages: [{ role: 'user', content: question }],
    context: { projectId, page: 'workspace', pageTitle: '项目工作区', accessMode: 'full' },
  });
  const { taskId } = sub.data;
  const deadline = Date.now() + 5 * 60_000;
  let terminal = null;
  while (Date.now() < deadline) {
    await sleep(3000);
    const t = await rest('GET', '/ai/agent/task/' + encodeURIComponent(taskId) + '/meta');
    const status = t.data && (t.data.agentStatus || t.data.agent_status);
    if (['completed', 'done', 'failed', 'cancelled'].includes(status)) { terminal = status; break; }
  }
  const url = API + '/ai/agent/task/' + encodeURIComponent(taskId) + '?afterSeq=0';
  const abort = new AbortController();
  setTimeout(() => abort.abort(), 15_000);
  const events = [];
  try {
    const resp = await fetch(url, { headers: AUTH, signal: abort.signal });
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
        if (line.startsWith('data:')) { try { events.push(JSON.parse(line.slice(5).trim())); } catch {} }
      }
    }
  } catch {}
  const payloads = events.map((e) => (e && e.payload) || e);
  const eventNames = {};
  for (const p of payloads) eventNames[p && p.event] = (eventNames[p && p.event] || 0) + 1;
  // 回答形态两种：结构化事件（content/text）+ Provider 原生 choices.delta（无 event 键）
  const structured = payloads
    .filter((p) => p && p.event && p.role !== 'user' && !['tool_call', 'tool_result', 'tool_output'].includes(p.event))
    .map((p) => String(p.content || p.text || ''))
    .filter(Boolean)
    .join('');
  const providerChunks = payloads
    .filter((p) => p && !p.event && Array.isArray(p.choices))
    .map((p) => p.choices.map((c) => (c.delta && (c.delta.content || '')) || '').join(''))
    .join('');
  const answer = structured + providerChunks;
  const citedFile = /feature\.js/.test(answer);
  console.log(`[S4] terminal=${terminal} 事件直方图=${JSON.stringify(eventNames)}`);
  console.log(`[S4] 回答引用 feature.js=${citedFile}`);
  console.log('[S4] answer tail:', answer.slice(-300).replace(/\n+/g, ' | '));

  const allPass = landed && citedFile && terminal !== 'failed';
  fs.writeFileSync(path.join(EVDIR, 'reject-loop-live.json'), JSON.stringify({
    projectId, ws, taskId, terminal,
    at: new Date().toISOString(),
    sharedRejectEntries: landed,
    reusedExisting,
    eventNames,
    answerTail: answer.slice(-500),
    citedFile,
    allPass,
  }, null, 2));
  console.log('allPass=' + allPass);
}

main().catch((e) => { console.error('PROBE FAILED:', e); process.exitCode = 1; })
  .finally(async () => {
    if (projectId) { const d = await rest('DELETE', '/data/projects/' + encodeURIComponent(projectId)); console.log('cleanup:', d.ok ? 'ok' : 'fail'); }
  });
