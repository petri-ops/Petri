// ============================================================
// IPC handler: agent-workbench-flags channel
//
// Extracted from src/main.js by SUB-15.1 PHASE 1.
// Original location: src/main.js L29-42 (parseAgentWorkbenchFlags)
//                     + L603-610 (setupAgentWorkbenchFlagsIpc).
//
// Low-risk: pure parsing function (no Electron state) + simple
// IPC registration that passes mainWindow via parameter injection.
// ============================================================

const { ipcMain } = require("electron");

const AGENT_WORKBENCH_FLAG_CHANNEL = "gewu:agent-workbench-flags";
const AGENT_WORKBENCH_FLAG_NAME = "extraRenderers";

function parseAgentWorkbenchFlags(argv = process.argv, env = process.env) {
  const cliValue = argv.find((arg) => arg.startsWith("--agent-workbench-flags="));
  const raw = cliValue
    ? cliValue.slice("--agent-workbench-flags=".length)
    : String(env.BIOF3_AGENT_WORKBENCH_FLAGS || "");
  const enabled = raw
    .split(",")
    .map((value) => value.trim())
    .includes(AGENT_WORKBENCH_FLAG_NAME);
  return { extraRenderers: enabled };
}

function setupAgentWorkbenchFlagsIpc({ getMainWindow, getAgentWorkbenchFlags, publishAgentWorkbenchFlags }) {
  ipcMain.handle(AGENT_WORKBENCH_FLAG_CHANNEL, (event, value) => {
    const mainWindow = getMainWindow();
    if (event?.sender !== mainWindow?.webContents) {
      return { ok: false, extraRenderers: getAgentWorkbenchFlags().extraRenderers, error: "unauthorized" };
    }
    const agentWorkbenchFlags = getAgentWorkbenchFlags();
    agentWorkbenchFlags.extraRenderers = value === true;
    publishAgentWorkbenchFlags();
    return { ok: true, extraRenderers: agentWorkbenchFlags.extraRenderers };
  });
}

module.exports = {
  AGENT_WORKBENCH_FLAG_CHANNEL,
  AGENT_WORKBENCH_FLAG_NAME,
  parseAgentWorkbenchFlags,
  setupAgentWorkbenchFlagsIpc,
};
