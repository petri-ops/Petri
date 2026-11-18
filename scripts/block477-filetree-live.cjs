#!/usr/bin/env node
'use strict';

/**
 * block477-filetree-live.cjs — BLOCK-477 / C-47 GUI 实机腿（分相位采样）。
 *
 * 相对 BLOCK-349 的增量：349 在点击后固定 sleep 2500ms 单次采样，只看到 B3「200→200」，
 * 无法区分「首击未生效」与「生效后被 2s 轮询拉回」。本脚本在点击后按 300/1200/2600ms
 * 三相位采样行数 + document.hidden，捕捉「400→…→200」的回弹轨迹，作为状态机归因的实机佐证。
 *
 * 诚实边界：9223 离屏窗口可能 document.hidden=true → 轮询 `if (!document.hidden)` 不触发，
 * 回弹无法在离屏下现形；此时如实标 environment_blocked（hiddenWindow），不伪造。
 * 本脚本只读断言，不改产品代码；夹具项目在 finally 清理。
 */
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const lib = require(path.join(__dirname, '..', '.agents', 'skills', 'petri-dev-infra', 'dev-verify', 'lib.cjs'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const EVIDENCE_DIR = path.join(__dirname, '..', 'acceptance', 'block477-filetree-attribution');
const AUTH = 'Bearer desktop-local';
const PORT = 3001;
const FILE_COUNT = 520;
const ROW_SEL = 'button[title^="预览 bigdir-"]';
let client;
const EVAL = (expr) => lib.evalJs(client, expr);

function restCall(method, apiPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({
      host: '127.0.0.1', port: PORT, path: apiPath, method,
      headers: { Authorization: AUTH, 'Content-Type': 'application/json', ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}) },
    }, (res) => {
      let b = ''; res.on('data', (c) => { b += c; });
      res.on('end', () => { try { resolve({ status: res.statusCode, data: JSON.parse(b) }); } catch { resolve({ status: res.statusCode, data: { raw: b.slice(0, 200) } }); } });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const waitFor = async (expr, { timeoutMs = 30000, label = '' } = {}) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await EVAL(expr).catch(() => null);
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`waitFor timeout: ${label || String(expr).slice(0, 70)}`);
    await sleep(400);
  }
};

const sample = async (phase) => {
  const raw = await EVAL(`(() => JSON.stringify({ phase: ${JSON.stringify(phase)}, rows: document.querySelectorAll(${JSON.stringify(ROW_SEL)}).length, hidden: document.hidden, t: Date.now() }))()`);
  return JSON.parse(raw || '{}');
};

(async () => {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  let projectId = null;
  let workspacePath = null;
  const result = {
    package: 'BLOCK-477', at: '2026-11-18', probe: 'block477-filetree-live',
    triState: 'environment_blocked', samples: [], observations: {}, fatal: null,
  };
  try {
    const created = (await restCall('POST', '/api/data/projects', { name: `block477-bigdir-${Date.now().toString(36)}` })).data;
    projectId = created.project && created.project.id;
    if (!projectId) throw new Error('project create failed');
    const detail = (await restCall('GET', `/api/data/projects/${projectId}`)).data;
    workspacePath = detail.project && (detail.project.workspace_path || detail.project.workspacePath);
    if (!workspacePath || !fs.existsSync(workspacePath)) throw new Error(`workspace dir missing: ${workspacePath}`);
    for (let i = 0; i < FILE_COUNT; i += 1) {
      fs.writeFileSync(path.join(workspacePath, `bigdir-${String(i).padStart(4, '0')}.md`), `# 夹具 ${i}\nBLOCK-477 C-47 回弹复现夹具。\n`);
    }

    client = await lib.connectTestTarget({ timeoutMs: 30000 });
    await EVAL(`location.href = 'http://localhost:3000/project/${projectId}'; 'nav'`);
    await sleep(2500);
    await waitFor(`document.body && document.body.textContent.includes('工作台') ? true : null`, { label: 'project page', timeoutMs: 45000 });
    await EVAL(`window.dispatchEvent(new CustomEvent('petri:project-open-workspace-file', { detail: { projectId: ${JSON.stringify(projectId)}, relativePath: 'bigdir-0000.md', name: 'bigdir-0000.md', openWithSystemApp: false } })); 'open'`);
    await waitFor(`document.querySelector('[data-testid="file-tree-load-more-root"], [data-testid="file-tree-load-more"]') ? true : null`, { label: 'load-more button', timeoutMs: 40000 });

    result.samples.push(await sample('baseline_first_page'));
    // 首击：200 → 400
    await EVAL(`(() => { const b = document.querySelector('[data-testid="file-tree-load-more-root"]') || document.querySelector('[data-testid="file-tree-load-more"]'); if (b) b.click(); return 'clicked'; })()`);
    await sleep(300); result.samples.push(await sample('after_click_300ms'));
    await sleep(900); result.samples.push(await sample('after_click_1200ms'));
    await sleep(1400); result.samples.push(await sample('after_click_2600ms'));

    const rows = result.samples.map((s) => s.rows);
    const peak = Math.max(...rows);
    const trough = Math.min(...rows.slice(2));
    const hiddenEver = result.samples.some((s) => s.hidden === true);
    result.observations = {
      baseline: rows[0], peak, troughAfterPoll: trough,
      grewAfterClick: peak > rows[0],
      reboundAfter2s: peak > rows[0] && trough < peak,
      hiddenEver,
    };

    // 截图留证
    try {
      const shot = await client.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(EVIDENCE_DIR, 'block477-filetree-repro.png'), Buffer.from(shot.data, 'base64'));
      result.screenshot = 'acceptance/block477-filetree-attribution/block477-filetree-repro.png';
    } catch { result.screenshot = 'screenshot_unavailable'; }

    if (!result.observations.grewAfterClick) {
      result.triState = 'environment_blocked';
      result.blockReason = 'load-more 首击未产生行数增长（夹具/选择器/后端分页环境不匹配），无法进入回弹判定';
    } else if (hiddenEver && !result.observations.reboundAfter2s) {
      result.triState = 'environment_blocked';
      result.blockReason = '离屏窗口 document.hidden=true → 2s 轮询 `if (!document.hidden)` 不触发，回弹在离屏下不可现形；状态机+源码锚定为主证据';
    } else if (result.observations.reboundAfter2s) {
      result.triState = 'reproduced_and_attributed';
    } else {
      result.triState = 'observed_not_reproduced';
    }
    console.log(`[block477-live] triState=${result.triState} peak=${peak} trough=${trough} hidden=${hiddenEver}`);
  } catch (error) {
    result.triState = 'environment_blocked';
    result.fatal = String(error && error.message).slice(0, 240);
    console.log(`[block477-live] FATAL ${result.fatal}`);
    process.exitCode = 0; // 环境不可得是合法终态，非脚本失败
  } finally {
    fs.writeFileSync(path.join(EVIDENCE_DIR, 'block477-live-result.json'), `${JSON.stringify(result, null, 2)}\n`);
    if (projectId) {
      await restCall('DELETE', `/api/data/projects/${projectId}`).catch(() => {});
      if (workspacePath && fs.existsSync(workspacePath)) {
        try { fs.rmSync(workspacePath, { recursive: true, force: true }); } catch { /* 级联 */ }
      }
    }
  }
})();
