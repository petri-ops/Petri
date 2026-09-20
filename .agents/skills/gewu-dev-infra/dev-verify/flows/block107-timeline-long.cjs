#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow：block107-timeline-long — BLOCK-107 P3 长会话分页语义不退化（UI-428）
 *
 * 主张（plan §5-6「长会话分页」）：>200 条消息的会话在「最新窗口优先」语义下——
 * 初载恰为最新 200 条（第 51..250 条，更旧消息不在 DOM）、向上滚到顶触发 loadOlder
 * 补页（001..050 prepend、全量 250 无重复、视口锚定 scrollTop>0 不跳）、刷新后
 * 窗口重置回最新 200 条；且时间线渲染与分页共存（旧窗口内带工具记录的消息
 * 补页后照常出簇，簇数 2→6）。
 *
 * 数据装置：dev 库没有消息写端点，本 flow 以测试装置直插 250 条合成消息
 * （node:sqlite 单事务，schema 与线上落盘同形：meta_json 用真实恢复白名单键
 * toolActivities / reasoningByIteration）；会话本体经 REST 创建、结束经 REST
 * DELETE 整会话删除（该端点先删消息再删会话），开始时自愈清理同名残留。
 * 只连自管测试实例（CDP 9223，?test=1），结束恢复原 URL。
 *
 * 断言：
 *   L0a REST 建会话 / L0b 直插 250 条 / L0c REST 预检最新窗口（051..250 + hasMore + windowOffset=50）
 *   L1 UI 初载 = 最新 200 条 + 窗口外消息不可见 + 时间线共存（#240 两簇一思考、零运行中）
 *   L2 滚顶触发 loadOlder：250 条无重复、prepend 后视口锚定、旧窗口簇补出（簇 2→6）
 *   L3 刷新后窗口重置回最新 200 条
 *   L4 清理已删会话
 * 证据：acceptance/block-107/block107-timeline-long-scopes.json + timeline-long-top-after-load.png
 *
 * 前置：dev 栈在跑（Vite :3000 + 后端 :3001）+ bash scripts/start-test-instance.sh。
 * 本 flow 不启动/不重启 Electron。
 */
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const lib = require('../lib.cjs');

const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local' };
const APP_ORIGIN = 'http://localhost:3000';
const PROJECT_ID = process.env.BLOCK107_PROJECT || 'p_mu174w3u_ncze';
const TITLE = 'BLK107长会话合成';
const MSG_COUNT = 250;
const WINDOW = 200;
const TOOL_META_AT = [20, 40, 240];
const EVIDENCE_DIR = path.join(process.cwd(), 'acceptance', 'block-107');
const ROOT = lib.findRepoRoot(__dirname);
const DB_PATH = path.join(
  process.env.BIOF3_LOCAL_DATA_DIR || path.join(ROOT, '.biof3-dev-user-data', 'data'),
  'biof3.db'
);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const markerOf = (i) => `分页合成-${String(i).padStart(3, '0')}`;
const extractMark = (s) => {
  const m = /分页合成-[0-9]{3}/.exec(String(s || ''));
  return m ? m[0] : '';
};

