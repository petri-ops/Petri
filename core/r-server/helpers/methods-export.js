/**
 * helpers/methods-export.js — GENERATE_METHODS_v1 + EXPORT_REPORT_v1 + EXPORT_SCRIPT_v1
 *
 * Extracted from server.js (~746 lines).
 * Pure module: depends on ../db, https, path, fs, puppeteer.
 *
 * External references (TEMP_DIR, ossClient) are read from globalThis._biof3
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
  return (globalThis._biof3 && globalThis._biof3.TEMP_DIR) || '/tmp';
}

// GENERATE_METHODS_v1 — collect analyses + plan + render Methods
// ============================================================

// Standard tool / package citations. Keep up-to-date as platform evolves.
const _METHODS_CITATIONS = {
  scrna_standard: [
    'Seurat v5 (Hao et al., 2024, Nat Biotechnol)',
    'scanpy v1.10 (Wolf et al., 2018, Genome Biol) for QC and dimensionality reduction',
    'UMAP (McInnes et al., 2018) for low-dimensional visualization',
    'Leiden algorithm (Traag et al., 2019, Sci Rep) for clustering',
  ],
  recluster: ['Seurat::FindSubCluster', 'Leiden algorithm'],
  deg: [
    'Seurat::FindMarkers using Wilcoxon rank-sum test',
    'MAST (Finak et al., 2015, Genome Biol) for hurdle modeling',
  ],
  enrichment: [
    'clusterProfiler v4 (Wu et al., 2021, Innovation) for GO/KEGG over-representation analysis',
  ],
  cell_annotation: [
    'Seurat::FindAllMarkers + manual annotation against PanglaoDB and CellMarker 2.0',
  ],
  scrna_integration: ['Harmony (Korsunsky et al., 2019, Nat Methods) for batch correction'],
  trajectory: [
    'Monocle3 (Cao et al., 2019, Nature) or scVelo (Bergen et al., 2020, Nat Biotechnol) for pseudotime',
  ],
  communication: [
    'CellChat v2 (Jin et al., 2024, Nat Protoc) for cell-cell communication inference',
  ],
  // W1-8 (2026-05-28): 空间组学引用块
  spatial_standard: [
    "Squidpy v1.4 (Palla et al., 2022, Nat Methods) for spatial graph and Moran's I",
    'scanpy v1.10 (Wolf et al., 2018, Genome Biol) for normalization, PCA, Leiden clustering',
    'SpatialData (Marconato et al., 2024, Nat Methods) for OME-NGFF data containers',
  ],
  spatial_recluster: ['Squidpy / scanpy with adjusted Leiden resolution on spot subset'],
  spatial_svg: [
    "Squidpy::sq.gr.spatial_autocorr with Moran's I and Geary's C",
    'Sepal (Andersson & Lundeberg, 2021, Bioinformatics) for diffusion-based SVG detection',
  ],
  spatial_deconv: [
    'cell2location (Kleshchevnikov et al., 2022, Nat Biotechnol) for negative-binomial deconvolution',
    'Tangram (Biancalani et al., 2021, Nat Methods) for sc-to-spatial mapping (alternative)',
  ],
  spatial_lr: [
    'LIANA-py (Dimitrov et al., 2022, Nat Commun) with spatial-aware mode',
    'Squidpy::sq.gr.ligrec for permutation-based ligand-receptor enrichment',
  ],
};

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
  const analysisBlock = ctx.analyses
    .map((a, i) => {
      const cite = _METHODS_CITATIONS[a.type]
        ? '  • Standard tools: ' + _METHODS_CITATIONS[a.type].join('; ')
        : '';
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
    '基于以下用户在 BioF3 平台执行的分析，写一段适合论文 Methods 部分的描述。要求：' +
    '1) 严格学术风格，不要营销用语；2) 引用关键软件包及版本（用括号标注，如 "Seurat v5 (Hao et al., 2024)"）；' +
    '3) 报告关键参数（cell QC 阈值、分辨率、降维维数等）；4) 句式紧凑，不堆砌；' +
    '5) 不要写 "我们使用 BioF3 平台"——平台是工具，重点是底层方法；' +
    '6) 长度 120-220 字。直接输出段落，不带标题和引号。\n\n';
  const userPromptEn =
    "Based on the user's analysis pipeline below, write a Methods paragraph suitable for a manuscript. " +
    'Strict academic style. Cite key packages with versions (e.g., "Seurat v5 (Hao et al., 2024)"). Report key parameters (QC thresholds, resolution, n_dims). ' +
    'Do not mention the BioF3 platform — what matters is the underlying methods. 100-180 words. Output the paragraph only.\n\n';
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
    'BioF3 Analysis Report';
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

  const citations = `
    <h2>参考文献</h2>
    <ul class="citations">
      <li>Hao Y, Stuart T, Kowalski MH, et al. (2024) Dictionary learning for integrative, multimodal and scalable single-cell analysis. <i>Nat Biotechnol</i> 42:293-304.</li>
      <li>Wolf FA, Angerer P, Theis FJ. (2018) SCANPY: large-scale single-cell gene expression data analysis. <i>Genome Biol</i> 19:15.</li>
      <li>McInnes L, Healy J, Melville J. (2018) UMAP: Uniform Manifold Approximation and Projection. <i>arXiv</i>:1802.03426.</li>
      <li>Traag VA, Waltman L, van Eck NJ. (2019) From Louvain to Leiden: guaranteeing well-connected communities. <i>Sci Rep</i> 9:5233.</li>
      <li>Korsunsky I, Millard N, Fan J, et al. (2019) Fast, sensitive and accurate integration of single-cell data with Harmony. <i>Nat Methods</i> 16:1289-1296.</li>
      <li>Wu T, Hu E, Xu S, et al. (2021) clusterProfiler 4.0: A universal enrichment tool for interpreting omics data. <i>Innovation</i> 2:100141.</li>
      <li>Cao J, Spielmann M, Qiu X, et al. (2019) The single-cell transcriptional landscape of mammalian organogenesis. <i>Nature</i> 566:496-502.</li>
      <li>Jin S, Plikus MV, Nie Q. (2024) CellChat for systematic analysis of cell-cell communication from single-cell transcriptomics. <i>Nat Protoc</i> 20:180-219.</li>
      <li>Palla G, Spitzer H, Klein M, et al. (2022) Squidpy: a scalable framework for spatial omics analysis. <i>Nat Methods</i> 19:171-178.</li>
      <li>Marconato L, Palla G, Yamauchi KA, et al. (2024) SpatialData: an open and universal data framework for spatial omics. <i>Nat Methods</i> 22:58-62.</li>
      <li>Kleshchevnikov V, Shmatko A, Dann E, et al. (2022) Cell2location maps fine-grained cell types in spatial transcriptomics. <i>Nat Biotechnol</i> 40:661-671.</li>
      <li>Biancalani T, Scalia G, Buffoni L, et al. (2021) Deep learning and alignment of spatially resolved single-cell transcriptomes with Tangram. <i>Nat Methods</i> 18:1352-1362.</li>
      <li>Dimitrov D, Türei D, Garrido-Rodriguez M, et al. (2022) Comparison of methods and resources for cell-cell communication inference. <i>Nat Commun</i> 13:3224.</li>
    </ul>
  `;

  return `<!DOCTYPE html><html lang="${language === 'en' ? 'en' : 'zh'}"><head>
    <meta charset="UTF-8" />
    <title>${_escapeHtml(title)} — Analysis Report</title>
    ${styles}
  </head><body>
    <div class="cover">
      <div class="cover-title">单细胞分析报告</div>
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
      生成于 ${_escapeHtml(generatedAt)} · BioF3 平台 · https://biof3.com<br/>
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
            const resp = await fetch(p.url);
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
  const tools =
    {
      scrna_standard: 'Seurat v5 / scanpy v1.10',
      recluster: 'Seurat::FindSubCluster',
      deg: 'Seurat::FindMarkers (Wilcoxon)',
      enrichment: 'clusterProfiler v4 (GO + KEGG)',
      cell_annotation: 'Seurat + manual annotation (PanglaoDB / CellMarker 2.0)',
      scrna_integration: 'Harmony',
      trajectory: 'Monocle3',
      communication: 'CellChat v2',
      // W1-8: spatial labels
      spatial_standard: 'scanpy v1.10 + Squidpy v1.4 (Visium pipeline)',
      spatial_recluster: 'scanpy + Squidpy (sub-cluster Leiden)',
      spatial_svg: "Squidpy::spatial_autocorr (Moran's I + Geary's C) + Sepal",
      spatial_deconv: 'cell2location / Tangram',
      spatial_lr: 'LIANA-py (spatial-aware) / Squidpy::ligrec',
    }[analysis.type] || analysis.type;

  if (language === 'python') {
    return [
      '# ============================================================',
      '# BioF3 reproducible analysis script (Python / scanpy)',
      '# ============================================================',
      '# Analysis : ' + (analysis.name || analysis.type),
      '# Type     : ' + analysis.type + ' — ' + tools,
      '# Dataset  : ' + ((dataset && dataset.name) || '?'),
      '# Cells x Genes : ' +
        (dataset && dataset.n_cells != null ? dataset.n_cells : '?') +
        ' x ' +
        (dataset && dataset.n_genes != null ? dataset.n_genes : '?'),
      '# Params   : ' + JSON.stringify(analysis.params || {}),
      '# Generated: ' + generatedAt + ' by ' + (username || 'BioF3'),
      '#',
      '# This script reproduces the exact pipeline that ran on BioF3. Replace',
      '# INPUT_PATH below with the local matrix file used for the analysis.',
      '# ============================================================',
      '',
    ].join('\n');
  }
  return [
    '# ============================================================',
    '# BioF3 reproducible analysis script (R / Seurat)',
    '# ============================================================',
    '# Analysis : ' + (analysis.name || analysis.type),
    '# Type     : ' + analysis.type + ' — ' + tools,
    '# Dataset  : ' + ((dataset && dataset.name) || '?'),
    '# Cells x Genes : ' +
      (dataset && dataset.n_cells != null ? dataset.n_cells : '?') +
      ' x ' +
      (dataset && dataset.n_genes != null ? dataset.n_genes : '?'),
    '# Params   : ' + JSON.stringify(analysis.params || {}),
    '# Generated: ' + generatedAt + ' by ' + (username || 'BioF3'),
    '#',
    '# This script reproduces the exact pipeline that ran on BioF3.',
    '# ============================================================',
    '',
  ].join('\n');
}

/** Generate Python (scanpy) equivalent for known analysis types. */
function _pythonEquivalent(analysis, _dataset) {
  const type = analysis.type;
  const p = analysis.params || {};

  if (type === 'scrna_standard' || type === 'recluster') {
    const minCells = p.minCells || 3;
    const minFeatures = p.minFeatures || 200;
    const maxFeatures = p.maxFeatures || 5000;
    const maxMtPercent = p.maxMtPercent || 20;
    const nPCs = p.nPCs || 20;
    const resolution = p.resolution || 0.5;
    const mtPattern = p.species === 'human' ? 'MT-' : 'mt-';
    return [
      'import scanpy as sc',
      'import pandas as pd',
      'import numpy as np',
      'import matplotlib.pyplot as plt',
      '',
      'sc.settings.verbosity = 1',
      'sc.settings.set_figure_params(dpi=150, facecolor="white")',
      '',
      '# ---- 1. Load data ----',
      '# Replace this with your local matrix or .h5ad file.',
      'adata = sc.read_csv("INPUT_MATRIX.csv")  # genes x cells; transpose if needed',
      'if adata.shape[0] < adata.shape[1]:',
      '    adata = adata.T  # ensure cells are rows',
      '',
      '# ---- 2. QC ----',
      'adata.var["mt"] = adata.var_names.str.startswith("' + mtPattern + '")',
      'sc.pp.calculate_qc_metrics(adata, qc_vars=["mt"], inplace=True, percent_top=None, log1p=False)',
      'sc.pl.violin(adata, ["n_genes_by_counts", "total_counts", "pct_counts_mt"], jitter=0.4)',
      '',
      '# Filter',
      'sc.pp.filter_cells(adata, min_genes=' + minFeatures + ')',
      'sc.pp.filter_genes(adata, min_cells=' + minCells + ')',
      'adata = adata[adata.obs.n_genes_by_counts < ' + maxFeatures + ', :]',
      'adata = adata[adata.obs.pct_counts_mt < ' + maxMtPercent + ', :]',
      '',
      '# ---- 3. Normalize ----',
      'sc.pp.normalize_total(adata, target_sum=1e4)',
      'sc.pp.log1p(adata)',
      '',
      '# ---- 4. Variable genes ----',
      'sc.pp.highly_variable_genes(adata, n_top_genes=2000)',
      'adata = adata[:, adata.var.highly_variable]',
      '',
      '# ---- 5. Scale + PCA ----',
      'sc.pp.scale(adata, max_value=10)',
      'sc.tl.pca(adata, n_comps=' + nPCs + ')',
      'sc.pl.pca_variance_ratio(adata, n_pcs=' + nPCs + ', log=True)',
      '',
      '# ---- 6. Neighbors + clustering ----',
      'sc.pp.neighbors(adata, n_neighbors=15, n_pcs=' + nPCs + ')',
      'sc.tl.leiden(adata, resolution=' + resolution + ')',
      '',
      '# ---- 7. UMAP ----',
      'sc.tl.umap(adata)',
      'sc.pl.umap(adata, color=["leiden"], legend_loc="on data")',
      '',
      '# ---- 8. Markers ----',
      'sc.tl.rank_genes_groups(adata, "leiden", method="wilcoxon")',
      'sc.pl.rank_genes_groups(adata, n_genes=10, sharey=False)',
      'top5 = pd.DataFrame({grp: adata.uns["rank_genes_groups"]["names"][grp][:5] for grp in adata.obs["leiden"].unique()})',
      'top5.to_csv("markers_top5.csv", index=False)',
      '',
      '# ---- 9. Save ----',
      'adata.write_h5ad("result.h5ad")',
      'print(f"Done. {adata.shape[0]} cells, {adata.shape[1]} genes, {adata.obs[\'leiden\'].nunique()} clusters")',
      '',
    ].join('\n');
  }

  if (type === 'deg') {
    const group1 = p.group1 || 'GROUP_A';
    const group2 = p.group2 || 'GROUP_B';
    return [
      'import scanpy as sc',
      'import pandas as pd',
      '',
      '# Load preprocessed object',
      'adata = sc.read_h5ad("result.h5ad")  # output of standard pipeline',
      '',
      '# DEG between two groups (Wilcoxon)',
      'sc.tl.rank_genes_groups(adata, groupby="leiden", groups=["' +
        group1 +
        '"], reference="' +
        group2 +
        '", method="wilcoxon")',
      'sc.pl.rank_genes_groups(adata, n_genes=20, sharey=False)',
      '',
      'deg = sc.get.rank_genes_groups_df(adata, group="' + group1 + '")',
      'deg.to_csv("deg_results.csv", index=False)',
      'print(f"Top markers: {deg.head().names.tolist()}")',
      '',
    ].join('\n');
  }

  if (type === 'enrichment') {
    return [
      'import gseapy as gp',
      'import pandas as pd',
      '',
      '# DEG list (from prior analysis)',
      'deg = pd.read_csv("deg_results.csv")',
      'gene_list = deg[deg.pvals_adj < 0.05].names.tolist()',
      '',
      '# GO enrichment',
      'enr_go = gp.enrichr(gene_list=gene_list, gene_sets=["GO_Biological_Process_2023"], organism="human")',
      'enr_go.results.to_csv("go_enrichment.csv", index=False)',
      '',
      '# KEGG enrichment',
      'enr_kegg = gp.enrichr(gene_list=gene_list, gene_sets=["KEGG_2021_Human"], organism="human")',
      'enr_kegg.results.to_csv("kegg_enrichment.csv", index=False)',
      '',
      'print("Top GO:", enr_go.results.Term.head(5).tolist())',
      'print("Top KEGG:", enr_kegg.results.Term.head(5).tolist())',
      '',
    ].join('\n');
  }

  if (type === 'cell_annotation') {
    return [
      'import scanpy as sc',
      'import pandas as pd',
      '',
      'adata = sc.read_h5ad("result.h5ad")',
      '',
      '# Manual annotation against curated marker sets (PanglaoDB / CellMarker 2.0)',
      'markers = {',
      '    "T cells": ["CD3D", "CD3E", "CD3G"],',
      '    "CD4+ T": ["CD4", "IL7R"],',
      '    "CD8+ T": ["CD8A", "CD8B"],',
      '    "B cells": ["CD79A", "CD79B", "MS4A1"],',
      '    "NK": ["GNLY", "NKG7"],',
      '    "Monocytes": ["CD14", "LYZ"],',
      '    "DC": ["FCER1A", "CST3"],',
      '}',
      'sc.pl.dotplot(adata, markers, groupby="leiden", standard_scale="var")',
      '',
      '# Assign labels manually based on dotplot inspection',
      'cluster_labels = {',
      '    # "0": "CD4+ T",',
      '    # "1": "Monocytes",',
      '    # ... (fill in based on inspection)',
      '}',
      'adata.obs["cell_type"] = adata.obs["leiden"].map(cluster_labels)',
      'sc.pl.umap(adata, color=["cell_type"])',
      '',
      'adata.write_h5ad("result_annotated.h5ad")',
      '',
    ].join('\n');
  }

  if (type === 'scrna_integration') {
    return [
      'import scanpy as sc',
      'import scanpy.external as sce  # pip install harmonypy',
      '',
      '# Load combined dataset (each sample tagged in adata.obs["sample"])',
      'adata = sc.read_h5ad("combined.h5ad")',
      '',
      '# Standard preprocessing',
      'sc.pp.normalize_total(adata, target_sum=1e4)',
      'sc.pp.log1p(adata)',
      'sc.pp.highly_variable_genes(adata, n_top_genes=2000, batch_key="sample")',
      'adata = adata[:, adata.var.highly_variable]',
      'sc.pp.scale(adata)',
      'sc.tl.pca(adata, n_comps=30)',
      '',
      '# Harmony integration',
      'sce.pp.harmony_integrate(adata, key="sample")',
      '',
      '# Re-cluster on Harmony embedding',
      'sc.pp.neighbors(adata, n_pcs=30, use_rep="X_pca_harmony")',
      'sc.tl.leiden(adata, resolution=0.5)',
      'sc.tl.umap(adata)',
      'sc.pl.umap(adata, color=["sample", "leiden"], wspace=0.4)',
      '',
      'adata.write_h5ad("integrated.h5ad")',
      '',
    ].join('\n');
  }

  if (type === 'trajectory') {
    return [
      'import scanpy as sc',
      '# Pseudotime is best done with palantir or scVelo in Python.',
      '# For Monocle3-equivalent results, the recommended Python tool is PAGA + diffmap:',
      '',
      'adata = sc.read_h5ad("result.h5ad")',
      '',
      'sc.tl.diffmap(adata)',
      'sc.tl.paga(adata, groups="leiden")',
      'sc.pl.paga(adata, plot=True)',
      'sc.tl.umap(adata, init_pos="paga")',
      '',
      '# Assign root cell (highest expression of stem marker)',
      'root = (adata.obs.leiden == "0").idxmax()  # adjust manually',
      'adata.uns["iroot"] = adata.obs_names.get_loc(root)',
      'sc.tl.dpt(adata)',
      '',
      'sc.pl.umap(adata, color=["dpt_pseudotime", "leiden"])',
      '',
    ].join('\n');
  }

  if (type === 'communication') {
    return [
      '# Cell-cell communication in Python: use CellChat (R) directly via reticulate, or:',
      '# - cellphonedb (https://github.com/ventolab/CellphoneDB)',
      '# - LIANA (https://github.com/saezlab/liana-py)',
      '',
      'import liana as li',
      'import scanpy as sc',
      '',
      'adata = sc.read_h5ad("result_annotated.h5ad")',
      '',
      'li.mt.rank_aggregate(adata, groupby="cell_type", resource_name="consensus", verbose=True)',
      'li.pl.dotplot(adata, top_n=20, orderby="magnitude_rank", filterby="specificity_rank", filter_lambda=lambda x: x <= 0.05)',
      '',
    ].join('\n');
  }

  // Fallback
  return [
    '# Python equivalent for analysis type "' + type + '" is not yet built into BioF3.',
    '# Please refer to the R script and consult scanpy / squidpy / liana docs.',
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
  _METHODS_CITATIONS,
};
