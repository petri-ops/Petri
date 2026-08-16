// ============================================================
// IPC handlers: compute-settings:get, compute-settings:save
//
// Extracted from src/main.js by BLOCK-9.1 PHASE 1.
// Original location: src/main.js ~line 1275 (setupComputeSettingsIpc)
// plus its 5 private helpers (DEFAULT_COMPUTE_SETTINGS,
// _getSettingsDir, _getComputeSettingsFile, _normalizeComputeSettings,
// _loadComputeSettings, _saveComputeSettings, _applyComputeSettings).
//
// All helpers are moved verbatim; main.js retains nothing for these.
// ============================================================

const fs = require("fs");
const path = require("path");
const { ipcMain, app } = require("electron");

const DEFAULT_COMPUTE_SETTINGS = {
  computeMode: "local",
  remoteComputeUrl: "",
  remoteComputeToken: "",
  remoteComputeName: "",
};

function _getSettingsDir() {
  return (
    process.env.BIOF3_LOCAL_DATA_DIR ||
    path.join(app.getPath("documents"), "BioF3-Local")
  );
}

function _getComputeSettingsFile() {
  return path.join(_getSettingsDir(), "compute-settings.json");
}

function _normalizeComputeSettings(input = {}) {
  const raw = input && typeof input === "object" ? input : {};
  const computeMode = String(raw.computeMode || raw.compute_mode || "local").toLowerCase();
  const normalizedMode = computeMode === "remote" ? "remote" : "local";
  return {
    ...DEFAULT_COMPUTE_SETTINGS,
    computeMode: normalizedMode,
    remoteComputeUrl: String(raw.remoteComputeUrl || raw.remote_compute_url || "").trim(),
    remoteComputeToken: String(raw.remoteComputeToken || raw.remote_compute_token || ""),
    remoteComputeName: String(raw.remoteComputeName || raw.remote_compute_name || "").trim(),
  };
}

function _loadComputeSettings() {
  try {
    const filePath = _getComputeSettingsFile();
    if (!fs.existsSync(filePath)) return { ...DEFAULT_COMPUTE_SETTINGS };
    return _normalizeComputeSettings(JSON.parse(fs.readFileSync(filePath, "utf8")));
  } catch {
    return { ...DEFAULT_COMPUTE_SETTINGS };
  }
}

function _saveComputeSettings(settings) {
  const normalized = _normalizeComputeSettings(settings);
  const dir = _getSettingsDir();
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {}
  fs.writeFileSync(_getComputeSettingsFile(), JSON.stringify(normalized, null, 2));
  return normalized;
}

function _applyComputeSettings(settings) {
  const normalized = _normalizeComputeSettings(settings);
  process.env.BIOF3_COMPUTE_MODE = normalized.computeMode;
  process.env.BIOF3_REMOTE_COMPUTE_URL = normalized.remoteComputeUrl;
  process.env.BIOF3_REMOTE_COMPUTE_TOKEN = normalized.remoteComputeToken;
  process.env.BIOF3_REMOTE_COMPUTE_NAME = normalized.remoteComputeName;
  return normalized;
}

function setupComputeSettingsIpc() {
  ipcMain.handle("compute-settings:get", async () => {
    try {
      return _loadComputeSettings();
    } catch (e) {
      return { ...DEFAULT_COMPUTE_SETTINGS, error: e.message };
    }
  });

  ipcMain.handle("compute-settings:save", async (_event, settings) => {
    try {
      const normalized = _saveComputeSettings(settings);
      _applyComputeSettings(normalized);
      return { ok: true, settings: normalized, restartRequired: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
}

module.exports = {
  setupComputeSettingsIpc,
  // helpers exported for any future test consumer
  _loadComputeSettings,
  _saveComputeSettings,
  _applyComputeSettings,
  _normalizeComputeSettings,
  DEFAULT_COMPUTE_SETTINGS,
};
