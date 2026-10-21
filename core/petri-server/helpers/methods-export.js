/**
 * helpers/methods-export.js — GENERATE_METHODS_v1 + EXPORT_REPORT_v1 + EXPORT_SCRIPT_v1
 *
 * Extracted from server.js (~746 lines).
 * Pure module: depends on ../db, https, path, fs, puppeteer.
 *
 * External references (TEMP_DIR, ossClient) are read from globalThis._petri
 * which server.js sets up early.
 *
 * Public API:
 *   _gatherAnalysisContextForMethods(userId, opts)
 *   _renderMethodsParagraph(ctx, opts)
 *   _renderReportPdf(html, opts)
 *   _cleanRScriptForExport(rawScript, opts)
 *   _scriptHeader({analysis, dataset, language, generatedAt, username})
 *   _pythonEquivalent(analysis, dataset)
 */

// Lazy accessors for server.js-scoped objects
function TEMP_DIR() {
  return (globalThis._petri && globalThis._petri.TEMP_DIR) || '/tmp';
}

// GENERATE_METHODS_v1 — collect analyses + plan + render Methods
// ============================================================

// BLOCK-220 — 标准工具引用与工具标签是领域数据，随已安装领域包的
// provides.methods 提供（pack-methods.js）。核心不再内联分析类型→引用表；
// 包缺失/停用 → 无引用块、无标签（诚实降级，不伪造引文）。
const packMethods = require('./pack-methods');


function _gatherAnalysisContextForMethods(userId, opts) {
  const dbMod = require('../db');

  function fetchAnalysisOwned(analysisId) {
    return dbMod.db
      .prepare(
        `SELECT a.*, d.name AS dataset_name, d.n_cells, d.n_genes, p.user_id
       FROM analyses a JOIN datasets d ON a.dataset_id=d.id JOIN projects p ON d.project_id=p.id
       WHERE a.id=? AND p.user_id=?`
      )
      .get(analysisId, userId);
  }

  function fetchAnalysisById(id) {
    return dbMod.db.prepare('SELECT * FROM analyses WHERE id=?').get(id);
  }

  const out = { datasets: [], analyses: [], plans: [] };

  if (opts.analysisId) {
    const a = fetchAnalysisOwned(opts.analysisId);
    if (!a) return null;
    out.datasets.push({
      id: a.dataset_id,
      name: a.dataset_name,
      n_cells: a.n_cells,
      n_genes: a.n_genes,
    });
    out.analyses.push(_serializeAnalysisForMethods(a));
    let parentId = a.parent_analysis_id;
    while (parentId) {
      const p = fetchAnalysisById(parentId);
      if (!p) break;
      out.analyses.unshift(_serializeAnalysisForMethods(p));
      parentId = p.parent_analysis_id;
    }
  }

  if (opts.planId) {
    const plan = dbMod.db
      .prepare('SELECT * FROM copilot_plans WHERE id=? AND user_id=?')
      .get(opts.planId, userId);
    const steps = dbMod.db
      .prepare('SELECT * FROM copilot_plan_steps WHERE plan_id=? ORDER BY n')
      .all(opts.planId);
    if (!plan) return null;
    out.plans.push({ title: plan.title, goal: plan.goal, status: plan.status, steps });
    const seenAnalysisIds = new Set(out.analyses.map((x) => x.id));
    for (const s of steps) {
      if (s.analysis_id && !seenAnalysisIds.has(s.analysis_id)) {
        const a = fetchAnalysisOwned(s.analysis_id);
        if (a) {
          out.analyses.push(_serializeAnalysisForMethods(a));
          seenAnalysisIds.add(a.id);
          if (!out.datasets.find((d) => d.id === a.dataset_id)) {
            out.datasets.push({
              id: a.dataset_id,
              name: a.dataset_name,
              n_cells: a.n_cells,
              n_genes: a.n_genes,
            });
          }
        }
      }
    }
  }

  if (opts.datasetId) {
    const ds = dbMod.db
      .prepare(
        `SELECT d.*, p.user_id FROM datasets d JOIN projects p ON d.project_id=p.id WHERE d.id=? AND p.user_id=?`
      )
      .get(opts.datasetId, userId);
    if (!ds) return null;
    out.datasets.push({ id: ds.id, name: ds.name, n_cells: ds.n_cells, n_genes: ds.n_genes });
    const rows = dbMod.db
      .prepare(
        `SELECT * FROM analyses WHERE dataset_id=? AND status='done' ORDER BY created_at DESC LIMIT 10`
      )
      .all(opts.datasetId);
    rows.forEach((a) => out.analyses.push(_serializeAnalysisForMethods(a)));
  }
  return out;
}

