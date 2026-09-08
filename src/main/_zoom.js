// ============================================================
// Page zoom helpers
//
// Shared by the Ctrl/Cmd+wheel IPC path (_window-ipc.js) and the keyboard
// accelerator in _window-create.js.
//
// Why this exists: the main window is frameless (frame:false) with a
// self-drawn title bar, so Electron's View > zoomIn / zoomOut / resetZoom
// menu roles never surface for the user — no menu bar is rendered on
// Windows/Linux, and their accelerators are unreachable. Zoom is therefore
// applied explicitly through webContents.setZoomLevel.
//
// zoomLevel is Chromium's exponential scale: level = log(scale) / log(1.2),
// so +1 ≈ 1.2x and -5..5 spans roughly 0.4x .. 2.5x (clamped here).
// ============================================================

const ZOOM_MIN = -5;
const ZOOM_MAX = 5;

const isUsable = (win) =>
  Boolean(win) &&
  typeof win.isDestroyed === "function" &&
  !win.isDestroyed() &&
  Boolean(win.webContents);

const clampZoom = (level) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, level));

/**
 * Apply a relative zoom change. Positive delta zooms in.
 * Fractional deltas are supported (used by smooth wheel zooming).
 *
 * @returns {number|null} the new zoom level, or null if the window is gone
 */
function zoomBy(win, delta) {
  if (!isUsable(win)) return null;
  const wc = win.webContents;
  const step = typeof delta === "number" && Number.isFinite(delta) ? delta : 0;
  const next = clampZoom(wc.getZoomLevel() + step);
  if (next !== wc.getZoomLevel()) wc.setZoomLevel(next);
  return next;
}

/** Restore 100% zoom. */
function zoomReset(win) {
  if (!isUsable(win)) return null;
  win.webContents.setZoomLevel(0);
  return 0;
}

module.exports = { ZOOM_MIN, ZOOM_MAX, clampZoom, zoomBy, zoomReset };
