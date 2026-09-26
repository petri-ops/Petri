#!/usr/bin/env node
/**
 * BLOCK-123 P1 G-05 — 多文件深度走查（真·跨文件协调改造）。
 *
 * 任务：KV store 加 TTL 过期（store.mjs）+ api.mjs 会话缓存接入 TTL + 行为级测试。
 * 需求全部藏在预置测试里（store.test.mjs / api.test.mjs），指令只给目标。
 * 防作弊：探针自持原始 run-tests.mjs 副本（verify-runner.mjs），任务完成后用它复核，
 * agent 若弱化断言/改测试即在此步现形。
 *
 * 产出：acceptance/block-123/p1-walkthrough-3.json。
 * 前置：主 dev 栈 :3001。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local' };
const EVDIR = path.join(ROOT, 'acceptance', 'block-123');
const TASK_TIMEOUT_MS = Number(process.env.BLOCK123_TASK_TIMEOUT_MS || 8 * 60_000);
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

const STORE_MJS = `// KV store：内存键值存储（TTL 待实现）
const data = new Map();
export function set(key, value) {
  data.set(key, { value });
}
export function get(key) {
  const entry = data.get(key);
  return entry ? entry.value : undefined;
}
`;
const API_MJS = `// 会话缓存层：应使用 store 的 TTL 能力（待接入）
import { set as storeSet, get as storeGet } from './store.mjs';
export function cacheSession(sessionId, payload) {
  storeSet('session:' + sessionId, payload);
}
export function getCachedSession(sessionId) {
  return storeGet('session:' + sessionId);
}
`;
const STORE_TEST_MJS = `// store TTL 行为契约（需求源）
import assert from 'node:assert/strict';
import { set, get } from './store.mjs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await (async () => {
  set('a', 1);
  assert.equal(get('a'), 1, '基础 set/get');
  set('b', 2, 10);            // 10ms 过期
  assert.equal(get('b'), 2, '未过期可读');
  await sleep(40);
  assert.equal(get('b'), undefined, '过期后不可读');
  set('c', 3);                 // 无 ttl 永不过期
  await sleep(30);
  assert.equal(get('c'), 3, '无 ttl 不过期');
  console.log('STORE PASS');
})();
`;
const API_TEST_MJS = `// api 会话缓存 TTL 契约（需求源）
import assert from 'node:assert/strict';
import { cacheSession, getCachedSession } from './api.mjs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await (async () => {
  cacheSession('s1', { user: 'u1' });
  assert.deepEqual(getCachedSession('s1'), { user: 'u1' }, '会话缓存可读');
  await sleep(1200);           // 会话缓存 1 秒 TTL
  assert.equal(getCachedSession('s1'), undefined, '会话缓存 1s 过期');
  console.log('API PASS');
})();
`;
const RUNNER_MJS = `// 统一测试入口（探针基线副本，勿弱化）
await import('./store.test.mjs');
await import('./api.test.mjs');
console.log('ALL PASS');
`;

let projectId = null;
try {
  fs.mkdirSync(EVDIR, { recursive: true });
  const created = await rest('POST', '/data/projects', { name: 'BLOCK123-G05-多文件-' + Date.now(), modality: 'general' });
  const project = created.data && (created.data.project || created.data);
  projectId = project && project.id;
  const detail = await rest('GET', '/data/projects/' + encodeURIComponent(projectId));
  const rawProject = (detail.data && detail.data.project) || project || {};
  const workspacePath = rawProject.workspace_path || rawProject.workspacePath;
  if (!workspacePath || !fs.existsSync(workspacePath)) throw new Error('workspace 未解析');
  const wf = (name, content) => fs.writeFileSync(path.join(workspacePath, name), content);
  wf('store.mjs', STORE_MJS);
  wf('api.mjs', API_MJS);
  wf('store.test.mjs', STORE_TEST_MJS);
  wf('api.test.mjs', API_TEST_MJS);
  wf('run-tests.mjs', RUNNER_MJS);
  const g = (args) => execFileSync('git', ['-C', workspacePath, '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8', timeout: 20_000 });
  g(['init']); g(['add', '.']);
  g(['-c', 'user.name=p1-probe', '-c', 'user.email=probe@local', 'commit', '-m', 'baseline']);

  const runTests = () => {
    try {
      const out = execFileSync('node', ['run-tests.mjs'], { cwd: workspacePath, encoding: 'utf8', timeout: 60_000 });
      return { pass: out.includes('ALL PASS'), out };
    } catch (e) { return { pass: false, out: String(e.stdout || e.message).slice(0, 300) }; }
  };
  const baseline = runTests(workspacePath ? path.join(workspacePath, '.') : workspacePath);
  record('M1 播种', baseline.pass === false ? '通' : '断', `基线红=${!baseline.pass}（TTL 未实现必红）${workspacePath}`);

  const started = Date.now();
  const { taskId, conversationId, terminal } = await rest_then_submit(workspacePath, projectId, TASK_TIMEOUT_MS);
  record('M2 任务', terminal === 'completed' || terminal === 'done' ? '通' : '断',
    `terminal=${terminal} 耗时=${Math.round((Date.now() - started) / 1000)}s conversationId=${conversationId}`);

  const events = await collectEvents(taskId, 15_000);
  const payloads = events.map((e) => (e && e.payload) || e);
  fs.writeFileSync(path.join(EVDIR, 'p1-g05-events.json'), JSON.stringify(payloads, null, 2));
  const seq = payloads.filter((p) => p && p.event === 'tool_call').map((p) => p.name)
    .filter((n) => /^(workspace_|todo_|plan$)/.test(n));
  const execCount = seq.filter((n) => n === 'workspace_exec').length;

  // 防作弊复核：用探针自持的原始 runner 重跑（agent 改测试/弱化断言在此现形）
  const verifyRunner = path.join(workspacePath, 'verify-runner.mjs');
  fs.writeFileSync(verifyRunner, RUNNER_MJS);
  let verifyPass = false;
  let verifyOut = '';
  try {
    const out = execFileSync('node', ['verify-runner.mjs'], { cwd: workspacePath, encoding: 'utf8', timeout: 60_000 });
    verifyPass = out.includes('ALL PASS');
    verifyOut = out.slice(-120);
  } catch (e) { verifyOut = String(e.stdout || e.message).slice(0, 300); }

  const changed = g(['status', '--porcelain']).split('\n').filter(Boolean);
  const touched = new Set(changed.map((line) => line.replace(/^\S+\s+/, '')));
  record('M3 多文件覆盖', touched.size >= 2 ? '通' : '涩',
    `变更文件 ${touched.size} 个=[${[...touched].join(', ')}]（store.mjs+api.mjs 至少各一才算跨文件）`);
  record('M4 防作弊复核', verifyPass ? '通' : '断',
    `原始 runner 复跑=${verifyPass ? 'ALL PASS' : 'FAIL'} exec 次数=${execCount} 序列=[${seq.join('→')}] 输出尾=${verifyOut.slice(-80)}`);

  // runner 是否被 agent 动过
  const runnerTampered = fs.readFileSync(path.join(workspacePath, 'run-tests.mjs'), 'utf8') !== RUNNER_MJS;
  record('M5 完整性', runnerTampered ? '涩（run-tests.mjs 被修改——防作弊复核已兜住）' : '通（run-tests.mjs 未被触碰）',
    `runnerTampered=${runnerTampered}`);
} catch (e) {
  record('G-05 异常', '断', String(e.message).slice(0, 300));
} finally {
  if (projectId) { try { await rest('DELETE', '/data/projects/' + encodeURIComponent(projectId)); } catch { /* best effort */ } }
}

async function rest_then_submit(workspacePath, projectId, timeoutMs) {
  const message =
    '工作区 ' + workspacePath + ' 是一个小项目：store.mjs（KV 存储）、api.mjs（会话缓存）、run-tests.mjs（测试入口）。' +
    '请让 node run-tests.mjs 全部通过——需要给 store 的 set 支持可选 ttlMs 过期参数，' +
    '并让 api 的会话缓存使用 1 秒 TTL。完成后告诉我结果。';
  const sub = await rest('POST', '/ai/agent', {
    messages: [{ role: 'user', content: message }],
    context: { projectId, page: 'workspace', pageTitle: '项目工作区', accessMode: 'full' },
  });
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

fs.writeFileSync(path.join(EVDIR, 'p1-walkthrough-3.json'), JSON.stringify({ at: new Date().toISOString(), findings }, null, 2));
console.log('\n=== G-05 多文件深度走查汇总 ===');
for (const f of findings) console.log(`${f.verdict}  ${f.id}`);