function _serializeAnalysisForMethods(a) {
  let params = {};
  try {
    params = JSON.parse(a.params || '{}');
  } catch {}
  return {
    id: a.id,
    type: a.type,
    name: a.name,
    parent_analysis_id: a.parent_analysis_id,
    params,
    summary: a.summary ? String(a.summary).slice(0, 800) : null,
    status: a.status,
  };
}

async function _renderMethodsParagraph(ctx, { language }) {
  const lang = language === 'en' ? 'en' : language === 'both' ? 'both' : 'zh';

  // Build the data block
  const dsBlock = ctx.datasets
    .map(
      (d) =>
        '- ' +
        (d.name || d.id) +
        (d.n_cells ? ' (' + d.n_cells + ' cells × ' + (d.n_genes || '?') + ' genes)' : '')
    )
    .join('\n');
  // BLOCK-220 — 引用块来自已安装领域包；无 pack 命中 → 整段不出现（不留空括号）
  const packMethodData = packMethods.loadPackMethods();
  const analysisBlock = ctx.analyses
    .map((a, i) => {
      const citations = packMethods.getCitations(a.type, packMethodData);
      const cite = citations.length > 0 ? '  • Standard tools: ' + citations.join('; ') : '';
      return (
        i +
        1 +
        '. ' +
        a.type +
        (a.name ? ' "' + a.name + '"' : '') +
        '\n   parameters: ' +
        JSON.stringify(a.params) +
        (a.summary ? '\n   result summary: ' + a.summary.slice(0, 300) : '') +
        (cite ? '\n' + cite : '')
      );
    })
    .join('\n');
  const planBlock = ctx.plans
    .map(
      (p) =>
        'Plan: ' +
        p.title +
        (p.goal ? ' (goal: ' + p.goal + ')' : '') +
        '\n  steps: ' +
        (p.steps || []).map((s) => s.n + ') ' + s.title + ' [' + s.status + ']').join(' / ')
    )
    .join('\n');

  const userPromptZh =
    '基于以下用户在 Petri 平台执行的分析，写一段适合论文 Methods 部分的描述。要求：' +
    '1) 严格学术风格，不要营销用语；2) 引用关键软件包及版本（用括号标注，如 "<package> v<version> (Author et al., year)"）；' +
    '3) 报告关键参数（cell QC 阈值、分辨率、降维维数等）；4) 句式紧凑，不堆砌；' +
    '5) 不要写 "我们使用 Petri 平台"——平台是工具，重点是底层方法；' +
    '6) 长度 120-220 字。直接输出段落，不带标题和引号。\n\n';
  const userPromptEn =
    "Based on the user's analysis pipeline below, write a Methods paragraph suitable for a manuscript. " +
    'Strict academic style. Cite key packages with versions (e.g., "<package> v<version> (Author et al., year)"). Report key parameters (QC thresholds, resolution, n_dims). ' +
    'Do not mention the Petri platform — what matters is the underlying methods. 100-180 words. Output the paragraph only.\n\n';
  const dataBlock =
    (dsBlock ? '\nDataset(s):\n' + dsBlock : '') +
    (planBlock ? '\n\nAnalysis plan:\n' + planBlock : '') +
    (analysisBlock ? '\n\nAnalyses executed:\n' + analysisBlock : '');

  const messages = [];
  if (lang === 'both') {
    messages.push({
      role: 'system',
      content:
        '你是一位资深生物信息学家，擅长撰写学术论文 Methods 部分。先用中文写一段，然后用英文写一段，中间用 "---" 分隔。',
    });
    messages.push({ role: 'user', content: userPromptZh + userPromptEn + dataBlock });
  } else if (lang === 'en') {
    messages.push({
      role: 'system',
      content: 'You are a senior bioinformatician writing rigorous academic Methods paragraphs.',
    });
    messages.push({ role: 'user', content: userPromptEn + dataBlock });
  } else {
    messages.push({
      role: 'system',
      content: '你是一位资深生物信息学家，擅长撰写学术论文 Methods 部分。',
    });
    messages.push({ role: 'user', content: userPromptZh + dataBlock });
  }

  try {
    const { callModelTask } = require('./model-tasks');
    const result = await callModelTask({
      role: 'report',
      messages,
      temperature: 0.4,
      maxTokens: 1200,
      telemetry: {
        userId: ctx._userId,
        conversationId: ctx._conversationId,
        kind: 'methods',
      },
    });
    const content = result.text;
    if (!content) return { error: 'empty_response' };
    return {
      ok: true,
      methods: content,
      language: lang,
      usage: (result.response && result.response.usage) || {},
    };
  } catch (e) {
    return { error: 'api_error', message: (e && e.message) || String(e) };
  }
}

