import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local', 'content-type': 'application/json' };
const DB_PATH = 'D:/1.WorkDir/biof3-desktop/.biof3-dev-user-data/data/biof3.db';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const Database = require('better-sqlite3');
function db() { return new Database(DB_PATH, { readonly: true }); }
async function rest(method, endpoint, body) {
  const resp = await fetch(API + endpoint, { method, headers: AUTH, body: body ? JSON.stringify(body) : undefined });
  return { ok: resp.ok, data: await resp.json().catch(() => null) };
}
function eventsOf(taskId) {
  const d = db(); const rows = d.prepare('SELECT seq, event_type, payload FROM task_events WHERE task_id=? ORDER BY seq').all(taskId); d.close();
  return rows.map((r) => { try { return { seq: r.seq, eventType: r.event_type, payload: JSON.parse(r.payload) }; } catch { return { seq: r.seq, eventType: r.event_type, payload: null }; } });
}
async function submit(messages, projectId) {
  const r = await rest('POST', '/ai/agent', { messages, context: { page: 'desktop-project', projectId, accessMode: 'full' } });
  if (!r.ok || !r.data?.taskId) throw new Error('submit failed');
  return r.data;
}
const created = await rest('POST', '/data/projects', { name: `S2-LIVE-${Date.now()}`, modality: 'general' });
const projectId = created.data.project.id;
const sub = await submit([{ role: 'user', content: '请用 spawn_agent 派两个子智能体并行工作，并用 todo_write 建两项清单各对应一个子任务：(1) 列出项目根目录下的文件名；(2) 统计 frontend/src 目录下 .ts 文件的数量。两个子智能体结束后，无论各自结果如何都把清单两项都标记 completed，然后统一汇总一句话。' }], projectId);
console.log('taskId:', sub.taskId);
const deadline = Date.now() + 420000;
let cancelled = false;
while (Date.now() < deadline) {
  await sleep(3000);
  const d = db();
  const children = d.prepare("SELECT id, status FROM tasks WHERE json_valid(params)=1 AND json_extract(params,'$.kind')='subagent' AND json_extract(params,'$.parentTaskId')=?").all(sub.taskId);
  d.close();
  const running = children.filter((c) => c.status === 'running');
  if (children.length >= 2 && running.length > 0 && !cancelled) {
    await rest('POST', `/ai/agent/task/${encodeURIComponent(running[0].id)}/cancel`, {});
    cancelled = true; console.log('cancelled:', running[0].id.slice(0, 8));
  }
  if (children.length >= 2 && running.length === 0) break;
}
async function waitDone(taskId) {
  const dl = Date.now() + 240000;
  while (Date.now() < dl) { await sleep(3000); const d = db(); const row = d.prepare('SELECT status FROM tasks WHERE id=?').get(taskId); d.close(); if (row && row.status !== 'running') return row.status; }
  return 'timeout';
}
const status = await waitDone(sub.taskId);
const ev = eventsOf(sub.taskId);
const notice = ev.find((e) => e.eventType === 'reconciliation_notice');
const todos = [...ev].reverse().find((e) => e.eventType === 'tool_call' && e.payload && e.payload.name === 'todo_write');
console.log('status:', status);
console.log('notice present:', !!notice, notice ? JSON.stringify(notice.payload).slice(0, 150) : '');
console.log('final todos:', JSON.stringify((todos?.payload?.args?.items || []).map((t) => t.status)));
// 清理
{
  const d = db(); const convRows = d.prepare('SELECT id FROM copilot_conversations WHERE project_id=?').all(projectId); d.close();
  for (const c of convRows) await rest('DELETE', `/ai/conversations/${encodeURIComponent(c.id)}`).catch(() => {});
  await rest('DELETE', `/data/projects/${encodeURIComponent(projectId)}`).catch(() => {});
}
console.log('DONE');
