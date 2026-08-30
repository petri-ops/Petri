/**
 * routes/ai-legacy.js — small AI compatibility/support endpoints.
 *
 * These routes are platform-owned but remain mounted from the historical
 * biof3-server route registry during the gradual backend structure convergence.
 */
const express = require('express');

const {
  lookupCellType,
  callDeepSeekSimple,
  buildInterpretPrompt,
} = require('../helpers/interpret');
const {ackActToken} = require('../agent-tools');
const dbMod = require('../db');

module.exports = function mountAiLegacy(app) {
  app.post('/api/ai/interpret', express.json({limit: '128kb'}), async (req, res) => {
    const {analysisType, summary, topMarkers} = req.body || {};
    if (!analysisType || !summary) {
      return res.status(400).json({status: 'error', error: '缺少参数'});
    }

    const localResults = {};
    if (topMarkers) {
      for (const [cluster, markers] of Object.entries(topMarkers)) {
        const cellType = lookupCellType(markers);
        if (cellType) localResults[cluster] = cellType;
      }
    }

    const prompt = buildInterpretPrompt(analysisType, summary, {topMarkers});
    let aiText = null;
    if (prompt) {
      aiText = await callDeepSeekSimple(prompt);
    }

    if (!aiText) {
      if (analysisType === 'scrna_standard' || analysisType === 'recluster') {
        const {nCells, nGenes, nClusters} = summary;
        let fallback = '✓ 分析完成：' + (nCells || 0).toLocaleString() + ' 个细胞，' + (nGenes || 0).toLocaleString() + ' 个基因，识别出 ' + (nClusters || 0) + ' 个 cluster。';
        if (Object.keys(localResults).length > 0) {
          fallback += '\n\n初步细胞类型推断（基于 marker 查表）：';
          for (const [c, t] of Object.entries(localResults)) {
            fallback += '\n- Cluster ' + c + '：' + t;
          }
        }
        fallback += '\n\n建议：使用 SingleR 做正式细胞注释，或对感兴趣的 cluster 做 DEG 分析。';
        aiText = fallback;
      } else {
        aiText = '分析已完成。请查看下方图表和数据文件了解详情。';
      }
    }

    res.json({
      status: 'ok',
      interpretation: aiText,
      cellTypeHints: localResults,
      source: aiText && !aiText.startsWith('✓') ? 'model_gateway' : 'fallback',
    });
  });

  app.post('/api/ai/act-ack/:token', express.json({limit:'8kb'}), (req, res) => {
    const userId = req.user && req.user.id;
    if (!userId) return res.status(401).json({status: 'error', error: '未授权'});
    const ok = ackActToken(req.params.token, req.body || {ok: true});
    res.json({status: 'ok', acknowledged: ok});
  });

  // TOOL_JOB_APPROVAL_v1（阶段2 Task3）：重操作 run_tool 强制确认 ack 路由。
  // 前端确认卡用户点"开始/取消"后 POST 这里，后端落 ack_status=approved/rejected。
  // agent 下次重调 run_tool(ackToken) 时读到 approved 才续跑。
  app.post('/api/ai/run-tool-ack/:token', express.json({limit:'8kb'}), (req, res) => {
    const userId = req.user && (req.user.id || req.user.userId);
    if (!userId) return res.status(401).json({status: 'error', error: '未授权'});
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    if (!Object.prototype.hasOwnProperty.call(body, 'projectId')
        || !Object.prototype.hasOwnProperty.call(body, 'conversationId')) {
      return res.status(400).json({status: 'error', error: 'approval_scope_required'});
    }
    const approve = body.approve !== false;
    const projectId = typeof body.projectId === 'string' && body.projectId.trim()
      ? body.projectId.trim()
      : null;
    const conversationId = typeof body.conversationId === 'string' && body.conversationId.trim()
      ? body.conversationId.trim()
      : null;
    // Request scope is an expectation only; persisted Job identity is immutable.
    const job = dbMod.ackToolJob(req.params.token, approve, { userId, projectId, conversationId });
    if (!job) return res.status(404).json({status: 'error', error: 'token_not_found'});
    res.json({status: 'ok', ackStatus: job.ack_status, toolJobId: job.id});
  });

};
