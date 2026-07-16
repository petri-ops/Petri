/**
 * routes/ai-settings-api.js — AI 设置 HTTP 路由（桌面版）
 *
 * 前端通过这些端点读写 AI 配置（API key、provider 选择）。
 * Web 版也可以用（但 key 来源不同：web 版走 env，桌面版走用户设置文件）。
 */

const express = require('express');
const { getAiSettings, saveAiSettings, testApiKey, getChatProviderName, getEmbedProviderName } = require('../helpers/ai-settings');

function registerAiSettingsRoutes(app) {
  // 获取当前 AI 设置（不返回完整 key，只返回 mask 后的）
  app.get('/api/ai/settings', (req, res) => {
    const settings = getAiSettings();
    const masked = {};
    for (const [key, value] of Object.entries(settings)) {
      if (key.endsWith('_api_key') && typeof value === 'string' && value.length > 8) {
        masked[key] = value.slice(0, 4) + '****' + value.slice(-4);
        masked[key + '_configured'] = true;
      } else if (key.endsWith('_api_key')) {
        masked[key] = value ? '****' : '';
        masked[key + '_configured'] = !!value;
      } else {
        masked[key] = value;
      }
    }
    masked.chat_provider = getChatProviderName();
    masked.embed_provider = getEmbedProviderName();
    res.json({ status: 'ok', settings: masked });
  });

  // 保存 AI 设置
  app.post('/api/ai/settings', express.json(), (req, res) => {
    const incoming = req.body || {};
    const current = getAiSettings();
    // 合并：只更新传入的字段（空 key 不覆盖已有 key）
    const merged = { ...current };
    for (const [key, value] of Object.entries(incoming)) {
      if (key.endsWith('_api_key')) {
        // 空字符串不覆盖（前端可能发空表示不改）
        if (value && value.length > 0) {
          merged[key] = value;
        }
      } else {
        merged[key] = value;
      }
    }
    saveAiSettings(merged);
    res.json({ status: 'ok' });
  });

  // 测试 API key 连通性
  app.post('/api/ai/settings/test', express.json(), async (req, res) => {
    const { provider, apiKey } = req.body || {};
    if (!provider || !apiKey) {
      return res.status(400).json({ ok: false, message: '缺少 provider 或 apiKey' });
    }
    const result = await testApiKey(provider, apiKey);
    res.json(result);
  });
}

module.exports = { registerAiSettingsRoutes };
