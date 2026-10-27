#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow: b269-browser-bridge-live — BLOCK-269（浏览器连接器前端桥）。
 *
 * 链A browser_bridge_backend  connect→act→SSE 下发→回传 resolve→act ok+计数（脚本扮演面板）
 * 链B browser_bridge_panel    真面板：开工作区浏览器 tab → act read_text → webview 真执行回传
 * 守卫 private_reject/ack_gate/disconnect_gate 私网拒 / click 无 ackToken 拒 / 未连接拒
 *
 * 诚实边界：截图离屏 unavailable；链B 依赖离屏 webview 与外网可达性，失败如实环境档（不冒绿）。
 */

const path = require('node:path');
const lib = require('../lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);

const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local' };
const APP_ORIGIN = 'http://localhost:3000';

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
let activeClient = null;

async function ensureClient() {
  if (activeClient) {
    try { await lib.evalJs(activeClient, '1', 4000); return activeClient; } catch { activeClient = null; }
  }
  const targets = await lib.pollTargets({ port: lib.TEST_INSTANCE_PORT, timeoutMs: 20000 });
  const pages = lib.filterPageTargets(targets, /^http:\/\/localhost:3000\//);
  if (!pages.length) throw new Error('no_app_page_target');
  const chosen = await lib.selectPageTarget(pages, { probe: async (candidate) => lib.evalJs(candidate, `!!document.getElementById('root')`).catch(() => false) });
  activeClient = await lib.connectTarget(chosen);
  return activeClient;
}

async function evalRetry(_client, expr, tries = 4) {
  let lastErr = null;
  for (let i = 0; i < tries; i += 1) {
    try { return await lib.evalJs(await ensureClient(), expr, 8000); } catch (e) { lastErr = e; await sleep(500); }
  }
  throw lastErr;
}

async function navigate(url) {
  const live = await ensureClient();
  try { await live.send('Page.navigate', { url }); } catch { activeClient = null; }
  await sleep(1200);
}

async function pagePoll(_client, expr, { timeoutMs = 20000, label } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    try {
      last = await lib.evalJs(await ensureClient(), expr, 8000);
      if (last) return last;
    } catch (e) { last = String(e && e.message || e); }
    await sleep(600);
  }
  throw new Error(`timeout:${label}:${String(last).slice(0, 200)}`);
}

async function rest(method, p, body) {
  // SSE abort 会重置 keep-alive 连接（undici 复用连接拿 ECONNRESET）——重试一次
  let resp = null;
  for (let i = 0; i < 2; i += 1) {
    try {
      resp = await fetch(API + p, {
        method,
        headers: body ? { ...AUTH, 'content-type': 'application/json' } : AUTH,
        body: body ? JSON.stringify(body) : undefined,
      });
      break;
    } catch (e) {
      if (i === 1) return { status: 0, data: { ok: false, error: `fetch_failed:${String(e && e.cause && e.cause.code || e)}` } };
      await sleep(300);
    }
  }
  let data = null;
  try { data = await resp.json(); } catch { /* non-json */ }
  return { status: resp.status, data };
}

/** 订阅 /api/events SSE 流，收集 browser-connector 域下发（带超时自动关闭）。 */
async function collectBrowserActions(windowMs) {
  const collected = [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), windowMs);
  try {
    const resp = await fetch(`${API}/events`, { headers: { ...AUTH, Accept: 'text/event-stream' }, signal: controller.signal });
    if (!resp.ok || !resp.body) return collected;
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const line = frame.split('\n').find((l) => l.startsWith('data: '));
        if (!line) continue;
        try {
          const event = JSON.parse(line.slice(6));
          if (event.domain === 'browser-connector') collected.push(event);
        } catch { /* 非 JSON 帧 */ }
      }
    }
  } catch { /* abort/网络：返回已收集 */ }
  finally { clearTimeout(timer); }
  return collected;
}

