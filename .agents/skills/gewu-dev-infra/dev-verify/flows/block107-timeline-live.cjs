#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow：block107-timeline-live — BLOCK-107 P3 实况腿（UI-428）
 *
 * 覆盖 plan §1 P3 的「多轮工具 / 失败重试」+ §5-2「历史/实况一致性」的**实机**对账，
 * 以及 D4（运行中展开 / 完成收起）与 P2c 秒表的实机形态。只连自管测试实例（:9223）。
 *
 * 数据副作用与清理（本 flow 会真调模型，故必须自带收口）：
 *   建临时项目 `B107-实况-<ts>` → 会话由 SimpleChat 自建 → finally 里 DELETE 会话 +
 *   DELETE 项目 + 恢复原 URL；清理结果进 A7 断言，失败即判红，不留残数据。
 *
 * 断言：
 *   L1 实况轮次渲染出时间线（非旧模板堆叠）
 *   L2 运行中至少一次观察到 `data-state="running"` 的簇（D4 展开态）
 *   L3 运行中至少一次观察到簇头「已运行」（P2c 秒表）
 *   L4 一迭代一簇 + iteration 非降序（结构正确性；「多簇」不在此重复要求——
 *      模型并行发起 tool_calls 时天然只出 1 簇，多簇形态由历史腿的 13 簇证）
 *   L5 失败可见：某簇头带「N 项需注意」（读不存在文件 → error → failedCount）
 *   L6 **刷新后同序**：重载后该轮时间线序列与实况逐段相等（§5-2 实机版）
 *   L7 临时数据清理完成
 * 证据：acceptance/block-107/block107-timeline-live.json + running/settled/reloaded 三张 PNG
 *   + block107-timeline-live-samples.json（逐 800ms 样本：tl/running/秒表/失败头/exec 行状态/命令文本）。
 *
 * 前置：dev 栈在跑 + 测试实例（bash scripts/start-test-instance.sh）+ **模型凭据已配置**。
 * 判据诚实性：模型若不调用工具，L1/L4 会真红——那是实况事实，不做放宽。
 */
const fs = require('node:fs');
const path = require('node:path');
const lib = require('../lib.cjs');

const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local' };
const APP_ORIGIN = 'http://localhost:3000';
const EVIDENCE_DIR = path.join(process.cwd(), 'acceptance', 'block-107');
const RUN_TIMEOUT_MS = Number(process.env.BLOCK107_RUN_TIMEOUT_MS || 300_000);
// 提示词形状是被判据约束的：本地工具（list/read）只跑几十毫秒，2.5s 采样抓不到
// running 窗口、秒表更不可能出现；并行 tool_calls 又会把多个工具压进同一 iteration
// 只产出 1 簇。故这里显式要求「先跑一个约 4 秒的命令，再列目录」——既制造可观察的
// 运行窗口，又逼出跨 iteration 的分批。
const PROMPT = '请依次用工具完成三件事，每件事单独一次调用，按顺序逐个来做、不要并行：'
  + '(1) 执行命令 `node -e "setTimeout(()=>console.log(1),4000)"` 并等它执行完；'
  + '(2) 执行命令 `cat 不存在的文件-实况腿.txt`——该文件不存在、执行会失败，这是测试的一部分，请照实执行不要跳过；'
  + '(3) 列出项目根目录的文件；'
  + '最后用一句话总结这个项目里有什么。';

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

