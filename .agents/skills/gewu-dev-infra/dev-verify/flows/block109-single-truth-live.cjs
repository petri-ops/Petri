#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow：block109-single-truth-live — BLOCK-109-CORE-ARCH P1 验收腿
 * （事件单一事实源 + 恢复单源；plan §1 P1-5）
 *
 * 三腿：
 *   L1 实况——真模型轮次：POST /ai/agent（task 模式唯一路径）→ 运行簇可见；
 *   L2 刷新中恢复——运行中 location.reload()：恢复改问后端（/ai/agent/tasks/inflight
 *      在途清单 + loop_runs 投影），localStorage 双轨已退役——刷新后 UI 重建运行态
 *      并跑完（这是 P1 的核心新行为断言）；
 *   L3 终态对账——完成后再次 reload：时间线投影逐段相等 + 正文在位（历史/实况同源）。
 * 附加单源断言：运行中 inflight 端点列出该会话任务、完成后清空。
 *
 * 范围注记（诚实边界）：「后端进程重启恢复」不在本 flow 自动化——后端重启会杀死
 * 在途 run（进程内循环），语义由 sweepInterruptedRunningTasks 清扫 + 继续执行
 * （BLOCK-38 resume）承接；本 flow 以刷新中恢复（等价的进程外断连场景）为准。
 *
 * 证据：acceptance/block-109/single-truth-*.png/json。前置：dev 栈 + 测试实例
 * （bash scripts/start-test-instance.sh）+ 模型凭据。
 */
const fs = require('node:fs');
const path = require('node:path');
const lib = require('../lib.cjs');

const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local' };
const APP_ORIGIN = 'http://localhost:3000';
const EVIDENCE_DIR = path.join(process.cwd(), 'acceptance', 'block-109');
const RUN_TIMEOUT_MS = Number(process.env.BLOCK109_ST_RUN_TIMEOUT_MS || 420_000);