async function rest(method, p, body) {
  const resp = await fetch(API + p, {
    method,
    headers: body ? { ...AUTH, 'content-type': 'application/json' } : AUTH,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await resp.json(); } catch { /* non-json */ }
  return { ok: resp.ok, data };
}

/** 自愈：清掉同名残留会话（上次中断的运行不会污染本次断言）。 */
async function deleteByTitle() {
  const listed = await rest('GET', `/ai/conversations?project_id=${PROJECT_ID}&status=all`);
  const rows = (listed.data && listed.data.conversations) || [];
  let n = 0;
  for (const c of rows) {
    if (c.title !== TITLE) continue;
    const del = await rest('DELETE', `/ai/conversations/${c.id}`);
    if (del.ok) n += 1;
  }
  return n;
}

/** 直插 250 条合成消息（单事务；SQLITE_BUSY 退避重试）。 */
async function seedMessages(convId) {
  const base = Date.now() - MSG_COUNT * 60_000;
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const db = new DatabaseSync(DB_PATH, { timeout: 8000 });
    try {
      try { db.exec('PRAGMA busy_timeout = 8000'); } catch { /* pragma 可选 */ }
      const insert = db.prepare(
        'INSERT INTO copilot_messages(id, conversation_id, role, content, meta_json, ts) VALUES (?,?,?,?,?,?)'
      );
      db.exec('BEGIN');
      for (let i = 1; i <= MSG_COUNT; i += 1) {
        const role = i % 2 === 1 ? 'user' : 'assistant';
        const content = `${markerOf(i)} ${role === 'user' ? '用户消息' : '助手消息'}`;
        let metaJson = null;
        if (role === 'assistant' && TOOL_META_AT.includes(i)) {
          metaJson = JSON.stringify({
            toolActivities: [
              { key: `seed_${i}_1`, callId: `seed_call_${i}_1`, iteration: 1, name: 'list_project_files', status: 'success', durationMs: 12, summary: 'ok', actionLabel: '已调用', actionDetail: 'list_project_files' },
              { key: `seed_${i}_2`, callId: `seed_call_${i}_2`, iteration: 2, name: 'read_file', status: 'success', durationMs: 8, summary: 'ok', actionLabel: '已调用', actionDetail: 'read_file' },
            ],
            reasoningByIteration: { 1: `分页合成推理-${i}` },
          });
        }
        insert.run(
          `seed_msg_${convId}_${String(i).padStart(3, '0')}`,
          convId,
          role,
          content,
          metaJson,
          new Date(base + i * 60_000).toISOString()
        );
      }
      db.prepare('UPDATE copilot_conversations SET message_count=?, updated_at=? WHERE id=?')
        .run(MSG_COUNT, new Date().toISOString(), convId);
      db.exec('COMMIT');
      const c = db.prepare('SELECT COUNT(*) AS c FROM copilot_messages WHERE conversation_id=?').get(convId);
      return c.c;
    } catch (e) {
      lastErr = e;
      try { db.exec('ROLLBACK'); } catch { /* tx 未开或已回滚 */ }
      await sleep(600);
    } finally {
      try { db.close(); } catch { /* 已关 */ }
    }
  }
  throw lastErr;
}

/** 页面内一次性求值：只读中央投影层（[data-projection="conversation"]），排除悬挂面。 */
const PROBE = `JSON.stringify((function(){
  var center = document.querySelector('[data-projection="conversation"]');
  var sc = center ? center.querySelector('.sc-messages') : null;
  var bodies = center ? [].slice.call(center.querySelectorAll('.sc-msg-body')) : [];
  var marks = bodies.map(function(n){
    var m = (n.textContent || '').replace(/\\s+/g, ' ').match(/分页合成-[0-9]{3}/);
    return m ? m[0] : '';
  });
  var clusters = 0, reasoningNodes = 0, runningClusters = 0;
  if (center) {
    [].slice.call(center.querySelectorAll('.sc-conversation-timeline')).forEach(function(t){
      clusters += t.querySelectorAll('.sc-timeline-cluster').length;
      runningClusters += t.querySelectorAll('.sc-timeline-cluster[data-state="running"]').length;
      reasoningNodes += t.querySelectorAll('.sc-timeline-reasoning').length;
    });
  }
  return {
    centerMounted: !!center,
    rows: [].slice.call(document.querySelectorAll('li[class*="convItem"]')).map(function(n, i){
      return { i: i, label: (n.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 30),
               active: String(n.className).indexOf('convItemActive') > -1 };
    }),
    bodyCount: marks.length,
    first: marks.length ? marks[0] : '',
    last: marks.length ? marks[marks.length - 1] : '',
    markers: marks,
    clusters: clusters,
    reasoningNodes: reasoningNodes,
    runningClusters: runningClusters,
    scrollTop: sc ? Math.round(sc.scrollTop) : -1,
    scrollHeight: sc ? Math.round(sc.scrollHeight) : -1,
  };
})())`;

async function probe(client) {
  try {
    return JSON.parse(await lib.evalJs(client, PROBE, 10_000));
  } catch {
    return null;
  }
}

async function waitProbe(client, predicate, { timeoutMs, label }) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const snap = await probe(client);
    if (snap) {
      last = snap;
      if (predicate(snap)) return snap;
    }
    await sleep(900);
  }
  throw new Error(`wait_timeout:${label} last=${JSON.stringify(last).slice(0, 320)}`);
}

