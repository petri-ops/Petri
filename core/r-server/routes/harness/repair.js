'use strict';

/**
 * routes/harness/repair.js — repair 子域（PHASE 2.2a）
 *
 * 下沉的端点（来自 routes/harness.js 第 644-688 行）：
 *   POST /api/harness/repair
 *
 * 共享 helper 走 `routes/_helpers/harness-shared`：
 *   - authorizeAndResolveOptions / loadHarnessModule
 *
 * 行为 100% 兼容：try/catch 顺序、status code、response shape 保持不变。
 */

const express = require('express');
const {
  authorizeAndResolveOptions,
  loadHarnessModule,
} = require('../_helpers/harness-shared');

module.exports = {
  register(app) {
    app.post('/api/harness/repair', express.json({ limit: '1mb' }), async (req, res) => {
      try {
        const options = authorizeAndResolveOptions(req, res);
        if (!options) return;
        const manifest = req.body && req.body.manifest;
        if (!manifest || typeof manifest !== 'object') {
          return res.status(400).json({ ok: false, error: 'missing_manifest' });
        }
        const harness = await loadHarnessModule();
        const platform = harness.createLocalHarnessPlatform(options);
        const scoped = harness.indexHarnessScope({ ...options, platform });
        const executionContext = harness.createHarnessExecutionContext({
          ...options,
          platform,
          scopeInfo: scoped.scope,
          manifest,
        });
        const preferredPaths = req.body && req.body.activeArtifactName
          ? [String(req.body.activeArtifactName)]
          : [];
        const inputSuggestions = harness.suggestInputBindings(manifest, scoped.index, { preferredPaths });
        const repair = harness.repairHarnessParams(manifest, scoped.index, req.body.params || {}, {
          inputSuggestions,
          useAbsolutePaths: true,
        });
        const diagnostics =
          typeof harness.diagnoseHarnessRunReadiness === 'function'
            ? harness.diagnoseHarnessRunReadiness(manifest, scoped.index, req.body.params || {}, {
                repair,
                inputSuggestions,
                executionContext,
              })
            : null;
        res.json({
          ok: true,
          scope: scoped.scope,
          index: scoped.promptSummary,
          repair,
          diagnostics,
          executionContext,
        });
      } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
      }
    });
  },
};
