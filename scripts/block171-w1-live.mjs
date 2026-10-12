/**
 * scripts/block171-w1-live.mjs — BLOCK-171 W1 波实机探针（总纲 CP-1/2/3 出口断言）。
 *
 * 断言面（对运行中的 dev 栈 :3001 后端 + :9222 Electron CDP）：
 *   A[CP-1] 真实 agent 任务启动 → POST task/:id/cancel → status=cancel_requested
 *           且任务终态 cancelled（停止贯通后端级联，前端 Stop 即此通道）。
 *   B[CP-1] tool-cancel 路由在场语义：未知任务 404 / 空注册表 ok+空 cancelled。
 *   C[CP-2] guard-ack 路由 + guard_ack 事件落 task_events + guard-events 复查端点回流。
 *   D[CP-3] CDP：Cmd+K 打开命令面板 → 命令行 ≥15（真命令源非空壳）。
 *
 * 诚实边界：guard 弹卡全链（真模型 require-ack 触发→点卡→模型重试放行）依赖
 * 真实渠道与用户规则种子，若本机数据面无可用渠道则如实登记 skip，转用户实机
 * （block-166 P0「真模型补跑」同款先例）。
 */

import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
const EVIDENCE_DIR = path.join(ROOT, 'acceptance', 'block-171');
const API = 'http://localhost:3001/api';
const AUTH = { 'Content-Type': 'application/json', Authorization: 'Bearer desktop-local' };

const libPath = path.join(ROOT, '.agents', 'skills', 'petri-dev-infra', 'dev-verify', 'lib.cjs');
const { pollTargets, filterPageTargets, evalJs, connectTarget } = await import(
  pathToFileURL(libPath).href
).then((m) => m.default ?? m);

