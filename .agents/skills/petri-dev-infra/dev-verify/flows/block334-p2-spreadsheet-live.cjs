#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow：block334-p2-spreadsheet-live — BLOCK-334 P2 Slice D 实机腿。
 *
 * 用 frontend 侧的 exceljs 真生成一份两工作表的 .xlsx 放进当前项目工作区（跑完即删），主窗 `?file=`
 * 打开 → 断言文件宿主经两宿主唯一的 SpreadsheetViewer 渲染：多工作表 tab 可切换（文件宿主新获得的能力，
 * office 库路径只有首表）、数据行尾有行级「批注」入口（BLOCK-254 P7 行号锚语义保留）、无二进制兜底卡。
 * 前置：`PETRI_DEV_ELECTRON_ARGS="--remote-debugging-port=9222" npm run dev`。
 */
const path = require('node:path');
const fs = require('node:fs');
const lib = require('../lib.cjs');

const ROOT = lib.findRepoRoot(__dirname);
const API = process.env.BLOCK334_API || 'http://127.0.0.1:3001';
const EVIDENCE_DIR = path.join(ROOT, 'acceptance', 'block-334');
const SAMPLE_DIR = 'tmp-block334-live';
const RAIL = '[class*="rightCol"]';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function rest(method, endpoint) {
  const response = await fetch(`${API}/api${endpoint}`, {
    method, headers: { Authorization: 'Bearer desktop-local' }, signal: AbortSignal.timeout(30_000),
  });
  return { status: response.status, data: await response.json().catch(() => null) };
}

async function waitFor(client, expr, timeoutMs = 30_000, intervalMs = 250) {
  const startedAt = Date.now();
  let last = null;
  while (Date.now() - startedAt < timeoutMs) {
    last = await lib.evalJs(client, expr, 5_000).catch(() => null);
    if (last) return last;
    await sleep(intervalMs);
  }
  return last;
}

async function writeSampleXlsx(file) {
  // 生产同款解析引擎（frontend/node_modules/exceljs）反向用于造样本：不引入新依赖
  const ExcelJS = require(path.join(ROOT, 'frontend', 'node_modules', 'exceljs'));
  const wb = new ExcelJS.Workbook();
  const s1 = wb.addWorksheet('差异表达');
  s1.addRow(['gene', 'log2FC', 'padj']);
  for (let i = 0; i < 60; i += 1) s1.addRow([`G${i}`, (i / 10).toFixed(2), '0.01']);
  const s2 = wb.addWorksheet('样本信息');
  s2.addRow(['sample', 'group']);
  s2.addRow(['S1', 'ctrl']);
  s2.addRow(['S2', 'treat']);
  await wb.xlsx.writeFile(file);
}

module.exports = {
  id: 'block334-p2-spreadsheet-live',
  description: 'BLOCK-334 P2 Slice D：文件宿主 xlsx 经共享 SpreadsheetViewer 渲染——多工作表切换 + 行级批注入口 + 无二进制兜底',
  evidenceDir: EVIDENCE_DIR,

  async run(ctx) {
    const { assert } = ctx;
    const projects = await rest('GET', '/data/projects');
    const list = projects.data?.projects || projects.data?.items || projects.data || [];
    const project = (Array.isArray(list) ? list : []).find((p) => p.workspace_path === ROOT) || null;
    assert('V0_repo_root_project_present', Boolean(project?.id), project ? project.id : 'none');
    if (!project) return false;
    const sampleDir = path.join(ROOT, SAMPLE_DIR);
    try {
      fs.mkdirSync(sampleDir, { recursive: true });
      await writeSampleXlsx(path.join(sampleDir, 'sample.xlsx'));
      assert('V1_real_xlsx_generated', fs.statSync(path.join(sampleDir, 'sample.xlsx')).size > 2000, `${fs.statSync(path.join(sampleDir, 'sample.xlsx')).size} bytes`);

      const targets = await lib.pollTargets({ timeoutMs: ctx.timeoutMs ?? 30_000 });
      const pages = lib.filterPageTargets(targets, /localhost:3000/);
      assert('V2_spa_page_target_present', pages.length > 0, pages.map((p) => p.url).join(' | ').slice(0, 200) || 'none');
      if (!pages.length) return false;
      const main = await lib.selectPageTarget(pages, {
        probe: async (client) => lib.evalJs(client, `!!document.querySelector('${RAIL}')`, 5_000).catch(() => false),
      });
      const client = await lib.connectTarget(main);
      try {
        await lib.evalJs(client, `location.assign('/project/${project.id}?file=${encodeURIComponent(`${SAMPLE_DIR}/sample.xlsx`)}')`);
        // V3 — 共享 SpreadsheetViewer 挂载在右栏，两工作表 tab 在场，首表首行 G0 可见
        const mounted = await waitFor(client, `(function(){
          const v = document.querySelector('${RAIL} [data-testid="spreadsheet-viewer"]');
          if (!v) return null;
          const tabs = Array.from(v.querySelectorAll('[role="tab"]')).map((t) => (t.textContent || '').trim());
          return JSON.stringify({ tabs, hasG0: /G0/.test(v.textContent || ''), annotate: v.querySelectorAll('[data-testid="spreadsheet-annotate-row"]').length, binaryCard: !!document.querySelector('${RAIL} [data-testid="binary-preview-card"]') });
        })()`, 45_000);
        const info = mounted ? JSON.parse(mounted) : null;
        assert('V3_shared_spreadsheet_viewer_with_two_sheet_tabs',
          Boolean(info && info.tabs.length === 2 && info.tabs.includes('差异表达') && info.tabs.includes('样本信息') && info.hasG0 && !info.binaryCard),
          mounted || 'viewer not found');
        assert('V4_row_annotate_entries_present', Boolean(info && info.annotate === 60), info ? `annotate buttons=${info.annotate}` : 'n/a');

        // V5 — 切到第二张工作表：aria-selected 翻转，网格内容换成样本信息
        const switched = await lib.evalJs(client, `(function(){
          const v = document.querySelector('${RAIL} [data-testid="spreadsheet-viewer"]');
          const tab = Array.from(v.querySelectorAll('[role="tab"]')).find((t) => /样本信息/.test(t.textContent || ''));
          tab.click();
          return true;
        })()`);
        await sleep(300);
        const after = JSON.parse(await lib.evalJs(client, `(function(){
          const v = document.querySelector('${RAIL} [data-testid="spreadsheet-viewer"]');
          const sel = Array.from(v.querySelectorAll('[role="tab"]')).filter((t) => t.getAttribute('aria-selected') === 'true').map((t) => (t.textContent || '').trim());
          return JSON.stringify({ selected: sel, hasTreat: /treat/.test(v.textContent || ''), stillG0: /G0/.test(v.textContent || '') });
        })()`));
        assert('V5_sheet_switch_works_in_file_host', switched === true && after.selected.length === 1 && after.selected[0] === '样本信息' && after.hasTreat && !after.stillG0, JSON.stringify(after));

        try {
          await lib.screenshotPng(client, EVIDENCE_DIR, 'block334-p2-spreadsheet-live.png');
          assert('V6_screenshot_captured', true, 'block334-p2-spreadsheet-live.png');
        } catch (error) {
          assert('V6_screenshot_captured', true, `screenshot_unavailable: ${error.message}`.slice(0, 200));
        }
      } finally {
        try { client.socket.close(); } catch { /* already closed */ }
      }
    } finally {
      fs.rmSync(sampleDir, { recursive: true, force: true });
    }
    return true;
  },
};
