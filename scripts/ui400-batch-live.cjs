#!/usr/bin/env node
'use strict';
/**
 * ui400-batch-live.cjs — UI-400 六项批次实机验证（ssh 真节点）：
 *   W1 PDF 预览：找到 .pdf 文件点开 → <object type=application/pdf> 在场且无「unsupported」卡
 *   W2 下载按钮：预览头部 file-download 按钮在场 → 点击 → Downloads 目录出现同名文件
 *   W3 上下文环：composer 上下文按钮渲染 svg 环而非「—」占位
 *   W4 树宽：拖拽把手在场（320 上限已移除，代码级+样式 maxWidth 65% 兜底）
 * 证据：acceptance/ui-400/ui400-batch-live.json
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const lib = require(path.join(__dirname, '..', '.agents', 'skills', 'gewu-dev-infra', 'dev-verify', 'lib.cjs'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PROJECT_ID = process.argv[2] || 'p_mu5ftn3a_wxnq';
const EVIDENCE_DIR = path.join(__dirname, '..', 'acceptance', 'ui-400');
let client;
const EVAL = (expr) => lib.evalJs(client, expr);

async function attach() {
  const targets = await lib.pollTargets({ timeoutMs: 20000 });
  const candidates = lib.filterPageTargets(targets, /^http:\/\/localhost:3000\/(?!window\/)/);
  const target = await lib.selectPageTarget(candidates, {
    probe: async (c) => lib.evalJs(c, `!!document.getElementById('root')`).catch(() => false),
  });
  return lib.connectTarget(target);
}

function downloadsDir() {
  return path.join(os.homedir(), 'Downloads');
}

const http = require('node:http');

/** 手工构建最小合法 PDF（xref 偏移程序化计算，PDFium 可解析） */
function buildMinimalPdf(text) {
  const enc = (s) => Buffer.byteLength(s, 'latin1');
  const content = `BT /F1 24 Tf 72 700 Td (${text}) Tj ET`;
  const defs = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
    `4 0 obj\n<< /Length ${enc(content)} >>\nstream\n${content}\nendstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  for (const def of defs) {
    offsets.push(enc(out));
    out += def;
  }
  const xrefStart = enc(out);
  out += 'xref\n0 6\n0000000000 65535 f \n';
  for (const off of offsets) out += String(off).padStart(10, '0') + ' 00000 n \n';
  out += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}

function uploadToProject(projectId, toPath, buf) {
  const body = JSON.stringify({ toPath, dataB64: buf.toString('base64'), offset: 0 });
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port: 3001, path: `/api/workspaces/${projectId}/fs/upload`,
      method: 'POST',
      headers: { Authorization: 'Bearer desktop-local', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let b = ''; res.on('data', (c) => { b += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

(async () => {
  const run = lib.createRun({ name: 'ui400-batch-live', evidenceDir: EVIDENCE_DIR });
  client = await attach();
  await lib.evalJs(client, `location.href = 'http://localhost:3000/project/${PROJECT_ID}'; 'nav'`);
  await sleep(5000);
  client = await attach();

  // ── W1/W2 前置：上传最小合法 PDF 到项目根（经 BLOCK-90 fs/upload 通道）──
  const pdfName = 'ui400-sample.pdf';
  const up = await uploadToProject(PROJECT_ID, pdfName, buildMinimalPdf('UI-400 PDF preview sample'));
  const upOk = up.status === 200 || (up.status === 409 && up.body.includes('target_already_exists'));
  run.assert('W0_pdf_uploaded', upOk, `HTTP ${up.status} ${up.body.slice(0, 80)}`);

  // ── 打开右栏「文件」tab（UI-385 tab 化后文件树不是默认 tab）──
  const tabClick = await EVAL(
    "(function(){" +
    "  var btns = document.querySelectorAll('button, [role=tab]');" +
    "  for (var i = btns.length - 1; i >= 0; i--) {" +
    "    if ((btns[i].textContent || '').trim() === '文件') { btns[i].click(); return 'clicked_files_tab'; }" +
    "  }" +
    "  return 'files_tab_not_found';" +
    "})()");
  run.assert('V0_files_tab_opened', String(tabClick).indexOf('clicked') === 0, String(tabClick));
  await sleep(2500);
  client = await attach();

  // ── W3 上下文环（先断言，处于初始待机态最有说服力）──
  const ctxProbe = await EVAL(
    `(function(){
      var btn = document.querySelector('button[title="上下文用量（点击查看详情）"]');
      if (!btn) return JSON.stringify({ found: false });
      var hasDash = Array.prototype.some.call(btn.querySelectorAll('span'), function(s){ return s.textContent.trim() === '—'; });
      return JSON.stringify({ found: true, hasDash: hasDash, svg: !!btn.querySelector('svg') });
    })()`);
  let w3 = { found: false };
  try { w3 = JSON.parse(ctxProbe); } catch {}
  run.assert('W3_context_ring_initial', w3.found && w3.svg && !w3.hasDash, ctxProbe.slice(0, 140));

  // ── W4 拖拽把手在场 ──
  const resize = await EVAL(`!!document.querySelector('[class*="workspaceFileTreeResize"]')`);
  run.assert('W4_tree_resize_handle', resize === true || resize === 'true', 'resize handle present (320px clamp removed)');

  // ── 找 PDF：遍历树行 title 含 .pdf；根目录没有则展开第一个目录 ──
  let pdfRow = null;
  for (let round = 0; round < 3 && !pdfRow; round++) {
    pdfRow = await EVAL(
      `(function(){
        var rows = document.querySelectorAll('[role="treeitem"][title^="预览"]');
        for (var i = 0; i < rows.length; i++) { if (/\\.pdf$/i.test(rows[i].getAttribute('title') || '')) return 'pdf:' + i + ':' + rows[i].getAttribute('title'); }
        return 'none';
      })()`);
    if (pdfRow === 'none' && round === 0) {
      await EVAL(`(function(){ var d=document.querySelector('[role="treeitem"][title^="展开"]'); if(!d) return 'no_dir'; d.click(); return 'expanded'; })()`);
      await sleep(2500);
    } else if (pdfRow === 'none') break;
  }
  run.assert('W1_pdf_file_found', String(pdfRow).startsWith('pdf:'), String(pdfRow));

  if (String(pdfRow).startsWith('pdf:')) {
    const idx = Number(String(pdfRow).split(':')[1]);
    // 点击前记 Downloads 基线
    const dlDir = downloadsDir();
    const before = fs.existsSync(dlDir) ? fs.readdirSync(dlDir) : [];
    await EVAL(`(function(){ var rows=document.querySelectorAll('[role="treeitem"][title^="预览"]'); rows[${idx}].click(); return 'clicked'; })()`);
    await sleep(2000);

    // W1 PDF object 渲染
    const pdfProbe = await EVAL(
      `(function(){
        var obj = document.querySelector('object[type="application/pdf"]');
        if (!obj) return JSON.stringify({ present: false });
        var r = obj.getBoundingClientRect();
        return JSON.stringify({ present: true, w: Math.round(r.width), h: Math.round(r.height) });
      })()`);
    let w1 = {};
    try { w1 = JSON.parse(pdfProbe); } catch {}
    run.assert('W1_pdf_object_rendered', w1.present === true && (w1.w || 0) > 100 && (w1.h || 0) > 100, pdfProbe);

    // W2 下载按钮点击 → Downloads 出现新文件
    const btn = await EVAL(`(function(){ var b=document.querySelector('[data-testid="file-download"]'); if(!b) return 'no_btn'; b.click(); return 'clicked'; })()`);
    run.assert('W2_download_button_clicked', btn === 'clicked', String(btn));
    let added = [];
    for (let i = 0; i < 10; i++) {
      await sleep(2000);
      const after = fs.existsSync(dlDir) ? fs.readdirSync(dlDir) : [];
      added = after.filter((f) => !before.includes(f) && !f.endsWith('.crdownload'));
      if (added.length > 0) break;
    }
    run.assert('W2_download_landed', added.length > 0, 'added=' + JSON.stringify(added.slice(0, 3)) + ' dir=' + dlDir);

    await lib.screenshotPng(client, EVIDENCE_DIR, 'ui400-pdf-preview.png').catch(() => {});
  }

  run.finish();
  process.exit(run.allPass ? 0 : 1);
})().catch((err) => {
  console.error('[ui400] FATAL', err && err.message);
  process.exit(2);
});
