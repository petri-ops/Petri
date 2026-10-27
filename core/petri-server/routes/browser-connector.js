'use strict';

/**
 * routes/browser-connector.js — BLOCK-269（C-40 尾项）浏览器连接器 REST 面。
 *
 * 与 agent 工具共用同一执行面（agent-tools/browser-tools.js → helpers/browser-connector.js
 * 单一真相）：connect/act/status/disconnect 是薄包装，供实机 flow、面板与未来驱动方使用；
 * 另有 POST /action-result 回传面（BrowserPanel webview 执行完成 → resolve pending 动作）。
 *
 * 安全边界（helpers 层已把，本路由不重复实现）：
 *  - 动作白名单/私网硬拒/allowedOrigins/ackToken 审批门全在 connector.act；
 *  - 回传面只认随机 actionId（不可猜）；结果只 JSON，有界（connector 收尾再截 20k）。
 */

const express = require('express');
const tools = require('../agent-tools/browser-tools');

function requireUser(req, res) {
  const userId = req.user && req.user.id;
  if (!userId) {
    res.status(401).json({ ok: false, error: '未登录' });
    return null;
  }
  return userId;
}

module.exports = function registerBrowserConnector(app) {
  const json = express.json({ limit: '256kb' });

  app.post('/api/browser-connector/connect', json, async (req, res) => {
    if (!requireUser(req, res)) return;
    const body = req.body || {};
    res.json(await tools.browser_connect({ allowedOrigins: body.allowedOrigins }));
  });

  app.post('/api/browser-connector/act', json, async (req, res) => {
    if (!requireUser(req, res)) return;
    try {
      res.json(await tools.browser_act(req.body || {}));
    } catch (error) {
      res.status(500).json({ ok: false, error: 'browser_act_failed', message: String(error && error.message || error) });
    }
  });

  app.get('/api/browser-connector/status', async (req, res) => {
    if (!requireUser(req, res)) return;
    res.json(await tools.browser_status());
  });

  app.post('/api/browser-connector/disconnect', async (req, res) => {
    if (!requireUser(req, res)) return;
    res.json(await tools.browser_disconnect());
  });

  app.post('/api/browser-connector/action-result', json, (req, res) => {
    if (!requireUser(req, res)) return;
    const { actionId, ok, result, error, message } = req.body || {};
    if (typeof actionId !== 'string' || !actionId) {
      res.status(400).json({ ok: false, error: 'action_id_required' });
      return;
    }
    const resolved = tools.resolveBrowserAction(actionId, { ok, result, error, message });
    if (!resolved) {
      res.status(404).json({ ok: false, error: 'action_not_pending' });
      return;
    }
    res.json({ ok: true });
  });
};
