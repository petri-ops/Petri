#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow：block107-timeline-hosts — BLOCK-107 P3 三宿主面一致性（UI-428）
 *
 * 主张（plan §5-6「三宿主面行为一致」）：同一条会话在**中央面**（工程工作区中栏
 * 聊天投影层 `[data-projection="conversation"]`）与**悬挂面**（`[data-testid=
 * "side-chat-surface"]`，UI-417 收编自右栏 chat tab）渲染出的时间线 `(kind, iteration)`
 * 序列**逐段相等**；**欢迎页**（UI-341/373 composer-only 变体）不承载消息流，
 * 断言其挂载正常且零时间线节点（按设计，不是缺口，登记在案）。
 *
 * 只连自管测试实例（CDP 9223，?test=1），只读渲染面、零写数据；结束恢复原 URL。
 *
 * 断言：
 *   H1 中央面：选中的历史会话渲染出多簇交错时间线（≥2 簇 + 非降序 + 无未知节点）
 *   H2 悬挂面：打开把手后悬挂面时间线序列与中央面逐段相等（≥1 条非空）
 *   H3 欢迎页：composer 挂载正常、chatMount 内零时间线节点（composer-only 设计）
 * 证据：acceptance/block-107/block107-timeline-hosts-live.json（runner 汇总）
 *   + block107-timeline-hosts-scopes.json（逐面原始序列）+ 两张 PNG。
 *
 * 前置：dev 栈在跑（Vite :3000 + 后端 :3001）+ bash scripts/start-test-instance.sh。
 * 本 flow 不启动/不重启 Electron。
 */
const fs = require('node:fs');
const path = require('node:path');
const lib = require('../lib.cjs');

const projectId = () => process.env.BLOCK107_PROJECT || 'p_mu174w3u_ncze';
const APP_ORIGIN = 'http://localhost:3000';
const MAX_ROWS = Number(process.env.BLOCK107_HOSTS_ROWS || 3);
const EVIDENCE_DIR = path.join(process.cwd(), 'acceptance', 'block-107');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 页面内一次性求值：左栏会话行 + 三宿主面各自的时间线序列。 */
const PROBE_EXPR = `JSON.stringify((function(){
  function seq(scope){
    if (!scope) return null;
    return [].slice.call(scope.querySelectorAll('.sc-conversation-timeline')).map(function(t){
      return [].slice.call(t.children).map(function(c){
        var kind = c.classList.contains('sc-timeline-reasoning') ? 'R'
          : c.classList.contains('sc-timeline-cluster') ? 'T'
          : c.classList.contains('sc-timeline-progress') ? 'P' : '?';
        return kind + ':' + (c.getAttribute('data-iteration') || '-');
      }).join(' ');
    });
  }
  var center = document.querySelector('[data-projection="conversation"]');
  var dock = document.querySelector('[data-testid="side-chat-surface"]');
  var welcome = document.querySelector('[class*="chatMount"]');
  return {
    rows: [].slice.call(document.querySelectorAll('li[class*="convItem"]')).map(function(n, i){
      return { i: i, label: (n.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 30),
               active: String(n.className).indexOf('convItemActive') > -1 };
    }),
    center: seq(center),
    centerActive: center ? String(center.className).indexOf('Active') > -1 : false,
    dockOpen: !!dock,
    dock: seq(dock),
    welcomeMounted: !!welcome,
    welcomeTextarea: !!(welcome && welcome.querySelector('textarea.sc-input')),
    welcomeTimelines: welcome ? seq(welcome).length : -1,
  };
})())`;

function classify(seq) {
  const parts = seq ? seq.split(' ').filter(Boolean) : [];
  const iterations = parts.map((p) => Number(p.slice(2)));
  const kinds = parts.map((p) => p.slice(0, 1)).join('');
  return {
    clusters: kinds.split('T').length - 1,
    monotonic: iterations.every((v, i) => i === 0 || v >= iterations[i - 1]),
    hasUnknownKind: kinds.includes('?'),
    hasReasoningAndTools: /R/.test(kinds) && /T/.test(kinds),
  };
}

async function probe(client) {
  return JSON.parse(await lib.evalJs(client, PROBE_EXPR, 10_000));
}

