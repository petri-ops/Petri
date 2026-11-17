// ============================================================
// Backend port reservation
//
// Extracted from src/main.js by SUB-15.1 PHASE 2.
// Original location: L112-124 (selectBackendPorts).
//
// Tries preferred ports first; falls back to the system's chosen
// free port if occupied. Warns to console on every fallback.
// ============================================================

const { decideBackendOwnership, probeBackendIdentity } = require('./backend-ownership');

/**
 * Reserve localhost ports for all backend roles.
 * （BLOCK-30 P2：gateway :3005 已摘除。
 *   BLOCK-51 P3：plumber :8787 已随 plumber 空壳摘除。）
 *
 * BLOCK-457 P3 — 3001 被占时的身份判定升级：BLOCK-414 只复用端口号仍 spawn 第二
 * 进程（EADDRINUSE 循环根因）；现在经 decideBackendOwnership 判定——同 dataDir 的
 * petri-server → attachExisting=true（main.js 复用 attach 桩不 spawn）；异源/旧版/
 * 非 petri → fallback 端口 spawn（自己的后端、自己的数据，永不交叉认领）。
 *
 * @param {object} deps
 * @param {function} deps.reserveAvailablePort — reserveAvailablePort(fn) from core-utils
 * @param {function} deps.isDevMode           — isDevMode() from core-utils
 * @param {function} [deps.probeIdentity]     — async (port) => identity|null（默认 probeBackendIdentity）
 * @param {string}   [deps.ownDataDir]        — 本实例数据根（attach 判据；未设=永不 attach）
 * @returns {Promise<{r:number, renderer:number|null, attachExisting:boolean}>}
 */
async function selectBackendPorts({ reserveAvailablePort, isDevMode, probeIdentity, ownDataDir } = {}) {
  const probe = probeIdentity || probeBackendIdentity;
  const r = await reserveAvailablePort(3001);
  if (r !== 3001) {
    const identity = await probe(3001);
    if (decideBackendOwnership({ identity, ownDataDir }) === 'attach') {
      console.warn(`[desktop] port 3001 occupied by our petri-server (dataDir match) — attaching, no spawn`);
      const renderer = isDevMode ? null : await reserveAvailablePort(3002);
      return { r: 3001, renderer, attachExisting: true };
    }
    console.warn(`[desktop] port 3001 occupied; petri-server will use ${r}`);
  }
  const renderer = isDevMode ? null : await reserveAvailablePort(3002);
  if (renderer && renderer !== 3002) console.warn(`[desktop] port 3002 occupied; using ${renderer} for renderer`);
  return { r, renderer, attachExisting: false };
}

module.exports = { selectBackendPorts };
