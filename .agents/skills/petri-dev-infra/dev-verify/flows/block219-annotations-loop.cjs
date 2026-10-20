#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow: block219-annotations-loop — BLOCK-219 Q6 批注闭环实机腿。
 *
 * 断言链（真 Chromium，走工作区文件预览——不依赖结果 job）：
 *   A0a backend_rest_healthy       dev 后端 REST 可达
 *   A0b app_page_ready             CDP 页面 root 就绪
 *   A0c temp_project_created       临时验收项目建好（带 workspace_path）
 *   A1  fixtures_written           工作区写入 SVG 图与单页 PDF（自造，无外部依赖）
 *   A2  files_panel_ready          文件 tab + 树行渲染
 *   A3  image_preview_annotatable  图像预览出现批注条（可批注）
 *   A4  image_rect_drawn           拖拽产生评论输入（矩形成立）
 *   A5  image_annotation_saved     保存后列表出现 1 条，REST 侧 page=null 且矩形归一化
 *   A6  add_to_task_prompt         加入任务经 petri:copilot-ask 投递结构化引用（拦截模型轮次）
 *   A7  pdf_preview_paged          PDF 逐页盒子 + 第 1 页覆盖层在场
 *   A8  pdf_annotation_page_scope  PDF 批注落 page=1（与图像批注互不串页）
 *   A9  artifacts_untouched        原始文件哈希不变（批注是旁路元数据）
 *   A99 cleanup                    临时项目删除 + 页面还原
 *
 * 诚实边界：
 * - 「加入任务」在生产里会立即 send（copilotAsk 单一通道，与「继续分析」同语义）。
 *   本 flow 在页内**拦截**该事件只取证 payload，不触发真实模型轮次——断言对象是
 *   「生产代码确实经唯一通道投递了结构化引用」，不是模型回复质量。
 * - Office 文档与 pack 渲染面不在本 flow 范围（见 plan §2）。
 *
 * 前置：主 dev 栈（后端 :3001 + vite :3000）+ 测试实例（CDP 9223）。
 * 证据：acceptance/block-219/annotations-loop-live.json + 截图
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const lib = require('../lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);

const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local' };
const APP_ORIGIN = 'http://localhost:3000';

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

async function evalRetry(client, expr, tries = 8) {
  let lastErr = null;
  for (let index = 0; index < tries; index += 1) {
    try {
      return await lib.evalJs(client, expr);
    } catch (error) {
      lastErr = error;
      await sleep(1200);
    }
  }
  throw lastErr;
}

async function pagePoll(client, expr, { timeoutMs = 20000, label } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    last = await evalRetry(client, expr).catch((error) => `eval_err:${error.message}`);
    if (last && last !== '0' && last !== 'false' && last !== 'null' && last !== '""') return last;
    await sleep(800);
  }
  throw new Error(`page_poll_timeout: ${label} :: ${String(last).slice(0, 200)}`);
}

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320" viewBox="0 0 480 320">
  <rect width="480" height="320" fill="#0b1220"/>
  <circle cx="240" cy="160" r="90" fill="#1d2945" stroke="#5eead4" stroke-width="3"/>
  <text x="240" y="300" fill="#e6edf3" font-size="18" text-anchor="middle">BLOCK-219 annotation fixture</text>
