/**
 * routes/ai-settings-api.js — AI 设置 HTTP 路由（桌面版）
 *
 * 前端通过这些端点读写 AI 配置（API key、provider 选择）。
 * Web 版也可以用（但 key 来源不同：web 版走 env，桌面版走用户设置文件）。
 */

const express = require('express');
const { getAiSettings, saveAiSettings, testApiKey, getChatProviderName, getEmbedProviderName, getGenerationDefaults, saveGenerationDefaults } = require('../helpers/ai-settings');

/**
 * UI-696 — 模型菜单快捷面只送兼容快照 chat_model_presets 时，把窗口同步进
 * 权威的 model_profiles（token 预算/裁剪实际读它），同时把同一窗口写回兼容快照，
 * 避免读 presets 的消费者看到旧值（第二真相漂移）。不整坨替换快照，
 * 每模型其它偏好一律沿用 current。设置页同时送两份时原样返回，行为不变。
 */
function syncPresetContextWindow(current, incoming) {
  const patch = { ...incoming };
  if (!Array.isArray(incoming.chat_model_presets) || Array.isArray(incoming.model_profiles)) return patch;
  const windowById = new Map(
    incoming.chat_model_presets
      .filter((preset) => preset && typeof preset === 'object' && preset.id)
      .map((preset) => [String(preset.id), preset.contextWindow]),
  );
  patch.model_profiles = (current.model_profiles || []).map((profile) => {
    const next = windowById.get(profile.id);
    return typeof next === 'number' && next > 0
      ? { ...profile, contextWindow: Math.round(next) }
      : profile;
  });
  patch.chat_model_presets = (current.chat_model_presets || []).map((preset) => {
    const next = windowById.get(preset.id);
    return typeof next === 'number' && next > 0
      ? { ...preset, contextWindow: Math.round(next) }
      : preset;
  });
  return patch;
}

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
  // BLOCK-259 D1 — 模型计价表（单一源=ai-usage 的 AI_PRICING；选择器只读展示）。
  // 延迟 require：避免路由注册期触发 ai_usage 建表/连接。
  // BLOCK-264（C-37）— 进程内缓存（表为静态常量，无失效源；重启即新读）。
  let pricingCache = null;
  app.get('/api/ai/pricing', (_req, res) => {
    if (!pricingCache) {
      const { AI_PRICING } = require('../helpers/ai-usage');
      pricingCache = { ...AI_PRICING };
    }
    res.json({ status: 'ok', pricing: pricingCache, cached: true });
  });

  // BLOCK-264（C-37）— 模型选择器权限来源（model-access 族；读投影 + 校验写）。
  app.get('/api/ai/model-access', (_req, res) => {
    const modelAccess = require('../helpers/model-access');
    const store = modelAccess.readStore();
    res.json({
      status: 'ok',
      mode: store.allowedModels.length > 0 ? 'allowlist' : 'open',
      allowedModels: store.allowedModels,
      reasonNotes: store.reasonNotes,
    });
  });
  app.put('/api/ai/model-access', express.json(), (req, res) => {
    const modelAccess = require('../helpers/model-access');
    const saved = modelAccess.saveModelAccess(req.body || {});
    if (!saved.ok) return res.status(400).json({ status: 'error', error: saved.error, diagnostics: saved.diagnostics });
    const store = modelAccess.readStore();
    return res.json({
      status: 'ok',
      mode: store.allowedModels.length > 0 ? 'allowlist' : 'open',
      allowedModels: store.allowedModels,
      reasonNotes: store.reasonNotes,
    });
  });

  // 获取当前 AI 设置。密钥已与普通设置分离，因此这里不会出现明文 key。
  app.get('/api/ai/settings', (req, res) => {    const settings = getAiSettings();
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
    const patch = syncPresetContextWindow(current, incoming);
    const saved = saveAiSettings({ ...current, ...patch });
    // BLOCK-203 W4a P6 — 被丢弃的未知顶层键要看得见（白名单过滤不静默）
    res.json({ status: 'ok', ...(saved && saved.dropped && saved.dropped.length ? { diagnostics: saved.dropped } : {}) });
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
      // BLOCK-199 P3 — 写侧守卫拒绝是用户输入问题（400 + 结构化诊断），不是服务器故障。
      if (e && e.code === 'config_value_rejected') {
        return res.status(400).json({ status: 'error', error: e.code, diagnostics: e.diagnostics || [] });
      }
      return res.status(500).json({ status: 'error', error: e.message });
    }
  });

  // BLOCK-200 P2 — 推理档位（默认档/Anthropic 预算/逐协议映射）读写面。
  // 与 generation-defaults 同一文件同一写入者，故挂在本模块而非另起 route 文件。
  app.get('/api/ai/reasoning-defaults', (req, res) => {
    try {
      return res.json({ status: 'ok', reasoning: require('../helpers/reasoning-config').getReasoningSnapshot() });
    } catch (e) {
      return res.status(500).json({ status: 'error', error: e.message });
    }
  });

  app.put('/api/ai/reasoning-defaults', express.json({ limit: '8kb' }), (req, res) => {
    try {
      const snapshot = require('../helpers/reasoning-config').saveReasoning(req.body || {});
      return res.json({ status: 'ok', reasoning: snapshot });
    } catch (e) {
      if (e && e.code === 'config_value_rejected') {
        return res.status(400).json({ status: 'error', error: e.code, diagnostics: e.diagnostics || [] });
      }
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

  // BLOCK-244 Q1-REM — 逐工具审批策略（A1/A8）：allow/ask/deny。
  // 读侧附静态工具清单（名称/描述/合同摘要），供设置页搜索与逐工具编辑。
  app.get('/api/ai/tool-approval-policy', (req, res) => {
    try {
      const helper = require('../helpers/tool-approval-policy');
      const registry = require('../agent-tools/registry');
      const store = helper.readStore();
      const tools = registry.getProviderToolDefs().map((definition) => {
        const name = definition && definition.function ? definition.function.name : '';
        const contract = registry.getToolContract(name);
        return {
          name,
          description: String((definition && definition.function && definition.function.description) || '').slice(0, 300),
          category: contract ? contract.category : null,
          sideEffect: contract ? contract.sideEffect : null,
          riskTier: contract ? contract.riskTier : null,
        };
      }).filter((tool) => tool.name).sort((a, b) => a.name.localeCompare(b.name));
      res.json({ status: 'ok', modes: store.tools, tools });
    } catch (error) {
      res.status(500).json({ status: 'error', error: error.message });
    }
  });

  app.put('/api/ai/tool-approval-policy', express.json(), (req, res) => {
    try {
      const helper = require('../helpers/tool-approval-policy');
      const body = req.body || {};
      const probe = helper.validateModes(Array.isArray(body.modes) ? body.modes : []);
      if (!probe.ok) {
        res.status(400).json({ status: 'error', error: 'policy_rejected', diagnostics: probe.diagnostics });
        return;
      }
      const result = helper.writeStore({ version: helper.VERSION, tools: probe.modes });
      if (!result.ok) {
        res.status(400).json({ status: 'error', error: result.error, diagnostics: result.diagnostics || [] });
        return;
      }
      res.json({ status: 'ok', count: Object.keys(probe.modes).length, modes: probe.modes });
    } catch (error) {
      res.status(500).json({ status: 'error', error: error.message });
    }
  });

  // BLOCK-324 原因码 taxonomy — 词表出口：封闭 REASONS 注册表（code/category/template）。
  app.get('/api/ai/reason-codes', (req, res) => {
    try {
      const registry = require('../helpers/reason-codes');
      res.json({ status: 'ok', categories: registry.REASON_CATEGORIES, reasons: registry.listReasonCodes() });
    } catch (error) {
      res.status(500).json({ status: 'error', error: error.message });
    }
  });

  // BLOCK-323 放权坡道 — 观察复盘面：未复盘观察分组 + 近期自动放行 + 规则变更留痕。
  // 诚实状态公理：unreviewedCount === unreviewed.length 的聚合来源同表同查询。
  app.get('/api/ai/policy-observations', async (req, res) => {
    try {
      const store = require('../helpers/policy-observation-store');
      const [unreviewed, autoAllow, policyChanges, unreviewedCount] = await Promise.all([
        store.listUnreviewed(),
        store.listAutoAllow(20),
        store.listPolicyChanges(20),
        store.unreviewedCount(),
      ]);
      res.json({ status: 'ok', unreviewed, autoAllow, policyChanges, unreviewedCount });
    } catch (error) {
      res.status(500).json({ status: 'error', error: error.message });
    }
  });

  app.post('/api/ai/policy-observations/review', express.json(), async (req, res) => {
    try {
      const store = require('../helpers/policy-observation-store');
      const body = req.body || {};
      // BLOCK-337 P7③ — decision: 'misfire' 让账本桥把该行命中计为误拦（降级数据源）
      const result = await store.markReviewed({ ids: body.ids, all: body.all === true, decision: body.decision });
      if (!result.ok) {
        res.status(400).json({ status: 'error', error: 'review_input_invalid' });
        return;
      }
      res.json({ status: 'ok', updated: result.updated || 0 });
    } catch (error) {
      res.status(500).json({ status: 'error', error: error.message });
    }
  });
}

module.exports = { registerAiSettingsRoutes, computeVisionConfigured, syncPresetContextWindow };
