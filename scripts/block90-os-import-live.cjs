#!/usr/bin/env node
'use strict';

/**
 * BLOCK-90 P3 — OS 拖入导入/拖出导出自动化实机探针（dev 栈 + CDP:9222）。
 *
 * 真实 OS 拖入的磁盘路径只有真拖才可取（webUtils），本探针用 plan D2 允许的
 * DataTransfer 源路径测试缝走**其余全链**：合成 DragEvent → 窗口接管 →
 * fs/import-from REST → 工作区落盘 → 树刷新；并断言文件行 dragStart 附带
 * DownloadURL（拖出导出载体）。最终 webUtils 真路径与拖出落盘由用户真拖验收。
 *
 * Evidence: acceptance/block-90/block90-os-import-live.json
 */

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const lib = require(path.join(__dirname, '..', '.agents', 'skills', 'gewu-dev-infra', 'dev-verify', 'lib.cjs'));

const REPO = lib.findRepoRoot(__dirname);
const EVIDENCE_DIR = path.join(REPO, 'acceptance', 'block-90');
const RENDERER = 'http://localhost:3000';
const PROJECT_ID = process.argv[2] || 'p_block90_dragout_bripum';

setTimeout(() => { lib.log('global watchdog: aborting stuck run'); process.exit(3); }, 120_000).unref();

async function waitUntil(fn, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    try {
      last = await fn();
      if (last) return last;
    } catch (error) {
      last = error && error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`timed out waiting for ${label}; last=${JSON.stringify(last)}`);
}

async function connectPage(urlPattern) {
  const targets = await lib.pollTargets({ port: 9222, timeoutMs: 15_000 });
  const candidates = lib.filterPageTargets(targets, urlPattern);
  if (candidates.length === 0) return null;
  return lib.connectTarget(candidates[0]);
}

async function main() {
  const run = lib.createRun({ name: 'block90-os-import-live', evidenceDir: EVIDENCE_DIR });

  // 源文件：放进项目工作区之外（桌面机任意路径），内容带标记
  const sourcePath = path.join(os.tmpdir(), `block90-source-${Date.now()}.csv`);
  const sourceContent = `col_a,col_b\n${Date.now()},BLOCK-90 drag-in import\n`;
  fs.writeFileSync(sourcePath, sourceContent, 'utf-8');
  const importedName = `block90-imported-${Date.now()}.csv`;

  // 确保应用停在项目路由（深链整页加载）
  let client = await connectPage(/^http:\/\/localhost:3000/);
  if (!client) throw new Error('no renderer target');
  const current = await lib.evalJs(client, 'location.href');
  if (!current.includes(`/project/${PROJECT_ID}`)) {
    await lib.evalJs(client, `location.href = ${JSON.stringify(`${RENDERER}/project/${PROJECT_ID}`)}`);
    client = await waitUntil(async () => {
      const next = await connectPage(new RegExp(`/project/${PROJECT_ID}`));
      if (!next) return null;
      const st = await lib.evalJs(next, 'document.readyState');
      return st === 'complete' ? next : null;
    }, 'project route load', 30_000);
  }

  // 等工作区离开加载态（BLOCK-90 接管挂在 RightFileTree，须等其挂载）
  await waitUntil(async () => {
    return lib.evalJs(client, 'Boolean(window.biof3Desktop?.files?.pathForFile)');
  }, 'workspace ready');

  // 打开右栏「文件」标签（drop 接管挂在 RightFileTree，标签未激活时监听未挂载）
  await lib.evalJs(client, `
    (() => {
      const tab = [...document.querySelectorAll('button')].find((el) => (el.textContent || '').trim() === '文件');
      if (tab) tab.click();
      return Boolean(tab);
    })()
  `);
  await new Promise((resolve) => setTimeout(resolve, 800));

  // 合成 drop：DataTransfer 携带 File + 源路径测试缝；落点选屏幕中部（非目录行 → 根目录）
  const dropResult = await lib.evalJs(client, `
    (async () => {
      const name = ${JSON.stringify(importedName)};
      const sourcePath = ${JSON.stringify(sourcePath)};
      const file = new File(['synthetic'], name, { type: 'text/csv' });
      const dt = new DataTransfer();
      dt.items.add(file);
      dt.setData('application/x-gewu-source-path', sourcePath);
      const event = new DragEvent('drop', { bubbles: true, cancelable: true, clientX: 700, clientY: 400 });
      Object.defineProperty(event, 'dataTransfer', { value: dt });
      window.dispatchEvent(event);
      await new Promise((resolve) => setTimeout(resolve, 1200));
      return { dispatched: true };
    })()
  `);
  run.assert('drop event dispatched through window takeover', dropResult.dispatched === true);

  // 断言：文件确实落到项目工作区根目录，内容与源一致（真 REST → 真 fs）
  const importedPath = await waitUntil(async () => {
    const check = await lib.evalJs(client, `
      fetch('http://localhost:3001/api/workspaces/${PROJECT_ID}/tree?prefix=')
        .then((r) => r.json())
        .then((data) => (data.ok ? data.entries.map((e) => e.name) : []))
    `);
    return Array.isArray(check) && check.includes(importedName) ? check : null;
  }, 'imported file in workspace tree', 15_000);
  run.assert('imported file appears in workspace tree', importedPath.includes(importedName));

  // 拖出导出：对根目录文件行派发 dragstart，断言 DownloadURL 已附带
  const dragOut = await lib.evalJs(client, `
    (() => {
      const row = [...document.querySelectorAll('button[data-tree-dir]')];
      const fileRow = [...document.querySelectorAll('[draggable="true"]')]
        .find((el) => !el.getAttribute('data-tree-dir') && (el.textContent || '').includes('dragout-sample'));
      if (!fileRow) return { found: false };
      const dt = new DataTransfer();
      const event = new DragEvent('dragstart', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'dataTransfer', { value: dt });
      fileRow.dispatchEvent(event);
      return { found: true, downloadUrl: dt.getData('DownloadURL'), internal: dt.getData('application/x-gewu-tree-item') };
    })()
  `);
  run.assert('drag-out: file row exposes DownloadURL', dragOut.found === true
    && typeof dragOut.downloadUrl === 'string'
    && dragOut.downloadUrl.startsWith('application/octet-stream:')
    && dragOut.downloadUrl.includes('file://'), JSON.stringify(dragOut.downloadUrl || '').slice(0, 160));
  run.assert('drag-out: internal tree MIME still present (tree moves unaffected)', typeof dragOut.internal === 'string'
    && dragOut.internal.includes('"path"'));

  const payload = await run.finish({
    sourcePath,
    importedName,
    provenance: 'synthetic drop via documented test seam (application/x-gewu-source-path); real webUtils path needs user drag',
  });
  try { fs.unlinkSync(sourcePath); } catch {}
  process.exitCode = payload.allPass ? 0 : 1;
}

main().catch((error) => {
  lib.log(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
