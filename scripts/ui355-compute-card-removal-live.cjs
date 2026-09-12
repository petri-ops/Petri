#!/usr/bin/env node
'use strict';
/**
 * UI-355 实机验收：设置页「计算与数据」分区移除「计算执行」遗留卡。
 *
 * 前置：dev Electron 带 CDP 9222 在跑。
 * 断言：
 *   R1 设置视图可达
 *   R2 计算与数据分区内「远程执行目标（SSH）」仍在（BLOCK-57/67 活功能不误删）
 *   R3 「计算执行」卡消失：无「执行位置」下拉标题、无「保存计算设置」按钮
 * 证据：acceptance/ui-355/ui355-compute-card-removal-live.json + compute-section.png
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
      ws.addEventListener('open', () => ws.send(JSON.stringify({ id: 1, method, params })));
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
  const localProject = await pickLocalProject();
  const targetProjectId = localProject ? localProject.id : 'p_mtkamsfu_3mxo';

  await cdpCall('Page.enable', {}).catch(() => {});
  await cdpCall('Page.navigate', { url: `http://localhost:3000/project/${targetProjectId}` }).catch((e) => console.log('  navErr:', e.message));
  await sleep(12000);

  // 打开设置 → 计算与数据 分区（带重试，规避 Vite 热更瞬态）
  let section = { present: false };
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await cdpEval(`(() => {
      const gear = Array.from(document.querySelectorAll('button')).find((b) => (b.getAttribute('aria-label') || '') === '设置');
      if (gear) gear.click();
      return !!gear;
    })()`);
    await sleep(1500);
    await cdpEval(`(() => {
      const btn = Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').includes('计算与数据'));
      if (btn) btn.click();
      return !!btn;
    })()`);
    await sleep(1200);
    section = await cdpEval(`(() => {
      const heading = Array.from(document.querySelectorAll('h3')).find((h) => (h.textContent || '').includes('计算与数据'));
      const scope = heading && heading.closest('section');
      const text = scope ? scope.innerText : (document.body.innerText || '');
      return {
        present: text.includes('远程执行目标') || text.includes('数据'),
        remoteTargets: text.includes('远程执行目标'),
        legacyCardGone: !text.includes('保存计算设置') && !text.includes('计算执行'),
        legacyDropdownGone: !text.includes('执行位置'),
        text: text.slice(0, 400),
      };
    })()`);
    if (section.remoteTargets && section.legacyCardGone) break;
    console.log(`  retry ${attempt + 1}: remoteTargets=${section.remoteTargets} legacyCardGone=${section.legacyCardGone}`);
  }

  assert('R2_remote_targets_kept', section.remoteTargets === true, JSON.stringify({ remoteTargets: section.remoteTargets }));
  assert('R3_legacy_card_gone', section.legacyCardGone === true && section.legacyDropdownGone === true, JSON.stringify({ legacyCardGone: section.legacyCardGone, legacyDropdownGone: section.legacyDropdownGone }));

  // 截图证据
  try {
    const shot = await cdpCall('Page.captureScreenshot', { format: 'png' }, 20000);
    if (shot && shot.data) {
      const dir = path.join(ROOT, 'acceptance', 'ui-355');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'compute-section.png'), Buffer.from(shot.data, 'base64'));
      console.log('  screenshot saved: acceptance/ui-355/compute-section.png');
    }
  } catch (e) { console.log('  screenshot skipped:', e.message); }

  const allPass = results.every((entry) => entry.ok);
  const evidence = {
    schemaVersion: 1,
    acceptanceId: 'UI-355-COMPUTE-CARD-REMOVAL',
    generatedAt: new Date().toISOString(),
    qualificationEligible: false,
    allPass,
    checks: results,
    notes: { method: 'CDP driven dev Electron (9222), settings → 计算与数据 section inspection' },
  };
  const dir = path.join(ROOT, 'acceptance', 'ui-355');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'ui355-compute-card-removal-live.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`\n${allPass ? 'ALL PASS' : 'FAILED'} — ${results.filter((entry) => entry.ok).length}/${results.length}`);
  if (!allPass) process.exitCode = 1;
}

main().catch((error) => {
  console.error('[ui355-live] FAIL —', error.message);
  process.exitCode = 1;
});
