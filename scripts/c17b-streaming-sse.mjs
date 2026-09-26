#!/usr/bin/env node
// C-17b REST 腿 — agent exec 输出流式进工具行（SSE tool_output 取证，无 CDP 依赖）
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local' };
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
let projectId = null;

async function main() {
  fs.mkdirSync(EVDIR, { recursive: true });
  const created = await rest('POST', '/data/projects', { name: 'C17B-流式-' + Date.now(), modality: 'general' });
  const project = created.data && (created.data.project || created.data);
  projectId = project && project.id;
  const detail = await rest('GET', '/data/projects/' + encodeURIComponent(projectId));
  const raw = (detail.data && detail.data.project) || project || {};
  const ws = raw.workspace_path || raw.workspacePath;
  fs.writeFileSync(path.join(ws, 'slow.js'), "const lines=['alpha-12ms','beta-34ms','gamma-56ms','ALL PASS'];let i=0;const t=setInterval(()=>{console.log(lines[i++]);if(i>=lines.length)clearInterval(t)},1200);");
  execFileSync('git', ['-C', ws, 'init'], { stdio: 'pipe' });
  console.log('[S1] seeded', ws);

  const sub = await rest('POST', '/ai/agent', {
    messages: [{ role: 'user', content: '工作区 ' + ws + '：运行 node slow.js，完整报告输出。' }],
    context: { projectId, page: 'workspace', pageTitle: '项目工作区', accessMode: 'full' },
  });
  const { taskId } = sub.data;
  const abort = new AbortController();
  setTimeout(() => abort.abort(), 4 * 60_000);
  const events = [];
  const collector = (async () => {
    try {
      const resp = await fetch(API + '/ai/agent/task/' + encodeURIComponent(taskId) + '?afterSeq=0', { headers: AUTH, signal: abort.signal });
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
  })();
  // 运行中窗口取证：8s 时快照 tool_output 是否已含脚本输出（流式=未终态就有输出块）
  await sleep(8000);
  const mid = await rest('GET', '/ai/agent/task/' + encodeURIComponent(taskId) + '/meta');
  const statusMid = mid.data && (mid.data.agentStatus || mid.data.agent_status);
  const midJson = JSON.stringify(events);
  const midStreamed = /alpha-12ms|beta-34ms/.test(midJson);
  console.log(`[S2] 运行中(${statusMid}) tool_output 流式命中=${midStreamed}`);

  const deadline = Date.now() + 4 * 60_000;
  let terminal = null;
  while (Date.now() < deadline) {
    await sleep(3000);
    const t = await rest('GET', '/ai/agent/task/' + encodeURIComponent(taskId) + '/meta');
    const s = t.data && (t.data.agentStatus || t.data.agent_status);
    if (['completed', 'done', 'failed', 'cancelled'].includes(s)) { terminal = s; break; }
  }
  await sleep(2000);
  abort.abort();
  await collector;
  const all = JSON.stringify(events);
  const toolOutputEvents = events.filter((e) => e && (e.event === 'tool_output' || e.event === 'output')).length;
  const streamed = /alpha-12ms/.test(all) && /gamma-56ms|ALL PASS/.test(all);
  const out = { projectId, ws, taskId, terminal, statusMid, midStreamed, toolOutputEvents, streamed, at: new Date().toISOString(), allPass: midStreamed && streamed && terminal !== 'failed' };
  fs.writeFileSync(path.join(EVDIR, 'streaming-sse.json'), JSON.stringify(out, null, 2));
  console.log(`[S3] terminal=${terminal} tool_output=${toolOutputEvents} 全量流式=${streamed}`);
  console.log('allPass=' + out.allPass);
}

main().catch((e) => { console.error('PROBE FAILED:', e); process.exitCode = 1; })
  .finally(async () => { if (projectId) { const d = await rest('DELETE', '/data/projects/' + encodeURIComponent(projectId)); console.log('cleanup:', d.ok ? 'ok' : 'fail'); } });
