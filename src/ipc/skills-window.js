// ============================================================
// Skills IPC window resolution helper
//
// Extracted from src/main.js by SUB-15.1 PHASE 1.
// Original location: src/main.js L821-825 (_resolveSkillsIpcWindow).
//
// Low-risk: pure function, no shared mutable state.
// mainWindow is passed via parameter injection (PHASE 2).
// ============================================================

function _resolveSkillsIpcWindow(getMainWindow, event) {
  const mainWindow = getMainWindow();
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  return event?.sender === mainWindow.webContents ? mainWindow : null;
}

module.exports = { _resolveSkillsIpcWindow };