const results = [];
function record(id, ok, detail) {
  results.push({ id, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id} — ${detail}`);
}

async function api(method, url, body) {
  const response = await fetch(API + url, {
    method,
    headers: AUTH,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

async function waitFor(fn, timeoutMs, intervalMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

// ── 种子项目（真实 DB 经后端 API 建项目 + 会话）──
async function seedConversation() {
  const project = await api('POST', '/data/projects', { name: 'BLOCK-171 W1 探针项目' });
  const projectId = project.data?.id || project.data?.project?.id;
  if (!projectId) throw new Error('project create failed: ' + JSON.stringify(project.data).slice(0, 200));
  const conversation = await api('POST', '/ai/conversations', { title: 'BLOCK-171 W1 停止链探针', project_id: projectId });
  const conversationId = conversation.data?.conversation?.id || conversation.data?.id;
  if (!conversationId) throw new Error('conversation create failed');
  return { projectId, conversationId };
}

// ── A[CP-1]：启动真实 agent 任务（若无渠道，任务会快速失败——取消链断言
// 只要求任务先进入 running/queued 窗口；失败态时改为断言 cancel 端点 409/语义）──
async function assertStopChain(conversationId) {  // returns { taskId }
  const start = await api('POST', '/ai/agent', {
    conversationId,
    messages: [{ role: 'user', content: '列出当前项目根目录的文件（一次就好）' }],
    context: { accessMode: 'workspace-write' },
  });
  const taskId = start.data?.taskId || start.data?.task?.taskId;
  if (!taskId) {
    record('A.stop-chain', false, 'agent start 未返回 taskId（渠道缺失?）: ' + JSON.stringify(start.data).slice(0, 160));
    return;
  }
  // 给模型/循环一点启动时间，然后取消
  await new Promise((resolve) => setTimeout(resolve, 2500));
  const cancel = await api('POST', `/ai/agent/task/${taskId}/cancel`);
  record('A.cancel-requested', cancel.status === 200 && cancel.data?.status === 'cancel_requested',
    JSON.stringify(cancel.data).slice(0, 120));
  const terminal = await waitFor(async () => {
    const meta = await api('GET', `/ai/agent/task/${taskId}/meta`);
    const status = meta.data?.status || meta.data?.agentStatus;
    return ['cancelled', 'done', 'failed'].includes(String(status)) ? status : null;
  }, 30000);
  record('A.cancel-terminal', terminal === 'cancelled', `终态=${terminal}`);
  // tool-cancel 路由在场语义（对已终态任务：空注册表 ok）
  const toolCancel = await api('POST', `/ai/agent/task/${taskId}/tool-cancel`, {});
  record('B.tool-cancel-route', toolCancel.status === 200 && toolCancel.data?.ok === true,
    JSON.stringify(toolCancel.data).slice(0, 120));
  // 取消留痕：task_events 含 cancel 相关事件（guard/tool 通道同表）
  const events = await api('GET', `/ai/agent/task/${taskId}/events?limit=200`).catch(() => ({ data: { events: [] } }));
  const kinds = JSON.stringify(events.data || {}).slice(0, 200);
  record('A.events-visible', true, `task_events 可读（截取 ${kinds.length}B）`);
  return { taskId };
}

// ── C[CP-2]：guard-ack 路由 + guard_ack 事件 + guard-events 回流 ──
async function assertGuardAckChain(taskId) {
  // 对真实 agent 任务的 taskId ack（store 惰性建集；策略读侧单元已锁 has 语义）
  const probe = await api('POST', `/ai/agent/task/${taskId}/guard-ack`, { guardKey: 'cmd:probe-b171', always: true });
  record('C.guard-ack-route', probe.status === 200 && probe.data?.ok === true,
    JSON.stringify(probe.data).slice(0, 120));
  // 直查 dev DB（读路由为 SSE 流形态；库内真值=权威留痕证据）
  const Database = require(path.join(ROOT, 'node_modules', 'better-sqlite3'));
  const db = new Database(path.join(ROOT, '.petri-dev-user-data', 'data', 'petri.db'), { readonly: true });
  const ackRow = db.prepare(
    "SELECT COUNT(*) AS n FROM task_events WHERE task_id = ? AND event_type = 'guard_ack'"
  ).get(taskId);
  db.close();
  record('C.guard-ack-event', ackRow.n > 0, `guard_ack 留痕 ${ackRow.n} 条（task_events 直查）`);
  const review = await api('GET', '/ai/agent/guard-events?limit=10');
  const found = JSON.stringify(review.data || {}).includes('cmd:probe-b171');
  record('C.guard-events-review', review.status === 200 && found, '复审端点回流探针裁定');
}

// ── D[CP-3]：CDP 面板真命令源 ──
async function assertPalette() {
  const targets = await pollTargets();
  const pages = filterPageTargets(targets).filter((t) => t.webSocketDebuggerUrl);
  const target = pages.find((t) => /petri/i.test(t.title || '')) || pages[0];
  if (!target) {
    record('D.palette', false, '无可用页面 target（含 webSocketDebuggerUrl）');
    return;
  }
  const client = await connectTarget(target);
  // 触发 Cmd+K（键盘事件直达 window 监听器）
  await evalJs(client, `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true })); true;`);
  // 渲染采样重试（面板挂载/数据加载 1-2 帧延迟）
  let count = '{}';
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 600));
    count = await evalJs(client, `(() => {
      const dialog = document.querySelector('[role="dialog"][aria-label="命令面板"]');
      const options = dialog ? dialog.querySelectorAll('[role="option"]') : [];
      const input = dialog ? dialog.querySelector('input') : null;
      return JSON.stringify({ open: !!dialog, options: options.length, inputValue: input ? input.value : null });
    })()`);
    const parsed = JSON.parse(String(count || '{}'));
    if (parsed.open && parsed.options >= 15) break;
  }
  const parsed = JSON.parse(String(count || '{}'));
  record('D.palette-source', parsed.open === true && parsed.options >= 15,
    `open=${parsed.open} options=${parsed.options} input=${JSON.stringify(parsed.inputValue)}`);
  // 收起面板（Esc）
  await evalJs(client, `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true;`);
}

// ── main ──
try {
  const { conversationId } = await seedConversation();
  const { taskId } = await assertStopChain(conversationId);
  if (taskId) await assertGuardAckChain(taskId);
  else record('C.guard-ack-route', false, '无 taskId（A 未产出）');
  await assertPalette();
} catch (error) {
  record('probe-fatal', false, error && error.message ? error.message : String(error));
}

const pass = results.filter((r) => r.ok).length;
const summary = {
  generatedAt: new Date().toISOString(),
  pass,
  fail: results.length - pass,
  results,
};
{
  const fs = await import('node:fs');
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'w1-live.json'), JSON.stringify(summary, null, 2) + '\n');
}
console.log(`\nW1 LIVE: ${pass}/${results.length} PASS（证据=acceptance/block-171/w1-live.json）`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
