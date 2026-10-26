'use strict';

/**
 * routes/ai-agent/suggestions.js — BLOCK-264（C-36）模型侧建议端点。
 *
 *   POST /api/ai/agent/suggest-followups — 用当前 chat 模型生成 3 条追问建议
 *   POST /api/ai/agent/polish-message    — 模型润色（返回草稿文本；调用方只填输入框，不自动发送）
 *
 * 红线：两个端点都只产出「建议文本」；正文入参截断（6k 字）；失败如实错误码，
 * 不回落关键词模板冒充（前端关键词追问仍是独立动作）。
 */

const {
  generateFollowUpSuggestions,
  MAX_INPUT_CHARS,
} = require('../../helpers/assistant-suggestions');

function requireUser(req, res) {
  const userId = req.user && req.user.id;
  if (!userId) {
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return null;
  }
  return userId;
}

module.exports = {
  register(app) {
    app.post('/api/ai/agent/suggest-followups', async (req, res) => {
      const userId = requireUser(req, res);
      if (!userId) return;
      const content = typeof (req.body || {}).content === 'string' ? req.body.content : '';
      if (!content.trim()) return res.status(400).json({ ok: false, error: 'content_required' });
      if (content.length > MAX_INPUT_CHARS * 2) return res.status(400).json({ ok: false, error: 'content_too_large' });
      const result = await generateFollowUpSuggestions({ assistantContent: content, userId });
      if (!result.ok) {
        const status = result.error === 'no_credential' ? 503 : 502;
        return res.status(status).json({ ok: false, error: result.error });
      }
      return res.json({ ok: true, suggestions: result.suggestions, model: result.model });
    });

    app.post('/api/ai/agent/polish-message', async (req, res) => {
      const userId = requireUser(req, res);
      if (!userId) return;
      const content = typeof (req.body || {}).content === 'string' ? req.body.content : '';
      if (!content.trim()) return res.status(400).json({ ok: false, error: 'content_required' });
      // 润色与追问共用模型链路（系统提示不同），保持同界截断
      const { generatePolishedDraft } = require('../../helpers/assistant-suggestions');
      const result = await generatePolishedDraft({ assistantContent: content, userId });
      if (!result.ok) {
        const status = result.error === 'no_credential' ? 503 : 502;
        return res.status(status).json({ ok: false, error: result.error });
      }
      return res.json({ ok: true, draft: result.draft, model: result.model });
    });
  },
};
