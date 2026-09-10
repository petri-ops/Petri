'use strict';

/**
 * helpers/remote-resource-snapshot.js — BLOCK-78 P2-① 远程资源快照
 *
 * 把 node-agent `sys_resource` verb 的 JSON 读数归一化为与本地
 * createRuntimeResourceSnapshot 同构的快照形状（前端一张卡同构渲染），
 * 外加来源标注（source/host）与 TTL 合并缓存（多表面轮询共用一次
 * mux 往返；实测单次 <100ms，5s 档 ≈12 往返/分钟）。
 *
 * 三态语义（沿 BLOCK-67 D5 诚实呈现）：
 *   fresh   —— TTL 内直接回缓存；
 *   stale   —— 探测失败但存在历史读数 → 回缓存 + stale:true（前端显示观测时间）；
 *   unreachable —— 无任何历史读数 → 调用方拿到错误（前端显示「{host} 连接断开」）。
 */

const TTL_MS_DEFAULT = 3000;

/**
 * agent sys_resource JSON → 前端快照形状（与 runtime-resource-snapshot 同构）。
 * @param {object} info node-agent sys_resource 输出（已 JSON.parse）
 * @param {{alias: string, now?: Date}} ctx
 */
function buildRemoteSnapshot(info, { alias, now = new Date() } = {}) {
  const memTotal = Number(info && info.memTotalBytes) || 0;
  const memAvailable = Number(info && info.memAvailableBytes) || 0;
  const disk = (info && info.disk) || {};
  const diskTotal = Number(disk.totalBytes) || 0;
  const diskAvailable = Number(disk.availableBytes) || 0;
  const diskUsePercent = Number(disk.usePercent) || 0;
  const memUsedPercent = memTotal > 0 ? ((memTotal - memAvailable) / memTotal) * 100 : 0;

  let state = 'ready';
  if (memTotal <= 0 && diskTotal <= 0) {
    state = 'unavailable';
  } else if (diskUsePercent >= 97 || memUsedPercent >= 97) {
    state = 'unavailable';
  } else if (diskUsePercent >= 90 || memUsedPercent >= 90) {
    state = 'warning';
  }

  return {
    schemaVersion: 1,
    observedAt: now.toISOString(),
    // 快照新鲜度窗口：本地为 30s；远程探测成本低，窗口取一半。
    expiresAt: new Date(now.getTime() + 15000).toISOString(),
    state,
    platform: `linux (ssh:${alias})`,
    cpu: {
      logicalCores: Number(info && info.cores) || null,
      load1m: info && info.load1m != null && Number.isFinite(Number(info.load1m))
        ? Number(info.load1m)
        : null,
    },
    memory: {
      totalBytes: memTotal,
      availableBytes: memAvailable,
      estimatedBytes: memTotal > 0 ? Math.max(0, memTotal - memAvailable) : null,
    },
    disk: {
      path: disk.path || null,
      totalBytes: diskTotal,
      availableBytes: diskAvailable,
      usePercent: diskUsePercent,
    },
    // 远程节点运行时与作业数本 verb 不探测（R/Py 真值属节点 probe/provenance 面）。
    runtime: { r: null, python: null, details: '远程节点运行时未随资源快照探测' },
    activeJobs: null,
    source: 'remote',
    host: alias,
  };
}

/** 按项目合并的 TTL 缓存工厂（路由模块持有一份；now 可注入便于测试）。 */
function createRemoteSnapshotCache({ ttlMs = TTL_MS_DEFAULT, now = () => Date.now() } = {}) {
  const entries = new Map(); // projectId → { at, snapshot }
  return {
    /** TTL 内命中 → 快照；否则 null。 */
    getFresh(projectId) {
      const entry = entries.get(projectId);
      if (!entry) return null;
      if (now() - entry.at >= ttlMs) return null;
      return entry.snapshot;
    },
    /** 最新读数（含超 TTL 的 stale），供探测失败时诚实降级。 */
    getStale(projectId) {
      const entry = entries.get(projectId);
      return entry ? entry.snapshot : null;
    },
    put(projectId, snapshot) {
      entries.set(projectId, { at: now(), snapshot });
    },
    clear() {
      entries.clear();
    },
  };
}

module.exports = {
  buildRemoteSnapshot,
  createRemoteSnapshotCache,
  TTL_MS_DEFAULT,
};
