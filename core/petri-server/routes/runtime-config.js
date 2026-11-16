'use strict';

/**
 * routes/runtime-config.js — 网络代理与运行时策略 REST 面（BLOCK-202 W3）。
 *
 *  GET  /api/network        → 已配置/已应用/生效 NO_PROXY/是否需重启
 *  PUT  /api/network        → 写代理四项（未知键/非法形状 400 + diagnostics；**需重启生效**）
 *  GET  /api/runtime-policy → 审批默认档位/并发/深度/工具黑名单（含 env 遮蔽报告）
 *  PUT  /api/runtime-policy → 写策略（审批与黑名单即时生效；并发/深度下一轮派生生效）
 *  GET  /api/web-access    → 联网检索授权/预算快照（BLOCK-247 Q2b；默认关）
 *  PUT  /api/web-access    → 写联网授权（**即时生效**，无 restartRequired 语义）
 *  GET  /api/ocr-access    → 扫描件 OCR 授权快照（BLOCK-454 P3；默认关）
 *  PUT  /api/ocr-access    → 写 OCR 授权（**即时生效**；key 走凭据族不在本面）
 *
 * 拒绝形状与 keymap/generation/config-transfer 同构：400 + 结构化 diagnostics。
 * 代理与 CA 只在进程启动时被 Node 读取，因此 PUT 只做持久化与「需重启」标记，不谎称已生效。
 */

const express = require('express');
const network = require('../helpers/network-config');
const runtime = require('../helpers/runtime-policy');
// BLOCK-247（Q2b）— 联网检索授权面（默认关；即时生效，无"需重启"语义）
const webSearch = require('../helpers/web-search-config');
// BLOCK-454（P3）— 扫描件 OCR 授权面（默认关；即时生效；key 走凭据族）
const ocrConfig = require('../helpers/ocr-config');

function sendRejection(res, error) {
  if (error && error.message === 'config_value_rejected') {
    return res.status(400).json({ status: 'error', error: error.message, diagnostics: error.diagnostics || [] });
  }
  return res.status(500).json({ status: 'error', error: error.message });
}

module.exports = function mountRuntimeConfig(app) {
  app.get('/api/network', (req, res) => {
    try {
      return res.json({ status: 'ok', network: network.getNetworkSnapshot() });
    } catch (error) {
      return res.status(500).json({ status: 'error', error: error.message });
    }
  });

  app.put('/api/network', express.json({ limit: '16kb' }), (req, res) => {
    try {
      const snapshot = network.saveNetworkConfig(req.body || {});
      // 写侧只落盘；生效要重启后端（Node 只在启动时读 proxy/CA env）
      return res.json({ status: 'ok', network: snapshot, restartRequired: true });
    } catch (error) {
      return sendRejection(res, error);
    }
  });

  app.get('/api/runtime-policy', (req, res) => {
    try {
      return res.json({ status: 'ok', runtime: runtime.getRuntimeSnapshot() });
    } catch (error) {
      return res.status(500).json({ status: 'error', error: error.message });
    }
  });

  app.put('/api/runtime-policy', express.json({ limit: '16kb' }), (req, res) => {
    try {
      const snapshot = runtime.saveRuntimePolicy(req.body || {});
      return res.json({ status: 'ok', runtime: snapshot });
    } catch (error) {
      return sendRejection(res, error);
    }
  });

  // —— BLOCK-247（Q2b）联网检索授权与预算 ——
  // 与 /api/network 的差别要说清：这里**即时生效**（每次出网现读），不返回 restartRequired。
  app.get('/api/web-access', (req, res) => {
    try {
      return res.json({ status: 'ok', webAccess: webSearch.getSnapshot() });
    } catch (error) {
      return res.status(500).json({ status: 'error', error: error.message });
    }
  });

  app.put('/api/web-access', express.json({ limit: '16kb' }), (req, res) => {
    try {
      const snapshot = webSearch.saveWebSearchConfig(req.body || {});
      return res.json({ status: 'ok', webAccess: snapshot });
    } catch (error) {
      return sendRejection(res, error);
    }
  });

  // —— BLOCK-454（P3）扫描件 OCR 授权与参数 ——
  // 与 /api/web-access 同构：即时生效、400 + diagnostics、默认关（云调用=付费副作用）。
  app.get('/api/ocr-access', (req, res) => {
    try {
      return res.json({ status: 'ok', ocrAccess: ocrConfig.getSnapshot() });
    } catch (error) {
      return res.status(500).json({ status: 'error', error: error.message });
    }
  });

  app.put('/api/ocr-access', express.json({ limit: '16kb' }), (req, res) => {
    try {
      const snapshot = ocrConfig.saveOcrConfig(req.body || {});
      return res.json({ status: 'ok', ocrAccess: snapshot });
    } catch (error) {
      return sendRejection(res, error);
    }
  });
};
