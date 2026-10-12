/**
 * routes/ai-settings-api.js — AI 设置 HTTP 路由（桌面版）
 *
 * 前端通过这些端点读写 AI 配置（API key、provider 选择）。
 * Web 版也可以用（但 key 来源不同：web 版走 env，桌面版走用户设置文件）。
 */

const express = require('express');
const { getAiSettings, saveAiSettings, testApiKey, getChatProviderName, getEmbedProviderName, getGenerationDefaults, saveGenerationDefaults } = require('../helpers/ai-settings');

/**
 * BLOCK-150 加映 — vision 角色是否可用（档位在场且凭据可解析）。
 * 前端据此对图片输入做前置阻断（未配置时贴图/拖图即提示，替代后置 vision_failed）。
 * getCredential 可注入（测试）；生产走 model-gateway 同源解析（credential store 显式配置唯一来源，env 兜底已移除）。
 */
function computeVisionConfigured(settings, getCredentialFn) {
  try {
    if (typeof getCredentialFn !== 'function') {
      // 延迟 require：避免测试环境拉起完整 gateway 装配
      // eslint-disable-next-line global-require
      getCredentialFn = require('../helpers/model-gateway').getCredential;
    }
    const bindings = settings.model_role_bindings || {};
    const profiles = settings.model_profiles || [];
    const profile = profiles.find((p) => p.id === bindings.vision)
      || profiles.find((p) => (p.roles || []).includes('vision'));
    if (!profile) return false;
    return !!getCredentialFn(profile.credentialRef, profile);
  } catch {
    return false;
  }
}

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
        vision_configured: computeVisionConfigured(settings),
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
  // BLOCK-172 CP-7 — 生成参数全局缺省（temperature/maxTokens；env 覆盖优先）。
  app.get('/api/ai/generation-defaults', (req, res) => {
    try {
      return res.json({ status: 'ok', generation: getGenerationDefaults() });
    } catch (e) {
      return res.status(500).json({ status: 'error', error: e.message });
    }
  });

  app.put('/api/ai/generation-defaults', express.json(), (req, res) => {
    try {
      const generation = saveGenerationDefaults(req.body || {});
      return res.json({ status: 'ok', generation });
    } catch (e) {
      return res.status(500).json({ status: 'error', error: e.message });
    }
  });

  app.post('/api/ai/settings/test', express.json(), async (req, res) => {
    const { provider, profile, apiKey } = req.body || {};
    if (!provider && !profile) {
      return res.status(400).json({ ok: false, message: '缺少模型配置' });
    }
    const result = await testApiKey(profile || provider, apiKey);
    res.json(result);
  });

  // BLOCK-160 W2 P2（ORC-1）— 用户 Agent 规则 CRUD（rules.json 持久化，
  // 拦截器经 helper 缓存读取；整单 PUT + 单条 DELETE，校验在 helper saveUserRules）
  app.get('/api/ai/agent-rules', (req, res) => {
    try {
      const rules = require('../helpers/agent-user-rules').loadUserRules();
      res.json({ status: 'ok', rules });
    } catch (error) {
      res.status(500).json({ status: 'error', error: error.message });
    }
  });

  app.put('/api/ai/agent-rules', express.json(), (req, res) => {
    try {
      const result = require('../helpers/agent-user-rules').saveUserRules(
        Array.isArray(req.body && req.body.rules) ? req.body.rules : []
      );
      if (!result.ok) {
        res.status(400).json({ status: 'error', error: result.error });
        return;
      }
      res.json({ status: 'ok', count: result.count });
    } catch (error) {
      res.status(500).json({ status: 'error', error: error.message });
    }
  });

  app.delete('/api/ai/agent-rules/:id', (req, res) => {
    try {
      const helper = require('../helpers/agent-user-rules');
      const remaining = helper.loadUserRules().filter((r) => r.id !== req.params.id);
      const result = helper.saveUserRules(remaining);
      if (!result.ok) {
        res.status(400).json({ status: 'error', error: result.error });
        return;
      }
      res.json({ status: 'ok', count: result.count });
    } catch (error) {
      res.status(500).json({ status: 'error', error: error.message });
    }
  });
}

module.exports = { registerAiSettingsRoutes, computeVisionConfigured };
