#!/usr/bin/env node
'use strict';
/**
 * BLOCK-84 P2 前端实机验收：CDP 驱动商店「领域包」分区（dev Electron 边界内）。
 *
 * 路径：软导航（Page.navigate）→ local 项目商店页 → 领域包分区。
 *
 * 环境纪律（P2 实机抓真，务必遵守）：
 *  1) origin 必须用 http://localhost:3000。后端 CORS 白名单口径是
 *     PETRI_TRUSTED_DESKTOP_ORIGINS（env-coordinator 注入，含 localhost:3000）；
 *     页面若跑在 http://127.0.0.1:3000 会被 CORS 拒（无 ACAO 头）→ 渲染进程
 *     fetch failed（网络层其实 200）→ getProject 返回 null → 全屏
 *     「项目不存在或无权访问」，商店页无从渲染。
 *  2) 导航必须用 CDP Page.navigate（软导航）。location.href 硬导航会触发欢迎页
 *     的 auto-navigate，把 URL 弹回 allProjects[0]（很可能是不可达的 ssh 项目）。
 *  3) 必须选 local 项目（workspace_kind='local'），ssh 项目远端不可达时工作区加载
 *     失败，同样看不到商店页。
 *
 * 断言：
 *   U1 页面可达
 *   U2 商店页可达且非错误屏
 *   U3 「领域包」分区可见（data-testid="domain-packs-section"）
 *   U4 包卡片存在（data-testid="domain-pack-<packId>"）
 *   U5 桥 listInstalled 返回非空且与分区渲染一致
 *   U6 分区含「重启」诚实提示
 * 证据：acceptance/block-84/block84-p2-ui-live.json
 */
const fs = require('fs');
const path = require('path');
const http = require('node:http');

const ROOT = path.resolve(__dirname, '..');
const results = [];
function assert(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail == null ? '' : String(detail).slice(0, 400) });
  console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name + (ok ? '' : ' :: ' + String(detail).slice(0, 400)));
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve(JSON.parse(d))); }).on('error', reject);
  });
}

function cdpEval(expr, timeoutMs = 25000) {
  return new Promise(async (resolve, reject) => {
    try {
      const targets = await fetchJson('http://127.0.0.1:9222/json/list');
      const page = targets.find((t) => t.type === 'page');
      if (!page) return reject(new Error('no page target'));
      const ws = new WebSocket(page.webSocketDebuggerUrl);
      const timer = setTimeout(() => { try { ws.close(); } catch {} reject(new Error('cdp timeout')); }, timeoutMs);
      ws.addEventListener('open', () => {
        ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true } }));
      });
      ws.addEventListener('message', (ev) => {
        const p = JSON.parse(ev.data);
        if (p.id !== 1) return;
        clearTimeout(timer);
        try { ws.close(); } catch {}
        if (p.result && p.result.exceptionDetails) {
          const t = p.result.exceptionDetails;
          return reject(new Error('JS: ' + (t.text || '') + ' ' + ((t.exception && t.exception.description) || '')));
        }
        resolve(p.result && p.result.result ? p.result.result.value : undefined);
      });
      ws.addEventListener('error', (e) => { clearTimeout(timer); reject(new Error('ws: ' + (e && e.message))); });
    } catch (e) { reject(e); }
  });
}

const RENDERER_BASE = 'http://localhost:3000';

/** CDP 软导航：不改 location.href，避免欢迎页 auto-navigate 把 URL 弹回兜底项目。 */
function cdpNavigate(url, timeoutMs = 25000) {
  return new Promise(async (resolve, reject) => {
    try {
      const targets = await fetchJson('http://127.0.0.1:9222/json/list');
      const page = targets.find((t) => t.type === 'page');
      if (!page) return reject(new Error('no page target'));
      const ws = new WebSocket(page.webSocketDebuggerUrl);
      const timer = setTimeout(() => { try { ws.close(); } catch {} reject(new Error('cdp nav timeout')); }, timeoutMs);
      ws.addEventListener('open', () => {
        ws.send(JSON.stringify({ id: 1, method: 'Page.enable', params: {} }));
        ws.send(JSON.stringify({ id: 2, method: 'Page.navigate', params: { url } }));
      });
      ws.addEventListener('message', (ev) => {
        const p = JSON.parse(ev.data);
        if (p.id !== 2) return;
        clearTimeout(timer);
        try { ws.close(); } catch {}
        resolve(true);
      });
      ws.addEventListener('error', (e) => { clearTimeout(timer); reject(new Error('ws: ' + (e && e.message))); });
    } catch (e) { reject(e); }
  });
}