module.exports = {
  id: 'block107-timeline-hosts',
  description: 'BLOCK-107 P3 三宿主面一致性：中央面/悬挂面时间线逐段相等 + 欢迎页 composer-only 不回退',
  evidenceDir: EVIDENCE_DIR,

  async run(ctx) {
    const { assert } = ctx;
    const client = await lib.connectTestTarget({ timeoutMs: 20_000 });
    let originalUrl = '';
    try {
      originalUrl = String(await lib.evalJs(client, 'location.href', 8_000));
      await lib.evalJs(client, `location.href = '${APP_ORIGIN}/project/${projectId()}?test=1'; 'go'`, 10_000);

      // 等左栏会话行出现
      let loaded = null;
      const rowsDeadline = Date.now() + 25_000;
      while (Date.now() < rowsDeadline) {
        loaded = await probe(client);
        if (loaded.rows.length > 0) break;
        await sleep(1000);
      }
      assert('H0_conversation_rows_present', loaded.rows.length > 0,
        `rows=${loaded.rows.length} :: ${loaded.rows.map((r) => r.label).join(' / ').slice(0, 120)}`);
      if (loaded.rows.length === 0) return false;

      // 逐行点选，挑中央面里簇最多的那条会话（≥2 簇才算真交错）
      let chosen = null;
      const perRow = [];
      for (const row of loaded.rows.slice(0, MAX_ROWS)) {
        await lib.evalJs(client, `
          var li = [].slice.call(document.querySelectorAll('li[class*="convItem"]'))[${row.i}];
          if (li) li.click(); 'clicked';`, 10_000);
        let current = null;
        const deadline = Date.now() + 12_000;
        do {
          await sleep(1200);
          current = await probe(client);
        } while (Date.now() < deadline && !(current.rows[row.i] && current.rows[row.i].active));
        const seqs = current.center || [];
        const best = Math.max(0, ...seqs.map((s) => classify(s).clusters));
        perRow.push({ label: row.label, centerTimelines: seqs.length, bestClusters: best });
        if (!chosen && best >= 2) chosen = { row, snap: current };
        if (best >= 2) break;
      }
      assert('H1_center_host_multi_cluster_timeline', Boolean(chosen),
        `点选行=${perRow.length} :: ${perRow.map((r) => `${r.label}→线${r.centerTimelines}/簇${r.bestClusters}`).join(' / ')}`);
      if (!chosen) return false;

      const centerSeqs = chosen.snap.center || [];
      const centerClassified = centerSeqs.filter((s) => s).map(classify);
      const richest = centerClassified.reduce((a, b) => (b.clusters > (a ? a.clusters : -1) ? b : a), null);
      assert('H1b_center_timeline_wellformed', centerClassified.length > 0
        && centerClassified.every((c) => c.monotonic && !c.hasUnknownKind),
        `中央面线数=${centerSeqs.length} 最富=${richest ? richest.clusters : 0} 簇 失序=${centerClassified.filter((c) => !c.monotonic).length}`);

      // 打开悬挂面（UI-417 把手），等其 SimpleChat 渲染同一会话
      const opened = await lib.evalJs(client, `(function(){
        var h = document.querySelector('[data-testid="side-chat-handle"]');
        if (!h) return 'handle_not_found';
        h.click();
        return 'clicked';
      })()`, 10_000);
      assert('H2a_side_chat_handle_present', opened === 'clicked', String(opened));
      let dockSnap = null;
      const dockDeadline = Date.now() + 15_000;
      while (Date.now() < dockDeadline) {
        await sleep(1000);
        dockSnap = await probe(client);
        if (dockSnap.dockOpen && (dockSnap.dock || []).length > 0) break;
      }
      const dockSeqs = (dockSnap && dockSnap.dock) || null;
      const equal = Array.isArray(dockSeqs) && dockSeqs.length > 0
        && JSON.stringify(dockSeqs) === JSON.stringify(centerSeqs);
      assert('H2_dock_matches_center_sequence', equal,
        `dockOpen=${Boolean(dockSnap && dockSnap.dockOpen)} 悬挂面线数=${dockSeqs ? dockSeqs.length : 'null'} `
        + `中央面线数=${centerSeqs.length} 逐段相等=${equal}`);

      // 取证：滚动悬挂面最富的那条线进视口后截图（承接历史腿的 scrollIntoView 教训）
      await lib.evalJs(client, `(function(){
        var surface = document.querySelector('[data-testid="side-chat-surface"]');
        if (!surface) return 'no_surface';
        var best = null, bestCount = -1;
        [].slice.call(surface.querySelectorAll('.sc-conversation-timeline')).forEach(function(t){
          var n = t.querySelectorAll('.sc-timeline-cluster').length;
          if (n > bestCount) { bestCount = n; best = t; }
        });
        if (best) best.scrollIntoView({ block: 'start' });
        return 'scrolled:' + bestCount;
      })()`, 8_000).catch(() => null);
      await sleep(500);
      await lib.screenshotPng(client, EVIDENCE_DIR, 'timeline-hosts-center-dock.png').catch(() => null);

      // 欢迎页（composer-only）：挂载正常 + 零时间线节点（按设计）
      await lib.evalJs(client, `location.href = '${APP_ORIGIN}/'; 'go'`, 10_000);
      let welcome = null;
      const welcomeDeadline = Date.now() + 25_000;
      while (Date.now() < welcomeDeadline) {
        welcome = await probe(client);
        if (welcome.welcomeMounted && welcome.welcomeTextarea) break;
        await sleep(1000);
      }
      assert('H3_welcome_host_composer_only', welcome.welcomeMounted && welcome.welcomeTextarea
        && welcome.welcomeTimelines === 0,
        `mounted=${welcome.welcomeMounted} 输入框=${welcome.welcomeTextarea} chatMount 内时间线=${welcome.welcomeTimelines}（composer-only 设计值 0）`);
      await lib.screenshotPng(client, EVIDENCE_DIR, 'timeline-hosts-welcome.png').catch(() => null);

      fs.writeFileSync(
        path.join(EVIDENCE_DIR, 'block107-timeline-hosts-scopes.json'),
        JSON.stringify({
          project: projectId(),
          chosenRow: chosen.row,
          centerActive: chosen.snap.centerActive,
          centerSequences: centerSeqs,
          dockSequences: dockSeqs,
          perRow,
        }, null, 2)
      );
      lib.log(`project=${projectId()} 选中行=${chosen.row.label} 中央面线=${centerSeqs.length} 悬挂面线=${dockSeqs ? dockSeqs.length : 0} 逐段相等=${equal}`);
      return true;
    } finally {
      if (originalUrl) {
        await lib.evalJs(client, `location.href = ${JSON.stringify(originalUrl)}; 'restoring'`, 8_000)
          .catch(() => null);
      }
      try { client.socket.close(); } catch { /* already closed */ }
    }
  },
};
