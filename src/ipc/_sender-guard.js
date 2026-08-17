'use strict';

/**
 * BLOCK-10 S-004 sender guard — minimal centralized helper that mirrors
 * the BLOCK-3 pattern at src/main.js:604 / src/main.js:1586 (window IPC).
 *
 * Every ipcMain.handle() in branch / result / ai-settings / plugin /
 * diagnostic handlers should call assertTrustedSender(event) as the
 * first line so a `<webview>` running a remote origin cannot inject
 * privileged writes into the main process.
 *
 * Returns null when the sender is trusted (mainWindow.webContents, not
 * destroyed). Returns a `{ ok:false, error:'unauthorized' }` shape the
 * caller can return to the renderer when the sender is not trusted.
 *
 * Design constraints (per BLOCK-3 invariant — do NOT rewrite):
 *  - No new module-level state.
 *  - No new dependency.
 *  - Pure function: caller passes the event + mainWindow getter, helper
 *    decides. mainWindow is intentionally fetched lazily because it can
 *    be null mid-shutdown.
 *
 * Note: the helpers in src/main.js (resolveWindowForSender / similar)
 * are kept untouched; this helper is additive.
 */

function isWebContentsDestroyed(webContents) {
  if (!webContents) return true;
  if (typeof webContents.isDestroyed === 'function') {
    return webContents.isDestroyed();
  }
  return false;
}

/**
 * Build an assertion bound to a specific mainWindow reference. Call once
 * per module so the hot path stays a single comparison.
 *
 * The argument may be either:
 *  - an Electron.BrowserWindow (or null/undefined), captured at call time
 *  - a thunk `() => BrowserWindow | null`, evaluated on every assertion.
 *    This keeps guards live across window replacement (app.on('activate')
 *    re-creates the main window and mutates the same holder).
 *
 * @param {Electron.BrowserWindow|null|undefined | (() => Electron.BrowserWindow|null|undefined)} mainWindowOrGetter
 * @returns {(event:any) => null | {ok:false, error:string}}
 */
function createSenderGuard(mainWindowOrGetter) {
  const resolveWindow =
    typeof mainWindowOrGetter === "function"
      ? mainWindowOrGetter
      : () => mainWindowOrGetter;
  return function assertTrustedSender(event) {
    const mainWindow = resolveWindow();
    if (!mainWindow || isWebContentsDestroyed(mainWindow)) {
      return { ok: false, error: 'unauthorized' };
    }
    const sender = event && event.sender;
    if (!sender || isWebContentsDestroyed(sender)) {
      return { ok: false, error: 'unauthorized' };
    }
    if (sender !== mainWindow.webContents) {
      return { ok: false, error: 'unauthorized' };
    }
    return null;
  };
}

module.exports = {
  createSenderGuard,
  isWebContentsDestroyed,
};