/** 等左栏行 → 点选合成会话 → 等最新窗口就位（200 条、051 头 250 尾）。 */
async function openSyntheticConversation(client) {
  let rowsSnap = null;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const snap = await probe(client);
    if (snap && snap.rows.length > 0) { rowsSnap = snap; break; }
    await sleep(1000);
  }
  if (!rowsSnap) throw new Error('conv_rows_not_found');
  const row = rowsSnap.rows.find((r) => r.label.indexOf(TITLE) > -1);
  if (!row) throw new Error('synthetic_row_not_found: ' + rowsSnap.rows.map((r) => r.label).join(' / '));
  if (!(rowsSnap.rows[row.i] || {}).active) {
    await lib.evalJs(client, `(function(){
      var li = [].slice.call(document.querySelectorAll('li[class*="convItem"]'))[${row.i}];
      if (!li) return 'not_found';
      li.click();
      return 'clicked';
    })()`, 10_000);
  }
  return waitProbe(
    client,
    (s) => s.bodyCount === WINDOW && s.first === markerOf(51) && s.last === markerOf(250),
    { timeoutMs: 45_000, label: 'initial_window' }
  );
}

function slim(s) {
  const uniq = new Set(s.markers.filter(Boolean));
  return {
    bodyCount: s.bodyCount, first: s.first, last: s.last,
    clusters: s.clusters, reasoningNodes: s.reasoningNodes, runningClusters: s.runningClusters,
    scrollTop: s.scrollTop, scrollHeight: s.scrollHeight,
    markerCount: s.markers.filter(Boolean).length, uniqueMarkers: uniq.size,
  };
}