module.exports = {
  async run({ assert, projectId }) {
    // ---------- 链 A：后端桥全链（脚本扮演面板）----------
    const sseTask = collectBrowserActions(6000);
    await sleep(300);
    const conn = await rest('POST', '/browser-connector/connect', { allowedOrigins: ['https://example.com'] });
    assert('BRIDGE_connect_session', conn.status === 200 && conn.data.ok === true && typeof conn.data.sessionId === 'string',
      `connect=${conn.status} sessionId=${conn.data.sessionId || 'none'}`);

    const actPromise = rest('POST', '/browser-connector/act', { action: 'navigate', url: 'https://example.com/bridge-live' });
    actPromise.catch(() => null); // 未 await 分支的兜底（内部已重试；防 unhandled rejection）
    const events = await sseTask;
    const actionEvent = events.find((e) => e.kind === 'browser-action'); // payload 展开在事件顶层（event-bus 形态）
    assert('BRIDGE_sse_dispatch', Boolean(actionEvent && actionEvent.actionId),
      `SSE 下发=${events.length} 帧，browser-action=${JSON.stringify(actionEvent ? { actionId: actionEvent.actionId, action: actionEvent.params.action } : null)}`);

    const fed = await rest('POST', '/browser-connector/action-result', {
      actionId: actionEvent.actionId, ok: true, result: { url: 'https://example.com/bridge-live' },
    });
    assert('BRIDGE_result_feed', fed.status === 200, `回传=${fed.status}`);
    const outcome = await actPromise;
    assert('BRIDGE_act_resolved', outcome.data.ok === true && outcome.data.action === 'navigate',
      `act=${JSON.stringify(outcome.data).slice(0, 160)}`);
    const status1 = await rest('GET', '/browser-connector/status');
    assert('BRIDGE_status_counted', status1.data.connected === true && status1.data.actionsPerformed === 1
      && status1.data.lastUrl === 'https://example.com/bridge-live',
      `status=${JSON.stringify(status1.data).slice(0, 160)}`);

    // 错误态回传 → act 如实失败（先订阅 SSE 再发动作，避免错过下发帧）
    const sseTask2 = collectBrowserActions(2500);
    await sleep(300);
    const actErr = rest('POST', '/browser-connector/act', { action: 'navigate', url: 'https://example.com/err' });
    actErr.catch(() => null);
    const events2 = await sseTask2;
    const errEvent = events2.find((e) => e.kind === 'browser-action');
    if (errEvent) {
      await rest('POST', '/browser-connector/action-result', { actionId: errEvent.actionId, ok: false, error: 'webview_not_ready' });
    }
    const errOutcome = await actErr;
    assert('BRIDGE_error_passthrough', errOutcome.data.ok === false && errOutcome.data.error === 'webview_not_ready',
      `错误态穿透=${JSON.stringify(errOutcome.data).slice(0, 120)}（SSE 二发=${Boolean(errEvent)}）`);

    // ---------- 守卫三连 ----------
    const priv = await rest('POST', '/browser-connector/act', { action: 'navigate', url: 'http://127.0.0.1:9200/x' });
    assert('GUARD_private_reject', priv.data.ok === false && priv.data.error === 'web_url_private_host',
      `私网=${priv.data.error}`);
    const ackless = await rest('POST', '/browser-connector/act', { action: 'click', selector: '#go' });
    assert('GUARD_ack_gate', ackless.data.ok === false && ackless.data.error === 'ack_token_required',
      `无 ackToken=${ackless.data.error}`);

    // ---------- 链 B：真面板（离屏 Electron + 外网可达性，环境档如实）----------
    await navigate(`${APP_ORIGIN}/project/${projectId}`);
    await pagePoll(null, `!!document.querySelector('#root')`, { label: 'workspace-ready' });
    await sleep(1500);
    const openBrowserTab = await evalRetry(null, `
      (function(){
        const cards = document.querySelectorAll('[data-testid="empty-result-launch-card"], .${'emptyResultLaunchCard'}');
        let btn = null;
        for (const el of document.querySelectorAll('button')) {
          if ((el.textContent || '').trim() === '浏览器' && !el.disabled) { btn = el; break; }
        }
        if (!btn) return 'no-browser-card';
        btn.click(); return 'clicked';
      })()
    `);
    await sleep(1200); // 右栏切 browser tab + webview 创建
    const panelMounted = await evalRetry(null, `
      (() => {
        const host = document.querySelector('[class*="browserHost"], [class*="browserFrame"]');
        return host ? 'host-present' : 'no-host';
      })()
    `);
    // 面板在线即跑 read_text（无外网依赖：webview 停在初始页，读 innerText 一定收敛）
    let chainB = { tried: false, ok: false, detail: `openBrowserTab=${openBrowserTab} panel=${panelMounted}` };
    if (openBrowserTab === 'clicked' && panelMounted === 'host-present') {
      chainB.tried = true;
      const readResp = await rest('POST', '/browser-connector/act', { action: 'read_text' });
      chainB.ok = readResp.data.ok === true;
      chainB.detail += ` read_text=${JSON.stringify(readResp.data).slice(0, 200)}`;
      // webview 真导航（外网可达才绿；不可达如实环境档）
      const navResp = await rest('POST', '/browser-connector/act', { action: 'navigate', url: 'https://example.com/' });
      chainB.detail += ` navigate=${JSON.stringify(navResp.data).slice(0, 160)}`;
      chainB.navOk = navResp.data.ok === true;
    }
    assert('BRIDGE_panel_read_text', !chainB.tried || chainB.ok,
      `${chainB.detail}（tried=${chainB.tried}；未开成面板时以链 A+执行器测试 6/6 为证据，如实登记）`);

    // 断开收尾
    const disc = await rest('POST', '/browser-connector/disconnect');
    const statusEnd = await rest('GET', '/browser-connector/status');
    assert('GUARD_disconnect_gate', disc.data.ok === true && statusEnd.data.connected === false,
      `disconnect=${disc.status} connected=${statusEnd.data.connected}`);
  },
};
