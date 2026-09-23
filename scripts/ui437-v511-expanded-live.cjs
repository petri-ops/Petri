#!/usr/bin/env node
'use strict';

/**
 * UI-437 v5.11 实机验证（dev Electron 测试实例，只连 :9223，禁触用户主窗 :9222）：
 * 真跑一轮「system_info + knowledge_search」只读任务（复刻用户截图场景），终态后
 * 展开运行摘要与全部工具行，机械量测展开体：
 *   V1 无工具名行（.sc-tool-activity-tool 不存在）
 *   V2 无「返回」标题（.sc-tool-resultdata-title 不存在）
 *   V3 JSON 框在场且复制钮悬浮框内右上角（copy rect 落在 frame 顶部区域内）
 *   V4 展开态无游离行复制钮（.sc-tool-row-copy 计数 0）
 *   V5 溢出收敛：JSON 框右缘不越出宿主列（escapePx <= 0）+ 页面级零横向溢出
 * 证据：acceptance/ui-437/ui437-v511-expanded-live.json + PNG。
 * 前置：dev 栈在跑 + bash scripts/start-test-instance.sh。临时项目/会话 finally 清理。
 */
const fs = require('node:fs');
const path = require('node:path');
const lib = require(path.join(process.cwd(), '.agents', 'skills', 'gewu-dev-infra', 'dev-verify', 'lib.cjs'));

const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local' };
const APP_ORIGIN = 'http://localhost:3000';
const EVIDENCE_DIR = path.join(process.cwd(), 'acceptance', 'ui-437');
const RUN_TIMEOUT_MS = Number(process.env.UI437_RUN_TIMEOUT_MS || 240_000);

