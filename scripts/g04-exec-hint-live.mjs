#!/usr/bin/env node
/**
 * G-04 根治实机走查探针 — 指令带不存在的 runner 名（BLOCK-123 P1 场景 A 同源形态）：
 * 播种 phone.test.js + run-tests.js → 指令点名不存在的 `ultra-test` runner →
 * 观察 agent exec 序列与工具结果中的 commandNotFoundHint 回传。
 * 产出：acceptance/block-124/g04-live.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local' };
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

async function collectEvents(taskId, timeoutMs) {
  const url = API + '/ai/agent/task/' + encodeURIComponent(taskId) + '?afterSeq=0';
  const abort = new AbortController();
  setTimeout(() => abort.abort(), timeoutMs);
  const events = [];
  try {
    const resp = await fetch(url, { headers: AUTH, signal: abort.signal });
    const reader = resp.body.getReader();
    const decoder = new TextDecoder('utf8');
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const line = buffer.slice(0, sep).trim();
        buffer = buffer.slice(sep + 2);
        if (!line.startsWith('data:')) continue;
        try { events.push(JSON.parse(line.slice(5).trim())); } catch {}
      }
    }
  } catch {}
  return events;
}

function git(cwd, args) {
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' });
}

const PHONE_TEST = `function normalizePhone(p) {
  let d = p.replace(/\\D/g, '');
  if (d.startsWith('86') && d.length === 13) d = d.slice(2);
  if (d.length !== 11) throw new Error('bad input: ' + p);
  return '+86' + d;
}
const cases = [
  ['13800138000', '+8613800138000'],
  ['+8613800138000', '+8613800138000'],
];
for (const [input, want] of cases) {
  const got = normalizePhone(input);
  if (got !== want) throw new Error(\`normalizePhone(\${input}) = \${got}, want \${want}\`);
}
console.log('phone.test.js ALL PASS');
`;
const RUNNER = `const { execFileSync } = require('child_process');
execFileSync(process.execPath, ['phone.test.js'], { stdio: 'inherit' });
console.log('run-tests ALL PASS');
`;

let projectId = null;

async function main() {
  const created = await rest('POST', '/data/projects', { name: 'G04-走查-' + Date.now(), modality: 'general' });
  const project = created.data && (created.data.project || created.data);
  projectId = project && project.id;
  const detail = await rest('GET', '/data/projects/' + encodeURIComponent(projectId));
  const raw = (detail.data && detail.data.project) || project || {};
  const ws = raw.workspace_path || raw.workspacePath;
  fs.writeFileSync(path.join(ws, 'phone.test.js'), PHONE_TEST);
  fs.writeFileSync(path.join(ws, 'run-tests.js'), RUNNER);
  git(ws, ['init']);
  git(ws, ['add', '.']);
  git(ws, ['-c', 'user.name=g04-probe', '-c', 'user.email=probe@local', 'commit', '-m', 'baseline']);
  execFileSync(process.execPath, ['phone.test.js'], { cwd: ws });
  console.log('[S1] 播种完成', ws);

  const instruction = '工作区 ' + ws + '：请先原样运行命令「ultra-test phone.test.js」（必须先试这个命令），如果运行不了再自己想办法让 phone.test.js 通过，并把结果告诉我。';
  const sub = await rest('POST', '/ai/agent', {
    messages: [{ role: 'user', content: instruction }],
    context: { projectId, page: 'workspace', pageTitle: '项目工作区', accessMode: 'full' },
  });
  const { taskId } = sub.data;
  const deadline = Date.now() + 6 * 60_000;
  let terminal = null;
  while (Date.now() < deadline) {
    await sleep(3000);
    const t = await rest('GET', '/ai/agent/task/' + encodeURIComponent(taskId) + '/meta');
    const status = t.data && (t.data.agentStatus || t.data.agent_status);
    if (['completed', 'done', 'failed', 'cancelled'].includes(status)) { terminal = status; break; }
  }
  const events = await collectEvents(taskId, 15_000);
  const payloads = events.map((e) => (e && e.payload) || e);
  const seq = payloads.filter((p) => p && p.event === 'tool_call').map((p) => p.name).filter(Boolean);
  const execCalls = payloads.filter((p) => p && p.event === 'tool_call' && p.name === 'workspace_exec');
  const resultsJson = payloads.filter((p) => p && (p.event === 'tool_result' || p.event === 'tool_output'))
    .map((p) => JSON.stringify(p)).join('\n');
  const hintSeen = resultsJson.includes('commandNotFoundHint');
  const recoveredToRunner = /run-tests\.js/.test(resultsJson) || /phone\.test\.js/.test(resultsJson);
  const summary = {
    projectId, ws, taskId, terminal,
    at: new Date().toISOString(),
    toolSequence: seq,
    execCount: execCalls.length,
    hintSeen, recoveredToRunner,
  };
  fs.mkdirSync(path.join(ROOT, 'acceptance', 'block-124'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'acceptance', 'block-124', 'g04-live.json'), JSON.stringify(summary, null, 2));
  console.log(`[S2] terminal=${terminal} exec 次数=${execCalls.length} 序列=[${seq.join(' → ')}]`);
  console.log(`[S3] hint 回传=${hintSeen} 收敛到真实 runner/测试=${recoveredToRunner}`);
  console.log(`allPass=${hintSeen && recoveredToRunner && terminal !== 'failed'}`);
}

main().catch((e) => { console.error('PROBE FAILED:', e); process.exitCode = 1; })
  .finally(async () => { if (projectId) { const d = await rest('DELETE', '/data/projects/' + encodeURIComponent(projectId)); console.log('cleanup:', d.ok ? 'ok' : 'fail'); } });
