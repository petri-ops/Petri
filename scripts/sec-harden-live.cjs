#!/usr/bin/env node
'use strict';
/**
 * sec-harden-live.cjs — SEC-HARDEN 实机验收（AUDIT-LOG 代码复审余项 ③ 附带安全专项）。
 *
 * 被测改动（对齐 Electron 官方安全清单）：
 *   #12 `<webview>` 附着前中和 webPreferences + partition 白名单 + src 协议校验
 *   #11 撤掉 `allowpopups`；每个 webContents 一律 deny 自建窗口
 *   #5  权限默认拒绝（官方默认是「自动批准一切」），仅受信渲染 origin 放行
 *       `clipboard-sanitized-write` / `openExternal`
 *
 * ⚠️ src/main/** 改动必须**重启 Electron** 才生效（reload 只重载渲染层，不换主进程代码）。
 *    本脚本只做断言，不负责重启；跑之前请确认 dev 栈是改动后重启过的。
 *
 * 断言：
 *   S1 主进程权限策略已装配：受信 origin 下 `navigator.permissions.query(geolocation)`
 *      = 'denied'（未装 handler 时 Electron 默认批准 → 会是 'granted'/'prompt'）
 *   S2 受信 origin：剪贴板写权限层状态 = 'granted'（未被 allowlist 误拒）
 *   S2b 受信 origin：真实点击（CDP Input，带用户激活）驱动的复制端到端成功
 *       （注：CDP Runtime.evaluate 无手势且可能失焦，Chromium 本身就会拒 writeText，
 *        故不能用「无手势写入成败」当判据——见 S2/S2b 两条件）
 *   S3 白名单 partition + http(s) src 的 `<webview>` 正常附着并加载（浏览器面板不被误伤）
 *   S4 非白名单 partition 的 `<webview>` guest 未创建（被 will-attach-webview 拦下）
 *   S5 非 http(s) src（file:）的 `<webview>` guest 未创建
 *   S6 guest（非受信 origin）权限被拒：guest 内 geolocation 查询 = 'denied'
 *   S7 静态伴检：BrowserPanel 源码已无 allowpopups（清单 #11）
 *
 * 用法：dev 栈在跑（Vite:3000 + CDP:9222）→ `node scripts/sec-harden-live.cjs`
 * 证据：acceptance/sec-harden/sec-harden-live.json
 */

