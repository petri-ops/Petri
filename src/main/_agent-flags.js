// ============================================================
// Agent workbench flags publisher
//
// Extracted from src/main.js by SUB-15.1 PHASE 2.
// Original location: L164-169 (publishAgentWorkbenchFlags).
//
// Sends the current agent-workbench-flags payload to the
// renderer. Guards against destroyed windows.
// AGENT_WORKBENCH_FLAG_CHANNEL is imported from the PHASE 1
// workbench-flags IPC module.
// ============================================================

const { AGENT_WORKBENCH_FLAG_CHANNEL } = require("../ipc/workbench-flags");

/**
 * Send the current agent-workbench-flags payload to the renderer.
 *
 * @param {object} ctx
 * @param {function} ctx.getMainWindow          — () => BrowserWindow|null
 * @param {function} ctx.getAgentWorkbenchFlags — () => { extraRenderers: boolean }
 */
function publishAgentWorkbenchFlags({ getMainWindow, getAgentWorkbenchFlags }) {
  const mainWindow = getMainWindow();
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
  const { extraRenderers } = getAgentWorkbenchFlags();
  mainWindow.webContents.send(AGENT_WORKBENCH_FLAG_CHANNEL, {
    extraRenderers: extraRenderers === true,
  });
}

module.exports = { publishAgentWorkbenchFlags };
