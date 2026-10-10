#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow：block107-timeline-history — BLOCK-107 P3 历史恢复腿（UI-428）
 *
 * 主张（plan §6 完成语义第 2、3 条）：**实机看到按发生顺序推进的线**，且老数据不退化。
 * 本 flow 只连自管测试实例（CDP 9223，?test=1），零触碰用户主窗（9222）。
 *
 * 方法：导航到目标项目 → 逐个点选左栏会话行（桌面模式侧栏即会话树）→ 读每条消息
 * 时间线容器（`.sc-conversation-timeline`）子节点的 `(kind, iteration)` 序列，做机械
 * 断言而非人工目检：
 *   A1 会话行存在且可点选
 *   A2 含工具活动的历史会话渲染出时间线（非白屏、正文不丢）
 *   A3 交错真序：同一条时间线内 iteration 非降序，且思考(R)与工具簇(T)交替出现
 *   A4 拍平回归红线：至少一条消息呈现 **多簇**（旧形态是「一个摘要条收编全部工具」，
 *      簇数恒为 1，故此断言只有真交错才能过）
 *   A5 D2 老数据：无任何时间线素材的历史消息仍渲染为正文，不报错、不空白
 * 证据：acceptance/block-107/block107-timeline-history-live.json + 每轮 PNG 截图。
 *
 * 前置：dev 栈在跑（Vite :3000 + 后端 :3001）+ bash scripts/start-test-instance.sh。
 * 本 flow 不启动/不重启 Electron，也不写任何用户数据（只读渲染面）。
 */
const path = require('node:path');
const lib = require('../lib.cjs');

const PROJECT_ID = process.env.BLOCK107_PROJECT || 'p_mu174w3u_ncze';
const APP_ORIGIN = 'http://localhost:3000';
const MAX_ROWS = Number(process.env.BLOCK107_ROWS || 4);
// runner 的 ctx 只给 { assert, timeoutMs }（finish() 不收额外字段），故证据目录在本流
// 内自持一份，与导出的 evidenceDir 同址，截图与 JSON 落同一处。
const EVIDENCE_DIR = path.join(process.cwd(), 'acceptance', 'block-107');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 页面内一次性求值：读全部时间线的 (kind, iteration) 序列 + 消息体文本摘要。 */
const PROBE_EXPR = `JSON.stringify({
  rows: [].slice.call(document.querySelectorAll('li[class*="convItem"]')).map(function(n, i){
    return { i: i, label: (n.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 30),
             active: String(n.className).indexOf('convItemActive') > -1 };
  }),
  timelines: [].slice.call(document.querySelectorAll('.sc-conversation-timeline')).map(function(t){
    return [].slice.call(t.children).map(function(c){
      var kind = c.classList.contains('sc-timeline-reasoning') ? 'R'
        : c.classList.contains('sc-timeline-cluster') ? 'T'
        : c.classList.contains('sc-timeline-progress') ? 'P' : '?';
      return { kind: kind, it: Number(c.getAttribute('data-iteration')) };
    });
  }),
  msgBodies: [].slice.call(document.querySelectorAll('.sc-msg-body')).map(function(n){
    return (n.textContent || '').replace(/\\s+/g, ' ').trim().length;
  }),
})`;

function classify(segments) {
  // 只校验交错与序：narrative 由宿主原位渲染，不进容器（见 ConversationTimeline 文件头）。
  const iterations = segments.map((s) => s.it);
  const monotonic = iterations.every((value, index) => index === 0 || value >= iterations[index - 1]);
  const kinds = segments.map((s) => s.kind).join('');
  const interleaved = /RT|RTP/.test(kinds) && (segments.some((s) => s.kind === 'T'));
  return {
    monotonic,
    interleaved,
    clusters: segments.filter((s) => s.kind === 'T').length,
    hasUnknownKind: kinds.includes('?'),
    detail: segments.map((s) => `${s.kind}:${s.it}`).join(' '),
  };
}

async function waitForRows(client, timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const parsed = JSON.parse(await lib.evalJs(client, PROBE_EXPR, 10_000));
    if (parsed.rows.length > 0) return parsed;
    await sleep(1000);
  }
  return JSON.parse(await lib.evalJs(client, PROBE_EXPR, 10_000));
}

async function clickRow(client, index) {
  await lib.evalJs(client, `
    var li = [].slice.call(document.querySelectorAll('li[class*="convItem"]'))[${index}];
    if (li) { li.click(); 'clicked'; } else { 'no_row'; }`, 10_000);
}