/** 页面内求值：时间线逐段序列 + 运行态/秒表/失败计数 + 末条正文长度。 */
const PROBE = `JSON.stringify((function(){
  var timelines = [].slice.call(document.querySelectorAll('.sc-conversation-timeline')).map(function(t){
    return [].slice.call(t.children).map(function(c){
      var kind = c.classList.contains('sc-timeline-reasoning') ? 'R'
        : c.classList.contains('sc-timeline-cluster') ? 'T'
        : c.classList.contains('sc-timeline-progress') ? 'P' : '?';
      return kind + ':' + (c.getAttribute('data-iteration') || '-');
    }).join(' ');
  });
  var heads = [].slice.call(document.querySelectorAll('.sc-tool-activity-summary-label'))
    .map(function(n){ return (n.textContent || '').replace(/\\s+/g, ' ').trim(); });
  var bodies = [].slice.call(document.querySelectorAll('.sc-msg-body'))
    .map(function(n){ return (n.textContent || '').replace(/\\s+/g, ' ').trim().length; });
  var termStates = [].slice.call(document.querySelectorAll('.sc-tool-term')).map(function(n){
    return n.getAttribute('data-status') || '?';
  });
  var cmds = [].slice.call(document.querySelectorAll('.sc-tool-term-cmd-preview'))
    .slice(-4).map(function(n){ return (n.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 60); });
  return {
    timelines: timelines,
    running: document.querySelectorAll('.sc-timeline-cluster[data-state="running"]').length,
    stopwatch: heads.filter(function(t){ return t.indexOf('已运行') > -1; }).length,
    errorRows: document.querySelectorAll('.sc-tool-qoder-row[data-status="error"]').length,
    lastBody: bodies.length ? bodies[bodies.length - 1] : 0,
    termStates: termStates,
    cmds: cmds,
  };
})())`;

function classify(seq) {
  const parts = seq ? seq.split(' ') : [];
  const iterations = parts.map((p) => Number(p.slice(2)));
  const toolIterations = parts.filter((p) => p.startsWith('T')).map((p) => Number(p.slice(2)));
  return {
    clusters: toolIterations.length,
    distinctClusterIterations: new Set(toolIterations).size,
    monotonic: iterations.every((v, i) => i === 0 || v >= iterations[i - 1]),
  };
}