const path = require('node:path');
const fs = require('node:fs');
const lib = require(path.join(__dirname, '..', '.agents', 'skills', 'gewu-dev-infra', 'dev-verify', 'lib.cjs'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EVIDENCE_DIR = path.join(__dirname, '..', 'acceptance', 'sec-harden');
const BROWSER_PANEL = path.join(__dirname, '..', 'frontend', 'src', 'pages', 'project-workspace', 'BrowserPanel.tsx');

/** 在受信渲染器里跑一段 async 表达式（返回 JSON 字符串）。 */
const RENDERER_PROBE = `(async function(){
  const out = { href: location.href, origin: location.origin };

  // S1 受信 origin 的 geolocation 应被拒
  try {
    const st = await navigator.permissions.query({ name: 'geolocation' });
    out.geolocationState = st.state;
  } catch (error) { out.geolocationState = 'query_failed:' + (error && error.message); }

  // S2 剪贴板：分两层取证 —— (a) 权限层状态，(b) 真实点击驱动的端到端复制。
  // 注意：CDP Runtime.evaluate 无用户手势且页面可能未聚焦，Chromium 对这种
  // writeText 本身就报 "Write permission denied"（与权限策略无关），因此不能
  // 用「无手势写入的成败」当判据——必须用权限态 + 真实点击两条件。
  out.hasFocus = document.hasFocus();
  try {
    const cw = await navigator.permissions.query({ name: 'clipboard-write' });
    out.clipboardWritePermission = cw.state;
  } catch (error) { out.clipboardWritePermission = 'query_failed:' + (error && error.message); }

  const btn = document.createElement('button');
  btn.textContent = 'sec-probe-copy';
  btn.setAttribute('data-sec-probe-button', '1');
  btn.style.cssText = 'position:fixed;left:8px;top:8px;z-index:99999;width:120px;height:32px;';
  document.body.appendChild(btn);
  window.__secHardenProbe = { result: null, clickedAt: null };
  btn.addEventListener('click', async () => {
    window.__secHardenProbe.clickedAt = Date.now();
    try {
      await navigator.clipboard.writeText('gewu-sec-harden-click');
      window.__secHardenProbe.result = 'ok';
    } catch (error) {
      window.__secHardenProbe.result = 'failed:' + (error && error.message);
    }
  });
  const rect = btn.getBoundingClientRect();
  out.probeButton = { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };

  // webview 守卫探针：分别试 (白名单 partition + http src) / (野 partition) / (file src)
  const host = document.createElement('div');
  host.setAttribute('data-sec-probe', '1');
  host.style.cssText = 'position:fixed;left:-9999px;top:0;width:320px;height:240px;';
  document.body.appendChild(host);

  async function tryAttach(label, partition, src) {
    const wv = document.createElement('webview');
    if (partition) wv.setAttribute('partition', partition);
    wv.src = src;
    host.appendChild(wv);
    let settled = 'pending';
    const done = new Promise((resolve) => {
      wv.addEventListener('dom-ready', () => resolve('attached'), { once: true });
      setTimeout(() => resolve('timeout'), 4000);
    });
    settled = await done;
    let url = null, guestId = null, err = null;
    try { url = typeof wv.getURL === 'function' ? await wv.getURL() : null; } catch (e) { err = String(e && e.message || e); }
    try { guestId = typeof wv.getWebContentsId === 'function' ? wv.getWebContentsId() : null; } catch (e) { if (!err) err = String(e && e.message || e); }
    let guestGeolocation = null;
    if (settled === 'attached') {
      try { guestGeolocation = await wv.executeJavaScript("navigator.permissions.query({name:'geolocation'}).then(function(s){return s.state;})"); }
      catch (e) { guestGeolocation = 'exec_failed:' + String(e && e.message || e); }
    }
    wv.remove();
    return { label, settled, url, guestId, err, guestGeolocation };
  }

  out.allowed = await tryAttach('allowlisted', 'persist:gewu-browser', 'http://127.0.0.1:3001/api/health');
  out.badPartition = await tryAttach('bad_partition', 'persist:attacker', 'http://127.0.0.1:3001/api/health');
  out.badScheme = await tryAttach('file_scheme', 'persist:gewu-browser', 'file:///etc/passwd');

  host.remove();
  return JSON.stringify(out);
})()`;

(async () => {
  const run = lib.createRun({ name: 'sec-harden', evidenceDir: EVIDENCE_DIR });
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

  const targets = await lib.pollTargets({ timeoutMs: 20000 });
  const candidates = lib.filterPageTargets(targets, /^http:\/\/localhost:3000\//);
  const target = await lib.selectPageTarget(candidates, {
    probe: async (client) => lib.evalJs(client, `!!document.getElementById('root')`).catch(() => false),
  });
  if (!target) throw new Error('no_main_target');
  const client = await lib.connectTarget(target);

  const raw = await lib.evalJs(client, RENDERER_PROBE);
  const probe = JSON.parse(raw);
  lib.log(`origin=${probe.origin} geo=${probe.geolocationState} clipPerm=${probe.clipboardWritePermission} focus=${probe.hasFocus}`);
  lib.log(`webview allowed=${probe.allowed.settled} badPartition=${probe.badPartition.settled} badScheme=${probe.badScheme.settled}`);

  // 真实点击（CDP Input → 带用户激活）驱动剪贴板写，验证「没被权限策略误伤」。
  const { x, y } = probe.probeButton;
  await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  await sleep(600);
  const clickResult = await lib.evalJs(client, `(function(){
    var p = window.__secHardenProbe || {};
    var b = document.querySelector('[data-sec-probe-button]');
    if (b) b.remove();
    return JSON.stringify({ result: p.result, clickedAt: p.clickedAt });
  })()`);
  probe.clipboardClick = JSON.parse(clickResult);
  lib.log(`clipboard click=${probe.clipboardClick.result}`);
  client.close?.();

  const panelSource = fs.readFileSync(BROWSER_PANEL, 'utf8');
  const allowpopupsLeft = /setAttribute\(\s*['"]allowpopups/.test(panelSource);

  run.assert('S1 受信 origin：geolocation 权限被拒（未装 handler 时 Electron 默认批准）',
    probe.geolocationState === 'denied', `state=${probe.geolocationState}`);
  run.assert('S2 受信 origin：剪贴板写权限层放行（未被 allowlist 误拒）',
    probe.clipboardWritePermission === 'granted', `state=${probe.clipboardWritePermission}`);
  run.assert('S2b 受信 origin：真实点击驱动的复制端到端成功（复制按钮未被误伤）',
    probe.clipboardClick.result === 'ok' && typeof probe.clipboardClick.clickedAt === 'number',
    `click=${probe.clipboardClick.result} hasFocus=${probe.hasFocus}`);
  run.assert('S3 白名单 partition + http src：webview 正常附着并加载（浏览器面板未被误伤）',
    probe.allowed.settled === 'attached' && typeof probe.allowed.url === 'string' && probe.allowed.url.includes('/api/health'),
    `settled=${probe.allowed.settled} url=${probe.allowed.url}`);
  run.assert('S4 非白名单 partition：guest 未创建（被 will-attach-webview 拦下）',
    probe.badPartition.settled !== 'attached', `settled=${probe.badPartition.settled} err=${probe.badPartition.err}`);
  run.assert('S5 非 http(s) src（file:）：guest 未创建',
    probe.badScheme.settled !== 'attached', `settled=${probe.badScheme.settled} err=${probe.badScheme.err}`);
  run.assert('S6 guest（非受信 origin 127.0.0.1:3001）：权限同样被拒',
    probe.allowed.guestGeolocation === 'denied', `guestGeo=${probe.allowed.guestGeolocation}`);
  run.assert('S7 BrowserPanel 源码已无 allowpopups（清单 #11）', allowpopupsLeft === false, `allowpopups=${allowpopupsLeft}`);

  await run.finish({
    probe,
    browserPanel: path.relative(path.join(__dirname, '..'), BROWSER_PANEL).replace(/\\/g, '/'),
    note: 'src/main/** 改动需重启 Electron 生效；本脚本只断言，不负责重启',
    changes: [
      'src/main/security-hardening.js（新）',
      'src/main.js 装配（模块期 web-contents-created + whenReady 后权限策略）',
      'frontend/src/pages/project-workspace/BrowserPanel.tsx 撤 allowpopups',
    ],
    officialChecklist: ['#5 setPermissionRequestHandler', '#11 no allowpopups', '#12 verify webview options'],
  });
  process.exit(run.allPass ? 0 : 1);
})().catch((e) => { lib.log(`FATAL ${e.message}`); process.exit(2); });