// ============================================================
// EXPORT_REPORT_v1 — render HTML report → PDF → OSS → signed URL
// ============================================================
let _puppeteerBrowser = null;
async function _getReportBrowser() {
  if (_puppeteerBrowser && _puppeteerBrowser.connected) return _puppeteerBrowser;
  const puppeteer = require('puppeteer');
  _puppeteerBrowser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  return _puppeteerBrowser;
}

function _escapeHtml(s) {
  return String(s == null ? '' : s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

function _buildReportHtml({
  user,
  methods,
  language,
  analyses,
  datasets,
  plans,
  plotsByAnalysisId,
  generatedAt,
}) {
  const title =
    (datasets[0] && datasets[0].name) ||
    (plans[0] && plans[0].title) ||
    (analyses[0] && analyses[0].name) ||
    'Petri Analysis Report';
  const styles = `
    <style>
      @page { size: A4; margin: 18mm 16mm; }
      * { box-sizing: border-box; }
      body { font-family: -apple-system, "PingFang SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif; color: #1f2937; line-height: 1.65; font-size: 11pt; }
      h1, h2, h3 { color: #047857; margin-top: 1.2em; }
      h1 { font-size: 20pt; border-bottom: 2px solid #10b981; padding-bottom: 6px; }
      h2 { font-size: 14pt; border-left: 4px solid #10b981; padding-left: 10px; margin-top: 1.5em; }
      h3 { font-size: 12pt; }
      .cover { text-align: center; padding: 60px 0 40px 0; }
      .cover-title { font-size: 22pt; font-weight: 700; color: #047857; margin-bottom: 12px; }
      .cover-subtitle { font-size: 12pt; color: #6b7280; margin-bottom: 24px; }
      .cover-meta { font-size: 10.5pt; color: #6b7280; margin-top: 18px; }
      .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 24px; margin: 16px 0; padding: 14px; background: #f9fafb; border-radius: 8px; border: 1px solid #e5e7eb; font-size: 10.5pt; }
      .meta-grid div b { color: #047857; }
      .plan { padding: 14px; background: #ecfdf5; border-left: 4px solid #10b981; margin: 14px 0; border-radius: 4px; }
      .plan-step { padding: 6px 0; border-bottom: 1px dashed #d1fae5; font-size: 10.5pt; }
      .plan-step:last-child { border-bottom: none; }
      .plan-step b { color: #047857; }
      .step-status { font-size: 9.5pt; padding: 1px 6px; border-radius: 4px; margin-left: 4px; }
      .ss-done { background: #d1fae5; color: #065f46; }
      .ss-failed { background: #fee2e2; color: #991b1b; }
      .ss-running { background: #fef3c7; color: #92400e; }
      .ss-pending { background: #f3f4f6; color: #6b7280; }
      .analysis-block { margin: 18px 0; }
      .params-table { width: 100%; border-collapse: collapse; font-size: 10pt; margin: 10px 0; }
      .params-table th, .params-table td { padding: 6px 10px; border: 1px solid #e5e7eb; text-align: left; }
      .params-table th { background: #f9fafb; color: #4b5563; width: 30%; }
      .figure-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; margin: 14px 0; }
      .figure { text-align: center; page-break-inside: avoid; }
      .figure img { max-width: 100%; max-height: 180mm; border: 1px solid #e5e7eb; border-radius: 4px; }
      .figure-caption { font-size: 9.5pt; color: #6b7280; margin-top: 4px; }
      .methods-block { padding: 16px; background: #fefce8; border: 1px solid #fde68a; border-radius: 8px; font-size: 11pt; line-height: 1.8; white-space: pre-wrap; margin: 14px 0; }
      .summary-block { padding: 12px 14px; background: #eff6ff; border-left: 4px solid #3b82f6; margin: 10px 0; border-radius: 4px; font-size: 10.5pt; color: #1e3a8a; }
      .footer-note { font-size: 9pt; color: #9ca3af; margin-top: 30px; padding-top: 8px; border-top: 1px solid #e5e7eb; text-align: center; }
      .citations { font-size: 10pt; color: #4b5563; }
      .citations li { margin: 4px 0; }
      .pagebreak { page-break-after: always; }
    </style>
  `;

  const dsHtml = datasets
    .map(
      (d) => `
    <div>📊 数据集</div><div><b>${_escapeHtml(d.name)}</b></div>
    <div>细胞数</div><div>${d.n_cells != null ? d.n_cells.toLocaleString() : '—'}</div>
    <div>基因数</div><div>${d.n_genes != null ? d.n_genes.toLocaleString() : '—'}</div>
  `
    )
    .join('');

  const plansHtml =
    plans.length === 0
      ? ''
      : `
    <h2>分析计划</h2>
    ${plans
      .map(
        (p) => `
      <div class="plan">
        <h3 style="margin-top:0">${_escapeHtml(p.title)}</h3>
        ${p.goal ? '<div style="font-size:10.5pt;color:#6b7280;margin-bottom:6px">🎯 ' + _escapeHtml(p.goal) + '</div>' : ''}
        ${(p.steps || [])
          .map(
            (s) => `
          <div class="plan-step">
            <b>${s.n}.</b> ${_escapeHtml(s.title)}
            <span class="step-status ss-${s.status}">${s.status}</span>
            ${s.result ? '<div style="font-size:9.5pt;color:#6b7280;margin-top:2px">→ ' + _escapeHtml(s.result) + '</div>' : ''}
          </div>
        `
          )
          .join('')}
      </div>
    `
      )
      .join('')}
  `;

  const analysisBlocks = analyses
    .map((a, i) => {
      const params = a.params || {};
      const paramsRows = Object.entries(params)
        .map(
          ([k, v]) =>
            `<tr><th>${_escapeHtml(k)}</th><td>${_escapeHtml(typeof v === 'object' ? JSON.stringify(v) : v)}</td></tr>`
        )
        .join('');
      const plots = (plotsByAnalysisId && plotsByAnalysisId[a.id]) || [];
      const figs = plots
        .slice(0, 8)
        .map(
          (p) => `
      <div class="figure">
        <img src="${_escapeHtml(p.dataUrl || p.url)}" alt="${_escapeHtml(p.name || 'plot')}" />
        <div class="figure-caption">${_escapeHtml(p.name || p.filename)}</div>
      </div>
    `
        )
        .join('');
      return `
      <div class="analysis-block">
        <h3>${i + 1}. ${_escapeHtml(a.name || a.type)} <span style="font-size:10pt;color:#6b7280;font-weight:400">(${_escapeHtml(a.type)})</span></h3>
        ${paramsRows ? '<table class="params-table">' + paramsRows + '</table>' : ''}
        ${a.summary ? '<div class="summary-block">' + _escapeHtml(a.summary).slice(0, 600) + '</div>' : ''}
        ${figs ? '<div class="figure-grid">' + figs + '</div>' : ''}
      </div>
    `;
    })
    .join('');

  const reportCitations = packMethods.getReportCitations();
  const citations = reportCitations.length > 0
    ? `
    <h2>参考文献</h2>
    <ul class="citations">
      ${reportCitations.map((item) => `<li>${_escapeHtml(item)}</li>`).join('\n      ')}
    </ul>
  `
    : '';
  return `<!DOCTYPE html><html lang="${language === 'en' ? 'en' : 'zh'}"><head>
    <meta charset="UTF-8" />
    <title>${_escapeHtml(title)} — Analysis Report</title>
    ${styles}
  </head><body>
    <div class="cover">
      <div class="cover-title">分析报告</div>
      <div class="cover-subtitle">${_escapeHtml(title)}</div>
      <div style="font-size:11pt;color:#6b7280;margin-top:30px">由 AI 分析助手根据项目记录生成</div>
      <div class="cover-meta">
        生成时间：${_escapeHtml(generatedAt)}<br/>
        ${user ? '用户：' + _escapeHtml(user) : ''}
      </div>
    </div>

    <h2>数据集摘要</h2>
    <div class="meta-grid">
      ${dsHtml || '<div>—</div><div>—</div>'}
    </div>

    ${plansHtml}

    <h2>分析过程</h2>
    ${analysisBlocks || '<div style="color:#6b7280">没有可用的分析记录。</div>'}

    ${
      methods
        ? `
      <h2>方法学描述（Methods）</h2>
      <div class="methods-block">${_escapeHtml(methods)}</div>
    `
        : ''
    }

    ${citations}

    <div class="footer-note">
      生成于 ${_escapeHtml(generatedAt)} · Petri 平台 · https://petri.com<br/>
      AI 自动整理，请核对参数和引用准确性后用于学术发表。
    </div>
  </body></html>`;
}

async function _embedPlotsAsDataUrls(analyses) {
  // For each analysis, fetch its task results to get plots, then convert each
  // to a data URL so the PDF embeds them inline (no external requests at PDF time).
  const dbMod = require('../db');
  const out = {};
  for (const a of analyses) {
    if (!a.id) continue;
    try {
      const row = dbMod.getAnalysis(a.id); // results are already parsed
      if (!row || !row.results) continue;
      let r = row.results;
      if (typeof r === 'string') {
        try {
          r = JSON.parse(r);
        } catch {
          r = null;
        }
      }
      if (!r || !Array.isArray(r.plots)) continue;
      const plots = [];
      for (const p of r.plots.slice(0, 8)) {
        try {
          if (p.url && p.url.startsWith('data:')) {
            plots.push({ name: p.name, filename: p.filename, dataUrl: p.url });
          } else if (p.url) {
            // BLOCK-102 P4 — 导出取图加超时：对端挂起时连接曾最多挂 300s
            const resp = await fetch(p.url, { signal: AbortSignal.timeout(10_000) });
            if (resp.ok) {
              const buf = Buffer.from(await resp.arrayBuffer());
              const b64 = buf.toString('base64');
              plots.push({
                name: p.name,
                filename: p.filename,
                dataUrl: 'data:image/png;base64,' + b64,
              });
            }
          }
        } catch {}
      }
      out[a.id] = plots;
    } catch {}
  }
  return out;
}

async function _renderReportPdf(opts) {
  const { userId, conversationId, analysisId, planId, datasetId, language, username } = opts;
  // Re-use the gather + Methods generation logic
  const ctx = _gatherAnalysisContextForMethods(userId, { analysisId, planId, datasetId });
  if (!ctx || ctx.analyses.length === 0) {
    return { error: 'no_analyses', message: '没有可用于报告的分析记录' };
  }
  ctx._userId = userId;
  ctx._conversationId = conversationId;
  // Generate Methods paragraph
  const methodsResult = await _renderMethodsParagraph(ctx, { language: language || 'zh' });
  const methods = methodsResult && methodsResult.methods ? methodsResult.methods : null;
  // Embed plots
  const plotsByAnalysisId = await _embedPlotsAsDataUrls(ctx.analyses);
  const html = _buildReportHtml({
    user: username,
    methods,
    language: language || 'zh',
    analyses: ctx.analyses,
    datasets: ctx.datasets,
    plans: ctx.plans,
    plotsByAnalysisId,
    generatedAt: new Date().toLocaleString('zh-CN', { hour12: false }),
  });

  const browser = await _getReportBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });
    const pdfBuf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '18mm', bottom: '18mm', left: '16mm', right: '16mm' },
    });
    await page.close();

    // 写临时文件后通过本地存储适配器落盘，返回可访问 URL
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const key = 'reports/' + userId + '/' + ts + '.pdf';
    const path = require('path');
    const fsLocal = require('fs');
    const tmpPath = path.join(
      TEMP_DIR(),
      'report-' + ts + '-' + Math.random().toString(36).slice(2, 8) + '.pdf'
    );
    fsLocal.writeFileSync(tmpPath, pdfBuf);
    let url;
    try {
      const { getActiveStorage } = require('../../shared-backend/storage');
      url = await getActiveStorage().upload(tmpPath, key);
    } finally {
      try {
        fsLocal.unlinkSync(tmpPath);
      } catch {}
    }
    return {
      ok: true,
      url,
      sizeBytes: pdfBuf.length,
      sources: {
        analyses: ctx.analyses.length,
        datasets: ctx.datasets.length,
        plans: ctx.plans.length,
        plots: Object.values(plotsByAnalysisId).reduce((s, arr) => s + arr.length, 0),
      },
    };
  } catch (e) {
    try {
      await page.close();
    } catch {}
    return { error: 'render_failed', message: (e && e.message) || String(e) };
  }
}

