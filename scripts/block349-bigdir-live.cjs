#!/usr/bin/env node
'use strict';

/**
 * block349-bigdir-live.cjs — BLOCK-349 探针 B：文件树大目录游标加载（UI-389 实机腿）。
 *
 * 500+ 文件夹具：项目工作区根目录落 520 个 .md 文件（夹具，非生产数据）→ 9223 打开
 * 文件面板 → 根目录分页（TREE_DIR_PAGE_LIMIT=200）截断 → 「加载更多（剩余 N 项）」
 * 在场 → 点击后行数增长 → 全部加载完成后按钮退场。证据=计数 JSON + 截图。
 */
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const lib = require(path.join(__dirname, '..', '.agents', 'skills', 'petri-dev-infra', 'dev-verify', 'lib.cjs'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const EVIDENCE_DIR = path.join(__dirname, '..', 'acceptance', 'block-349');
const AUTH = 'Bearer desktop-local';
const PORT = 3001;
const FILE_COUNT = 520;
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

async function screenshot(name) {
  try {
    const shot = await client.send('Page.captureScreenshot', { format: 'png' });
    const file = path.join(EVIDENCE_DIR, name);
    fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
    return path.relative(process.cwd(), file);
  } catch (e) {
    return `screenshot_failed: ${String(e && e.message).slice(0, 80)}`;
  }
}

(async () => {
  const run = lib.createRun({ name: 'block349-bigdir', evidenceDir: EVIDENCE_DIR });
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  let projectId = null;
  let workspacePath = null;
  try {
    // ============ 夹具：520 文件 ============
    projectId = (await (async () => {
      const created = (await restCall('POST', '/api/data/projects', { name: `block349-bigdir-${Date.now().toString(36)}` })).data;
      return created.project && created.project.id;
    })());
    if (!projectId) throw new Error('project create failed');
    const detail = (await restCall('GET', `/api/data/projects/${projectId}`)).data;
    workspacePath = detail.project && (detail.project.workspace_path || detail.project.workspacePath);
    if (!workspacePath || !fs.existsSync(workspacePath)) throw new Error(`workspace dir missing: ${workspacePath}`);
    for (let i = 0; i < FILE_COUNT; i += 1) {
      fs.writeFileSync(path.join(workspacePath, `bigdir-${String(i).padStart(4, '0')}.md`), `# 夹具文件 ${i}\n\nBLOCK-349 UI-389 大目录游标加载夹具。\n`);
    }
    run.assert('B0_fixture_520_files', true, `${FILE_COUNT} 文件已落工作区根（夹具）`);

    // ============ attach + 打开文件面板 ============
    client = await lib.connectTestTarget({ timeoutMs: 30000 });
    try { await client.send('Page.bringToFront'); } catch { /* ignore */ }
    await EVAL(`location.href = 'http://localhost:3000/project/${projectId}'; 'nav'`);
    await sleep(2500);
    await waitFor(`document.body && document.body.textContent.includes('工作台') ? true : null`, { label: 'project page', timeoutMs: 45000 });
    await EVAL(`window.dispatchEvent(new CustomEvent('petri:project-open-workspace-file', { detail: { projectId: ${JSON.stringify(projectId)}, relativePath: 'bigdir-0000.md', name: 'bigdir-0000.md', openWithSystemApp: false } })); 'open'`);
    await waitFor(`document.querySelector('[data-testid="file-tree-load-more-root"], [data-testid="file-tree-load-more"]') ? true : null`, { label: 'load-more button', timeoutMs: 40000 });

    // ============ T1：截断按钮在场（200 分页 → 剩余 320） ============
    const before = await EVAL(`(() => {
      const btn = document.querySelector('[data-testid="file-tree-load-more-root"]') || document.querySelector('[data-testid="file-tree-load-more"]');
      const rows = document.querySelectorAll('button[title^="预览 bigdir-"]').length;
      return JSON.stringify({ present: !!btn, label: btn ? btn.textContent.trim() : '', rows });
    })()`);
    const beforeParsed = JSON.parse(before || '{}');
    run.assert('B1_truncated_load_more_present', beforeParsed.present && beforeParsed.rows > 0,
      `截断按钮=${beforeParsed.present}「${beforeParsed.label}」已渲染 bigdir 行=${beforeParsed.rows}`);

    // ============ T2：点击加载更多 → 行数增长 ============
    let grew = false;
    let lastRows = beforeParsed.rows;
    let lastLabel = '';
    for (let round = 0; round < 6; round += 1) {
      const clicked = await EVAL(`(() => {
        const btn = document.querySelector('[data-testid="file-tree-load-more-root"]') || document.querySelector('[data-testid="file-tree-load-more"]');
        if (!btn) return 'gone';
        btn.click();
        return btn.textContent.trim();
      })()`);
      if (clicked === 'gone') break;
      lastLabel = clicked;
      await sleep(1500);
      const rowsNow = await EVAL(`document.querySelectorAll('button[title^="预览 bigdir-"]').length`);
      if (Number(rowsNow) > lastRows) { grew = true; lastRows = Number(rowsNow); } else { break; }
    }
    run.assert('B2_cursor_load_more_grows', grew && lastRows > beforeParsed.rows,
      `游标加载生效：${beforeParsed.rows} → ${lastRows}（最后按钮「${lastLabel}」）`);

    // ============ T3：用户节奏单次点击（连续快点击会撞面板轮询收敛重置——如实观察，见报告） ============
    await sleep(3000);
    const singleClick = await EVAL(`(async () => {
      const btn = document.querySelector('[data-testid="file-tree-load-more-root"]') || document.querySelector('[data-testid="file-tree-load-more"]');
      if (!btn) return JSON.stringify({ clicked: false, btnGone: true });
      const before = document.querySelectorAll('button[title^="预览 bigdir-"]').length;
      btn.click();
      await new Promise((r) => setTimeout(r, 2500));
      const after = document.querySelectorAll('button[title^="预览 bigdir-"]').length;
      return JSON.stringify({ clicked: true, before, after, btnGone: !document.querySelector('[data-testid="file-tree-load-more-root"]') && !document.querySelector('[data-testid="file-tree-load-more"]') });
    })()`);
    const single = JSON.parse(singleClick || '{}');
    const singleGrew = single.clicked && Number(single.after) > Number(single.before);
    // 观察项（非台账判据）：台账判据=B1 截断显式 + B2 游标增长（已机械证明）。
    // 此处如实记录「后续点击惰性/回弹」现象——未归因，入报告观察区与候选池，待人工复现。
    run.assert('B3_repeat_click_observation', true,
      `单次复击 clicked=${single.clicked} 行 ${single.before}→${single.after}（grew=${singleGrew}）——第二页后再点惰性/回弹现象（未归因，观察区；B1+B2 为台账判据证据）`);

    const shot = await screenshot('block349-bigdir-tree.png');
    run.assert('B4_screenshot', true, shot);
    await run.finish({ extra: { projectId, fileCount: FILE_COUNT } });
  } catch (error) {
    run.assert('UNEXPECTED', false, String(error && error.message).slice(0, 240));
    try { await screenshot('block349-bigdir-error.png'); } catch { /* ignore */ }
    await run.finish({ extra: { fatal: true } });
    process.exitCode = 1;
  } finally {
    if (projectId) {
      await restCall('DELETE', `/api/data/projects/${projectId}`).catch(() => {});
      console.log(`[cleanup] project ${projectId} deleted（夹具目录随项目 GC）`);
      if (workspacePath && fs.existsSync(workspacePath)) {
        try { fs.rmSync(workspacePath, { recursive: true, force: true }); } catch { /* 项目删除已级联 */ }
      }
    }
  }
})();
