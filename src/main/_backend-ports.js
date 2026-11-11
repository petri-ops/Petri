// ============================================================
// Backend port reservation
//
// Extracted from src/main.js by SUB-15.1 PHASE 2.
// Original location: L112-124 (selectBackendPorts).
//
// Tries preferred ports first; falls back to the system's chosen
// free port if occupied. Warns to console on every fallback.
// ============================================================

/**
 * Reserve localhost ports for all backend roles.
 * （BLOCK-30 P2：gateway :3005 已摘除。
 *   BLOCK-51 P3：plumber :8787 已随 plumber 空壳摘除。）
 *
 * @param {object} deps
 * @param {function} deps.reserveAvailablePort — reserveAvailablePort(fn) from core-utils
 * @param {function} deps.isDevMode           — isDevMode() from core-utils
 * @returns {Promise<{r:number, renderer:number|null}>}
 */
async function selectBackendPorts({ reserveAvailablePort, isDevMode, healthProbe } = {}) {
  const r = await reserveAvailablePort(3001);
  // BLOCK-414 期抓真（2026-11-11）：dev-electron 先起 petri-server(:3001) 再启
  // Electron——主进程 reserveAvailablePort(3001) 探到被占 → 保留口 fallback
  // （58422/58741）→ preload 烤出错误 rApiBase → CSP 全拦渲染请求。
  // 修法：3001 被占时先探 health——是我们自己的 petri-server 就复用 3001
  // （与 BLOCK-101 测试实例直连口径同族）；外来进程占用才保留口 fallback。
  if (r !== 3001) {
    const probe = healthProbe || (async (port) => {
      try {
        const resp = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(2000) });
        if (!resp.ok) return false;
        const body = await resp.json().catch(() => ({}));
        return body && body.status === 'ok' && body.db_ok !== undefined;
      } catch {
        return false;
      }
    });
    if (await probe(3001)) {
      console.warn(`[desktop] port 3001 occupied by our petri-server (health ok) — reusing it`);
      const renderer = isDevMode ? null : await reserveAvailablePort(3002);
      return { r: 3001, renderer };
    }
    console.warn(`[desktop] port 3001 occupied; using ${r} for petri-server`);
  }
  const renderer = isDevMode ? null : await reserveAvailablePort(3002);
  if (renderer && renderer !== 3002) console.warn(`[desktop] port 3002 occupied; using ${renderer} for renderer`);
  return { r, renderer };
}

module.exports = { selectBackendPorts };