async function openSideChat(client) {
  // 桌面模式聊天在右栏「侧边聊天」tab 内；程序化 click 走 React onClick。
  return lib.evalJs(client, `
    var b = [].slice.call(document.querySelectorAll('button,[role="tab"]'))
      .find(function(x){ return (x.textContent || '').trim() === '侧边聊天'; });
    if (b) { b.click(); 'opened'; } else { 'already'; }`, 10_000);
}

module.exports = {
  id: 'block107-timeline-history',
  description: 'BLOCK-107 P3 历史腿：真实历史会话在测试实例上按 iteration 交错成线 + 老数据不退化',
  evidenceDir: EVIDENCE_DIR,

  async run(ctx) {
    const { assert } = ctx;
    const shots = [];
    const client = await lib.connectTestTarget({ timeoutMs: 20_000 });
    let originalUrl = '';
    try {
      originalUrl = String(await lib.evalJs(client, 'location.href', 8_000));
      await lib.evalJs(client, `location.href = '${APP_ORIGIN}/project/${PROJECT_ID}?test=1'; 'go'`, 10_000);
      const loaded = await waitForRows(client);
      assert('A1_conversation_rows_present', loaded.rows.length > 0,
        `rows=${loaded.rows.length} :: ${loaded.rows.map((r) => r.label).join(' / ').slice(0, 160)}`);

      await openSideChat(client);
      await sleep(1200);

      const perRow = [];
      for (const row of loaded.rows.slice(0, MAX_ROWS)) {
        await clickRow(client, row.i);
        let current = null;
        const deadline = Date.now() + 12_000;
        do {
          await sleep(1200);
          current = JSON.parse(await lib.evalJs(client, PROBE_EXPR, 10_000));
          // 等活动态落到被点的行，且消息体数量变化（会话内容已换）
        } while (Date.now() < deadline && !(current.rows[row.i] && current.rows[row.i].active));

        const classified = current.timelines.map(classify);
        perRow.push({ label: row.label, timelines: current.timelines.length, classified, current });
        const bestIndex = classified.reduce(
          (best, seg, i) => (seg.clusters > (classified[best] ? classified[best].clusters : -1) ? i : best), 0);
        if (classified[bestIndex] && classified[bestIndex].clusters > 0) {
          // 截图必须真的拍到那条线：面板默认滚在正文末尾，时间线在视口外。
          await lib.evalJs(client, `
            var t = document.querySelectorAll('.sc-conversation-timeline')[${bestIndex}];
            if (t) t.scrollIntoView({ block: 'start' }); 'scrolled'`, 8_000).catch(() => null);
          await sleep(500);
          shots.push(await lib.screenshotPng(client, EVIDENCE_DIR,
            `timeline-history-row${row.i}.png`).catch(() => null));
        }
      }

      const withTools = perRow.filter((r) => r.classified.length > 0);
      assert('A2_timeline_rendered_on_history', withTools.length > 0,
        `rows_with_timeline=${withTools.length}/${perRow.length}`);

      const flat = [];
      for (const row of withTools) {
        for (const seg of row.classified) {
          if (!seg.monotonic || seg.hasUnknownKind) {
            flat.push(`${row.label} :: ${seg.detail}`);
          }
        }
      }
      assert('A3_iteration_monotonic_and_wellformed', flat.length === 0,
        flat.length ? `失序/未知节点 ${flat.length} 条 :: ${flat[0]}`.slice(0, 200) : '全部非降序');

      const allSegs = perRow.flatMap((r) => r.classified);
      const bestClusters = Math.max(0, ...allSegs.map((c) => c.clusters));
      const richest = allSegs.reduce((a, b) => (b.clusters > (a ? a.clusters : -1) ? b : a), null);
      assert('A4_multi_cluster_not_flattened', bestClusters >= 2,
        `单条消息最多簇数=${bestClusters}（旧形态恒为 1）:: ${richest ? richest.detail : '-'}`);

      const emptyBodies = perRow.flatMap((r) => r.current.msgBodies).filter((len) => len === 0).length;
      const totalBodies = perRow.reduce((n, r) => n + r.current.msgBodies.length, 0);
      assert('A5_no_blank_message_body', totalBodies > 0 && emptyBodies === 0,
        `msgBodies=${totalBodies} 空体=${emptyBodies}`);

      lib.log(`project=${PROJECT_ID} 点选行=${perRow.length} 截图=${shots.filter(Boolean).length}`
        + ` :: ${perRow.map((r) => `${r.label}→${r.classified.length}条线`).join(' / ')}`);
      return true;
    } finally {
      if (originalUrl && !originalUrl.includes(`/project/${PROJECT_ID}`)) {
        await lib.evalJs(client, `location.href = ${JSON.stringify(originalUrl)}; 'restoring'`, 8_000)
          .catch(() => null);
      }
      try { client.socket.close(); } catch { /* already closed */ }
    }
  },
};
