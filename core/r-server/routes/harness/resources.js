'use strict';

/**
 * routes/harness/resources.js — resources 子域（PHASE 2.2a）
 *
 * 下沉的端点（来自 routes/harness.js 第 481-502 + 624-642 行）：
 *   GET /api/harness/resource-snapshot
 *   GET /api/harness/index
 *
 * 共享 helper 走 `routes/_helpers/harness-shared`：
 *   - authorizeAndResolveOptions / boolQuery
 *   - loadHarnessModule / availableHarnessManifests
 *
 * 行为 100% 兼容：try/catch 顺序、status code、response shape 保持不变。
 */

const fs = require('fs');
const cacheManager = require('../../cache-manager');
const db = require('../../db');
const { createRuntimeResourceSnapshot } = require('../../../shared-backend/runtime-resource-snapshot');
const {
  authorizeAndResolveOptions,
  boolQuery,
  loadHarnessModule,
} = require('../_helpers/harness-shared');

module.exports = {
  register(app) {
    app.get('/api/harness/resource-snapshot', async (_req, res) => {
      try {
        const disk = typeof cacheManager.getLocalDiskStats === 'function'
          ? await cacheManager.getLocalDiskStats()
          : null;
        let primaryMount = disk && Array.isArray(disk.mounts) ? disk.mounts[0] : null;
        if (!primaryMount && typeof fs.statfsSync === 'function') {
          const statfs = fs.statfsSync(process.cwd());
          const totalBytes = Number(statfs.blocks) * Number(statfs.bsize);
          const availableBytes = Number(statfs.bavail) * Number(statfs.bsize);
          primaryMount = {
            totalBytes,
            availableBytes,
            usePercent: totalBytes > 0 ? Math.round((1 - availableBytes / totalBytes) * 100) : 0,
          };
        }
        const activeJobs = typeof db.listRunningToolJobs === 'function' ? db.listRunningToolJobs().length : 0;
        return res.json({ ok: true, snapshot: createRuntimeResourceSnapshot({ disk: primaryMount, activeJobs }) });
      } catch (error) {
        return res.status(500).json({ ok: false, error: 'resource_snapshot_failed', message: error.message });
      }
    });

    app.get('/api/harness/index', async (req, res) => {
      try {
        const options = authorizeAndResolveOptions(req, res);
        if (!options) return;
        const harness = await loadHarnessModule();
        const scoped = harness.indexHarnessScope(options);
        const promptSummary = !boolQuery(req.query.full, false);
        res.json({
          ok: true,
          scope: scoped.scope,
          index: promptSummary ? scoped.promptSummary : scoped.index,
        });
      } catch (error) {
        if (/^Scope target does not exist:/i.test(String(error && error.message || ''))) {
          return res.status(404).json({ ok: false, error: 'scope_target_not_found' });
        }
        res.status(500).json({ ok: false, error: error.message });
      }
    });
  },
};
