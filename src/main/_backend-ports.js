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
 * （BLOCK-30 P2：gateway :3005 已摘除。）
 *
 * @param {object} deps
 * @param {function} deps.reserveAvailablePort — reserveAvailablePort(fn) from core-utils
 * @param {function} deps.isDevMode           — isDevMode() from core-utils
 * @returns {Promise<{r:number, plumber:number, renderer:number|null}>}
 */
async function selectBackendPorts({ reserveAvailablePort, isDevMode }) {
  const r = await reserveAvailablePort(3001);
  const plumber = await reserveAvailablePort(8787);
  const renderer = isDevMode ? null : await reserveAvailablePort(3002);
  if (r !== 3001) console.warn(`[desktop] port 3001 occupied; using ${r} for r-server`);
  if (plumber !== 8787) console.warn(`[desktop] port 8787 occupied; using ${plumber} for plumber`);
  if (renderer && renderer !== 3002) console.warn(`[desktop] port 3002 occupied; using ${renderer} for renderer`);
  return { r, plumber, renderer };
}

module.exports = { selectBackendPorts };
