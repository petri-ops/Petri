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
 * Reserve localhost ports for all 4 backend roles.
 *
 * @param {object} deps
 * @param {function} deps.reserveAvailablePort — reserveAvailablePort(fn) from core-utils
 * @param {function} deps.isDevMode           — isDevMode() from core-utils
 * @returns {Promise<{gateway:number, r:number, python:number, plumber:number, renderer:number|null}>}
 */
async function selectBackendPorts({ reserveAvailablePort, isDevMode }) {
  const gateway = await reserveAvailablePort(3005);
  const r = await reserveAvailablePort(3001);
  const python = await reserveAvailablePort(3004);
  const plumber = await reserveAvailablePort(8787);
  const renderer = isDevMode ? null : await reserveAvailablePort(3002);
  if (gateway !== 3005) console.warn(`[desktop] port 3005 occupied; using ${gateway} for gateway`);
  if (r !== 3001) console.warn(`[desktop] port 3001 occupied; using ${r} for r-server`);
  if (python !== 3004) console.warn(`[desktop] port 3004 occupied; using ${python} for py-server`);
  if (plumber !== 8787) console.warn(`[desktop] port 8787 occupied; using ${plumber} for plumber`);
  if (renderer && renderer !== 3002) console.warn(`[desktop] port 3002 occupied; using ${renderer} for renderer`);
  return { gateway, r, python, plumber, renderer };
}

module.exports = { selectBackendPorts };