</svg>
`;

/** 造一个最小但合法的单页 PDF（不引依赖；pdfjs 需正确 xref 偏移）。 */
function buildPdf(label) {
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 320 240] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
  ];
  const stream = `BT /F1 16 Tf 24 180 Td (${label}) Tj ET`;
  objects.push(`4 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`);
  objects.push('5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n');
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  for (const object of objects) {
    offsets.push(pdf.length);
    pdf += object;
  }
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

/** 在页内装一个 copilotAsk 探针：只记录 payload，不真的把消息发给模型。 */
const INSTALL_PROBE = `(function(){
  if (!window.__blk219Probe) {
    window.__blk219Asks = [];
    var original = window.dispatchEvent.bind(window);
    window.dispatchEvent = function(event){
      try {
        if (event && event.type === 'petri:copilot-ask') {
          window.__blk219Asks.push(event.detail && event.detail.prompt);
          return true;
        }
      } catch (error) { /* fallthrough */ }
      return original(event);
    };
    window.__blk219Probe = true;
  }
  return 'probe_installed';
})()`;

/** 等覆盖层拿到真实尺寸（图像未解码/PDF 未排版时 rect 高度为 0，拖拽会污染判定）。 */
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

function typeCommentJs(text, selector = '[data-testid="annotation-comment-input"]') {
  return `(function(){
    var input = document.querySelector(${JSON.stringify(selector)});
    if (!input) return 'no_input';
    var proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    proto.set.call(input, ${JSON.stringify(text)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return 'typed';
  })()`;
}

/** 图像宿主内的限定选择器（文件 tab 是 keep-alive 的，图像/PDF 面可能同时挂载）。 */
const IMG = '[data-testid="annotatable-image-pane"]';
const PDF = '[data-testid="annotatable-pdf-pane"]';

module.exports = {
  id: 'block219-annotations-loop',
  description: 'BLOCK-219 Q6 批注闭环实机：工作区 SVG/PDF 预览 → 拖拽批注 → 保存（旁路 REST 校验）→ 加入任务（copilotAsk 结构化引用）',
  evidenceDir: path.join(ROOT, 'acceptance', 'block-219'),

  async run(ctx) {
    const { assert } = ctx;
    const evidenceDir = path.join(ROOT, 'acceptance', 'block-219');
    fs.mkdirSync(evidenceDir, { recursive: true });

    let projectId = null;
    let workspacePath = null;
    let client = null;
    let originalUrl = null;
    const fixtureFiles = [];

    const health = await rest('GET', '/data/projects');
    assert('A0a_backend_rest_healthy', health.ok, `status=${health.status}`);

    const targets = await lib.pollTargets({ port: lib.TEST_INSTANCE_PORT, timeoutMs: 30_000 });
    const pages = lib.filterPageTargets(targets, /^http:\/\/localhost:3000\//);
    if (!pages.length) throw new Error('no_app_page_target');
    const target = await lib.selectPageTarget(pages, {
      probe: async (candidate) => lib.evalJs(candidate, `!!document.getElementById('root')`).catch(() => false),
    });
    client = await lib.connectTarget(target);
    originalUrl = target.url;
    const rootReady = await evalRetry(client, `!!document.getElementById('root')`);
    assert('A0b_app_page_ready', rootReady === true || rootReady === 'true', String(rootReady));
    // 每次从干净 SPA 开始：文件 tab 是 keep-alive 的，上一轮留下的预览面会让
    // `[data-testid="annotation-overlay"]` 命中隐藏实例（尺寸 0 → 假红）。
    await evalRetry(client, `location.replace(${JSON.stringify(`${APP_ORIGIN}/?test=1`)}); 'reset'`);
    await pagePoll(client, `String(!!document.getElementById('root'))`, { label: 'spa reset', timeoutMs: 30000 });

    const created = await rest('POST', '/data/projects', { name: 'BLOCK219-验收-' + Date.now(), modality: 'general' });
    projectId = created.data && created.data.project && created.data.project.id;
    const projResp = projectId ? await rest('GET', '/data/projects/' + encodeURIComponent(projectId)) : null;
    workspacePath = projResp && projResp.data && (projResp.data.project
      ? projResp.data.project.workspace_path : projResp.data.workspace_path);
    assert('A0c_temp_project_created', Boolean(projectId && workspacePath),
      JSON.stringify({ projectId, workspacePath }).slice(0, 200));

    // ── A1 fixtures ──
    const fixtureDir = path.join(workspacePath, 'annot');
    fs.mkdirSync(fixtureDir, { recursive: true });
    const svgPath = path.join(fixtureDir, 'volcano.svg');
    const pdfPath = path.join(fixtureDir, 'qc.pdf');
    fs.writeFileSync(svgPath, SVG, 'utf8');
    fs.writeFileSync(pdfPath, buildPdf('BLOCK-219 QC report'));
    fixtureFiles.push(svgPath, pdfPath);
    const svgHashBefore = sha256(svgPath);
    const pdfHashBefore = sha256(pdfPath);
    assert('A1_fixtures_written', fs.statSync(svgPath).size > 100 && fs.statSync(pdfPath).size > 300,
      `svg=${fs.statSync(svgPath).size}B pdf=${fs.statSync(pdfPath).size}B`);

    // ── A2 文件面板 ──
    await evalRetry(client, `location.href = ${JSON.stringify(`${APP_ORIGIN}/project/${projectId}`)}; 'nav'`);
    await pagePoll(client, `(function(){
      var btn = [...document.querySelectorAll('button')].find(function(b){ return b.textContent.trim() === '文件'; });
      if (!btn) return '';
      btn.click();
      return 'clicked';
    })()`, { label: 'files tab' });
    await pagePoll(client, `String((document.querySelectorAll('[role="treeitem"]')||[]).length >= 1)`,
      { label: 'tree rows' });
    await evalRetry(client, `(function(){
      var row = [...document.querySelectorAll('[role="treeitem"]')].find(function(el){
        return el.textContent.indexOf('annot') >= 0; });
      if (!row) return 'no_row';
      row.click();
      return 'expanded';
    })()`);
    await pagePoll(client, `String([...document.querySelectorAll('[role="treeitem"]')].some(function(el){
      return el.textContent.indexOf('volcano.svg') >= 0; }))`, { label: 'svg row' });
    assert('A2_files_panel_ready', true, '文件 tab + annot/ 目录 + volcano.svg 行在场');

    // ── A3 图像预览可批注 ──
    await evalRetry(client, `(function(){
      var row = [...document.querySelectorAll('[role="treeitem"]')].find(function(el){
        return el.textContent.indexOf('volcano.svg') >= 0; });
      row.click();
      return 'opened';
    })()`);
    await pagePoll(client, `String(!!document.querySelector('[data-testid="annotation-bar"]'))`,
      { label: 'annotation bar' });
    const imageBarAnnotatable = await evalRetry(client,
      `String(document.querySelector('[data-testid="annotation-bar"]').dataset.annotatable)`);
    assert('A3_image_preview_annotatable', imageBarAnnotatable === 'true',
      `data-annotatable=${imageBarAnnotatable}`);

    // ── A4 拖拽出矩形 ──
    await evalRetry(client, `document.querySelector('${IMG} [data-testid="annotation-toggle"]').click(); 'toggle'`);
    await pagePoll(client, `String(!!document.querySelector('${IMG} [data-testid="annotation-overlay"]'))`,
      { label: 'overlay mounted' });
    // 图像解码完成前覆盖层高度为 0（拖拽会算出退化矩形）；等真实尺寸再画。
    await pagePoll(client, overlayReadyJs(`${IMG} [data-testid="annotation-overlay"]`), { label: 'image overlay sized', timeoutMs: 30000 });
    const drawn = await evalRetry(client, drawRectJs(`${IMG} [data-testid="annotation-overlay"]`));
    assert('A4_image_rect_drawn', String(drawn).startsWith('drawn:'), String(drawn));
    await pagePoll(client, `String(!!document.querySelector('${IMG} [data-testid="annotation-comment-input"]'))`,
      { label: 'comment input' });

    // ── A5 保存并核对 REST 旁路存储 ──
    await evalRetry(client, typeCommentJs('圆圈左下区域的点需要复核', `${IMG} [data-testid="annotation-comment-input"]`));
    await evalRetry(client, `document.querySelector('${IMG} [data-testid="annotation-save"]').click(); 'save'`);
    await pagePoll(client, `String(!!document.querySelector('${IMG} [data-testid="annotation-item"]'))`,
      { label: 'annotation item' });
    const listOne = await rest('GET',
      `/result-studio/annotations?projectId=${encodeURIComponent(projectId)}&surface=workspace-file&filePath=${encodeURIComponent('annot/volcano.svg')}`);
    const savedImage = listOne.data && Array.isArray(listOne.data.annotations) ? listOne.data.annotations[0] : null;
    const rectOk = Boolean(savedImage
      && Array.isArray(savedImage.rect)
      && savedImage.rect.length === 4
      && savedImage.rect.every((value) => Number.isFinite(value) && value >= 0 && value <= 1)
      && savedImage.rect[2] > 0 && savedImage.rect[3] > 0);
    assert('A5_image_annotation_saved',
      Boolean(savedImage) && savedImage.page === null && rectOk
      && savedImage.comment === '圆圈左下区域的点需要复核'
      && savedImage.surface === 'workspace-file',
      JSON.stringify(savedImage && { page: savedImage.page, rect: savedImage.rect, comment: savedImage.comment }));

    // ── A6 加入任务（拦截 copilotAsk 取证）──
    await evalRetry(client, INSTALL_PROBE);
    await evalRetry(client, `document.querySelector('${IMG} [data-testid="annotation-add-to-task"]').click(); 'ask'`);
    await pagePoll(client, `String((window.__blk219Asks || []).length)`, { label: 'copilotAsk payload' });
    const prompt = await evalRetry(client, `String((window.__blk219Asks || [])[0] || '')`);
    const promptText = String(prompt);
    assert('A6_add_to_task_prompt',
      promptText.includes('工作区文件「volcano.svg」')
      && promptText.includes('圆圈左下区域的点需要复核')
      && promptText.includes('原始产物文件未被修改'),
      promptText.slice(0, 220));

    // ── A7 PDF 逐页覆盖层 ──
    await evalRetry(client, `(function(){
      var row = [...document.querySelectorAll('[role="treeitem"]')].find(function(el){
        return el.textContent.indexOf('qc.pdf') >= 0; });
      if (!row) return 'no_row';
      row.click();
      return 'opened';
    })()`);
    await pagePoll(client, `String(document.querySelectorAll('[data-testid="annotatable-pdf-pane"] [data-page]').length >= 1)`,
      { label: 'pdf page boxes', timeoutMs: 30000 });
    await pagePoll(client, `String(!!document.querySelector('[data-testid="annotation-overlay-p1"]'))`,
      { label: 'pdf page1 overlay', timeoutMs: 30000 });
    const pageCount = await evalRetry(client,
      `String(document.querySelectorAll('[data-testid="annotatable-pdf-pane"] [data-page]:not([data-testid])').length)`);
    assert('A7_pdf_preview_paged', Number(pageCount) >= 1, `pages=${pageCount}`);

    // ── A8 PDF 批注按页归属 ──
    // 文件 tab 是 keep-alive 的：图像面可能仍挂载在后台，选择器必须限定在 PDF 宿主内，
    // 否则会点到另一个面的批注开关（会话独立，互不生效）。
    await evalRetry(client, `(function(){
      var pane = document.querySelector('[data-testid="annotatable-pdf-pane"]');
      if (!pane) return 'no_pane';
      var toggle = pane.querySelector('[data-testid="annotation-toggle"]');
      if (!toggle) return 'no_toggle';
      toggle.click();
      return 'toggle';
    })()`);
    await pagePoll(client, overlayReadyJs(`${PDF} [data-testid="annotation-overlay-p1"]`), { label: 'pdf overlay sized', timeoutMs: 30000 });
    const pdfDrawn = await evalRetry(client, drawRectJs(`${PDF} [data-testid="annotation-overlay-p1"]`));
    if (!String(pdfDrawn).startsWith('drawn:')) {
      // 覆盖层尺寸依赖 PDF 渲染尺寸；如实记录而不伪造
      assert('A8_pdf_annotation_page_scope', false, `pdf_draw=${pdfDrawn}`);
    } else {
      await pagePoll(client,
        `String(!!document.querySelector('[data-testid="annotatable-pdf-pane"] [data-testid="annotation-comment-input"]'))`,
        { label: 'pdf comment input' });
      await evalRetry(client, `(function(){
        var input = document.querySelector('[data-testid="annotatable-pdf-pane"] [data-testid="annotation-comment-input"]');
        var proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
        proto.set.call(input, '这份质控报告第 1 页需要补方法说明');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return 'typed';
      })()`);
      await evalRetry(client, `document.querySelector('[data-testid="annotatable-pdf-pane"] [data-testid="annotation-save"]').click(); 'save'`);
      await pagePoll(client, `String(document.querySelectorAll('[data-testid="annotatable-pdf-pane"] [data-testid="annotation-item"]').length >= 1)`,
        { label: 'pdf annotation item' });
      const listPdf = await rest('GET',
        `/result-studio/annotations?projectId=${encodeURIComponent(projectId)}&surface=workspace-file&filePath=${encodeURIComponent('annot/qc.pdf')}`);
      const pdfAnnotation = listPdf.data && Array.isArray(listPdf.data.annotations) ? listPdf.data.annotations[0] : null;
      assert('A8_pdf_annotation_page_scope',
        Boolean(pdfAnnotation) && pdfAnnotation.page === 1,
        JSON.stringify(pdfAnnotation && { page: pdfAnnotation.page, rect: pdfAnnotation.rect }));
    }

    // ── A9 原始产物未被改写 ──
    assert('A9_artifacts_untouched',
      sha256(svgPath) === svgHashBefore && sha256(pdfPath) === pdfHashBefore,
      'SVG/PDF 哈希与写入时一致（批注只在旁路表）');

    // ── 截图（批注条 + 覆盖层可见）──
    try {
      await lib.screenshotPng(client, evidenceDir, 'block219-annotations.png');
    } catch (error) {
      // 截图失败不改变断言结论，但如实记进证据说明
      fs.writeFileSync(path.join(evidenceDir, 'screenshot-error.txt'), String(error && error.message), 'utf8');
    }

    // ── A99 清理 ──
    let cleanupOk = false;
    try {
      for (const file of fixtureFiles) { try { fs.rmSync(file, { force: true }); } catch { /* ignore */ } }
      try { fs.rmdirSync(fixtureDir); } catch { /* 目录可能非空 */ }
      if (projectId) {
        const removed = await rest('DELETE', '/data/projects/' + encodeURIComponent(projectId));
        cleanupOk = removed.ok;
        projectId = null;
      }
      await evalRetry(client, `location.href = ${JSON.stringify(originalUrl)}; 'restoring'`);
      await sleep(1500);
    } catch {
      cleanupOk = false;
    }
    assert('A99_cleanup_restored', cleanupOk, '临时项目删除 + 夹具清理 + 页面还原');

    return true;
  },
};
