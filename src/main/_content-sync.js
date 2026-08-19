// ============================================================
// Content incremental sync
//
// Extracted from src/main.js by SUB-15.1 PHASE 2.
// Original location: L138-159 (startContentSync).
//
// Starts a one-shot sync 5 s after boot and repeats every 4 h.
// Failures are non-fatal — console.warn only.
// ============================================================

/**
 * Start the background content sync loop.
 *
 * @param {object} deps
 * @param {function} deps.require — Node require (injected for testability)
 */
function startContentSync({ require } = require) {
  try {
    const { syncContent } = require("./content-sync");
    const _doSync = () => {
      syncContent().catch((e) =>
        console.warn("[desktop] content sync failed:", e.message),
      );
    };
    // First sync: 5 s after startup
    setTimeout(_doSync, 5000);
    // Repeating sync: every 4 h
    setInterval(_doSync, 4 * 60 * 60 * 1000);
  } catch (e) {
    console.warn("[desktop] content sync module not available:", e.message);
  }
}

module.exports = { startContentSync };
