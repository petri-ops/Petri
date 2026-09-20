#!/usr/bin/env node
'use strict';
/**
 * block94-knowledge-live.cjs — BLOCK-94 P6 整包实机验收（dev 栈 + 真实嵌入/真实模型轮次）：
 *   A1 总览新契约字段（documentsTotal/scale/staleEmbedding/documentsHasMore）；
 *   A2 空间启用；
 *   A3 文本上传 → 真实 DashScope 嵌入摄取 ready；
 *   A4 最小合法 PDF 上传 → ready 且 kind=pdf（F2 解析器真跑）；
 *   A5 粘贴文本入库 → ready（F3）；
 *   A6 真实检索：向量+全文双通道命中（embeddingAvailable=true）；
 *   A7 docId 过滤只命中目标文档（F5）；
 *   A8 纯符号查询 ftsDegraded 诚实标注（F5）；
 *   A9 文档预览：分块全文 + rawAvailable（F4）；
 *   A10 批量删除（F4）+ 不支持格式逐文件拒绝（F3 聚合前置）；
 *   A11 真实模型轮次（POST /api/ai/agent 建任务）→ task 事件流含 knowledge_citations
 *       且携带知识文档名（F5 溯源端到端）；
 *   V1 CDP：/knowledge 页 knowledge-panel 渲染 + 截图；
 *   V2 CDP：项目工作台摘要卡「知识溯源」节在真轮次后可见。
 * 前置：dev 栈（vite 3000 + 后端 3001 + CDP 9222）+ DashScope 凭据 + 至少一个项目。
 * 证据：acceptance/block-94/block94-knowledge-live.json + 截图。
 */
const path = require('node:path');
const http = require('node:http');
const lib = require(path.join(__dirname, '..', '.agents', 'skills', 'gewu-dev-infra', 'dev-verify', 'lib.cjs'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const API = 'http://127.0.0.1:3001';
const AUTH = { Authorization: 'Bearer desktop-local' };
const EVIDENCE_DIR = path.join(__dirname, '..', 'acceptance', 'block-94');

let client;

async function apiRequest(method, pathname, body, isForm) {
  const headers = { ...AUTH };
  let payload;
  if (isForm) {
    payload = body; // FormData（全局 fetch 原生支持，自动 multipart 边界）
  } else if (body != null) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(API + pathname, { method, headers, body: payload });
  let parsed;
  try { parsed = await res.json(); } catch { parsed = null; }
  return { status: res.status, body: parsed };
}

/** 拉取 task 事件流（afterSeq=0 全量重放），解析 payload。 */
function fetchTaskEvents(taskId, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const events = [];
    const req = http.get(`${API}/api/ai/agent/task/${taskId}?afterSeq=0`, { headers: AUTH }, (res) => {
      let buf = '';
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        try { res.destroy(); } catch {}
        resolve(events);
      };
      const timer = setTimeout(finish, timeoutMs);
      res.on('data', (c) => {
        buf += c.toString('utf8');
        let idx;
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const raw = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          for (const line of raw.split('\n')) {
            const m = line.match(/^data:\s?(.*)$/);
            if (!m) continue;
            if (m[1] === '[DONE]') { clearTimeout(timer); finish(); return; }
            try {
              const obj = JSON.parse(m[1]);
              events.push(obj && obj.payload ? obj.payload : obj);
            } catch {}
          }
        }
      });
      res.on('end', () => { clearTimeout(timer); finish(); });
      res.on('error', () => { clearTimeout(timer); finish(); });
    });
    req.on('error', reject);
  });
}

function buildMinimalPdf(lines) {
  const escape = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const contentStream = `BT /F1 14 Tf 72 720 Td ${lines.map((l, i) => `${i > 0 ? '0 -20 Td ' : ''}(${escape(l)}) Tj`).join(' ')} ET`;
  const objs = [];
  objs[1] = '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n';
  objs[2] = '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n';
  objs[3] = '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n';
  objs[4] = `4 0 obj\n<< /Length ${contentStream.length} >>\nstream\n${contentStream}\nendstream\nendobj\n`;
  objs[5] = '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n';
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  for (let i = 1; i <= 5; i++) { offsets[i] = pdf.length; pdf += objs[i]; }
  const xrefStart = pdf.length;
  pdf += 'xref\n0 6\n0000000000 65535 f \n';
  for (let i = 1; i <= 5; i++) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

async function pollDocReady(docId, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { body } = await apiRequest('GET', '/api/knowledge/documents?limit=200');
    const doc = (body.documents || []).find((d) => d.id === docId);
    if (doc && (doc.status === 'ready' || doc.status === 'failed')) return doc;
    await sleep(2000);
  }
  return null;
}