const PROMPT = '请执行命令 `node -e "setTimeout(()=>console.log(1),25000)"` 并等它执行完，'
  + '然后用一句话告诉我命令的输出。';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function rest(method, endpoint, body) {
  const resp = await fetch(API + endpoint, {
    method,
    headers: { ...AUTH, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await resp.json().catch(() => null);
  return { ok: resp.ok, data };
}

/** 主投影探针：时间线段序列 + 运行簇 + 正文长度。 */
const MAIN_PROBE = `JSON.stringify((function(){
  var timelines = [].slice.call(document.querySelectorAll('[data-projection="conversation"] .sc-conversation-timeline')).map(function(t){
    return [].slice.call(t.children).map(function(c){
      var kind = c.classList.contains('sc-timeline-transition') ? 'X'
        : c.classList.contains('sc-timeline-reasoning') ? 'R'
        : c.classList.contains('sc-timeline-cluster') ? 'T' : '?';
      return kind + ':' + (c.getAttribute('data-iteration') || '-');
    }).join(' ');
  });
  var bodies = [].slice.call(document.querySelectorAll('[data-projection="conversation"] .sc-msg-body'))
    .map(function(n){ return (n.textContent || '').replace(/\\s+/g, ' ').trim().length; });
  return {
    timelines: timelines,
    running: document.querySelectorAll('[data-projection="conversation"] .sc-timeline-cluster[data-state="running"]').length,
    lastBody: bodies.length ? bodies[bodies.length - 1] : 0,
  };
})())`;

async function probeMain(client) {
  return JSON.parse(await lib.evalJs(client, MAIN_PROBE, 10_000));
}

module.exports = {
  id: 'block109-single-truth-live',
  description: 'BLOCK-109-CORE-ARCH P1 验收：实况/刷新中恢复（后端单源）/终态对账 三腿 + inflight 端点单源断言',
  evidenceDir: EVIDENCE_DIR,

  async run({ assert }) {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    const client = await lib.connectTestTarget({ timeoutMs: 25_000 });
    const originalUrl = String(await lib.evalJs(client, 'location.href', 8_000));
    let projectId = null;
    let conversationId = null;

    try {
      const created = await rest('POST', '/data/projects', { name: `B109-SingleTruth-${Date.now()}`, modality: 'general' });
      if (!created.ok || !created.data?.project) throw new Error('create_project_failed: ' + JSON.stringify(created.data).slice(0, 200));
      projectId = created.data.project.id;

      await lib.evalJs(client, `location.href = '${APP_ORIGIN}/?project=${projectId}'; 'go'`, 10_000);
      // UI-430 教训：路由稳定等待后再等 composer。
      await sleep(10000);
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

      // 发送确认（2.5s×4 重试，block108 定版）。
      let sent = 'not_sent';
      for (let attempt = 1; attempt <= 4 && sent !== 'sent_ok'; attempt++) {
        await sleep(2500);
        sent = await lib.evalJs(client, `(function(){
          var ta = document.querySelector('[class*="chatMount"] textarea.sc-input');
          if (ta && (ta.value || '').trim().length > 0) {
            var btns = document.querySelectorAll('[class*="chatMount"] button');
            for (var i = 0; i < btns.length; i++) {
              if ((btns[i].getAttribute('title') || '').indexOf('发送消息') >= 0) { btns[i].click(); return 'clicked_retry'; }
            }
          }
          return 'sent_ok';
        })()`, 10_000);
        lib.log(`send attempt ${attempt}: ${sent}`);
      }
      if (sent !== 'sent_ok') throw new Error('send_confirm_failed');

      const convs = await rest('GET', `/ai/conversations?status=active&project_id=${encodeURIComponent(projectId)}`);
      conversationId = (convs.data?.conversations || [])[0]?.id || null;
      lib.log(`project=${projectId} conv=${conversationId}`);

      const deadline = Date.now() + RUN_TIMEOUT_MS;

      // L1 实况：运行簇可见。
      let main = null;
      while (Date.now() < deadline) {
        await sleep(2000);
        main = await probeMain(client);
        if (main.running > 0 || main.timelines.length > 0) break;
      }
      assert('L1_live_run_visible', !!main && (main.running > 0 || (main.timelines || []).length > 0),
        `running=${main && main.running} timelines=${JSON.stringify(main && main.timelines).slice(0, 160)}`);

      // L2 单源断言（运行中）：inflight 端点列出本会话在途任务（恢复的后端单一源）。
      let inflightMid = null;
      if (conversationId) {
        const listed = await rest('GET', `/ai/agent/tasks/inflight?conversationId=${encodeURIComponent(conversationId)}`);
        inflightMid = (listed.data?.tasks || []).map((t) => t.taskId);
      }
      assert('L2_inflight_endpoint_lists_running_task', (inflightMid || []).length > 0,
        `conv=${conversationId} inflight=${JSON.stringify(inflightMid)}`);

      // L3 刷新中恢复：运行中 reload → UI 经后端单源重建运行态（localStorage 已退役）。
      await lib.evalJs(client, 'location.reload(); "reloading"', 8_000).catch(() => null);
      await sleep(10000);
      const recovDeadline = Date.now() + 60_000;
      let recovered = null;
      while (Date.now() < recovDeadline) {
        await sleep(3000);
        recovered = await probeMain(client).catch(() => null);
        if (recovered && recovered.running > 0) break;
      }
      assert('L3_refresh_recovers_running_from_backend', !!recovered && recovered.running > 0,
        `刷新后运行态重建 running=${recovered && recovered.running} timelines=${JSON.stringify(recovered && recovered.timelines).slice(0, 160)}`);
      await lib.screenshotPng(client, EVIDENCE_DIR, 'single-truth-recovered-running.png').catch(() => null);

      // 等待运行完成（恢复后跑完剩余时长）。
      let afterRun = null;
      while (Date.now() < deadline) {
        await sleep(4000);
        afterRun = await probeMain(client).catch(() => null);
        if (afterRun && afterRun.running === 0 && afterRun.lastBody > 0 && (afterRun.timelines || []).length > 0) {
          const settleKey = JSON.stringify(afterRun.timelines);
          let stable = 1;
          for (let i = 0; i < 6 && stable < 5; i++) {
            await sleep(2000);
            const s = await probeMain(client).catch(() => null);
            stable = s && JSON.stringify(s.timelines) === settleKey ? stable + 1 : 0;
          }
          if (stable >= 5) break;
        }
      }
      assert('L4_run_completes_after_recovery', !!afterRun && afterRun.running === 0 && afterRun.lastBody > 0,
        `after recovery: running=${afterRun && afterRun.running} lastBody=${afterRun && afterRun.lastBody}`);

      // L5 单源断言（终态）：inflight 清空。
      let inflightAfter = ['unknown'];
      if (conversationId) {
        const listed2 = await rest('GET', `/ai/agent/tasks/inflight?conversationId=${encodeURIComponent(conversationId)}`);
        inflightAfter = (listed2.data?.tasks || []).map((t) => t.taskId);
      }
      assert('L5_inflight_empty_after_terminal', (inflightAfter || []).length === 0,
        `inflightAfter=${JSON.stringify(inflightAfter)}`);

      // L6 终态对账：完成后 reload → 投影逐段相等 + 正文在位。
      const preReloadSeq = JSON.stringify((afterRun && afterRun.timelines) || []);
      await lib.evalJs(client, 'location.reload(); "reloading"', 8_000).catch(() => null);
      await sleep(10000);
      let finalSnap = null;
      for (let i = 0; i < 15; i++) {
        finalSnap = await probeMain(client).catch(() => null);
        if (finalSnap && (finalSnap.timelines || []).length > 0 && finalSnap.lastBody > 0) break;
        await sleep(2000);
      }
      const sameProjection = finalSnap && JSON.stringify(finalSnap.timelines) === preReloadSeq;
      assert('L6_final_reload_projection_stable', !!sameProjection && finalSnap.lastBody > 0,
        `pre=${preReloadSeq.slice(0, 160)} post=${JSON.stringify(finalSnap && finalSnap.timelines).slice(0, 160)} lastBody=${finalSnap && finalSnap.lastBody}`);
      await lib.screenshotPng(client, EVIDENCE_DIR, 'single-truth-final.png').catch(() => null);

      fs.writeFileSync(
        path.join(EVIDENCE_DIR, 'single-truth-samples.json'),
        JSON.stringify({ prompt: PROMPT, conversationId, inflightMid, inflightAfter, final: finalSnap }, null, 2),
      );
      return true;
    } finally {
      const cleanup = [];
      if (conversationId) cleanup.push('conv=' + (await rest('DELETE', `/ai/conversations/${encodeURIComponent(conversationId)}`).then(() => true).catch(() => false)));
      if (projectId) cleanup.push('project=' + (await rest('DELETE', `/data/projects/${encodeURIComponent(projectId)}`).then(() => true).catch(() => false)));
      await lib.evalJs(client, `location.href = ${JSON.stringify(originalUrl)}; 'restore'`, 8_000).catch(() => null);
      assert('L7_temp_data_cleaned_up', cleanup.length === 2 && cleanup.every((s) => s.endsWith('true')),
        cleanup.join(' ') + (conversationId ? '' : ' [会话 id 未取得，可能残留]'));
      try { client.socket.close(); } catch { /* already closed */ }
    }
  },
};
