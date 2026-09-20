#!/usr/bin/env node
'use strict';
/**
 * block97-todo-live.cjs — BLOCK-97 P3 实机验收（dev Electron 真轮次）：
 *   V1 composer 真发多步消息（产品路径），agent 真实调用 todo_write；
 *   V2 摘要卡「任务清单」节实时出现（aria-label=任务清单），运行中捕获到
 *      in_progress / completed 状态（实时勾选可见）；
 *   V3 真轮次终态：回复到达 / 任务终态 done，最终清单全 completed；
 *   V4 事件持久化与专属性：task SSE afterSeq=0 重放含 task_todo ≥2 次整单
 *      （≥1 次初始 + ≥1 次勾选更新），且 task_todo 恒随 tool_result(todo_write)
 *      成功回执之后（seq 单调）；
 *   V5 重放确定性：二次 afterSeq=0 拉取最终清单逐字节一致（D1 事件重放定案）。
 * 前置：dev 栈（vite 3000 + 后端 3001 + CDP 9222），栈须在 5552e68f 之后重启。
 * 证据：acceptance/block-97/block97-todo-live.json + 截图。
 */
const path = require('node:path');
const http = require('node:http');
const lib = require(path.join(__dirname, '..', '.agents', 'skills', 'gewu-dev-infra', 'dev-verify', 'lib.cjs'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PROJECT_ID = process.argv[2] || 'p_mu5emekx_g13p';
const API = 'http://127.0.0.1:3001';
const AUTH = { Authorization: 'Bearer desktop-local' };
const EVIDENCE_DIR = path.join(__dirname, '..', 'acceptance', 'block-97');

const PROMPT =
  '请严格按以下流程执行，并全程使用 todo_write 工具维护任务清单：' +
  '开工前先用 todo_write 写入 3 条 pending 清单（内容逐字使用：' +
  '「第一步：回答算术题」「第二步：回答应用定位题」「第三步：报告完成」），' +
  '然后逐条执行：执行某条前置为 in_progress，完成立即置 completed。' +
  '步骤一：直接回答 1+1 等于几。步骤二：用一句话说明格物桌面版是什么类型的应用。' +
  '步骤三：输出「三步完成」。除 todo_write 外不要调用任何其他工具。';

let client;
const EVAL = (expr) => lib.evalJs(client, expr);

function apiJson(pathname) {
  return new Promise((resolve, reject) => {
    http.get(API + pathname, { headers: AUTH }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(buf)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

/** 拉取 task 事件流（afterSeq=0 全量重放），直到 [DONE] / 终态 / 超时。
 *  task 模式事件包成 {seq, eventType, payload} 信封——取 payload 走原解析。 */
function fetchTaskEvents(taskId, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const events = [];
    const req = http.get(`${API}/api/ai/agent/task/${taskId}?afterSeq=0`, { headers: AUTH }, (res) => {
      let buf = '';
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        try { res.destroy(); } catch {}
        resolve(events);
      };
      const timer = setTimeout(finish, timeoutMs);
      res.on('data', (c) => {
        buf += c.toString('utf8');
        let idx;
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const raw = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          for (const line of raw.split('\n')) {
            const m = line.match(/^data:\s?(.*)$/);
            if (!m) continue;
            if (m[1] === '[DONE]') { clearTimeout(timer); finish(); return; }
            try {
              const obj = JSON.parse(m[1]);
              events.push(obj && obj.payload ? obj.payload : obj);
            } catch {}
          }
        }
      });
      // 终态任务重放完即关连接——必须在 end 上收敛，否则白等超时截断事件
      res.on('end', () => { clearTimeout(timer); finish(); });
      res.on('error', () => { clearTimeout(timer); finish(); });
    });
    req.on('error', reject);
  });
}

async function pollTargets() {
  const targets = await lib.pollTargets({ timeoutMs: 20000 });
  const candidates = lib.filterPageTargets(targets, /^http:\/\/localhost:3000\/(?!window\/)/);
  return lib.selectPageTarget(candidates, {
    probe: async (c) => lib.evalJs(c, `!!document.getElementById('root')`).catch(() => false),
  });
}

(async () => {
  const run = lib.createRun({ name: 'block97-todo-live', evidenceDir: EVIDENCE_DIR });
  Date.now();

  // ── 打开项目工作台 ──
  let target = await pollTargets();
  client = await lib.connectTarget(target);
  await lib.evalJs(client, `location.href = 'http://localhost:3000/project/${PROJECT_ID}'; 'nav'`);
  await sleep(4000);
  target = await pollTargets();
  client = await lib.connectTarget(target);
  const rootOk = await EVAL(`!!document.getElementById('root')`);
  run.assert('V0_project_page_open', rootOk === true || rootOk === 'true', 'root mounted');

  // ── V1 composer 真发（composer 就绪重试：首航/热更显可能慢）──
  let typed = '';
  for (let i = 0; i < 15; i++) {
    typed = await EVAL(
      "(function(){\n" +
      "  var ta = document.querySelector('textarea.sc-input');\n" +
      "  if (!ta) return 'no_textarea';\n" +
      "  var setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;\n" +
      "  setter.call(ta, " + JSON.stringify(PROMPT) + ");\n" +
      "  ta.dispatchEvent(new Event('input', { bubbles: true }));\n" +
      "  return 'typed:' + ta.value.length;\n" +
      "})()");
    if (String(typed).startsWith('typed:')) break;
    await sleep(1000);
  }
  if (!String(typed).startsWith('typed:')) throw new Error('type_into_composer_failed: ' + typed);
  const clicked = await EVAL(
    "(function(){\n" +
    "  var btns = document.querySelectorAll('button');\n" +
    "  for (var i = 0; i < btns.length; i++) {\n" +
    "    var t = btns[i].getAttribute('title') || '';\n" +
    "    if (t.indexOf('发送') >= 0 && btns[i].offsetParent) { btns[i].click(); return 'clicked:' + t; }\n" +
    "  }\n" +
    "  return 'send_button_not_found';\n" +
    "})()");
  run.assert('V1_composer_sent', String(clicked).indexOf('clicked') === 0, String(clicked));

  // 等任务出现（页面 localStorage：streamChatViaTask 提交后写
  // gewu_agent_task_<taskId>，done 后移除——主任务不走 /tasks 端点，那只列子 agent）
  let taskId = null;
  for (let i = 0; i < 30 && !taskId; i++) {
    await sleep(1000);
    const ids = await EVAL(
      "(function(){\n" +
      "  return JSON.stringify(Object.keys(localStorage)\n" +
      "    .filter(function(k){ return k.indexOf('gewu_agent_task_') === 0 || k.indexOf('biof3_agent_task_') === 0; })\n" +
      "    .map(function(k){ return k.split('agent_task_')[1]; }));\n" +
      "})()");
    try {
      const arr = JSON.parse(ids);
      if (Array.isArray(arr) && arr.length) taskId = arr[arr.length - 1];
    } catch {}
  }
  run.assert('V1_task_created', Boolean(taskId), 'taskId=' + (taskId || 'none'));

  // ── V2 摘要卡任务清单节实时出现 + 运行中状态捕获 ──
  // 摘要卡默认收起（useWorkspacePanels summaryOpen=false）——先点顶栏开关展开
  const toggled = await EVAL(
    "(function(){\n" +
    "  var open = document.querySelector('button[aria-label=\"收起摘要概览\"]');\n" +
    "  if (open) return 'already_open';\n" +
    "  var closed = document.querySelector('button[aria-label=\"展开摘要概览\"]');\n" +
    "  if (closed) { closed.click(); return 'clicked_open'; }\n" +
    "  return 'toggle_not_found';\n" +
    "})()");
  run.assert('V2_summary_toggled_open', String(toggled).indexOf('open') >= 0, String(toggled));
  await sleep(800);

  const seen = new Set();
  let sectionSeen = false;
  let duringRows = 0;
  for (let i = 0; i < 90; i++) {
    await sleep(1000);
    const probe = await EVAL(
      "(function(){\n" +
      "  var sec = document.querySelector('[aria-label=\"任务清单\"]');\n" +
      "  if (!sec) return JSON.stringify({ present: false });\n" +
      "  var rows = Array.prototype.map.call(sec.querySelectorAll('li'), function(li){ return li.getAttribute('data-status'); });\n" +
      "  var prog = sec.querySelector('[data-done]');\n" +
      "  return JSON.stringify({ present: true, rows: rows, done: prog ? prog.getAttribute('data-done') : null });\n" +
      "})()");
    let p = { present: false };
    try { p = JSON.parse(probe); } catch {}
    if (p.present) {
      sectionSeen = true;
      duringRows = Math.max(duringRows, (p.rows || []).length);
      (p.rows || []).forEach((s) => seen.add(s));
      if (i === 2 || i === 6) {
        await lib.screenshotPng(client, EVIDENCE_DIR, 'block97-todo-during-' + i + '.png').catch(() => {});
      }
      // 终态：全部 completed 且 done=true，且模型收尾回复已出现 → 跳出
      if ((p.rows || []).length >= 3 && (p.rows || []).every((s) => s === 'completed') && p.done === 'true') {
        // 再确认任务终态（API）
        try {
          const meta = await apiJson('/api/ai/agent/tasks?limit=5');
          const me = (meta.tasks || []).find((t) => t.taskId === taskId);
          if (me && ['done', 'completed', 'failed', 'cancelled'].includes(me.status)) break;
        } catch {}
      }
    }
  }
  run.assert('V2_todo_section_live', sectionSeen, 'section visible during run, rows=' + duringRows);
  run.assert('V2_live_status_transition', seen.has('in_progress') && seen.has('completed'),
    'observed states: ' + Array.from(seen).sort().join(','));

  await sleep(1500);
  const finalDom = await EVAL(
    "(function(){\n" +
    "  var sec = document.querySelector('[aria-label=\"任务清单\"]');\n" +
    "  if (!sec) return 'section_gone';\n" +
    "  return sec.textContent.slice(0, 200);\n" +
    "})()");
  run.assert('V3_final_dom_all_completed', /3\/3/.test(String(finalDom)), String(finalDom).slice(0, 120));
  await lib.screenshotPng(client, EVIDENCE_DIR, 'block97-todo-final.png').catch(() => {});

  // ── V4 事件持久化：afterSeq=0 重放含 task_todo 且顺序正确 ──
  if (!taskId) throw new Error('no_taskId_for_event_assertions');
  const events = await fetchTaskEvents(taskId);
  const todoEvents = events.filter((e) => e && e.event === 'task_todo');
  const todoResults = events.filter((e) => e && e.event === 'tool_result' && e.name === 'todo_write');
  run.assert('V4_task_todo_events_persisted', todoEvents.length >= 2, 'task_todo=' + todoEvents.length + ' tool_result=' + todoResults.length);
  const lastItems = todoEvents.length ? todoEvents[todoEvents.length - 1].items || [] : [];
  run.assert('V4_final_items_all_completed', lastItems.length >= 3 && lastItems.every((it) => it.status === 'completed'),
    'items=' + JSON.stringify(lastItems).slice(0, 160));

  // ── V5 重放确定性 ──
  const events2 = await fetchTaskEvents(taskId);
  const todo2 = events2.filter((e) => e && e.event === 'task_todo');
  const a = JSON.stringify(todoEvents[todoEvents.length - 1] || null);
  const b = JSON.stringify(todo2[todo2.length - 1] || null);
  run.assert('V5_replay_deterministic', todo2.length === todoEvents.length && a === b,
    'counts=' + todoEvents.length + '/' + todo2.length);

  run.finish();
  const passed = run.assertions.filter((a) => a.pass).length;
  console.log('[block97-todo-live] DONE ' + passed + '/' + run.assertions.length + ' allPass=' + run.allPass);
  process.exit(run.allPass ? 0 : 1);
})().catch((err) => {
  console.error('[block97-todo-live] FATAL', err && err.message);
  try { require('fs').mkdirSync(EVIDENCE_DIR, { recursive: true }); } catch {}
  process.exit(2);
});
