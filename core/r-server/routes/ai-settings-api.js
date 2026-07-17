/**
 * routes/ai-settings-api.js — AI 设置 HTTP 路由（桌面版）
 *
 * 前端通过这些端点读写 AI 配置（API key、provider 选择）。
 * Web 版也可以用（但 key 来源不同：web 版走 env，桌面版走用户设置文件）。
 */

const express = require('express');
const { getAiSettings, saveAiSettings, testApiKey, getChatProviderName, getEmbedProviderName } = require('../helpers/ai-settings');

function registerAiSettingsRoutes(app) {
  // 获取当前 AI 设置。密钥已与普通设置分离，因此这里不会出现明文 key。
  app.get('/api/ai/settings', (req, res) => {
    const settings = getAiSettings();
    res.json({
      status: 'ok',
      settings: {
        ...settings,
        chat_provider: getChatProviderName(),
        embed_provider: getEmbedProviderName(),
      },
    });
  });

  // 保存 AI 设置
  app.post('/api/ai/settings', express.json(), (req, res) => {
    const incoming = req.body || {};
    const current = getAiSettings();
    saveAiSettings({ ...current, ...incoming });
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
