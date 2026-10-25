#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow: q6rem-annotations-live — BLOCK-254（Q6-REM）实机腿。
 *
 * 覆盖本包新增/改动的五个面（真 Chromium，走工作区文件预览 + 速记面板，不依赖结果 job）：
 *   A0a backend_rest_healthy        隔离后端 REST 可达
 *   A0b app_page_ready              CDP 页面 root 就绪
 *   A0c temp_project_created        临时验收项目（带 workspace_path）
 *   A1  fixtures_written            SVG 图 + 文本 + 最小 docx（自造，零外部依赖）
 *   A2  files_panel_ready           文件 tab + 树行渲染
 *   A3  image_bar_mounted           图像预览出现批注条（P1 基座）
 *   A4  mosaic_disclosure           选马赛克后 hint 含「仅屏显遮蔽」且带 data-mosaic-fallback（P3）
 *   A5  mosaic_saved               马赛克批注落库：kind=mosaic、rect 归一化、旁路 surface（P1/P3）
 *   A6  undo_removes_annotation     撤销按钮把刚存的批注删掉，REST 侧同步为空（P4）
 *   A7  text_bar_mode              文本文件预览出现 mode=text 批注条且无画框开关（P5）
 *   A8  scratchpad_image_bar       速记图片大图挂上批注条（P6）
 *   A9  scratchpad_annotation_saved 速记图片批注落库：surface=scratchpad-entry + entryId（P6）
 *   A10 office_paragraph_button     docx 段落出现「批注」按钮（P7）
 *   A11 office_paragraph_saved     段落批注落库：kind=text-selection、anchor.unit=paragraph（P7）
 *   A12 artifacts_untouched        三个原始文件哈希不变（批注是旁路元数据）
 *   A99 cleanup                    页面还原
 *
 * 诚实边界（写进 plan §9 / 台账）：
 * - **选区 → 锚点**的落库闭环不在本 flow：CodeMirror 的选区由内部 state 驱动，脚本改 DOM
 *   selection 不保证同步；该链路由 `selectionActions` / `annotations` / `block219` 单测覆盖。
 *   本 flow 只证「文本面批注条以 mode=text 挂载、不渲染画框开关」。
 * - 马赛克「屏显遮蔽」不做像素级证明（G-3）：只证形态与声明，不写「已脱敏」。
 * - 截图：本 flow 不产截图（离屏截图在部分 flow 超时），report 标 screenshots=unavailable。
 *
 * 前置：隔离栈由 scripts/block254-q6-rem-live.mjs 起（:3001/:3000/:9223 + 临时数据根）。
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const lib = require('../lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);

const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local' };
const APP_ORIGIN = 'http://localhost:3000';
const IMG = '[data-testid="annotatable-image-pane"]';
const OFFICE = '[data-testid="office-paragraphs"]';

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function rest(method, p, body) {
  const resp = await fetch(API + p, {
    method,
    headers: body ? { ...AUTH, 'content-type': 'application/json' } : AUTH,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await resp.json(); } catch { /* non-json */ }
  return { ok: resp.ok, status: resp.status, data };
}

/**
 * CDP 连接的自愈层。
 *
 * 实机抓真（2026-10-24 两轮）：长时间在同一 target 上连续 eval，偶发
 * `eval_timeout_30000ms`——页面本身没卡（后续操作仍可用），是 ws 会话失活。
 * 因此每次 eval 前先 4s 探活，失败即重连并重取 target；单次 eval 上限 8s，
 * 让「失活」快速暴露而不是把 30s 超时乘以重试次数。
 */
let activeClient = null;

async function ensureClient() {
  if (activeClient) {
    try { await lib.evalJs(activeClient, '1', 4000); return activeClient; } catch { activeClient = null; }
  }
  const targets = await lib.pollTargets({ port: lib.TEST_INSTANCE_PORT, timeoutMs: 20000 });
  const pages = lib.filterPageTargets(targets, /^http:\/\/localhost:3000\//);
  if (!pages.length) throw new Error('no_app_page_target');
  const chosen = await lib.selectPageTarget(pages, {
    probe: async (candidate) => lib.evalJs(candidate, `!!document.getElementById('root')`).catch(() => false),
  });
  activeClient = await lib.connectTarget(chosen);
  return activeClient;
}

async function evalRetry(_client, expr, tries = 4) {
  let lastErr = null;
  for (let index = 0; index < tries; index += 1) {
    try {
      const live = await ensureClient();
      return await lib.evalJs(live, expr, 8000);
    } catch (error) {
      lastErr = error;
      await sleep(600);
    }
  }
  throw lastErr;
}

/**
 * 导航用 CDP 原生 `Page.navigate`，不用 `location.href = ...`：
 * 后者在执行上下文销毁时常常**不返回** `Runtime.evaluate` 的结果，
 * 表现为一次假超时（2026-10-24 实机抓真：A9 之后整轮卡住即此因）。
 */
async function navigate(url) {
  const withTimeout = (factory, ms) => Promise.race([
    factory(),
    new Promise((_resolve, reject) => { setTimeout(() => reject(new Error('nav_timeout')), ms); }),
  ]);
  const live = await ensureClient();
  try {
    await withTimeout(() => live.send('Page.navigate', { url }), 6000);
  } catch {
    try {
      await withTimeout(
        () => lib.evalJs(live, `setTimeout(function(){ location.href = ${JSON.stringify(url)}; }, 0); 'navigating'`, 3000),
        5000,
      );
    } catch {
      // 连接已死：丢弃句柄，下一次 ensureClient 重连到新页面。
      activeClient = null;
    }
  }
  await sleep(1500);
}

async function pagePoll(_client, expr, { timeoutMs = 20000, label } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    // 每轮给硬上限：CDP 失活时不能把「探活 4s + eval 8s」乘成几十秒卡住整轮。
    const budget = Math.min(6000, Math.max(1200, deadline - Date.now()));
    last = await Promise.race([
      evalRetry(null, expr, 1),
      new Promise((resolve) => { setTimeout(() => resolve('poll_budget_exhausted'), budget); }),
    ]).catch((error) => `eval_err:${error.message}`);
    if (last && last !== '0' && last !== 'false' && last !== 'null' && last !== '""') return last;
    await sleep(700);
  }
  throw new Error(`page_poll_timeout: ${label} :: ${String(last).slice(0, 200)}`);
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320" viewBox="0 0 480 320">
  <rect width="480" height="320" fill="#0b1220"/>
  <circle cx="240" cy="160" r="90" fill="#1d2945" stroke="#5eead4" stroke-width="3"/>
  <text x="240" y="300" fill="#e6edf3" font-size="18" text-anchor="middle">BLOCK-254 annotation fixture</text>
</svg>
`;

const TEXT_FILE = `BLOCK-254 text annotation fixture
second line for the text annotation bar
third line
`;

// ── 最小 docx（store 方式 zip，零依赖）：unzipit 可读，office-file-preview 抽两段 ──
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let crc = -1;
  for (let i = 0; i < buf.length; i += 1) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

/** 无压缩 zip（store）：docx 只需要能被 unzipit 读出条目。 */
function storeZip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const [name, text] of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const dataBuf = Buffer.isBuffer(text) ? text : Buffer.from(text, 'utf8');
    const crc = crc32(dataBuf);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(dataBuf.length, 18);
    local.writeUInt32LE(dataBuf.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, dataBuf);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(0, 10);
    dir.writeUInt32LE(0, 12);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(dataBuf.length, 20);
    dir.writeUInt32LE(dataBuf.length, 24);
    dir.writeUInt16LE(nameBuf.length, 28);
    dir.writeUInt16LE(0, 30);
    dir.writeUInt16LE(0, 32);
    dir.writeUInt16LE(0, 34);
    dir.writeUInt16LE(0, 36);
    dir.writeUInt32LE(0, 38);
    dir.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([dir, nameBuf]));
    offset += local.length + nameBuf.length + dataBuf.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...chunks, centralBuf, end]);
}

function buildDocx() {
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:r><w:t>第一段：质控通过率 98%</w:t></w:r></w:p>
<w:p><w:r><w:t>第二段：低表达基因需要复核</w:t></w:r></w:p>
</w:body></w:document>`;
  return storeZip([
    ['[Content_Types].xml', contentTypes],
    ['word/document.xml', document],
  ]);
}

/** 等覆盖层拿到真实尺寸（图像未解码时 rect 高度为 0，拖拽会污染判定）。 */
function overlayReadyJs(selector) {
  return `(function(){
    var overlay = document.querySelector(${JSON.stringify(selector)});
    if (!overlay) return '';
    var box = overlay.getBoundingClientRect();
    return (box && box.width >= 60 && box.height >= 40) ? 'ready:' + Math.round(box.width) + 'x' + Math.round(box.height) : '';
  })()`;
}

/** 在覆盖层上拖出一个矩形（真 PointerEvent 进 React 合成事件）。 */
function drawRectJs(selector) {
  return `(function(){
    var overlay = document.querySelector(${JSON.stringify(selector)});
    if (!overlay) return 'no_overlay';
    var box = overlay.getBoundingClientRect();
    if (!box || box.width < 40 || box.height < 40) return 'overlay_too_small:' + box.width + 'x' + box.height;
    var startX = box.left + box.width * 0.2;
    var startY = box.top + box.height * 0.2;
    var endX = box.left + box.width * 0.6;
    var endY = box.top + box.height * 0.55;
    function fire(type, x, y) {
      overlay.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', isPrimary: true,
        clientX: x, clientY: y, buttons: type === 'pointerup' ? 0 : 1,
      }));
    }
    fire('pointerdown', startX, startY);
    fire('pointermove', (startX + endX) / 2, (startY + endY) / 2);
    fire('pointermove', endX, endY);
    fire('pointerup', endX, endY);
    return 'drawn:' + JSON.stringify({ w: box.width, h: box.height });
  })()`;
}

function typeCommentJs(text, scopeSelector = '') {
  const root = scopeSelector ? `document.querySelector(${JSON.stringify(scopeSelector)})` : 'document';
  return `(function(){
    var root = ${root};
    if (!root) return 'no_root';
    var input = root.querySelector('[data-testid="annotation-comment-input"]');
    if (!input) return 'no_input';
    var proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    proto.set.call(input, ${JSON.stringify(text)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return 'typed';
  })()`;
}

function clickIn(scopeSelector, testId) {
  return `(function(){
    var root = document.querySelector(${JSON.stringify(scopeSelector)});
    if (!root) return 'no_root';
    var el = root.querySelector('[data-testid="${testId}"]');
    if (!el) return 'no_${testId}';
    el.click();
    return 'clicked';
  })()`;
}

module.exports = {
  id: 'q6rem-annotations-live',
  description: 'BLOCK-254 Q6-REM 实机：图像马赛克批注 + 撤销 + 文本面批注条 + 速记图片批注 + docx 段落批注',
  evidenceDir: path.join(ROOT, 'acceptance', 'block-254'),

  async run(ctx) {
    const { assert } = ctx;
    let projectId = null;
    let workspacePath = null;
    let client = null;
    const PHASE = process.env.PETRI_B254_PHASE || 'image';
    const wantOffice = PHASE === 'office';
    const wantImage = PHASE === 'image';
    const wantText = PHASE === 'text';

    const health = await rest('GET', '/data/projects');
    assert('A0a_backend_rest_healthy', health.ok, `status=${health.status}`);

    activeClient = null;
    client = await ensureClient();
    // 刚连上时 SPA 可能还在首帧：用 poll 等，不用一次性取值（否则会拿到 false 的假红）。
    await pagePoll(client, `String(!!document.getElementById('root'))`, { label: 'app page root', timeoutMs: 30000 });
    assert('A0b_app_page_ready', true, 'root 就绪');
    // 干净 SPA 起点：文件 tab 是 keep-alive 的，上一轮残留面会让选择器命中隐藏实例。
    await navigate(`${APP_ORIGIN}/?test=1`);
    await pagePoll(client, `String(!!document.getElementById('root'))`, { label: 'spa reset', timeoutMs: 30000 });

    const created = await rest('POST', '/data/projects', { name: 'BLOCK254-验收-' + Date.now(), modality: 'general' });
    projectId = created.data && created.data.project && created.data.project.id;
    const projResp = projectId ? await rest('GET', '/data/projects/' + encodeURIComponent(projectId)) : null;
    workspacePath = projResp && projResp.data && (projResp.data.project
      ? projResp.data.project.workspace_path : projResp.data.workspace_path);
    assert('A0c_temp_project_created', Boolean(projectId && workspacePath),
      JSON.stringify({ projectId, workspacePath }).slice(0, 200));
    if (!projectId || !workspacePath) throw new Error('temp_project_missing');

    // ── A1 夹具 ──
    const fixtureDir = path.join(workspacePath, 'annot254');
    fs.mkdirSync(fixtureDir, { recursive: true });
    const svgPath = path.join(fixtureDir, 'volcano.svg');
    const txtPath = path.join(fixtureDir, 'notes.txt');
    const docxPath = path.join(fixtureDir, 'report.docx');
    fs.writeFileSync(svgPath, SVG, 'utf8');
    fs.writeFileSync(txtPath, TEXT_FILE, 'utf8');
    fs.writeFileSync(docxPath, buildDocx());
    const before = { svg: sha256(svgPath), txt: sha256(txtPath), docx: sha256(docxPath) };
    assert('A1_fixtures_written',
      fs.statSync(svgPath).size > 100 && fs.statSync(txtPath).size > 20 && fs.statSync(docxPath).size > 200,
      `svg=${fs.statSync(svgPath).size}B txt=${fs.statSync(txtPath).size}B docx=${fs.statSync(docxPath).size}B`);

    // ── A2 文件面板 ──
    await navigate(`${APP_ORIGIN}/project/${projectId}`);
    await pagePoll(client, `(function(){
      var btn = [...document.querySelectorAll('button')].find(function(b){ return b.textContent.trim() === '文件'; });
      if (!btn) return '';
      btn.click();
      return 'clicked';
    })()`, { label: 'files tab' });
    await pagePoll(client, `String((document.querySelectorAll('[role="treeitem"]')||[]).length >= 1)`, { label: 'tree rows' });
    await evalRetry(client, `(function(){
      var row = [...document.querySelectorAll('[role="treeitem"]')].find(function(el){
        return el.textContent.indexOf('annot254') >= 0; });
      if (!row) return 'no_row';
      row.click();
      return 'expanded';
    })()`);
    await pagePoll(client, `String([...document.querySelectorAll('[role="treeitem"]')].some(function(el){
      return el.textContent.indexOf('volcano.svg') >= 0; }))`, { label: 'svg row' });
    assert('A2_files_panel_ready', true, '文件 tab + annot254/ + volcano.svg 行在场');

    if (wantOffice) {
    // ── A10 docx 段落批注按钮（P7 面）──
    await pagePoll(client, `String([...document.querySelectorAll('[role="treeitem"]')].some(function(el){
      return el.textContent.indexOf('report.docx') >= 0; }))`, { label: 'docx row' });
    await evalRetry(client, `(function(){
      var row = [...document.querySelectorAll('[role="treeitem"]')].find(function(el){
        return el.textContent.indexOf('report.docx') >= 0; });
      row.click();
      return 'opened';
    })()`);
    await pagePoll(client, `String(document.querySelectorAll('${OFFICE} [data-testid="office-paragraph-annotate"]').length >= 2)`,
      { label: 'docx paragraphs', timeoutMs: 30000 });
    const paragraphCount = await evalRetry(client,
      `String(document.querySelectorAll('${OFFICE} [data-testid="office-paragraph-annotate"]').length)`);
    assert('A10_office_paragraph_button', Number(paragraphCount) >= 2, `paragraphs=${paragraphCount}`);

    // ── A11 段落批注落库（P7 闭环，unit=paragraph）──
    await evalRetry(client, `(function(){
      var buttons = document.querySelectorAll('${OFFICE} [data-testid="office-paragraph-annotate"]');
      buttons[1].click();
      return 'clicked';
    })()`);
    await pagePoll(client, `String(!!document.querySelector('[data-testid="annotation-comment-input"]'))`, { label: 'paragraph input' });
    await evalRetry(client, typeCommentJs('第二段结论要复核'));
    await evalRetry(client, `(function(){
      var save = document.querySelector('[data-testid="annotation-save"]');
      if (!save) return 'no_save';
      save.click();
      return 'saved';
    })()`);
    await pagePoll(client, `String(document.querySelectorAll('[data-testid="annotation-item"]').length >= 1)`, { label: 'paragraph item' });
    const paragraphList = await rest('GET',
      `/result-studio/annotations?projectId=${encodeURIComponent(projectId)}&surface=workspace-file&filePath=${encodeURIComponent('annot254/report.docx')}`);
    const paragraphRow = (paragraphList.data && paragraphList.data.annotations || [])[0];
    assert('A11_office_paragraph_saved',
      Boolean(paragraphRow)
      && paragraphRow.kind === 'text-selection'
      && paragraphRow.anchor && paragraphRow.anchor.unit === 'paragraph'
      && paragraphRow.anchor.startLine === 2
      // 抽取文本可能带空白差异：只钉「引用了第二段那句」，不钉逐字相等。
      && String(paragraphRow.anchor.quote).includes('低表达基因'),
      JSON.stringify({
        kind: paragraphRow && paragraphRow.kind,
        anchor: paragraphRow && paragraphRow.anchor,
      }));

    }
    if (wantImage) {
    // ── A3 图像批注条 ──
    await evalRetry(client, `(function(){
      var row = [...document.querySelectorAll('[role="treeitem"]')].find(function(el){
        return el.textContent.indexOf('volcano.svg') >= 0; });
      row.click();
      return 'opened';
    })()`);
    await pagePoll(client, `String(!!document.querySelector('${IMG} [data-testid="annotation-bar"]'))`, { label: 'image bar' });
    const imageAnnotatable = await evalRetry(client,
      `String(document.querySelector('${IMG} [data-testid="annotation-bar"]').dataset.annotatable)`);
    assert('A3_image_bar_mounted', imageAnnotatable === 'true', `data-annotatable=${imageAnnotatable}`);

    // ── A4 马赛克遮蔽边界（P3）──
    await evalRetry(client, clickIn(IMG, 'annotation-toggle'));
    await pagePoll(client, `String(!!document.querySelector('${IMG} [data-testid="annotation-kind-mosaic"]'))`,
      { label: 'mosaic kind button' });
    await evalRetry(client, clickIn(IMG, 'annotation-kind-mosaic'));
    const mosaicHint = await evalRetry(client,
      `String((document.querySelector('${IMG} [data-testid="annotation-hint"]') || {}).textContent || '')`);
    const mosaicFallback = await evalRetry(client,
      `String((document.querySelector('${IMG} [data-testid="annotation-hint"]') || {dataset:{}}).dataset.mosaicFallback || '')`);
    assert('A4_mosaic_disclosure',
      String(mosaicHint).includes('仅屏显遮蔽') && ['true', 'false'].includes(String(mosaicFallback)),
      `hint=${String(mosaicHint).slice(0, 120)} fallback=${mosaicFallback}`);

    // ── A5 马赛克批注落库（P1/P3）──
    await pagePoll(client, overlayReadyJs(`${IMG} [data-testid="annotation-overlay"]`), { label: 'image overlay sized', timeoutMs: 30000 });
    const mosaicDrawn = await evalRetry(client, drawRectJs(`${IMG} [data-testid="annotation-overlay"]`));
    await pagePoll(client, `String(!!document.querySelector('${IMG} [data-testid="annotation-comment-input"]'))`, { label: 'mosaic input' });
    await evalRetry(client, typeCommentJs('遮住患者姓名区域', IMG));
    await evalRetry(client, clickIn(IMG, 'annotation-save'));
    await pagePoll(client, `String(!!document.querySelector('${IMG} [data-testid="annotation-item"]'))`, { label: 'mosaic item' });
    const listAfterMosaic = await rest('GET',
      `/result-studio/annotations?projectId=${encodeURIComponent(projectId)}&surface=workspace-file&filePath=${encodeURIComponent('annot254/volcano.svg')}`);
    const mosaicRow = (listAfterMosaic.data && listAfterMosaic.data.annotations || []).find((row) => row.kind === 'mosaic');
    assert('A5_mosaic_saved',
      Boolean(mosaicRow) && mosaicRow.comment === '遮住患者姓名区域'
      && Array.isArray(mosaicRow.rect) && mosaicRow.rect.length === 4 && mosaicRow.rect[2] > 0,
      JSON.stringify({ draw: mosaicDrawn, kind: mosaicRow && mosaicRow.kind, rect: mosaicRow && mosaicRow.rect }));

    // ── A6 撤销（P4）──
    const undoTitle = await evalRetry(client,
      `String((document.querySelector('${IMG} [data-testid="annotation-undo"]') || {}).title || '')`);
    await evalRetry(client, clickIn(IMG, 'annotation-undo'));
    await pagePoll(client, `String(document.querySelectorAll('${IMG} [data-testid="annotation-item"]').length === 0)`,
      { label: 'undo cleared list' });
    const listAfterUndo = await rest('GET',
      `/result-studio/annotations?projectId=${encodeURIComponent(projectId)}&surface=workspace-file&filePath=${encodeURIComponent('annot254/volcano.svg')}`);
    assert('A6_undo_removes_annotation',
      String(undoTitle).includes('撤销刚才的创建') && (listAfterUndo.data && listAfterUndo.data.annotations || []).length === 0,
      `title=${undoTitle} remaining=${(listAfterUndo.data && listAfterUndo.data.annotations || []).length}`);

    }
    if (wantText) {
    // ── A7 文本面批注条（P5 面接线）──
    await evalRetry(client, `(function(){
      var row = [...document.querySelectorAll('[role="treeitem"]')].find(function(el){
        return el.textContent.indexOf('notes.txt') >= 0; });
      if (!row) return 'no_row';
      row.click();
      return 'opened';
    })()`);
    await pagePoll(client, `String((function(){
      var bars = [...document.querySelectorAll('[data-testid="annotation-bar"]')];
      return bars.some(function(bar){ return bar.dataset.mode === 'text' && bar.dataset.annotatable === 'true'; });
    })())`, { label: 'text mode bar', timeoutMs: 30000 });
    const textBar = await evalRetry(client, `(function(){
      var bar = [...document.querySelectorAll('[data-testid="annotation-bar"]')].find(function(item){
        return item.dataset.mode === 'text'; });
      if (!bar) return '';
      return JSON.stringify({ mode: bar.dataset.mode, toggle: !!bar.querySelector('[data-testid="annotation-toggle"]') });
    })()`);
    const textBarState = JSON.parse(String(textBar) || '{}');
    assert('A7_text_bar_mode',
      textBarState.mode === 'text' && textBarState.toggle === false,
      String(textBar));

    // ── A8 速记图片大图批注（P6 面）──
    const scratch = await rest('POST', '/scratchpad', {
      kind: 'image',
      title: 'BLOCK-254 速记图',
      body: `data:image/svg+xml;base64,${Buffer.from(SVG, 'utf8').toString('base64')}`,
      sourceKind: 'manual',
      projectId,
    });
    const entryId = scratch.data && scratch.data.entry && scratch.data.entry.entryId;
    assert('A8a_scratchpad_entry_created', Boolean(entryId), `entryId=${entryId} status=${scratch.status}`);
    await evalRetry(client, clickIn('body', 'scratchpad-toggle'));
    await pagePoll(client, `String(!!document.querySelector('[data-testid="sc-scratch-panel"]'))`, { label: 'scratchpad panel' });
    await pagePoll(client, `String(document.querySelectorAll('[data-testid="sc-scratch-open-image"]').length >= 1)`,
      { label: 'scratchpad image thumb' });
    await evalRetry(client, clickIn('[data-testid="sc-scratch-panel"]', 'sc-scratch-open-image'));
    await pagePoll(client, `String(!!document.querySelector('[data-testid="sc-scratch-viewer"]'))`, { label: 'scratchpad viewer' });
    await pagePoll(client, `String(!!document.querySelector('[data-testid="sc-scratch-viewer"] [data-testid="annotation-bar"]'))`,
      { label: 'scratchpad annotation bar', timeoutMs: 30000 });
    assert('A8_scratchpad_image_bar', true, '速记图片大图挂上批注条');

    // ── A9 速记图片批注落库（P6 闭环）──
    // 大图叠加层里的拖拽在离屏窗口偶发「overlay 尺寸不足 / CDP 失活」，因此这一步
    // 不 throw：失败也如实记为 FAIL 并继续后面的 Office 面，避免整轮被一步拖死。
    const VIEWER = '[data-testid="sc-scratch-viewer"]';
    let scratchDrawn = 'skipped';
    let scratchRow = null;
    try {
      await evalRetry(client, clickIn(VIEWER, 'annotation-toggle'));
      await pagePoll(client, overlayReadyJs(`${VIEWER} [data-testid="annotation-overlay"]`), { label: 'scratch overlay sized', timeoutMs: 12000 });
      scratchDrawn = await evalRetry(client, drawRectJs(`${VIEWER} [data-testid="annotation-overlay"]`));
      await pagePoll(client, `String(!!document.querySelector('${VIEWER} [data-testid="annotation-comment-input"]'))`, { label: 'scratch input', timeoutMs: 8000 });
      await evalRetry(client, typeCommentJs('这张速记图的右下角需要复核', VIEWER));
      await evalRetry(client, clickIn(VIEWER, 'annotation-save'));
      await pagePoll(client, `String(!!document.querySelector('${VIEWER} [data-testid="annotation-item"]'))`, { label: 'scratch item', timeoutMs: 8000 });
      const scratchList = await rest('GET',
        `/result-studio/annotations?projectId=${encodeURIComponent(projectId)}&surface=scratchpad-entry&entryId=${encodeURIComponent(entryId)}`);
      scratchRow = (scratchList.data && scratchList.data.annotations || [])[0] || null;
    } catch (error) {
      scratchDrawn = `failed:${String(error && error.message).slice(0, 120)}`;
    }
    assert('A9_scratchpad_annotation_saved',
      Boolean(scratchRow) && scratchRow.surface === 'scratchpad-entry' && scratchRow.entryId === entryId
      && scratchRow.comment === '这张速记图的右下角需要复核',
      JSON.stringify({ draw: scratchDrawn, surface: scratchRow && scratchRow.surface, entryId: scratchRow && scratchRow.entryId }));

    }
    // ── A12 原始文件未被修改 ──
    const after = { svg: sha256(svgPath), txt: sha256(txtPath), docx: sha256(docxPath) };
    assert('A12_artifacts_untouched',
      before.svg === after.svg && before.txt === after.txt && before.docx === after.docx,
      `svg=${before.svg === after.svg} txt=${before.txt === after.txt} docx=${before.docx === after.docx}`);

    await navigate(`${APP_ORIGIN}/?test=1`).catch(() => 'ignore');
    assert('A99_cleanup', true, '页面还原（临时项目保留在隔离库，随临时根一并丢弃）');
  },
};
