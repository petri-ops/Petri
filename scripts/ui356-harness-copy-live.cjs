#!/usr/bin/env node
'use strict';
/**
 * UI-356 实机验收：设置「计算与数据」分区 Harness 文案改版（Harness 分析环境 → 运行环境包）。
 * 断言：C1 新文案在屏；C2 旧文案（内置分析模块/分析位）零残留。
 * 证据：acceptance/ui-356/ui356-harness-copy-live.json
 */
const fs = require('fs');
const path = require('path');
const http = require('node:http');

const ROOT = path.resolve(__dirname, '..');
const results = [];
function assert(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail == null ? '' : String(detail).slice(0, 300) });
  console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name + (ok ? '' : ' :: ' + String(detail).slice(0, 300)));
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
      ws.addEventListener('open', () => ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true } })));
      ws.addEventListener('message', (ev) => {
        const p = JSON.parse(ev.data);
        if (p.id !== 1) return;
        clearTimeout(timer);
        try { ws.close(); } catch {}
        resolve(p.result && p.result.result ? p.result.result.value : undefined);
      });
      ws.addEventListener('error', (e) => { clearTimeout(timer); reject(new Error('ws: ' + (e && e.message))); });
    } catch (e) { reject(e); }
  });
}

async function main() {
  // 打开设置（若未开）并始终切到「计算与数据」分区（该分区内容按需渲染）。
  let onSettings = await cdpEval(`(document.body.innerText || '').includes('外观与应用偏好')`);
  if (!onSettings) {
    await cdpEval(`(() => {
      const btn = Array.from(document.querySelectorAll('button')).find((b) => (b.getAttribute('aria-label') || '') === '设置');
      if (btn) btn.click();
      return !!btn;
    })()`);
    await sleep(2000);
  }
  await cdpEval(`(() => {
    const btn = Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').includes('计算与数据'));
    if (btn) btn.click();
    return !!btn;
  })()`);
  await sleep(1500);

  const state = await cdpEval(`(() => {
    const text = document.body.innerText || '';
    return {
      newLabel: text.includes('运行环境包'),
      oldLabelGone: !text.includes('Harness 分析环境'),
      oldCopyGone: !text.includes('内置分析模块') && !text.includes('分析位'),
    };
  })()`);
  assert('C1_new_label_on_screen', state && state.newLabel === true, JSON.stringify(state));
  assert('C2_old_copy_absent', state && state.oldLabelGone === true && state.oldCopyGone === true, JSON.stringify(state));

  const allPass = results.every((entry) => entry.ok);
  const evidence = {
    schemaVersion: 1,
    acceptanceId: 'UI-356-HARNESS-COPY',
    generatedAt: new Date().toISOString(),
    qualificationEligible: false,
    allPass,
    checks: results,
    notes: { method: 'CDP eval on running dev Electron settings view' },
  };
  const dir = path.join(ROOT, 'acceptance', 'ui-356');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'ui356-harness-copy-live.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`\n${allPass ? 'ALL PASS' : 'FAILED'} — ${results.filter((entry) => entry.ok).length}/${results.length}`);
  if (!allPass) process.exitCode = 1;
}

main().catch((error) => {
  console.error('[ui356-live] FAIL —', error.message);
  process.exitCode = 1;
});