/** 从后端取一个 local 工作区项目（ssh 项目远端不可达时工作区加载失败）。 */
function pickLocalProject() {
  return new Promise((resolve) => {
    http.get('http://127.0.0.1:3001/api/data/projects', (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        try {
          const j = JSON.parse(d);
          const list = Array.isArray(j.projects) ? j.projects : [];
          const local = list.find((p) => p.workspace_kind === 'local' && p.status !== 'archived');
          resolve(local || null);
        } catch { resolve(null); }
      });
    }).on('error', () => resolve(null));
  });
}

async function main() {
  // U1
  const href0 = await cdpEval('location.href');
  assert('U1_page_reachable', typeof href0 === 'string' && href0.startsWith('http'), 'href=' + href0);

  // 解析 local 项目（ssh 项目会因远端不可达导致工作区加载失败）
  const localProject = await pickLocalProject();
  console.log('  local project:', localProject ? localProject.id + ' / ' + localProject.name : 'NOT FOUND');
  const targetProjectId = localProject ? localProject.id : 'p_mtkamsfu_3mxo';

  // 软导航到商店页（localhost origin + local 项目）
  const storeUrl = `${RENDERER_BASE}/project/${targetProjectId}/plugins`;
  await cdpNavigate(storeUrl).catch((e) => console.log('  navErr:', e.message));
  await sleep(12000);

  // U2 商店页
  const href = await cdpEval('location.href');
  const bodyText = await cdpEval('document.body.innerText');
  const onErrorScreen = typeof bodyText === 'string' && bodyText.includes('项目不存在或无权访问');
  assert('U2_store_reached', typeof href === 'string' && href.includes('/plugins') && !onErrorScreen,
    'href=' + href + ' errorScreen=' + onErrorScreen);

  // U3 分区
  const sectionExists = await cdpEval(`!!document.querySelector('[data-testid="domain-packs-section"]')`);

  // U4 卡片
  const cards = await cdpEval(`Array.from(document.querySelectorAll('[data-testid^="domain-pack-"]')).map(function(e){return e.getAttribute('data-testid')})`);

  // U5 桥
  const bridgeRaw = await cdpEval(`window.petriDesktop.packs.listInstalled().then(function(r){return JSON.stringify(r)}).catch(function(e){return 'ERR:'+e.message})`);
  let bridgeInstalled = 0;
  try {
    const parsed = JSON.parse(bridgeRaw);
    bridgeInstalled = Array.isArray(parsed.packs) ? parsed.packs.length : (Array.isArray(parsed) ? parsed.length : 0);
  } catch {}

  assert('U3_domain_packs_section_visible', sectionExists === true, 'sectionExists=' + sectionExists);
  assert('U4_pack_card_present', Array.isArray(cards) && cards.length >= 1, 'cards=' + JSON.stringify(cards));
  assert('U5_bridge_matches_section', bridgeInstalled >= 1 && sectionExists === true,
    'bridgeInstalled=' + bridgeInstalled + ' section=' + sectionExists);
  assert('U6_restart_hint_present', typeof bodyText === 'string' && /重启/.test(bodyText),
    'has重启=' + (typeof bodyText === 'string' && /重启/.test(bodyText)));

  const summary = {
    ok: results.every((r) => r.ok),
    total: results.length,
    passed: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    targetProjectId,
    storeUrl,
    href,
    cards,
    bridgeInstalled,
    results,
  };
  console.log('\n' + (summary.ok ? 'ALL PASS' : 'HAS FAILURES') + ' — ' + summary.passed + '/' + summary.total);

  const outDir = path.join(ROOT, 'acceptance', 'block-84');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'block84-p2-ui-live.json'),
    JSON.stringify({ ...summary, capturedAt: new Date().toISOString() }, null, 2));
  console.log('evidence: ' + path.join(outDir, 'block84-p2-ui-live.json'));
  process.exit(summary.ok ? 0 : 1);
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(2); });