async function pollTargets() {
  const targets = await lib.pollTargets({ timeoutMs: 20000 });
  const candidates = lib.filterPageTargets(targets, /^http:\/\/localhost:3000\/(?!window\/)/);
  return lib.selectPageTarget(candidates, {
    probe: async (c) => lib.evalJs(c, `!!document.getElementById('root')`).catch(() => false),
  });
}

const EVAL = (expr) => lib.evalJs(client, expr);

(async () => {
  const run = lib.createRun({ name: 'block94-knowledge-live', evidenceDir: EVIDENCE_DIR });
  Date.now();
  const createdDocIds = [];

  // ── A1 总览契约 ──
  let r = await apiRequest('GET', '/api/knowledge/space');
  const overview = r.body;
  run.assert('A1_overview_contract',
    overview.status === 'ok' &&
    typeof overview.documentsTotal === 'number' &&
    overview.scale && typeof overview.scale.scanWarnThreshold === 'number' &&
    overview.staleEmbedding &&
    overview.embeddingAvailable === true,
    `fields=${JSON.stringify({ total: overview.documentsTotal, scale: overview.scale, emb: overview.embeddingAvailable })}`);

  // ── A2 启用 ──
  r = await apiRequest('POST', '/api/knowledge/space', { enabled: true });
  run.assert('A2_space_enabled', r.body.status === 'ok' && r.body.space.enabled === true, JSON.stringify(r.body.space));

  // ── A3 文本上传（真实嵌入）──
  const textContent = [
    '# TP53 知识笔记',
    'TP53 是重要的抑癌基因，参与细胞凋亡调控与基因组完整性监护。',
    '',
    '## BRCA1 修复通路',
    'BRCA1 参与同源重组修复，胚系突变显著提高乳腺癌发病风险。',
  ].join('\n');
  const form = new FormData();
  form.append('files', new Blob([textContent], { type: 'text/markdown' }), 'block94-tp53-notes.md');
  r = await apiRequest('POST', '/api/knowledge/documents', form, true);
  const textDoc = (r.body.accepted || [])[0];
  run.assert('A3a_text_accepted', !!textDoc, JSON.stringify(r.body).slice(0, 200));
  createdDocIds.push(textDoc.id);
  const textReady = await pollDocReady(textDoc.id);
  run.assert('A3b_text_ready', !!textReady && textReady.status === 'ready' && textReady.chunkCount >= 1,
    JSON.stringify(textReady && { s: textReady.status, c: textReady.chunkCount }));

  // ── A4 PDF 上传（F2 真跑）──
  const pdfBuf = buildMinimalPdf([
    'TP53 regulates cell cycle arrest and apoptosis.',
    'BRCA1 mediates homologous recombination repair in humans.',
  ]);
  const pdfForm = new FormData();
  pdfForm.append('files', new Blob([pdfBuf], { type: 'application/pdf' }), 'block94-paper.pdf');
  r = await apiRequest('POST', '/api/knowledge/documents', pdfForm, true);
  const pdfDoc = (r.body.accepted || [])[0];
  run.assert('A4a_pdf_accepted', !!pdfDoc, JSON.stringify(r.body).slice(0, 200));
  createdDocIds.push(pdfDoc.id);
  const pdfReady = await pollDocReady(pdfDoc.id);
  run.assert('A4b_pdf_ready_kind', !!pdfReady && pdfReady.status === 'ready' && pdfReady.kind === 'pdf',
    JSON.stringify(pdfReady && { s: pdfReady.status, k: pdfReady.kind, c: pdfReady.chunkCount }));

  // ── A5 粘贴入库（F3）──
  r = await apiRequest('POST', '/api/knowledge/documents/paste', { name: 'block94-粘贴', text: '粘贴入库的知识内容：单细胞转录组聚类使用 Leiden 算法。' });
  const pasteDoc = r.body.document;
  run.assert('A5a_paste_accepted', !!pasteDoc, JSON.stringify(r.body).slice(0, 160));
  createdDocIds.push(pasteDoc.id);
  const pasteReady = await pollDocReady(pasteDoc.id);
  run.assert('A5b_paste_ready', !!pasteReady && pasteReady.status === 'ready', JSON.stringify(pasteReady && pasteReady.status));

  // ── A6 真实双通道检索 ──
  r = await apiRequest('POST', '/api/knowledge/search', { query: 'TP53 细胞凋亡 机制' });
  const search = r.body;
  run.assert('A6_search_dual_channel',
    search.hits.length >= 1 && search.embeddingAvailable === true && search.hits.some((h) => h.channels && h.channels.vector != null),
    `hits=${search.hits.length} emb=${search.embeddingAvailable} first=${JSON.stringify(search.hits[0] && search.hits[0].channels)}`);

  // ── A7 docId 过滤（F5）──
  r = await apiRequest('POST', '/api/knowledge/search', { query: 'TP53', docId: pasteDoc.id });
  const filtered = r.body;
  run.assert('A7_docid_filter', filtered.hits.every((h) => h.docId === pasteDoc.id) && filtered.readyChunks >= 1,
    `hits=${filtered.hits.length} scoped=${filtered.readyChunks}`);

  // ── A8 纯符号降级诚实化（F5）──
  r = await apiRequest('POST', '/api/knowledge/search', { query: '!!!###' });
  run.assert('A8_fts_degraded_honest', r.body.ftsDegraded === true, `ftsDegraded=${r.body.ftsDegraded}`);

  // ── A9 预览（F4）──
  r = await apiRequest('GET', `/api/knowledge/documents/${textDoc.id}/preview`);
  run.assert('A9_preview_chunks_raw',
    r.body.status === 'ok' && (r.body.chunks || []).length >= 1 && r.body.rawAvailable === true,
    `chunks=${(r.body.chunks || []).length} raw=${r.body.rawAvailable}`);

  // ── A10 批量删除 + 不支持格式拒绝（F4/F3）──
  const badForm = new FormData();
  badForm.append('files', new Blob([Buffer.from('MZ')], { type: 'application/octet-stream' }), 'bad.exe');
  badForm.append('files', new Blob([textContent], { type: 'text/plain' }), 'good.txt');
  r = await apiRequest('POST', '/api/knowledge/documents', badForm, true);
  const rejectedNames = (r.body.rejected || []).map((x) => x.name);
  const goodDoc = (r.body.accepted || [])[0];
  if (goodDoc) createdDocIds.push(goodDoc.id);
  run.assert('A10a_reject_aggregated', rejectedNames.includes('bad.exe') && (r.body.accepted || []).length === 1,
    `rejected=${JSON.stringify(rejectedNames)} accepted=${(r.body.accepted || []).length}`);
  r = await apiRequest('POST', '/api/knowledge/documents/batch-delete', { ids: [pdfDoc.id, 'kdoc_absent__'] });
  run.assert('A10b_batch_delete', r.body.deleted && r.body.deleted.includes(pdfDoc.id) && r.body.missing.includes('kdoc_absent__'),
    JSON.stringify({ deleted: r.body.deleted, missing: r.body.missing }));
  createdDocIds.splice(createdDocIds.indexOf(pdfDoc.id), 1);

  // ── A11 真实模型轮次 → knowledge_citations（F5 端到端）──
  const projList = await apiRequest('GET', '/api/data/projects');
  const projectId = process.argv[2] || (projList.body.projects && projList.body.projects[0] && projList.body.projects[0].id);
  const taskRes = await apiRequest('POST', '/api/ai/agent', {
    messages: [{ role: 'user', content: '请根据知识空间检索结果，用一句话回答：TP53 的核心功能是什么？（直接作答，不要调用工具）' }],
    context: { page: 'desktop-project', projectId },
    projectId,
  });
  const taskId = taskRes.body.taskId;
  run.assert('A11a_task_created', !!taskId, JSON.stringify(taskRes.body).slice(0, 160));
  let citationEvent = null;
  let taskDone = false;
  for (let i = 0; i < 20 && !citationEvent; i++) {
    await sleep(6000);
    const events = await fetchTaskEvents(taskId, 10000);
    citationEvent = events.find((e) => e && e.event === 'knowledge_citations');
    taskDone = events.some((e) => e && e.event === 'done');
    if (taskDone && !citationEvent) break;
  }
  run.assert('A11b_citations_event_real_round',
    !!citationEvent && Array.isArray(citationEvent.citations) &&
    citationEvent.citations.some((c) => /block94-tp53-notes|TP53 知识笔记/.test(String(c.docName))),
    citationEvent ? JSON.stringify(citationEvent.citations).slice(0, 220) : 'no knowledge_citations in task events');

  // ── V1 CDP：/knowledge 面板 ──
  try {
    let target = await pollTargets();
    client = await lib.connectTarget(target);
    await lib.evalJs(client, `location.href = 'http://localhost:3000/knowledge'; 'nav'`);
    await sleep(3500);
    target = await pollTargets();
    client = await lib.connectTarget(target);
    const panel = await EVAL(`!!document.querySelector('[data-testid="knowledge-panel"]')`);
    run.assert('V1a_knowledge_panel_mounted', panel === true || panel === 'true', `panel=${panel}`);
    const docRows = await EVAL(`document.querySelectorAll('[data-testid="knowledge-doc-row"]').length`);
    run.assert('V1b_panel_doc_rows', Number(docRows) >= 1, `rows=${docRows}`);
    await lib.screenshotPng(client, EVIDENCE_DIR, 'block94-knowledge-panel.png');
  } catch (e) {
    run.assert('V1_knowledge_panel', false, `cdp: ${e.message}`);
  }

  // ── V2 CDP：摘要卡「知识溯源」节（composer 真发轮次 → 工作台当前会话）──
  try {
    let target = await pollTargets();
    client = await lib.connectTarget(target);
    await lib.evalJs(client, `location.href = 'http://localhost:3000/project/${projectId}'; 'nav'`);
    await sleep(4500);
    target = await pollTargets();
    client = await lib.connectTarget(target);

    // composer 真发（block97 同款：React 受控 setter + input 事件 + 点发送）
    const COMPOSER_PROMPT =
      '请根据知识空间检索结果，用一句话回答 BRCA1 与哪种修复相关？（直接作答，不要调用工具）';
    let typed = '';
    for (let i = 0; i < 15; i++) {
      typed = await EVAL(
        "(function(){\n" +
        "  var ta = document.querySelector('textarea.sc-input');\n" +
        "  if (!ta) return 'no_textarea';\n" +
        "  var setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;\n" +
        "  setter.call(ta, " + JSON.stringify(COMPOSER_PROMPT) + ");\n" +
        "  ta.dispatchEvent(new Event('input', { bubbles: true }));\n" +
        "  return 'typed:' + ta.value.length;\n" +
        "})()");
      if (String(typed).startsWith('typed:')) break;
      await sleep(1000);
    }
    const clicked = String(typed).startsWith('typed:')
      ? await EVAL(
        "(function(){\n" +
        "  var btns = document.querySelectorAll('button');\n" +
        "  for (var i = 0; i < btns.length; i++) {\n" +
        "    var t = btns[i].getAttribute('title') || '';\n" +
        "    if (t.indexOf('发送') >= 0 && btns[i].offsetParent) { btns[i].click(); return 'clicked:' + t; }\n" +
        "  }\n" +
        "  return 'send_button_not_found';\n" +
        "})()")
      : 'skipped_no_textarea';
    run.assert('V2a_composer_sent', clicked.indexOf('clicked') === 0, String(clicked));

    // 等摘要卡「知识溯源」节出现（真轮次注入事件 → 会话级存储 → 摘要卡节）
    let citeSeen = false;
    for (let i = 0; i < 40 && !citeSeen; i++) {
      await sleep(3000);
      citeSeen = (await EVAL(`!!document.querySelector('section[aria-label="知识溯源"]')`)) === true;
      if (!citeSeen && i === 2) {
        // 摘要卡可能整体收起 → 点 TitleBar「展开摘要概览」（已展开则无此按钮）
        await EVAL(
          "(function(){\n" +
          "  var btns = document.querySelectorAll('button[aria-label]');\n" +
          "  for (var i = 0; i < btns.length; i++) {\n" +
          "    if (btns[i].getAttribute('aria-label') === '展开摘要概览') { btns[i].click(); return 'opened'; }\n" +
          "  }\n" +
          "  return 'already_open_or_not_found';\n" +
          "})()").catch(() => 'eval_err');
      }
    }
    run.assert('V2b_summary_citations_section', citeSeen, `citationsSection=${citeSeen}`);
    await lib.screenshotPng(client, EVIDENCE_DIR, 'block94-summary-citations.png');
  } catch (e) {
    run.assert('V2_summary_citations', false, `cdp: ${e.message}`);
  }

  // ── 清理：删除本次创建的文档，空间复位 ──
  if (createdDocIds.length) {
    await apiRequest('POST', '/api/knowledge/documents/batch-delete', { ids: createdDocIds });
  }
  await apiRequest('POST', '/api/knowledge/space', { enabled: false });

  run.finish({ meta: { taskId, projectId } });
})().catch((e) => {
  console.error('[block94-knowledge-live] fatal:', e);
  process.exit(1);
});
