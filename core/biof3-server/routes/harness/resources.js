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
 *
 * BLOCK-78 P2-① — `?projectId=` 路由（additive，无参/local 既有调用方零改动）：
 *   ssh 项目 → Workspace Gateway `sys_resource` verb 经 mux 探测远程节点
 *   （node-agent 读 /proc + df，零依赖），归一化为与本地同构的快照并标
 *   `source:'remote'`+`host`；3s TTL 合并缓存（多表面轮询共用一次往返）；
 *   探测失败时回 stale 缓存（`stale:true`）或诚实 500（前端显示「{host}
 *   连接断开」），绝不静默回落本机读数。
 */

const fs = require('fs');
const cacheManager = require('../../cache-manager');
const db = require('../../db');
const { createRuntimeResourceSnapshot } = require('../../../shared-backend/runtime-resource-snapshot');
const {
  buildRemoteSnapshot,
  createRemoteSnapshotCache,
} = require('../../helpers/remote-resource-snapshot');
const {
  authorizeAndResolveOptions,
  boolQuery,
  loadHarnessModule,
} = require('../_helpers/harness-shared');

const remoteSnapshotCache = createRemoteSnapshotCache();

module.exports = {
  register(app) {
    app.get('/api/harness/resource-snapshot', async (req, res) => {
      try {
        const projectId = String((req.query && req.query.projectId) || '').trim();
        if (projectId) {
          return await respondForProject(req, res, projectId);
        }
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

    async function respondForProject(req, res, projectId) {
      const project = typeof db.getProject === 'function' ? db.getProject(projectId) : null;
      if (!project) {
        return res.status(404).json({ ok: false, error: 'project_not_found' });
      }
      if (project.workspace_kind !== 'ssh') {
        // local 项目：与本机路径同源（不缓存，语义与无参调用逐字节一致）。
        return res.redirect(307, '/api/harness/resource-snapshot');
      }
      const alias = project.ssh_host || 'SSH';
      const fresh = remoteSnapshotCache.getFresh(projectId);
      if (fresh) {
        return res.json({ ok: true, snapshot: fresh });
      }
      const root = project.remote_path || '';
      try {
        const { createSshBackend } = require('../../helpers/workspace-gateway');
        const backend = createSshBackend({ alias });
        const info = await backend.sysResource(root || undefined);
        const snapshot = buildRemoteSnapshot(info, { alias });
        remoteSnapshotCache.put(projectId, snapshot);
        return res.json({ ok: true, snapshot });
      } catch (error) {
        const stale = remoteSnapshotCache.getStale(projectId);
        if (stale) {
          return res.json({ ok: true, snapshot: stale, stale: true });
        }
        return res.status(502).json({
          ok: false,
          error: 'remote_resource_unreachable',
          message: error.message,
          host: alias,
        });
      }
    }

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