module.exports = {
  id: 'block107-timeline-live',
  description: 'BLOCK-107 P3 实况腿：真模型轮次的运行中展开/秒表/失败可见 + 刷新后同序对账',
  evidenceDir: EVIDENCE_DIR,

  async run({ assert }) {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    const client = await lib.connectTestTarget({ timeoutMs: 25_000 });
    const originalUrl = String(await lib.evalJs(client, 'location.href', 8_000));
    let projectId = null;
    let conversationId = null;
    const seen = { running: 0, stopwatch: 0 };
    let liveSeq = null;

    try {
      const created = await rest('POST', '/data/projects', { name: `B107-实况-${Date.now()}`, modality: 'general' });
      if (!created.ok || !created.data?.project) throw new Error('create_project_failed: ' + JSON.stringify(created.data).slice(0, 200));
      projectId = created.data.project.id;

      await lib.evalJs(client, `location.href = '${APP_ORIGIN}/?project=${projectId}'; 'go'`, 10_000);
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
        return 'typed';
      })()`, 10_000);
      if (typed !== 'typed') throw new Error('type_into_composer_failed: ' + typed);

      const sent = await lib.evalJs(client, `(function(){
        var btns = document.querySelectorAll('[class*="chatMount"] button');
        for (var i = 0; i < btns.length; i++) {
          if ((btns[i].getAttribute('title') || '').indexOf('发送消息') >= 0) { btns[i].click(); return 'clicked'; }
        }
        return 'send_button_not_found';
      })()`, 10_000);
      if (sent !== 'clicked') throw new Error('click_send_failed: ' + sent);

      // 运行期观察：逐样本记录（tl 数/运行簇/秒表/失败簇头/exec 行状态/命令文本），
      // 抓 running 簇与秒表各一次并取首张图证；样本若全部 miss（L2/L3 红）时，
      // 逐样本日志是唯一的定位依据（见 acceptance/block-107/*-samples.json）。
      const deadline = Date.now() + RUN_TIMEOUT_MS;
      const sentAt = Date.now();
      const samples = [];
      let stableSamples = 0;
      let lastSample = '';
      let shotRunning = null;
      while (Date.now() < deadline) {
        await sleep(800);
        const snap = JSON.parse(await lib.evalJs(client, PROBE, 10_000));
        const row = {
          t: Date.now() - sentAt,
          tl: snap.timelines.length,
          running: snap.running,
          sw: snap.stopwatch,
          att: snap.attention,
          termStates: snap.termStates,
          cmds: snap.cmds,
        };
        samples.push(row);
        lib.log(`sample ${JSON.stringify(row)}`);
        if (snap.running > 0) {
          seen.running += 1;
          if (!shotRunning) {
            shotRunning = await lib.screenshotPng(client, EVIDENCE_DIR, 'timeline-live-running.png').catch(() => null);
          }
        }
        if (snap.stopwatch > 0) seen.stopwatch += 1;
        const settled = snap.running === 0 && snap.timelines.length > 0 && snap.lastBody > 40;
        const key = settled ? snap.timelines.join('|') : '';
        stableSamples = settled && key && key === lastSample ? stableSamples + 1 : 0;
        lastSample = key;
        if (stableSamples >= 3) { liveSeq = snap.timelines; break; }
      }
      if (!liveSeq) {
        const final = JSON.parse(await lib.evalJs(client, PROBE, 10_000));
        liveSeq = final.timelines;
      }
      fs.writeFileSync(
        path.join(EVIDENCE_DIR, 'block107-timeline-live-samples.json'),
        JSON.stringify({ prompt: PROMPT, samples }, null, 2)
      );

      const classified = (liveSeq || []).map(classify);
      const maxClusters = Math.max(0, ...classified.map((c) => c.clusters));
      assert('L1_live_timeline_rendered', (liveSeq || []).length > 0 && maxClusters > 0,
        `timelines=${(liveSeq || []).length} maxClusters=${maxClusters}`);
      assert('L2_running_cluster_observed', seen.running > 0, `running 采样命中=${seen.running}`);
      assert('L3_stopwatch_observed', seen.stopwatch > 0, `秒表采样命中=${seen.stopwatch}`);
      assert('L4_one_cluster_per_iteration_ordered', maxClusters >= 1
        && classified.every((c) => c.monotonic),
        // UI-430 修订（2026-09-21 用户裁决「执行工具 1 次成串看着懵逼」）：相邻无过渡
        // 叙述的工具轮合并为单簇（ZCode 参考形态），「一迭代一簇」契约被
        // 「簇内迭代非降序」取代——monotonic 仍逐段成立。
        `maxClusters=${maxClusters} 全部非降序=${classified.every((c) => c.monotonic)} `
        + `（一迭代一簇契约已由 UI-430 合并簇取代） :: `
        + (liveSeq || []).slice(-1)[0]);
      // UI-437 v4 — 完成任务先折叠为运行摘要行：点摘要行展开明细，再判 error 行可见性
      await lib.evalJs(client, `(function(){ var f = document.querySelector('.sc-run-fold-line'); if (f) { f.click(); return 'clicked'; } return 'no_fold'; })()`, 10_000);
      await sleep(600);
      // L5 失败可见（UI-437 v2 纯流水契约）：读不存在文件 → error → 以 error 行可见
      const tail = JSON.parse(await lib.evalJs(client, PROBE, 10_000));
      assert('L5_failure_visible_in_error_row', tail.errorRows > 0,
        `data-status=error 的 Qoder 行=${tail.errorRows}`);
      await lib.screenshotPng(client, EVIDENCE_DIR, 'timeline-live-settled.png').catch(() => null);

      // L6 刷新后同序（§5-2 实机版）：整页重载 → 走历史加载轨道 → 逐段比对。
      await lib.evalJs(client, 'location.reload(); "reloading"', 8_000).catch(() => null);
      await sleep(6000);
      let reloaded = null;
      for (let i = 0; i < 20; i++) {
        reloaded = JSON.parse(await lib.evalJs(client, PROBE, 10_000));
        if (reloaded.timelines.length > 0) break;
        await sleep(2000);
      }
      const same = JSON.stringify(reloaded?.timelines || []) === JSON.stringify(liveSeq);
      assert('L6_history_matches_live_projection', same,
        `live=${(liveSeq || []).slice(-1)[0]} reloaded=${(reloaded?.timelines || []).slice(-1)[0]}`);
      await lib.screenshotPng(client, EVIDENCE_DIR, 'timeline-live-reloaded.png').catch(() => null);

      const convs = await rest('GET', `/ai/conversations?status=active&project_id=${encodeURIComponent(projectId)}`);
      conversationId = (convs.data?.conversations || [])[0]?.id || null;
      lib.log(`project=${projectId} conv=${conversationId} running=${seen.running} 秒表=${seen.stopwatch} 图=${[shotRunning].filter(Boolean).length + 2} 张`);
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