const PROMPT = '只读检查，共两步，不要写任何文件：'
  + '(1) 调用 system_info 一次；'
  + '(2) 用 knowledge_search 检索一次，query 用「溢出逃逸测试超长文本行横向滚动验证用」；'
  + '最后用一句话总结即可。';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rest(method, endpoint, body) {
  const resp = await fetch(API + endpoint, {
    method,
    headers: { ...AUTH, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await resp.json().catch(() => null);
  return { ok: resp.ok, data };
}

const GEOM_PROBE = `JSON.stringify((function(){
  var frames = [].slice.call(document.querySelectorAll('.sc-tool-resultdata-frame')).map(function(f){
    var fr = f.getBoundingClientRect();
    var pre = f.querySelector('.sc-tool-resultdata-json');
    var copy = f.querySelector('.sc-tool-resultdata-copy');
    var pr = pre ? pre.getBoundingClientRect() : null;
    var cr = copy ? copy.getBoundingClientRect() : null;
    var host = f.closest('.sc-tool-activity-inline') || f.closest('.sc-conversation-timeline') || f.parentElement;
    var hr = host ? host.getBoundingClientRect() : null;
    return {
      hasPre: !!pre,
      hasCopy: !!copy,
      jsonScrollW: pre ? pre.scrollWidth : null,
      jsonClientW: pre ? pre.clientWidth : null,
      innerScrollsX: pre ? (pre.scrollWidth > pre.clientWidth) : null,
      escapePx: (pr && hr) ? Math.round(pr.right - hr.right) : null,
      copyTopInside: (cr && fr) ? Math.round(cr.top - fr.top) : null,
      copyRightInside: (cr && fr) ? Math.round(fr.right - cr.right) : null,
      copyWithinFrame: (cr && fr) ? (cr.top >= fr.top - 1 && cr.bottom <= fr.bottom + 1 && cr.right <= fr.right + 1 && cr.left >= fr.left - 1) : null,
    };
  });
  return {
    frames: frames,
    toolNameEls: document.querySelectorAll('.sc-tool-activity-tool').length,
    titleEls: document.querySelectorAll('.sc-tool-resultdata-title').length,
    expandedRows: document.querySelectorAll('.sc-tool-qoder-head[data-expanded]').length,
    strayRowCopy: document.querySelectorAll('.sc-tool-qoder-row .sc-tool-row-copy').length,
    docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
})())`;

async function main() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const results = [];
  const assert = (name, pass, detail) => {
    results.push({ name, pass: !!pass, detail: String(detail || '').slice(0, 300) });
    fs.writeFileSync(path.join(EVIDENCE_DIR, 'ui437-v511-expanded-live.json'),
      JSON.stringify({ prompt: PROMPT, at: new Date().toISOString(), results }, null, 2));
    console.log(`${pass ? 'PASS' : 'FAIL'} ${name} :: ${String(detail || '').slice(0, 220)}`);
  };

  const client = await lib.connectTestTarget({ timeoutMs: 25_000 });
  const originalUrl = String(await lib.evalJs(client, 'location.href', 8_000));
  let projectId = null;
  let conversationId = null;
  try {
    const created = await rest('POST', '/data/projects', { name: `UI437-v511-${Date.now()}`, modality: 'general' });
    if (!created.ok || !created.data?.project) throw new Error('create_project_failed');
    projectId = created.data.project.id;

    await lib.evalJs(client, `location.href = '${APP_ORIGIN}/?project=${projectId}'; 'go'`, 10_000);
    await sleep(9000);
    const welcomed = Date.now() + 30_000;
    while (Date.now() < welcomed
      && !(await lib.evalJs(client, `!!document.querySelector('[class*="chatMount"] textarea.sc-input')`, 8_000).catch(() => false))) {
      await sleep(1000);
    }
    const typed = await lib.evalJs(client, `(function(){
      var ta = document.querySelector('[class*="chatMount"] textarea.sc-input');
      if (!ta) return 'no_textarea';
      var setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, ${JSON.stringify(PROMPT)});
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      var btns = document.querySelectorAll('[class*="chatMount"] button');
      for (var i = 0; i < btns.length; i++) {
        if ((btns[i].getAttribute('title') || '').indexOf('发送消息') >= 0) { btns[i].click(); return 'typed'; }
      }
      return 'no_send_button';
    })()`, 10_000);
    if (typed !== 'typed') throw new Error('send_click_failed: ' + typed);

    // 等终态：running 簇 0 + 时间线在场 + 连续 8 样本稳定
    const deadline = Date.now() + RUN_TIMEOUT_MS;
    let stable = 0; let lastKey = ''; let settled = false;
    while (Date.now() < deadline) {
      await sleep(800);
      const snap = JSON.parse(await lib.evalJs(client, `JSON.stringify({
        running: document.querySelectorAll('.sc-timeline-cluster[data-state="running"]').length,
        rows: document.querySelectorAll('.sc-tool-qoder-row').length,
        fold: document.querySelectorAll('.sc-run-fold-line').length,
        body: (function(){ var b = document.querySelectorAll('.sc-msg-body'); return b.length ? (b[b.length-1].textContent || '').length : 0; })(),
      })`, 10_000));
      const key = `${snap.running}|${snap.rows}|${snap.fold}|${snap.body}`;
      const isSettled = Number(snap.running) === 0 && Number(snap.fold) > 0 && Number(snap.body) > 20;
      stable = isSettled && key === lastKey ? stable + 1 : 0;
      lastKey = key;
      if (stable >= 8) { settled = true; break; }
    }
    assert('V0_task_reached_terminal', settled, `stableKey=${lastKey}`);
    if (!settled) throw new Error('task_not_settled_in_time');

    // 展开：运行摘要行 → 全部簇 → 全部工具行
    await lib.evalJs(client, `(function(){ var f = document.querySelector('.sc-run-fold-line'); if (f) f.click(); return 'x'; })()`, 10_000);
    await sleep(600);
    await lib.evalJs(client, `(function(){
      var s = [].slice.call(document.querySelectorAll('.sc-tool-activity-summary'));
      s.forEach(function(x){ if (x.getAttribute('aria-expanded') === 'false') x.click(); });
      return s.length;
    })()`, 10_000);
    await sleep(500);
    await lib.evalJs(client, `(function(){
      var h = [].slice.call(document.querySelectorAll('.sc-tool-qoder-head'));
      h.forEach(function(x){ if (x.getAttribute('aria-expanded') === 'false') x.click(); });
      return h.length;
    })()`, 10_000);
    await sleep(900);

    const geom = JSON.parse(await lib.evalJs(client, GEOM_PROBE, 15_000));
    assert('V1_no_tool_name_row', geom.toolNameEls === 0, `toolNameEls=${geom.toolNameEls}`);
    assert('V2_no_result_title', geom.titleEls === 0, `titleEls=${geom.titleEls}`);
    assert('V3_copy_inside_frame_top_right',
      geom.frames.length > 0 && geom.frames.every((f) => f.hasPre && f.hasCopy && f.copyWithinFrame
        && f.copyTopInside !== null && f.copyTopInside >= 0 && f.copyTopInside <= 30),
      `frames=${geom.frames.length} :: ${JSON.stringify(geom.frames).slice(0, 240)}`);
    assert('V4_no_stray_row_copy_when_expanded',
      Number(geom.expandedRows) > 0 && Number(geom.strayRowCopy) === 0,
      `expandedRows=${geom.expandedRows} strayRowCopy=${geom.strayRowCopy}`);
    assert('V5_json_contained_no_page_overflow',
      geom.frames.length > 0 && geom.frames.every((f) => f.escapePx !== null && f.escapePx <= 0)
        && Number(geom.docOverflow) === 0,
      `escape=[${geom.frames.map((f) => f.escapePx).join(',')}] innerScrollsX=[${geom.frames.map((f) => f.innerScrollsX).join(',')}] docOverflow=${geom.docOverflow}`);

    await lib.screenshotPng(client, EVIDENCE_DIR, 'ui437-v511-expanded-live.png').catch(() => null);

    const convs = await rest('GET', `/ai/conversations?status=active&project_id=${encodeURIComponent(projectId)}`);
    conversationId = (convs.data?.conversations || [])[0]?.id || null;
    return results.every((r) => r.pass);
  } finally {
    const cleanup = [];
    if (conversationId) cleanup.push(await rest('DELETE', `/ai/conversations/${encodeURIComponent(conversationId)}`).then(() => true).catch(() => false));
    if (projectId) cleanup.push(await rest('DELETE', `/data/projects/${encodeURIComponent(projectId)}`).then(() => true).catch(() => false));
    await lib.evalJs(client, `location.href = ${JSON.stringify(originalUrl)}; 'restore'`, 8_000).catch(() => null);
    console.log(`cleanup: conv+project deleted=${cleanup.filter(Boolean).length}/${cleanup.length}`);
    try { client.socket.close(); } catch { /* */ }
  }
}

main().then((ok) => process.exit(ok ? 0 : 2)).catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
