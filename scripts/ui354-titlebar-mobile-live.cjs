#!/usr/bin/env node
'use strict';
/**
 * UI-354 实机验收：顶栏最右侧「手机远程 + 设置」（对标 ZCode 顶栏布局）。
 *
 * 前置：dev Electron 带 CDP 9222 在跑（restart-dev-stack.sh 已带）。
 * 环境纪律沿袭 block84-p2-ui-live.cjs：localhost origin + 软导航 + local 项目。
 *
 * 断言：
 *   T1 渲染进程可达
 *   T2 顶栏手机图标 + 设置齿轮同时存在
 *   T3 位置序：设置齿轮在最右（offsetLeft 大于手机图标，手机图标大于右栏开关）
 *   T4 点击手机图标 → 弹出「手机远程」面板
 *   T5 面板内点「生成配对二维码」→ QR 图出现且真实加载（naturalWidth>0）
 *   T6 左栏底部不再有重复「设置」入口（aria-label="设置" 全页唯一=顶栏齿轮）
 *   T7 点击齿轮 → 设置视图打开（workspaceMode=settings）
 *
 * 证据：acceptance/ui-354/ui354-titlebar-mobile-live.json + titlebar-mobile-popup.png
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

function cdpCall(method, params, timeoutMs = 25000) {
  return new Promise(async (resolve, reject) => {
    try {
      const targets = await fetchJson('http://127.0.0.1:9222/json/list');
      const page = targets.find((t) => t.type === 'page');
      if (!page) return reject(new Error('no page target'));
      const ws = new WebSocket(page.webSocketDebuggerUrl);
      const timer = setTimeout(() => { try { ws.close(); } catch {} reject(new Error('cdp timeout')); }, timeoutMs);
      ws.addEventListener('open', () => {
        ws.send(JSON.stringify({ id: 1, method, params }));
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
        resolve(p.result);
      });
      ws.addEventListener('error', (e) => { clearTimeout(timer); reject(new Error('ws: ' + (e && e.message))); });
    } catch (e) { reject(e); }
  });
}

async function cdpEval(expr, timeoutMs) {
  const result = await cdpCall('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, timeoutMs);
  return result && result.result ? result.result.value : undefined;
}

function pickLocalProject() {
  return new Promise((resolve) => {
    http.get('http://127.0.0.1:3001/api/data/projects', (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        try {
          const j = JSON.parse(d);
          const list = Array.isArray(j.projects) ? j.projects : [];
          resolve(list.find((p) => p.workspace_kind === 'local' && p.status !== 'archived') || null);
        } catch { resolve(null); }
      });
    }).on('error', () => resolve(null));
  });
}

async function main() {
  const href0 = await cdpEval('location.href');
  assert('T1_renderer_reachable', typeof href0 === 'string' && href0.startsWith('http'), 'href=' + href0);

  const localProject = await pickLocalProject();
  console.log('  local project:', localProject ? localProject.id + ' / ' + localProject.name : 'NOT FOUND');
  const targetProjectId = localProject ? localProject.id : 'p_mtkamsfu_3mxo';

  await cdpCall('Page.enable', {}).catch(() => {});
  await cdpCall('Page.navigate', { url: `http://localhost:3000/project/${targetProjectId}` }).catch((e) => console.log('  navErr:', e.message));
  await sleep(12000);

  // T2 两个顶栏入口同时存在
  const btns = await cdpEval(`(() => {
    const phone = document.querySelector('[data-testid="titlebar-mobile-remote"]');
    const gear = document.querySelector('[data-testid="titlebar-settings"]');
    return { phone: !!phone, gear: !!gear };
  })()`);
  assert('T2_titlebar_buttons_present', btns && btns.phone === true && btns.gear === true, JSON.stringify(btns));

  // T3 位置序：设置齿轮在最右
  const order = await cdpEval(`(() => {
    const gear = document.querySelector('[data-testid="titlebar-settings"]');
    const phone = document.querySelector('[data-testid="titlebar-mobile-remote"]');
    const rightToggle = Array.from(document.querySelectorAll('button[aria-label*="右侧栏"], button[title*="右侧栏"]')).pop();
    const left = (el) => (el ? Math.round(el.getBoundingClientRect().left) : -1);
    return { gear: left(gear), phone: left(phone), rightToggle: left(rightToggle) };
  })()`);
  assert('T3_settings_rightmost', order && order.gear > order.phone && order.phone > order.rightToggle, JSON.stringify(order));

  // T4 点击手机图标 → 弹层
  await cdpEval(`document.querySelector('[data-testid="titlebar-mobile-remote"]').click()`);
  await sleep(800);
  const popup = await cdpEval(`(() => {
    const card = document.querySelector('[data-testid="mobile-remote-popup"]');
    return card ? { present: true, text: (card.innerText || '').slice(0, 160) } : { present: false };
  })()`);
  assert('T4_mobile_popup_opens', popup && popup.present === true, JSON.stringify(popup));

  // T5 面板内生成配对二维码 → img 真实加载
  await cdpEval(`(() => {
    const card = document.querySelector('[data-testid="mobile-remote-popup"]');
    const btn = card && Array.from(card.querySelectorAll('button')).find((b) => b.textContent.includes('生成配对二维码'));
    if (btn) btn.click();
    return !!btn;
  })()`);
  await sleep(2500);
  const qr = await cdpEval(`(() => {
    const img = document.querySelector('[data-testid="mobile-remote-popup"] img[alt="手机配对二维码"]');
    return img ? { present: true, src: (img.getAttribute('src') || '').split('token=')[0], loaded: img.complete && img.naturalWidth > 0, naturalWidth: img.naturalWidth } : { present: false };
  })()`);
  assert('T5_qr_renders', qr && qr.present === true && qr.loaded === true, JSON.stringify(qr));

  // 截图证据（弹层展开态）
  try {
    const shot = await cdpCall('Page.captureScreenshot', { format: 'png' }, 20000);
    if (shot && shot.data) {
      const dir = path.join(ROOT, 'acceptance', 'ui-354');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'titlebar-mobile-popup.png'), Buffer.from(shot.data, 'base64'));
      console.log('  screenshot saved: acceptance/ui-354/titlebar-mobile-popup.png');
    }
  } catch (e) { console.log('  screenshot skipped:', e.message); }

  // T6 左栏底部不再有重复设置入口（button[aria-label="设置"] 全页唯一=顶栏齿轮；
  // 设置视图自身存在非按钮的 aria-label 容器，不计入）
  const settingsCount = await cdpEval(`document.querySelectorAll('button[aria-label="设置"]').length`);
  assert('T6_settings_entry_unique', settingsCount === 1, 'count=' + settingsCount);

  // T7 点击齿轮 → 设置视图打开（默认分区显示设置特有文本），再切到「计算与数据」
  // 分区验证「手机远程」小节在场（该小节随 UI-319 落在计算与数据分区内）。
  await cdpEval(`(() => {
    const overlay = document.querySelector('[class*="mobileRemoteOverlay"]');
    if (overlay) overlay.click();
    document.querySelector('[data-testid="titlebar-settings"]').click();
    return true;
  })()`);
  await sleep(2500);
  const settingsOpened = await cdpEval(`(() => {
    const text = document.body.innerText || '';
    return { opened: text.includes('外观与应用偏好') && text.includes('模型接口') };
  })()`);
  assert('T7a_gear_opens_settings', settingsOpened && settingsOpened.opened === true, JSON.stringify(settingsOpened));
  const sectionClicked = await cdpEval(`(() => {
    const btn = Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').includes('计算与数据'));
    if (btn) btn.click();
    return !!btn;
  })()`);
  await sleep(1200);
  const sectionShown = await cdpEval(`(() => {
    const text = document.body.innerText || '';
    return { mobileRemote: text.includes('手机远程'), compute: text.includes('执行位置与存储')  };
  })()`);
  assert('T7b_settings_has_mobile_remote_section', sectionShown && sectionShown.mobileRemote === true, JSON.stringify(sectionShown));

  const allPass = results.every((entry) => entry.ok);
  const evidence = {
    schemaVersion: 1,
    acceptanceId: 'UI-354-TITLEBAR-MOBILE-SETTINGS',
    generatedAt: new Date().toISOString(),
    qualificationEligible: false,
    allPass,
    checks: results,
    notes: { method: 'CDP driven dev Electron (9222), localhost origin, local project workspace' },
  };
  const dir = path.join(ROOT, 'acceptance', 'ui-354');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'ui354-titlebar-mobile-live.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`\n${allPass ? 'ALL PASS' : 'FAILED'} — ${results.filter((entry) => entry.ok).length}/${results.length}`);
  if (!allPass) process.exitCode = 1;
}

main().catch((error) => {
  console.error('[ui354-live] FAIL —', error.message);
  process.exitCode = 1;
});
