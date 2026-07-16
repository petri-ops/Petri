/**
 * routes/ai-report.js — Phase 6 report-generation endpoints.
 * Migrated from server.js as part of MODULES_BATCH1_v1.
 *
 * Endpoints:
 *   POST /api/ai/generate-caption     (was MODULES_CAPTION_v1)
 *   POST /api/ai/generate-methods
 *   POST /api/ai/export-report
 *   POST /api/ai/export-script
 */
const express = require('express');
const dbMod = require('../db');
const sqlite = dbMod.getSqliteForLegacyModules();

module.exports = function mountReportRoutes(app) {
  const fetch = (typeof globalThis.fetch === 'function') ? globalThis.fetch : require('node-fetch');

  function _record(usage) {
    try {
      const fn = (globalThis._biof3 && globalThis._biof3.recordAiUsage) || globalThis._biof3RecordAiUsage;
      if (typeof fn === 'function') fn(usage);
    } catch {}
  }

  // ---- caption (re-export of MODULES_CAPTION_v1) ----
  app.post('/api/ai/generate-caption', express.json({limit: '8kb'}), async (req, res) => {
    const userId = req.user && req.user.id;
    if (!userId) return res.status(401).json({status:'error', error:'未授权'});
    const {analysisId, plotName, plotFilename, language} = req.body || {};
    if (!analysisId || !plotName) return res.status(400).json({status:'error', error:'需要 analysisId 和 plotName'});
    const a = sqlite.prepare(`SELECT a.*, d.name AS dataset_name, d.n_cells, d.n_genes
      FROM analyses a JOIN datasets d ON a.dataset_id=d.id JOIN projects p ON d.project_id=p.id
      WHERE a.id=? AND p.user_id=?`).get(analysisId, userId);
    if (!a) return res.status(404).json({status:'error', error:'analysis_not_found'});
    let params = {};
    try { params = JSON.parse(a.params || '{}'); } catch {}
    let summary = null;
    try {
      const r = sqlite.prepare('SELECT results FROM analyses WHERE id=?').get(analysisId);
      if (r && r.results) { const rr = JSON.parse(r.results); summary = rr.summary; }
    } catch {}
    const lang = (language === 'en') ? 'en' : 'zh';
    const { getApiKey } = require('../helpers/ai-settings');
    const apiKey = getApiKey('deepseek');
    if (!apiKey) return res.status(500).json({status:'error', error:'no_api_key'});
    const context = [
      'Analysis type: ' + a.type,
      'Analysis name: ' + (a.name || ''),
      'Dataset: ' + (a.dataset_name || '') + ' (' + (a.n_cells || '?') + ' cells, ' + (a.n_genes || '?') + ' genes)',
      'Parameters: ' + JSON.stringify(params),
      summary ? 'Result summary: ' + JSON.stringify(summary) : '',
      'Plot name: ' + plotName,
      plotFilename ? 'Plot filename: ' + plotFilename : '',
    ].filter(Boolean).join('\n');
    const systemPrompt = lang === 'en'
      ? 'You write concise academic figure captions (1-3 sentences). Include key parameters when relevant. No markdown, no "Figure 1:" prefix.'
      : '你写简洁的学术图注（1-3 句话）。在相关时包含关键参数。不要 markdown，不要"图1："前缀，直接输出图注文本。';
    const userPrompt = (lang === 'en'
      ? 'Write a figure caption for this plot:\n'
      : '为以下图写一段图注：\n') + context;
    const start = Date.now();
    try {
      const resp = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {'Content-Type':'application/json', 'Authorization':'Bearer ' + apiKey},
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [{role:'system', content: systemPrompt}, {role:'user', content: userPrompt}],
          temperature: 0.3, max_tokens: 200, stream: false,
        }),
      });
      const data = await resp.json();
      const usage = (data && data.usage) || {};
      _record({userId, kind: 'caption', model: 'deepseek-chat', promptTokens: usage.prompt_tokens||0, completionTokens: usage.completion_tokens||0, latencyMs: Date.now()-start});
      const text = (((data || {}).choices || [])[0] || {}).message;
      const caption = String((text && text.content) || '').trim();
      if (!caption) return res.status(500).json({status:'error', error:'empty_response'});
      res.json({status:'ok', caption, language: lang, plotName});
    } catch (e) {
      res.status(500).json({status:'error', error: (e && e.message) || 'api_error'});
    }
  });

  // ---- generate-methods ----
  app.post('/api/ai/generate-methods', express.json({limit: '8kb'}), async (req, res) => {
    const userId = req.user && req.user.id;
    if (!userId) return res.status(401).json({status:'error', error:'未授权'});
    const {analysisId, planId, datasetId, language} = req.body || {};
    if (!analysisId && !planId && !datasetId) return res.status(400).json({status:'error', error:'需要 analysisId / planId / datasetId 之一'});
    const gather = globalThis._biof3 && globalThis._biof3.gatherAnalysisContextForMethods;
    const render = globalThis._biof3 && globalThis._biof3.renderMethodsParagraph;
    if (!gather || !render) return res.status(500).json({status:'error', error:'helpers_missing'});
    const ctx = gather(userId, {analysisId, planId, datasetId});
    if (!ctx) return res.status(404).json({status:'error', error:'未找到对应的数据'});
    if (ctx.analyses.length === 0) return res.json({status:'error', error:'no_analyses', message:'目标范围内没有可用于 Methods 的分析记录'});
    ctx._userId = userId;
    const r = await render(ctx, {language});
    if (r.error) return res.status(500).json({status:'error', ...r});
    res.json({status:'ok', methods: r.methods, language: r.language, sources: {analyses: ctx.analyses.length, datasets: ctx.datasets.length, plans: ctx.plans.length}});
  });

  // ---- export-report (PDF) ----
  app.post('/api/ai/export-report', express.json({limit: '8kb'}), async (req, res) => {
    const userId = req.user && req.user.id;
    if (!userId) return res.status(401).json({status:'error', error:'未授权'});
    const {analysisId, planId, datasetId, language} = req.body || {};
    if (!analysisId && !planId && !datasetId) return res.status(400).json({status:'error', error:'需要 analysisId / planId / datasetId 之一'});
    const renderPdf = globalThis._biof3 && globalThis._biof3.renderReportPdf;
    if (!renderPdf) return res.status(500).json({status:'error', error:'helpers_missing'});
    const username = req.user.username || null;
    const r = await renderPdf({userId, analysisId, planId, datasetId, language, username});
    if (r.error) return res.status(500).json({status:'error', ...r});
    res.json({status:'ok', url: r.url, sizeBytes: r.sizeBytes, sources: r.sources});
  });

  // ---- export-script ----
  app.post('/api/ai/export-script', express.json({limit: '8kb'}), async (req, res) => {
    const userId = req.user && req.user.id;
    if (!userId) return res.status(401).json({status:'error', error:'未授权'});
    const {analysisId, language} = req.body || {};
    if (!analysisId) return res.status(400).json({status:'error', error:'需要 analysisId'});
    const lang = (language === 'python') ? 'python' : 'r';
    const cleanR = globalThis._biof3 && globalThis._biof3.cleanRScriptForExport;
    const scriptHeader = globalThis._biof3 && globalThis._biof3.scriptHeader;
    const pythonEquiv = globalThis._biof3 && globalThis._biof3.pythonEquivalent;
    if (!cleanR || !scriptHeader || !pythonEquiv) return res.status(500).json({status:'error', error:'helpers_missing'});
    const a = sqlite.prepare(`SELECT a.*, d.name AS dataset_name, d.n_cells, d.n_genes
      FROM analyses a JOIN datasets d ON a.dataset_id=d.id JOIN projects p ON d.project_id=p.id
      WHERE a.id=? AND p.user_id=?`).get(analysisId, userId);
    if (!a) return res.status(404).json({status:'error', error:'analysis_not_found'});
    let params = {};
    try { params = JSON.parse(a.params || '{}'); } catch {}
    const analysis = {id: a.id, type: a.type, name: a.name, params, ossInputUrl: a.oss_input_url};
    if (!analysis.ossInputUrl) {
      const ds = sqlite.prepare('SELECT oss_url FROM datasets WHERE id=?').get(a.dataset_id);
      if (ds) analysis.ossInputUrl = ds.oss_url;
    }
    const dataset = {name: a.dataset_name, n_cells: a.n_cells, n_genes: a.n_genes};
    const generatedAt = new Date().toLocaleString('zh-CN', {hour12: false});
    const username = req.user.username || null;
    let body = '';
    if (lang === 'r') {
      try {
        const {generateRScript} = require('../task-manager');
        const task = {type: a.type, params, ossInputUrl: analysis.ossInputUrl || 'YOUR_INPUT_PATH', containerWorkDir: '/work'};
        body = cleanR(generateRScript(task), {});
      } catch (e) {
        body = '# Failed to regenerate R script: ' + (e && e.message);
      }
    } else {
      body = pythonEquiv(analysis, dataset);
    }
    const header = scriptHeader({analysis, dataset, language: lang, generatedAt, username});
    res.json({
      status: 'ok',
      language: lang,
      filename: 'biof3-' + (a.type) + '-' + (a.id || 'analysis') + (lang === 'python' ? '.py' : '.R'),
      script: header + body,
      bytes: (header + body).length,
    });
  });
};
