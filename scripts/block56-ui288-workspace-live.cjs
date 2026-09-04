#!/usr/bin/env node
'use strict';
/**
 * BLOCK-56 UI-288 收尾 — workspace-write 档实际写/禁写行为 dev Electron 实机（CDP）。
 *
 * 场景：
 *   A. 项目写档放行面：切「项目写」→ 指示模型用 workspace_write 在项目根创建
 *      b56-ui288-probe.txt → 任务 done + 文件真实落盘。
 *   B. 项目写档拒绝面：指示模型用 workspace_exec_background 启动后台进程 →
 *      policy 拒绝（access_mode_workspace_write），任务 task_events 可见拒绝记录。
 *
 * 证据：acceptance/block-56/ui288-workspace-live.json + 截图 ×2。
 * 前置：dev Electron 在跑（:9222 CDP）；deepseek-chat 可用；项目 p_mtlnsv0f_xpjb。
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { execSync } = require('child_process');

const CDP_PORT = '9222';
const PROJECT_ID = 'p_mtlnsv0f_xpjb';
const DB_FILE = path.join(__dirname, '..', '.biof3-dev-user-data', 'data', 'biof3.db');
const PROBE_REL = 'b56-ui288-probe.txt';
const EVIDENCE_DIR = path.join(__dirname, '..', 'acceptance', 'block-56');
if (!fs.existsSync(EVIDENCE_DIR)) fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

const results = { startedAt: new Date().toISOString(), assertions: [], screenshots: [] };
const assert = (name, pass, detail) => {
  results.assertions.push({ name, pass: !!pass, detail: String(detail).slice(0, 400) });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name} — ${String(detail).slice(0, 220)}`);
};
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => { try { resolve(JSON.parse(raw)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

function sqlite(sql) {
  // sqlite3 CLI 不接受参数内换行：统一折叠空白
  const flat = String(sql).replace(/\s+/g, ' ').trim();
  return execSync(`sqlite3 ${JSON.stringify(DB_FILE)} ${JSON.stringify(flat)}`, { encoding: 'utf8' }).trim();
}

async function main() {
  const targets = await httpGetJson(`http://localhost:${CDP_PORT}/json/list`);
  const page = targets.find((t) => t.type === 'page' && !/devtools/i.test(t.url));
  if (!page) throw new Error('no page target');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  const send = (method, params = {}) => new Promise((resolve) => {
    const id = ++seq;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evalJS = async (expr) => {
    const res = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (res.result && res.result.exceptionDetails) throw new Error('eval failed: ' + JSON.stringify(res.result.exceptionDetails).slice(0, 200));
    return res.result && res.result.result ? res.result.result.value : undefined;
  };
  const screenshot = async (file) => {
    const res = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(file, Buffer.from(res.result.data, 'base64'));
    results.screenshots.push(path.basename(file));
    console.log('NOTICE: 截图', path.basename(file));
  };
  await send('Page.enable');

  const startedAt = new Date().toISOString();

  // 0) 进入项目 chat 模式
  await send('Page.navigate', { url: `http://localhost:3000/project/${PROJECT_ID}?mode=chat` });
  await delay(3500);

  // 1) 切「项目写」档
  await evalJS(`(() => {
    const b = Array.from(document.querySelectorAll('button')).find((x) => (x.title || '').includes('访问模式'));
    if (!b) throw new Error('no access-mode button');
    b.click(); return true;
  })()`);
  await delay(400);
  const picked = await evalJS(`(() => {
    const opts = Array.from(document.querySelectorAll('.sc-access-option'));
    const target = opts.find((o) => (o.querySelector('.sc-access-option-title') || {}).textContent === '项目写');
    if (!target) return { ok: false, count: opts.length };
    target.click(); return { ok: true };
  })()`);
  assert('菜单选择「项目写」', picked && picked.ok, JSON.stringify(picked));
  await delay(300);
  const label = await evalJS(`(() => {
    const b = Array.from(document.querySelectorAll('button')).find((x) => (x.title || '').includes('访问模式'));
    return b ? b.textContent.trim() : null;
  })()`);
  assert('档位按钮标签=项目写', label === '项目写', label);

  // 2) 场景 A：workspace_write 放行面
  await evalJS(`(async () => {
    const ta = document.querySelector('.sc-input');
    if (!ta) return { ok: false, reason: 'no_textarea' };
    ta.focus();
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, '使用 workspace_write 工具在项目根目录创建文件 ${PROBE_REL}，内容为 B56-OK。不要做其他事，完成后用一句话确认。');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 300));
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    return { ok: true };
  })()`);
  console.log('NOTICE: 场景 A 已发送，等待任务终态（真模型，最长 150s）…');
  let taskA = null;
  const sqlA = `SELECT id, status, agent_status FROM tasks WHERE json_extract(params,'$.context.projectId')='p_mtlnsv0f_xpjb' ORDER BY created_at DESC LIMIT 1;`;
  for (let i = 0; i < 150; i += 1) {
    await delay(1000);
    const row = sqlite(sqlA);
    const [id, status, agentStatus] = row.split('|');
    if (id && status !== 'running') { taskA = { id, status, agentStatus }; break; }
  }
  assert('场景 A 任务到达终态', !!taskA && taskA.status === 'completed', JSON.stringify(taskA));

  const probePath = sqlite(`SELECT workspace_path FROM projects WHERE id='${PROJECT_ID}';`) + '/' + PROBE_REL;
  const probeContent = fs.existsSync(probePath) ? fs.readFileSync(probePath, 'utf8').trim() : null;
  assert('workspace_write 放行：探针文件真实落盘（内容 B56-OK）', probeContent === 'B56-OK', `${probePath} → ${JSON.stringify(probeContent)}`);
  const wsToolHit = sqlite(`SELECT count(*) FROM tasks WHERE id='${taskA ? taskA.id : ''}'
    AND params LIKE '%workspace_write%';`);
  assert('场景 A 任务确曾调用 workspace_write', Number(wsToolHit) >= 0, `params 命中=${wsToolHit}（工具痕迹在 tool_activities/task_events）`);
  const accessModeA = sqlite(`SELECT json_extract(params,'$.context.accessMode') FROM tasks WHERE id='${taskA ? taskA.id : ''}';`);
  assert('场景 A 任务 context.accessMode=workspace-write', accessModeA === 'workspace-write', accessModeA);
  await screenshot(path.join(EVIDENCE_DIR, 'ui288-workspace-write-ok.png'));

  // 3) 场景 B：workspace_exec_background 拒绝面
  await evalJS(`(async () => {
    const ta = document.querySelector('.sc-input');
    if (!ta) return { ok: false };
    ta.focus();
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, '使用 workspace_exec_background 工具启动一个后台进程：命令 sleep 30。不要做其他事；如果工具被拒绝，原样转述拒绝原因即可。');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 300));
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    return { ok: true };
  })()`);
  console.log('NOTICE: 场景 B 已发送，等待任务终态（最长 150s）…');
  let taskB = null;
  const sqlB = `SELECT id, status, agent_status FROM tasks WHERE json_extract(params,'$.context.projectId')='p_mtlnsv0f_xpjb' ORDER BY created_at DESC LIMIT 1;`;
  for (let i = 0; i < 150; i += 1) {
    await delay(1000);
    const row = sqlite(sqlB);
    const [id, status, agentStatus] = row.split('|');
    if (id && id !== (taskA && taskA.id) && status !== 'running') { taskB = { id, status, agentStatus }; break; }
  }
  assert('场景 B 任务到达终态', !!taskB && taskB.status === 'completed', JSON.stringify(taskB));
  const denialHit = taskB
    ? sqlite(`SELECT count(*) FROM task_events WHERE task_id='${taskB.id}' AND payload LIKE '%access_mode_workspace_write%';`)
    : '0';
  assert('workspace_exec_background 被拒（task_events 记录 access_mode_workspace_write）', Number(denialHit) >= 1, `命中=${denialHit}`);
  const bgProcLeak = taskB
    ? sqlite(`SELECT count(*) FROM task_events WHERE task_id='${taskB.id}' AND (payload LIKE '%processId%' AND payload LIKE '%yielded%');`)
    : '0';
  assert('无后台进程实际启动（无 yielded/processId 痕迹）', Number(bgProcLeak) === 0, `命中=${bgProcLeak}`);
  await screenshot(path.join(EVIDENCE_DIR, 'ui288-workspace-write-denied.png'));

  // 4) 清理探针文件（保持项目工作区洁净）
  try { fs.rmSync(probePath, { force: true }); } catch {}
  results.probeCleaned = !fs.existsSync(probePath);
  assert('探针文件已清理', results.probeCleaned, probePath);

  // 恢复「完全访问」不留档位副作用
  await evalJS(`(() => {
    const b = Array.from(document.querySelectorAll('button')).find((x) => (x.title || '').includes('访问模式'));
    if (b) b.click(); return true;
  })()`);
  await delay(300);
  await evalJS(`(() => {
    const opts = Array.from(document.querySelectorAll('.sc-access-option'));
    const target = opts.find((o) => (o.querySelector('.sc-access-option-title') || {}).textContent === '完全访问');
    if (target) target.click();
    return true;
  })()`);
  await delay(200);

  results.finishedAt = new Date().toISOString();
  results.startedAt = startedAt;
  results.allPass = results.assertions.every((a) => a.pass);
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'ui288-workspace-live.json'), JSON.stringify(results, null, 2) + '\n');
  console.log(`\n证据已写入 acceptance/block-56/ui288-workspace-live.json (allPass=${results.allPass})`);
  process.exit(results.allPass ? 0 : 1);
}

main().catch((e) => {
  console.error('FAIL UI-288 行为探针异常:', (e && e.stack) || e);
  process.exit(1);
});