// ============================================================
// EXPORT_SCRIPT_v1 — reproducible R / Python script export
// ============================================================

/** Strip server-side scaffolding from R scripts, leaving only the core analysis code. */
function _cleanRScriptForExport(rawScript, _opts) {
  // EXPORT_SCRIPT_FIX_v1 — proper balanced-paren stripping
  let src = String(rawScript || '');
  // Remove # Progress reporting helper block (definition)
  src = src.replace(/# Progress reporting helper[\s\S]*?\n\}\n/, '');
  // Strip every full report_progress(...) line, including ones with nested parens
  const lines = src.split('\n');
  const kept = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('report_progress(')) {
      // Walk forward until we balance parens
      let depth = 0;
      let _buf = '';
      let j = i;
      let started = false;
      while (j < lines.length) {
        for (const c of lines[j]) {
          _buf += c;
          if (c === '(') {
            depth++;
            started = true;
          } else if (c === ')') {
            depth--;
            if (started && depth === 0) break;
          }
        }
        if (started && depth === 0) break;
        _buf += '\n';
        j++;
      }
      i = j;
      continue;
    }
    kept.push(lines[i]);
  }
  src = kept.join('\n');
  // Remove container-specific setwd
  src = src.replace(/^setwd\("[^"]+"\)\n/gm, '');
  // Remove cat("TASK_COMPLETE...") sentinel
  src = src.replace(/^cat\("TASK_COMPLETE[^)]*\)\n?/gm, '');
  // Collapse runs of >2 blank lines into 1
  src = src.replace(/\n{3,}/g, '\n\n');
  // Trim leading/trailing blank lines
  src = src.replace(/^\n+/, '').replace(/\n+$/, '\n');
  return src;
}

/** Build an academic header for any script. */
function _scriptHeader({ analysis, dataset, language, generatedAt, username }) {
  // BLOCK-220 — 工具标签由领域包提供（provides.methods.toolLabels）；缺省只写类型名
  const toolLabel = packMethods.getToolLabel(analysis.type);

  if (language === 'python') {
    return [
      '# ============================================================',
      '# Petri reproducible analysis script (Python)',
      '# ============================================================',
      '# Analysis : ' + (analysis.name || analysis.type),
      '# Type     : ' + analysis.type + (toolLabel ? ' — ' + toolLabel : ''),
      '# Dataset  : ' + ((dataset && dataset.name) || '?'),
      '# Cells x Genes : ' +
        (dataset && dataset.n_cells != null ? dataset.n_cells : '?') +
        ' x ' +
        (dataset && dataset.n_genes != null ? dataset.n_genes : '?'),
      '# Params   : ' + JSON.stringify(analysis.params || {}),
      '# Generated: ' + generatedAt + ' by ' + (username || 'Petri'),
      '#',
      '# This script reproduces the exact pipeline that ran on Petri. Replace',
      '# INPUT_PATH below with the local matrix file used for the analysis.',
      '# ============================================================',
      '',
    ].join('\n');
  }
  return [
    '# ============================================================',
    '# Petri reproducible analysis script (R)',
    '# ============================================================',
    '# Analysis : ' + (analysis.name || analysis.type),
    '# Type     : ' + analysis.type + (toolLabel ? ' — ' + toolLabel : ''),
    '# Dataset  : ' + ((dataset && dataset.name) || '?'),
    '# Cells x Genes : ' +
      (dataset && dataset.n_cells != null ? dataset.n_cells : '?') +
      ' x ' +
      (dataset && dataset.n_genes != null ? dataset.n_genes : '?'),
    '# Params   : ' + JSON.stringify(analysis.params || {}),
    '# Generated: ' + generatedAt + ' by ' + (username || 'Petri'),
    '#',
    '# This script reproduces the exact pipeline that ran on Petri.',
    '# ============================================================',
    '',
  ].join('\n');
}

function _pythonPlaceholderValues(analysis) {
  const p = (analysis && analysis.params) || {};
  return {
    MIN_CELLS: p.minCells || 3,
    MIN_FEATURES: p.minFeatures || 200,
    MAX_FEATURES: p.maxFeatures || 5000,
    MAX_MT_PERCENT: p.maxMtPercent || 20,
    N_PCS: p.nPCs || 20,
    RESOLUTION: p.resolution || 0.5,
    MT_PATTERN: p.species === 'human' ? 'MT-' : 'mt-',
    GROUP1: p.group1 || 'GROUP_A',
    GROUP2: p.group2 || 'GROUP_B',
  };
}

function _renderPythonTemplate(lines, values) {
  return lines.map((line) => line.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_match, key) => (
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : ''
  ))).join('\n');
}

/**
 * Python equivalent is domain data from the installed pack
 * (provides.methods.pythonEquivalents); no pack -> honest generic fallback.
 */
function _pythonEquivalent(analysis, _dataset) {
  const type = analysis && analysis.type;
  const template = packMethods.getPythonEquivalent(type);
  if (template) return _renderPythonTemplate(template, _pythonPlaceholderValues(analysis));
  return [
    '# Python equivalent for analysis type "' + type + '" is not yet built into Petri.',
    '# Please refer to the R script and consult the relevant package documentation.',
    '',
  ].join('\n');
}

module.exports = {
  _gatherAnalysisContextForMethods,
  _serializeAnalysisForMethods,
  _renderMethodsParagraph,
  _getReportBrowser,
  _escapeHtml,
  _buildReportHtml,
  _embedPlotsAsDataUrls,
  _renderReportPdf,
  _cleanRScriptForExport,
  _scriptHeader,
  _pythonEquivalent,
};