module.exports = {
  id: 'block107-timeline-long',
  description: 'BLOCK-107 P3 长会话分页：250 条合成会话的最新窗口/loadOlder 补页/无重复/视口锚定/刷新重置 + 时间线共存',
  evidenceDir: EVIDENCE_DIR,

  async run(ctx) {
    const { assert } = ctx;
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

    const healed = await deleteByTitle().catch(() => 0);
    if (healed > 0) lib.log(`自愈清理同名残留会话 ${healed} 条`);

    const created = await rest('POST', '/ai/conversations', { title: TITLE, project_id: PROJECT_ID });
    const convId = created.data && created.data.conversation && created.data.conversation.id;
    assert('L0a_rest_create_conversation', created.ok && Boolean(convId),
      JSON.stringify(created.data || null).slice(0, 200));
    if (!convId) return false;

    let client = null;
    let originalUrl = '';
    try {
      const seeded = await seedMessages(convId);
      assert('L0b_seed_250_rows', seeded === MSG_COUNT, `seeded=${seeded}`);
      if (seeded !== MSG_COUNT) return false;

      const win = await rest('GET', `/ai/conversations/${convId}/messages?limit=${WINDOW}`);
      const msgs = (win.data && win.data.messages) || [];
      const firstMark = extractMark(msgs[0] && msgs[0].content);
      const lastMark = extractMark(msgs[msgs.length - 1] && msgs[msgs.length - 1].content);
      const restWindow = {
        count: msgs.length, first: firstMark, last: lastMark,
        hasMore: win.data && win.data.hasMore, nextBefore: win.data && win.data.nextBefore,
        windowOffset: win.data && win.data.windowOffset, total: win.data && win.data.total,
      };
      assert('L0c_rest_latest_window', msgs.length === WINDOW && firstMark === markerOf(51) && lastMark === markerOf(250)
        && win.data.hasMore === true && typeof win.data.nextBefore === 'number'
        && win.data.windowOffset === 50 && win.data.total === MSG_COUNT,
        JSON.stringify(restWindow).slice(0, 220));
      if (!(msgs.length === WINDOW && firstMark === markerOf(51))) return false;

      client = await lib.connectTestTarget({ timeoutMs: 20_000 });
      originalUrl = String(await lib.evalJs(client, 'location.href', 8_000));
      await lib.evalJs(client, `location.href = '${APP_ORIGIN}/project/${PROJECT_ID}?test=1'; 'go'`, 10_000);

      const snap1 = await openSyntheticConversation(client);
      const marks20Absent = snap1.markers.indexOf(markerOf(20)) === -1;
      assert('L1_ui_initial_latest_window', snap1.bodyCount === WINDOW && snap1.first === markerOf(51) && snap1.last === markerOf(250)
        && marks20Absent && snap1.clusters === 2 && snap1.reasoningNodes === 1 && snap1.runningClusters === 0,
        `body=${snap1.bodyCount} first=${snap1.first} last=${snap1.last} 含020=${!marks20Absent} 簇=${snap1.clusters} 思考=${snap1.reasoningNodes} 运行中=${snap1.runningClusters}`);

      // 滚到顶 → onScroll（<360px）自动触发 loadOlder
      await lib.evalJs(client, `(function(){
        var sc = document.querySelector('[data-projection="conversation"] .sc-messages');
        if (!sc) return 'no_scroller';
        sc.scrollTop = 0;
        return 'top:' + Math.round(sc.scrollHeight);
      })()`, 8_000);
      const snap2 = await waitProbe(client, (s) => s.bodyCount === MSG_COUNT && s.first === markerOf(1),
        { timeoutMs: 45_000, label: 'load_older' });
      const uniqCount = new Set(snap2.markers.filter(Boolean)).size;
      assert('L2_ui_load_older_prepend', snap2.markers.every(Boolean) && uniqCount === MSG_COUNT
        && snap2.last === markerOf(250) && snap2.clusters === 6 && snap2.reasoningNodes === 3 && snap2.scrollTop >= 200,
        `body=${snap2.bodyCount} first=${snap2.first} last=${snap2.last} 唯一=${uniqCount} 簇=${snap2.clusters} 思考=${snap2.reasoningNodes} scrollTop=${snap2.scrollTop}`);

      // 取证：回到顶部截一张（全量 250 已在 DOM，含补出的旧窗口时间线）
      await lib.evalJs(client, `(function(){
        var sc = document.querySelector('[data-projection="conversation"] .sc-messages');
        if (sc) sc.scrollTop = 0;
        return 'top';
      })()`, 8_000).catch(() => null);
      await sleep(400);
      await lib.screenshotPng(client, EVIDENCE_DIR, 'timeline-long-top-after-load.png').catch(() => null);

      // 刷新 → 窗口应重置回最新 200 条（不是把 250 全量持久化）
      await lib.evalJs(client, `location.reload(); 'reloading'`, 8_000).catch(() => null);
      const snap3 = await openSyntheticConversation(client);
      assert('L3_ui_reload_window_reset', snap3.bodyCount === WINDOW && snap3.first === markerOf(51) && snap3.last === markerOf(250)
        && snap3.clusters === 2,
        `body=${snap3.bodyCount} first=${snap3.first} last=${snap3.last} 簇=${snap3.clusters}`);

      const del = await rest('DELETE', `/ai/conversations/${convId}`);
      assert('L4_cleanup_deleted', del.ok, JSON.stringify(del.data || null).slice(0, 120));

      fs.writeFileSync(
        path.join(EVIDENCE_DIR, 'block107-timeline-long-scopes.json'),
        JSON.stringify({
          project: PROJECT_ID, convTitle: TITLE, convId,
          messageCount: MSG_COUNT, windowSize: WINDOW,
          restWindow,
          ui: { initial: slim(snap1), afterLoadOlder: slim(snap2), afterReload: slim(snap3) },
          cleanupDeleted: del.ok,
        }, null, 2)
      );
      lib.log(`conv=${convId} 初载=${snap1.bodyCount}(${snap1.first}..${snap1.last}) 补页后=${snap2.bodyCount} 唯一=${uniqCount} scrollTop=${snap2.scrollTop} 簇=${snap1.clusters}→${snap2.clusters} 刷新后=${snap3.bodyCount} 已删=${del.ok}`);
      return true;
    } finally {
      if (client) {
        await rest('DELETE', `/ai/conversations/${convId}`).catch(() => null);
        await deleteByTitle().catch(() => 0);
        if (originalUrl) {
          await lib.evalJs(client, `location.href = ${JSON.stringify(originalUrl)}; 'restoring'`, 8_000)
            .catch(() => null);
        }
        try { client.socket.close(); } catch { /* 已关 */ }
      }
    }
  },
};
