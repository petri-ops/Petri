'use strict';

/** routes/ai-agent/capabilities.js — BLOCK-458 模型能力探测端点。 */

const { probeReasoningCapability } = require('../../helpers/model-capability-probe');

module.exports = {
  register(app) {
    app.post('/api/ai/agent/probe-model-capability', async (req, res) => {
      const userId = req.user && req.user.id;
      if (!userId) {
        res.status(401).json({ ok: false, error: 'unauthorized' });
        return;
      }
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const result = await probeReasoningCapability({
        profileId: typeof body.profileId === 'string' ? body.profileId : '',
        model: typeof body.model === 'string' ? body.model : undefined,
        userId,
      });
      if (!result.ok) {
        const status = result.error === 'profile_id_required' || result.error === 'profile_not_found'
          ? 400
          : result.error === 'timeout'
            ? 504
            : 502;
        res.status(status).json({ ok: false, verdict: 'error', error: result.error, message: result.message });
        return;
      }
      res.json({
        ok: true,
        verdict: result.verdict,
        profileId: result.profileId,
        requestedModel: result.requestedModel,
        model: result.model,
        provider: result.provider,
        evidence: result.evidence,
      });
    });
  },
};
